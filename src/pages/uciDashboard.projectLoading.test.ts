import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { logUciProjectDataEvent } from "../lib/uciProjectScopedRequest.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardSource = readFileSync(join(__dirname, "UciDashboard.tsx"), "utf8");

function indexOfOrFail(source: string, needle: string): number {
  const index = source.indexOf(needle);
  assert.ok(index >= 0, `missing marker: ${needle}`);
  return index;
}

describe("UciDashboard project loading generation regression", () => {
  it("hydrates local UCI state when the shared selected project initializes or changes", () => {
    assert.match(
      dashboardSource,
      /setProjectIdState\(\(current\) =>[\s\S]*?globalSelectedProject\.selectedProjectId[\s\S]*?\[globalSelectedProject\?\.selectedProjectId\]/,
    );
  });

  it("increments project generation before project-scoped loader effects run", () => {
    const generationEffect = indexOfOrFail(
      dashboardSource,
      "logUciProjectDataEvent(\"generation_created\"",
    );
    const setupLoadEffect = indexOfOrFail(
      dashboardSource,
      "void loadProviderSetup();",
    );
    const resolutionLoadEffect = indexOfOrFail(
      dashboardSource,
      "void loadProviderResolution();",
    );
    const coordinationLoadEffect = indexOfOrFail(
      dashboardSource,
      "void refreshCoordination();",
    );

    assert.ok(
      generationEffect < setupLoadEffect,
      "provider setup load effect must run after generation increment",
    );
    assert.ok(
      generationEffect < resolutionLoadEffect,
      "provider resolution load effect must run after generation increment",
    );
    assert.ok(
      generationEffect < coordinationLoadEffect,
      "coordination refresh effect must run after generation increment",
    );
  });

  it("uses shared generation with current project id guards for parallel same-project requests", () => {
    assert.match(dashboardSource, /currentProjectIdRef/);
    assert.match(dashboardSource, /shouldApplyProjectScopedResponse/);
    assert.match(dashboardSource, /shouldApplyProjectResponse\(generation, requestedProjectId\)/);
    assert.match(dashboardSource, /requestType: "provider_setup"/);
    assert.match(dashboardSource, /requestType: "provider_resolution"/);
  });

  it("clears loading in finally only for the current generation and project", () => {
    const setupBlock = dashboardSource.slice(
      indexOfOrFail(dashboardSource, "const loadProviderSetup = useCallback"),
      indexOfOrFail(dashboardSource, "const loadProviderResolution = useCallback"),
    );
    assert.match(setupBlock, /finally \{/);
    assert.match(setupBlock, /setProviderSetupLoading\(false\)/);
    assert.match(setupBlock, /shouldApplyProjectResponse\(generation, requestedProjectId\)/);
    assert.match(setupBlock, /logUciProjectDataEvent\("loading_cleared"/);
  });

  it("does not increment generation after loader callbacks on the same project change", () => {
    const generationIncrements = dashboardSource.match(
      /projectDataGenerationRef\.current \+= 1/g,
    );
    assert.equal(
      generationIncrements?.length,
      1,
      "generation must increment once per project change effect only",
    );
  });

  it("imports project data helpers so /uci renders when project data loads", () => {
    assert.match(
      dashboardSource,
      /import\s*\{[\s\S]*?logUciProjectDataEvent[\s\S]*?shouldApplyProjectScopedResponse[\s\S]*?\}\s*from\s*"@\/lib\/uciProjectScopedRequest"/,
      "missing import for project-scoped logging/guards — causes ReferenceError on /uci",
    );
  });

  it("never throws when project data debug logging fails", () => {
    const originalDebug = console.debug;
    console.debug = () => {
      throw new Error("debug sink unavailable");
    };
    try {
      assert.doesNotThrow(() =>
        logUciProjectDataEvent("project_selected", {
          projectId: "project-a",
          generation: 1,
        }),
      );
    } finally {
      console.debug = originalDebug;
    }
  });
});
