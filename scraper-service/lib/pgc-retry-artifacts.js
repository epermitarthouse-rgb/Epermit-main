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
 * Preserve untargeted file rows (successful or pending) when a targeted retry
 * rewrites folders — prevents wiping ~N successful/pending rows.
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
  if (targeted.size === 0) return next.length ? next : prior;

  const priorByFolder = new Map();
  for (const folder of prior) {
    const key = String(folder.folderID || folder.folderId || folder.name || "");
    priorByFolder.set(key, folder);
  }

  return next.map((folder) => {
    const key = String(folder.folderID || folder.folderId || folder.name || "");
    const priorFolder = priorByFolder.get(key);
    const priorFiles = Array.isArray(priorFolder?.files) ? priorFolder.files : [];
    const priorById = new Map(
      priorFiles
        .map((f) => [String(f.fileId || f.fileID || "").trim(), f])
        .filter(([id]) => !!id),
    );
    const nextFiles = Array.isArray(folder.files) ? folder.files : [];
    const mergedFiles = nextFiles.map((f) => {
      const id = String(f.fileId || f.fileID || "").trim();
      if (!id || targeted.has(id)) {
        const retryCount =
          (Number(priorById.get(id)?.retryCount) || 0) + (targeted.has(id) ? 1 : 0);
        return targeted.has(id) ? { ...f, retryCount } : f;
      }
      const prev = priorById.get(id);
      if (!prev) return f;
      // Untargeted: keep prior durable status/URLs (do not demote success → pending).
      return {
        ...f,
        ...prev,
        name: f.name || prev.name,
        fileId: id,
      };
    });
    // Include prior files missing from discovery snapshot.
    for (const [id, prev] of priorById) {
      if (mergedFiles.some((f) => String(f.fileId || "").trim() === id)) continue;
      mergedFiles.push(prev);
    }
    return { ...folder, files: mergedFiles };
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

module.exports = {
  parsePgcRetryArtifacts,
  buildPgcRetryPipelineOpts,
  explicitFileIdsFromRetryArtifacts,
  matchRetryReportTarget,
  shouldRetryReportFormat,
  mergeReportEntriesPreservingSuccess,
  mergeFolderFilesPreservingUntargeted,
  pgcReportStoragePath,
};
