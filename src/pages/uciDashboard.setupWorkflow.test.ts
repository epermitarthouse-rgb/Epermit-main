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

describe("UciDashboard guided setup workflow regression", () => {
  it("uses the guided setup workflow component instead of a full-page provider catalog", () => {
    assert.match(dashboardSource, /<UciSetupWorkflow\b/);
    assert.doesNotMatch(dashboardSource, /Seeded catalog — automation status is informational only\./);
    assert.doesNotMatch(dashboardSource, /Select all/);
  });

  it("hides portfolio and records until a project is selected", () => {
    assert.match(dashboardSource, /\{projectId \? \(\s*\n\s*<\>/);
    assert.match(workflowSource, /data-testid="uci-no-project-empty"/);
  });

  it("keeps provider directory in a collapsed reference section", () => {
    assert.match(workflowSource, /Provider directory/);
    assert.match(workflowSource, /data-testid="uci-provider-directory-toggle"/);
  });

  it("surfaces disabled initialize reasons and compact provider selection", () => {
    assert.match(workflowSource, /data-testid="uci-init-disabled-reasons"/);
    assert.match(workflowSource, /data-testid="uci-selected-providers"/);
    assert.match(workflowSource, /data-testid="uci-provider-search"/);
    assert.match(workflowSource, /Automatic territory matching is not available yet/);
    assert.match(workflowSource, /Confirm these selections using project/);
  });

  it("includes the D2.2 provider resolution panel with auditable mapping states", () => {
    assert.match(workflowSource, /UciProviderResolutionPanel/);
    assert.match(dashboardSource, /getProjectProviderResolution/);
    assert.match(dashboardSource, /resolveProjectProviderResolution/);
    assert.match(dashboardSource, /confirmProjectProviderResolution/);
    assert.match(dashboardSource, /overrideProjectProviderResolution/);
  });
});
