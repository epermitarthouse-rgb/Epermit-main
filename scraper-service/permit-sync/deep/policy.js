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
const PENDING_DOCUMENT = new Set(["not_requested", "pending"]);

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
function planDeepPass({ previousHashes = null, hashes, links = [], documents = [], reports = [] }) {
  const changed = changedSections(previousHashes, hashes);
  const filesChanged = changed.includes("files");
  const reportInputsChanged = changed.some((n) => REPORT_INPUT_SECTIONS.includes(n));
  const pendingDocuments = documents.filter(
    (d) => d.download_permitted === true && (PENDING_DOCUMENT.has(d.download_status) || (filesChanged && d.download_status === "failed")),
  ).length;
  const pendingReports = reports.filter(
    (r) => r.content_status === "not_captured" || (reportInputsChanged && r.content_status === "failed"),
  ).length;
  const staleLinks = links.filter((l) => changedSections(l.syncedHashes || null, hashes).length > 0).length;

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
  const ordered = ALL_TABS.filter((t) => tabs.has(t));
  return { run: ordered.length > 0, tabs: ordered, reasons, pendingDocuments, pendingReports, changed };
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
      if (b.bytes >= b.maxBytes || b.bytes + size > b.maxBytes) return "cap_bytes";
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
 * fileGate for extractFilesTab: download only documents the JSON pass stored as permitted and not yet
 * captured (ProjectDox gives every new version a new FileID, so a new version is a new row), within the
 * job's download budget. A capped file stays pending for a later job.
 */
function buildFileGate(documents, { retryFailed = false, budget = null } = {}) {
  const byFileId = new Map(documents.map((d) => [String(d.portal_file_id), d]));
  return (fileId) => {
    const d = byFileId.get(String(fileId));
    if (!d) return { download: false, reason: "not_in_repository" };
    if (d.download_permitted !== true) return { download: false, reason: "not_permitted" };
    if (d.download_status === "stored") {
      return { download: false, reason: "already_stored", previous: { bucket: BUCKET, storagePath: d.storage_path, sha256: d.sha256 } };
    }
    if (d.download_status === "failed" && !retryFailed) return { download: false, reason: "failed_earlier" };
    if (budget) {
      const cap = budget.take(fileId, d.size_bytes);
      if (cap) {
        budget.capped += 1;
        return { download: false, reason: cap };
      }
    }
    return { download: true, reason: "pending" };
  };
}

/** Report text + structured rows hash; binaries are versioned by this, not by their own bytes (SSRS embeds render times). */
function reportContent(entry, refs = {}) {
  const text = String((entry && entry.text) || "");
  const rows = Array.isArray(entry && entry.reviewCommentsStructuredRows) ? entry.reviewCommentsStructuredRows : null;
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
  createDownloadBudget,
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_BYTES,
  reportContent,
  reportCaptured,
  matchReport,
};
