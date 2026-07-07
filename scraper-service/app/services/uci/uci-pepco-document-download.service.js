"use strict";

const fs = require("fs");
const path = require("path");
const { getCoordinationRecordById } = require("./uci-records.service.js");
const { requireProjectAccess } = require("./uci-access.service.js");
const { assertPepcoCoordination } = require("./uci-pepco-discovery.service.js");
const {
  getPepcoDocStorageRoot,
  resolvePepcoStoredDocumentPath,
} = require("../../../scrapers/pepco/application-detail-discovery.js");

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
        const sp = file.storagePath;
        if (typeof sp === "string" && (path.isAbsolute(sp) || sp.includes(".."))) {
          delete file.storagePath;
        }
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
    out.metadata = sanitizePepcoMetadataForApi(out.metadata);
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
  return out;
}

/**
 * Resolve a downloaded PEPCO document on disk for authorized streaming.
 *
 * @param {{
 *   supabase: import("@supabase/supabase-js").SupabaseClient;
 *   userId: string;
 *   coordinationId: string;
 *   applicationUuid: string;
 *   documentIndex: number;
 * }} opts
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

  const savedRec = /** @type {{ fileName?: unknown, documentName?: unknown, detectedPdf?: unknown }} */ (
    saved
  );
  const fileName = String(savedRec.fileName || savedRec.documentName || documentName).trim();
  const resolvedPath = resolvePepcoStoredDocumentPath({
    coordinationId,
    applicationUuid,
    fileName,
  });

  if (!resolvedPath) {
    const err = new Error("Download path could not be resolved safely");
    err.statusCode = 404;
    err.code = "DOCUMENT_PATH_INVALID";
    throw err;
  }

  const root = path.resolve(getPepcoDocStorageRoot());
  const normalized = path.resolve(resolvedPath);
  if (!normalized.startsWith(root + path.sep)) {
    const err = new Error("Download path is outside the allowed PEPCO document root");
    err.statusCode = 403;
    err.code = "DOCUMENT_PATH_FORBIDDEN";
    throw err;
  }

  if (!fs.existsSync(normalized) || !fs.statSync(normalized).isFile()) {
    const err = new Error("Downloaded file is no longer available on the server");
    err.statusCode = 404;
    err.code = "DOCUMENT_FILE_MISSING";
    throw err;
  }

  const detectedPdf = savedRec.detectedPdf === true || /\.pdf$/i.test(fileName);
  const contentType = detectedPdf ? "application/pdf" : "application/octet-stream";

  return {
    filePath: normalized,
    downloadName: path.basename(fileName),
    contentType,
  };
}

module.exports = {
  sanitizePepcoMetadataForApi,
  sanitizeCoordinationRecordForApi,
  sanitizeCoordinationDetailBundleForApi,
  resolvePepcoDownloadedDocumentFile,
};
