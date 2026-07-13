"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  UCI_DOCUMENTS_STORAGE_BUCKET,
  buildUciStoragePath,
  buildDocumentIdempotencyKey,
  computeContentHash,
  isUciLocalDocumentPersistenceEnabled,
  storeUciPortalDocument,
  summarizeDocumentStorageFromApplications,
  sanitizeFileEntryForPersistence,
} = require("../app/services/uci/uci-document-storage.service.js");

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_PERSIST_LOCAL = process.env.UCI_PERSIST_LOCAL_DOCUMENTS;

/**
 * @param {Buffer} body
 */
function makeSupabaseStorageMock(opts = {}) {
  const storedObjects = opts.storedObjects ?? new Map();
  const uploads = [];

  const supabase = {
    storage: {
      listBuckets: async () => ({
        data: [{ id: UCI_DOCUMENTS_STORAGE_BUCKET }],
        error: null,
      }),
      from(bucket) {
        return {
          upload: async (storagePath, body) => {
            uploads.push({ bucket, storagePath, body: Buffer.from(body) });
            if (opts.uploadShouldFail) {
              return { data: null, error: { message: "upload_failed" } };
            }
            storedObjects.set(`${bucket}:${storagePath}`, Buffer.from(body));
            return { data: { path: storagePath }, error: null };
          },
        };
      },
    },
  };

  return { supabase, uploads, storedObjects };
}

describe("uci-document-storage.service", () => {
  afterEach(() => {
    if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    if (ORIGINAL_PERSIST_LOCAL === undefined) delete process.env.UCI_PERSIST_LOCAL_DOCUMENTS;
    else process.env.UCI_PERSIST_LOCAL_DOCUMENTS = ORIGINAL_PERSIST_LOCAL;
  });

  it("builds the standard UCI storage path with unconfigured tenant namespace", () => {
    const storagePath = buildUciStoragePath({
      projectId: "proj-1",
      coordinationRecordId: "coord-1",
      providerSlug: "pepco",
      externalApplicationId: "app-uuid",
      fileName: "My Plan.pdf",
    });
    assert.equal(
      storagePath,
      "uci/unconfigured/proj-1/coord-1/pepco/app-uuid/My_Plan.pdf",
    );
  });

  it("computes stable idempotency keys from provider + app + document name", () => {
    const a = buildDocumentIdempotencyKey({
      providerSlug: "pepco",
      externalApplicationId: "uuid-1",
      documentName: "plan.pdf",
      documentUploadDateTime: "2026-01-01T00:00:00Z",
    });
    const b = buildDocumentIdempotencyKey({
      providerSlug: "pepco",
      externalApplicationId: "uuid-1",
      documentName: "plan.pdf",
      documentUploadDateTime: "2026-01-01T00:00:00Z",
    });
    const c = buildDocumentIdempotencyKey({
      providerSlug: "pepco",
      externalApplicationId: "uuid-1",
      documentName: "other.pdf",
      documentUploadDateTime: "2026-01-01T00:00:00Z",
    });
    assert.equal(a, b);
    assert.notEqual(a, c);
  });

  it("disables local persistence in production by default", () => {
    process.env.NODE_ENV = "production";
    delete process.env.UCI_PERSIST_LOCAL_DOCUMENTS;
    assert.equal(isUciLocalDocumentPersistenceEnabled(), false);
  });

  it("uploads to Supabase without writing local files in production mode", async () => {
    process.env.NODE_ENV = "production";
    process.env.UCI_PERSIST_LOCAL_DOCUMENTS = "false";

    const pdfBody = Buffer.from("%PDF-1.4 prod-mode");
    const { supabase, uploads } = makeSupabaseStorageMock();
    const localDir = path.join(__dirname, "tmp-prod-doc-test");

    const result = await storeUciPortalDocument({
      supabase,
      buffer: pdfBody,
      projectId: "proj-prod",
      coordinationRecordId: "coord-prod",
      providerSlug: "pepco",
      externalApplicationId: "app-prod",
      documentName: "plan.pdf",
      fileName: "plan.pdf",
      localDocDir: localDir,
    });

    assert.equal(result.storageAction, "uploaded");
    assert.equal(result.fileEntry.storageStatus, "stored");
    assert.equal(result.fileEntry.localPath, undefined);
    assert.equal(uploads.length, 1);
    assert.equal(fs.existsSync(path.join(localDir, "plan.pdf")), false);
  });

  it("marks already_exists when content hash matches prior stored metadata", async () => {
    process.env.NODE_ENV = "test";
    const pdfBody = Buffer.from("%PDF-1.4 same-content");
    const hash = computeContentHash(pdfBody);
    const { supabase } = makeSupabaseStorageMock();

    const result = await storeUciPortalDocument({
      supabase,
      buffer: pdfBody,
      projectId: "proj-1",
      coordinationRecordId: "coord-1",
      providerSlug: "pepco",
      externalApplicationId: "app-1",
      documentName: "plan.pdf",
      fileName: "plan.pdf",
      existingDownloadedFile: {
        documentName: "plan.pdf",
        storageStatus: "stored",
        contentHash: hash,
      },
    });

    assert.equal(result.storageAction, "already_exists");
    assert.equal(result.fileEntry.storageStatus, "stored");
  });

  it("marks updated when content hash changes for the same document name", async () => {
    process.env.NODE_ENV = "test";
    const pdfBody = Buffer.from("%PDF-1.4 new-content");
    const { supabase } = makeSupabaseStorageMock();

    const result = await storeUciPortalDocument({
      supabase,
      buffer: pdfBody,
      projectId: "proj-1",
      coordinationRecordId: "coord-1",
      providerSlug: "pepco",
      externalApplicationId: "app-1",
      documentName: "plan.pdf",
      fileName: "plan.pdf",
      existingDownloadedFile: {
        documentName: "plan.pdf",
        storageStatus: "stored",
        contentHash: computeContentHash(Buffer.from("%PDF-1.4 old-content")),
      },
    });

    assert.equal(result.storageAction, "updated");
  });

  it("summarizes document storage results without failing the scrape", () => {
    const summary = summarizeDocumentStorageFromApplications([
      {
        applicationUuid: "app-1",
        downloadedFiles: [
          {
            status: "saved",
            storageStatus: "stored",
            storageAction: "uploaded",
            documentName: "a.pdf",
          },
          {
            status: "saved",
            storageStatus: "stored",
            storageAction: "already_exists",
            documentName: "b.pdf",
          },
          {
            status: "saved",
            storageStatus: "failed",
            storageError: "upload_failed",
            documentName: "c.pdf",
          },
        ],
        errors: { downloads: [{ documentName: "d.pdf", error: "network" }] },
      },
    ]);

    assert.equal(summary.status, "partial");
    assert.equal(summary.uploaded_count, 1);
    assert.equal(summary.existing_count, 1);
    assert.equal(summary.failed_count, 2);
    assert.equal(summary.errors.length, 2);
    assert.ok(!JSON.stringify(summary).includes("/Users/"));
  });

  it("strips localPath from persisted metadata in production", () => {
    process.env.NODE_ENV = "production";
    process.env.UCI_PERSIST_LOCAL_DOCUMENTS = "false";
    const sanitized = sanitizeFileEntryForPersistence({
      documentName: "plan.pdf",
      localPath: "/tmp/plan.pdf",
      storageStatus: "stored",
    });
    assert.equal(sanitized.localPath, undefined);
  });
});
