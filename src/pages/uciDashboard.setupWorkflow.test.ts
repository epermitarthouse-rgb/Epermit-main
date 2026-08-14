import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardSource = readFileSync(join(__dirname, "UciDashboard.tsx"), "utf8");
const workflowSource = readFileSync(
  join(__dirname, "..", "components", "uci", "UciSetupWorkflow.tsx"),
  "utf8",
);
const uciApiSource = readFileSync(join(__dirname, "..", "lib", "uciApi.ts"), "utf8");

describe("UciDashboard guided setup workflow regression", () => {
  it("uses the guided setup workflow component instead of a full-page provider catalog", () => {
    assert.match(dashboardSource, /<UciSetupWorkflow\b/);
    assert.doesNotMatch(dashboardSource, /Seeded catalog — automation status is informational only\./);
    assert.doesNotMatch(dashboardSource, /Select all/);
  });

  it("renders the coordination hub as primary content even before a project is selected", () => {
    // The Lovable-style hub (KPI row, hub tiles, stage rail, records table,
    // attention queue) must render unconditionally — never gated behind
    // `{projectId ? (...) : null}` — so it is never hidden behind the setup
    // form. Only a lightweight prompt banner should differ by project state.
    assert.doesNotMatch(dashboardSource, /\{projectId \? \(\s*\n\s*<\>/);
    assert.match(dashboardSource, /No project selected yet/);
    assert.match(dashboardSource, /data-testid="uci-records-no-project"/);
    assert.match(workflowSource, /data-testid="uci-no-project-empty"/);
  });

  it("keeps the old setup form secondary — reachable from a hub tile, rendered after the hub", () => {
    const hubIndex = dashboardSource.indexOf("Coordination modules");
    const setupWorkflowSectionIndex = dashboardSource.indexOf('id="uci-setup-workflow"');
    assert.ok(hubIndex >= 0, "hub panel title not found");
    assert.ok(setupWorkflowSectionIndex >= 0, "secondary setup workflow section id not found");
    assert.ok(
      hubIndex < setupWorkflowSectionIndex,
      "hub must render before the secondary setup workflow section",
    );
    assert.match(dashboardSource, /data-testid="uci-hub-tile-setup"/);
  });

  it("keeps provider directory in a collapsed reference section", () => {
    assert.match(workflowSource, /Provider directory/);
    assert.match(workflowSource, /data-testid="uci-provider-directory-toggle"/);
  });

  it("surfaces disabled initialize reasons and compact provider selection", () => {
    assert.match(workflowSource, /data-testid="uci-init-disabled-reasons"/);
    assert.match(workflowSource, /data-testid="uci-selected-providers"/);
    assert.match(workflowSource, /data-testid="uci-provider-search"/);
    assert.match(workflowSource, /Electric territory suggestions use available service-territory data/);
    assert.match(workflowSource, /Other supported utility\s+types remain manual/i);
    assert.match(workflowSource, /uci-create-provider-submit/);
  });

  it("includes the D2.2 provider resolution panel with auditable mapping states", () => {
    assert.match(workflowSource, /UciProviderResolutionPanel/);
    assert.match(dashboardSource, /getProjectProviderResolution/);
    assert.match(dashboardSource, /resolveProjectProviderResolution/);
    assert.match(dashboardSource, /confirmProjectProviderResolution/);
    assert.match(dashboardSource, /overrideProjectProviderResolution/);
  });

  it("carries a confirmed provider into initialization without a second confirmation", () => {
    assert.match(dashboardSource, /confirmedProviderIds/);
    assert.match(dashboardSource, /setInitPick/);
    assert.match(workflowSource, /uci-provider-confirmation-carried-forward/);
    assert.match(workflowSource, /Provider confirmation carried forward/);
  });

  it("uses the mounted project provider route and selects a created provider immediately", () => {
    assert.match(
      uciApiSource,
      /\/api\/uci\/projects\/\$\{encodeURIComponent\(projectId\)\}\/providers/,
    );
    assert.match(dashboardSource, /await createUciProvider\(projectId/);
    assert.match(
      dashboardSource,
      /setInitPick\(\(previous\) => \(\{ \.\.\.previous, \[result\.provider\.slug\]: true \}\)\)/,
    );
    assert.match(dashboardSource, /await loadProviders\(\)/);
    assert.match(dashboardSource, /await loadProviderSetup\(\)/);
  });

  it("shows persistent UCI project context above setup and workflow sections", () => {
    assert.match(dashboardSource, /UciProjectContextBar/);
    assert.match(dashboardSource, /handleChangeProjectRequest/);
  });
});
