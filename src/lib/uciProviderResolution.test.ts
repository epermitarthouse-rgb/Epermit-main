import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const helperSource = readFileSync(join(__dirname, "uciProviderResolution.ts"), "utf8");
const panelSource = readFileSync(
  join(__dirname, "..", "components", "uci", "UciProviderResolutionPanel.tsx"),
  "utf8",
);
const dashboardSource = readFileSync(
  join(__dirname, "..", "pages", "UciDashboard.tsx"),
  "utf8",
);

describe("uciProviderResolution helpers", () => {
  it("defines user-facing messages for unavailable, ambiguous, and boundary states", () => {
    assert.match(helperSource, /Automatic territory matching is not available yet/);
    assert.match(helperSource, /Multiple possible providers were found/);
    assert.match(helperSource, /near a utility territory boundary/);
    assert.match(helperSource, /Human confirmation is required/);
  });

  it("requires override reason when selected provider differs from suggestion", () => {
    assert.match(helperSource, /needsOverrideReason/);
    assert.match(helperSource, /suggested_provider_id !== selectedProviderId/);
    assert.match(helperSource, /isSuccessfulTerritorySuggestion/);
    assert.match(helperSource, /getProviderConfirmationSectionCopy/);
  });

  it("keeps electric and gas providers separate via utility_type filter", () => {
    assert.match(helperSource, /filterProvidersForServiceType/);
    assert.match(helperSource, /provider\.utility_type\.trim\(\)\.toLowerCase\(\)/);
  });
});

describe("UciProviderResolutionPanel UI states", () => {
  it("renders confirm-or-override and manual fallback states", () => {
    assert.match(panelSource, /data-testid="uci-resolution-status-card"/);
    assert.match(panelSource, /getProviderConfirmationSectionCopy/);
    assert.match(panelSource, /confirmationCopy\.title/);
    assert.match(panelSource, /uci-resolution-confirm-override/);
    assert.match(panelSource, /uci-resolution-manual-fallback/);
    assert.match(panelSource, /confirmationCopy\.primaryCta/);
    assert.match(panelSource, /data-testid="uci-resolution-override-reason"/);
    assert.match(panelSource, /data-testid="uci-resolution-confirm-button"/);
  });

  it("wires dashboard API calls for resolve, confirm, override, and reassignment", () => {
    assert.match(dashboardSource, /getProjectProviderResolution/);
    assert.match(dashboardSource, /resolveProjectProviderResolution/);
    assert.match(dashboardSource, /confirmProjectProviderResolution/);
    assert.match(dashboardSource, /overrideProjectProviderResolution/);
    assert.match(dashboardSource, /reassignCoordinationProvider/);
    assert.match(dashboardSource, /patchCoordinationRecordInList/);
    assert.match(dashboardSource, /providerResolution=/);
  });

  it("renders provider reassignment controls in the resolution panel", () => {
    assert.match(panelSource, /data-testid="uci-resolution-change-provider-button"/);
    assert.match(panelSource, /data-testid="uci-resolution-reassign-confirm-dialog"/);
    assert.match(panelSource, /Reassign provider/);
  });
});
