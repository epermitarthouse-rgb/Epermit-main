"use strict";

/**
 * Canonical JSON + hashing. Keys are sorted recursively and undefined values dropped so the same
 * portal data always hashes the same regardless of property order (idempotent re-imports, D-011).
 */

const crypto = require("node:crypto");

function canonicalize(value) {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : canonicalize(v)));
  const out = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) out[key] = canonicalize(value[key]);
  }
  return out;
}

function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  const text = typeof value === "string" ? value : stableStringify(value);
  return crypto.createHash("sha256").update(text).digest("hex");
}

/** Builds one keyed item for apply_permit_sync_batch. */
function keyedItem(key, fields) {
  if (key === null || key === undefined || String(key) === "") {
    throw new Error("keyedItem requires a non-empty key");
  }
  const clean = canonicalize(fields || {});
  return { key: String(key), hash: sha256(clean), fields: clean };
}

module.exports = { canonicalize, stableStringify, sha256, keyedItem };
