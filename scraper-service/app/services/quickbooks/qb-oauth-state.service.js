"use strict";

const crypto = require("crypto");
const { loadKeyBytes } = require("./qb-token-crypto.js");

/** OAuth state TTL (seconds). */
const STATE_TTL_SEC = 900;

/** In-memory single-use nonce registry (process-local). */
const usedNonces = new Map();

/** @param {number} nowMs */
function purgeExpiredNonces(nowMs = Date.now()) {
  for (const [nonce, expMs] of usedNonces.entries()) {
    if (expMs <= nowMs) usedNonces.delete(nonce);
  }
}

/**
 * Returns HMAC signing material derived from QB_TOKEN_ENCRYPTION_KEY (never exposed).
 * @returns {Buffer}
 */
function stateSigningSecret() {
  const k = loadKeyBytes();
  return crypto.createHash("sha256").update(k).update("qb-oauth-state-v1").digest();
}

/**
 * @param {{ userId: string }} p
 */
function createSignedQuickBooksOAuthState(p) {
  purgeExpiredNonces();
  const nonce = crypto.randomBytes(16).toString("hex");
  const payloadBuf = Buffer.from(
    JSON.stringify({
      u: String(p.userId),
      exp: Math.floor(Date.now() / 1000) + STATE_TTL_SEC,
      i: nonce,
    }),
    "utf8",
  );
  const payload = payloadBuf.toString("base64url");
  const sig = crypto
    .createHmac("sha256", stateSigningSecret())
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

/**
 * @param {string | undefined | null} state
 * @returns {{ userId: string, nonce: string } | null}
 */
function verifySignedQuickBooksOAuthState(state) {
  if (!state || typeof state !== "string") return null;
  const idx = state.indexOf(".");
  if (idx <= 0) return null;
  const payload = state.slice(0, idx);
  const sig = state.slice(idx + 1);
  if (!payload || !sig) return null;

  const expected = crypto
    .createHmac("sha256", stateSigningSecret())
    .update(payload)
    .digest();
  try {
    const sigBuf = Buffer.from(sig, "base64url");
    if (sigBuf.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expected)) return null;
  } catch {
    return null;
  }

  let obj;
  try {
    obj = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (
    !obj ||
    typeof obj !== "object" ||
    typeof obj.u !== "string" ||
    typeof obj.i !== "string" ||
    typeof obj.exp !== "number" ||
    obj.exp < now
  ) {
    return null;
  }

  purgeExpiredNonces();
  if (usedNonces.has(obj.i)) return null;

  return { userId: obj.u.trim(), nonce: obj.i };
}

/**
 * Mark OAuth state nonce consumed (single-use).
 * @param {string} nonce
 */
function consumeQuickBooksOAuthNonce(nonce) {
  if (!nonce || typeof nonce !== "string") return;
  purgeExpiredNonces();
  usedNonces.set(nonce, Date.now() + STATE_TTL_SEC * 1000);
}

/**
 * @param {string | undefined | null} realmId
 * @returns {string | null}
 */
function maskRealmId(realmId) {
  if (!realmId || typeof realmId !== "string") return null;
  const t = realmId.trim();
  if (!t) return null;
  if (t.length <= 4) return "****";
  return `****${t.slice(-4)}`;
}

module.exports = {
  STATE_TTL_SEC,
  createSignedQuickBooksOAuthState,
  verifySignedQuickBooksOAuthState,
  consumeQuickBooksOAuthNonce,
  maskRealmId,
  purgeExpiredNonces,
};
