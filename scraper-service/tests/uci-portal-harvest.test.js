"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  extractLegacyHarvestRows,
  identityFor,
  isMissingHarvestTableError,
  suggestProjectMatches,
  tokenSimilarity,
} = require("../app/services/uci/uci-portal-harvest.service.js");

describe("UCI provider harvest matching", () => {
  const application = {
    external_application_id: "pepco-app-1",
    external_job_id: "PEPCO-42",
    metadata: {
      portal_snapshot: {
        overview: {
          projectName: "Wonder Tenant Fit Out",
          projectAddress: "10432 Campus Way S, Largo, MD 20774",
          jobId: "PEPCO-42",
        },
      },
    },
  };

  it("suggests strong address/name matches but does not create links", () => {
    const suggestions = suggestProjectMatches(application, [
      {
        id: "project-wonder",
        name: "Wonder - Tenant Fit Out",
        address: "10432 Campus Way S",
        city: "Largo",
        state: "MD",
        zip_code: "20774",
        permit_number: null,
      },
      {
        id: "project-other",
        name: "Aspen Hill",
        address: "1 Other Street",
        city: "Rockville",
        state: "MD",
        zip_code: "20850",
        permit_number: null,
      },
    ]);

    assert.equal(suggestions[0].project_id, "project-wonder");
    assert.ok(suggestions[0].score >= 100);
    assert.equal(suggestions.some((item) => item.project_id === "project-other"), false);
    assert.equal("linked_project" in suggestions[0], false);
  });

  it("uses identifiers as high-confidence evidence", () => {
    const suggestions = suggestProjectMatches(application, [
      {
        id: "project-id-match",
        name: "Different internal name",
        address: null,
        city: null,
        state: null,
        zip_code: null,
        permit_number: "PEPCO-42",
      },
    ]);
    assert.equal(suggestions[0].confidence, "high");
    assert.match(suggestions[0].reasons.join(" "), /job ID/i);
  });

  it("normalizes punctuation for similarity", () => {
    assert.ok(tokenSimilarity("10432 Campus Way S.", "10432 CAMPUS-WAY South") >= 0.5);
  });

  it("surfaces every legacy PEPCO discovery when inventory is empty", () => {
    const rows = extractLegacyHarvestRows([
      {
        id: "coord-1",
        project_id: "project-1",
        updated_at: "2026-08-10T00:00:00.000Z",
        utility_providers: { slug: "pepco" },
        metadata: {
          pepco_application_detail_discovery: {
            lastScrapedAt: "2026-08-09T00:00:00.000Z",
            applications: [
              {
                applicationUuid: "CTBO24-02589-RA1",
                overview: { projectName: "Aspen Hill", jobId: "CTBO24-02589-RA1" },
                currentStatus: "In Design",
                documents: [{ name: "plan.pdf" }],
              },
              {
                applicationUuid: "PEPCO-NB-0000347",
                overview: {
                  projectName: "Rockville",
                  propertyAddress: "11710 Rockville Pike, Rockville, MD 20852",
                },
                currentMilestone: "Construction",
              },
            ],
          },
          pepco_dashboard_discovery: {
            last_discovered_at: "2026-08-08T00:00:00.000Z",
            cards: [
              {
                applicationId: "wonder-app",
                projectName: "Wonder",
                status: "Submitted",
              },
            ],
          },
        },
      },
    ]);

    assert.deepEqual(
      rows.map((row) => row.external_application_id).sort(),
      ["CTBO24-02589-RA1", "PEPCO-NB-0000347", "wonder-app"],
    );
    assert.equal(rows.every((row) => row.metadata.portal_snapshot), true);
    assert.equal(rows.every((row) => row.source_legacy), true);
    assert.equal(
      identityFor(
        rows.find((row) => row.external_application_id === "PEPCO-NB-0000347"),
      ).address,
      "11710 Rockville Pike, Rockville, MD 20852",
    );
  });

  it("allows legacy fallback when harvest migrations are not applied", () => {
    assert.equal(
      isMissingHarvestTableError({
        code: "PGRST205",
        message: "Could not find public.uci_portal_harvest_items in the schema cache",
      }),
      true,
    );
    assert.equal(isMissingHarvestTableError({ code: "42501", message: "permission denied" }), false);
  });
});
