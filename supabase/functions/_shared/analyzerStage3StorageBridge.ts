/**
 * Stage 3 Supabase Storage bridge — evidence pack pathing, validation, and loaders.
 *
 * Storage is a private evidence cache (not a job queue). Packs are never public.
 * Drawings bucket is PDF-only; Stage 3 packs use a dedicated private JSON bucket
 * (proposed — apply migration only after approval).
 *
 * Failures return null/empty — callers must fail open.
 */
import {
  STAGE3_VISUAL_EVIDENCE_VERSION,
  stage3CacheKey,
  type Stage3EvidencePack,
} from "./analyzerStage3VisualEvidence.ts";

export const STAGE3_EVIDENCE_BUCKET = "supabase-analyzer-stage3-evidence";
export const STAGE3_EXTRACTION_METHOD = "macos-vision";
/** Soft max for a single pack object (bytes). Oversized packs are rejected. */
export const STAGE3_PACK_MAX_BYTES = 200_000;
export const STAGE3_PACK_CONTENT_TYPE = "application/json";

export interface Stage3StorageIdentity {
  projectId: string;
  runId: string;
  sheetJobId: string;
  contentSha256: string;
  extractionMethod?: string;
  extractionVersion?: string;
}

export interface Stage3StorageDownload {
  download: (bucket: string, objectPath: string) => Promise<Uint8Array | null>;
}

export type Stage3PackValidationIssue =
  | "not_object"
  | "missing_fields"
  | "sha_mismatch"
  | "version_mismatch"
  | "method_mismatch"
  | "oversized"
  | "verified_claim"
  | "tenant_mismatch"
  | "malformed_json"
  | "empty";

function oneLine(value: string, max: number): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Hex SHA-256 of PDF/drawing bytes (Edge SubtleCrypto; Node webcrypto fallback). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let subtle: SubtleCrypto | undefined = globalThis.crypto?.subtle;
  if (!subtle) {
    try {
      // Deno Edge has global crypto; Node unit tests may need webcrypto from node:crypto.
      const nodeCrypto = await import("node:crypto");
      subtle = nodeCrypto.webcrypto?.subtle as SubtleCrypto | undefined;
    } catch {
      subtle = undefined;
    }
  }
  if (!subtle) throw new Error("subtle_crypto_unavailable");
  const digest = await subtle.digest("SHA-256", copy);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Private object path:
 * {projectId}/{runId}/{sheetJobId}/{sha}.{method}.{version}.json
 */
export function buildStage3EvidenceObjectPath(identity: Stage3StorageIdentity): string {
  const method = identity.extractionMethod || STAGE3_EXTRACTION_METHOD;
  const version = identity.extractionVersion || STAGE3_VISUAL_EVIDENCE_VERSION;
  const key = stage3CacheKey({
    contentSha256: identity.contentSha256,
    extractionMethod: method,
    extractionVersion: version,
  });
  return [
    oneLine(identity.projectId, 80),
    oneLine(identity.runId, 80),
    oneLine(identity.sheetJobId, 80),
    `${key}.json`,
  ].join("/");
}

/** Parse drawing object_path `{projectId}/{runId}/{jobId}.pdf` → ids. */
export function parseAnalyzerDrawingObjectPath(objectPath: string | null | undefined): {
  projectId: string;
  runId: string;
  sheetJobId: string;
} | null {
  const raw = String(objectPath || "").trim();
  const match = raw.match(
    /^([0-9a-fA-F-]{36})\/([0-9a-fA-F-]{36})\/([0-9a-fA-F-]{36})\.pdf$/i,
  );
  if (!match) return null;
  return { projectId: match[1], runId: match[2], sheetJobId: match[3] };
}

export function assertStage3PathTenant(
  objectPath: string,
  expected: { projectId: string; runId: string; sheetJobId?: string },
): boolean {
  const parts = String(objectPath || "").split("/");
  if (parts.length < 4) return false;
  if (parts[0] !== expected.projectId) return false;
  if (parts[1] !== expected.runId) return false;
  if (expected.sheetJobId && parts[2] !== expected.sheetJobId) return false;
  if (!parts[parts.length - 1].endsWith(".json")) return false;
  return true;
}

/**
 * Validate and normalize a Stage 3 pack. Always forces independentlyVerified=false.
 */
