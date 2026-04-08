/**
 * Structured PGC progress events: compact terminal, JSONL, debug detail file, run summary JSON.
 * Does not alter scraper control flow — logging only.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PGC_PROGRESS_JSONL = path.join(__dirname, "pgc-progress-events.jsonl");
const PGC_DEBUG_DETAIL_LOG = path.join(__dirname, "pgc-debug-detail.log");
const PGC_RUN_SUMMARY_JSON = path.join(__dirname, "pgc-run-summary.json");

/** @type {{
 *   runId: string | null,
 *   projectId: string | null,
 *   projectNumber: string | null,
 *   startedAt: string | null,
 *   foldersTotal: number,
 *   folderIndex: number,
 *   filesInFolderTotal: number,
 *   fileIndex: number,
 *   cumulativeOk: number,
 *   cumulativeFailed: number,
 *   failureBuckets: Record<string, number>,
 *   folderSummaries: object[],
 *   fileId: string | null,
 *   fileName: string | null,
 *   folderId: string | null,
 *   folderName: string | null,
 *   parentFolder: string | null,
 * }} */
const ctx = {
  runId: null,
  projectId: null,
  projectNumber: null,
  startedAt: null,
  foldersTotal: 0,
  folderIndex: 0,
  filesInFolderTotal: 0,
  fileIndex: 0,
  cumulativeOk: 0,
  cumulativeFailed: 0,
  failureBuckets: {},
  folderSummaries: [],
  fileId: null,
  fileName: null,
  folderId: null,
  folderName: null,
  parentFolder: null,
};

function appendFileLine(filePath, line) {
  try {
    fs.appendFileSync(filePath, line + "\n", { encoding: "utf8" });
  } catch (e) {
    console.error("[PGC-PROGRESS] append failed:", filePath, e?.message || e);
  }
}

function buildProgressPayload() {
  return {
    folderIndex: ctx.folderIndex,
    foldersTotal: ctx.foldersTotal,
    fileIndex: ctx.fileIndex,
    filesInFolder: ctx.filesInFolderTotal,
    filesOk: ctx.cumulativeOk,
    filesFailed: ctx.cumulativeFailed,
  };
}

/** Progress events allowed on terminal (JSONL always records all). */
const PGC_TERMINAL_PROGRESS_EVENTS = new Set([
  "run_start",
  "login_start",
  "login_ok",
  "project_open_start",
  "project_open_ok",
  "folder_harvest_start",
  "folder_harvest_ok",
  "folder_start",
  "folder_grid_verified",
  "file_start",
  "row_found",
  "task_assignment_modal",
  "viewer_opened",
  "publish_menu_opened",
  "publish_to_pdf_clicked",
  "pdf_publish_dialog_ok",
  "export_complete_ok",
  "pdf_url_detected",
  "pdf_validation_ok",
  "file_saved",
  "file_failed",
  "folder_summary",
  "run_summary",
]);

/**
 * @param {string} eventName
 * @param {{ terminal?: boolean }} options
 */
function pgcShouldEmitProgressToTerminal(eventName, options) {
  if (options.terminal === false) return false;
  if (options.terminal === true) return true;
  return PGC_TERMINAL_PROGRESS_EVENTS.has(eventName);
}

/**
 * @param {string} eventName
 * @param {Record<string, unknown>} payload
 * @param {{ terminal?: boolean, terminalLine?: string, detail?: unknown, detailLabel?: string }} [options]
 */
