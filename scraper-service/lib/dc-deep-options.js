"use strict";

/**
 * Optional `deepOptions` for the manual DC scraper (scrapeAll → extractFilesTab / extractPDFsFromPage /
 * downloadProjectDoxFile), used only by the automated deep runner (D-058, D-059, D-060). Without them
 * every manual path behaves exactly as before. Pure helpers so the decisions are unit-testable.
 *
 * deepOptions = {
 *   skipPortalSync: boolean,                       // scrapeAll does not write projects.portal_data
 *   fileGate(fileId, meta) -> { download, reason, previous? },   // checked before any download work
 *   storeFile({ localPath, fileId, fileName }) -> Promise<storageRef|null>,
 *   storeReportArtifact({ localPath, kind: "pdf"|"excel", reportName }) -> Promise<storageRef|null>,
 *   isProtectedPage(page) -> boolean,              // pages the pre-download sweep must not close
 * }
 * storageRef = { bucket, path, sha256, size, contentType }
 */

function normalizeDeepOptions(deep) {
  if (!deep || typeof deep !== "object") return null;
  return deep;
}

/** null = no gate (manual behaviour); otherwise the gate's decision for this file. */
function fileGateDecision(deep, file) {
  if (!deep || typeof deep.fileGate !== "function") return null;
  if (!file || !file.id) return { download: false, reason: "no_file_id" };
  const d = deep.fileGate(String(file.id), { name: file.name, status: file.status }) || {};
  return { download: d.download === true, reason: String(d.reason || (d.download ? "gate_download" : "gate_skip")), previous: d.previous || null };
}

/** Files-tab entry for a file the gate did not download (same shape as the manual entries). */
function gatedFileEntry(file, folderName, decision) {
  const prev = decision.previous || null;
  return {
    name: file.name,
    fileId: file.id,
    folderName,
    status: file.status,
    reviewedBy: file.reviewedBy,
    uploadedDate: file.uploadedDate,
    commentCount: 0,
    comments: [],
    viewUrl: "",
    downloadStatus: prev && prev.storagePath ? "stored" : "not_downloaded",
    downloadGate: decision.reason,
    ...(prev && prev.storagePath ? { storageRef: { bucket: prev.bucket || null, path: prev.storagePath, sha256: prev.sha256 || null } } : {}),
  };
}

function storesPrivately(deep) {
  return Boolean(deep && typeof deep.storeFile === "function");
}

function storesReportsPrivately(deep) {
  return Boolean(deep && typeof deep.storeReportArtifact === "function");
}

function isProtectedPage(deep, page) {
  return Boolean(deep && typeof deep.isProtectedPage === "function" && deep.isProtectedPage(page));
}

module.exports = {
  normalizeDeepOptions,
  fileGateDecision,
  gatedFileEntry,
  storesPrivately,
  storesReportsPrivately,
  isProtectedPage,
};
