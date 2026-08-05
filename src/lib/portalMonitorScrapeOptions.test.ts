import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolvePortalMonitorScrapeMenu } from "./portalMonitorScrapeOptions.ts";

describe("resolvePortalMonitorScrapeMenu", () => {
  it("returns generic when no credential is linked", () => {
    assert.equal(resolvePortalMonitorScrapeMenu({ credential: null }), "generic");
  });

  it("resolves Prince George's County ePlan modes from login URL", () => {
    assert.equal(
      resolvePortalMonitorScrapeMenu({
        credential: {
          login_url: "https://eplans.princegeorgescountymd.gov/ProjectDox",
          jurisdiction: "Prince George's County",
        },
      }),
      "pgc",
    );
  });

  it("resolves Montgomery ProjectDox modes from Avolve host", () => {
    assert.equal(
      resolvePortalMonitorScrapeMenu({
        credential: {
          login_url: "https://montgomeryco-md-us.avolvecloud.com/ProjectDox",
        },
      }),
      "montgomery",
    );
  });

  it("resolves Howard ProjectDox modes from Avolve host", () => {
    assert.equal(
      resolvePortalMonitorScrapeMenu({
        credential: {
          login_url: "https://howardco-md-us.avolvecloud.com/ProjectDox",
        },
      }),
      "howard",
    );
  });

  it("resolves Arlington Accela modes from /ARLINGTONCO login URL", () => {
    assert.equal(
      resolvePortalMonitorScrapeMenu({
        credential: {
          login_url: "https://aca-prod.accela.com/ARLINGTONCO",
          jurisdiction: "Arlington County",
        },
      }),
      "arlington",
    );
  });

  it("resolves Arlington from portal_data when credential signals are weak", () => {
    assert.equal(
      resolvePortalMonitorScrapeMenu({
        credential: {
          login_url: "https://aca-prod.accela.com/OTHER",
          jurisdiction: "Unknown",
        },
        portalData: {
          tabs: {
            info: { jurisdiction: "arlington_county_va" },
          },
        },
      }),
      "arlington",
    );
  });

  it("resolves Baltimore Accela modes from /BALTIMORE login URL", () => {
    assert.equal(
      resolvePortalMonitorScrapeMenu({
        credential: {
          login_url: "https://aca-prod.accela.com/BALTIMORE",
        },
      }),
      "baltimore",
    );
  });

  it("resolves Fairfax Accela modes from CitizenAccess host", () => {
    assert.equal(
      resolvePortalMonitorScrapeMenu({
        credential: {
          login_url: "https://plus.fairfaxcounty.gov/CitizenAccess/",
        },
      }),
      "fairfax",
    );
  });

  it("resolves Washington-style ProjectDox (non PGC/Montgomery/Howard)", () => {
    assert.equal(
      resolvePortalMonitorScrapeMenu({
        credential: {
          login_url: "https://washington-dc-us.avolvecloud.com/ProjectDox",
          jurisdiction: "Washington DC",
        },
      }),
      "washington_projectdox",
    );
  });

  it("falls back to generic for unrecognized Accela tenants", () => {
    assert.equal(
      resolvePortalMonitorScrapeMenu({
        credential: {
          login_url: "https://aca-prod.accela.com/SOMETOWN",
          jurisdiction: "Some Town",
        },
      }),
      "generic",
    );
  });
});
