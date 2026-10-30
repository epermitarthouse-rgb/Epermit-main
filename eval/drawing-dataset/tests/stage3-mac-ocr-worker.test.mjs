/**
 * Local Stage 3 Mac OCR worker tests (no GPT, no network, no production DB).
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  STAGE3_EXTRACTION_VERSION,
  buildJobRecord,
  claimNextJob,
  enqueueJobs,
  failClaimedJob,
  loadCompletedPacksFromWorkerRoot,
  processClaimedJob,
  resolveWorkerPaths,
  ensureWorkerDirs,
  PILOT_SHEETS,
} from "../lib/stage3MacOcrWorker.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const datasetOut = path.resolve(here, "../out/mcd-649fdaa6");

describe("Stage 3 Mac OCR worker queue", () => {
  it("claims atomically and prevents duplicate processing of done jobs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "stage3-worker-"));
    try {
      const paths = resolveWorkerPaths(root);
      await ensureWorkerDirs(paths);
      const sheet = PILOT_SHEETS.find((item) => item.id === "A-3.06");
      const job = buildJobRecord(sheet, { jobId: "job-dup-1" });
      await enqueueJobs(paths, [job]);
      await enqueueJobs(paths, [job]); // duplicate enqueue ignored
      const first = await claimNextJob(paths, { workerId: "w1" });
      const second = await claimNextJob(paths, { workerId: "w2" });
      assert.equal(first.id, "job-dup-1");
      assert.equal(second, null);

      // Mark done manually then re-enqueue should stay already_present
      await writeFile(path.join(paths.done, `${job.id}.json`), JSON.stringify({ ...job, status: "done" }));
      try {
        await rm(path.join(paths.claimed, `${job.id}.json`));
      } catch {
        // ignore
      }
      const again = await enqueueJobs(paths, [job]);
      assert.equal(again[0].status, "already_present");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("requeues on failure until maxAttempts then fails", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "stage3-worker-fail-"));
    try {
      const paths = resolveWorkerPaths(root);
      await ensureWorkerDirs(paths);
      const sheet = PILOT_SHEETS.find((item) => item.id === "FP200");
      const job = buildJobRecord(sheet, { jobId: "job-fail-1", maxAttempts: 2 });
      await enqueueJobs(paths, [job]);
      const claimed = await claimNextJob(paths, { workerId: "w1" });
      await failClaimedJob(paths, claimed, new Error("ocr boom"));
      assert.ok(existsSync(path.join(paths.pending, "job-fail-1.json")));
      const claimed2 = await claimNextJob(paths, { workerId: "w1" });
      await failClaimedJob(paths, claimed2, new Error("ocr boom again"));
      assert.ok(existsSync(path.join(paths.failed, "job-fail-1.json")));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("Stage 3 Mac OCR worker against layout-full pilot sheets", () => {
  let workerRoot;
  const required = PILOT_SHEETS.every((sheet) =>
    existsSync(path.join(datasetOut, "layout-full/pages", `${sheet.sha256}.json`)));

  before(async () => {
    if (!required) return;
    workerRoot = path.join(datasetOut, "stage3-mac-worker-test");
    await rm(workerRoot, { recursive: true, force: true });
    const paths = resolveWorkerPaths(workerRoot);
    await ensureWorkerDirs(paths);
    const jobs = PILOT_SHEETS.map((sheet) => buildJobRecord(sheet, {
      layoutPagePath: path.join(datasetOut, "layout-full/pages", `${sheet.sha256}.json`),
      pdfPath: null,
    }));
    await enqueueJobs(paths, jobs);
  });

  it("processes A-3.06 / A-6.00 / FP200 with cache hit on second pass", async () => {
    if (!required) {
      assert.ok(true, "skip — layout-full caches missing");
      return;
    }
    const paths = resolveWorkerPaths(workerRoot);
    const firstPass = [];
    for (let index = 0; index < 3; index += 1) {
      const job = await claimNextJob(paths, { workerId: "test-w" });
      assert.ok(job);
      const result = await processClaimedJob(paths, job, { freshOcr: false });
      firstPass.push(result);
      assert.equal(result.status, "done");
      assert.equal(result.pack.independentlyVerified, false);
      assert.equal(result.job.cacheHit, false);
    }
    const bySheet = Object.fromEntries(firstPass.map((item) => [item.pack.sheetId, item.pack]));
    assert.equal(bySheet["A-3.06"].status, "evidence_recovered");
    assert.match(String(bySheet["A-3.06"].detailIdentifier || ""), /GUARD\s*RAIL/i);
    assert.match(bySheet["A-3.06"].promptBlock, /3\s*['′]\s*-?\s*6/);
    assert.equal(bySheet["A-3.06"].assessment?.status, "associated_to_guardrail_detail");
    assert.equal(bySheet["A-6.00"].status, "evidence_recovered");
    assert.ok((bySheet["A-6.00"].hits?.rowClusters || 0) >= 1);
    assert.equal(bySheet["FP200"].status, "evidence_recovered");
    assert.match(bySheet["FP200"].promptBlock, /density/i);
    assert.match(bySheet["FP200"].promptBlock, /flowDemand|FLOW DEMAND|independentlyVerified=false/i);
    assert.equal(bySheet["FP200"].independentlyVerified, false);

    // Re-enqueue same SHA jobs with new ids → cache hits
    const cachedJobs = PILOT_SHEETS.map((sheet) => buildJobRecord(sheet, {
      jobId: `cache-${sheet.id}`,
      layoutPagePath: path.join(datasetOut, "layout-full/pages", `${sheet.sha256}.json`),
    }));
    await enqueueJobs(paths, cachedJobs);
    for (let index = 0; index < 3; index += 1) {
      const job = await claimNextJob(paths, { workerId: "test-w" });
      const result = await processClaimedJob(paths, job, { freshOcr: false });
      assert.equal(result.status, "cache_hit");
      assert.equal(result.job.cacheHit, true);
    }
  });

  it("pack loader returns completed packs and empty when offline/missing", async () => {
    if (!required) {
      assert.ok(true, "skip — layout-full caches missing");
      return;
    }
    const a306 = PILOT_SHEETS.find((sheet) => sheet.id === "A-3.06");
    const packs = await loadCompletedPacksFromWorkerRoot(workerRoot, {
      contentSha256: a306.sha256,
      fileName: a306.relativePath,
    });
    assert.equal(packs.length, 1);
    assert.equal(packs[0].independentlyVerified, false);
    assert.match(packs[0].promptBlock, /GUARD RAIL/i);
    assert.equal(STAGE3_EXTRACTION_VERSION.includes("stage3"), true);

    const missing = await loadCompletedPacksFromWorkerRoot(workerRoot, {
      contentSha256: "deadbeef",
      fileName: "missing.pdf",
    });
    assert.deepEqual(missing, []);
  });
});
