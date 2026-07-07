"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  parsePepcoApplicationsListResponse,
} = require("../scrapers/pepco/application-detail-discovery.js");
const {
  mergeApplicationDetailsByUuid,
} = require("../app/services/uci/uci-pepco-application-detail-discovery.service.js");

describe("PEPCO applications list API parsing", () => {
  it("reads projects from value.data, not value directly", () => {
    const parsed = parsePepcoApplicationsListResponse({
      isSuccess: true,
      value: {
        data: [
          {
            applicationId: "a1",
            jobId: "PEPCO-NB-0067752",
            projectName: "Project C",
            projectAddress: "456 Oak Ave",
            status: "In Design",
            actionRequired: false,
            lastUpdatedDateTime: "2026-04-01T09:00:00+00:00",
            submittedDateTime: "2026-02-01T09:00:00+00:00",
            draft: false,
          },
        ],
        customerFirstName: "Test",
      },
    });

    assert.equal(parsed.ok, true);
    assert.equal(parsed.cards.length, 1);
    assert.equal(parsed.cards[0].applicationId, "a1");
    assert.equal(parsed.cards[0].jobId, "PEPCO-NB-0067752");
    assert.equal(parsed.cards[0].status, "In Design");
    assert.equal(parsed.cards[0].source, "api");
  });

  it("rejects isSuccess false and missing value.data", () => {
    assert.equal(parsePepcoApplicationsListResponse({ isSuccess: false }).ok, false);
    assert.equal(
      parsePepcoApplicationsListResponse({ isSuccess: true, value: {} }).reason,
      "missing_value_data_array",
    );
  });
});

describe("PEPCO application detail merge by UUID", () => {
  it("merges incoming detail without removing prior projects", () => {
    const existing = [
      { applicationUuid: "wonder-uuid", scrapeStatus: "completed", overview: { jobId: "PEPCO-NB-0064620" } },
    ];
    const incoming = [
      { applicationUuid: "review-uuid", scrapeStatus: "completed", overview: { jobId: "PEPCO-NB-0000347" } },
    ];

    const merged = mergeApplicationDetailsByUuid(existing, incoming);
    assert.equal(merged.length, 2);
    assert.ok(merged.some((a) => a.applicationUuid === "wonder-uuid"));
    assert.ok(merged.some((a) => a.applicationUuid === "review-uuid"));
  });

  it("replaces only the matching UUID when re-scraped", () => {
    const existing = [
      { applicationUuid: "same-uuid", scrapeStatus: "partial", overview: { jobId: "OLD" } },
      { applicationUuid: "other-uuid", scrapeStatus: "completed", overview: { jobId: "KEEP" } },
    ];
    const incoming = [
      { applicationUuid: "same-uuid", scrapeStatus: "completed", overview: { jobId: "NEW" } },
    ];

    const merged = mergeApplicationDetailsByUuid(existing, incoming);
    assert.equal(merged.length, 2);
    const updated = merged.find((a) => a.applicationUuid === "same-uuid");
    assert.equal(updated?.overview?.jobId, "NEW");
    const kept = merged.find((a) => a.applicationUuid === "other-uuid");
    assert.equal(kept?.overview?.jobId, "KEEP");
  });
});

describe("PEPCO dashboard discovery module load", () => {
  it("loads dashboard discovery service without error", () => {
    const mod = require("../app/services/uci/uci-pepco-dashboard-discovery.service.js");
    assert.equal(typeof mod.runPepcoDashboardDiscovery, "function");
  });

  it("loads UCI routes factory without error", () => {
    const { createUciRouter } = require("../app/routes/uci.routes.js");
    assert.equal(typeof createUciRouter, "function");
  });
});
