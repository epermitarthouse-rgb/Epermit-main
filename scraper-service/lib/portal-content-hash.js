"use strict";

/**
 * Content-only hash of `projects.portal_data` for automated deep syncs (D-072).
 *
 * The manual scraper's payload carries fields that change on every run even when the permit did not:
 * scrape/export times, local temp paths, public/signed storage URLs, SSRS viewer URLs, report screenshots,
 * download outcomes, and the "Generated: <date>" line SSRS prints in every report. Hashing the raw payload
 * therefore changed `portal_data_hash` on every sync and re-ran the agent pipeline (the browser Realtime
 * trigger and the worker both key on that hash). This hash keeps only permit content.
 *
 * Pure; no I/O.
 */

const crypto = require("node:crypto");

/** Keys dropped anywhere in the tree: timing, session, storage location, download/export outcome. */
const VOLATILE_KEYS = new Set([
  // timing
  "scrapedAt", "capturedAt", "downloadedAt", "exportedAt", "pdfExportedAt", "excelExportedAt", "expiresAt",
  "lastCheckedAt", "syncedAt", "durationMs", "elapsedMs",
  // session
  "sessionId", "scraperSessionId",
  // URLs (public, signed, viewer, export): where content lives, not what it is
  "url", "viewUrl", "downloadUrl", "publicUrl", "signedUrl", "viewerUrl", "resolvedViewerUrl", "reportUrl",
  "pdfUrl", "excelUrl", "pdfPublicUrl", "excelPublicUrl", "pdfHttpUrl", "excelHttpUrl", "aliasUrl", "sourceUrl",
  // local temp paths and private storage refs
  "pdfPath", "excelPath", "localPath", "storageRef", "pdfStorageRef", "excelStorageRef",
  // rendered artefacts with embedded render times
  "screenshot", "html",
  // download / export outcome of this run
  "downloadStatus", "downloadError", "downloadGate", "uploadStorageMessage", "filesScrapeStatus",
  "pdfDownloaded", "excelDownloaded", "pdfValid", "excelValid", "excelOoxmlPackageOk", "excelExportMethod",
  "exportUnavailable", "viewerReady", "flags",
  // scrape progress (also removed by stripPortalSyncTransientFields)
  "portalFilesScrapeStatus", "portalFilesScrapeLabel",
]);

/** Top-level bookkeeping written by PermitPilot itself (parser cursor, canonical address meta, deep sync state). */
const TOP_LEVEL_BOOKKEEPING = new Set(["_permitpilot", "meta", "permitRepositorySync"]);

/** Generic timestamp-like key names: scrapedOn, renderedTime, exportTimestamp, ... */
const VOLATILE_KEY_RE = /^(scraped|captured|downloaded|exported|fetched|generated|rendered|synced|checked|refreshed)(At|On|Time|Timestamp)$/i;

/** Query parameters that make a URL signed or session-bound; such strings are replaced wherever they appear. */
const SIGNED_URL_RE = /^https?:\/\/\S*[?&](token|X-Amz-Signature|X-Amz-Credential|sig|signature|se|sessionid|session_id|expires)=/i;

/** SSRS stamps the render time on every report ("Generated: 11/11/2026 10:42 AM", "Report date: ..."). */
const REPORT_STAMP_RE = /\b(Generated|Report date|Printed(?: on)?|Run date|Print date|Date printed|Run on)\s*:?\s*\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AP]\.?M\.?)?)?/gi;

function normalizeReportText(text) {
  return String(text == null ? "" : text).replace(REPORT_STAMP_RE, (_m, label) => `${label}: <render-time>`);
}

function isVolatileKey(key) {
  return VOLATILE_KEYS.has(key) || VOLATILE_KEY_RE.test(key);
}

function stripVolatile(value, key = null) {
  if (Array.isArray(value)) return value.map((v) => stripVolatile(v));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (isVolatileKey(k)) continue;
      out[k] = stripVolatile(v, k);
    }
    return out;
  }
  if (typeof value === "string") {
    if (SIGNED_URL_RE.test(value)) return "<signed-url>";
    if (key === "text" || key === "rawText") return normalizeReportText(value);
  }
  return value;
}

/** The portal_data subset that is permit content. */
function portalContent(data) {
  if (!data || typeof data !== "object") return data ?? null;
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (TOP_LEVEL_BOOKKEEPING.has(k)) continue;
    if (isVolatileKey(k)) continue;
    out[k] = stripVolatile(v, k);
  }
  return out;
}

function stableStringify(obj) {
  if (obj === null || obj === undefined) return JSON.stringify(obj ?? null);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(",")}]`;
  if (typeof obj === "object") {
    return `{${Object.keys(obj).sort().filter((k) => obj[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(obj);
}

/** sha256 hex of the permit content of a portal_data object. */
function portalContentHash(data) {
  return crypto.createHash("sha256").update(stableStringify(portalContent(data))).digest("hex");
}

module.exports = { portalContentHash, portalContent, normalizeReportText, VOLATILE_KEYS, TOP_LEVEL_BOOKKEEPING };