function emitPgcProgress(eventName, payload = {}, options = {}) {
  const ts = new Date().toISOString();
  const row = {
    event: eventName,
    ts,
    runId: ctx.runId,
    portal: "pgc",
    projectId: payload.projectId ?? ctx.projectId,
    projectNumber: payload.projectNumber ?? ctx.projectNumber,
    folderId: payload.folderId ?? ctx.folderId,
    folderName: payload.folderName ?? ctx.folderName,
    parentFolder: payload.parentFolder ?? ctx.parentFolder,
    fileId: payload.fileId ?? ctx.fileId,
    fileName: payload.fileName ?? ctx.fileName,
    stage: payload.stage ?? eventName,
    status: payload.status ?? "info",
    message: payload.message ?? "",
    progress: payload.progress ?? buildProgressPayload(),
    counts: payload.counts ?? {},
    errorCode: payload.errorCode ?? null,
    meta: payload.meta && typeof payload.meta === "object" ? payload.meta : {},
  };

  appendFileLine(PGC_PROGRESS_JSONL, JSON.stringify(row));

  if (options.detail !== undefined && options.detail !== null) {
    pgcLogDetail(options.detailLabel || eventName, options.detail);
  }

  const term =
    options.terminalLine !== undefined
      ? options.terminalLine
      : payload.terminalLine;
  if (
    term != null &&
    term !== "" &&
    pgcShouldEmitProgressToTerminal(eventName, options)
  ) {
    console.log(term);
  }
}

function pgcLogDetail(label, data) {
  const ts = new Date().toISOString();
  let body;
  try {
    body =
      typeof data === "string"
        ? data
        : JSON.stringify(data, null, 2);
  } catch {
    body = String(data);
  }
  appendFileLine(
    PGC_DEBUG_DETAIL_LOG,
    `[${ts}] ${label}\n${body}\n---`,
  );
}

/**
 * @param {{ projectId: string, projectNumber?: string }} p
 */
function pgcBeginRun(p) {
  ctx.runId = crypto.randomBytes(10).toString("hex");
  ctx.projectId = String(p.projectId || "");
  ctx.projectNumber = String(p.projectNumber || "").trim() || null;
  ctx.startedAt = new Date().toISOString();
  ctx.foldersTotal = 0;
  ctx.folderIndex = 0;
  ctx.filesInFolderTotal = 0;
  ctx.fileIndex = 0;
  ctx.cumulativeOk = 0;
  ctx.cumulativeFailed = 0;
  ctx.failureBuckets = {};
  ctx.folderSummaries = [];
  emitPgcProgress("run_start", {
    stage: "run_start",
    status: "start",
    message: "PGC pipeline run started",
    terminalLine: `[PGC] Run start | project ${ctx.projectId}${ctx.projectNumber ? ` | ${ctx.projectNumber}` : ""}`,
  });
}

function getRunId() {
  return ctx.runId;
}

/**
 * @param {{
 *   foldersTotal: number,
 *   filesTotal?: number,
 * }} p
 */
function pgcSetRunHarvestTotals(p) {
  ctx.foldersTotal = p.foldersTotal || 0;
  emitPgcProgress("folder_harvest_start", {
    stage: "folder_harvest_start",
    status: "start",
    message: "Harvesting folder/file metadata",
    counts: { foldersNonEmpty: p.foldersTotal, filesTotal: p.filesTotal ?? 0 },
    terminalLine: `[PGC] Harvest | ${p.foldersTotal} non-empty folder(s) | ${p.filesTotal ?? "?"} file row(s)`,
  });
}

function pgcLogFolderHarvestOk(filesCount, foldersCount) {
  emitPgcProgress("folder_harvest_ok", {
    stage: "folder_harvest_ok",
    status: "ok",
    message: "Folder metadata harvest complete",
    counts: { filesCount, foldersCount },
    terminalLine: `[PGC] Harvest OK | folders: ${foldersCount} | files: ${filesCount}`,
  });
}

/**
 * @param {{
 *   folderIndex: number,
 *   foldersTotal: number,
 *   folderId: string,
 *   folderName: string,
 *   parentFolder: string,
 *   expectedFiles: number,
 * }} p
 */
