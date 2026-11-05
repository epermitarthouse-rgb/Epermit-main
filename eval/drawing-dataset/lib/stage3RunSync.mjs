/**
 * Stage 3 sync driven by the sheets of one Supabase Analyzer V2 run.
 *
 * Every sheet in the run gets a v1 and a v2 pack from 4x3 OCR before GPT. Each drawing is downloaded
 * through the evidence Edge function and matched by SHA-256 to the prepared dataset (cached OCR and
 * layout); any other drawing is ingested on this Mac. Both packs are uploaded and read back before the
 * sheet counts as complete. When every sheet is terminal and some have no usable evidence, the worker
 * releases the gate so those sheets run on the PDF alone, and the analyzer audits the fallback.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { STAGE3_EVIDENCE_V2 } from "./stage3EvidenceConfig.mjs";
import { loadAuthoritativeDrawingManifest, sheetLabelFromPath } from "./stage3DrawingManifest.mjs";
import { buildJobRecord, ensureWorkerDirs, processClaimedJob, resolveWorkerPaths } from "./stage3MacOcrWorker.mjs";
import {
  defaultRunState,
  listIncompleteOcrSheets,
  loadRunState,
  saveRunState,
  summarizeRunState,
  updateRunState,
} from "./stage3OcrRunState.mjs";
import { ingestSheetPdf } from "./stage3SheetIngest.mjs";
import {
  downloadSheetPdfToCache,
  listRunSheetJobs,
  syncRunPreprocessSummary,
  verifyStoredPack,
} from "./stage3WorkerSupabase.mjs";

export const STAGE3_RUN_SYNC_VERSION = "phase3.stage3-run-sync.v1";
export const MAX_SHEET_ATTEMPTS = 3;

/** Run-state key per active sheet: its file name, made unique when a run holds the same name twice. */
export function runSheetKeys(jobs) {
  const counts = new Map();
  for (const job of jobs) {
    const name = String(job.original_file_name || "").trim().toLowerCase();
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return new Map(jobs.map((job) => {
    const name = String(job.original_file_name || "").trim() || `${job.id}.pdf`;
    const duplicate = counts.get(name.toLowerCase()) > 1;
    return [job.id, duplicate ? `${name}#${String(job.id).slice(0, 8)}` : name];
  }));
}

/** Bring the local run state in line with the run's active sheets; returns whether new sheets arrived. */
export function reconcileRunSheets(state, jobs, keys) {
  const wanted = new Set();
  let added = false;
  for (const job of jobs) {
    const key = keys.get(job.id);
    wanted.add(key);
    const row = state.sheets[key];
    if (row && row.sheetJobId === job.id) continue;
    state.sheets[key] = {
      sheetId: sheetLabelFromPath(String(job.original_file_name || key)),
      relativePath: key,
      sheetJobId: job.id,
      contentSha256: null,
      status: "pending",
      attempts: 0,
      cacheKey: null,
      packStatus: null,
      lastError: null,
      updatedAt: new Date().toISOString(),
    };
    added = true;
  }
  for (const key of Object.keys(state.sheets)) {
    if (!wanted.has(key)) delete state.sheets[key];
  }
  state.requiredSheetCount = jobs.length;
  if (added && state.gateReleasedBy === "worker") {
    state.gateMode = "blocking";
    delete state.gateReleasedBy;
    delete state.gateReleaseReason;
  }
  return added;
}

async function preparedSheetsBySha(datasetOut) {
  if (!datasetOut) return new Map();
  try {
    const manifest = await loadAuthoritativeDrawingManifest(datasetOut);
    return new Map(manifest.sheets.map((sheet) => [sheet.sha256, sheet]));
  } catch {
    return new Map();
  }
}

/** Release the gate once every sheet is terminal, naming the sheets that run without evidence. */
export function finalizeRunGate(state) {
  const summary = summarizeRunState(state);
  if (!summary.terminal || state.gateMode !== "blocking") return false;
  const incomplete = listIncompleteOcrSheets(state);
  if (!incomplete.length) return false;
  state.gateMode = "approved_partial";
  state.gateReleasedBy = "worker";
  state.gateReleaseReason = `OCR finished; ${incomplete.length} sheet(s) without usable evidence run on the PDF only: ${incomplete.slice(0, 12).join(", ")}`;
  return true;
}

/**
 * One pass over the run: process every pending sheet whose drawing is uploaded, then sync the summary.
 * Safe to call repeatedly (daemon tick); completed sheets are skipped.
 */
export async function syncAnalyzerV2Run(options, deps = {}) {
  const { workerRoot, datasetOut, projectId, runId, maxSheets = null } = options;
  if (!workerRoot || !projectId || !runId) throw new Error("run_sync_requires_workerRoot_projectId_runId");
  const api = {
    listJobs: listRunSheetJobs,
    download: downloadSheetPdfToCache,
    verify: verifyStoredPack,
    syncPreprocess: syncRunPreprocessSummary,
    processJob: processClaimedJob,
    ingest: ingestSheetPdf,
    ...deps,
  };
  const paths = resolveWorkerPaths(workerRoot);
  await ensureWorkerDirs(paths);

  const jobs = (await api.listJobs({ projectId, runId })).filter((job) => job.status !== "cancelled");
  const keys = runSheetKeys(jobs);
  const prepared = await preparedSheetsBySha(datasetOut);

  const state = (await loadRunState(workerRoot, runId)) || defaultRunState({ projectId, runId, requiredSheetCount: jobs.length });
  state.projectId = projectId;
  state.runId = runId;
  state.syncVersion = STAGE3_RUN_SYNC_VERSION;
  reconcileRunSheets(state, jobs, keys);
  state.macWorkerLastHeartbeat = new Date().toISOString();
  await saveRunState(workerRoot, state);
  await api.syncPreprocess(state).catch(() => null);

  const outcomes = [];
  const ready = jobs.filter((job) => job.status !== "upload_pending");
  for (const job of ready) {
    if (maxSheets != null && outcomes.length >= Number(maxSheets)) break;
    const key = keys.get(job.id);
    const current = (await loadRunState(workerRoot, runId))?.sheets?.[key];
    if (!current || current.status === "completed" || current.status === "failed") continue;
    let patch;
    try {
      patch = await syncSheet(job, key, { workerRoot, datasetOut, projectId, runId, paths, prepared, api });
    } catch (error) {
      const attempts = Number(current.attempts || 0) + 1;
      patch = {
        status: attempts >= MAX_SHEET_ATTEMPTS ? "failed" : "pending",
        attempts,
        lastError: String(error?.message || error).slice(0, 240),
      };
    }
    outcomes.push({ relativePath: key, sheetJobId: job.id, ...patch });
    const next = await updateRunState(workerRoot, runId, (draft) => {
      Object.assign(draft.sheets[key], patch, { updatedAt: new Date().toISOString() });
      draft.macWorkerLastHeartbeat = new Date().toISOString();
      return draft;
    });
    if (next) await api.syncPreprocess(next).catch(() => null);
  }

  const final = await loadRunState(workerRoot, runId);
  const waiting = jobs.length - ready.length;
  if (!waiting) finalizeRunGate(final);
  final.macWorkerLastHeartbeat = new Date().toISOString();
  await saveRunState(workerRoot, final);
  await api.syncPreprocess(final);
  return {
    runId,
    sheets: jobs.length,
    waitingForUpload: waiting,
    processed: outcomes.length,
    outcomes,
    gateMode: final.gateMode,
    gateReleaseReason: final.gateReleaseReason || null,
    preprocess: summarizeRunState(final),
  };
}

async function syncSheet(job, key, ctx) {
  const { workerRoot, datasetOut, projectId, runId, paths, prepared, api } = ctx;
  const download = await api.download({ projectId, runId, sheetJobId: job.id, relativePath: key, cacheRoot: workerRoot });
  const sha256 = String(download.sha256 || "").toLowerCase();
  const preparedSheet = prepared.get(sha256);
  const preparedRecovery = datasetOut ? path.join(datasetOut, "recovery", `${sha256}.json`) : null;
  let source;
  let sheetId;
  let layoutPagePath;
  let recoveryPath;
  if (preparedSheet && existsSync(preparedSheet.layoutPagePath) && preparedRecovery && existsSync(preparedRecovery)) {
    source = "prepared";
    sheetId = preparedSheet.id;
    layoutPagePath = preparedSheet.layoutPagePath;
    recoveryPath = preparedRecovery;
  } else {
    const ingested = await api.ingest({
      pdfPath: download.pdfPath,
      contentSha256: sha256,
      relativePath: key,
      ingestRoot: path.join(workerRoot, "ingest"),
    });
    source = ingested.cacheHit ? "ingested_cached" : "ingested";
    sheetId = sheetLabelFromPath(String(job.original_file_name || key));
    layoutPagePath = ingested.layoutPagePath;
    recoveryPath = ingested.recoveryPath;
  }
  const recovery = JSON.parse(await readFile(recoveryPath, "utf8"));
  const record = buildJobRecord({ id: sheetId, relativePath: key, sha256 }, {
    jobId: createHash("sha1").update(`${runId}|${job.id}|${sha256}|${STAGE3_EVIDENCE_V2}`).digest("hex").slice(0, 16),
    pdfPath: download.pdfPath,
    layoutPagePath,
    projectId,
    runId,
    sheetJobId: job.id,
    evidenceVersion: "v2",
    recoveryPath,
    ocrGrid: "4x3",
  });
  const processed = await api.processJob(paths, record, {
    storage: { viaEdge: true },
    recoverPdf: async () => recovery,
  });
  const identity = { projectId, runId, sheetJobId: job.id, contentSha256: sha256 };
  const v1 = await api.verify(identity);
  const v2 = await api.verify({ ...identity, extractionVersion: STAGE3_EVIDENCE_V2 });
  if (!v1.ok || !v2.ok) {
    const v2Reason = processed?.job?.evidenceV2?.fallbackReason;
    throw new Error(`pack_not_verified:v1=${v1.ok ? "ok" : v1.error || v1.issue || v1.httpStatus}:v2=${v2.ok ? "ok" : v2Reason || v2.error || v2.issue || v2.httpStatus}`);
  }
  return {
    status: "completed",
    sheetId,
    contentSha256: sha256,
    evidenceSource: source,
    ocrGrid: "4x3",
    packStatus: v2.packStatus || null,
    v1PackStatus: v1.packStatus || null,
    v2CacheKey: processed?.job?.evidenceV2?.cacheKey || null,
    lastError: null,
  };
}
