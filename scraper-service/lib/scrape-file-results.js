"use strict";

const { sanitizeTechnicalMessage, sanitizeMetadata, emitScrapeEvent } = require("./scrape-events.js");

const TERMINAL_FILE_STATUSES = new Set(["uploaded", "failed", "skipped"]);
const SUCCESSFUL_JOB_STATUSES = new Set(["completed", "completed_with_warnings"]);

const SENSITIVE_METADATA_KEYS =
  /password|cookie|token|authorization|sessionid|license|fileconfig|signed|html|header/i;

function safeStr(value, maxLen = 500) {
  if (value == null) return "";
  const text = String(value).trim();
  if (!text) return "";
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

function normalizeVersion(version) {
  if (version == null) return "";
  return String(version).trim();
}

function sanitizeFailureMessage(message) {
  const sanitized = sanitizeTechnicalMessage(message);
  return sanitized || "Download could not be completed.";
}

function sanitizeFailureCode(code) {
  const c = safeStr(code, 80);
  if (!c) return "download_failed";
  if (/password|cookie|token|session/i.test(c)) return "download_failed";
  return c;
}

function sanitizeRowMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }
  const out = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_METADATA_KEYS.test(key)) continue;
    if (typeof value === "string") {
      const s = sanitizeTechnicalMessage(value);
      if (s) out[key] = safeStr(s, 300);
    } else if (
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      out[key] = value;
    }
  }
  return sanitizeMetadata(out);
}

function logPersistenceError(scope, err) {
  const msg = err && err.message ? err.message : String(err);
  console.warn(`[scrape-file-results] ${scope}: ${msg}`);
}

function buildFileKey(fields) {
  return {
    project_id: fields.projectId,
    scrape_job_id: fields.scrapeJobId,
    portal_file_id: String(fields.portalFileId),
    file_version: normalizeVersion(fields.fileVersion),
  };
}

function createFileProgressContext(session, supabase) {
  const scrapeJobId = session?._scrapeJobId || null;
  const projectId = session?._scrapeProjectId || null;
  if (!scrapeJobId || !projectId || !supabase) {
    if (session && !session._fileProgressUnavailableLogged) {
      session._fileProgressUnavailableLogged = true;
      console.log(
        "[file-progress] Progressive file persistence unavailable (no scrape_job_id)",
      );
    }
    return null;
  }
  return {
    supabase,
    scrapeJobId,
    projectId,
    jurisdiction: safeStr(session._scrapeJurisdiction, 120) || "Unknown",
    getProgressTotal: () =>
      session._fileProgressTotal != null ? Number(session._fileProgressTotal) : null,
    setProgressTotal: (n) => {
      if (n != null) session._fileProgressTotal = Number(n);
    },
    getProgressCurrent: () => Number(session._fileProgressCurrent || 0),
    bumpProgressCurrent: () => {
      session._fileProgressCurrent = Number(session._fileProgressCurrent || 0) + 1;
      return session._fileProgressCurrent;
    },
  };
}