function pgcLogFolderStart(p) {
  ctx.folderIndex = p.folderIndex;
  ctx.foldersTotal = p.foldersTotal;
  ctx.folderId = p.folderId;
  ctx.folderName = p.folderName;
  ctx.parentFolder = p.parentFolder;
  ctx.filesInFolderTotal = p.expectedFiles;
  ctx.fileIndex = 0;
  const compact = `[PGC] Folder ${p.folderIndex}/${p.foldersTotal} | ${p.parentFolder} / ${p.folderName} | ${p.expectedFiles} files`;
  emitPgcProgress("folder_start", {
    stage: "folder_start",
    status: "start",
    folderId: p.folderId,
    folderName: p.folderName,
    parentFolder: p.parentFolder,
    message: compact,
    counts: { expectedFiles: p.expectedFiles },
    meta: { folderID: p.folderId },
    terminalLine: compact,
  });
  pgcLogDetail("folder_start_debug", {
    folderIndex: p.folderIndex,
    foldersTotal: p.foldersTotal,
    folderId: p.folderId,
    folderName: p.folderName,
    parentFolder: p.parentFolder,
    expectedFiles: p.expectedFiles,
  });
}

/**
 * @param {{
 *   fileIndex: number,
 *   filesInFolder: number,
 *   fileId: string,
 *   fileName: string,
 * }} p
 */
function pgcLogFileStart(p) {
  ctx.fileIndex = p.fileIndex;
  ctx.filesInFolderTotal = p.filesInFolder;
  ctx.fileId = p.fileId;
  ctx.fileName = p.fileName;
  const line = `[PGC] File ${p.fileIndex}/${p.filesInFolder} | ${p.fileName}`;
  emitPgcProgress("file_start", {
    stage: "file_start",
    status: "start",
    fileId: p.fileId,
    fileName: p.fileName,
    terminalLine: line,
  });
}

/**
 * @param {string} stage
 * @param {{ status?: string, message?: string, meta?: object, terminalLine?: string }} [extra]
 */
function pgcLogFileStep(stage, extra = {}) {
  const tl =
    extra.terminalLine != null
      ? extra.terminalLine
      : `[PGC] Step | ${stage}`;
  emitPgcProgress(stage, {
    stage,
    status: extra.status || "info",
    message: extra.message || "",
    meta: extra.meta || {},
    terminalLine: tl,
  });
}

function pgcLogFolderGridVerified() {
  emitPgcProgress("folder_grid_verified", {
    stage: "folder_grid_verified",
    status: "ok",
    message: "Grid verified for folder",
    terminalLine: `[PGC] Step | folder_grid_verified | ${ctx.parentFolder} / ${ctx.folderName}`,
  });
}

function pgcLogRowFound(fileName) {
  pgcLogFileStep("row_found", {
    message: fileName,
    terminalLine: `[PGC] Step | row_found | ${fileName}`,
  });
}

function pgcLogLoginOk(credentialsSource) {
  emitPgcProgress("login_ok", {
    stage: "login_ok",
    status: "ok",
    message: "Login succeeded",
    meta: { credentialsSource: credentialsSource || "unknown" },
    terminalLine: `[PGC] Login OK | ${credentialsSource || "credentials"}`,
  });
}

/**
 * @param {string} loginUrl
 */
function pgcLogLoginStart(loginUrl) {
  emitPgcProgress("login_start", {
    stage: "login_start",
    status: "start",
    message: "PGC login attempt starting",
    meta: { loginUrl: String(loginUrl || "").slice(0, 400) },
    terminalLine: `[PGC] Login start`,
  });
}

/**
 * @param {string} projectId
 * @param {string} [projectNumber]
 */
function pgcLogProjectOpenStart(projectId, projectNumber) {
  emitPgcProgress("project_open_start", {
    stage: "project_open_start",
    status: "start",
    message: "Opening project from dashboard",
    meta: { projectId: String(projectId || "") },
    terminalLine: `[PGC] Project open start | ${projectNumber || projectId}`,
  });
}

function pgcLogProjectOpen(projectNumber) {
  emitPgcProgress("project_open_ok", {
    stage: "project_open_ok",
    status: "ok",
    message: "Project context opened",
    terminalLine: `[PGC] Project open | ${projectNumber || ctx.projectNumber || ctx.projectId}`,
  });
}

/**
 * @param {{
 *   parentFolder: string,
 *   folderName: string,
 *   expected: number,
 *   attempted: number,
 *   ok: number,
 *   failed: number,
 * }} s
 */
