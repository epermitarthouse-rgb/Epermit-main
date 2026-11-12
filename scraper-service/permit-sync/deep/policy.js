"use strict";

/**
 * Pure decisions for the DC deep pass (D-058, D-059). No I/O.
 *
 *   sectionHashes(batch)      the JSON pass's per-section content hashes (the gate's input)
 *   planDeepPass(input)       whether the deep pass runs for a permit, and which manual tabs it reads
 *   buildFileGate(documents)  the `deepOptions.fileGate` callback for extractFilesTab
 *   documentPath / reportPath private-bucket object paths
 *   reportContent(entry)      the record_permit_report_content payload for one manual report entry
 */

const { sha256 } = require("../core/canonical");
const { normalizeReportText } = require("../../lib/portal-content-hash");

const BUCKET = "permit-documents";
/** The manual scraper's tabs (TAB_DEFS keys, in its order); its Reviews data comes from the Reports tab. */
const ALL_TABS = Object.freeze(["status", "files", "tasks", "info", "reports"]);
/** A change in any of these sections means the portal's report output may have changed (D-059). */
const REPORT_INPUT_SECTIONS = Object.freeze(["status", "reviews", "tasks", "workflows"]);
/** Never attempted: portal-downloadable rows start not_requested, viewer-only rows not_permitted (D-082). */
const NEVER_ATTEMPTED = new Set(["not_requested", "pending", "not_permitted"]);
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_MAX_FILE_BYTES = 200 * 1024 * 1024;

/**
 * How the deep pass may fetch a document (D-082): "download" when the portal's folder flag allows downloads,
 * "viewer" (the file viewer's own retrieval) when the flag is false, null when the flag is unknown.
 */
function captureAccessPath(doc) {
  if (!doc) return null;
  if (doc.download_permitted === true) return "download";
  if (doc.download_permitted === false) return "viewer";
  return null;
}

/** Per-file limit and attempt cap: PERMIT_SYNC_DEEP_MAX_FILE_BYTES / _MAX_ATTEMPTS; a job's max_file_bytes only lowers it. */
function captureLimits(env = {}, options = {}) {
  const envFile = capValue(env.PERMIT_SYNC_DEEP_MAX_FILE_BYTES, DEFAULT_MAX_FILE_BYTES) || DEFAULT_MAX_FILE_BYTES;
  const jobFile = capValue(options && options.max_file_bytes, envFile) || envFile;
  return {
    maxFileBytes: Math.min(envFile, jobFile),
    maxAttempts: Math.max(1, capValue(env.PERMIT_SYNC_DEEP_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS)),
  };
}

function timeOf(v) {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Retry rule for a failed item (D-080): never past maxAttempts; otherwise once its next eligible time has
 * passed, or at once when its inputs changed on the portal.
 * @returns {"due"|"backoff"|"exhausted"}
 */
function retryState({ attempts = 0, nextAt = null, now, maxAttempts, inputsChanged = false }) {
  if ((Number(attempts) || 0) >= maxAttempts) return "exhausted";
  if (inputsChanged) return "due";
  const t = timeOf(nextAt);
  return t === null || t <= now ? "due" : "backoff";
}

/**
 * One document's capture state for this pass.
 * @returns {"stored"|"unknown_permission"|"pending"|"retry_due"|"retry_backoff"|"retry_exhausted"|"defer_oversize"|"deferred_oversize"}
 *   pending / retry_due: fetch now; defer_oversize: record deferred_oversize (not yet recorded);
 *   deferred_oversize: already recorded, still too large.
 */
function documentState(d, { now = Date.now(), maxAttempts = DEFAULT_MAX_ATTEMPTS, maxFileBytes = DEFAULT_MAX_FILE_BYTES, filesChanged = false } = {}) {
  if (!captureAccessPath(d)) return "unknown_permission";
  if (d.download_status === "stored") return "stored";
  const tooLarge = Number(d.size_bytes) > maxFileBytes;
  if (d.download_status === "deferred_oversize") return tooLarge ? "deferred_oversize" : "pending";
  if (tooLarge) return "defer_oversize";
  if (NEVER_ATTEMPTED.has(d.download_status)) return "pending";
  if (d.download_status === "failed") {
    const r = retryState({ attempts: d.capture_attempts, nextAt: d.capture_next_attempt_at, now, maxAttempts, inputsChanged: filesChanged });
    return r === "due" ? "retry_due" : `retry_${r}`;
  }
  return "pending";
}

/** @returns {"captured"|"pending"|"retry_due"|"retry_backoff"|"retry_exhausted"} */
function reportState(r, { now = Date.now(), maxAttempts = DEFAULT_MAX_ATTEMPTS, inputsChanged = false } = {}) {
  if (r.content_status === "captured") return "captured";
  if (r.content_status !== "failed") return "pending";
  const s = retryState({ attempts: r.content_attempts, nextAt: r.content_next_attempt_at, now, maxAttempts, inputsChanged });
  return s === "due" ? "retry_due" : `retry_${s}`;
}

const FETCH_NOW = new Set(["pending", "retry_due"]);

function safeName(name) {
  const base = String(name || "file").normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+/, "");
  return (base || "file").slice(0, 120);
}

