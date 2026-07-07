"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const express = require("express");
const http = require("http");
const {
  sanitizePepcoMetadataForApi,
  sanitizeContentDispositionFilename,
  buildPepcoDocumentHttpHeaders,
  resolvePepcoDownloadedDocumentFile,
} = require("../app/services/uci/uci-pepco-document-download.service.js");
const { createUciRouter } = require("../app/routes/uci.routes.js");
const {
  resolvePepcoStoredDocumentPath,
  getPepcoDocStorageRoot,
} = require("../scrapers/pepco/application-detail-discovery.js");

const COORD_ID = "coord-view-test";
const APP_UUID = "app-view-test-uuid";
const PROJECT_ID = "project-view-test";
const USER_ALLOWED = "user-allowed";
const USER_DENIED = "user-denied";

/** @type {Record<string, unknown>} */
const pepcoRecord = {
  id: COORD_ID,
  project_id: PROJECT_ID,
  utility_providers: { slug: "pepco" },
  metadata: {
    pepco_application_detail_discovery: {
      applications: [
        {
          applicationUuid: APP_UUID,
          documents: [{ documentName: "plan.pdf" }, { documentName: "notes.txt" }],
          downloadedFiles: [
            {
              documentName: "plan.pdf",
              fileName: "plan.pdf",
              status: "saved",
              detectedPdf: true,
            },
            {
              documentName: "notes.txt",
              fileName: "notes.txt",
              status: "saved",
              detectedPdf: false,
            },
          ],
        },
      ],
    },
  },
};

/**
 * @param {{ record?: Record<string, unknown> | null, hasAccess?: boolean }} opts
 */
function makeSupabaseMock(opts = {}) {
  const record = "record" in opts ? opts.record : pepcoRecord;
  const hasAccess = opts.hasAccess !== false;
  return {
    auth: {
      getUser: async (token) => {
        if (!token) return { data: { user: null }, error: new Error("missing token") };
        if (token === "denied-token") {
          return { data: { user: { id: USER_DENIED } }, error: null };
        }
        return { data: { user: { id: USER_ALLOWED } }, error: null };
      },
    },
    from(table) {
      assert.equal(table, "coordination_records");
      return {
        select() {
          return {
            eq(_col, id) {
              return {
                maybeSingle: async () => ({ data: record, error: null }),
              };
            },
          };
        },
      };
    },
    async rpc(name, args) {
      if (name === "has_project_access") {
        if (args._user_id === USER_DENIED) return { data: false, error: null };
        return { data: hasAccess, error: null };
      }
      return { data: null, error: null };
    },
  };
}