export function validateAndNormalizeStage3Pack(
  raw: unknown,
  expected: {
    contentSha256: string;
    extractionVersion?: string;
    extractionMethod?: string;
    maxBytes?: number;
    byteLength?: number;
  },
): { ok: true; pack: Stage3EvidencePack } | { ok: false; issue: Stage3PackValidationIssue; detail?: string } {
  const maxBytes = expected.maxBytes ?? STAGE3_PACK_MAX_BYTES;
  if (typeof expected.byteLength === "number" && expected.byteLength > maxBytes) {
    return { ok: false, issue: "oversized", detail: `bytes=${expected.byteLength}` };
  }
  if (raw == null) return { ok: false, issue: "empty" };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, issue: "not_object" };
  }
  const body = raw as Record<string, unknown>;
  const promptBlock = String(body.promptBlock || "").trim();
  const sheetId = String(body.sheetId || "").trim();
  const topic = String(body.topic || "").trim();
  const status = String(body.status || "").trim();
  const id = String(body.id || "").trim() || `${sheetId || "sheet"}.${topic || "topic"}`;
  if (!promptBlock || !sheetId || !topic || !status) {
    return { ok: false, issue: "missing_fields" };
  }

  const sourceSha = String(body.sourceFileSha256 || "").toLowerCase();
  if (sourceSha && sourceSha !== expected.contentSha256.toLowerCase()) {
    return { ok: false, issue: "sha_mismatch", detail: sourceSha.slice(0, 16) };
  }
  if (!sourceSha) {
    return { ok: false, issue: "sha_mismatch", detail: "missing_source_sha" };
  }

  const version = String(body.extractionVersion || "").trim()
    || STAGE3_VISUAL_EVIDENCE_VERSION;
  const expectedVersion = expected.extractionVersion || STAGE3_VISUAL_EVIDENCE_VERSION;
  if (version !== expectedVersion) {
    return { ok: false, issue: "version_mismatch", detail: version };
  }

  const method = String(
    (body.provenance as { extractionMethod?: string } | undefined)?.extractionMethod
      || body.extractionMethod
      || STAGE3_EXTRACTION_METHOD,
  );
  const expectedMethod = expected.extractionMethod || STAGE3_EXTRACTION_METHOD;
  if (method !== expectedMethod) {
    return { ok: false, issue: "method_mismatch", detail: method };
  }

  if (body.independentlyVerified === true) {
    return { ok: false, issue: "verified_claim" };
  }

  const provenanceRaw = (body.provenance && typeof body.provenance === "object")
    ? body.provenance as Record<string, unknown>
    : {};

  const pack: Stage3EvidencePack = {
    id,
    sheetId,
    topic,
    status,
    promptBlock: promptBlock.slice(0, 8000),
    extractedTexts: Array.isArray(body.extractedTexts)
      ? body.extractedTexts.map((item) => String(item).slice(0, 400)).slice(0, 40)
      : [],
    detailIdentifier: body.detailIdentifier == null ? null : String(body.detailIdentifier).slice(0, 240),
    bbox: body.bbox && typeof body.bbox === "object" ? body.bbox as Record<string, unknown> : null,
    assessment: body.assessment && typeof body.assessment === "object"
      ? body.assessment as Record<string, unknown>
      : null,
    provenance: {
      origin: String(provenanceRaw.origin || "visual_interpretation"),
      method: String(provenanceRaw.method || "stage3_storage_bridge"),
      independentlyVerified: false,
      uncertainty: String(provenanceRaw.uncertainty || "Machine OCR/layout extraction — not professionally verified."),
      extractionMethod: method,
      cacheKey: String(provenanceRaw.cacheKey || stage3CacheKey({
        contentSha256: expected.contentSha256,
        extractionMethod: method,
        extractionVersion: version,
      })),
    },
    sourceFileSha256: expected.contentSha256.toLowerCase(),
    extractionVersion: version,
    independentlyVerified: false,
  };
  return { ok: true, pack };
}

