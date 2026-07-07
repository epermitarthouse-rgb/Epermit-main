"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const {
  sanitizePepcoMetadataForApi,
} = require("../app/services/uci/uci-pepco-document-download.service.js");
const {
  resolvePepcoStoredDocumentPath,
  getPepcoDocStorageRoot,
} = require("../scrapers/pepco/application-detail-discovery.js");

describe("PEPCO document download safety", () => {
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
});
