"use strict";

/**
 * PGC-only helpers for targeted retry of failed files/report artifacts.
 * Pure parsing/merge logic — no browser I/O.
 */

function safeStr(value, maxLen = 300) {
  if (value == null) return "";
  const text = String(value).trim();
  if (!text) return "";
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

function normKey(value) {
  return safeStr(value, 500).toLowerCase();
}

function fileIdOf(file) {
  return String(file?.fileId || file?.fileID || "").trim();
}

function folderKeyOf(folder) {
  return String(
    folder?.folderID ||
      folder?.folderId ||
      folder?.name ||
      folder?.folderName ||
      "",
  );
}

function isSuccessDownloadStatus(status) {
  const st = String(status || "")
    .trim()
    .toLowerCase();
  return (
    st === "ok" ||
    st === "success" ||
    st === "uploaded" ||
    st === "downloaded" ||
    st === "complete"
  );
}

function isFailedDownloadStatus(status) {
  const st = String(status || "")
    .trim()
    .toLowerCase();
  return st === "failed" || st.startsWith("failed_");
}

function isSkippedDownloadStatus(status) {
  const st = String(status || "")
    .trim()
    .toLowerCase();
  return st === "activation_skipped" || st.startsWith("skipped");
}

function fileRank(file) {
  const st = String(file?.downloadStatus || "")
    .trim()
    .toLowerCase();
  const hasUrl = !!(file?.publicUrl || file?.viewUrl || file?.downloadUrl);
  if (isSuccessDownloadStatus(st) || (hasUrl && !isFailedDownloadStatus(st))) {
    return 3;
  }
  if (isFailedDownloadStatus(st)) return 2;
  if (isSkippedDownloadStatus(st)) return 1;
  return 0;
}

/** Prefer durable success + URL over failed/pending duplicates for the same fileId. */
function preferFileRecord(a, b) {
  if (!a) return b;
  if (!b) return a;
  const ra = fileRank(a);
  const rb = fileRank(b);
  if (ra !== rb) return ra > rb ? a : b;
  const retryA = Number(a.retryCount) || 0;
  const retryB = Number(b.retryCount) || 0;
  if (retryA !== retryB) return retryA > retryB ? a : b;
  return a;
}

/**
 * @param {unknown} raw
 * @returns {{ files: Array<{ portalFileId: string, fileVersion?: string, fileName?: string }>, reports: Array<{ fileSlug?: string, reportName?: string, formats: Array<"pdf"|"excel"> }> } | null}
 */
function parsePgcRetryArtifacts(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const files = [];
  const seenFiles = new Set();
  if (Array.isArray(raw.files)) {
    for (const f of raw.files) {
      if (!f || typeof f !== "object") continue;
      const portalFileId = safeStr(
        f.portalFileId || f.fileId || f.portal_file_id,
        80,
      );
      if (!portalFileId || seenFiles.has(portalFileId)) continue;
      seenFiles.add(portalFileId);
      const fileVersion = safeStr(f.fileVersion || f.file_version || f.version, 40);
      const fileName = safeStr(f.fileName || f.file_name || f.name, 300);
      files.push({
        portalFileId,
        ...(fileVersion ? { fileVersion } : {}),
        ...(fileName ? { fileName } : {}),
      });
    }
  }

  const reports = [];
  const seenReports = new Set();
  if (Array.isArray(raw.reports)) {
    for (const r of raw.reports) {
      if (!r || typeof r !== "object") continue;
      const fileSlug = safeStr(r.fileSlug || r.sourceReportId || r.slug, 120);
      const reportName = safeStr(r.reportName || r.name, 300);
      const key = fileSlug || reportName;
      if (!key || seenReports.has(normKey(key))) continue;
      const formatsRaw = Array.isArray(r.formats) ? r.formats : [];
      const formats = [
        ...new Set(
          formatsRaw
            .map((x) => String(x || "").trim().toLowerCase())
            .filter((x) => x === "pdf" || x === "excel"),
        ),
      ];
      if (formats.length === 0) continue;
      seenReports.add(normKey(key));
      reports.push({
        ...(fileSlug ? { fileSlug } : {}),
        ...(reportName ? { reportName } : {}),
        formats,
      });
    }
  }

  if (files.length === 0 && reports.length === 0) return null;
  return { files, reports };
}

/**
 * @param {{ files?: unknown[], reports?: unknown[] } | null} artifacts
 */
function buildPgcRetryPipelineOpts(artifacts) {
  const files = Array.isArray(artifacts?.files) ? artifacts.files : [];
  const reports = Array.isArray(artifacts?.reports) ? artifacts.reports : [];
  return {
    skipDetail: true,
    skipWorkflow: true,
    skipReview: true,
    skipFiles: files.length === 0,
    skipReports: reports.length === 0,
  };
}

/**
 * @param {unknown} artifacts
 */
function explicitFileIdsFromRetryArtifacts(artifacts) {
  const parsed = artifacts && artifacts.files ? artifacts : parsePgcRetryArtifacts(artifacts);
  if (!parsed?.files?.length) return [];
  return [...new Set(parsed.files.map((f) => String(f.portalFileId)))];
}

/**
 * @param {{ fileSlug?: string, reportName?: string }} report
 * @param {Array<{ fileSlug?: string, reportName?: string, formats: string[] }>} targets
 */
function matchRetryReportTarget(report, targets) {
  if (!Array.isArray(targets) || targets.length === 0) return null;
  const slug = normKey(report.fileSlug);
  const name = normKey(report.reportName);
  for (const t of targets) {
    const tSlug = normKey(t.fileSlug);
    const tName = normKey(t.reportName);
    if (slug && tSlug && slug === tSlug) return t;
    if (name && tName && name === tName) return t;
    if (slug && tName && slug === tName) return t;
    if (name && tSlug && name === tSlug) return t;
  }
  return null;
}

/**
 * @param {string} format
 * @param {{ formats?: string[] } | null} target
 */
function shouldRetryReportFormat(format, target) {
  if (!target) return false;
  const formats = Array.isArray(target.formats) ? target.formats : [];
  return formats.map((f) => String(f).toLowerCase()).includes(String(format).toLowerCase());
}

/**
 * Preserve successful formats / untargeted reports when merging retry results.
 * @param {object[]|null|undefined} priorEntries
 * @param {object[]|null|undefined} nextEntries
 * @param {Array<{ fileSlug?: string, reportName?: string, formats: string[] }>|null|undefined} targets
 */
function mergeReportEntriesPreservingSuccess(priorEntries, nextEntries, targets) {
  const prior = Array.isArray(priorEntries) ? priorEntries : [];
  const next = Array.isArray(nextEntries) ? nextEntries : [];
  if (!targets || targets.length === 0) return next.length ? next : prior;

  const byKey = new Map();
  const keyOf = (e) =>
    normKey(e?.fileSlug || e?.sourceReportId || e?.reportName || "");

  for (const e of prior) {
    const k = keyOf(e);
    if (k) byKey.set(k, { ...e });
  }

  for (const e of next) {
    const k = keyOf(e);
    if (!k) continue;
    const target = matchRetryReportTarget(e, targets);
    const prev = byKey.get(k) || {};
    if (!target) {
      byKey.set(k, { ...prev, ...e });
      continue;
    }
    const merged = { ...prev, ...e };
    if (!shouldRetryReportFormat("pdf", target)) {
      if (prev.pdfUrl) merged.pdfUrl = prev.pdfUrl;
      if (prev.pdfPublicUrl) merged.pdfPublicUrl = prev.pdfPublicUrl;
      if (prev.pdfStatus) merged.pdfStatus = prev.pdfStatus;
      if (prev.pdfDownloaded != null) merged.pdfDownloaded = prev.pdfDownloaded;
      if (prev.pdfError != null) merged.pdfError = prev.pdfError;
      if (prev.pdfExportedAt) merged.pdfExportedAt = prev.pdfExportedAt;
    } else {
      merged.pdfRetries =
        (Number(prev.pdfRetries) || Number(prev.retryCount) || 0) + 1;
    }
    if (!shouldRetryReportFormat("excel", target)) {
      if (prev.excelUrl) merged.excelUrl = prev.excelUrl;
      if (prev.excelPublicUrl) merged.excelPublicUrl = prev.excelPublicUrl;
      if (prev.excelStatus) merged.excelStatus = prev.excelStatus;
      if (prev.excelDownloaded != null) merged.excelDownloaded = prev.excelDownloaded;
      if (prev.excelError != null) merged.excelError = prev.excelError;
      if (prev.excelExportedAt) merged.excelExportedAt = prev.excelExportedAt;
    } else {
      merged.excelRetries =
        (Number(prev.excelRetries) || Number(prev.retryCount) || 0) + 1;
    }
    byKey.set(k, merged);
  }

  // Keep prior reports that were not in next at all.
  for (const e of prior) {
    const k = keyOf(e);
    if (k && !byKey.has(k)) byKey.set(k, { ...e });
  }
  return Array.from(byKey.values());
}

/**
 * Recalculate per-folder file counts after in-place updates.
 * @param {object[]|null|undefined} folders
 */
function recalculateFolderFileCounts(folders) {
  const list = Array.isArray(folders) ? folders : [];
  return list.map((folder) => {
    const files = Array.isArray(folder?.files) ? folder.files : [];
    return {
      ...folder,
      files,
      filesCount: files.length,
      fileCount: files.length,
    };
  });
}

/**
 * Summarize download statuses across folder files (for tests / reconcile logs).
 * @param {object[]|null|undefined} folders
 */
function summarizeFolderDownloadCounts(folders) {
  let ok = 0;
  let failed = 0;
  let pending = 0;
  let skipped = 0;
  const list = Array.isArray(folders) ? folders : [];
  for (const folder of list) {
    for (const file of folder?.files || []) {
      const st = file?.downloadStatus;
      if (isSuccessDownloadStatus(st)) ok += 1;
      else if (isFailedDownloadStatus(st)) failed += 1;
      else if (isSkippedDownloadStatus(st)) skipped += 1;
      else pending += 1;
    }
  }
  return {
    ok,
    failed,
    pending,
    skipped,
    total: ok + failed + pending + skipped,
  };
}

/**
 * Deduplicate file rows by fileId across folders, keeping the preferred record.
 * @param {object[]} folders
 */
function dedupeFoldersByFileId(folders) {
  const seen = new Map();
  /** @type {Array<{ folderIdx: number, file: object }>} */
  const placements = [];
  for (let fi = 0; fi < folders.length; fi++) {
    const files = Array.isArray(folders[fi]?.files) ? folders[fi].files : [];
    for (const file of files) {
      const id = fileIdOf(file);
      if (!id) {
        placements.push({ folderIdx: fi, file });
        continue;
      }
      const prev = seen.get(id);
      if (!prev) {
        seen.set(id, { folderIdx: fi, file });
      } else {
        const preferred = preferFileRecord(prev.file, file);
        seen.set(id, {
          folderIdx: preferred === file ? fi : prev.folderIdx,
          file: preferred,
        });
      }
    }
  }
  const byFolder = folders.map((folder) => ({
    ...folder,
    files: [],
  }));
  for (const { folderIdx, file } of seen.values()) {
    byFolder[folderIdx].files.push(file);
  }
  for (const { folderIdx, file } of placements) {
    byFolder[folderIdx].files.push(file);
  }
  return recalculateFolderFileCounts(byFolder);
}

/**
 * Apply scrape_file_results / retry patches onto portal folders by stable fileId.
 * Updates the original row in place; does not append a second row for the same id.
 * @param {object[]|null|undefined} folders
 * @param {Array<{ fileId: string, patch: object, bumpRetry?: boolean }>|Map<string, object>} updates
 */
function applyFileUpdatesByFileId(folders, updates) {
  const list = Array.isArray(folders)
    ? folders.map((f) => ({
        ...f,
        files: Array.isArray(f.files) ? f.files.map((x) => ({ ...x })) : [],
      }))
    : [];
  /** @type {Map<string, { patch: object, bumpRetry?: boolean }>} */
  const byId = new Map();
  if (updates instanceof Map) {
    for (const [id, patch] of updates) {
      const key = String(id || "").trim();
      if (!key) continue;
      byId.set(key, { patch: patch || {}, bumpRetry: true });
    }
  } else if (Array.isArray(updates)) {
    for (const u of updates) {
      const key = String(u?.fileId || "").trim();
      if (!key) continue;
      byId.set(key, {
        patch: u.patch || {},
        bumpRetry: u.bumpRetry !== false,
      });
    }
  } else if (updates && typeof updates === "object") {
    for (const [id, patch] of Object.entries(updates)) {
      const key = String(id || "").trim();
      if (!key) continue;
      byId.set(key, { patch: patch || {}, bumpRetry: true });
    }
  }
  if (byId.size === 0) return recalculateFolderFileCounts(list);

  const applied = new Set();
  for (const folder of list) {
    folder.files = (folder.files || []).map((file) => {
      const id = fileIdOf(file);
      if (!id || !byId.has(id)) return file;
      const { patch, bumpRetry } = byId.get(id);
      applied.add(id);
      const retryCount =
        (Number(file.retryCount) || 0) + (bumpRetry ? 1 : 0);
      const merged = {
        ...file,
        ...patch,
        fileId: id,
        retryCount:
          patch.retryCount != null ? Number(patch.retryCount) || retryCount : retryCount,
      };
      if (isSuccessDownloadStatus(merged.downloadStatus)) {
        delete merged.downloadError;
      }
      return merged;
    });
  }

  // Targeted ids missing from prior discovery: append into a synthetic folder.
  const missing = [...byId.keys()].filter((id) => !applied.has(id));
  if (missing.length) {
    let targetFolder = list.find((f) => folderKeyOf(f) === "__retry_updates__");
    if (!targetFolder) {
      targetFolder = {
        folderID: null,
        folderName: "Retry updates",
        name: "Retry updates",
        parentFolder: null,
        files: [],
      };
      list.push(targetFolder);
    }
    for (const id of missing) {
      const { patch, bumpRetry } = byId.get(id);
      targetFolder.files.push({
        name: patch.name || id,
        fileId: id,
        downloadStatus: patch.downloadStatus || "pending",
        retryCount: bumpRetry ? 1 : Number(patch.retryCount) || 0,
        ...patch,
        fileId: id,
      });
    }
  }

  return dedupeFoldersByFileId(list);
}

/**
 * Preserve untargeted file rows when a targeted retry rewrites folders.
 * Updates original failed rows in place by fileId (no failed+ok duplicates).
 * Keeps prior folders that are absent from next.
 * @param {object[]|null|undefined} priorFolders
 * @param {object[]|null|undefined} nextFolders
 * @param {string[]|Set<string>|null|undefined} targetedFileIds
 */
function mergeFolderFilesPreservingUntargeted(
  priorFolders,
  nextFolders,
  targetedFileIds,
) {
  const targeted = new Set(
    [...(targetedFileIds || [])].map((x) => String(x).trim()).filter(Boolean),
  );
  const next = Array.isArray(nextFolders) ? nextFolders : [];
  const prior = Array.isArray(priorFolders) ? priorFolders : [];
  if (targeted.size === 0) {
    return recalculateFolderFileCounts(next.length ? next : prior);
  }
  if (!prior.length) {
    return recalculateFolderFileCounts(next);
  }

  /** @type {Map<string, object>} */
  const updates = new Map();
  for (const folder of next) {
    for (const file of folder?.files || []) {
      const id = fileIdOf(file);
      if (!id || !targeted.has(id)) continue;
      const patch = { ...file, fileId: id };
      if (isSuccessDownloadStatus(patch.downloadStatus)) {
        delete patch.downloadError;
      }
      updates.set(id, patch);
    }
  }

  // Start from prior folders so we never drop unrelated discovery rows.
  const base = prior.map((folder) => ({
    ...folder,
    files: Array.isArray(folder.files) ? folder.files.map((f) => ({ ...f })) : [],
  }));

  // Ensure next-only folders exist (new discovery) before applying updates.
  const baseKeys = new Set(base.map(folderKeyOf));
  for (const folder of next) {
    const key = folderKeyOf(folder);
    if (!key || baseKeys.has(key)) continue;
    base.push({
      ...folder,
      files: Array.isArray(folder.files)
        ? folder.files.map((f) => ({ ...f }))
        : [],
    });
    baseKeys.add(key);
  }

  const merged = applyFileUpdatesByFileId(base, updates);

  // Untargeted files that appear only in next (new discovery) — append once.
  const knownIds = new Set();
  for (const folder of merged) {
    for (const file of folder.files || []) {
      const id = fileIdOf(file);
      if (id) knownIds.add(id);
    }
  }
  const byKey = new Map(merged.map((f) => [folderKeyOf(f), f]));
  for (const folder of next) {
    const key = folderKeyOf(folder);
    const dest = byKey.get(key);
    if (!dest) continue;
    for (const file of folder.files || []) {
      const id = fileIdOf(file);
      if (!id || targeted.has(id) || knownIds.has(id)) continue;
      dest.files.push({ ...file, fileId: id });
      knownIds.add(id);
    }
  }

  return dedupeFoldersByFileId(merged);
}

/**
 * Folder IDs that contain at least one targeted fileId (avoid unrelated traversal).
 * @param {string[]} folderIds
 * @param {Map<string, Array<{ file?: { fileId?: string }, fileId?: string }>>|Record<string, Array<{ file?: { fileId?: string }, fileId?: string }>>} filesByFolderId
 * @param {string[]|Set<string>} targetedFileIds
 */
function filterFolderIdsForTargetedRetry(
  folderIds,
  filesByFolderId,
  targetedFileIds,
) {
  const targeted = new Set(
    [...(targetedFileIds || [])].map((x) => String(x).trim()).filter(Boolean),
  );
  const ids = Array.isArray(folderIds) ? folderIds : [];
  if (targeted.size === 0) return ids;

  const getRows = (folderId) => {
    if (!filesByFolderId) return [];
    if (typeof filesByFolderId.get === "function") {
      return filesByFolderId.get(folderId) || [];
    }
    return filesByFolderId[folderId] || [];
  };

  return ids.filter((folderId) => {
    const rows = getRows(folderId);
    return rows.some((row) => {
      const id = String(row?.file?.fileId || row?.fileId || "").trim();
      return id && targeted.has(id);
    });
  });
}

/**
 * Storage path dedupe key for report artifacts — same path reused on retry.
 * @param {string} storagePrefix
 * @param {string} slug
 * @param {"pdf"|"excel"} format
 */
function pgcReportStoragePath(storagePrefix, slug, format) {
  const prefix = safeStr(storagePrefix || "pgc", 120).replace(/^\/+|\/+$/g, "");
  const safeSlug = safeStr(slug || "report", 120).replace(/[^a-zA-Z0-9._-]/g, "_");
  return format === "excel"
    ? `${prefix}/reports/${safeSlug}.xlsx`
    : `${prefix}/reports/${safeSlug}.pdf`;
}

/**
 * Build a portal file patch from a scrape_file_results row.
 * @param {object} row
 */
function portalFilePatchFromScrapeRow(row) {
  if (!row || typeof row !== "object") return null;
  const fileId = String(row.portal_file_id || row.fileId || "").trim();
  if (!fileId) return null;
  const status = String(row.status || "").trim().toLowerCase();
  if (status === "uploaded" || status === "skipped") {
    const url = row.public_url || row.publicUrl || null;
    return {
      fileId,
      patch: {
        name: row.file_name || row.fileName || fileId,
        fileId,
        downloadStatus: status === "skipped" ? "skipped_duplicate" : "ok",
        publicUrl: url,
        viewUrl: url,
        downloadUrl: url,
        version: row.file_version || row.fileVersion || null,
        folderName: row.folder_name || row.folderName || undefined,
        parentFolder: row.parent_folder || row.parentFolder || undefined,
      },
    };
  }
  if (status === "failed") {
    return {
      fileId,
      patch: {
        name: row.file_name || row.fileName || fileId,
        fileId,
        downloadStatus: "failed",
        downloadError:
          row.failure_message || row.failure_code || "Download failed",
        publicUrl: null,
        viewUrl: null,
        downloadUrl: null,
        version: row.file_version || row.fileVersion || null,
      },
    };
  }
  return null;
}

module.exports = {
  parsePgcRetryArtifacts,
  buildPgcRetryPipelineOpts,
  explicitFileIdsFromRetryArtifacts,
  matchRetryReportTarget,
  shouldRetryReportFormat,
  mergeReportEntriesPreservingSuccess,
  mergeFolderFilesPreservingUntargeted,
  applyFileUpdatesByFileId,
  recalculateFolderFileCounts,
  summarizeFolderDownloadCounts,
  dedupeFoldersByFileId,
  filterFolderIdsForTargetedRetry,
  portalFilePatchFromScrapeRow,
  pgcReportStoragePath,
  fileIdOf,
  folderKeyOf,
  preferFileRecord,
  isSuccessDownloadStatus,
  isFailedDownloadStatus,
};