describe("PEPCO document view/download shared service", () => {
  it("strips localPath and absolute storagePath from API metadata", () => {
    const metadata = {
      pepco_application_detail_discovery: {
        applications: [
          {
            applicationUuid: "app-1",
            downloadedFiles: [
              {
                documentName: "plan.pdf",
                status: "saved",
                localPath: "/Users/test/scraper-service/debug/pepco-docs/x/plan.pdf",
                storagePath: "/Users/test/scraper-service/debug/pepco-docs/x/plan.pdf",
              },
            ],
          },
        ],
      },
    };

    const sanitized = /** @type {Record<string, unknown>} */ (
      sanitizePepcoMetadataForApi(metadata)
    );
    const app = /** @type {{ downloadedFiles?: Record<string, unknown>[] }} */ (
      /** @type {{ applications?: unknown[] }} */ (
        sanitized.pepco_application_detail_discovery
      ).applications?.[0]
    );
    const file = app.downloadedFiles?.[0] ?? {};
    assert.equal(file.localPath, undefined);
    assert.equal(file.storagePath, undefined);
    assert.equal(file.documentName, "plan.pdf");
  });

  it("neutralizes path traversal in stored document resolution", () => {
    const root = path.resolve(getPepcoDocStorageRoot());
    const resolved = resolvePepcoStoredDocumentPath({
      coordinationId: "coord-1",
      applicationUuid: "app-1",
      fileName: "../../../etc/passwd",
    });

    assert.ok(resolved);
    assert.ok(resolved.startsWith(root + path.sep));
    assert.ok(!resolved.includes(`${path.sep}..${path.sep}`));
    assert.equal(path.basename(resolved), ".._.._.._etc_passwd");
  });

  it("returns null for empty file names", () => {
    assert.equal(
      resolvePepcoStoredDocumentPath({
        coordinationId: "coord-1",
        applicationUuid: "app-1",
        fileName: "   ",
      }),
      null,
    );
  });

  it("sanitizes unsafe filename characters for Content-Disposition", () => {
    assert.equal(
      sanitizeContentDispositionFilename('report"\r\nbad.pdf'),
      "report___bad.pdf",
    );
  });

  it("builds inline PDF headers with application/pdf and inline disposition", () => {
    const headers = buildPepcoDocumentHttpHeaders(
      {
        contentType: "application/pdf",
        downloadName: "plan.pdf",
        isPdf: true,
      },
      "inline",
    );
    assert.equal(headers.contentType, "application/pdf");
    assert.equal(headers.contentDisposition, 'inline; filename="plan.pdf"');
  });

  it("builds attachment headers for non-PDF downloads", () => {
    const headers = buildPepcoDocumentHttpHeaders(
      {
        contentType: "application/octet-stream",
        downloadName: "notes.txt",
        isPdf: false,
      },
      "attachment",
    );
    assert.equal(headers.contentType, "application/octet-stream");
    assert.equal(headers.contentDisposition, 'attachment; filename="notes.txt"');
  });

  it("returns 415 for non-PDF inline view requests", () => {
    assert.throws(
      () =>
        buildPepcoDocumentHttpHeaders(
          {
            contentType: "application/octet-stream",
            downloadName: "notes.txt",
            isPdf: false,
          },
          "inline",
        ),
      (err) => {
        const e = /** @type {Error & { statusCode?: number, code?: string }} */ (err);
        assert.equal(e.statusCode, 415);
        assert.equal(e.code, "UNSUPPORTED_MEDIA_TYPE");
        return true;
      },
    );
  });

  it("rejects invalid document indexes", async () => {
    await assert.rejects(
      () =>
        resolvePepcoDownloadedDocumentFile({
          supabase: makeSupabaseMock(),
          userId: USER_ALLOWED,
          coordinationId: COORD_ID,
          applicationUuid: APP_UUID,
          documentIndex: -1,
        }),
      (err) => {
        const e = /** @type {Error & { statusCode?: number, code?: string }} */ (err);
        assert.equal(e.statusCode, 400);
        assert.equal(e.code, "INVALID_DOCUMENT_INDEX");
        return true;
      },
    );
  });

  it("rejects unauthorized project access without leaking filesystem paths", async () => {
    await assert.rejects(
      () =>
        resolvePepcoDownloadedDocumentFile({
          supabase: makeSupabaseMock({ hasAccess: false }),
          userId: USER_DENIED,
          coordinationId: COORD_ID,
          applicationUuid: APP_UUID,
          documentIndex: 0,
        }),
      (err) => {
        const e = /** @type {Error & { statusCode?: number, code?: string, message?: string }} */ (
          err
        );
        assert.equal(e.statusCode, 403);
        assert.equal(e.code, "PROJECT_ACCESS_DENIED");
        assert.ok(!String(e.message || "").includes("/"));
        return true;
      },
    );
  });

  it("rejects missing document rows at an out-of-range index", async () => {
    await assert.rejects(
      () =>
        resolvePepcoDownloadedDocumentFile({
          supabase: makeSupabaseMock(),
          userId: USER_ALLOWED,
          coordinationId: COORD_ID,
          applicationUuid: APP_UUID,
          documentIndex: 99,
        }),
      (err) => {
        const e = /** @type {Error & { statusCode?: number, code?: string }} */ (err);
        assert.equal(e.statusCode, 404);
        assert.equal(e.code, "DOCUMENT_NOT_FOUND");
        return true;
      },
    );
  });
});

