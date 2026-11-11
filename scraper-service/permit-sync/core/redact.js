"use strict";

/**
 * Redaction applied to raw portal payloads before they are stored as snapshots.
 * Snapshots are evidence for parsing and change history, not a contact directory: emails, phone
 * numbers, bearer/session tokens and signed URLs are removed (Phase 0 privacy rule).
 */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const SIGNED_QUERY = /([?&](?:sig|signature|token|se|sv|sp|X-Amz-[A-Za-z]+|Expires|Key-Pair-Id)=)[^&\s"]+/gi;

const DROP_KEY = /(e-?mail|phone|fax|mobile|cell|sessionid|session_id|password|token|cookie|authorization|thumbnail)/i;

function redactText(text) {
  if (typeof text !== "string") return text;
  return text
    .replace(JWT, "[token]")
    .replace(EMAIL, "[email]")
    .replace(SIGNED_QUERY, "$1[redacted]")
    .replace(PHONE, "[phone]");
}

function redactPayload(value) {
  if (typeof value === "string") return redactText(value);
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactPayload);
  const out = {};
  for (const [key, v] of Object.entries(value)) {
    if (DROP_KEY.test(key)) continue;
    out[key] = redactPayload(v);
  }
  return out;
}

module.exports = { redactText, redactPayload };