async function upsertFileRow(ctx, patch, eventType) {
  if (!ctx) return { ok: false };
  const keys = buildFileKey(patch);
  const now = new Date().toISOString();
  const row = {
    ...keys,
    jurisdiction: safeStr(patch.jurisdiction || ctx.jurisdiction, 120) || "Unknown",
    file_name: safeStr(patch.fileName, 300) || "file",
    folder_name: patch.folderName != null ? safeStr(patch.folderName, 200) : null,
    parent_folder: patch.parentFolder != null ? safeStr(patch.parentFolder, 200) : null,
    status: patch.status,
    storage_path: patch.storagePath != null ? safeStr(patch.storagePath, 500) : null,
    public_url: patch.publicUrl != null ? safeStr(patch.publicUrl, 800) : null,
    source_url: patch.sourceUrl != null ? safeStr(patch.sourceUrl, 800) : null,
    mime_type: patch.mimeType != null ? safeStr(patch.mimeType, 120) : null,
    size_bytes: patch.sizeBytes != null ? Number(patch.sizeBytes) : null,
    progress_current:
      patch.progressCurrent != null
        ? Number(patch.progressCurrent)
        : ctx.getProgressCurrent(),
    progress_total:
      patch.progressTotal != null
        ? Number(patch.progressTotal)
        : ctx.getProgressTotal(),
    failure_code:
      patch.failureCode != null ? sanitizeFailureCode(patch.failureCode) : null,
    failure_message:
      patch.failureMessage != null
        ? sanitizeFailureMessage(patch.failureMessage)
        : null,
    metadata: sanitizeRowMetadata(patch.metadata),
    updated_at: now,
  };

  if (patch.status === "discovered" && !patch.skipDiscoveredAt) {
    row.discovered_at = now;
  }
  if (patch.status === "downloading" || patch.status === "retrying") {
    row.started_at = now;
  }
  if (patch.status === "uploaded") {
    row.uploaded_at = now;
  }
  if (patch.status === "failed") {
    row.failed_at = now;
  }

  try {
    const { error } = await ctx.supabase.from("scrape_file_results").upsert(row, {
      onConflict: "project_id,scrape_job_id,portal_file_id,file_version",
    });
    if (error) throw error;

    if (eventType) {
      const userMessage = userMessageForFileEvent(patch.status, patch.fileName);
      await emitScrapeEvent(ctx.supabase, ctx.scrapeJobId, ctx.projectId, {
        event_type: eventType,
        stage: "files",
        status: "running",
        user_message: userMessage,
        progress_current: row.progress_current,
        progress_total: row.progress_total,
        metadata: sanitizeRowMetadata({
          portal_file_id: keys.portal_file_id,
          file_name: row.file_name,
          folder_name: row.folder_name,
          file_status: patch.status,
        }),
      });
    }
    return { ok: true };
  } catch (err) {
    logPersistenceError("upsertFileRow", err);
    return { ok: false };
  }
}

function userMessageForFileEvent(status, fileName) {
  const name = safeStr(fileName, 80) || "file";
  switch (status) {
    case "discovered":
      return `Found file: ${name}`;
    case "downloading":
      return `Downloading ${name}…`;
    case "uploaded":
      return `Uploaded ${name}`;
    case "retrying":
      return `Retrying ${name}…`;
    case "failed":
      return `Could not download ${name}`;
    case "skipped":
      return `Skipped duplicate: ${name}`;
    default:
      return `Processing ${name}…`;
  }
}

function basePatch(ctx, fields) {
  return {
    projectId: ctx.projectId,
    scrapeJobId: ctx.scrapeJobId,
    jurisdiction: ctx.jurisdiction,
    portalFileId: fields.portalFileId,
    fileVersion: fields.fileVersion,
    fileName: fields.fileName,
    folderName: fields.folderName,
    parentFolder: fields.parentFolder,
    progressTotal: fields.progressTotal ?? ctx.getProgressTotal(),
    progressCurrent: fields.progressCurrent ?? ctx.getProgressCurrent(),
    metadata: fields.metadata,
  };
}

async function upsertFileDiscovered(ctx, fields) {
  return upsertFileRow(
    ctx,
    {
      ...basePatch(ctx, fields),
      status: "discovered",
      skipDiscoveredAt: fields.skipDiscoveredAt,
    },
    "file_discovered",
  );
}

async function markFileDownloading(ctx, fields) {
  return upsertFileRow(
    ctx,
    { ...basePatch(ctx, fields), status: "downloading" },
    "file_downloading",
  );
}

async function markFileRetrying(ctx, fields) {
  return upsertFileRow(
    ctx,
    {
      ...basePatch(ctx, fields),
      status: "retrying",
      failureCode: fields.failureCode,
      failureMessage: fields.failureMessage,
    },
    "file_retrying",
  );
}

