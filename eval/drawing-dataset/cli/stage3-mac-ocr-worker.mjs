#!/usr/bin/env node
/**
 * Local Mac Stage 3 OCR worker CLI (pilot + full drawing set).
 * Writes only under gitignored eval/drawing-dataset/out/.
 *
 * Usage:
 *   node eval/drawing-dataset/cli/stage3-mac-ocr-worker.mjs enqueue [--pilot]
 *   node eval/drawing-dataset/cli/stage3-mac-ocr-worker.mjs enqueue-full [--run <uuid>] [--project <uuid>]
 *   node eval/drawing-dataset/cli/stage3-mac-ocr-worker.mjs once [--fresh-ocr] [--force]
 *   node eval/drawing-dataset/cli/stage3-mac-ocr-worker.mjs loop [--max N] [--concurrency 2] [--fresh-ocr]
 *   node eval/drawing-dataset/cli/stage3-mac-ocr-worker.mjs status [--run <uuid>]
 *   node eval/drawing-dataset/cli/stage3-mac-ocr-worker.mjs coverage [--run <uuid>]
 *   node eval/drawing-dataset/cli/stage3-mac-ocr-worker.mjs cancel [--run <uuid>]
 *   node eval/drawing-dataset/cli/stage3-mac-ocr-worker.mjs retry-sheet --sheet A-3.06-00.pdf [--run <uuid>]
 *   node eval/drawing-dataset/cli/stage3-mac-ocr-worker.mjs approve-partial [--run <uuid>]
 *   node eval/drawing-dataset/cli/stage3-mac-ocr-worker.mjs upload-packs --project <uuid> --run <uuid> [--full-set] [--live]
 *   node eval/drawing-dataset/cli/stage3-mac-ocr-worker.mjs sync-full-set --project <uuid> --run <uuid> [--live]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  cancelPendingJobs,
  enqueueFullSetJobs,
  enqueuePilotJobs,
  reconcileRunStateFromJobs,
  reportFullSetCoverage,
  resolveWorkerPaths,
  retrySheetJob,
  runWorkerLoop,
  runWorkerOnce,
  ensureWorkerDirs,
  PILOT_SHEETS,
  DEFAULT_WORKER_CONCURRENCY,
} from "../lib/stage3MacOcrWorker.mjs";
import {
  uploadLocalPackFile,
  buildStage3EvidenceObjectPath,
} from "../lib/stage3StorageUpload.mjs";
import { loadRunState, saveRunState } from "../lib/stage3OcrRunState.mjs";
import { syncRunPreprocessSummary } from "../lib/stage3WorkerSupabase.mjs";
import { uploadAndVerifyFullSetPacks } from "../lib/stage3FullSetUpload.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const datasetOut = path.resolve(root, "eval/drawing-dataset/out/mcd-649fdaa6");
const workerRoot = path.resolve(datasetOut, "stage3-mac-worker");
const defaultSource = process.env.DRAWING_SOURCE_DIR
  || path.resolve(datasetOut, "files");

const command = process.argv[2] || "status";
const freshOcr = process.argv.includes("--fresh-ocr");
const force = process.argv.includes("--force");
const pilotOnly = process.argv.includes("--pilot");
const syncSupabase = process.argv.includes("--sync-supabase");

const maxArg = process.argv.indexOf("--max");
const maxJobs = maxArg >= 0 ? Number(process.argv[maxArg + 1]) : 10;
const concurrencyArg = process.argv.indexOf("--concurrency");
const concurrency = concurrencyArg >= 0
  ? Number(process.argv[concurrencyArg + 1])
  : DEFAULT_WORKER_CONCURRENCY;

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

const runId = argValue("--run") || process.env.STAGE3_RUN_ID || null;
const projectId = argValue("--project") || process.env.STAGE3_PROJECT_ID || null;

const paths = resolveWorkerPaths(workerRoot);

if (command === "enqueue") {
  const result = await enqueuePilotJobs({
    rootDir: workerRoot,
    datasetOut,
    sourceDir: existsSync(defaultSource) ? defaultSource : null,
  });
  console.log(JSON.stringify({ workerRoot, mode: "pilot", enqueued: result }, null, 2));
  process.exit(0);
}

if (command === "enqueue-full") {
  const result = await enqueueFullSetJobs({
    rootDir: workerRoot,
    datasetOut,
    sourceDir: existsSync(defaultSource) ? defaultSource : null,
    projectId,
    runId: runId || "local-fullset-eval",
    syncSupabase,
  });
  console.log(JSON.stringify({
    workerRoot,
    pdfSheetCount: result.manifest.pdfSheetCount,
    discrepancyNote: result.manifest.discrepancyNote,
    enqueued: result.enqueued,
    runState: result.runState,
  }, null, 2));
  process.exit(0);
}

if (command === "once") {
  const result = await runWorkerOnce({
    rootDir: workerRoot,
    freshOcr,
    force,
    syncSupabase,
  });
  console.log(JSON.stringify({
    status: result.status,
    jobId: result.job?.id,
    packStatus: result.pack?.status,
    cacheHit: result.job?.cacheHit,
    detailIdentifier: result.pack?.detailIdentifier,
    sheetId: result.pack?.sheetId || result.job?.sheetId,
    error: result.error || null,
  }, null, 2));
  process.exit(result.status === "failed" ? 1 : 0);
}

if (command === "loop") {
  const results = await runWorkerLoop({
    rootDir: workerRoot,
    maxJobs,
    freshOcr,
    force,
    concurrency,
    syncSupabase,
    reconcileRunId: runId || "local-fullset-eval",
  });
  console.log(JSON.stringify({
    workerRoot,
    freshOcr,
    concurrency,
    results: results.map((item) => ({
      status: item.status,
      jobId: item.job?.id,
      packStatus: item.pack?.status,
      cacheHit: item.job?.cacheHit,
      sheetId: item.pack?.sheetId || item.job?.sheetId,
      error: item.error || null,
    })),
  }, null, 2));
  process.exit(results.some((item) => item.status === "failed") ? 1 : 0);
}

if (command === "reconcile-run") {
  const id = runId || "local-fullset-eval";
  const summary = await reconcileRunStateFromJobs(paths, id);
  console.log(JSON.stringify({ runId: id, summary }, null, 2));
  process.exit(0);
}

if (command === "coverage") {
  const report = await reportFullSetCoverage({
    rootDir: workerRoot,
    datasetOut,
    runId: runId || "local-fullset-eval",
  });
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.recorded === report.outcomes.length ? 0 : 1);
}

if (command === "cancel") {
  const cancelled = await cancelPendingJobs(paths, { runId: runId || "local-fullset-eval" });
  console.log(JSON.stringify({ cancelledCount: cancelled.length, cancelled }, null, 2));
  process.exit(0);
}

if (command === "retry-sheet") {
  const sheetPath = argValue("--sheet");
  if (!sheetPath) {
    console.error("--sheet <relativePath> required");
    process.exit(2);
  }
  const job = await retrySheetJob(paths, sheetPath, { runId: runId || "local-fullset-eval" });
  console.log(JSON.stringify({ retried: job.id, relativePath: sheetPath }, null, 2));
  process.exit(0);
}

if (command === "approve-partial") {
  const id = runId || "local-fullset-eval";
  const state = await loadRunState(workerRoot, id);
  if (!state) {
    console.error(`Run state not found: ${id}`);
    process.exit(2);
  }
  state.gateMode = "approved_partial";
  await saveRunState(workerRoot, state);
  if (syncSupabase) {
    await syncRunPreprocessSummary(state);
  }
  console.log(JSON.stringify({ runId: id, gateMode: state.gateMode }, null, 2));
  process.exit(0);
}

if (command === "status") {
  await ensureWorkerDirs(paths);
  const counts = {};
  for (const dir of ["pending", "claimed", "done", "failed"]) {
    const names = await readdir(paths[dir]);
    counts[dir] = names.filter((name) => name.endsWith(".json")).length;
  }
  const packNames = existsSync(paths.packs)
    ? (await readdir(paths.packs)).filter((name) => name.endsWith(".json"))
    : [];
  const packs = [];
  for (const name of packNames.slice(0, 20)) {
    const pack = JSON.parse(await readFile(path.join(paths.packs, name), "utf8"));
    packs.push({
      file: name,
      sheetId: pack.sheetId,
      status: pack.status,
      independentlyVerified: pack.independentlyVerified,
      cacheKey: pack.cacheKey,
    });
  }
  const runState = runId ? await loadRunState(workerRoot, runId) : null;
  console.log(JSON.stringify({
    workerRoot,
    counts,
    packCount: packNames.length,
    packsSample: packs,
    runState: runState ? {
      runId: runState.runId,
      gateMode: runState.gateMode,
      counts: runState.counts,
      requiredSheetCount: runState.requiredSheetCount,
    } : null,
  }, null, 2));
  process.exit(0);
}

if (command === "upload-packs" || command === "sync-full-set") {
  const projectIdx = process.argv.indexOf("--project");
  const runIdx = process.argv.indexOf("--run");
  const jobIdx = process.argv.indexOf("--sheet-job");
  const uploadProjectId = projectIdx >= 0 ? process.argv[projectIdx + 1] : projectId;
  const uploadRunId = runIdx >= 0 ? process.argv[runIdx + 1] : runId;
  const live = process.argv.includes("--live");
  const fullSet = command === "sync-full-set" || process.argv.includes("--full-set");
  const useMock = process.argv.includes("--storage-mock") || !live;
  const dryRun = process.argv.includes("--dry-run");

  if (fullSet) {
    if (!uploadProjectId || !uploadRunId) {
      console.error("Full-set sync requires --project <uuid> --run <uuid> (sheet-job IDs come from the live run).");
      process.exit(2);
    }
    if (live && !process.env.STAGE3_WORKER_UPLOAD_TOKEN) {
      const tokenFile = path.join(workerRoot, ".stage3_worker_upload_token");
      if (existsSync(tokenFile)) {
        process.env.STAGE3_WORKER_UPLOAD_TOKEN = (await readFile(tokenFile, "utf8")).trim();
      }
    }
    if (live && !process.env.STAGE3_WORKER_UPLOAD_TOKEN) {
      console.error("Live full-set sync fail-closed: STAGE3_WORKER_UPLOAD_TOKEN required.");
      process.exit(2);
    }
    if (live && !process.env.SUPABASE_URL) {
      process.env.SUPABASE_URL = process.env.VITE_SUPABASE_URL || "";
    }
    if (live && !process.env.SUPABASE_ANON_KEY) {
      process.env.SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || "";
    }
    const summary = await uploadAndVerifyFullSetPacks({
      workerRoot,
      datasetOut,
      projectId: uploadProjectId,
      runId: uploadRunId,
      live,
      dryRun: dryRun || !live,
      resume: !process.argv.includes("--no-resume"),
      syncSupabase: syncSupabase || live,
    });
    console.log(JSON.stringify({
      mode: live && !dryRun ? "edge_live_full_set" : "dry_run_or_association",
      ...summary,
      counts: {
        ocrProcessingCompleted: summary.ocrCompleted,
        packStored: summary.packStored,
        packRetrievedSuccessfully: summary.packRetrieved,
        technicalEvidencePromptReady: summary.promptReady,
      },
    }, null, 2));
    process.exit(summary.status === "ok" && (summary.failed || 0) === 0 ? 0 : 1);
  }

  const uploaded = [];

  if (live) {
    if (!uploadProjectId || !uploadRunId) {
      console.error("Live upload requires --project <uuid> --run <uuid> and per-sheet --sheet-job or env mapping.");
      process.exit(2);
    }
    if (!process.env.STAGE3_WORKER_UPLOAD_TOKEN) {
      console.error("Live upload fail-closed: STAGE3_WORKER_UPLOAD_TOKEN required (service-role fallback removed).");
      process.exit(2);
    }
  }

  const mockObjects = new Map();
  const storage = useMock
    ? {
      async upload(bucket, objectPath, bytes) {
        mockObjects.set(`${bucket}:${objectPath}`, bytes);
      },
    }
    : null;

  for (const sheet of PILOT_SHEETS) {
    const packPath = path.join(paths.packs, `${sheet.id}.${sheet.sha256}.json`);
    if (!existsSync(packPath)) {
      uploaded.push({ sheetId: sheet.id, status: "pack_missing" });
      continue;
    }
    const sheetJobId = jobIdx >= 0
      ? process.argv[jobIdx + 1]
      : `00000000-0000-4000-8000-${sheet.id.replace(/\D/g, "").padStart(12, "0").slice(-12)}`;
    if (live) {
      const result = await uploadLocalPackFile({
        viaEdge: true,
        packPath,
        projectId: uploadProjectId,
        runId: uploadRunId,
        sheetJobId,
        contentSha256: sheet.sha256,
      });
      uploaded.push({
        sheetId: sheet.id,
        status: "uploaded_edge",
        objectPath: result.objectPath,
        bytes: result.bytes,
        publicUrl: null,
        authMode: result.authMode,
      });
    } else {
      const result = await uploadLocalPackFile({
        storage,
        packPath,
        projectId: uploadProjectId || "00000000-0000-4000-8000-000000000001",
        runId: uploadRunId || "00000000-0000-4000-8000-000000000002",
        sheetJobId,
        contentSha256: sheet.sha256,
      });
      uploaded.push({
        sheetId: sheet.id,
        status: "uploaded_mock",
        objectPath: result.objectPath,
        bytes: result.bytes,
        expectedPath: buildStage3EvidenceObjectPath({
          projectId: uploadProjectId || "00000000-0000-4000-8000-000000000001",
          runId: uploadRunId || "00000000-0000-4000-8000-000000000002",
          sheetJobId,
          contentSha256: sheet.sha256,
        }),
        publicUrl: null,
      });
    }
  }
  console.log(JSON.stringify({
    mode: live ? "edge_live" : "mock_storage",
    projectId: uploadProjectId,
    runId: uploadRunId,
    mockObjectCount: useMock ? mockObjects.size : undefined,
    uploaded,
  }, null, 2));
  process.exit(0);
}

console.error(`Unknown command: ${command}`);
process.exit(2);
