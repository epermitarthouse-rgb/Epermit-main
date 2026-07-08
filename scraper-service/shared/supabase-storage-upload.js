"use strict";

const fs = require("fs");
const path = require("path");
const { sanitizeStorageKey } = require("./storage.js");

const MIME_TYPES = {
  ".pdf": "application/pdf",
  ".dwg": "application/octet-stream",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".zip": "application/zip",
  ".txt": "text/plain",
};

/** @type {Set<string>} */
const verifiedBuckets = new Set();

/**
 * @param {string | undefined | null} message
 */
function isSupabaseStorageObjectTooLargeError(message) {
  const m = String(message || "").toLowerCase();
  return (
    /maximum\s+allowed\s+size|object\s+too\s+large|file\s+too\s+large|payload\s+too\s+large|413/.test(
      m,
    ) || (m.includes("size") && m.includes("exceed"))
  );
}

/**
 * @param {string} storagePath
 */
function contentTypeFromStoragePath(storagePath) {
  const ext = path.extname(String(storagePath || "")).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} bucketId
 */
async function ensureStorageBucketExists(supabase, bucketId) {
  const bucket = String(bucketId || "").trim();
  if (!bucket) return false;
  if (verifiedBuckets.has(bucket)) return true;

  try {
    const { data: buckets, error } = await supabase.storage.listBuckets();
    if (error) {
      console.error(`[storage] bucket list failed for "${bucket}":`, error.message);
      return false;
    }
    const matched = buckets?.find((b) => b.id === bucket || b.name === bucket);
    if (matched) {
      verifiedBuckets.add(bucket);
      return true;
    }
    console.error(`[storage] bucket not found: "${bucket}"`);
    return false;
  } catch (err) {
    console.error(
      `[storage] bucket check exception for "${bucket}":`,
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}

/**
 * Upload bytes to Supabase Storage (admin client).
 *
 * @param {{
 *   supabase: import("@supabase/supabase-js").SupabaseClient;
 *   bucket: string;
 *   storagePath: string;
 *   body: Buffer | Uint8Array;
 *   contentType?: string;
 *   upsert?: boolean;
 *   cacheControl?: string;
 * }} opts
 * @returns {Promise<{
 *   ok: boolean;
 *   bucket: string;
 *   storagePath: string;
 *   size: number;
 *   contentType: string;
 *   errorCode: string | null;
 *   errorMessage: string | null;
 * }>}
 */
async function uploadBufferToSupabaseStorage(opts) {
  const bucket = String(opts.bucket || "").trim();
  const sanitizedPath = sanitizeStorageKey(String(opts.storagePath || ""));
  const body = Buffer.isBuffer(opts.body) ? opts.body : Buffer.from(opts.body);
  const contentType = opts.contentType || contentTypeFromStoragePath(sanitizedPath);

  if (!bucket || !sanitizedPath) {
    return {
      ok: false,
      bucket,
      storagePath: sanitizedPath,
      size: body.length,
      contentType,
      errorCode: "invalid_storage_target",
      errorMessage: "invalid_storage_target",
    };
  }

  const ready = await ensureStorageBucketExists(opts.supabase, bucket);
  if (!ready) {
    return {
      ok: false,
      bucket,
      storagePath: sanitizedPath,
      size: body.length,
      contentType,
      errorCode: "bucket_unavailable",
      errorMessage: "bucket_unavailable",
    };
  }

  try {
    /** @type {{ contentType: string; upsert: boolean; cacheControl?: string }} */
    const uploadPayload = {
      contentType,
      upsert: opts.upsert !== false,
    };
    if (opts.cacheControl != null && `${opts.cacheControl}` !== "") {
      uploadPayload.cacheControl = `${opts.cacheControl}`;
    }

    const { error } = await opts.supabase.storage
      .from(bucket)
      .upload(sanitizedPath, body, uploadPayload);

    if (error) {
      const tooLarge = isSupabaseStorageObjectTooLargeError(error.message);
      return {
        ok: false,
        bucket,
        storagePath: sanitizedPath,
        size: body.length,
        contentType,
        errorCode: tooLarge ? "storage_object_too_large" : "storage_upload_failed",
        errorMessage: error.message || "upload_failed",
      };
    }

    return {
      ok: true,
      bucket,
      storagePath: sanitizedPath,
      size: body.length,
      contentType,
      errorCode: null,
      errorMessage: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const tooLarge = isSupabaseStorageObjectTooLargeError(message);
    return {
      ok: false,
      bucket,
      storagePath: sanitizedPath,
      size: body.length,
      contentType,
      errorCode: tooLarge ? "storage_object_too_large" : "storage_upload_exception",
      errorMessage: message || "exception",
    };
  }
}

/**
 * @param {{
 *   supabase: import("@supabase/supabase-js").SupabaseClient;
 *   bucket: string;
 *   storagePath: string;
 *   localPath: string;
 *   contentType?: string;
 *   upsert?: boolean;
 *   cacheControl?: string;
 * }} opts
 */
async function uploadFileToSupabaseStorage(opts) {
  const body = fs.readFileSync(opts.localPath);
  return uploadBufferToSupabaseStorage({
    supabase: opts.supabase,
    bucket: opts.bucket,
    storagePath: opts.storagePath,
    body,
    contentType: opts.contentType,
    upsert: opts.upsert,
    cacheControl: opts.cacheControl,
  });
}

/**
 * @param {{
 *   supabase: import("@supabase/supabase-js").SupabaseClient;
 *   bucket: string;
 *   storagePath: string;
 * }} opts
 * @returns {Promise<{ ok: boolean, data: Blob | null, errorCode: string | null, errorMessage: string | null }>}
 */
async function downloadFromSupabaseStorage(opts) {
  const bucket = String(opts.bucket || "").trim();
  const sanitizedPath = sanitizeStorageKey(String(opts.storagePath || ""));

  if (!bucket || !sanitizedPath) {
    return {
      ok: false,
      data: null,
      errorCode: "invalid_storage_target",
      errorMessage: "invalid_storage_target",
    };
  }

  try {
    const { data, error } = await opts.supabase.storage.from(bucket).download(sanitizedPath);
    if (error || !data) {
      return {
        ok: false,
        data: null,
        errorCode: "storage_download_failed",
        errorMessage: error?.message || "download_failed",
      };
    }
    return { ok: true, data, errorCode: null, errorMessage: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      data: null,
      errorCode: "storage_download_exception",
      errorMessage: message || "exception",
    };
  }
}

/**
 * @param {string | undefined | null} message
 */
function sanitizeStorageErrorForLog(message) {
  return String(message || "storage_error")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .slice(0, 200);
}

module.exports = {
  MIME_TYPES,
  contentTypeFromStoragePath,
  isSupabaseStorageObjectTooLargeError,
  ensureStorageBucketExists,
  uploadBufferToSupabaseStorage,
  uploadFileToSupabaseStorage,
  downloadFromSupabaseStorage,
  sanitizeStorageErrorForLog,
};