function pgcLogFolderSummary(s) {
  const line = `[PGC] Folder summary | ${s.parentFolder} / ${s.folderName} | ok: ${s.ok} | failed: ${s.failed}`;
  const rec = {
    folderId: ctx.folderId,
    parentFolder: s.parentFolder,
    folderName: s.folderName,
    expected: s.expected,
    attempted: s.attempted,
    ok: s.ok,
    failed: s.failed,
  };
  ctx.folderSummaries.push(rec);
  emitPgcProgress("folder_summary", {
    stage: "folder_summary",
    status: "ok",
    message: line,
    counts: {
      expected: s.expected,
      attempted: s.attempted,
      ok: s.ok,
      failed: s.failed,
    },
    meta: rec,
    terminalLine: line,
  });
}

/**
 * @param {string} fileName
 * @param {string} via
 * @param {number} bytes
 */
function pgcLogFileSuccess(fileName, via, bytes) {
  ctx.cumulativeOk += 1;
  emitPgcProgress("file_saved", {
    stage: "file_saved",
    status: "ok",
    fileName,
    message: "File saved",
    meta: { via, bytes },
    terminalLine: `[PGC] OK | ${fileName} | ${via} | ${bytes} bytes`,
  });
}

/**
 * @param {string} fileName
 * @param {string} errorCode
 */
function pgcLogFileFailure(fileName, errorCode) {
  ctx.cumulativeFailed += 1;
  const code = String(errorCode || "unknown");
  emitPgcProgress("file_failed", {
    stage: "file_failed",
    status: "fail",
    fileName,
    errorCode: code,
    terminalLine: `[PGC] FAIL | ${fileName} | ${code}`,
  });
}

/**
 * @param {import('fs').PathLike} filesOut Harvest result shape (partial)
 * @param {{ projectNumber?: string }} [proj]
 */
function pgcFinalizeRun(filesOut, proj) {
  const endedAt = new Date().toISOString();
  const started = ctx.startedAt
    ? new Date(ctx.startedAt).getTime()
    : Date.now();
  const durationMs = Date.now() - started;

  const m = filesOut?._meta || {};
  const multi = m.pgcMultiFolderDownload || {};
  const task6 = /** @type {any} */ (filesOut?._meta?.task6Checkpoint || {});
  /** @type {Record<string, number>} */
  const failureBuckets = {};
  for (const row of multi.failedFiles || []) {
    const r = String(row.reason || "unknown");
    failureBuckets[r] = (failureBuckets[r] || 0) + 1;
  }

  const filesAttempted =
    multi.filesAttempted ??
    ctx.cumulativeOk + ctx.cumulativeFailed;
  const filesOk = multi.downloadsOk ?? ctx.cumulativeOk;
  const filesFailed = multi.failures ?? ctx.cumulativeFailed;

  const foldersTotalNonEmpty =
    Number(task6.foldersTotalNonEmpty) ||
    ctx.foldersTotal ||
    0;
  const foldersProcessed =
    multi.nonEmptyFoldersProcessed ?? 0;

  const summary = {
    runId: ctx.runId,
    portal: "pgc",
    projectId: ctx.projectId || String(filesOut?.projectID || ""),
    projectNumber:
      ctx.projectNumber ||
      (proj && String(proj.projectNumber || "").trim()) ||
      null,
    foldersTotal: foldersTotalNonEmpty,
    foldersProcessed,
    filesTotal: filesOut?.filesCount ?? 0,
    filesAttempted,
    filesOk,
    filesFailed,
    failureBuckets,
    folderSummaries: ctx.folderSummaries.slice(),
    startedAt: ctx.startedAt,
    endedAt,
    durationMs,
  };

  const summaryEnriched = {
    ...summary,
    foldersTotalNonEmpty: foldersTotalNonEmpty || summary.foldersTotal,
    lastCompletedFolder: task6.lastCompletedFolder ?? null,
    lastCompletedFolderId: task6.lastCompletedFolderId ?? null,
    task6RecoveryAttempts: task6.recoveryAttempts ?? 0,
    task6BrowserRelaunchCount: task6.browserRelaunchCount ?? 0,
  };

  if (Object.keys(summary.failureBuckets).length) {
    console.log(
      "[PGC] Failure buckets |",
      JSON.stringify(summary.failureBuckets),
    );
  }
  const runLine = `[PGC] Run summary | folders: ${summaryEnriched.foldersProcessed}/${summaryEnriched.foldersTotalNonEmpty || summaryEnriched.foldersTotal || "?"} | files: ${summary.filesAttempted} | ok: ${summary.filesOk} | failed: ${summary.filesFailed}${summaryEnriched.task6BrowserRelaunchCount ? ` | relaunch:${summaryEnriched.task6BrowserRelaunchCount}` : ""}${summaryEnriched.lastCompletedFolder ? ` | last: ${summaryEnriched.lastCompletedFolder}` : ""}`;

  try {
    fs.writeFileSync(
      PGC_RUN_SUMMARY_JSON,
      JSON.stringify(summaryEnriched, null, 2),
      "utf8",
    );
  } catch (e) {
    console.error("[PGC-PROGRESS] run summary write failed:", e?.message || e);
  }

  emitPgcProgress("run_summary", {
    stage: "run_summary",
    status: "ok",
    message: runLine,
    terminalLine: runLine,
    counts: {
      foldersProcessed: summary.foldersProcessed,
      filesAttempted: summary.filesAttempted,
      filesOk: summary.filesOk,
      filesFailed: summary.filesFailed,
    },
    meta: {
      summaryPath: PGC_RUN_SUMMARY_JSON,
      failureBuckets: summary.failureBuckets,
      lastCompletedFolder: summaryEnriched.lastCompletedFolder,
      task6BrowserRelaunchCount: summaryEnriched.task6BrowserRelaunchCount,
      task6RecoveryAttempts: summaryEnriched.task6RecoveryAttempts,
    },
  });
}

