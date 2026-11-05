/**
 * Supabase Analyzer V2 run sync (job-driven) and drawing ingest. Network, OCR and layout are injected.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  MAX_SHEET_ATTEMPTS,
  finalizeRunGate,
  reconcileRunSheets,
  runSheetKeys,
  syncAnalyzerV2Run,
} from "../lib/stage3RunSync.mjs";
import { ingestPaths, ingestSheetPdf } from "../lib/stage3SheetIngest.mjs";
import { defaultRunState, loadRunState, toAnalysisScopePreprocessSummary } from "../lib/stage3OcrRunState.mjs";
import { STAGE3_EVIDENCE_V2 } from "../lib/stage3EvidenceConfig.mjs";

const sha = (text) => createHash("sha256").update(text).digest("hex");
const job = (id, name, status = "queued") => ({ id, original_file_name: name, status });

async function withRoot(fn) {
  const root = await mkdtemp(path.join(tmpdir(), "stage3-run-sync-"));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function fakeApi(root, overrides = {}) {
  const calls = { ingest: [], process: [], verify: [], synced: [] };
  const api = {
    listJobs: async () => overrides.jobs,
    download: async ({ sheetJobId, relativePath }) => {
      const pdfPath = path.join(root, "drawings", relativePath);
      await mkdir(path.dirname(pdfPath), { recursive: true });
      await writeFile(pdfPath, `pdf:${sheetJobId}`);
      return { pdfPath, sha256: sha(`pdf:${sheetJobId}`) };
    },
    ingest: async (input) => {
      calls.ingest.push(input);
      const paths = ingestPaths(input.ingestRoot, input.contentSha256);
      await mkdir(paths.dir, { recursive: true });
      await writeFile(paths.recoveryPath, JSON.stringify({ sha256: input.contentSha256, pages: [{ ocrAttempted: true }] }));
      await writeFile(paths.layoutPagePath, "{}");
      return { ...paths, cacheHit: false };
    },
    processJob: async (_paths, record, options) => {
      calls.process.push({ record, options, recovery: await options.recoverPdf() });
      return { job: { evidenceV2: { cacheKey: `${record.contentSha256}.v2.model.r6-downstream` } } };
    },
    verify: async (identity) => {
      calls.verify.push(identity);
      return overrides.verify ? overrides.verify(identity) : { ok: true, packStatus: "evidence_recovered" };
    },
    syncPreprocess: async (state) => {
      calls.synced.push(toAnalysisScopePreprocessSummary(state));
    },
  };
  return { api, calls };
}

describe("run sheet keys and reconciliation", () => {
  it("keys sheets by file name and disambiguates duplicates", () => {
    const keys = runSheetKeys([job("aaaaaaaa-1", "A-1.pdf"), job("bbbbbbbb-2", "a-1.pdf"), job("cccccccc-3", "S-2.pdf")]);
    assert.equal(keys.get("aaaaaaaa-1"), "A-1.pdf#aaaaaaaa");
    assert.equal(keys.get("bbbbbbbb-2"), "a-1.pdf#bbbbbbbb");
    assert.equal(keys.get("cccccccc-3"), "S-2.pdf");
  });

  it("adds new sheets as pending, drops removed ones and reopens a worker-released gate", () => {
    const state = defaultRunState({ projectId: "p", runId: "r" });
    const first = [job("1", "A-1.pdf"), job("2", "A-2.pdf")];
    assert.equal(reconcileRunSheets(state, first, runSheetKeys(first)), true);
    assert.deepEqual(Object.keys(state.sheets), ["A-1.pdf", "A-2.pdf"]);
    assert.equal(state.requiredSheetCount, 2);
    state.gateMode = "approved_partial";
    state.gateReleasedBy = "worker";
    const second = [job("2", "A-2.pdf"), job("3", "A-3.pdf")];
    assert.equal(reconcileRunSheets(state, second, runSheetKeys(second)), true);
    assert.deepEqual(Object.keys(state.sheets), ["A-2.pdf", "A-3.pdf"]);
    assert.equal(state.gateMode, "blocking");
    assert.equal(state.gateReleasedBy, undefined);
  });

  it("leaves an operator-released gate alone and does not reset unchanged sheets", () => {
    const state = defaultRunState({ projectId: "p", runId: "r" });
    const jobs = [job("1", "A-1.pdf")];
    reconcileRunSheets(state, jobs, runSheetKeys(jobs));
    state.sheets["A-1.pdf"].status = "completed";
    state.gateMode = "released";
    assert.equal(reconcileRunSheets(state, jobs, runSheetKeys(jobs)), false);
    assert.equal(state.sheets["A-1.pdf"].status, "completed");
    assert.equal(state.gateMode, "released");
  });

  it("releases the gate only when every sheet is terminal and some lack evidence", () => {
    const state = defaultRunState({ projectId: "p", runId: "r" });
    const jobs = [job("1", "A-1.pdf"), job("2", "A-2.pdf")];
    reconcileRunSheets(state, jobs, runSheetKeys(jobs));
    Object.assign(state.sheets["A-1.pdf"], { status: "completed", packStatus: "evidence_recovered" });
    assert.equal(finalizeRunGate(state), false);
    Object.assign(state.sheets["A-2.pdf"], { status: "failed" });
    assert.equal(finalizeRunGate(state), true);
    assert.equal(state.gateMode, "approved_partial");
    assert.match(state.gateReleaseReason, /1 sheet\(s\) without usable evidence run on the PDF only: A-2\.pdf/);
    const summary = toAnalysisScopePreprocessSummary(state);
    assert.equal(summary.gateReleasedBy, "worker");

    const full = defaultRunState({ projectId: "p", runId: "r" });
    reconcileRunSheets(full, jobs, runSheetKeys(jobs));
    for (const row of Object.values(full.sheets)) Object.assign(row, { status: "completed", packStatus: "evidence_recovered" });
    assert.equal(finalizeRunGate(full), false);
    assert.equal(full.gateMode, "blocking");
  });
});

describe("syncAnalyzerV2Run", () => {
  it("builds verified v1 and v2 packs on 4x3 OCR for every sheet, ingesting drawings outside the prepared set", () => withRoot(async (root) => {
    const jobs = [job("job-1", "A-1.pdf"), job("job-2", "S-2.pdf"), job("job-3", "X.pdf", "cancelled")];
    const { api, calls } = fakeApi(root, { jobs });
    const result = await syncAnalyzerV2Run({ workerRoot: root, datasetOut: null, projectId: "p", runId: "r" }, api);
    assert.equal(result.sheets, 2);
    assert.equal(result.processed, 2);
    assert.equal(result.preprocess.terminal, true);
    assert.equal(result.preprocess.missingEvidence, 0);
    assert.equal(result.gateMode, "blocking");
    for (const outcome of result.outcomes) {
      assert.equal(outcome.status, "completed");
      assert.equal(outcome.ocrGrid, "4x3");
      assert.equal(outcome.evidenceSource, "ingested");
      assert.match(outcome.v2CacheKey, /model\.r6-downstream/);
    }
    assert.equal(calls.ingest.length, 2);
    for (const { record, options, recovery } of calls.process) {
      assert.equal(record.evidenceVersion, STAGE3_EVIDENCE_V2);
      assert.equal(record.ocrGrid, undefined);
      assert.equal(record.resolution, undefined);
      assert.equal(record.runId, "r");
      assert.deepEqual(options.storage, { viaEdge: true });
      assert.equal(recovery.sha256, record.contentSha256);
    }
    assert.deepEqual(calls.verify.map((v) => v.extractionVersion || "v1"), ["v1", STAGE3_EVIDENCE_V2, "v1", STAGE3_EVIDENCE_V2]);
    const last = calls.synced.at(-1);
    assert.equal(last.terminal, true);
    assert.equal(last.requiredSheetCount, 2);
    assert.deepEqual(last.counts, { pending: 0, processing: 0, completed: 2, failed: 0, skipped: 0 });

    const again = await syncAnalyzerV2Run({ workerRoot: root, datasetOut: null, projectId: "p", runId: "r" }, api);
    assert.equal(again.processed, 0);
  }));

  it("waits for sheets still uploading and does not release the gate", () => withRoot(async (root) => {
    const jobs = [job("job-1", "A-1.pdf"), job("job-2", "S-2.pdf", "upload_pending")];
    const { api } = fakeApi(root, { jobs, verify: () => ({ ok: false, error: "Pack not found in Storage" }) });
    for (let i = 0; i < MAX_SHEET_ATTEMPTS; i += 1) {
      await syncAnalyzerV2Run({ workerRoot: root, datasetOut: null, projectId: "p", runId: "r" }, api);
    }
    const state = await loadRunState(root, "r");
    assert.equal(state.sheets["A-1.pdf"].status, "failed");
    assert.equal(state.sheets["S-2.pdf"].status, "pending");
    assert.equal(state.gateMode, "blocking");
  }));

  it("retries an unverified pack, then fails the sheet and releases the gate for a PDF-only fallback", () => withRoot(async (root) => {
    const jobs = [job("job-1", "A-1.pdf"), job("job-2", "S-2.pdf")];
    const { api } = fakeApi(root, {
      jobs,
      verify: (identity) => identity.sheetJobId === "job-2" && identity.extractionVersion
        ? { ok: false, issue: "sha_mismatch" }
        : { ok: true, packStatus: "evidence_recovered" },
    });
    const opts = { workerRoot: root, datasetOut: null, projectId: "p", runId: "r" };
    const first = await syncAnalyzerV2Run(opts, api);
    const failedOutcome = first.outcomes.find((o) => o.sheetJobId === "job-2");
    assert.equal(failedOutcome.status, "pending");
    assert.match(failedOutcome.lastError, /pack_not_verified:v1=ok:v2=sha_mismatch/);
    assert.equal(first.gateMode, "blocking");
    for (let i = 1; i < MAX_SHEET_ATTEMPTS; i += 1) await syncAnalyzerV2Run(opts, api);
    const state = await loadRunState(root, "r");
    assert.equal(state.sheets["S-2.pdf"].status, "failed");
    assert.equal(state.sheets["S-2.pdf"].attempts, MAX_SHEET_ATTEMPTS);
    assert.equal(state.gateMode, "approved_partial");
    assert.equal(state.gateReleasedBy, "worker");
  }));
});

describe("ingestSheetPdf", () => {
  const baseline = { pageNumber: 1, width: 100, height: 100, textBlocks: [] };
  const deps = (counter) => ({
    extractPdf: async () => ({ openStatus: "opened", pages: [baseline] }),
    recoverPdf: async () => {
      counter.ocr += 1;
      return { recoveryVersion: "r", pages: [{ ocrAttempted: true, words: [], lines: [] }] };
    },
    runLayout: async (_pdf, regionsPath) => {
      await writeFile(regionsPath, JSON.stringify({ layoutStatus: "ok", regions: [] }));
      return null;
    },
  });

  it("writes recovery and layout once per drawing and reuses them", () => withRoot(async (root) => {
    const counter = { ocr: 0 };
    const input = { pdfPath: path.join(root, "x.pdf"), contentSha256: sha("x"), relativePath: "X.pdf", ingestRoot: path.join(root, "ingest") };
    const first = await ingestSheetPdf(input, deps(counter));
    assert.equal(first.cacheHit, false);
    const recovery = JSON.parse(await readFile(first.recoveryPath, "utf8"));
    assert.equal(recovery.sha256, sha("x"));
    const layout = JSON.parse(await readFile(first.layoutPagePath, "utf8"));
    assert.equal(layout.sha256, sha("x"));
    assert.equal(layout.relativePath, "X.pdf");
    assert.ok(layout.ingestVersion);
    const second = await ingestSheetPdf(input, deps(counter));
    assert.equal(second.cacheHit, true);
    assert.equal(counter.ocr, 1);
  }));

  it("refuses unreadable PDFs, missing OCR and a missing SHA-256", () => withRoot(async (root) => {
    const input = { pdfPath: "x.pdf", contentSha256: sha("y"), relativePath: "Y.pdf", ingestRoot: root };
    await assert.rejects(ingestSheetPdf({ ...input, contentSha256: "abc" }, deps({ ocr: 0 })), /ingest_sha256_required/);
    await assert.rejects(ingestSheetPdf(input, { ...deps({ ocr: 0 }), extractPdf: async () => ({ openStatus: "encrypted", pages: [] }) }), /ingest_pdf_unreadable:encrypted/);
    await assert.rejects(ingestSheetPdf(input, { ...deps({ ocr: 0 }), recoverPdf: async () => ({ pages: [{ ocrAttempted: false }] }) }), /ingest_ocr_unavailable/);
  }));
});