describe("PEPCO document HTTP routes", () => {
  /** @type {http.Server | null} */
  let server = null;
  /** @type {string} */
  let baseUrl = "";
  /** @type {string | null} */
  let pdfPath = null;

  before(async () => {
    pdfPath = resolvePepcoStoredDocumentPath({
      coordinationId: COORD_ID,
      applicationUuid: APP_UUID,
      fileName: "plan.pdf",
    });
    assert.ok(pdfPath);
    fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
    fs.writeFileSync(pdfPath, "%PDF-1.4 test");

    const supabase = makeSupabaseMock();
    const app = express();
    app.use("/api/uci", createUciRouter({ supabase }));

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    if (pdfPath && fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it("view route returns inline PDF headers for a saved PDF", async () => {
    const res = await fetch(
      `${baseUrl}/api/uci/coordination/${COORD_ID}/discovery/pepco/application-details/${APP_UUID}/documents/0/view`,
      { headers: { Authorization: "Bearer test-token" } },
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/pdf");
    assert.equal(res.headers.get("content-disposition"), 'inline; filename="plan.pdf"');
    const body = await res.text();
    assert.ok(body.startsWith("%PDF"));
    assert.ok(!body.includes(pdfPath));
  });

  it("download route still returns attachment disposition unchanged", async () => {
    const res = await fetch(
      `${baseUrl}/api/uci/coordination/${COORD_ID}/discovery/pepco/application-details/${APP_UUID}/documents/0/download`,
      { headers: { Authorization: "Bearer test-token" } },
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/pdf");
    assert.equal(res.headers.get("content-disposition"), 'attachment; filename="plan.pdf"');
  });

  it("view route returns 415 for a downloaded non-PDF document", async () => {
    const txtPath = resolvePepcoStoredDocumentPath({
      coordinationId: COORD_ID,
      applicationUuid: APP_UUID,
      fileName: "notes.txt",
    });
    assert.ok(txtPath);
    fs.mkdirSync(path.dirname(txtPath), { recursive: true });
    fs.writeFileSync(txtPath, "plain text");
    try {
      const res = await fetch(
        `${baseUrl}/api/uci/coordination/${COORD_ID}/discovery/pepco/application-details/${APP_UUID}/documents/1/view`,
        { headers: { Authorization: "Bearer test-token" } },
      );
      assert.equal(res.status, 415);
      const json = await res.json();
      assert.equal(json.error, "UNSUPPORTED_MEDIA_TYPE");
      assert.ok(!JSON.stringify(json).includes(txtPath));
    } finally {
      if (fs.existsSync(txtPath)) fs.unlinkSync(txtPath);
    }
  });

  it("view route returns 404 when the file is missing on disk", async () => {
    if (pdfPath && fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
    try {
      const res = await fetch(
        `${baseUrl}/api/uci/coordination/${COORD_ID}/discovery/pepco/application-details/${APP_UUID}/documents/0/view`,
        { headers: { Authorization: "Bearer test-token" } },
      );
      assert.equal(res.status, 404);
      const json = await res.json();
      assert.equal(json.error, "DOCUMENT_FILE_MISSING");
      assert.ok(!JSON.stringify(json).includes("debug"));
    } finally {
      if (pdfPath) {
        fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
        fs.writeFileSync(pdfPath, "%PDF-1.4 test");
      }
    }
  });

  it("view route rejects unauthorized project access via router", async () => {
    const deniedSupabase = makeSupabaseMock({ hasAccess: false });
    const app = express();
    app.use("/api/uci", createUciRouter({ supabase: deniedSupabase }));

    const deniedServer = http.createServer(app);
    await new Promise((resolve) => deniedServer.listen(0, resolve));
    const addr = deniedServer.address();
    assert.ok(addr && typeof addr === "object");
    const deniedUrl = `http://127.0.0.1:${addr.port}`;

    try {
      const res = await fetch(
        `${deniedUrl}/api/uci/coordination/${COORD_ID}/discovery/pepco/application-details/${APP_UUID}/documents/0/view`,
        { headers: { Authorization: "Bearer denied-token" } },
      );
      assert.equal(res.status, 403);
      const json = await res.json();
      assert.equal(json.error, "PROJECT_ACCESS_DENIED");
      assert.ok(!JSON.stringify(json).includes(pdfPath || ""));
    } finally {
      await new Promise((resolve, reject) => {
        deniedServer.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it("view route rejects unauthenticated requests", async () => {
    const res = await fetch(
      `${baseUrl}/api/uci/coordination/${COORD_ID}/discovery/pepco/application-details/${APP_UUID}/documents/0/view`,
    );
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.equal(json.error, "UNAUTHENTICATED");
  });
});