function documentPath(permitId, fileId, fileName) {
  if (!permitId || !fileId) throw new Error("documentPath needs permit id and file id");
  return `${permitId}/files/${fileId}_${safeName(fileName)}`;
}

function reportPath(permitId, reportKey, sha, kind) {
  if (!/^[0-9a-f]{64}$/.test(String(sha))) throw new Error("reportPath needs a sha256");
  return `${permitId}/reports/${safeName(reportKey)}/${sha}.${kind === "excel" ? "xlsx" : "pdf"}`;
}

/** Section name -> content hash, or the section status when it produced no data. */
function sectionHashes(batch) {
  const out = {};
  for (const [name, s] of Object.entries((batch && batch.sections) || {})) out[name] = s.hash || `status:${s.status}`;
  return out;
}

function changedSections(previous, current) {
  if (!previous) return Object.keys(current);
  const names = new Set([...Object.keys(previous), ...Object.keys(current)]);
  return [...names].filter((n) => previous[n] !== current[n]);
}

/**
 * @param {object} input
 * @param {Record<string,string>|null} input.previousHashes section hashes of the last completed deep pass
 * @param {Record<string,string>} input.hashes this JSON pass's section hashes
 * @param {Array<{ syncedHashes?: Record<string,string>|null }>} input.links linked projects (project_permits)
 * @param {Array<{ download_permitted: boolean, download_status: string }>} input.documents
 * @param {Array<{ content_status: string }>} input.reports
 * @returns {{ run: boolean, tabs: string[], reasons: string[], pendingDocuments: number, pendingReports: number }}
 */
function planDeepPass({ previousHashes = null, hashes, links = [], documents = [], reports = [], now = Date.now(), limits = {}, captureHash = null }) {
  const changed = changedSections(previousHashes, hashes);
  const filesChanged = changed.includes("files");
  const reportInputsChanged = changed.some((n) => REPORT_INPUT_SECTIONS.includes(n));
  const docOpts = { now, maxAttempts: limits.maxAttempts || DEFAULT_MAX_ATTEMPTS, maxFileBytes: limits.maxFileBytes || DEFAULT_MAX_FILE_BYTES, filesChanged };
  const docStates = documents.map((d) => [d, documentState(d, docOpts)]);
  const pendingDocuments = docStates.filter(([, s]) => FETCH_NOW.has(s)).length;
  const deferDocuments = docStates.filter(([, s]) => s === "defer_oversize").map(([d]) => d);
  const repOpts = { now, maxAttempts: docOpts.maxAttempts, inputsChanged: reportInputsChanged };
  const pendingReports = reports.filter((r) => FETCH_NOW.has(reportState(r, repOpts))).length;
  const staleLinks = links.filter((l) => changedSections(l.syncedHashes || null, hashes).length > 0).length;
  // D-085: a linked project that has not seen the latest stored files/reports gets them on the next pass.
  const captureStale = captureHash ? links.filter((l) => l.captureHash !== captureHash).length : 0;

  const reasons = [];
  const tabs = new Set();
  if (staleLinks) {
    reasons.push("linked_project_stale");
    ALL_TABS.forEach((t) => tabs.add(t));
  }
  if (pendingDocuments) {
    reasons.push("documents_pending");
    tabs.add("files");
  }
  if (pendingReports || (reportInputsChanged && reports.length > 0 && previousHashes)) {
    reasons.push(pendingReports ? "reports_pending" : "report_inputs_changed");
    tabs.add("reports");
  }
  if (captureStale && !staleLinks) {
    reasons.push("linked_project_capture_stale");
    tabs.add("files");
  }
  const ordered = ALL_TABS.filter((t) => tabs.has(t));
  return { run: ordered.length > 0, tabs: ordered, reasons, pendingDocuments, pendingReports, deferDocuments, changed, filesChanged, reportInputsChanged };
}

