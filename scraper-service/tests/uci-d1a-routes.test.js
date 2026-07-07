"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createUciRouter } = require("../app/routes/uci.routes.js");
const {
  sanitizePortalSnapshotForApi,
} = require("../app/services/uci/uci-sync-utils.js");

describe("UCI D1A routes module", () => {
  it("loads router factory", () => {
    assert.equal(typeof createUciRouter, "function");
  });

  it("strips local paths from portal snapshots", () => {
    const sanitized = /** @type {{ downloadedFiles?: Array<Record<string, unknown>> }} */ (
      sanitizePortalSnapshotForApi({
        downloadedFiles: [{ localPath: "/secret/path.pdf", documentName: "x.pdf" }],
      })
    );
    assert.equal(sanitized.downloadedFiles?.[0]?.localPath, undefined);
    assert.equal(sanitized.downloadedFiles?.[0]?.documentName, "x.pdf");
  });
});
