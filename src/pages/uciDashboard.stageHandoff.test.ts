import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardSource = readFileSync(join(__dirname, "UciDashboard.tsx"), "utf8");
const handoffSource = readFileSync(join(__dirname, "..", "lib", "uciStageHandoff.ts"), "utf8");

describe("UciDashboard Stage 2 → Stage 3 handoff regression", () => {
  it("uses lifecycle-aware Stage 2 completion visibility", () => {
    assert.match(dashboardSource, /canShowCompleteStage2ReviewButton\(currentStage, currentStageState\)/);
    assert.match(dashboardSource, /canShowEnterStage3HandoffButton\(currentStage, currentStageState\)/);
    assert.match(dashboardSource, /canShowStage3StatusPanel\(currentStage\)/);
    assert.doesNotMatch(
      dashboardSource,
      /\{currentStage === 2 \? \([\s\S]*Complete Stage 2 review/,
    );
  });

  it("refreshes lifecycle state after package review and detail refresh", () => {
    assert.match(dashboardSource, /applyCoordinationDetail/);
    assert.match(
      dashboardSource,
      /getCoordinationDetail\(detailId!\)\.then\(applyCoordinationDetail\)/,
    );
    assert.match(
      dashboardSource,
      /onRefreshDetail=\{async \(\) => \{[\s\S]*applyCoordinationDetail\(d\)/,
    );
  });

  it("labels Stage 3 handoff from package readiness", () => {
    assert.match(handoffSource, /getStage3HandoffButtonLabel/);
    assert.match(dashboardSource, /getStage3HandoffButtonLabel\(\{/);
  });

  it("wires Stage 3 reviewed package to Stage 4 submission handoff", () => {
    assert.match(handoffSource, /canShowEnterStage4HandoffButton/);
    assert.match(handoffSource, /canShowStage4StatusPanel/);
    assert.match(dashboardSource, /completeStage3PackageReviewHandoff/);
    assert.match(dashboardSource, /stage_4_entered/);
    assert.match(dashboardSource, /Enter Stage 4 submission/);
  });
});
