"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildAppDetailRunOptions,
  resolveAppDetailResumeOptions,
} = require("../app/services/uci/uci-pepco-application-detail-discovery.service.js");
const { registerAwaitingMfaSession } = require("../app/services/uci/uci-pepco-session-store.js");

describe("PEPCO app-detail MFA session resume options", () => {
  it("builds initial run options from request body", () => {
    const opts = buildAppDetailRunOptions(["uuid-1"], true);
    assert.deepEqual(opts.applicationUuids, ["uuid-1"]);
    assert.equal(opts.downloadDocuments, true);
  });

  it("keeps downloadDocuments false when initial request is false", () => {
    const opts = buildAppDetailRunOptions(["uuid-1"], false);
    assert.equal(opts.downloadDocuments, false);
  });

  it("uses stored session downloadDocuments=true when resume omits the flag", () => {
    /** @type {string[]} */
    const progress = [];
    const resolved = resolveAppDetailResumeOptions(
      {
        applicationUuids: ["stored-uuid"],
        downloadDocuments: true,
      },
      undefined,
      undefined,
      (line) => progress.push(line),
    );

    assert.deepEqual(resolved.applicationUuids, ["stored-uuid"]);
    assert.equal(resolved.downloadDocuments, true);
    assert.ok(progress.some((line) => line.includes("downloadDocuments=true")));
  });

  it("uses stored session downloadDocuments=false when resume omits the flag", () => {
    const resolved = resolveAppDetailResumeOptions(
      {
        applicationUuids: ["stored-uuid"],
        downloadDocuments: false,
      },
      undefined,
      undefined,
      () => {},
    );

    assert.equal(resolved.downloadDocuments, false);
  });

  it("prefers explicit resume body downloadDocuments over stored session", () => {
    const resolved = resolveAppDetailResumeOptions(
      {
        applicationUuids: ["stored-uuid"],
        downloadDocuments: true,
      },
      ["body-uuid"],
      false,
      () => {},
    );

    assert.deepEqual(resolved.applicationUuids, ["body-uuid"]);
    assert.equal(resolved.downloadDocuments, false);
  });

  it("registers awaiting MFA session with app-detail resume options", () => {
    const session = registerAwaitingMfaSession({
      coordinationId: "coord-1",
      userId: "user-1",
      browser: /** @type {import("playwright").Browser} */ (/** @type {unknown} */ ({})),
      context: /** @type {import("playwright").BrowserContext} */ (/** @type {unknown} */ ({})),
      page: /** @type {import("playwright").Page} */ (/** @type {unknown} */ ({})),
      continueAction: "discover_application_details",
      applicationUuids: ["uuid-aspen"],
      downloadDocuments: true,
    });

    assert.equal(session.applicationUuids?.[0], "uuid-aspen");
    assert.equal(session.downloadDocuments, true);
  });
});