/**
 * After a successful retry upload, clear stale failed rows for the same
 * project + portal_file_id from earlier scrape jobs so UI failed queries
 * do not keep showing already-recovered files.
 */
async function supersedeProjectFailedRowsForFile(ctx, fields) {
  if (!ctx?.supabase || !ctx.projectId) return { ok: false };
  const portalFileId = String(fields.portalFileId || "").trim();
  if (!portalFileId) return { ok: false };
  const now = new Date().toISOString();
  try {
    const patch = {
      status: "uploaded",
      public_url:
        fields.publicUrl != null ? safeStr(fields.publicUrl, 800) : null,
      storage_path:
        fields.storagePath != null ? safeStr(fields.storagePath, 500) : null,
      failure_code: null,
      failure_message: null,
      uploaded_at: now,
      updated_at: now,
      metadata: sanitizeRowMetadata({
        ...(fields.metadata && typeof fields.metadata === "object"
          ? fields.metadata
          : {}),
        superseded_by_retry: true,
        superseded_by_job: ctx.scrapeJobId,
      }),
    };
    let query = ctx.supabase
      .from("scrape_file_results")
      .update(patch)
      .eq("project_id", ctx.projectId)
      .eq("portal_file_id", portalFileId)
      .eq("status", "failed");
    if (ctx.scrapeJobId) {
      query = query.neq("scrape_job_id", ctx.scrapeJobId);
    }
    const { error } = await query;
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    logPersistenceError("supersedeProjectFailedRowsForFile", err);
    return { ok: false };
  }
}

async function markFileUploaded(ctx, fields) {
  const result = await upsertFileRow(
    ctx,
    {
      ...basePatch(ctx, fields),
      status: "uploaded",
      storagePath: fields.storagePath,
      publicUrl: fields.publicUrl,
      sourceUrl: fields.sourceUrl,
      mimeType: fields.mimeType,
      sizeBytes: fields.sizeBytes,
    },
    "file_uploaded",
  );
  if (result?.ok) {
    await supersedeProjectFailedRowsForFile(ctx, fields);
  }
  return result;
}

async function markFileFailed(ctx, fields) {
  return upsertFileRow(
    ctx,
    {
      ...basePatch(ctx, fields),
      status: "failed",
      failureCode: fields.failureCode,
      failureMessage: fields.failureMessage,
    },
    "file_failed",
  );
}

async function markFileSkipped(ctx, fields) {
  return upsertFileRow(
    ctx,
    {
      ...basePatch(ctx, fields),
      status: "skipped",
      publicUrl: fields.publicUrl,
      sourceUrl: fields.sourceUrl,
      failureCode: fields.failureCode || "duplicate",
      failureMessage: fields.failureMessage || "Duplicate content skipped",
    },
    "file_skipped",
  );
}

async function listRunFiles(supabase, scrapeJobId) {
  if (!supabase || !scrapeJobId) return [];
  try {
    const { data, error } = await supabase
      .from("scrape_file_results")
      .select("*")
      .eq("scrape_job_id", scrapeJobId)
      .order("folder_name", { ascending: true })
      .order("file_name", { ascending: true });
    if (error) throw error;
    return data || [];
  } catch (err) {
    logPersistenceError("listRunFiles", err);
    return [];
  }
}

/** @returns {Map<string, { publicUrl: string, sha256?: string, sizeBytes?: number }>} */
function buildUploadedCheckpointMap(rows) {
  const map = new Map();
  for (const row of rows || []) {
    if (row.status !== "uploaded") continue;
    const key = `${String(row.portal_file_id)}|${normalizeVersion(row.file_version)}`;
    const meta =
      row.metadata && typeof row.metadata === "object" ? row.metadata : {};
    map.set(key, {
      publicUrl: row.public_url || "",
      sha256: meta.sha256 != null ? String(meta.sha256) : undefined,
      sizeBytes: row.size_bytes != null ? Number(row.size_bytes) : undefined,
      storagePath: row.storage_path || "",
    });
  }
  return map;
}

