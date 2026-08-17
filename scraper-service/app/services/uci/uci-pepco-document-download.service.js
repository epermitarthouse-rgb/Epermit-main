"use strict";

const fs = require("fs");
const path = require("path");
const { getCoordinationRecordById } = require("./uci-records.service.js");
const { requireProjectAccess } = require("./uci-access.service.js");
const { sanitizeApplicationRowsForApi } = require("./uci-sync-utils.js");
const { assertPepcoCoordination } = require("./uci-pepco-discovery.service.js");
const {
  getPepcoDocStorageRoot,
  resolvePepcoStoredDocumentPath,
} = require("../../../scrapers/pepco/application-detail-discovery.js");
const { downloadFromSupabaseStorage } = require("../../../shared/supabase-storage-upload.js");

/**
 * Remove absolute filesystem paths from PEPCO download metadata before API responses.
 *
 * @param {unknown} metadata
 * @returns {unknown}
 */
function sanitizePepcoMetadataForApi(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return metadata;
  }

  const copy = JSON.parse(JSON.stringify(metadata));
  const discovery = copy.pepco_application_detail_discovery;
  if (!discovery || typeof discovery !== "object" || !Array.isArray(discovery.applications)) {
    return copy;
  }

  for (const app of discovery.applications) {
    if (!app || typeof app !== "object" || !Array.isArray(app.downloadedFiles)) continue;
    for (const file of app.downloadedFiles) {
      if (file && typeof file === "object") {
        delete file.localPath;
        delete file.storagePath;
      }
    }
  }

  return copy;
}

/**
 * @param {Record<string, unknown>} record
 */
function sanitizeCoordinationRecordForApi(record) {
  if (!record || typeof record !== "object") return record;
  const out = { ...record };
  if (out.metadata != null) {
    const metadata = sanitizePepcoMetadataForApi(out.metadata);
    if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
      // The document manifest has a dedicated lazy endpoint. Returning its
      // full OCR/findings snapshot on every record open added hundreds of KB
      // to the shared detail response and duplicated Load Profile hydration.
      delete metadata.uci_document_processing;
    }
    out.metadata = metadata;
  }
  return out;
}

/**
 * @param {Record<string, unknown>} detail
 */
function sanitizeCoordinationDetailBundleForApi(detail) {
  if (!detail || typeof detail !== "object") return detail;
  const out = { ...detail };
  if (out.record && typeof out.record === "object") {
    out.record = sanitizeCoordinationRecordForApi(/** @type {Record<string, unknown>} */ (out.record));
  }
  if (Array.isArray(out.applications)) {
    out.applications = sanitizeApplicationRowsForApi(
      /** @type {Array<Record<string, unknown>>} */ (out.applications),
    );
  }
  return out;
}

/**
 * Resolve a downloaded PEPCO document for authorized streaming.
 *
 * @param {{
 *   supabase: import("@supabase/supabase-js").SupabaseClient;
 *   userId: string;
 *   coordinationId: string;
 *   applicationUuid: string;
 *   documentIndex: number;
 * }} opts
 * @returns {Promise<{
 *   source: "supabase" | "local";
 *   filename: string;
 *   downloadName: string;
 *   contentType: string;
 *   isPdf: boolean;
 *   storageBucket: string | null;
 *   storagePath: string | null;
 *   localFilePath: string | null;
 * }>}
 */
