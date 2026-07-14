"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  uploadBufferToSupabaseStorage,
  contentTypeFromStoragePath,
  sanitizeStorageErrorForLog,
} = require("../../../shared/supabase-storage-upload.js");

/** Default Supabase bucket for UCI portal documents (shared with project documents). */
const UCI_DOCUMENTS_STORAGE_BUCKET = "project-documents";

/** Namespace used until tenant propagation is configured. */
const UCI_TENANT_NAMESPACE_UNCONFIGURED = "unconfigured";

/**
 * Whether durable local copies under debug/pepco-docs should be kept after upload.
 * Production default: false — Supabase is the source of truth.
 *
 * @returns {boolean}
 */
function isUciLocalDocumentPersistenceEnabled() {
  if (process.env.UCI_PERSIST_LOCAL_DOCUMENTS === "true") return true;
  if (process.env.UCI_PERSIST_LOCAL_DOCUMENTS === "false") return false;
  return process.env.NODE_ENV !== "production";
}

/**
 * @param {string | undefined | null} value
 * @returns {string}
 */
function sanitizeUciStorageSegment(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return trimmed.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * @param {string | undefined | null} fileName
 * @returns {string}
 */
function sanitizeUciFileName(fileName) {
  return path
    .basename(String(fileName || "").replace(/[/\\?%*:|"<>]/g, "_"))
    .replace(/\s+/g, "_");
}

/**
 * Build the durable Supabase Storage key for a UCI portal document.
 *
 * @param {{
 *   projectId: string;
 *   coordinationRecordId: string;
 *   providerSlug: string;
 *   externalApplicationId: string;
 *   fileName: string;
 *   tenantNamespace?: string;
 *   tenantId?: string;
 * }} opts
 * @returns {string | null}
 */
function buildUciStoragePath(opts) {
  const projectId = sanitizeUciStorageSegment(opts.projectId);
  const coordinationRecordId = sanitizeUciStorageSegment(opts.coordinationRecordId);
  const providerSlug = sanitizeUciStorageSegment(opts.providerSlug || "unknown");
  const externalApplicationId = sanitizeUciStorageSegment(opts.externalApplicationId);
  const safeFileName = sanitizeUciFileName(opts.fileName);
  const tenantNamespace = sanitizeUciStorageSegment(
    opts.tenantNamespace || UCI_TENANT_NAMESPACE_UNCONFIGURED,
  );
  if (!projectId || !coordinationRecordId || !externalApplicationId || !safeFileName) {
    return null;
  }
  return [
    "uci",
    tenantNamespace || UCI_TENANT_NAMESPACE_UNCONFIGURED,
    projectId,
    coordinationRecordId,
    providerSlug,
    externalApplicationId,
    safeFileName,
  ].join("/");
}

/**
 * @param {Buffer} buffer
 * @returns {string}
 */
function computeContentHash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Stable identity for idempotent portal document storage.
 *
 * @param {{
 *   providerSlug: string;
 *   externalApplicationId: string;
 *   documentName: string;
 *   documentUploadDateTime?: string | null;
 * }} opts
 * @returns {string}
 */
function buildDocumentIdempotencyKey(opts) {
  const parts = [
    String(opts.providerSlug || "").trim().toLowerCase(),
    String(opts.externalApplicationId || "").trim(),
    String(opts.documentName || "").trim().toLowerCase(),
    opts.documentUploadDateTime != null ? String(opts.documentUploadDateTime).trim() : "",
  ];
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex");
}

/**
 * @param {unknown} existingFiles
 * @param {string} documentName
 * @returns {Record<string, unknown> | null}
 */
function findExistingDownloadedFile(existingFiles, documentName) {
  if (!Array.isArray(existingFiles)) return null;
  const target = String(documentName || "").trim();
  if (!target) return null;
  for (const row of existingFiles) {
    if (!row || typeof row !== "object") continue;
    const rec = /** @type {{ documentName?: unknown, fileName?: unknown }} */ (row);
    if (String(rec.documentName || "") === target || String(rec.fileName || "") === target) {
      return /** @type {Record<string, unknown>} */ (row);
    }
  }
  return null;
}

/**
 * @param {Record<string, unknown>} fileEntry
 * @returns {Record<string, unknown>}
 */
function sanitizeFileEntryForPersistence(fileEntry) {
  const out = { ...fileEntry };
  if (!isUciLocalDocumentPersistenceEnabled()) {
    delete out.localPath;
  }
  return out;
}

/**
 * @param {Array<Record<string, unknown>> | undefined} files
 * @returns {Array<Record<string, unknown>>}
 */
function sanitizeDownloadedFilesForPersistence(files) {
  if (!Array.isArray(files)) return [];
  return files.map((file) =>
    file && typeof file === "object"
      ? sanitizeFileEntryForPersistence(/** @type {Record<string, unknown>} */ (file))
      : file,
  );
}

/**
 * Store one portal document: Supabase upload (required in production) with optional local dev copy.
 *
 * @param {{
 *   supabase?: import("@supabase/supabase-js").SupabaseClient;
 *   buffer: Buffer;
 *   projectId: string;
 *   coordinationRecordId: string;
 *   providerSlug: string;
 *   externalApplicationId: string;
 *   documentName: string;
 *   fileName: string;
 *   documentUploadDateTime?: string | null;
 *   contentDisposition?: string | null;
 *   isPdf?: boolean;
 *   existingDownloadedFile?: Record<string, unknown> | null;
 *   localDocDir?: string | null;
 *   logger?: (m: string) => void;
 * }} opts
 * @returns {Promise<{
 *   fileEntry: Record<string, unknown>;
 *   storageAction: "uploaded" | "already_exists" | "updated" | "failed" | "skipped";
 *   error?: string;
 * }>}
 */
/**
 * Derive storage namespace from project — never trust client-supplied tenant IDs alone.
 * @param {import("@supabase/supabase-js").SupabaseClient | undefined} supabase
 * @param {string | undefined} projectId
 * @param {string | undefined} explicitNamespace
 * @returns {Promise<string>}
 */
async function resolveTenantNamespaceForProject(supabase, projectId, explicitNamespace) {
  if (explicitNamespace && explicitNamespace !== UCI_TENANT_NAMESPACE_UNCONFIGURED) {
    return sanitizeUciStorageSegment(explicitNamespace) || UCI_TENANT_NAMESPACE_UNCONFIGURED;
  }
  if (!supabase || !projectId || typeof supabase.from !== "function") {
    return UCI_TENANT_NAMESPACE_UNCONFIGURED;
  }
  try {
    const { data } = await supabase
      .from("projects")
      .select("tenant_id")
      .eq("id", projectId)
      .maybeSingle();
    const tenantId = data?.tenant_id ? String(data.tenant_id) : null;
    return tenantId ? sanitizeUciStorageSegment(tenantId) : UCI_TENANT_NAMESPACE_UNCONFIGURED;
  } catch {
    return UCI_TENANT_NAMESPACE_UNCONFIGURED;
  }
}

async function storeUciPortalDocument(opts) {
  const buffer = Buffer.isBuffer(opts.buffer) ? opts.buffer : Buffer.from(opts.buffer);
  const safeFileName = sanitizeUciFileName(opts.fileName || opts.documentName);
  const documentName = String(opts.documentName || "").trim();
  const contentHash = computeContentHash(buffer);
  const idempotencyKey = buildDocumentIdempotencyKey({
    providerSlug: opts.providerSlug,
    externalApplicationId: opts.externalApplicationId,
    documentName,
    documentUploadDateTime: opts.documentUploadDateTime,
  });

  const isPdf =
    opts.isPdf === true ||
    (buffer.length >= 5 && buffer.slice(0, 5).toString("utf8") === "%PDF-") ||
    /\.pdf$/i.test(safeFileName);

  /** @type {Record<string, unknown>} */
  const fileEntry = {
    documentName,
    fileName: safeFileName,
    status: "saved",
    sizeBytes: buffer.length,
    contentDisposition: opts.contentDisposition ?? null,
    detectedPdf: isPdf,
    contentHash,
    idempotencyKey,
    providerSlug: String(opts.providerSlug || "").trim().toLowerCase() || null,
    externalApplicationId: String(opts.externalApplicationId || "").trim() || null,
    downloadedAt: new Date().toISOString(),
  };

  const supabase = opts.supabase;
  const tenantNamespace = await resolveTenantNamespaceForProject(
    supabase,
    opts.projectId,
    opts.tenantNamespace || opts.tenantId,
  );

  const storagePath = buildUciStoragePath({
    projectId: opts.projectId,
    coordinationRecordId: opts.coordinationRecordId,
    providerSlug: opts.providerSlug,
    externalApplicationId: opts.externalApplicationId,
    fileName: safeFileName,
    tenantNamespace,
  });

  let storageAction = "skipped";

  if (supabase && storagePath) {
    const contentType = isPdf ? "application/pdf" : contentTypeFromStoragePath(safeFileName);
    const uploadResult = await uploadBufferToSupabaseStorage({
      supabase,
      bucket: UCI_DOCUMENTS_STORAGE_BUCKET,
      storagePath,
      body: buffer,
      contentType,
      upsert: true,
    });

    if (uploadResult.ok) {
      const prior = opts.existingDownloadedFile;
      const priorHash =
        prior && typeof prior.contentHash === "string" ? String(prior.contentHash) : null;
      const priorStored = prior && String(prior.storageStatus || "") === "stored";

      if (priorStored && priorHash && priorHash === contentHash) {
        storageAction = "already_exists";
      } else if (priorStored && priorHash && priorHash !== contentHash) {
        storageAction = "updated";
      } else {
        storageAction = "uploaded";
      }

      fileEntry.storageBucket = uploadResult.bucket;
      fileEntry.storagePath = uploadResult.storagePath;
      fileEntry.storageStatus = "stored";
      fileEntry.storageUploadedAt = new Date().toISOString();
      fileEntry.contentType = uploadResult.contentType;
      fileEntry.storageAction = storageAction;
      if (opts.logger) {
        opts.logger(
          `Stored document ${documentName} in Supabase (${uploadResult.size} bytes, ${storageAction})`,
        );
      }
    } else {
      storageAction = "failed";
      fileEntry.storageStatus = "failed";
      fileEntry.storageError = sanitizeStorageErrorForLog(uploadResult.errorMessage);
      fileEntry.storageAction = storageAction;
      console.warn("[uci-document-storage] Supabase upload failed", {
        coordinationRecordId: opts.coordinationRecordId,
        externalApplicationId: opts.externalApplicationId,
        fileName: safeFileName,
        errorCode: uploadResult.errorCode,
        errorMessage: fileEntry.storageError,
      });
    }
  } else if (supabase) {
    storageAction = "failed";
    fileEntry.storageStatus = "failed";
    fileEntry.storageError = "invalid_storage_path";
    fileEntry.storageAction = storageAction;
    console.warn("[uci-document-storage] Supabase upload skipped (invalid storage path)", {
      coordinationRecordId: opts.coordinationRecordId,
      externalApplicationId: opts.externalApplicationId,
      fileName: safeFileName,
    });
  }

  if (isUciLocalDocumentPersistenceEnabled() && opts.localDocDir) {
    try {
      const localPath = path.join(opts.localDocDir, safeFileName);
      await fs.promises.mkdir(opts.localDocDir, { recursive: true });
      await fs.promises.writeFile(localPath, buffer);
      fileEntry.localPath = localPath;
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200);
      console.warn("[uci-document-storage] local dev copy failed", {
        coordinationRecordId: opts.coordinationRecordId,
        message: msg,
      });
    }
  }

  return {
    fileEntry: sanitizeFileEntryForPersistence(fileEntry),
    storageAction,
    error:
      storageAction === "failed" && typeof fileEntry.storageError === "string"
        ? fileEntry.storageError
        : undefined,
  };
}

/**
 * @param {Array<Record<string, unknown>>} applications
 * @returns {{
 *   status: "success" | "partial" | "failed" | "not_run";
 *   uploaded_count: number;
 *   existing_count: number;
 *   failed_count: number;
 *   errors: Array<{ external_document_id?: string; filename?: string; message: string }>;
 * }}
 */
function summarizeDocumentStorageFromApplications(applications) {
  let uploaded_count = 0;
  let existing_count = 0;
  let failed_count = 0;
  /** @type {Array<{ external_document_id?: string; filename?: string; message: string }>} */
  const errors = [];
  let attempted = 0;

  for (const app of applications) {
    if (!app || typeof app !== "object") continue;
    const appUuid = String(app.applicationUuid || "").trim();
    const downloaded = Array.isArray(app.downloadedFiles) ? app.downloadedFiles : [];
    for (const file of downloaded) {
      if (!file || typeof file !== "object") continue;
      const rec = /** @type {Record<string, unknown>} */ (file);
      if (String(rec.status || "") !== "saved") {
        if (String(rec.status || "") === "failed") {
          failed_count += 1;
          errors.push({
            external_document_id: appUuid || undefined,
            filename: String(rec.documentName || rec.fileName || "").trim() || undefined,
            message: String(rec.error || rec.storageError || "download_failed").slice(0, 500),
          });
        }
        continue;
      }
      attempted += 1;
      const action = String(rec.storageAction || "");
      if (action === "already_exists") {
        existing_count += 1;
      } else if (action === "uploaded" || action === "updated") {
        uploaded_count += 1;
      } else if (String(rec.storageStatus || "") === "stored") {
        uploaded_count += 1;
      } else if (String(rec.storageStatus || "") === "failed") {
        failed_count += 1;
        errors.push({
          external_document_id: appUuid || undefined,
          filename: String(rec.documentName || rec.fileName || "").trim() || undefined,
          message: String(rec.storageError || "storage_failed").slice(0, 500),
        });
      }
    }

    const appErrors = app.errors && typeof app.errors === "object" ? app.errors : null;
    const downloadErrors = appErrors && Array.isArray(appErrors.downloads) ? appErrors.downloads : [];
    for (const dlErr of downloadErrors) {
      if (!dlErr || typeof dlErr !== "object") continue;
      const rec = /** @type {{ documentName?: unknown, error?: unknown }} */ (dlErr);
      const message = String(rec.error || "download_failed").slice(0, 500);
      if (!errors.some((e) => e.message === message && e.filename === String(rec.documentName || ""))) {
        failed_count += 1;
        errors.push({
          external_document_id: appUuid || undefined,
          filename: String(rec.documentName || "").trim() || undefined,
          message,
        });
      }
    }
  }

  if (attempted === 0 && errors.length === 0) {
    return { status: "not_run", uploaded_count: 0, existing_count: 0, failed_count: 0, errors: [] };
  }

  let status = "success";
  if (failed_count > 0) {
    status = uploaded_count > 0 || existing_count > 0 ? "partial" : "failed";
  }

  return { status, uploaded_count, existing_count, failed_count, errors };
}

/**
 * @param {Array<Record<string, unknown>>} applications
 * @returns {ReturnType<typeof summarizeDocumentStorageFromApplications>}
 */
function buildDocumentStorageApiResult(applications) {
  return summarizeDocumentStorageFromApplications(applications);
}

/**
 * Parse tenant segment from a UCI storage path. Returns null for legacy unconfigured paths.
 * @param {string} storagePath
 * @returns {{ tenantNamespace: string, projectId: string } | null}
 */
function parseUciStoragePathTenant(storagePath) {
  const parts = String(storagePath || "").split("/");
  if (parts.length < 4 || parts[0] !== "uci") return null;
  return {
    tenantNamespace: parts[1],
    projectId: parts[2],
  };
}

module.exports = {
  UCI_DOCUMENTS_STORAGE_BUCKET,
  UCI_TENANT_NAMESPACE_UNCONFIGURED,
  isUciLocalDocumentPersistenceEnabled,
  sanitizeUciStorageSegment,
  sanitizeUciFileName,
  buildUciStoragePath,
  parseUciStoragePathTenant,
  computeContentHash,
  buildDocumentIdempotencyKey,
  findExistingDownloadedFile,
  sanitizeFileEntryForPersistence,
  sanitizeDownloadedFilesForPersistence,
  resolveTenantNamespaceForProject,
  storeUciPortalDocument,
  summarizeDocumentStorageFromApplications,
  buildDocumentStorageApiResult,
};