function checkpointKeyForFile(fileId, fileVersion) {
  return `${String(fileId)}|${normalizeVersion(fileVersion)}`;
}

function downloadStatusFromRow(row) {
  switch (row.status) {
    case "uploaded":
      return "success";
    case "failed":
      return "failed";
    case "skipped":
      return "skipped_duplicate";
    default:
      return row.status;
  }
}

function portalFileEntryFromRow(row) {
  const uploaded = row.status === "uploaded";
  const entry = {
    name: row.file_name,
    fileId: row.portal_file_id,
    folderName: row.folder_name || "",
    parentFolder: row.parent_folder || null,
    version: row.file_version || null,
    viewUrl: uploaded && row.public_url ? row.public_url : "",
    publicUrl: uploaded && row.public_url ? row.public_url : null,
    downloadUrl: row.source_url || null,
    fileSizeKB:
      row.size_bytes != null
        ? Math.max(1, Math.round(Number(row.size_bytes) / 1024))
        : null,
    status: "",
    reviewedBy: "",
    uploadedDate: "",
    commentCount: 0,
    comments: [],
  };
  const ds = downloadStatusFromRow(row);
  if (ds) entry.downloadStatus = ds;
  if (row.status === "failed" && row.failure_message) {
    entry.downloadError = sanitizeFailureMessage(row.failure_message);
  }
  return entry;
}

function buildFilesTabFromRows(rows) {
  /** @type {Map<string, { name: string, folderName: string, fileCount: number, files: object[] }>} */
  const byFolder = new Map();
  for (const row of rows) {
    if (!TERMINAL_FILE_STATUSES.has(row.status)) continue;
    const folderName = row.folder_name || "Files";
    if (!byFolder.has(folderName)) {
      byFolder.set(folderName, {
        name: folderName,
        folderName,
        fileCount: 0,
        filesCount: 0,
        files: [],
      });
    }
    const folder = byFolder.get(folderName);
    folder.files.push(portalFileEntryFromRow(row));
    folder.fileCount = folder.files.length;
    folder.filesCount = folder.files.length;
  }
  return {
    folders: [...byFolder.values()],
    keyValues: [],
    tables: [],
    filesScrapeStatus: "complete",
  };
}

