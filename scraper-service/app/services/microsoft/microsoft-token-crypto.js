"use strict";

const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const VERSION = "v1_ms";

function getEncryptionKeyDiagnostics() {
  const raw = process.env.MS_GRAPH_TOKEN_ENCRYPTION_KEY;
  const keyPresent = Boolean(raw && String(raw).trim());
  return { keyPresent, decodedByteLength: keyPresent ? inferKeyLen(raw) : null };
}

/**
 * @returns {number | null}
 */
function inferKeyLen(raw) {
  const t = String(raw).trim();
  if (/^[0-9a-fA-F]{64}$/.test(t)) return Buffer.from(t, "hex").length;
  try {
    return Buffer.from(t, "base64").length;
  } catch {
    return null;
  }
}

/**
 * @returns {Buffer}
 */
function loadKeyBytes() {
  const raw = process.env.MS_GRAPH_TOKEN_ENCRYPTION_KEY;
  if (!raw || !String(raw).trim()) {
    const err = new Error(
      "Microsoft Graph token encryption is not configured (MS_GRAPH_TOKEN_ENCRYPTION_KEY).",
    );
    err.code = "microsoft_token_encryption_unconfigured";
    throw err;
  }

  const t = String(raw).trim();

  /** @type {Buffer} */
  let buf;
  if (/^[0-9a-fA-F]{64}$/.test(t)) {
    buf = Buffer.from(t, "hex");
  } else {
    buf = Buffer.from(t, "base64");
  }

  if (buf.length !== 32) {
    const err = new Error(
      "Invalid MS_GRAPH_TOKEN_ENCRYPTION_KEY: expected 32 bytes (openssl rand -hex 32, or base64 of 32 bytes).",
    );
    err.code = "MS_GRAPH_TOKEN_ENCRYPTION_KEY_INVALID";
    throw err;
  }

  return buf;
}

function encryptTokenPlainJson(plainObject) {
  const key = loadKeyBytes();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const plaintext = JSON.stringify(plainObject);
  const ciphertextBuf = Buffer.concat([
    cipher.update(plaintext, "utf8"),
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
 * @param {string} encryptedPayload
 * @returns {Record<string, unknown>}
 */
function decryptTokenPlainJson(encryptedPayload) {
  const key = loadKeyBytes();
  let obj;
  try {
    obj = JSON.parse(String(encryptedPayload));
  } catch {
    const err = new Error("Invalid encrypted Microsoft token payload.");
    err.code = "microsoft_token_decrypt_failed";
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
    const err = new Error("Unsupported or corrupted encrypted Microsoft token format.");
    err.code = "microsoft_token_decrypt_failed";
    throw err;
  }

  const iv = Buffer.from(obj.iv, "base64");
  const authTag = Buffer.from(obj.authTag, "base64");
  const ciphertext = Buffer.from(obj.ciphertext, "base64");

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return /** @type {Record<string, unknown>} */ (JSON.parse(plain.toString("utf8")));
  } catch {
    const err = new Error(
      "Microsoft token could not be decrypted (wrong key or corrupted data).",
    );
    err.code = "microsoft_token_decrypt_failed";
    throw err;
  }
}

module.exports = {
  loadKeyBytes,
  encryptTokenPlainJson,
  decryptTokenPlainJson,
  getEncryptionKeyDiagnostics,
};
