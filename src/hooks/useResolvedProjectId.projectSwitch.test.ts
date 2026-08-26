import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const hookSource = readFileSync(join(__dirname, "useResolvedProjectId.ts"), "utf8");
const contextSource = readFileSync(
  join(__dirname, "../contexts/SelectedProjectContext.tsx"),
  "utf8",
);
const analyzerSource = readFileSync(
  join(__dirname, "../components/compliance/AIComplianceAnalyzer.tsx"),
  "utf8",
);

describe("useResolvedProjectId project switching", () => {
  it("reads live URL via getProjectIdFromLocation (not stale searchParams only)", () => {
    assert.match(hookSource, /getProjectIdFromLocation\(\)/);
    assert.doesNotMatch(
      hookSource,
      /const projectIdFromUrl = getProjectIdFromSearchParams\(searchParams\)/,
    );
  });

  it("still subscribes to router searchParams for navigations", () => {
    assert.match(hookSource, /useSearchParams\(\)/);
    assert.match(hookSource, /void searchParams/);
  });

  it("exposes context selection separately from resolved projectId", () => {
    assert.match(hookSource, /selectedProjectId,/);
    assert.match(hookSource, /projectId,/);
    assert.match(analyzerSource, /useResolvedProjectId\(\)/);
    assert.match(analyzerSource, /setSelectedProjectId\(/);
  });
});

describe("SelectedProjectContext URL sync (F: global + analyzer consistent)", () => {
  it("updates ?projectId= through React Router setSearchParams", () => {
    assert.match(contextSource, /useSearchParams\(\)/);
    assert.match(contextSource, /setSearchParams\(/);
    assert.doesNotMatch(contextSource, /window\.history\.replaceState/);
  });

  it("syncs deep-link ?projectId= changes after init", () => {
    assert.match(contextSource, /getProjectIdFromSearchParams\(searchParams\)/);
    assert.match(contextSource, /initializedRef\.current/);
  });

  it("ActiveProjectControl and analyzer share setSelectedProjectId from context", () => {
    const controlSource = readFileSync(
      join(__dirname, "../components/layout/ActiveProjectControl.tsx"),
      "utf8",
    );
    assert.match(controlSource, /selectedProject\.setSelectedProjectId\(/);
    assert.match(analyzerSource, /setSelectedProjectId\(v === "__none__" \? null : v\)/);
  });
});

describe("AIComplianceAnalyzer project change behavior", () => {
  it("resets analyzer dataset state when active project changes (B data load)", () => {
    assert.match(analyzerSource, /previousProjectIdRef/);
    assert.match(analyzerSource, /reloadAnalyzerDataset\(selectedProjectId\)/);
    assert.match(analyzerSource, /setLoadedExistingResults\(\[\]\)/);
    assert.match(analyzerSource, /setPersistedSheets\(\[\]\)/);
  });

  it("guards async hydrates with selectedProjectIdRef (stale A cannot win)", () => {
    assert.match(analyzerSource, /selectedProjectIdRef\.current !== projectId/);
    assert.match(analyzerSource, /docsFetchGuardRef/);
    assert.match(analyzerSource, /hydrateGuardRef/);
  });

  it("restores per-project analysis instructions on project or mode change (D)", () => {
    assert.match(analyzerSource, /setAnalysisInstructions\(activeRun\?\.analysis_instructions/);
    assert.match(analyzerSource, /selectedProjectId,/);
    assert.match(analyzerSource, /isModificationMode/);
  });

  it("mode switch reads modification vs standard run for the active project (E)", () => {
    assert.match(analyzerSource, /const activeRun = isModificationMode \? modificationDisplayRun : displayRun/);
    assert.match(analyzerSource, /setModificationDisplayRun/);
    assert.match(analyzerSource, /setDisplayRun/);
  });
});
