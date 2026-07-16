import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  getProviderConfirmationSectionCopy,
  isSuccessfulTerritorySuggestion,
} from "./uciProviderResolution.ts";
import type { UciProviderResolutionResult } from "@/types/uci";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardSource = readFileSync(join(__dirname, "..", "pages", "UciDashboard.tsx"), "utf8");
const contextBarSource = readFileSync(
  join(__dirname, "..", "components", "uci", "UciProjectContextBar.tsx"),
  "utf8",
);
const panelSource = readFileSync(
  join(__dirname, "..", "components", "uci", "UciProviderResolutionPanel.tsx"),
  "utf8",
);

function baseResolution(
  overrides: Partial<UciProviderResolutionResult> = {},
): UciProviderResolutionResult {
  return {
    service_type: "electric",
    status: "resolved",
    resolution_tier: 1,
    resolution_method: "point_in_polygon",
    confidence: "high",
    address: {
      formatted: "6060 Springhill Dr, Greenbelt, MD 20770",
      source: "project",
      latitude: 38.99,
      longitude: -76.88,
      geocode_provider: "census",
      geocoded_at: "2026-07-17T00:00:00.000Z",
    },
    source: {
      name: "EIA Energy Atlas",
      dataset_vintage: "2025-08-21",
      layer_id: "0",
      source_url: "https://example.com",
      generated_at: "2026-07-17T00:00:00.000Z",
    },
    candidates: [],
    suggested_provider_id: "pepco-id",
    boundary_risk: false,
    boundary_distance_miles: null,
    requires_human_confirmation: true,
    confirmed_provider_id: null,
    confirmed_by: null,
    confirmed_at: null,
    override_reason: null,
    notes: null,
    ...overrides,
  };
}

describe("UCI setup UI copy helpers", () => {
  it("uses confirm-or-override copy for successful territory suggestions", () => {
    const resolution = baseResolution();
    assert.equal(isSuccessfulTerritorySuggestion(resolution), true);
    const copy = getProviderConfirmationSectionCopy(resolution);
    assert.equal(copy.title, "Confirm or override provider");
    assert.equal(copy.primaryCta, "Confirm suggested provider");
    assert.match(copy.description, /Review the suggested provider/);
  });

  it("keeps manual fallback copy when territory data is unavailable", () => {
    const resolution = baseResolution({
      status: "territory_data_unavailable",
      suggested_provider_id: null,
      resolution_method: null,
      confidence: "none",
    });
    assert.equal(isSuccessfulTerritorySuggestion(resolution), false);
    const copy = getProviderConfirmationSectionCopy(resolution);
    assert.equal(copy.title, "Manual selection fallback");
    assert.match(copy.description, /No automatic provider is applied/);
  });
});

describe("UCI project context and switching", () => {
  it("shows persistent UCI project context with change-project action", () => {
    assert.match(contextBarSource, /data-testid="uci-project-context-bar"/);
    assert.match(contextBarSource, /Change project/);
    assert.match(contextBarSource, /data-testid="uci-change-project-button"/);
    assert.match(contextBarSource, /UCI Project/);
    assert.match(dashboardSource, /UciProjectContextBar/);
  });

  it("uses UCI-local projectId state instead of global selected project context", () => {
    assert.match(dashboardSource, /const \[projectId, setProjectId\]/);
    assert.doesNotMatch(dashboardSource, /useSelectedProject/);
  });

  it("invalidates in-flight project requests when projectId changes", () => {
    assert.match(dashboardSource, /projectDataGenerationRef/);
    assert.match(dashboardSource, /generation !== projectDataGenerationRef\.current/);
  });

  it("confirms project switch only when unsaved setup changes exist", () => {
    assert.match(dashboardSource, /hasUnsavedUciSetupChanges/);
    assert.match(dashboardSource, /projectSwitchConfirmOpen/);
    assert.match(dashboardSource, /performProjectChangeReset/);
  });

  it("preselects suggested provider in the resolution panel", () => {
    assert.match(panelSource, /setSelectedProviderId\(activeResolution\.suggested_provider_id\)/);
    assert.match(panelSource, /isSuccessfulTerritorySuggestion/);
  });
});
