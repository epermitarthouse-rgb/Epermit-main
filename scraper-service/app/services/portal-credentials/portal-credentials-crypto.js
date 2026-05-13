"use strict";

const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const PAYLOAD_VERSION = "1";

/**
 * Stored value is plaintext unless it parses as `{ pc_v:"1", iv, at, ct }` (AES-256-GCM).
 * Key: PORTAL_CREDENTIALS_ENCRYPTION_KEY — base64 of 32 bytes (same pattern as QB tokens).
 */

/**
 * @returns {Buffer | null} null when encryption key not configured
 */
function loadKeyBytesOptional() {
  const raw = process.env.PORTAL_CREDENTIALS_ENCRYPTION_KEY;
  if (!raw || !String(raw).trim()) return null;
  const buf = Buffer.from(String(raw).trim(), "base64");
  if (buf.length !== 32) {
    const err = new Error(
      "Invalid PORTAL_CREDENTIALS_ENCRYPTION_KEY: expected 32 decoded bytes (base64).",
    );
    err.code = "PORTAL_CREDENTIALS_ENCRYPTION_KEY_INVALID";
    throw err;
  }
  return buf;
}

/**
 * @param {string} plainText
 * @returns {string} JSON ciphertext envelope
 */
function encryptPortalPassword(plainText) {
  const key = loadKeyBytesOptional();
  if (!key) {
    throw Object.assign(
      new Error(
        "PORTAL_CREDENTIALS_ENCRYPTION_KEY is not configured server-side.",
      ),
      { code: "portal_credentials_encryption_unconfigured" },
    );
  }
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertextBuf = Buffer.concat([
    cipher.update(String(plainText), "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const payload = {
    pc_v: PAYLOAD_VERSION,
    iv: iv.toString("base64"),
    at: authTag.toString("base64"),
    ct: ciphertextBuf.toString("base64"),
  };
  return JSON.stringify(payload);
}

/**
 * When encryption key is set, store encrypted blobs; otherwise keep plaintext for legacy deploys.
 * @param {string} plainText
 */
function encryptPortalPasswordIfConfigured(plainText) {
  const key = loadKeyBytesOptional();
  if (!key) return String(plainText);
  try {
    return encryptPortalPassword(plainText);
  } catch (e) {
    if (e.code === "PORTAL_CREDENTIALS_ENCRYPTION_KEY_INVALID") throw e;
    throw e;
  }
}

/** @returns {boolean} */
function looksLikeEncryptedEnvelope(value) {
  if (value == null) return false;
  const s = String(value).trim();
  if (!s.startsWith("{")) return false;
  try {
    const o = JSON.parse(s);
    return (
      o &&
      typeof o === "object" &&
      o.pc_v === PAYLOAD_VERSION &&
      typeof o.iv === "string" &&
      typeof o.at === "string" &&
      typeof o.ct === "string"
    );
  } catch {
    return false;
  }
}

/**
 * Decrypt AES-GCM envelope or return legacy plaintext unchanged.
 * @param {unknown} storedDbValue
 * @returns {string}
 */
function resolveStoredPortalPassword(storedDbValue) {
  if (storedDbValue == null || storedDbValue === "") return "";

  const s = String(storedDbValue).trim();
  if (!s) return "";

  if (!looksLikeEncryptedEnvelope(s)) {
    return s;
  }

  const key = loadKeyBytesOptional();
  if (!key) {
    const err = new Error(
      "Encrypted portal credential cannot be decrypted: PORTAL_CREDENTIALS_ENCRYPTION_KEY not set.",
    );
    err.code = "portal_credentials_decrypt_unconfigured";
    throw err;
  }

  /** @type {{ iv: string, at: string, ct: string }} */
  const obj = JSON.parse(s);

  const iv = Buffer.from(obj.iv, "base64");
  const authTag = Buffer.from(obj.at, "base64");
  const ciphertext = Buffer.from(obj.ct, "base64");

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const plain = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plain.toString("utf8");
  } catch {
    const err = new Error(
      "Portal credential could not be decrypted (wrong key or corrupted data).",
    );
    err.code = "portal_credentials_decrypt_failed";
    throw err;
  }
}

/**
 * Safe list UI: encrypted rows count as configured; legacy plaintext counts if non-empty.
 * @param {unknown} storedDbValue
 */
function passwordFieldIsConfigured(storedDbValue) {
  if (storedDbValue == null) return false;
  const raw = String(storedDbValue).trim();
  if (!raw) return false;
  if (looksLikeEncryptedEnvelope(raw)) return true;
  return true;
}

module.exports = {
  encryptPortalPassword,
  encryptPortalPasswordIfConfigured,
  resolveStoredPortalPassword,
  looksLikeEncryptedEnvelope,
  passwordFieldIsConfigured,
};
