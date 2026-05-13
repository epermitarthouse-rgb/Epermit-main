/**
 * Mirrors scraper-service/app/services/portal-credentials/portal-credentials-crypto.js
 * AES-256-GCM envelope: { pc_v: "1", iv, at, ct } (base64 parts).
 */

import { decode as decodeBase64 } from "https://deno.land/std@0.190.0/encoding/base64.ts";

function looksEncrypted(s: string): boolean {
  if (!s.trim().startsWith("{")) return false;
  try {
    const o = JSON.parse(s) as Record<string, unknown>;
    return (
      o.pc_v === "1" &&
      typeof o.iv === "string" &&
      typeof o.at === "string" &&
      typeof o.ct === "string"
    );
  } catch {
    return false;
  }
}

async function decryptEnvelope(parts: {
  iv: string;
  at: string;
  ct: string;
}): Promise<string> {
  const keyB64 = Deno.env.get("PORTAL_CREDENTIALS_ENCRYPTION_KEY");
  if (!keyB64?.trim()) {
    throw new Error(
      "PORTAL_CREDENTIALS_ENCRYPTION_KEY is not set (required to decrypt saved credentials).",
    );
  }
  const keyBytes = decodeBase64(keyB64.trim());
  if (keyBytes.length !== 32) {
    throw new Error(
      "Invalid PORTAL_CREDENTIALS_ENCRYPTION_KEY: expected 32 raw bytes (base64).",
    );
  }

  const iv = decodeBase64(parts.iv);
  const tag = decodeBase64(parts.at);
  const ct = decodeBase64(parts.ct);
  const combined = new Uint8Array(ct.length + tag.length);
  combined.set(ct, 0);
  combined.set(tag, ct.length);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );

  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    cryptoKey,
    combined,
  );

  return new TextDecoder().decode(plain);
}

/**
 * Returns plaintext password for scraper / Firecrawl flows.
 * Legacy DB values remain plain strings.
 */
export async function resolveStoredPortalPasswordAsync(
  stored: string | null | undefined,
): Promise<string> {
  if (stored == null || stored === "") return "";
  const s = String(stored).trim();
  if (!s) return "";
  if (!looksEncrypted(s)) return s;
  const o = JSON.parse(s) as { iv: string; at: string; ct: string };
  return await decryptEnvelope(o);
}
