/**
 * Stage 3 Mac OCR worker (local pilot).
 *
 * Outbound-only / local file job queue — no public endpoint, no production
 * migration required. Claims jobs atomically via rename. Reuses Phase 2A
 * Vision OCR + Stage 3 extractors. Caches packs by drawing SHA-256 + method +
 * version. Customer PDFs/OCR/crops stay under gitignored out/.
 *
 * independentlyVerified is always false.
 */
import { createHash } from "node:crypto";
import { existsSync, renameSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { recoverPdfFile } from "./ocrRecover.mjs";
import { associateBlocksToRegions } from "./layoutAssociate.mjs";
import {
  STAGE3_SPIKE_VERSION,
  extractGuardrailDetailEvidence,
  extractDoorScheduleEvidence,
  extractHydraulicEvidence,
  formatStage3PromptBlock,
  evaluateCriticalControls,
} from "./stage3VisualExtractionSpike.mjs";
import { PILOT_SHEETS } from "./visualEvidencePilot.mjs";
import { uploadStage3PackToStorage, uploadStage3PackViaEdge } from "./stage3StorageUpload.mjs";
import {
  loadAuthoritativeDrawingManifest,
  resolvePdfPath,
} from "./stage3DrawingManifest.mjs";
import {
  extractGenericSheetEvidence,
  formatGenericStage3PromptBlock,
  inferSheetTopic,
} from "./stage3GenericSheetEvidence.mjs";
import {
  defaultRunState,
  initRunSheets,
  loadRunState,
  saveRunState,
  setSheetStatus,
  summarizeRunState,
} from "./stage3OcrRunState.mjs";
import { syncRunPreprocessSummary } from "./stage3WorkerSupabase.mjs";

async function maybeUploadPack(storage, job, pack) {
  if (!storage || !job.projectId || !job.runId || !job.sheetJobId) return null;
  if (typeof storage.edgeUpload === "function") {
    return storage.edgeUpload({
      pack,
      projectId: job.projectId,
      runId: job.runId,
      sheetJobId: job.sheetJobId,
      contentSha256: job.contentSha256,
    });
  }
  if (storage.viaEdge) {
    return uploadStage3PackViaEdge({
      pack,
      projectId: job.projectId,
      runId: job.runId,
      sheetJobId: job.sheetJobId,
      contentSha256: job.contentSha256,
      fetchImpl: storage.fetchImpl,
      supabaseUrl: storage.supabaseUrl,
      workerToken: storage.workerToken,
      anonKey: storage.anonKey,
    });
  }
  return uploadStage3PackToStorage({
    storage,
    pack,
    projectId: job.projectId,
    runId: job.runId,
    sheetJobId: job.sheetJobId,
    contentSha256: job.contentSha256,
  });
}

export const STAGE3_WORKER_VERSION = "phase3.stage3-mac-ocr-worker.v2-fullset";
export const DEFAULT_WORKER_CONCURRENCY = 2;
export const STAGE3_EXTRACTION_METHOD = "macos-vision";
/** Align cache version with analyzer Stage 3 module. */
export const STAGE3_EXTRACTION_VERSION = "phase3.stage3-visual-evidence.v1";

export const DEFAULT_LEASE_MS = 15 * 60 * 1000;
export const TARGET_SHEET_IDS = new Set(["A-3.06", "A-6.00", "FP200"]);

function cacheKey(sha256, method = STAGE3_EXTRACTION_METHOD, version = STAGE3_EXTRACTION_VERSION) {
  return `${sha256}.${method}.${version}`;
}

function workerId() {
  return `mac-${process.pid}-${createHash("sha1").update(String(Date.now())).digest("hex").slice(0, 8)}`;
}

export function resolveWorkerPaths(rootDir) {
  const root = path.resolve(rootDir);
  return {
    root,
    pending: path.join(root, "jobs", "pending"),
    claimed: path.join(root, "jobs", "claimed"),
    done: path.join(root, "jobs", "done"),
    failed: path.join(root, "jobs", "failed"),
    cache: path.join(root, "cache"),
    packs: path.join(root, "packs"),
    audit: path.join(root, "audit.jsonl"),
  };
}

export async function ensureWorkerDirs(paths) {
  for (const dir of [paths.pending, paths.claimed, paths.done, paths.failed, paths.cache, paths.packs]) {
    await mkdir(dir, { recursive: true });
  }
}

async function appendAudit(paths, event) {
  const line = JSON.stringify({
    at: new Date().toISOString(),
    workerVersion: STAGE3_WORKER_VERSION,
    independentlyVerified: false,
    ...event,
  });
  await writeFile(paths.audit, `${line}\n`, { flag: "a" });
}

export function buildJobRecord(sheet, options = {}) {
  const id = options.jobId
    || createHash("sha1").update(`${sheet.sha256}|${sheet.id}|${STAGE3_EXTRACTION_VERSION}`).digest("hex").slice(0, 16);
  return {
    id,
    sheetId: sheet.id,
    relativePath: sheet.relativePath,
    contentSha256: sheet.sha256,
    pdfPath: options.pdfPath || null,
    layoutPagePath: options.layoutPagePath || null,
    // Optional Supabase identity for Storage bridge upload (not required for local cache).
    projectId: options.projectId || null,
    runId: options.runId || null,
    sheetJobId: options.sheetJobId || id,
    topic: inferSheetTopic(sheet.id),
    extractionMethod: STAGE3_EXTRACTION_METHOD,
    extractionVersion: STAGE3_EXTRACTION_VERSION,
    status: "pending",
    attempts: 0,
    maxAttempts: options.maxAttempts ?? 3,
    createdAt: new Date().toISOString(),
    independentlyVerified: false,
  };
}

export async function enqueueJobs(paths, jobs) {
  await ensureWorkerDirs(paths);
  const enqueued = [];
  for (const job of jobs) {
    const donePath = path.join(paths.done, `${job.id}.json`);
    const pendingPath = path.join(paths.pending, `${job.id}.json`);
    const claimedPath = path.join(paths.claimed, `${job.id}.json`);
    if (existsSync(donePath) || existsSync(pendingPath) || existsSync(claimedPath)) {
      enqueued.push({ id: job.id, status: "already_present" });
      continue;
    }
    await writeFile(pendingPath, JSON.stringify(job, null, 2));
    enqueued.push({ id: job.id, status: "enqueued" });
  }
  await appendAudit(paths, { event: "enqueue", jobs: enqueued });
  return enqueued;
}

/**
 * Atomic claim: rename pending → claimed. Returns null if none available.
 * Expired claimed leases are reclaimed into pending.
 */
export async function claimNextJob(paths, options = {}) {
  await ensureWorkerDirs(paths);
  const id = options.workerId || workerId();
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const now = Date.now();

  // Requeue expired claims
  for (const name of await readdir(paths.claimed)) {
    if (!name.endsWith(".json")) continue;
    const claimedPath = path.join(paths.claimed, name);
    try {
      const job = JSON.parse(await readFile(claimedPath, "utf8"));
      if (job.leaseExpiresAt && Date.parse(job.leaseExpiresAt) < now) {
        const pendingPath = path.join(paths.pending, name);
        job.status = "pending";
        job.leaseExpired = true;
        delete job.claimedBy;
        delete job.leaseExpiresAt;
        await writeFile(claimedPath, JSON.stringify(job, null, 2));
        renameSync(claimedPath, pendingPath);
        await appendAudit(paths, { event: "lease_expired_requeue", jobId: job.id });
      }
    } catch {
      // ignore corrupt claim files
    }
  }

  const pending = (await readdir(paths.pending)).filter((name) => name.endsWith(".json")).sort();
  for (const name of pending) {
    const pendingPath = path.join(paths.pending, name);
    const claimedPath = path.join(paths.claimed, name);
    try {
      renameSync(pendingPath, claimedPath);
    } catch {
      continue; // raced
    }
    const job = JSON.parse(await readFile(claimedPath, "utf8"));
    job.status = "claimed";
    job.claimedBy = id;
    job.claimedAt = new Date().toISOString();
    job.leaseExpiresAt = new Date(now + leaseMs).toISOString();
    job.attempts = Number(job.attempts || 0) + 1;
    await writeFile(claimedPath, JSON.stringify(job, null, 2));
    await appendAudit(paths, { event: "claim", jobId: job.id, workerId: id, attempt: job.attempts });
    return job;
  }
  return null;
}

export async function readCachePack(paths, sha256) {
  const key = cacheKey(sha256);
  const cachePath = path.join(paths.cache, `${key}.json`);
  if (!existsSync(cachePath)) return null;
  return JSON.parse(await readFile(cachePath, "utf8"));
}

function rebuildAssociationsFromFreshOcr(cachedLayout, recovered) {
  const regions = cachedLayout.regions || [];
  const textBlocks = (cachedLayout.associations || [])
    .filter((item) => item.origin !== "visual_interpretation" && item.blockKind !== "ocr_line")
    .map((item) => ({
      kind: item.blockKind || "text_span",
      text: item.text,
      bbox: item.bbox,
      origin: item.origin || "machine_extracted",
      extractionMethod: item.extractionMethod || "pdfjs-text-layer",
      independentlyVerified: false,
    }));
  const ocrBlocks = [];
  for (const page of recovered.pages || []) {
    for (const line of page.lines || []) {
      if (!line?.text || !line?.box) continue;
      ocrBlocks.push({
        kind: "ocr_line",
        text: line.text,
        bbox: {
          x: line.box.x,
          y: line.box.y,
          width: line.box.width,
          height: line.box.height,
          unit: "pdf-point",
          origin: "bottom-left",
        },
        origin: "visual_interpretation",
        extractionMethod: page.engine || STAGE3_EXTRACTION_METHOD,
        independentlyVerified: false,
      });
    }
  }
  return {
    ...cachedLayout,
    associations: associateBlocksToRegions([...textBlocks, ...ocrBlocks], regions),
  };
}

function normalizePilotSheetId(sheetId) {
  const id = String(sheetId || "").toUpperCase();
  if (id.startsWith("A-3.06")) return "A-3.06";
  if (id.startsWith("A-6.00")) return "A-6.00";
  if (id === "FP200" || id.startsWith("FP200")) return "FP200";
  return null;
}

function extractForSheet(sheetId, layout) {
  const pilotKey = normalizePilotSheetId(sheetId);
  if (pilotKey === "A-3.06") return extractGuardrailDetailEvidence(layout, { mode: "stage3_visual" });
  if (pilotKey === "A-6.00") return extractDoorScheduleEvidence(layout, { mode: "stage3_visual" });
  if (pilotKey === "FP200") return extractHydraulicEvidence(layout, { mode: "stage3_visual" });
  return extractGenericSheetEvidence(layout, { sheetId, topic: inferSheetTopic(sheetId) });
}

/**
 * Process one claimed job. Uses cache when SHA+version match.
 * Prefer fresh Vision OCR when pdfPath present; else layout-full associations.
 */
export async function processClaimedJob(paths, job, options = {}) {
  const started = Date.now();
  const key = cacheKey(job.contentSha256, job.extractionMethod, job.extractionVersion);
  const cachePath = path.join(paths.cache, `${key}.json`);

  await touchRunStateForJob(paths, job, { status: "processing", cacheKey: key });

  if (!options.force && !job.forceRetry && existsSync(cachePath)) {
    const cached = JSON.parse(await readFile(cachePath, "utf8"));
    const packPath = path.join(paths.packs, `${job.sheetId}.${job.contentSha256}.json`);
    await writeFile(packPath, JSON.stringify(cached, null, 2));
    let storageUpload = null;
    if (options.storage && job.projectId && job.runId && job.sheetJobId) {
      try {
        storageUpload = await maybeUploadPack(options.storage, job, cached);
      } catch (uploadError) {
        storageUpload = {
          status: "failed",
          error: uploadError instanceof Error ? uploadError.message : String(uploadError),
        };
      }
    }
    const doneJob = {
      ...job,
      status: "done",
      completedAt: new Date().toISOString(),
      cacheHit: true,
      packPath,
      latencyMs: Date.now() - started,
      storageUpload,
    };
    await writeFile(path.join(paths.done, `${job.id}.json`), JSON.stringify(doneJob, null, 2));
    try {
      await unlink(path.join(paths.claimed, `${job.id}.json`));
    } catch {
      // already moved
    }
    await appendAudit(paths, { event: "cache_hit", jobId: job.id, cacheKey: key });
    await touchRunStateForJob(paths, job, {
      status: "completed",
      cacheKey: key,
      packStatus: cached.status,
      sheetJobId: job.sheetJobId || null,
    });
    if (options.syncSupabase && job.runId) {
      const state = await loadRunState(paths.root, job.runId);
      if (state) await syncRunPreprocessSummary(state, options).catch(() => null);
    }
    return { status: "cache_hit", pack: cached, job: doneJob };
  }

  let layout = null;
  const layoutPath = job.layoutPagePath;
  if (layoutPath && existsSync(layoutPath)) {
    layout = JSON.parse(await readFile(layoutPath, "utf8"));
  }

  let ocrMeta = { engine: null, freshOcr: false, ocrChars: 0 };
  if (job.pdfPath && existsSync(job.pdfPath) && options.freshOcr !== false) {
    const recovered = await recoverPdfFile(job.pdfPath, {});
    ocrMeta = {
      engine: recovered.pages?.[0]?.engine || STAGE3_EXTRACTION_METHOD,
      freshOcr: true,
      ocrChars: (recovered.pages || []).reduce((sum, page) => sum + (page.ocrChars || 0), 0),
    };
    if (!layout) {
      throw new Error("layout_page_required_for_fresh_ocr_association");
    }
    layout = rebuildAssociationsFromFreshOcr(layout, recovered);
  } else if (!layout) {
    throw new Error("layout_or_pdf_required");
  }

  const stage3 = extractForSheet(job.sheetId, layout);
  stage3.promptBlock = formatStage3PromptBlock(stage3);
  stage3.sheetId = job.sheetId;
  stage3.relativePath = job.relativePath;
  stage3.sourceFileSha256 = job.contentSha256;
  stage3.spikeVersion = STAGE3_SPIKE_VERSION;
  stage3.extractionMethod = STAGE3_EXTRACTION_METHOD;
  stage3.extractionVersion = STAGE3_EXTRACTION_VERSION;
  stage3.cacheKey = key;
  stage3.workerVersion = STAGE3_WORKER_VERSION;
  stage3.ocrMeta = ocrMeta;
  stage3.independentlyVerified = false;
  stage3.provenance = {
    ...(stage3.provenance || {}),
    independentlyVerified: false,
    extractionMethod: STAGE3_EXTRACTION_METHOD,
    cacheKey: key,
  };
  if (normalizePilotSheetId(job.sheetId) === "A-6.00") {
    stage3.criticalControls = evaluateCriticalControls(stage3);
  }
  stage3.promptBlock = stage3.promptBlock
    || formatStage3PromptBlock(stage3)
    || formatGenericStage3PromptBlock(stage3);

  const envelope = {
    id: stage3.id,
    sheetId: job.sheetId,
    topic: stage3.topic,
    status: stage3.status,
    promptBlock: stage3.promptBlock,
    extractedTexts: stage3.extractedTexts || [],
    detailIdentifier: stage3.detailIdentifier || stage3.assessment?.detailIdentifier || null,
    bbox: stage3.bbox || null,
    assessment: stage3.assessment || null,
    provenance: stage3.provenance,
    sourceFileSha256: job.contentSha256,
    extractionVersion: STAGE3_EXTRACTION_VERSION,
    extractionMethod: STAGE3_EXTRACTION_METHOD,
    cacheKey: key,
    independentlyVerified: false,
    limitations: stage3.limitations || [],
    hits: stage3.hits || null,
    criticalControls: stage3.criticalControls || null,
    ocrMeta,
    generatedAt: new Date().toISOString(),
    workerVersion: STAGE3_WORKER_VERSION,
  };

  await writeFile(cachePath, JSON.stringify(envelope, null, 2));
  const packPath = path.join(paths.packs, `${job.sheetId}.${job.contentSha256}.json`);
  await writeFile(packPath, JSON.stringify(envelope, null, 2));

  let storageUpload = null;
  if (options.storage && job.projectId && job.runId && job.sheetJobId) {
    try {
      storageUpload = await maybeUploadPack(options.storage, job, envelope);
      await appendAudit(paths, {
        event: "storage_upload",
        jobId: job.id,
        objectPath: storageUpload.objectPath,
        bytes: storageUpload.bytes,
        publicUrl: null,
      });
    } catch (uploadError) {
      // Local cache still succeeds; Storage miss fails open on analyzer side.
      storageUpload = {
        status: "failed",
        error: uploadError instanceof Error ? uploadError.message : String(uploadError),
      };
      await appendAudit(paths, {
        event: "storage_upload_failed",
        jobId: job.id,
        error: String(storageUpload.error).slice(0, 240),
      });
    }
  }

  const doneJob = {
    ...job,
    status: "done",
    completedAt: new Date().toISOString(),
    cacheHit: false,
    packPath,
    cacheKey: key,
    latencyMs: Date.now() - started,
    packStatus: envelope.status,
    storageUpload,
  };
  await writeFile(path.join(paths.done, `${job.id}.json`), JSON.stringify(doneJob, null, 2));
  try {
    await unlink(path.join(paths.claimed, `${job.id}.json`));
  } catch {
    // ignore
  }
  await appendAudit(paths, {
    event: "done",
    jobId: job.id,
    cacheKey: key,
    packStatus: envelope.status,
    freshOcr: ocrMeta.freshOcr,
    latencyMs: doneJob.latencyMs,
    storageUploaded: Boolean(storageUpload && !storageUpload.error),
  });
  await touchRunStateForJob(paths, job, {
    status: "completed",
    cacheKey: key,
    packStatus: envelope.status,
    sheetJobId: job.sheetJobId || null,
  });
  if (options.syncSupabase && job.runId) {
    const state = await loadRunState(paths.root, job.runId);
    if (state) await syncRunPreprocessSummary(state, options).catch(() => null);
  }
  return { status: "done", pack: envelope, job: doneJob };
}

export async function failClaimedJob(paths, job, error) {
  const message = error instanceof Error ? error.message : String(error);
  const failedJob = {
    ...job,
    status: "failed",
    failedAt: new Date().toISOString(),
    lastError: message.slice(0, 500),
  };
  const retry = Number(job.attempts || 0) < Number(job.maxAttempts || 3);
  if (retry) {
    failedJob.status = "pending";
    delete failedJob.claimedBy;
    delete failedJob.leaseExpiresAt;
    await writeFile(path.join(paths.pending, `${job.id}.json`), JSON.stringify(failedJob, null, 2));
  } else {
    await writeFile(path.join(paths.failed, `${job.id}.json`), JSON.stringify(failedJob, null, 2));
  }
  try {
    await unlink(path.join(paths.claimed, `${job.id}.json`));
  } catch {
    // ignore
  }
  await appendAudit(paths, {
    event: retry ? "retry_requeue" : "failed",
    jobId: job.id,
    error: message.slice(0, 240),
  });
  if (!retry) {
    await touchRunStateForJob(paths, job, {
      status: "failed",
      lastError: message.slice(0, 240),
    });
  }
  return failedJob;
}

/**
 * Load completed packs for analyzer deps (Node/local). Never blocks on OCR.
 */
export async function loadCompletedPacksFromWorkerRoot(rootDir, ctx = {}) {
  const paths = resolveWorkerPaths(rootDir);
  const sha = ctx.contentSha256;
  if (sha) {
    const cached = await readCachePack(paths, sha);
    if (cached) {
      if (cached.extractionVersion && cached.extractionVersion !== STAGE3_EXTRACTION_VERSION) {
        return [{ ...cached, status: "stale" }];
      }
      return [cached];
    }
    // Also check packs dir
    const names = existsSync(paths.packs) ? await readdir(paths.packs) : [];
    for (const name of names) {
      if (!name.includes(sha)) continue;
      const pack = JSON.parse(await readFile(path.join(paths.packs, name), "utf8"));
      if (pack.extractionVersion && pack.extractionVersion !== STAGE3_EXTRACTION_VERSION) {
        return [{ ...pack, status: "stale" }];
      }
      return [pack];
    }
  }
  return [];
}

export async function enqueueFullSetJobs(options = {}) {
  const paths = resolveWorkerPaths(options.rootDir);
  await ensureWorkerDirs(paths);
  const manifest = await loadAuthoritativeDrawingManifest(options.datasetOut);
  if (manifest.missingLayout.length) {
    throw new Error(`layout_pages_missing:${manifest.missingLayout.length}`);
  }
  const sourceDir = options.sourceDir || manifest.sourceFilesDir;
  const jobs = [];
  for (const sheet of manifest.sheets) {
    jobs.push(buildJobRecord(sheet, {
      pdfPath: resolvePdfPath(manifest, sheet, { sourceDir, fallbackSourceDir: options.fallbackSourceDir }),
      layoutPagePath: sheet.layoutPagePath,
      projectId: options.projectId || null,
      runId: options.runId || null,
      sheetJobId: options.sheetJobMap?.[sheet.relativePath] || null,
    }));
  }

  let runState = options.runId
    ? (await loadRunState(options.rootDir, options.runId)) || defaultRunState({
      projectId: options.projectId,
      runId: options.runId,
      requiredSheetCount: manifest.pdfSheetCount,
    })
    : null;
  if (runState) {
    initRunSheets(runState, manifest.sheets, options.sheetJobMap || {});
    runState.macWorkerLastHeartbeat = new Date().toISOString();
    await saveRunState(options.rootDir, runState);
    if (options.syncSupabase) {
      try {
        await syncRunPreprocessSummary(runState, options);
      } catch (error) {
        await appendAudit(paths, {
          event: "run_preprocess_sync_failed",
          runId: runState.runId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const enqueued = await enqueueJobs(paths, jobs);
  await appendAudit(paths, {
    event: "enqueue_full_set",
    sheetCount: manifest.pdfSheetCount,
    inventoryNote: manifest.discrepancyNote,
    runId: options.runId || null,
  });
  return { manifest, enqueued, runState: runState ? summarizeRunState(runState) : null };
}

export async function cancelPendingJobs(paths, options = {}) {
  await ensureWorkerDirs(paths);
  const cancelled = [];
  for (const name of await readdir(paths.pending)) {
    if (!name.endsWith(".json")) continue;
    const pendingPath = path.join(paths.pending, name);
    const job = JSON.parse(await readFile(pendingPath, "utf8"));
    job.status = "cancelled";
    job.cancelledAt = new Date().toISOString();
    await writeFile(path.join(paths.failed, name.replace(".json", ".cancelled.json")), JSON.stringify(job, null, 2));
    await unlink(pendingPath);
    cancelled.push(job.id);
  }
  if (options.runId) {
    const state = await loadRunState(workerPathsRoot(paths), options.runId);
    if (state) {
      state.cancelled = true;
      state.gateMode = "blocking";
      for (const row of Object.values(state.sheets)) {
        if (row.status === "pending") row.status = "skipped";
      }
      await saveRunState(workerPathsRoot(paths), state);
    }
  }
  await appendAudit(paths, { event: "cancel_pending", count: cancelled.length, runId: options.runId || null });
  return cancelled;
}

export async function retrySheetJob(paths, relativePath, options = {}) {
  const state = options.runId ? await loadRunState(workerPathsRoot(paths), options.runId) : null;
  const doneNames = await readdir(paths.done);
  for (const name of doneNames) {
    if (!name.endsWith(".json")) continue;
    const job = JSON.parse(await readFile(path.join(paths.done, name), "utf8"));
    if (job.relativePath !== relativePath) continue;
    const retryJob = {
      ...job,
      id: `${job.id}-retry-${Date.now().toString(36).slice(-6)}`,
      status: "pending",
      attempts: 0,
      forceRetry: true,
    };
    delete retryJob.completedAt;
    delete retryJob.cacheHit;
    await writeFile(path.join(paths.pending, `${retryJob.id}.json`), JSON.stringify(retryJob, null, 2));
    if (state) {
      setSheetStatus(state, relativePath, { status: "pending", lastError: null });
      await saveRunState(workerPathsRoot(paths), state);
    }
    return retryJob;
  }
  throw new Error(`retry_sheet_not_found:${relativePath}`);
}

async function touchRunStateForJob(paths, job, patch) {
  if (!job.runId || !job.relativePath) return;
  const state = await loadRunState(paths.root, job.runId);
  if (!state) return;
  setSheetStatus(state, job.relativePath, patch);
  state.macWorkerLastHeartbeat = new Date().toISOString();
  await saveRunState(paths.root, state);
}

function workerPathsRoot(paths) {
  return paths.root;
}

export async function enqueuePilotJobs(options = {}) {
  const paths = resolveWorkerPaths(options.rootDir);
  await ensureWorkerDirs(paths);
  const datasetOut = options.datasetOut;
  const sourceDir = options.sourceDir;
  const jobs = [];
  for (const sheet of PILOT_SHEETS) {
    if (!TARGET_SHEET_IDS.has(sheet.id)) continue;
    jobs.push(buildJobRecord(sheet, {
      pdfPath: sourceDir ? path.join(sourceDir, sheet.relativePath) : null,
      layoutPagePath: datasetOut
        ? path.join(datasetOut, "layout-full", "pages", `${sheet.sha256}.json`)
        : null,
    }));
  }
  return enqueueJobs(paths, jobs);
}

export async function runWorkerOnce(options = {}) {
  const paths = resolveWorkerPaths(options.rootDir);
  const job = await claimNextJob(paths, {
    workerId: options.workerId,
    leaseMs: options.leaseMs,
  });
  if (!job) return { status: "idle" };
  try {
    return await processClaimedJob(paths, job, {
      force: options.force,
      freshOcr: options.freshOcr,
    });
  } catch (error) {
    await failClaimedJob(paths, job, error);
    return { status: "failed", error: error instanceof Error ? error.message : String(error), job };
  }
}

export async function reconcileRunStateFromJobs(paths, runId) {
  const state = await loadRunState(paths.root, runId);
  if (!state) return null;
  for (const dir of ["done", "failed"]) {
    const names = existsSync(paths[dir]) ? await readdir(paths[dir]) : [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const job = JSON.parse(await readFile(path.join(paths[dir], name), "utf8"));
      if (!job.relativePath) continue;
      const row = state.sheets[job.relativePath];
      if (!row) continue;
      if (dir === "done") {
        row.status = "completed";
        row.packStatus = job.packStatus || row.packStatus;
        row.cacheKey = job.cacheKey || row.cacheKey;
        row.sheetJobId = job.sheetJobId || row.sheetJobId;
      } else if (job.status === "failed") {
        row.status = "failed";
        row.lastError = job.lastError || row.lastError;
      }
    }
  }
  state.macWorkerLastHeartbeat = new Date().toISOString();
  await saveRunState(paths.root, state);
  return summarizeRunState(state);
}

export async function runWorkerLoop(options = {}) {
  const paths = resolveWorkerPaths(options.rootDir);
  await ensureWorkerDirs(paths);
  const maxJobs = options.maxJobs ?? 10;
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 1, DEFAULT_WORKER_CONCURRENCY));
  if (concurrency === 1) {
    const results = [];
    for (let index = 0; index < maxJobs; index += 1) {
      const result = await runWorkerOnce(options);
      results.push(result);
      if (result.status === "idle") break;
    }
    if (options.reconcileRunId) {
      await reconcileRunStateFromJobs(paths, options.reconcileRunId);
    }
    return results;
  }

  const results = [];
  let idle = false;
  const workers = Array.from({ length: concurrency }, async () => {
    for (let index = 0; index < maxJobs; index += 1) {
      if (idle) return;
      const result = await runWorkerOnce(options);
      results.push(result);
      if (result.status === "idle") {
        idle = true;
        return;
      }
    }
  });
  await Promise.all(workers);
  if (options.reconcileRunId) {
    await reconcileRunStateFromJobs(paths, options.reconcileRunId);
  }
  return results;
}

export async function reportFullSetCoverage(options = {}) {
  const manifest = await loadAuthoritativeDrawingManifest(options.datasetOut);
  const paths = resolveWorkerPaths(options.rootDir);
  const runState = options.runId ? await loadRunState(options.rootDir, options.runId) : null;
  const outcomes = [];
  for (const sheet of manifest.sheets) {
    const cached = await readCachePack(paths, sheet.sha256);
    const packPath = path.join(paths.packs, `${sheet.id}.${sheet.sha256}.json`);
    outcomes.push({
      sheetId: sheet.id,
      relativePath: sheet.relativePath,
      sha256: sheet.sha256,
      cacheHit: Boolean(cached),
      packFile: existsSync(packPath),
      runStatus: runState?.sheets?.[sheet.relativePath]?.status || null,
      packStatus: runState?.sheets?.[sheet.relativePath]?.packStatus || cached?.status || null,
    });
  }
  return {
    manifest: {
      pdfSheetCount: manifest.pdfSheetCount,
      discrepancyNote: manifest.discrepancyNote,
    },
    run: runState ? summarizeRunState(runState) : null,
    outcomes,
    recorded: outcomes.filter((row) => row.cacheHit || row.packFile).length,
  };
}

export { PILOT_SHEETS, cacheKey, workerId };
