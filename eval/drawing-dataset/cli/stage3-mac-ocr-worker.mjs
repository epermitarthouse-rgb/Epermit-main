#!/usr/bin/env node
/**
 * Local Mac Stage 3 OCR worker CLI (pilot).
 * Writes only under gitignored eval/drawing-dataset/out/.
 *
 * Usage:
 *   node eval/drawing-dataset/cli/stage3-mac-ocr-worker.mjs enqueue
 *   node eval/drawing-dataset/cli/stage3-mac-ocr-worker.mjs once [--fresh-ocr]
 *   node eval/drawing-dataset/cli/stage3-mac-ocr-worker.mjs loop [--max N] [--fresh-ocr]
 *   node eval/drawing-dataset/cli/stage3-mac-ocr-worker.mjs status
 *   node eval/drawing-dataset/cli/stage3-mac-ocr-worker.mjs upload-packs --project <uuid> --run <uuid>
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  enqueuePilotJobs,
  resolveWorkerPaths,
  runWorkerLoop,
  runWorkerOnce,
  ensureWorkerDirs,
  PILOT_SHEETS,
} from "../lib/stage3MacOcrWorker.mjs";
import {
  uploadLocalPackFile,
  buildStage3EvidenceObjectPath,
} from "../lib/stage3StorageUpload.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const datasetOut = path.resolve(root, "eval/drawing-dataset/out/mcd-649fdaa6");
const workerRoot = path.resolve(datasetOut, "stage3-mac-worker");
const defaultSource = process.env.DRAWING_SOURCE_DIR
  || path.resolve(datasetOut, "phase3-ocr-compare/source-subset");

const command = process.argv[2] || "status";
const freshOcr = process.argv.includes("--fresh-ocr");
const force = process.argv.includes("--force");
const maxArg = process.argv.indexOf("--max");
const maxJobs = maxArg >= 0 ? Number(process.argv[maxArg + 1]) : 10;

const paths = resolveWorkerPaths(workerRoot);

if (command === "enqueue") {
  const result = await enqueuePilotJobs({
    rootDir: workerRoot,
    datasetOut,
    sourceDir: existsSync(defaultSource) ? defaultSource : null,
  });
  console.log(JSON.stringify({ workerRoot, enqueued: result }, null, 2));
  process.exit(0);
}

if (command === "once") {
  const result = await runWorkerOnce({
    rootDir: workerRoot,
    freshOcr,
    force,
  });
  console.log(JSON.stringify({
    status: result.status,
    jobId: result.job?.id,
    packStatus: result.pack?.status,
    cacheHit: result.job?.cacheHit,
    detailIdentifier: result.pack?.detailIdentifier,
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
  });
  console.log(JSON.stringify({
    workerRoot,
    freshOcr,
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
  for (const name of packNames) {
    const pack = JSON.parse(await readFile(path.join(paths.packs, name), "utf8"));
    packs.push({
      file: name,
      sheetId: pack.sheetId,
      status: pack.status,
      detailIdentifier: pack.detailIdentifier,
      independentlyVerified: pack.independentlyVerified,
      cacheKey: pack.cacheKey,
    });
  }
  console.log(JSON.stringify({ workerRoot, counts, packs }, null, 2));
  process.exit(0);
}

if (command === "upload-packs") {
  const projectIdx = process.argv.indexOf("--project");
  const runIdx = process.argv.indexOf("--run");
  const jobIdx = process.argv.indexOf("--sheet-job");
  const projectId = projectIdx >= 0 ? process.argv[projectIdx + 1] : null;
  const runId = runIdx >= 0 ? process.argv[runIdx + 1] : null;
  const live = process.argv.includes("--live");
  const useMock = process.argv.includes("--storage-mock") || !live;

  const uploaded = [];

  if (live) {
    if (!projectId || !runId) {
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
        projectId,
        runId,
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
        projectId: projectId || "00000000-0000-4000-8000-000000000001",
        runId: runId || "00000000-0000-4000-8000-000000000002",
        sheetJobId,
        contentSha256: sheet.sha256,
      });
      uploaded.push({
        sheetId: sheet.id,
        status: "uploaded_mock",
        objectPath: result.objectPath,
        bytes: result.bytes,
        expectedPath: buildStage3EvidenceObjectPath({
          projectId: projectId || "00000000-0000-4000-8000-000000000001",
          runId: runId || "00000000-0000-4000-8000-000000000002",
          sheetJobId,
          contentSha256: sheet.sha256,
        }),
        publicUrl: null,
      });
    }
  }
  console.log(JSON.stringify({
    mode: live ? "edge_live" : "mock_storage",
    projectId,
    runId,
    mockObjectCount: useMock ? mockObjects.size : undefined,
    uploaded,
  }, null, 2));
  process.exit(0);
}

console.error(`Unknown command: ${command}`);
process.exit(2);
