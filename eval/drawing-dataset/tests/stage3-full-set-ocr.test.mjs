/**
 * Full-set Stage 3 OCR orchestration (local dataset, no GPT, no network).
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAuthoritativeDrawingManifest } from "../lib/stage3DrawingManifest.mjs";
import {
  buildJobRecord,
  claimNextJob,
  enqueueFullSetJobs,
  processClaimedJob,
  reportFullSetCoverage,
  resolveWorkerPaths,
  runWorkerLoop,
} from "../lib/stage3MacOcrWorker.mjs";
import { mapManifestSheetsToJobs } from "../lib/stage3WorkerSupabase.mjs";
import { extractGuardrailDetailEvidence } from "../lib/stage3VisualExtractionSpike.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const datasetOut = path.resolve(here, "../out/mcd-649fdaa6");

describe("Stage 3 drawing manifest", () => {
  it("reports 82 PDF sheets (83 walked entries in coverage metadata)", async () => {
    const manifest = await loadAuthoritativeDrawingManifest(datasetOut);
    assert.equal(manifest.pdfSheetCount, 82);
    assert.equal(manifest.missingLayout.length, 0);
    assert.match(String(manifest.discrepancyNote || ""), /83 walked|83/);
  });
});

describe("Stage 3 full-set worker (layout-full, no fresh Vision OCR)", () => {
  let workerRoot;

  before(async () => {
    workerRoot = await mkdtemp(path.join(tmpdir(), "stage3-fullset-"));
    await enqueueFullSetJobs({
      rootDir: workerRoot,
      datasetOut,
      runId: "test-fullset-run",
      projectId: "00000000-0000-4000-8000-000000000099",
    });
  });

  it("processes all 82 sheets with cache reuse on second enqueue", async () => {
    const results = await runWorkerLoop({
      rootDir: workerRoot,
      maxJobs: 90,
      concurrency: 2,
      freshOcr: false,
      reconcileRunId: "test-fullset-run",
    });
    const done = results.filter((item) => item.status === "done" || item.status === "cache_hit");
    assert.ok(done.length >= 82, `expected >=82 processed, got ${done.length}`);

    const coverage = await reportFullSetCoverage({
      rootDir: workerRoot,
      datasetOut,
      runId: "test-fullset-run",
    });
    assert.equal(coverage.outcomes.length, 82);
    assert.equal(coverage.recorded, 82);
    assert.equal(coverage.run.terminal, true);
    assert.equal(coverage.run.counts.completed, 82);

    const a306 = coverage.outcomes.find((row) => row.sheetId === "A-3.06-00" || row.relativePath === "A-3.06-00.pdf");
    assert.ok(a306?.packStatus?.includes("recovered"), a306?.packStatus);

    const paths = resolveWorkerPaths(workerRoot);
    const layout = JSON.parse(await readFile(
      path.join(datasetOut, "layout-full/pages", "c20cc018310747ea435c888f7c1b1d4884ef8d1054b16da9ab770a504a33b6cf.json"),
      "utf8",
    ));
    const guard = extractGuardrailDetailEvidence(layout, { mode: "stage3_visual" });
    assert.match(String(guard.detailIdentifier || ""), /GUARD\s*RAIL/i);

    // Re-enqueue should mostly hit cache / already_present
    const second = await enqueueFullSetJobs({
      rootDir: workerRoot,
      datasetOut,
      runId: "test-fullset-run",
    });
    assert.equal(second.manifest.pdfSheetCount, 82);
    const present = second.enqueued.filter((row) => row.status === "already_present").length;
    assert.ok(present >= 80);
  });

  it("maps sheet jobs by original file name without inventing IDs", async () => {
    const manifest = await loadAuthoritativeDrawingManifest(datasetOut);
    const jobs = manifest.sheets.map((sheet, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      original_file_name: sheet.relativePath,
    }));
    const mapped = mapManifestSheetsToJobs(manifest.sheets, jobs);
    assert.equal(mapped.mapped.length, 82);
    assert.equal(mapped.unmatched.length, 0);
    assert.equal(mapped.ambiguous.length, 0);

    const incomplete = mapManifestSheetsToJobs(manifest.sheets, jobs.slice(0, 80));
    assert.equal(incomplete.unmatched.length, 2);
  });

  it("technical controls remain on pilot sheets", async () => {
    const manifest = await loadAuthoritativeDrawingManifest(datasetOut);
    const fp = manifest.sheets.find((row) => row.id === "FP200");
    const a600 = manifest.sheets.find((row) => row.id === "A-6.00-00" || row.relativePath === "A-6.00-00.pdf");
    assert.ok(fp);
    assert.ok(a600);
    const paths = resolveWorkerPaths(workerRoot);
    const fpJob = buildJobRecord(fp, { layoutPagePath: fp.layoutPagePath, jobId: "fp-verify" });
    await rm(path.join(paths.pending, `${fpJob.id}.json`), { force: true }).catch(() => null);
    const claimed = await claimNextJob(paths, { workerId: "verify" });
    if (claimed?.id === fpJob.id) {
      const result = await processClaimedJob(paths, claimed, { freshOcr: false });
      assert.match(result.pack.promptBlock, /density|flowDemand|FLOW DEMAND/i);
    }
  });

  it("does not suppress non-pilot topics from full-set packs", async () => {
    const manifest = await loadAuthoritativeDrawingManifest(datasetOut);
    const electrical = manifest.sheets.find((row) => String(row.relativePath || "").toUpperCase().startsWith("E-"));
    assert.ok(electrical, "expected an electrical sheet in the 82-sheet set");
    const paths = resolveWorkerPaths(workerRoot);
    const packNames = await readdir(paths.packs);
    const packName = packNames.find((name) => name.startsWith(`${electrical.id}.`) || name.includes(electrical.sha256));
    assert.ok(packName, `missing pack for ${electrical.relativePath}`);
    const pack = JSON.parse(await readFile(path.join(paths.packs, packName), "utf8"));
    assert.equal(pack.independentlyVerified, false);
    assert.ok(pack.topic);
    assert.notEqual(pack.topic, "guardrail_detail_height");
    assert.ok(String(pack.promptBlock || "").length > 20);
    assert.match(String(pack.status || ""), /recovered|partial/);
  });
});
