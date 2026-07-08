"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  buildPepcoSupabaseStoragePath,
  downloadPepcoDocuments,
  PEPCO_DOCUMENTS_STORAGE_BUCKET,
  resolvePepcoStoredDocumentPath,
} = require("../scrapers/pepco/application-detail-discovery.js");

/**
 * @param {Buffer} body
 */
function makeMockRequest(body) {
  return {
    post: async () => ({
      ok: () => true,
      status: () => 200,
      body: async () => body,
      headers: () => ({ "content-disposition": 'filename="plan.pdf"' }),
      text: async () => "",
    }),
  };
}

/**
 * @param {{ uploadShouldFail?: boolean, storedObjects?: Map<string, Buffer> }} opts
 */
function makeSupabaseStorageMock(opts = {}) {
  const storedObjects = opts.storedObjects ?? new Map();
  const uploads = [];

  const supabase = {
    storage: {
      listBuckets: async () => ({
        data: [{ id: PEPCO_DOCUMENTS_STORAGE_BUCKET }],
        error: null,
      }),
      from(bucket) {
        return {
          upload: async (storagePath, body) => {
            uploads.push({ bucket, storagePath, body });
            if (opts.uploadShouldFail) {
              return { data: null, error: { message: "upload_failed" } };
            }
            storedObjects.set(`${bucket}:${storagePath}`, Buffer.from(body));
            return { data: { path: storagePath }, error: null };
          },
          download: async (storagePath) => {
            const key = `${bucket}:${storagePath}`;
            const data = storedObjects.get(key);
            if (!data) return { data: null, error: { message: "not_found" } };
            return { data: new Blob([data], { type: "application/pdf" }), error: null };
          },
        };
      },
    },
  };

  return { supabase, uploads, storedObjects };
}

describe("PEPCO Supabase document storage", () => {
  const coordinationId = "coord-storage-test";
  const projectId = "project-storage-test";
  const applicationUuid = "app-storage-test-uuid";

  /** @type {string[]} */
  let createdLocalPaths = [];

  afterEach(() => {
    for (const p of createdLocalPaths) {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch (_) {}
    }
    createdLocalPaths = [];
  });

  it("builds the expected durable storage path", () => {
    const storagePath = buildPepcoSupabaseStoragePath({
      projectId,
      coordinationId,
      applicationUuid,
      fileName: "My Plan.pdf",
    });
    assert.equal(
      storagePath,
      `uci/unconfigured/${projectId}/${coordinationId}/pepco/${applicationUuid}/My_Plan.pdf`,
    );
  });

  it("neutralizes traversal segments in storage path", () => {
    const storagePath = buildPepcoSupabaseStoragePath({
      projectId: "../evil",
      coordinationId: coordinationId,
      applicationUuid: applicationUuid,
      fileName: "../../secret.pdf",
    });
    assert.ok(storagePath);
    assert.ok(!/(^|\/)\.\.(\/|$)/.test(storagePath));
    assert.equal(path.basename(storagePath), ".._.._secret.pdf");
  });

  it("uploads successfully downloaded PEPCO documents to Supabase", async () => {
    const pdfBody = Buffer.from("%PDF-1.4 storage-test");
    const { supabase, uploads } = makeSupabaseStorageMock();

    const result = await downloadPepcoDocuments(
      makeMockRequest(pdfBody),
      applicationUuid,
      [{ documentName: "plan.pdf" }],
      {
        coordinationId,
        projectId,
        supabase,
      },
    );

    const file = result.downloadedFiles[0];
    assert.equal(file.status, "saved");
    assert.equal(file.storageStatus, "stored");
    assert.equal(file.storageBucket, PEPCO_DOCUMENTS_STORAGE_BUCKET);
    assert.ok(typeof file.storagePath === "string" && file.storagePath.startsWith("uci/unconfigured/"));
    assert.ok(file.storageUploadedAt);
    assert.equal(file.contentType, "application/pdf");
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].bucket, PEPCO_DOCUMENTS_STORAGE_BUCKET);

    const localPath = resolvePepcoStoredDocumentPath({
      coordinationId,
      applicationUuid,
      fileName: String(file.fileName),
    });
    assert.ok(localPath);
    createdLocalPaths.push(localPath);
    assert.ok(fs.existsSync(localPath));
  });

  it("does not fail the scrape when Supabase upload fails", async () => {
    const pdfBody = Buffer.from("%PDF-1.4 upload-fail");
    const { supabase } = makeSupabaseStorageMock({ uploadShouldFail: true });

    const result = await downloadPepcoDocuments(
      makeMockRequest(pdfBody),
      applicationUuid,
      [{ documentName: "plan.pdf" }],
      {
        coordinationId,
        projectId,
        supabase,
      },
    );

    const file = result.downloadedFiles[0];
    assert.equal(file.status, "saved");
    assert.equal(file.storageStatus, "failed");
    assert.ok(file.storageError);
    assert.equal(file.storageBucket, undefined);

    const localPath = resolvePepcoStoredDocumentPath({
      coordinationId,
      applicationUuid,
      fileName: String(file.fileName),
    });
    assert.ok(localPath);
    createdLocalPaths.push(localPath);
    assert.ok(fs.existsSync(localPath));
  });

  it("upserts the same storage object on duplicate refresh", async () => {
    const pdfBody = Buffer.from("%PDF-1.4 upsert");
    const { supabase, uploads } = makeSupabaseStorageMock();

    await downloadPepcoDocuments(makeMockRequest(pdfBody), applicationUuid, [{ documentName: "plan.pdf" }], {
      coordinationId,
      projectId,
      supabase,
    });
    await downloadPepcoDocuments(makeMockRequest(pdfBody), applicationUuid, [{ documentName: "plan.pdf" }], {
      coordinationId,
      projectId,
      supabase,
    });

    assert.equal(uploads.length, 2);
    assert.equal(uploads[0].storagePath, uploads[1].storagePath);
  });
});
