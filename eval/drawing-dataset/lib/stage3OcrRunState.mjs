/**
 * Run-scoped Stage 3 OCR preprocessing state (local authoritative during Mac run).
 * Syncs summary counts to Supabase analysis_scope via Edge when configured.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const STAGE3_OCR_PREPROCESS_VERSION = "phase3.stage3-ocr-preprocess.v1";

export const SHEET_OCR_STATUSES = new Set([
  "pending",
  "processing",
  "completed",
  "failed",
  "skipped",
]);

export function defaultRunState(input) {
  const now = new Date().toISOString();
  return {
    version: STAGE3_OCR_PREPROCESS_VERSION,
    projectId: input.projectId || null,
    runId: input.runId || null,
    fullCoverage: true,
    gateMode: "blocking",
    requiredSheetCount: input.requiredSheetCount || 0,
    macWorkerLastHeartbeat: now,
    updatedAt: now,
    cancelled: false,
    sheets: {},
    counts: {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
    },
  };
}

export function runStatePath(workerRoot, runId) {
  return path.join(path.resolve(workerRoot), "runs", `${runId}.state.json`);
}

export async function loadRunState(workerRoot, runId) {
  const filePath = runStatePath(workerRoot, runId);
  if (!existsSync(filePath)) return null;
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function saveRunState(workerRoot, state) {
  const dir = path.join(path.resolve(workerRoot), "runs");
  await mkdir(dir, { recursive: true });
  state.updatedAt = new Date().toISOString();
  recomputeCounts(state);
  const filePath = path.join(dir, `${state.runId}.state.json`);
  await writeFile(filePath, JSON.stringify(state, null, 2));
  return state;
}

export function recomputeCounts(state) {
  const counts = {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
  };
  for (const sheet of Object.values(state.sheets || {})) {
    const status = String(sheet.status || "pending");
    if (counts[status] != null) counts[status] += 1;
  }
  state.counts = counts;
  state.requiredSheetCount = Number(state.requiredSheetCount || Object.keys(state.sheets || {}).length);
  return counts;
}

export function initRunSheets(state, sheets, identity = {}) {
  for (const sheet of sheets) {
    const key = sheet.relativePath;
    if (state.sheets[key]) continue;
    state.sheets[key] = {
      sheetId: sheet.id,
      relativePath: sheet.relativePath,
      contentSha256: sheet.sha256,
      sheetJobId: identity[sheet.relativePath]?.sheetJobId || null,
      status: "pending",
      attempts: 0,
      cacheKey: null,
      packStatus: null,
      lastError: null,
      updatedAt: new Date().toISOString(),
    };
  }
  recomputeCounts(state);
  return state;
}

export function setSheetStatus(state, relativePath, patch) {
  const row = state.sheets[relativePath];
  if (!row) return state;
  Object.assign(row, patch, { updatedAt: new Date().toISOString() });
  recomputeCounts(state);
  return state;
}

export function isRunOcrTerminal(state) {
  recomputeCounts(state);
  const total = Object.keys(state.sheets || {}).length;
  const terminal = state.counts.completed + state.counts.failed + state.counts.skipped;
  return terminal >= total && total > 0;
}

export function summarizeRunState(state) {
  recomputeCounts(state);
  const total = Object.keys(state.sheets || {}).length;
  const missingEvidence = Object.values(state.sheets || {}).filter(
    (row) => row.status === "completed" && !row.packStatus,
  ).length;
  return {
    runId: state.runId,
    projectId: state.projectId,
    gateMode: state.gateMode,
    fullCoverage: state.fullCoverage,
    requiredSheetCount: state.requiredSheetCount,
    totalSheets: total,
    counts: state.counts,
    terminal: isRunOcrTerminal(state),
    missingEvidence,
    cancelled: Boolean(state.cancelled),
    macWorkerLastHeartbeat: state.macWorkerLastHeartbeat,
    updatedAt: state.updatedAt,
  };
}

/** Compact payload safe to store on supabase_analyzer_runs.analysis_scope.stage3OcrPreprocess */
export function toAnalysisScopePreprocessSummary(state) {
  const summary = summarizeRunState(state);
  return {
    version: STAGE3_OCR_PREPROCESS_VERSION,
    fullCoverage: true,
    gateMode: state.gateMode || "blocking",
    requiredSheetCount: summary.requiredSheetCount,
    counts: summary.counts,
    terminal: summary.terminal,
    missingEvidence: summary.missingEvidence,
    macWorkerLastHeartbeat: state.macWorkerLastHeartbeat,
    updatedAt: state.updatedAt,
    cancelled: Boolean(state.cancelled),
  };
}