/**
 * Open items after a pass, for the job outcome (D-086): documents and reports that are still not stored /
 * captured, by reason. Unknown-permission documents are not counted (nothing can fetch them).
 */
function openItems({ documents = [], reports = [], now = Date.now(), limits = {} }) {
  const out = { files_pending: 0, files_deferred_oversize: 0, files_failed_open: 0, reports_open: 0 };
  const docOpts = { now, maxAttempts: limits.maxAttempts || DEFAULT_MAX_ATTEMPTS, maxFileBytes: limits.maxFileBytes || DEFAULT_MAX_FILE_BYTES };
  for (const d of documents) {
    const s = documentState(d, docOpts);
    if (s === "pending") out.files_pending += 1;
    else if (s === "defer_oversize" || s === "deferred_oversize") out.files_deferred_oversize += 1;
    else if (s.startsWith("retry_")) out.files_failed_open += 1;
  }
  for (const r of reports) if (r.content_status !== "captured") out.reports_open += 1;
  return out;
}

/** Fingerprint of what is stored for a permit (D-085): stored files by sha256, captured reports by version id. */
function captureHash(documents = [], reports = []) {
  const parts = [
    ...documents.filter((d) => d.download_status === "stored" && d.sha256).map((d) => `f:${d.portal_file_id}:${d.sha256}`),
    ...reports.filter((r) => r.content_status === "captured" && r.latest_content_id).map((r) => `r:${r.report_key}:${r.latest_content_id}`),
  ].sort();
  return sha256(parts);
}

const DEFAULT_MAX_FILES = 10;
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

