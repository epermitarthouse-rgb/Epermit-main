"use strict";

const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const VERSION = "v1";

/**
 * Safe diagnostics only (never logs or returns secret material).
 * @returns {{ keyPresent: boolean, decodedByteLength: number | null }}
 */
function getEncryptionKeyDiagnostics() {
  const raw = process.env.QB_TOKEN_ENCRYPTION_KEY;
  const keyPresent = Boolean(raw && String(raw).trim());
  if (!keyPresent) {
    return { keyPresent: false, decodedByteLength: null };
  }
  const buf = Buffer.from(String(raw).trim(), "base64");
  return { keyPresent: true, decodedByteLength: buf.length };
}

/**
 * @returns {Buffer}
 */
function loadKeyBytes() {
  const raw = process.env.QB_TOKEN_ENCRYPTION_KEY;
  if (!raw || !String(raw).trim()) {
    const err = new Error(
      "QuickBooks token encryption is not configured (QB_TOKEN_ENCRYPTION_KEY).",
    );
    err.code = "quickbooks_token_encryption_unconfigured";
    throw err;
  }
  const buf = Buffer.from(String(raw).trim(), "base64");
  if (buf.length !== 32) {
    const err = new Error(
      "Invalid QB_TOKEN_ENCRYPTION_KEY: expected 32 decoded bytes.",
    );
    err.code = "QB_TOKEN_ENCRYPTION_KEY_INVALID";
    throw err;
  }
  return buf;
}

/**
 * @param {string} plainText
 * @returns {string} JSON string: { version, iv, authTag, ciphertext } (base64 fields)
 */
function encryptToken(plainText) {
  const key = loadKeyBytes();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertextBuf = Buffer.concat([
    cipher.update(String(plainText), "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const payload = {
    version: VERSION,
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    ciphertext: ciphertextBuf.toString("base64"),
  };
  return JSON.stringify(payload);
}

/**
 * @param {string} encryptedPayload JSON string from encryptToken
 * @returns {string}
 */
function decryptToken(encryptedPayload) {
  const key = loadKeyBytes();
  let obj;
  try {
    obj = JSON.parse(String(encryptedPayload));
  } catch {
    const err = new Error("Invalid encrypted token payload.");
    err.code = "quickbooks_token_decrypt_failed";
    throw err;
  }
  if (
    !obj ||
    typeof obj !== "object" ||
    obj.version !== VERSION ||
    typeof obj.iv !== "string" ||
    typeof obj.authTag !== "string" ||
    typeof obj.ciphertext !== "string"
  ) {
    const err = new Error("Unsupported or corrupted encrypted token format.");
    err.code = "quickbooks_token_decrypt_failed";
    throw err;
  }

  const iv = Buffer.from(obj.iv, "base64");
  const authTag = Buffer.from(obj.authTag, "base64");
  const ciphertext = Buffer.from(obj.ciphertext, "base64");

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
      "QuickBooks refresh token could not be decrypted (wrong key or corrupted data).",
    );
    err.code = "quickbooks_token_decrypt_failed";
    throw err;
  }
}

module.exports = {
  encryptToken,
  decryptToken,
  getEncryptionKeyDiagnostics,
};
