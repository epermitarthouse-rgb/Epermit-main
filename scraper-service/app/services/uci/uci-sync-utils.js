"use strict";

const crypto = require("crypto");

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeHashPart(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * @param {string[]} parts
 * @returns {string}
 */
function sha256Fingerprint(parts) {
  const payload = parts.map(normalizeHashPart).join("|");
  return crypto.createHash("sha256").update(payload).digest("hex");
}

/**
 * @param {unknown} iso
 * @returns {string | null}
 */
function isoToDateOnly(iso) {
  if (iso == null || iso === "") return null;
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function emptyCountBucket() {
  return { discovered: 0, inserted: 0, updated: 0, skipped: 0, failed: 0 };
}

/**
 * Deep-clone and strip filesystem paths from portal snapshots for API safety.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
function sanitizePortalSnapshotForApi(value) {
  if (value == null) return value;
  const copy = JSON.parse(JSON.stringify(value));
  if (!copy || typeof copy !== "object" || Array.isArray(copy)) return copy;

  if (Array.isArray(copy.downloadedFiles)) {
    for (const file of copy.downloadedFiles) {
      if (file && typeof file === "object") {
        delete file.localPath;
        delete file.storagePath;
      }
    }
  }

  return copy;
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
function sanitizeApplicationRowForApi(row) {
  if (!row || typeof row !== "object") return row;
  const out = { ...row };
  if (out.metadata && typeof out.metadata === "object" && !Array.isArray(out.metadata)) {
    const meta = /** @type {Record<string, unknown>} */ ({ ...out.metadata });
    if (meta.portal_snapshot != null) {
      meta.portal_snapshot = sanitizePortalSnapshotForApi(meta.portal_snapshot);
    }
    out.metadata = meta;
  }
  return out;
}

/**
 * @param {Array<Record<string, unknown>>} rows
 * @returns {Array<Record<string, unknown>>}
 */
function sanitizeApplicationRowsForApi(rows) {
  return Array.isArray(rows) ? rows.map(sanitizeApplicationRowForApi) : [];
}

module.exports = {
  normalizeHashPart,
  sha256Fingerprint,
  isoToDateOnly,
  emptyCountBucket,
  sanitizePortalSnapshotForApi,
  sanitizeApplicationRowForApi,
  sanitizeApplicationRowsForApi,
};