async function fetchScrapeJobGuard(supabase, projectId, scrapeJobId) {
  const { data: job, error: jobErr } = await supabase
    .from("scrape_jobs")
    .select("id, project_id, status, started_at, completed_at")
    .eq("id", scrapeJobId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (jobErr) throw jobErr;
  if (!job) return { ok: false, reason: "job_not_found" };

  if (job.status === "cancelled" || job.status === "failed") {
    return { ok: false, reason: "job_not_successful", job };
  }

  const { data: newer, error: newerErr } = await supabase
    .from("scrape_jobs")
    .select("id, status, started_at")
    .eq("project_id", projectId)
    .gt("started_at", job.started_at)
    .in("status", ["running", "queued", "completed", "completed_with_warnings"])
    .order("started_at", { ascending: false })
    .limit(1);
  if (newerErr) throw newerErr;
  if (newer && newer.length > 0 && newer[0].id !== scrapeJobId) {
    return { ok: false, reason: "superseded_by_newer_job", job, newerJob: newer[0] };
  }

  return { ok: true, job };
}

/**
 * Reconcile scrape_file_results into projects.portal_data.tabs.files only.
 * Reads latest portal_data from DB; never uses in-memory session snapshot.
 *
 * Concurrency: latest-job guard + project_id + scrape_job_id verification before write.
 */
async function reconcileRunFilesToPortalData(supabase, opts) {
  const projectId = opts?.projectId ? String(opts.projectId).trim() : "";
  const scrapeJobId = opts?.scrapeJobId ? String(opts.scrapeJobId).trim() : "";
  const hashPortalData = opts?.hashPortalData;
  const requireSuccessfulJob = opts?.requireSuccessfulJob !== false;

  if (!supabase || !projectId || !scrapeJobId || typeof hashPortalData !== "function") {
    return { ok: false, reason: "invalid_args" };
  }

  try {
    const guard = await fetchScrapeJobGuard(supabase, projectId, scrapeJobId);
    if (!guard.ok) {
      console.log(
        `[file-reconcile] skipped project=${projectId} job=${scrapeJobId} reason=${guard.reason}`,
      );
      return { ok: false, reason: guard.reason };
    }

    if (
      requireSuccessfulJob &&
      !SUCCESSFUL_JOB_STATUSES.has(guard.job.status) &&
      guard.job.status !== "running"
    ) {
      return { ok: false, reason: "job_not_completed" };
    }

    const rows = await listRunFiles(supabase, scrapeJobId);
    const reconciledFilesTab = buildFilesTabFromRows(rows);

    const { data: projectRows, error: readErr } = await supabase
      .from("projects")
      .select("id, portal_data, portal_data_hash, permit_number")
      .eq("id", projectId)
      .limit(1);
    if (readErr) throw readErr;
    const existingRow =
      projectRows && projectRows.length > 0 ? projectRows[0] : null;
    if (!existingRow) return { ok: false, reason: "project_not_found" };

    const latestPortalData =
      existingRow.portal_data && typeof existingRow.portal_data === "object"
        ? JSON.parse(JSON.stringify(existingRow.portal_data))
        : {};

    const existingTabs =
      latestPortalData.tabs && typeof latestPortalData.tabs === "object"
        ? latestPortalData.tabs
        : {};

    const mergedPortalData = {
      ...latestPortalData,
      tabs: {
        ...existingTabs,
        files: reconciledFilesTab,
      },
    };

    const mergedHash = hashPortalData(mergedPortalData);
    if (
      existingRow.portal_data_hash === mergedHash &&
      JSON.stringify(existingTabs.files || null) ===
        JSON.stringify(reconciledFilesTab)
    ) {
      console.log(
        `[file-reconcile] hash match — files unchanged project=${projectId} job=${scrapeJobId}`,
      );
      return { ok: true, skipped: true, fileCount: rows.length };
    }

    const { error: updateErr } = await supabase
      .from("projects")
      .update({
        portal_data: mergedPortalData,
        portal_data_hash: mergedHash,
        last_checked_at: new Date().toISOString(),
      })
      .eq("id", projectId);

    if (updateErr) throw updateErr;

    console.log(
      `[file-reconcile] ok project=${projectId} job=${scrapeJobId} files=${reconciledFilesTab.folders.reduce((s, f) => s + (f.files?.length || 0), 0)}`,
    );
    return {
      ok: true,
      fileCount: rows.length,
      folderCount: reconciledFilesTab.folders.length,
    };
  } catch (err) {
    logPersistenceError("reconcileRunFilesToPortalData", err);
    return { ok: false, reason: "reconcile_error" };
  }
}

/**
 * PGC targeted retry: update existing portal_data file rows in place by fileId
 * from this job's scrape_file_results. Never replaces the whole files tab with
 * only the retry job's rows (that would wipe untargeted successes).
 */
async function reconcileTargetedFileResultsIntoPortalData(supabase, opts) {
  const projectId = opts?.projectId ? String(opts.projectId).trim() : "";
  const scrapeJobId = opts?.scrapeJobId ? String(opts.scrapeJobId).trim() : "";
  const hashPortalData = opts?.hashPortalData;
  const targetedFileIds = [
    ...new Set(
      [...(opts?.targetedFileIds || [])]
        .map((x) => String(x || "").trim())
        .filter(Boolean),
    ),
  ];

  if (
    !supabase ||
    !projectId ||
    !scrapeJobId ||
    typeof hashPortalData !== "function" ||
    targetedFileIds.length === 0
  ) {
    return { ok: false, reason: "invalid_args" };
  }

  try {
    const pgcRetry = require("./pgc-retry-artifacts.js");
    const rows = await listRunFiles(supabase, scrapeJobId);
    const terminal = rows.filter(
      (r) =>
        TERMINAL_FILE_STATUSES.has(r.status) &&
        targetedFileIds.includes(String(r.portal_file_id || "").trim()),
    );
    if (!terminal.length) {
      return { ok: true, skipped: true, reason: "no_terminal_targeted_rows" };
    }

    const updates = [];
    for (const row of terminal) {
      const u = pgcRetry.portalFilePatchFromScrapeRow(row);
      // Retry count is already bumped during in-session merge; do not double-count.
      if (u) updates.push({ ...u, bumpRetry: false });
    }
    if (!updates.length) {
      return { ok: true, skipped: true, reason: "no_patches" };
    }

    const { data: projectRows, error: readErr } = await supabase
      .from("projects")
      .select("id, portal_data, portal_data_hash")
      .eq("id", projectId)
      .limit(1);
    if (readErr) throw readErr;
    const existingRow =
      projectRows && projectRows.length > 0 ? projectRows[0] : null;
    if (!existingRow) return { ok: false, reason: "project_not_found" };

    const latestPortalData =
      existingRow.portal_data && typeof existingRow.portal_data === "object"
        ? JSON.parse(JSON.stringify(existingRow.portal_data))
        : {};
    const existingTabs =
      latestPortalData.tabs && typeof latestPortalData.tabs === "object"
        ? latestPortalData.tabs
        : {};
    const priorFolders = existingTabs.files?.folders || [];
    if (!Array.isArray(priorFolders) || priorFolders.length === 0) {
      return { ok: false, reason: "no_prior_files_tab" };
    }

    const mergedFolders = pgcRetry.applyFileUpdatesByFileId(
      priorFolders,
      updates,
    );
    const counts = pgcRetry.summarizeFolderDownloadCounts(mergedFolders);
    const mergedPortalData = {
      ...latestPortalData,
      tabs: {
        ...existingTabs,
        files: {
          ...(existingTabs.files || {}),
          folders: mergedFolders,
          keyValues: existingTabs.files?.keyValues || [],
          tables: existingTabs.files?.tables || [],
        },
      },
    };
    const mergedHash = hashPortalData(mergedPortalData);

    const { error: updateErr } = await supabase
      .from("projects")
      .update({
        portal_data: mergedPortalData,
        portal_data_hash: mergedHash,
        last_checked_at: new Date().toISOString(),
      })
      .eq("id", projectId);
    if (updateErr) throw updateErr;

    console.log(
      `[file-reconcile-targeted] ok project=${projectId} job=${scrapeJobId} updated=${updates.length} totals=${counts.ok}ok/${counts.failed}failed/${counts.total}total`,
    );
    return {
      ok: true,
      updated: updates.length,
      counts,
    };
  } catch (err) {
    logPersistenceError("reconcileTargetedFileResultsIntoPortalData", err);
    return { ok: false, reason: "reconcile_error" };
  }
}

module.exports = {
  TERMINAL_FILE_STATUSES,
  createFileProgressContext,
  upsertFileDiscovered,
  markFileDownloading,
  markFileRetrying,
  markFileUploaded,
  markFileFailed,
  markFileSkipped,
  supersedeProjectFailedRowsForFile,
  listRunFiles,
  buildUploadedCheckpointMap,
  checkpointKeyForFile,
  buildFilesTabFromRows,
  portalFileEntryFromRow,
  reconcileRunFilesToPortalData,
  reconcileTargetedFileResultsIntoPortalData,
  sanitizeFailureMessage,
  downloadStatusFromRow,
};