/**
 * Viewer candidate requests: terminal summary + full list in debug log.
 */
function pgcLogViewerRequestSummary(fileMeta, responseRecords, interesting) {
  const name = fileMeta?.name || fileMeta?.fileId || "?";
  const total = (responseRecords || []).length;
  const filt = (interesting || []).length;
  emitPgcProgress(
    "viewer_network_sample",
    {
      stage: "viewer_network_sample",
      status: "info",
      fileName: String(name),
      message: `recorded ${total} filtered ${filt}`,
      meta: { totalRecorded: total, filteredSample: filt },
      detail: {
        fileMeta,
        responseRecords: responseRecords || [],
        interestingSample: interesting || [],
      },
      detailLabel: `viewer_requests:${name}`,
    },
    { terminal: false },
  );
  pgcLogDetail(`viewer_requests:${name}`, {
    fileMeta,
    totalRecorded: total,
    filteredSample: filt,
    responseRecords: responseRecords || [],
    interestingSample: interesting || [],
  });
}

/** @alias pgcBeginRun */
const pgcLogRunStart = pgcBeginRun;

module.exports = {
  emitPgcProgress,
  pgcBeginRun,
  pgcLogRunStart,
  getRunId,
  pgcSetRunHarvestTotals,
  pgcLogFolderHarvestOk,
  pgcLogFolderStart,
  pgcLogFileStart,
  pgcLogFileStep,
  pgcLogFolderGridVerified,
  pgcLogRowFound,
  pgcLogLoginOk,
  pgcLogLoginStart,
  pgcLogProjectOpenStart,
  pgcLogProjectOpen,
  pgcLogFolderSummary,
  pgcLogFileSuccess,
  pgcLogFileFailure,
  pgcFinalizeRun,
  pgcLogDetail,
  pgcLogViewerRequestSummary,
  PGC_PROGRESS_JSONL,
  PGC_DEBUG_DETAIL_LOG,
  PGC_RUN_SUMMARY_JSON,
};
