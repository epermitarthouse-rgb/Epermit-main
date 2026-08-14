import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(__dirname, "../App.tsx"), "utf8");
const dashboardSource = readFileSync(join(__dirname, "UciDashboard.tsx"), "utf8");
const routePagesSource = readFileSync(join(__dirname, "UciRoutePages.tsx"), "utf8");
const navSource = readFileSync(join(__dirname, "../lib/uciNavSections.ts"), "utf8");
const harvestSource = readFileSync(join(__dirname, "UciPortalHarvest.tsx"), "utf8");
const sidebarSource = readFileSync(join(__dirname, "../components/layout/UciSidebarNav.tsx"), "utf8");

describe("UCI hybrid architecture routes", () => {
  it("registers a deep-linkable full record workspace while retaining preview", () => {
    assert.match(appSource, /path="\/uci\/records\/:coordinationId"/);
    assert.match(dashboardSource, /Coordination record workspace/);
    assert.match(dashboardSource, /Coordination preview/);
    assert.match(dashboardSource, /Open full workspace/);
    assert.match(dashboardSource, /Preview only/);
    assert.match(dashboardSource, /UCI_RECORD_WORKSPACE_GROUPS/);
    assert.match(dashboardSource, /RecordManualMilestoneFoundations/);
  });

  it("registers explicit operational destinations without a catch-all foundation route", () => {
    for (const route of [
      "portfolio",
      "needs-attention",
      "inbox",
      "submissions",
      "provider-directory",
      "class-of-service",
      "ciac-refunds",
      "energization",
      "miss-utility",
      "knowledge",
      "conflicts",
      "utility-territory-map",
    ]) {
      assert.match(appSource, new RegExp(`path="/uci/${route}"`));
    }
    assert.doesNotMatch(appSource, /path="\/uci\/:foundation"/);
    assert.doesNotMatch(appSource, /UciFoundationPage/);
    assert.match(routePagesSource, /export function UciSubmissionsPage/);
    assert.match(routePagesSource, /export function UciInboxPage/);
    assert.match(routePagesSource, /export function UciNeedsAttentionPage/);
    assert.match(routePagesSource, /export function UciPortfolioPage/);
    assert.match(routePagesSource, /export function UciProviderDirectoryPage/);
    assert.match(routePagesSource, /listProjectNeedsAttentionCommunications/);
    assert.match(routePagesSource, /tab="application-prep"/);
    assert.match(routePagesSource, /tab="communications"/);
    assert.match(routePagesSource, /tab="energization-closeout"/);
    assert.doesNotMatch(routePagesSource, /Human-gated UCI capability|Open project command center|No mock metrics/);
    assert.match(sidebarSource, /Project Workspace/);
    assert.match(sidebarSource, /to="\/uci"/);
    assert.match(routePagesSource, /\.from\("coordination_records"\)/);
    assert.match(routePagesSource, /settleWithConcurrency/);
    assert.match(routePagesSource, /No utility communications yet/);
  });

  it("does not confuse municipal jurisdiction mapping with utility territory", () => {
    assert.match(navSource, /label: "Utility Territory Map"/);
    assert.match(navSource, /It is not the municipal Jurisdiction Map/);
    assert.doesNotMatch(navSource, /href: "\/jurisdictions\/map"/);
  });

  it("registers the provider-account harvest and explicit linking flow", () => {
    assert.match(appSource, /path="\/uci\/portal-harvest"/);
    assert.match(navSource, /href: "\/uci\/portal-harvest"/);
    assert.match(harvestSource, /Harvest → link → coordination/);
    assert.match(harvestSource, /Confirm link/);
    assert.match(harvestSource, /does not re-scrape on load/i);
  });
});