function capValue(raw, fallback) {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/**
 * Per-job download caps (D-074): PERMIT_SYNC_DEEP_MAX_FILES / PERMIT_SYNC_DEEP_MAX_BYTES (defaults 10 files,
 * 50 MiB), lowered further by the job's options.max_files / max_bytes. A job option can never raise the env cap.
 */
function downloadLimits(env = {}, options = {}) {
  const envFiles = capValue(env.PERMIT_SYNC_DEEP_MAX_FILES, DEFAULT_MAX_FILES);
  const envBytes = capValue(env.PERMIT_SYNC_DEEP_MAX_BYTES, DEFAULT_MAX_BYTES);
  const o = options || {};
  return {
    maxFiles: Math.min(envFiles, capValue(o.max_files, envFiles)),
    maxBytes: Math.min(envBytes, capValue(o.max_bytes, envBytes)),
  };
}

/** Mutable per-job budget shared by every permit's file gate. Sizes from the portal metadata are reserved up front. */
function createDownloadBudget({ maxFiles, maxBytes }) {
  const reserved = new Map();
  const b = {
    maxFiles, maxBytes, files: 0, bytes: 0, capped: 0,
    /** @returns {null|string} the cap that refuses this file, or null after reserving it */
    take(fileId, sizeBytes) {
      const size = Number.isFinite(Number(sizeBytes)) && Number(sizeBytes) > 0 ? Number(sizeBytes) : 0;
      if (b.files >= b.maxFiles) return "cap_files";
      // D-083: the per-file limit is separate; one file larger than the whole byte budget may be the job's
      // first download, so a file under the per-file limit is never stuck behind a smaller job budget.
      if (b.maxBytes === 0 || b.bytes >= b.maxBytes || (b.files > 0 && b.bytes + size > b.maxBytes)) return "cap_bytes";
      b.files += 1;
      b.bytes += size;
      reserved.set(String(fileId), size);
      return null;
    },
    /** Replaces the reservation with the stored size (unknown sizes count once stored). */
    settle(fileId, actualBytes) {
      const r = reserved.get(String(fileId)) || 0;
      reserved.delete(String(fileId));
      b.bytes += Math.max(0, Number(actualBytes) || 0) - r;
    },
  };
  return b;
}

/**
 * fileGate for extractFilesTab: fetch only documents in the repository that are not yet stored (ProjectDox
 * gives every new version a new FileID, so a new version is a new row): downloadable ones and, through the
 * file viewer, view-only ones (D-082). Failed ones follow the retry rule, oversize ones are deferred, and
 * the rest share the job's download budget; a capped file stays pending for a later job.
 */
function buildFileGate(documents, { filesChanged = false, retryFailed = filesChanged, budget = null, now = Date.now(), limits = {} } = {}) {
  const byFileId = new Map(documents.map((d) => [String(d.portal_file_id), d]));
  const opts = { now, maxAttempts: limits.maxAttempts || DEFAULT_MAX_ATTEMPTS, maxFileBytes: limits.maxFileBytes || DEFAULT_MAX_FILE_BYTES, filesChanged: retryFailed };
  return (fileId) => {
    const d = byFileId.get(String(fileId));
    if (!d) return { download: false, reason: "not_in_repository" };
    const state = documentState(d, opts);
    if (state === "unknown_permission") return { download: false, reason: "not_permitted" };
    if (state === "stored") {
      return { download: false, reason: "already_stored", previous: { bucket: BUCKET, storagePath: d.storage_path, sha256: d.sha256 } };
    }
    if (state === "defer_oversize" || state === "deferred_oversize") return { download: false, reason: "deferred_oversize" };
    if (state === "retry_backoff") return { download: false, reason: "retry_backoff" };
    if (state === "retry_exhausted") return { download: false, reason: "retry_exhausted" };
    if (budget) {
      const cap = budget.take(fileId, d.size_bytes);
      if (cap) {
        budget.capped += 1;
        return { download: false, reason: cap };
      }
    }
    return { download: true, reason: state === "retry_due" ? "retry" : "pending", accessPath: captureAccessPath(d) };
  };
}

const PDF_MAGIC = Buffer.from("%PDF-");

/** Which RetrieveFile variant served a body (D-084): the original, the PDF rendition, or unknown. */
function fileSource(downloadUrl) {
  const s = String(downloadUrl || "");
  if (!/\/File\/RetrieveFile/i.test(s)) return { endpoint: s ? "other" : "unknown", isRendition: null };
  if (/[?&]convertToPDF=true/i.test(s)) return { endpoint: "retrieve_file_rendition", isRendition: true };
  return { endpoint: "retrieve_file_original", isRendition: false };
}

/**
 * Content checks before a body is stored (D-084, 3f). A failure is recorded as failed (retryable).
 *   - empty body, HTML instead of a file, a .pdf without the PDF signature: refused
 *   - an original smaller than the portal's FileSize: refused as truncated (never stored silently)
 *   - any other size difference (renditions, unknown source): stored, size_matches_portal = false
 * @returns {{ ok: true, sizeMatchesPortal: boolean|null, contentType: string } | { ok: false, error: string }}
 */
function validateFileBody({ buf, fileName, portalSize, isRendition, fallbackContentType }) {
  const size = buf ? buf.length : 0;
  if (!size) return { ok: false, error: "empty_body" };
  const head = buf.subarray(0, Math.min(size, 512)).toString("latin1").trimStart().toLowerCase();
  const isPdf = buf.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC);
  if (!isPdf && (head.startsWith("<!doctype html") || head.startsWith("<html"))) return { ok: false, error: "html_instead_of_file" };
  if (/\.pdf$/i.test(String(fileName || "")) && !isPdf) return { ok: false, error: "not_a_pdf" };
  const expected = Number(portalSize);
  const known = Number.isFinite(expected) && expected > 0;
  if (known && isRendition === false && size < expected) return { ok: false, error: `truncated: ${size} of ${expected} bytes` };
  const contentType = isPdf ? "application/pdf" : buf.subarray(0, 2).toString("latin1") === "PK" && /\.xlsx$/i.test(String(fileName || ""))
    ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : fallbackContentType || "application/octet-stream";
  return { ok: true, sizeMatchesPortal: known ? size === expected : null, contentType };
}