export function parseStage3PackBytes(
  bytes: Uint8Array,
  expected: {
    contentSha256: string;
    extractionVersion?: string;
    extractionMethod?: string;
  },
): { ok: true; pack: Stage3EvidencePack } | { ok: false; issue: Stage3PackValidationIssue; detail?: string } {
  if (!bytes?.length) return { ok: false, issue: "empty" };
  if (bytes.length > STAGE3_PACK_MAX_BYTES) {
    return { ok: false, issue: "oversized", detail: `bytes=${bytes.length}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { ok: false, issue: "malformed_json" };
  }
  return validateAndNormalizeStage3Pack(parsed, {
    ...expected,
    byteLength: bytes.length,
  });
}

/**
 * Create a fail-open pack loader for retrieveStage3VisualEvidence deps.
 * Downloads at most one object; missing/invalid → [].
 */
export function createStage3StoragePackLoader(options: {
  identity: Stage3StorageIdentity;
  storage: Stage3StorageDownload;
  bucket?: string;
}): (ctx: {
  fileName: string;
  contentSha256?: string | null;
  objectPath?: string | null;
}) => Promise<Stage3EvidencePack[] | null> {
  const bucket = options.bucket || STAGE3_EVIDENCE_BUCKET;
  return async () => {
    const sha = (options.identity.contentSha256 || "").toLowerCase();
    if (!sha) return [];
    const objectPath = buildStage3EvidenceObjectPath({
      ...options.identity,
      contentSha256: sha,
    });
    if (!assertStage3PathTenant(objectPath, options.identity)) return [];
    try {
      const bytes = await options.storage.download(bucket, objectPath);
      if (!bytes) return [];
      const validated = parseStage3PackBytes(bytes, {
        contentSha256: sha,
        extractionMethod: options.identity.extractionMethod,
        extractionVersion: options.identity.extractionVersion,
      });
      if (!validated.ok) {
        if (validated.issue === "version_mismatch" || validated.issue === "sha_mismatch") {
          return [{
            id: "stale",
            sheetId: "unknown",
            topic: "unknown",
            status: "stale",
            promptBlock: "",
            independentlyVerified: false,
            sourceFileSha256: sha,
            extractionVersion: options.identity.extractionVersion || STAGE3_VISUAL_EVIDENCE_VERSION,
          }];
        }
        return [];
      }
      return [validated.pack];
    } catch {
      return [];
    }
  };
}

/** Build upload payload bytes for Mac worker (always IV=false). */
export function serializeStage3PackForUpload(pack: Stage3EvidencePack): Uint8Array {
  const envelope = {
    ...pack,
    independentlyVerified: false,
    extractionVersion: pack.extractionVersion || STAGE3_VISUAL_EVIDENCE_VERSION,
    extractionMethod: pack.provenance?.extractionMethod || STAGE3_EXTRACTION_METHOD,
    uploadedAt: new Date().toISOString(),
    provenance: {
      ...(pack.provenance || {}),
      independentlyVerified: false,
      extractionMethod: pack.provenance?.extractionMethod || STAGE3_EXTRACTION_METHOD,
    },
  };
  const json = JSON.stringify(envelope);
  if (json.length > STAGE3_PACK_MAX_BYTES) {
    throw new Error(`stage3_pack_oversized:${json.length}`);
  }
  return new TextEncoder().encode(json);
}

/** In-memory private bucket for local tests (no network, no public URLs). */
export function createMemoryStage3Storage(): {
  bucket: string;
  objects: Map<string, Uint8Array>;
  upload: (objectPath: string, bytes: Uint8Array, contentType?: string) => void;
  download: (bucket: string, objectPath: string) => Promise<Uint8Array | null>;
} {
  const objects = new Map<string, Uint8Array>();
  return {
    bucket: STAGE3_EVIDENCE_BUCKET,
    objects,
    upload(objectPath, bytes, contentType = STAGE3_PACK_CONTENT_TYPE) {
      if (contentType !== STAGE3_PACK_CONTENT_TYPE) {
        throw new Error("unsupported_content_type");
      }
      if (!objectPath.endsWith(".json")) throw new Error("json_extension_required");
      if (bytes.length > STAGE3_PACK_MAX_BYTES) throw new Error("oversized");
      objects.set(objectPath, bytes);
    },
    async download(bucket, objectPath) {
      if (bucket !== STAGE3_EVIDENCE_BUCKET) return null;
      return objects.get(objectPath) || null;
    },
  };
}
