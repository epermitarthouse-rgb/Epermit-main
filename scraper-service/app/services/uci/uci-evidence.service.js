"use strict";

/**
 * Provenance helpers for Track B evidence (invoices, release, meter, closeout).
 */

const crypto = require("crypto");

function asRecord(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return /** @type {Record<string, unknown>} */ (value);
  }
  return {};
}

function contentHash(value) {
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(String(value || ""), "utf8");
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/**
 * @param {object} params
 */
function buildEvidenceRef(params) {
  return {
    kind: String(params.kind || "document"),
    source: String(params.source || "operator"),
    doc_id: params.docId ?? params.doc_id ?? null,
    communication_id: params.communicationId ?? params.communication_id ?? null,
    content_hash: params.contentHash ?? params.content_hash ?? null,
    captured_at: params.capturedAt || new Date().toISOString(),
    label: params.label || null,
  };
}

function mergeCloseoutArtifact(record, key, evidence) {
  const meta = asRecord(record.metadata);
  const artifacts = asRecord(meta.closeout_artifacts);
  return {
    ...meta,
    closeout_artifacts: {
      ...artifacts,
      [key]: evidence,
    },
  };
}

module.exports = {
  contentHash,
  buildEvidenceRef,
  mergeCloseoutArtifact,
};
