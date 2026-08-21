import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardSource = readFileSync(join(__dirname, "UciDashboard.tsx"), "utf8");
const actionPresentationSource = readFileSync(
  join(__dirname, "..", "lib", "uciActionPresentation.ts"),
  "utf8",
);

describe("UciDashboard Stage 2 → Stage 3 handoff regression", () => {
  it("derives Stage 2/3 handoff from shared presentation helpers", () => {
    assert.match(dashboardSource, /deriveStage2HandoffAction/);
    assert.match(dashboardSource, /deriveStage3ReviewAction/);
    assert.match(dashboardSource, /derivePackageReviewAction/);
    assert.match(actionPresentationSource, /export function deriveStage2HandoffAction/);
    assert.match(actionPresentationSource, /export function deriveStage3ReviewAction/);
    assert.match(actionPresentationSource, /Complete Stage 2 review/);
    assert.doesNotMatch(
      dashboardSource,
      /\{currentStage === 2 \? \([\s\S]*Complete Stage 2 review/,
    );
  });

  it("refreshes lifecycle state after package review and detail refresh", () => {
    assert.match(dashboardSource, /applyCoordinationDetail/);
    assert.match(dashboardSource, /getCoordinationDetail\(detailId/);
    assert.match(dashboardSource, /applyCoordinationDetail\(refreshed\)/);
  });

  it("wires Stage 3 reviewed package to Stage 4 submission handoff", () => {
    assert.match(dashboardSource, /completeStage3PackageReviewHandoff/);
    assert.match(dashboardSource, /stage_4_entered/);
    assert.match(dashboardSource, /Enter Stage 4 submission/);
    assert.match(dashboardSource, /Open Submission Tracker/);
  });
});
