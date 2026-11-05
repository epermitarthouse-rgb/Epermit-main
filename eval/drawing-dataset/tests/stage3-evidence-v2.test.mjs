/**
 * Stage 3 v2 evidence: annotation model rules, row splitting, digest bounds, worker v2 path
 * (v1 output unchanged), full-set v2 upload, run-scoped options. No GPT, no network.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildEvidenceModel,
  startsNewAnnotation,
  uncertaintyReasons,
} from "../lib/stage3AnnotationModel.mjs";
import { rowsFromRecoveryPage, splitLineWords } from "../lib/stage3RowReconstruct.mjs";
import { buildStage3V2Pack, renderTechnicalDigest } from "../lib/stage3TechnicalDigest.mjs";
import { V2_ANALYZER_BOUNDS, v2AnalyzerBlock } from "../lib/stage3EvidenceEval.mjs";
import { STAGE3_EVIDENCE_V2, resolveStage3EvidenceOptions } from "../lib/stage3EvidenceConfig.mjs";
import {
  PILOT_SHEETS,
  buildJobRecord,
  ensureWorkerDirs,
  processClaimedJob,
  resolveWorkerPaths,
  v2PackPath,
} from "../lib/stage3MacOcrWorker.mjs";
import { uploadStage3PackToStorage } from "../lib/stage3StorageUpload.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const datasetOut = path.resolve(here, "../out/mcd-649fdaa6");

const box = (x, y, width, height) => ({ x, y, width, height });
const row = (rid, text, b, extra = {}) => ({ rid, text, box: b, vertical: false, confidence: 1, words: [{ text, box: b, confidence: 1 }], ...extra });

describe("v2 annotation boundaries", () => {
  it("starts a new annotation at text boundaries", () => {
    assert.equal(startsNewAnnotation("MANUFACTURER'S INSTRUCTIONS.", "CHECK WITH ROOF SYSTEM"), true);
    assert.equal(startsNewAnnotation("FASTENERS", "-4x4 WOOD BLOCKING"), true);
    assert.equal(startsNewAnnotation("PLATE", "(E) INSULATION"), true);
    assert.equal(startsNewAnnotation("SOIL UNDER THE SLAB", "2. BEAR ALL LINTELS"), true);
    assert.equal(startsNewAnnotation("SHEATHING", "6\" METAL STUDS @ 16\" O.C."), true);
    assert.equal(startsNewAnnotation("FLOOR LIVE LOAD: 100 PSF", "ROOF LIVE LOAD: 30 PSF"), true);
    assert.equal(startsNewAnnotation("Ss 0.133", "S1 0.43"), true);
  });

  it("keeps printed continuations together", () => {
    assert.equal(startsNewAnnotation("3'-6\" MIN HEIGHT FROM", "T.O. ROOF DECK MEMBRANE"), false);
    assert.equal(startsNewAnnotation("25'-0\" A.F.F.", "EXISTING ROOF @ L.P. (V.I.F.)"), false);
    assert.equal(startsNewAnnotation("DINING", "101B"), false);
    assert.equal(startsNewAnnotation("POSITIONED 1/4\" FROM", "2\" ABOVE"), false);
    assert.equal(startsNewAnnotation("ROOF LIVE LOAD: 30 PSF", "(NO REDUCTIONS PERMITTED)"), false);
  });

  it("groups stacked callouts separately when the next starts with a leader dash", () => {
    const rows = [
      row("r001", "EXTEND GUARD RAIL MIN. 30\"", box(100, 200, 120, 8)),
      row("r002", "BEYOND EACH END", box(100, 190, 80, 8)),
      row("r003", "-4x4 WOOD BLOCKING", box(100, 180, 90, 8)),
    ];
    const model = buildEvidenceModel(rows);
    const groups = model.annotations.map((a) => a.rows);
    assert.deepEqual(groups, [["r001", "r002"], ["r003"]]);
  });
});

describe("v2 uncertainty markers", () => {
  it("flags dangling fractions and 7-digit steel designations", () => {
    assert.deepEqual(uncertaintyReasons("7/ BLOCKING & PARAPET"), ["glyph"]);
    assert.deepEqual(uncertaintyReasons("6005162-43 MIL @ 16\" O/C"), ["glyph"]);
    assert.deepEqual(uncertaintyReasons("600S162-43 MIL @ 16\" O/C"), []);
    assert.deepEqual(uncertaintyReasons("Sdl 0.069"), ["glyph"]);
    assert.deepEqual(uncertaintyReasons("SEE DETAIL 3"), []);
    assert.deepEqual(uncertaintyReasons("3'-6\" MIN"), []);
  });

  it("marks rows of an annotation whose parentheses do not balance as truncated", () => {
    const rows = [
      row("r001", "ROOF LIVE LOAD: 30 PSF", box(100, 200, 120, 8)),
      row("r002", "(GROUND SNOW LOAD:", box(100, 190, 90, 8)),
    ];
    const model = buildEvidenceModel(rows);
    const r2 = model.rows.find((r) => r.rid === "r002");
    assert.ok(r2.uncertain.includes("truncated"));
    assert.deepEqual(model.rows.find((r) => r.rid === "r001").uncertain, []);
  });
});

describe("v2 row reconstruction", () => {
  it("splits a production line at a column-sized gap and keeps the words", () => {
    const words = [
      { text: "DRAWN BY:", box: box(100, 50, 40, 6), confidence: 1 },
      { text: "DESIGN BY:", box: box(200, 50, 42, 6), confidence: 0.5 },
    ];
    assert.equal(splitLineWords(words, false).length, 2);
    const rows = rowsFromRecoveryPage({ words, lines: [{ text: "DRAWN BY: DESIGN BY:", box: box(100, 50, 142, 6), words: 2 }] });
    assert.deepEqual(rows.map((r) => r.text), ["DRAWN BY:", "DESIGN BY:"]);
    assert.equal(rows[1].confidence, 0.5);
    assert.equal(rows[0].splitFrom, "DRAWN BY: DESIGN BY:");
  });

  it("keeps ordinary word spacing on one row", () => {
    const words = [
      { text: "3'-6\"", box: box(100, 50, 20, 6), confidence: 1 },
      { text: "MIN", box: box(122, 50, 14, 6), confidence: 1 },
    ];
    const rows = rowsFromRecoveryPage({ words, lines: [{ text: "3'-6\" MIN", box: box(100, 50, 36, 6), words: 2 }] });
    assert.deepEqual(rows.map((r) => r.text), ["3'-6\" MIN"]);
    assert.equal(rows[0].splitFrom, undefined);
  });
});

describe("v2 digest and analyzer block bounds", () => {
  const many = Array.from({ length: 120 }, (_, i) => row(`r${String(i + 1).padStart(3, "0")}`, `${i + 1}'-0" A.F.F. NOTE ${i}.`, box(100 + (i % 6) * 300, 2000 - Math.floor(i / 6) * 40, 120, 8)));
  const model = buildEvidenceModel(many);

  it("never exceeds the pack budget and reports omissions", () => {
    const { promptBlock, digest } = renderTechnicalDigest(model, { sheetId: "T-1", maxChars: 2600 });
    assert.ok(promptBlock.length <= 2600, `pack ${promptBlock.length}`);
    assert.equal(digest.shown.length + digest.omitted.length, model.annotations.length);
    assert.match(promptBlock.split("\n").at(-1), /^omitted: \d+ annotations .*not shown is not absent$/);
  });

  it("cuts the analyzer block only at complete lines and stays within 3,200 with notes", () => {
    const pack = buildStage3V2Pack({ sheetId: "T-1", model, maxChars: 6000 });
    const block = v2AnalyzerBlock([pack], "recovered", ["Stage 3 v2 evidence note"]);
    assert.ok(block.length <= V2_ANALYZER_BOUNDS.maxTotalChars, `block ${block.length}`);
    const packLines = new Set(pack.promptBlock.split("\n"));
    const body = block.split("\n").slice(3, -1);
    assert.ok(body.length > 1);
    for (const line of body) assert.ok(packLines.has(line), `cut line: ${line}`);
    assert.match(block.split("\n").at(-1), /^stage3_notes: /);
  });

  it("carries compact provenance for shown annotations only", () => {
    const pack = buildStage3V2Pack({ sheetId: "T-1", model });
    assert.equal(pack.extractionVersion, STAGE3_EVIDENCE_V2);
    assert.equal(pack.independentlyVerified, false);
    assert.equal(pack.evidenceModel.annotations.length, pack.digest.shown.length);
    for (const r of pack.evidenceModel.rows) {
      assert.ok(r.box && typeof r.confidence === "number" && Array.isArray(r.words) && Array.isArray(r.alternatives));
    }
  });
});

describe("v2 run-scoped options", () => {
  it("defaults to v1 and rejects unknown or unsafe combinations", () => {
    assert.equal(resolveStage3EvidenceOptions({}).evidenceVersion, "v1");
    assert.equal(resolveStage3EvidenceOptions({ evidenceVersion: "v2" }).extractionVersion, STAGE3_EVIDENCE_V2);
    assert.throws(() => resolveStage3EvidenceOptions({ evidenceVersion: "v9" }), /unknown/);
    assert.throws(() => resolveStage3EvidenceOptions({ evidenceVersion: "v1", ocrGrid: "12x9" }), /requires/);
  });

  it("leaves v1 job records unchanged and gives v2 jobs their own id", () => {
    const sheet = PILOT_SHEETS.find((s) => s.id === "A-3.06");
    const v1 = buildJobRecord(sheet, {});
    const v2 = buildJobRecord(sheet, { evidenceVersion: "v2", recoveryPath: "/tmp/r.json" });
    assert.equal("evidenceVersion" in v1, false);
    assert.equal("recoveryPath" in v1, false);
    assert.notEqual(v1.id, v2.id);
    assert.equal(v2.evidenceVersion, STAGE3_EVIDENCE_V2);
    assert.equal(v2.extractionVersion, v1.extractionVersion);
  });

  it("stores v2 packs under the v2 object path and v1 packs under the v1 path", async () => {
    const objects = [];
    const storage = { async upload(_bucket, objectPath) { objects.push(objectPath); } };
    const identity = { projectId: "p", runId: "r", sheetJobId: "j", contentSha256: "ab".repeat(32) };
    await uploadStage3PackToStorage({ storage, ...identity, pack: { sourceFileSha256: identity.contentSha256, extractionVersion: STAGE3_EVIDENCE_V2 } });
    await uploadStage3PackToStorage({ storage, ...identity, pack: { sourceFileSha256: identity.contentSha256 } });
    assert.match(objects[0], /\.macos-vision\.phase3\.stage3-visual-evidence\.v2\.json$/);
    assert.match(objects[1], /\.macos-vision\.phase3\.stage3-visual-evidence\.v1\.json$/);
  });
});

describe("v2 worker path (local cached A-3.06)", () => {
  const sheet = PILOT_SHEETS.find((s) => s.id === "A-3.06");
  const layoutPagePath = path.join(datasetOut, "layout-full/pages", `${sheet.sha256}.json`);
  const recoveryPath = path.join(datasetOut, "recovery", `${sheet.sha256}.json`);
  const available = existsSync(layoutPagePath) && existsSync(recoveryPath);
  const strip = (pack) => ({ ...pack, generatedAt: null });

  it("writes the v2 pack next to an unchanged v1 pack, and fails open without recovery", async () => {
    if (!available) {
      assert.ok(true, "skip — cached layout/recovery missing");
      return;
    }
    const rootA = await mkdtemp(path.join(tmpdir(), "stage3-v1-"));
    const rootB = await mkdtemp(path.join(tmpdir(), "stage3-v2-"));
    try {
      const pathsA = resolveWorkerPaths(rootA);
      const pathsB = resolveWorkerPaths(rootB);
      await ensureWorkerDirs(pathsA);
      await ensureWorkerDirs(pathsB);
      const v1Job = buildJobRecord(sheet, { layoutPagePath });
      const v2Job = buildJobRecord(sheet, { layoutPagePath, evidenceVersion: "v2", recoveryPath });
      const a = await processClaimedJob(pathsA, v1Job, { freshOcr: false });
      const b = await processClaimedJob(pathsB, v2Job, { freshOcr: false });
      assert.deepEqual(strip(b.pack), strip(a.pack));
      assert.equal(a.job.evidenceV2, undefined);
      assert.equal(b.job.evidenceV2.status, "built");
      const v2 = JSON.parse(await readFile(v2PackPath(pathsB, sheet.id, sheet.sha256), "utf8"));
      assert.equal(v2.extractionVersion, STAGE3_EVIDENCE_V2);
      assert.equal(v2.sourceFileSha256, sheet.sha256);
      assert.equal(v2.provenance.extractionMethod, "macos-vision");
      assert.ok(v2.promptBlock.length <= 2600);
      assert.ok(Buffer.byteLength(JSON.stringify(v2)) < 200_000);
      assert.equal(existsSync(path.join(rootA, "packs-v2")), false);

      const cached = await processClaimedJob(pathsB, { ...v2Job, id: "again" }, { freshOcr: false });
      assert.equal(cached.status, "cache_hit");
      assert.equal(cached.job.evidenceV2.cacheHit, true);

      const rootC = await mkdtemp(path.join(tmpdir(), "stage3-v2-missing-"));
      try {
        const pathsC = resolveWorkerPaths(rootC);
        await ensureWorkerDirs(pathsC);
        const missing = buildJobRecord(sheet, { layoutPagePath, evidenceVersion: "v2", recoveryPath: path.join(rootC, "none.json") });
        const c = await processClaimedJob(pathsC, missing, { freshOcr: false });
        assert.equal(c.status, "done");
        assert.equal(c.job.evidenceV2.fallbackReason, "v2_recovery_missing");
        assert.deepEqual(strip(c.pack), strip(a.pack));
      } finally {
        await rm(rootC, { recursive: true, force: true });
      }
    } finally {
      await rm(rootA, { recursive: true, force: true });
      await rm(rootB, { recursive: true, force: true });
    }
  });
});

describe("v2 full-set upload (stubbed Edge)", () => {
  it("uploads and verifies v2 after v1, fails open when the v2 pack is missing, and is off for v1 runs", async () => {
    const manifestPath = path.join(datasetOut, "pages-manifest.json");
    if (!existsSync(manifestPath)) {
      assert.ok(true, "skip — local manifest missing");
      return;
    }
    const { loadAuthoritativeDrawingManifest } = await import("../lib/stage3DrawingManifest.mjs");
    const { uploadAndVerifyFullSetPacks } = await import("../lib/stage3FullSetUpload.mjs");
    const { mkdir, writeFile } = await import("node:fs/promises");
    const manifest = await loadAuthoritativeDrawingManifest(datasetOut);
    const sheet = manifest.sheets[0];
    const jobs = manifest.sheets.map((s, i) => ({ id: `job-${i}`, original_file_name: s.relativePath }));
    const root = await mkdtemp(path.join(tmpdir(), "stage3-fullset-v2-"));
    const saved = { fetch: globalThis.fetch, env: { ...process.env } };
    const stored = new Map();
    const requests = [];
    let rejectV2 = false;
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      requests.push(body);
      const reply = (payload, status = 200) => ({ ok: status < 400, status, json: async () => payload, text: async () => JSON.stringify(payload) });
      if (rejectV2 && body.pack?.extractionVersion === STAGE3_EVIDENCE_V2) return reply({ ok: false, error: "pack_oversized" }, 413);
      if (body.action === "list_sheet_jobs") return reply({ ok: true, jobs });
      if (body.action === "sync_run_preprocess") return reply({ ok: true });
      if (body.action === "verify_pack") {
        const key = `${body.sheetJobId}|${body.extractionVersion || "phase3.stage3-visual-evidence.v1"}`;
        return stored.has(key) ? reply({ ok: true, objectPath: key, promptReady: true, packStatus: "evidence_recovered" }) : reply({ ok: false, found: false }, 404);
      }
      const key = `${body.sheetJobId}|${body.pack.extractionVersion}`;
      stored.set(key, body.pack);
      return reply({ ok: true, objectPath: key, bytes: 10 });
    };
    try {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      Object.assign(process.env, { SUPABASE_URL: "http://stub.local", STAGE3_WORKER_UPLOAD_TOKEN: "test-token", SUPABASE_ANON_KEY: "anon" });
      await mkdir(path.join(root, "packs"), { recursive: true });
      await mkdir(path.join(root, "packs-v2"), { recursive: true });
      const common = { sheetId: sheet.id, topic: "t", status: "evidence_recovered", promptBlock: "x", sourceFileSha256: sheet.sha256 };
      await writeFile(path.join(root, "packs", `${sheet.id}.${sheet.sha256}.json`), JSON.stringify({ ...common, extractionVersion: "phase3.stage3-visual-evidence.v1" }));
      const v2File = path.join(root, "packs-v2", `${sheet.id}.${sheet.sha256}.json`);
      await writeFile(v2File, JSON.stringify({ ...common, extractionVersion: STAGE3_EVIDENCE_V2 }));
      const args = { workerRoot: root, datasetOut, projectId: "p", runId: "r", live: true, maxSheets: 1 };

      const v2Run = await uploadAndVerifyFullSetPacks({ ...args, evidenceVersion: "v2" });
      assert.equal(v2Run.failed, 0);
      assert.equal(v2Run.v2.verified, 1);
      assert.ok(stored.has("job-0|phase3.stage3-visual-evidence.v1"));
      assert.ok(stored.has(`job-0|${STAGE3_EVIDENCE_V2}`));

      stored.clear();
      await rm(v2File);
      const missing = await uploadAndVerifyFullSetPacks({ ...args, evidenceVersion: "v2" });
      assert.equal(missing.failed, 0);
      assert.equal(missing.packRetrieved, 1);
      assert.equal(missing.v2.missingLocal, 1);

      stored.clear();
      await writeFile(v2File, JSON.stringify({ ...common, extractionVersion: STAGE3_EVIDENCE_V2 }));
      rejectV2 = true;
      const rejected = await uploadAndVerifyFullSetPacks({ ...args, evidenceVersion: "v2" });
      rejectV2 = false;
      assert.equal(rejected.failed, 0);
      assert.equal(rejected.packRetrieved, 1);
      assert.equal(rejected.v2.failed, 1);
      assert.equal(rejected.v2.results[0].status, "v2_upload_failed");
      assert.ok(stored.has("job-0|phase3.stage3-visual-evidence.v1"));
      assert.equal(stored.has(`job-0|${STAGE3_EVIDENCE_V2}`), false);

      stored.clear();
      requests.length = 0;
      const v1Run = await uploadAndVerifyFullSetPacks(args);
      assert.equal(v1Run.v2, undefined);
      assert.equal(requests.some((b) => b.extractionVersion || b.pack?.extractionVersion === STAGE3_EVIDENCE_V2), false);
    } finally {
      globalThis.fetch = saved.fetch;
      for (const key of Object.keys(process.env)) if (!(key in saved.env)) delete process.env[key];
      Object.assign(process.env, saved.env);
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("v2 analyzer block fixture", () => {
  it("matches the committed TS/mjs parity fixture", () => {
    const fixture = JSON.parse(readFileSync(path.join(here, "fixtures/stage3-v2-block.fixture.json"), "utf8"));
    for (const c of fixture.cases) {
      assert.equal(v2AnalyzerBlock(c.packs, c.status, c.notes), c.expected, c.name);
    }
  });
});
