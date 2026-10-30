/**
 * Stage 3 Mac worker → Supabase evidence upload (fail-closed auth).
 *
 * Mac never uses SUPABASE_SERVICE_ROLE_KEY. Uploads go through the
 * supabase-analyzer-stage3-evidence Edge function with STAGE3_WORKER_UPLOAD_TOKEN
 * (or an injected fetch adapter for tests).
 *
 * No public URLs. No inbound Mac endpoint.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export const STAGE3_EVIDENCE_BUCKET = "supabase-analyzer-stage3-evidence";
export const STAGE3_PACK_MAX_BYTES = 200_000;
export const STAGE3_VISUAL_EVIDENCE_VERSION = "phase3.stage3-visual-evidence.v1";
export const STAGE3_EXTRACTION_METHOD = "macos-vision";
export const STAGE3_EVIDENCE_FUNCTION = "supabase-analyzer-stage3-evidence";

export function stage3CacheKey(contentSha256, method = STAGE3_EXTRACTION_METHOD, version = STAGE3_VISUAL_EVIDENCE_VERSION) {
  return `${contentSha256}.${method}.${version}`;
}

export function buildStage3EvidenceObjectPath({
  projectId,
  runId,
  sheetJobId,
  contentSha256,
  extractionMethod = STAGE3_EXTRACTION_METHOD,
  extractionVersion = STAGE3_VISUAL_EVIDENCE_VERSION,
}) {
  const key = stage3CacheKey(contentSha256, extractionMethod, extractionVersion);
  return `${projectId}/${runId}/${sheetJobId}/${key}.json`;
}

export function serializePackForUpload(pack) {
  const envelope = {
    ...pack,
    independentlyVerified: false,
    extractionVersion: pack.extractionVersion || STAGE3_VISUAL_EVIDENCE_VERSION,
    extractionMethod: pack.extractionMethod || pack.provenance?.extractionMethod || STAGE3_EXTRACTION_METHOD,
    uploadedAt: new Date().toISOString(),
    provenance: {
      ...(pack.provenance || {}),
      independentlyVerified: false,
      extractionMethod: pack.provenance?.extractionMethod || STAGE3_EXTRACTION_METHOD,
    },
  };
  const json = JSON.stringify(envelope);
  if (Buffer.byteLength(json, "utf8") > STAGE3_PACK_MAX_BYTES) {
    throw new Error(`stage3_pack_oversized:${Buffer.byteLength(json, "utf8")}`);
  }
  return Buffer.from(json, "utf8");
}

/**
 * Legacy direct-storage adapter upload (tests / injected mock only).
 * Production Mac path must use uploadStage3PackViaEdge.
 */
export async function uploadStage3PackToStorage(options) {
  const {
    storage,
    pack,
    projectId,
    runId,
    sheetJobId,
    contentSha256,
    upsert = true,
  } = options;
  if (!storage?.upload) throw new Error("storage_upload_missing");
  if (!projectId || !runId || !sheetJobId || !contentSha256) {
    throw new Error("stage3_upload_identity_incomplete");
  }
  if (String(pack.sourceFileSha256 || "").toLowerCase() !== String(contentSha256).toLowerCase()) {
    throw new Error("stage3_upload_sha_mismatch");
  }
  const objectPath = buildStage3EvidenceObjectPath({
    projectId,
    runId,
    sheetJobId,
    contentSha256: String(contentSha256).toLowerCase(),
  });
  const bytes = serializePackForUpload(pack);
  await storage.upload(STAGE3_EVIDENCE_BUCKET, objectPath, bytes, {
    contentType: "application/json",
    upsert,
  });
  return {
    bucket: STAGE3_EVIDENCE_BUCKET,
    objectPath,
    bytes: bytes.length,
    publicUrl: null,
    independentlyVerified: false,
  };
}

/**
 * Upload via Edge function. Fail closed without STAGE3_WORKER_UPLOAD_TOKEN.
 * Never reads SUPABASE_SERVICE_ROLE_KEY.
 */