async function resolvePepcoDownloadedDocumentFile(opts) {
  const coordinationId = String(opts.coordinationId || "").trim();
  const applicationUuid = String(opts.applicationUuid || "").trim();
  const documentIndex = opts.documentIndex;

  if (!coordinationId || !applicationUuid) {
    const err = new Error("coordination id and application uuid are required");
    err.statusCode = 400;
    err.code = "INVALID_PARAMS";
    throw err;
  }

  if (!Number.isInteger(documentIndex) || documentIndex < 0) {
    const err = new Error("document index must be a non-negative integer");
    err.statusCode = 400;
    err.code = "INVALID_DOCUMENT_INDEX";
    throw err;
  }

  const record = await getCoordinationRecordById(opts.supabase, coordinationId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  await requireProjectAccess({
    supabase: opts.supabase,
    userId: opts.userId,
    projectId: String(record.project_id),
  });
  assertPepcoCoordination(record);

  const meta =
    record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
      ? /** @type {Record<string, unknown>} */ (record.metadata)
      : {};
  const discovery = meta.pepco_application_detail_discovery;
  const discoveryObj =
    discovery && typeof discovery === "object" && !Array.isArray(discovery)
      ? /** @type {{ applications?: unknown[] }} */ (discovery)
      : null;
  const apps = Array.isArray(discoveryObj?.applications) ? discoveryObj.applications : [];

  const app = apps.find((row) => {
    if (!row || typeof row !== "object") return false;
    return String(/** @type {{ applicationUuid?: unknown }} */ (row).applicationUuid || "") === applicationUuid;
  });

  if (!app || typeof app !== "object") {
    const err = new Error("PEPCO application not found for this coordination record");
    err.statusCode = 404;
    err.code = "APPLICATION_NOT_FOUND";
    throw err;
  }

  const documents = Array.isArray(/** @type {{ documents?: unknown[] }} */ (app).documents)
    ? /** @type {{ documents?: unknown[] }} */ (app).documents
    : [];
  const docRow = documents[documentIndex];
  if (!docRow || typeof docRow !== "object") {
    const err = new Error("Document not found at the requested index");
    err.statusCode = 404;
    err.code = "DOCUMENT_NOT_FOUND";
    throw err;
  }

  const documentName = String(/** @type {{ documentName?: unknown }} */ (docRow).documentName || "").trim();
  if (!documentName) {
    const err = new Error("Document metadata is incomplete");
    err.statusCode = 404;
    err.code = "DOCUMENT_NOT_FOUND";
    throw err;
  }

  const downloaded = Array.isArray(/** @type {{ downloadedFiles?: unknown[] }} */ (app).downloadedFiles)
    ? /** @type {{ downloadedFiles?: unknown[] }} */ (app).downloadedFiles
    : [];
  const saved = downloaded.find((row) => {
    if (!row || typeof row !== "object") return false;
    const r = /** @type {{ documentName?: unknown, fileName?: unknown, status?: unknown }} */ (row);
    if (String(r.status || "") !== "saved") return false;
    return (
      String(r.documentName || "") === documentName || String(r.fileName || "") === documentName
    );
  });

  if (!saved || typeof saved !== "object") {
    const err = new Error("This document was not downloaded during the last scrape");
    err.statusCode = 404;
    err.code = "DOCUMENT_NOT_DOWNLOADED";
    throw err;
  }

  const savedRec = /** @type {{
    fileName?: unknown;
    documentName?: unknown;
    detectedPdf?: unknown;
    contentType?: unknown;
    storageStatus?: unknown;
    storageBucket?: unknown;
    storagePath?: unknown;
  }} */ (saved);
  const fileName = String(savedRec.fileName || savedRec.documentName || documentName).trim();
  const isPdf = savedRec.detectedPdf === true || /\.pdf$/i.test(fileName);
  const downloadName = path.basename(fileName);
  const defaultContentType = isPdf ? "application/pdf" : "application/octet-stream";
  const savedContentType =
    typeof savedRec.contentType === "string" && savedRec.contentType.trim()
      ? savedRec.contentType.trim()
      : defaultContentType;

  const storageStatus = String(savedRec.storageStatus || "");
  const storageBucket = String(savedRec.storageBucket || "").trim();
  const storagePath = String(savedRec.storagePath || "").trim();

  if (storageStatus === "stored" && storageBucket && storagePath) {
    return {
      source: "supabase",
      filename: downloadName,
      downloadName,
      contentType: savedContentType,
      isPdf,
      storageBucket,
      storagePath,
      localFilePath: null,
    };
  }

  const resolvedPath = resolvePepcoStoredDocumentPath({
    coordinationId,
    applicationUuid,
    fileName,
  });

  if (resolvedPath) {
    const root = path.resolve(getPepcoDocStorageRoot());
    const normalized = path.resolve(resolvedPath);
    if (
      normalized.startsWith(root + path.sep) &&
      fs.existsSync(normalized) &&
      fs.statSync(normalized).isFile()
    ) {
      const localContentType =
        isPdf && !/pdf/i.test(savedContentType) ? "application/pdf" : savedContentType;
      return {
        source: "local",
        filename: downloadName,
        downloadName,
        contentType: localContentType,
        isPdf,
        storageBucket: null,
        storagePath: null,
        localFilePath: normalized,
      };
    }
  }

  const err = new Error(
    "The stored document copy is no longer available. Refresh project details to save it again.",
  );
  err.statusCode = 410;
  err.code = "DOCUMENT_COPY_UNAVAILABLE";
  throw err;
}

/**
 * Strip control characters and quotes from a filename used in Content-Disposition.
 *
 * @param {string | null | undefined} name
 * @returns {string}
 */
function sanitizeContentDispositionFilename(name) {
  const base = path.basename(String(name || "pepco-document").trim() || "pepco-document");
  return base.replace(/[\r\n"]/g, "_");
}

/**
 * Build HTTP headers for streaming a resolved PEPCO document.
 * Inline viewing is limited to PDFs; non-PDF inline requests return 415.
 *
 * @param {{
 *   contentType: string;
 *   downloadName: string;
 *   isPdf: boolean;
 * }} fileOut
 * @param {"inline" | "attachment"} disposition
 * @returns {{ contentType: string, contentDisposition: string }}
 */
function buildPepcoDocumentHttpHeaders(fileOut, disposition) {
  const safeName = sanitizeContentDispositionFilename(fileOut.downloadName);

  if (disposition === "inline") {
    if (!fileOut.isPdf) {
      const err = new Error("Only PDF documents can be viewed inline in the browser");
      err.statusCode = 415;
      err.code = "UNSUPPORTED_MEDIA_TYPE";
      throw err;
    }
    return {
      contentType: "application/pdf",
      contentDisposition: `inline; filename="${safeName}"`,
    };
  }

  return {
    contentType: fileOut.contentType,
    contentDisposition: `attachment; filename="${safeName}"`,
  };
}

/**
 * Shared Express handler for PEPCO document download (attachment) and view (inline).
 *
 * @param {{
 *   req: import("express").Request;
 *   res: import("express").Response;
 *   supabase: import("@supabase/supabase-js").SupabaseClient;
 *   requireAuthenticatedUser: (req: import("express").Request, supabase: import("@supabase/supabase-js").SupabaseClient) => Promise<{ id: string }>;
 *   sanitizeUciError: (err: unknown) => { httpStatus: number, body: Record<string, unknown> };
 *   disposition: "inline" | "attachment";
 *   logLabel: string;
 * }} opts
 */
async function streamPepcoDocumentForRequest(opts) {
  const coordinationId = String(opts.req.params.id || "").trim();
  const applicationUuid = String(opts.req.params.applicationUuid || "").trim();
  const documentIndex = Number.parseInt(String(opts.req.params.documentIndex || ""), 10);

  try {
    const user = await opts.requireAuthenticatedUser(opts.req, opts.supabase);
    const fileOut = await resolvePepcoDownloadedDocumentFile({
      supabase: opts.supabase,
      userId: user.id,
      coordinationId,
      applicationUuid,
      documentIndex,
    });
    const headers = buildPepcoDocumentHttpHeaders(fileOut, opts.disposition);

    opts.res.setHeader("Content-Type", headers.contentType);
    opts.res.setHeader("Content-Disposition", headers.contentDisposition);

    if (fileOut.source === "supabase") {
      const downloadResult = await downloadFromSupabaseStorage({
        supabase: opts.supabase,
        bucket: String(fileOut.storageBucket),
        storagePath: String(fileOut.storagePath),
      });

      if (!downloadResult.ok || !downloadResult.data) {
        const err = new Error(
          "The stored document copy is no longer available. Refresh project details to save it again.",
        );
        err.statusCode = 410;
        err.code = "DOCUMENT_COPY_UNAVAILABLE";
        throw err;
      }

      const buffer = Buffer.from(await downloadResult.data.arrayBuffer());
      opts.res.send(buffer);
      return;
    }

    opts.res.sendFile(/** @type {string} */ (fileOut.localFilePath), (sendErr) => {
      if (sendErr) {
        console.error(`[uci-pepco-app-detail] document ${opts.logLabel} sendFile failed`, {
          coordinationId,
          applicationUuid,
          documentIndex,
          message: sendErr instanceof Error ? sendErr.message : String(sendErr),
        });
        if (!opts.res.headersSent) {
          const err = new Error("Downloaded file could not be streamed");
          err.statusCode = 500;
          err.code = "DOCUMENT_STREAM_FAILED";
          const s = opts.sanitizeUciError(err);
          opts.res.status(s.httpStatus).json(s.body);
        }
      }
    });
  } catch (err) {
    const e = /** @type {Error & { statusCode?: number, code?: string }} */ (err);
    if (e.statusCode && e.statusCode !== 500) {
      console.warn(`[uci-pepco-app-detail] document ${opts.logLabel} rejected`, {
        coordinationId,
        applicationUuid,
        documentIndex,
        code: e.code,
        message: e.message,
      });
    } else {
      console.error(`[uci-pepco-app-detail] document ${opts.logLabel} error`, {
        coordinationId,
        applicationUuid,
        documentIndex,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    const s = opts.sanitizeUciError(err);
    opts.res.status(s.httpStatus).json(s.body);
  }
}

module.exports = {
  sanitizePepcoMetadataForApi,
  sanitizeCoordinationRecordForApi,
  sanitizeCoordinationDetailBundleForApi,
  resolvePepcoDownloadedDocumentFile,
  sanitizeContentDispositionFilename,
  buildPepcoDocumentHttpHeaders,
  streamPepcoDocumentForRequest,
};
