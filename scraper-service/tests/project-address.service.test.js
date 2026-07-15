"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveAndNormalizeProjectAddress,
  buildCanonicalAddressUpdatesForScrape,
  applyScrapeCanonicalAddressToPortalData,
  extractUtilityApplicationAddressFromCoordinationRecord,
  readCanonicalAddressRecord,
  isProtectedCanonicalSource,
} = require("../app/services/project-address.service.js");

describe("project-address.service", () => {
  it("populates canonical formatted address for a new jurisdiction scrape", () => {
    const { portalData, projectPatch } = applyScrapeCanonicalAddressToPortalData(
      null,
      { location: "200 Sheridan Rd NW, Washington DC", portalType: "accela-arlington" },
      { sourcePortal: "accela-arlington", scrapedAt: "2026-07-15T10:00:00.000Z" },
    );

    const canonical = readCanonicalAddressRecord({ portal_data: portalData });
    assert.equal(canonical?.source, "jurisdiction_scrape");
    assert.equal(canonical?.formatted, "200 Sheridan Rd NW, Washington DC");
    assert.equal(projectPatch?.address, "200 Sheridan Rd NW, Washington DC");
  });

  it("refreshes scrape-sourced canonical address on re-scrape", () => {
    const existing = {
      address: "Old Site Location",
      jurisdiction: "Washington DC",
      portal_data: {
        location: "Old Site Location",
        _permitpilot: {
          canonical_address: {
            source: "jurisdiction_scrape",
            formatted: "Old Site Location",
            address: "Old Site Location",
          },
        },
      },
    };
    const { projectPatch } = applyScrapeCanonicalAddressToPortalData(
      existing,
      { location: "New Site Location", portalType: "pgc-eplan" },
      { sourcePortal: "pgc-eplan", scrapedAt: "2026-07-15T11:00:00.000Z" },
    );
    assert.equal(projectPatch?.address, "New Site Location");
  });

  it("does not overwrite manual canonical address on re-scrape", () => {
    const existing = {
      address: "100 Manual St",
      portal_data: {
        location: "Scraped Different Location",
        _permitpilot: {
          canonical_address: {
            source: "manual",
            formatted: "100 Manual St",
            address: "100 Manual St",
            confirmed: false,
          },
        },
      },
    };
    const updates = buildCanonicalAddressUpdatesForScrape(
      existing,
      "Scraped Different Location",
      { sourcePortal: "accela", scrapedAt: "2026-07-15T12:00:00.000Z" },
    );
    assert.equal(updates.projectPatch, null);
    assert.equal(updates.canonicalAddress?.mismatch_with_scrape, true);
    assert.equal(updates.canonicalAddress?.formatted, "100 Manual St");
  });

  it("accepts raw location without city/state/zip parts", () => {
    const resolved = resolveAndNormalizeProjectAddress({
      project: {
        portal_data: { location: "Site 14, Industrial Park" },
      },
    });
    assert.equal(resolved.address_source, "jurisdiction_scrape");
    assert.equal(resolved.address.formatted, "Site 14, Industrial Park");
    assert.equal(resolved.address.complete, false);
  });

  it("uses canonical project address before utility portal fallback", () => {
    const resolved = resolveAndNormalizeProjectAddress({
      project: {
        portal_data: {
          location: "200 Sheridan Rd NW, Washington DC",
          _permitpilot: {
            canonical_address: {
              source: "jurisdiction_scrape",
              formatted: "200 Sheridan Rd NW, Washington DC",
              address: "200 Sheridan Rd NW, Washington DC",
            },
          },
        },
      },
      coordinationRecord: {
        metadata: {
          pepco_application_detail_discovery: {
            applications: [
              {
                applicationUuid: "app-1",
                overview: { propertyAddress: "999 Utility Only Rd" },
              },
            ],
          },
        },
      },
      externalApplicationId: "app-1",
    });
    assert.equal(resolved.address_source, "jurisdiction_scrape");
    assert.equal(resolved.address.formatted, "200 Sheridan Rd NW, Washington DC");
  });

  it("uses selected PEPCO propertyAddress only when canonical/jurisdiction sources are absent", () => {
    const resolved = resolveAndNormalizeProjectAddress({
      project: {
        address: null,
        portal_data: { tabs: { info: {} } },
      },
      coordinationRecord: {
        metadata: {
          pepco_application_detail_discovery: {
            applications: [
              {
                applicationUuid: "app-1",
                overview: { propertyAddress: "10432 Campus Way S, Upper Marlboro, MD" },
              },
              {
                applicationUuid: "app-2",
                overview: { propertyAddress: "999 Wrong App Rd" },
              },
            ],
          },
        },
      },
      externalApplicationId: "app-1",
    });
    assert.equal(resolved.address_source, "utility_portal");
    assert.equal(resolved.address.formatted, "10432 Campus Way S, Upper Marlboro, MD");
    assert.equal(resolved.address.fallback_used, true);
  });

  it("never uses another PEPCO application address when scope is explicit", () => {
    const address = extractUtilityApplicationAddressFromCoordinationRecord(
      {
        metadata: {
          pepco_application_detail_discovery: {
            applications: [
              { applicationUuid: "app-1", overview: { propertyAddress: "Correct Address" } },
              { applicationUuid: "app-2", overview: { propertyAddress: "Wrong Address" } },
            ],
          },
        },
      },
      "app-1",
    );
    assert.equal(address, "Correct Address");
    const missing = extractUtilityApplicationAddressFromCoordinationRecord(
      {
        metadata: {
          pepco_application_detail_discovery: {
            applications: [
              { applicationUuid: "app-2", overview: { propertyAddress: "Wrong Address" } },
            ],
          },
        },
      },
      "app-1",
    );
    assert.equal(missing, null);
  });

  it("marks protected canonical sources", () => {
    assert.equal(isProtectedCanonicalSource("manual"), true);
    assert.equal(isProtectedCanonicalSource("confirmed"), true);
    assert.equal(isProtectedCanonicalSource("jurisdiction_scrape"), false);
  });
});