export async function uploadStage3PackViaEdge(options) {
  const {
    pack,
    projectId,
    runId,
    sheetJobId,
    contentSha256,
    supabaseUrl = process.env.SUPABASE_URL,
    workerToken = process.env.STAGE3_WORKER_UPLOAD_TOKEN,
    anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY,
    fetchImpl = globalThis.fetch,
  } = options;

  if (process.env.SUPABASE_SERVICE_ROLE_KEY && !workerToken) {
    throw new Error(
      "stage3_auth_fail_closed: STAGE3_WORKER_UPLOAD_TOKEN required; service-role fallback removed",
    );
  }
  const url = String(supabaseUrl || "").trim().replace(/\/$/, "");
  const token = String(workerToken || "").trim();
  if (!url) throw new Error("stage3_auth_fail_closed: SUPABASE_URL required");
  if (!token) throw new Error("stage3_auth_fail_closed: STAGE3_WORKER_UPLOAD_TOKEN required");
  if (!projectId || !runId || !sheetJobId || !contentSha256) {
    throw new Error("stage3_upload_identity_incomplete");
  }
  if (String(pack.sourceFileSha256 || "").toLowerCase() !== String(contentSha256).toLowerCase()) {
    throw new Error("stage3_upload_sha_mismatch");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("stage3_fetch_unavailable");
  }

  const endpoint = `${url}/functions/v1/${STAGE3_EVIDENCE_FUNCTION}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "x-stage3-worker-token": token,
  };
  // apikey required by Supabase gateway even when verify_jwt=false
  if (anonKey) headers.apikey = String(anonKey).trim();

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      projectId,
      runId,
      sheetJobId,
      contentSha256: String(contentSha256).toLowerCase(),
      pack: {
        ...pack,
        independentlyVerified: false,
        sourceFileSha256: String(contentSha256).toLowerCase(),
      },
    }),
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { error: text.slice(0, 240) };
  }
  if (!response.ok) {
    throw new Error(
      `stage3_edge_upload_failed:${response.status}:${payload?.error || payload?.issue || "unknown"}`,
    );
  }
  return {
    bucket: payload.bucket || STAGE3_EVIDENCE_BUCKET,
    objectPath: payload.objectPath,
    bytes: payload.bytes,
    publicUrl: null,
    independentlyVerified: false,
    authMode: payload.authMode || "worker_token",
  };
}

export async function uploadLocalPackFile(options) {
  const packPath = options.packPath;
  if (!existsSync(packPath)) throw new Error(`pack_missing:${packPath}`);
  const pack = JSON.parse(await readFile(packPath, "utf8"));
  if (options.viaEdge || options.workerToken || process.env.STAGE3_WORKER_UPLOAD_TOKEN) {
    return uploadStage3PackViaEdge({
      ...options,
      pack,
      contentSha256: options.contentSha256 || pack.sourceFileSha256,
    });
  }
  if (options.storage) {
    return uploadStage3PackToStorage({
      ...options,
      pack,
      contentSha256: options.contentSha256 || pack.sourceFileSha256,
    });
  }
  throw new Error("stage3_auth_fail_closed: provide STAGE3_WORKER_UPLOAD_TOKEN (Edge) or injected storage mock");
}

/**
 * Fail-closed env factory. Does NOT accept service-role.
 * Returns an Edge-backed storage-like adapter for worker processClaimedJob.
 */
export function createStage3EdgeUploadAdapterFromEnv(options = {}) {
  const url = String(options.supabaseUrl || process.env.SUPABASE_URL || "").trim();
  const token = String(options.workerToken || process.env.STAGE3_WORKER_UPLOAD_TOKEN || "").trim();
  if (!url || !token) {
    throw new Error("stage3_auth_fail_closed: SUPABASE_URL and STAGE3_WORKER_UPLOAD_TOKEN required");
  }
  if (process.env.SUPABASE_SERVICE_ROLE_KEY && token === process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("stage3_auth_fail_closed: worker token must not be the service-role key");
  }
  return {
    kind: "edge_upload_adapter",
    async upload(_bucket, _objectPath, _bytes, _opts = {}) {
      throw new Error(
        "direct_storage_upload_disabled: use uploadStage3PackViaEdge / processClaimedJob storage.edgeUpload",
      );
    },
    async edgeUpload(packIdentity) {
      return uploadStage3PackViaEdge({
        ...packIdentity,
        supabaseUrl: url,
        workerToken: token,
        anonKey: options.anonKey || process.env.SUPABASE_ANON_KEY,
        fetchImpl: options.fetchImpl || globalThis.fetch,
      });
    },
  };
}

/** @deprecated Removed — throws to catch residual call sites. */
export function createSupabaseStage3StorageFromEnv() {
  throw new Error(
    "stage3_auth_fail_closed: createSupabaseStage3StorageFromEnv removed; use createStage3EdgeUploadAdapterFromEnv",
  );
}

export function sha256FileSync(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function resolvePackPath(workerRoot, sheetId, contentSha256) {
  return path.join(workerRoot, "packs", `${sheetId}.${contentSha256}.json`);
}