/** Report text + structured rows hash; binaries are versioned by this, not by their own bytes (SSRS embeds render times). */
function reportContent(entry, refs = {}) {
  const text = String((entry && entry.text) || "");
  // The manual scraper sets entry.structuredRows (register-execution-routes pdfEntry); the old name is a fallback.
  const raw = entry && (Array.isArray(entry.structuredRows) ? entry.structuredRows : entry.reviewCommentsStructuredRows);
  const rows = Array.isArray(raw) ? raw : null;
  // The render time SSRS prints on every export is not report content (D-072).
  const content = { sha256: sha256({ text: normalizeReportText(text), structured_rows: rows }), text, structured_rows: rows, source: "ssrs_export" };
  if (refs.pdf) Object.assign(content, { pdf_path: refs.pdf.path, pdf_sha256: refs.pdf.sha256, pdf_size: refs.pdf.size });
  if (refs.excel) Object.assign(content, { excel_path: refs.excel.path, excel_sha256: refs.excel.sha256, excel_size: refs.excel.size });
  return content;
}

/** True when the manual entry carries report content worth recording. */
function reportCaptured(entry) {
  return Boolean(entry && !entry.error && ((entry.text && entry.text.length > 0) || entry.pdfStorageRef || entry.excelStorageRef));
}

function normName(s) {
  return String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Manual report entries are keyed by their title on the Reports tab; permit_reports rows by QueryReportID. */
function matchReport(reports, reportName) {
  const n = normName(reportName);
  return reports.find((r) => normName(r.name) === n) || null;
}

/**
 * The ReportViewer.aspx URL the Reports tab opens for one report (EXTRACTION_SPEC_DC: ReportID, ReportPath,
 * DataSourceName, then GetReportList's ReportParamQueryString). Without list metadata the report title stands in
 * for ReportPath, so a deny-pattern word in the title is still caught.
 * @param {{ reportId?: string, key?: string, name?: string, viewer?: { reportPath: string, dataSourceName: string, paramQuery: string } }} item
 */
function reportViewerUrl(item, origin, portalRecordId) {
  const v = (item && item.viewer) || null;
  const id = String((item && (item.reportId || item.key)) || "");
  const params = v
    ? `ReportID=${id}&ReportPath=${v.reportPath}&DataSourceName=${v.dataSourceName}${v.paramQuery}`
    : `ReportID=${id}&ReportPath=${String((item && item.name) || "")}&ProjectID=${String(portalRecordId || "")}`;
  return `${origin}/WebForms/ReportViewer.aspx?${encodeURI(params)}`;
}

/** Method, host and path of a request, for guard events (no query values). */
function requestLocation(method, url) {
  try {
    const u = new URL(url);
    return { method: String(method || "GET").toUpperCase(), host: u.hostname, path: u.pathname };
  } catch (_) {
    return { method: String(method || "GET").toUpperCase(), host: null, path: null };
  }
}

module.exports = {
  BUCKET,
  ALL_TABS,
  REPORT_INPUT_SECTIONS,
  safeName,
  documentPath,
  reportPath,
  sectionHashes,
  changedSections,
  planDeepPass,
  buildFileGate,
  downloadLimits,
  captureLimits,
  captureAccessPath,
  documentState,
  reportState,
  retryState,
  openItems,
  captureHash,
  fileSource,
  validateFileBody,
  createDownloadBudget,
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_ATTEMPTS,
  reportContent,
  reportCaptured,
  matchReport,
  normName,
  reportViewerUrl,
  requestLocation,
};
