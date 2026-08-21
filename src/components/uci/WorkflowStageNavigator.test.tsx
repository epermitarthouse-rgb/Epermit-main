import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const navigatorSource = readFileSync(join(__dirname, "WorkflowStageNavigator.tsx"), "utf8");

describe("WorkflowStageNavigator downstream navigation", () => {
  it("shows stage ranges, blockers, and Stage 7–10 workspace links while upstream stages are active", () => {
    assert.match(navigatorSource, /formatWorkflowStageRange\(group\.stageRange\)/);
    assert.match(navigatorSource, /getWorkflowGroupPrerequisite\(/);
    assert.match(navigatorSource, /getStageWorkspaceLinksForRange\(group\.stageRange\)/);
    assert.match(navigatorSource, /Open \{link\.label\}/);
    assert.match(navigatorSource, /progress === "upcoming"/);
    assert.match(navigatorSource, /Locked/);
    assert.match(navigatorSource, /Awaiting utility/);
  });

  it("passes current_stage_state into grouped progress and suppresses Active styling when completed", () => {
    assert.match(navigatorSource, /getWorkflowGroupProgress\(\s*group\.stageRange,\s*currentStage,\s*currentStageState,/);
    assert.match(navigatorSource, /progress === "current" \? \(/);
    assert.doesNotMatch(navigatorSource, /progress === "current" \|\| groupHasActiveTab \? \(/);
    assert.match(navigatorSource, /if \(progress === "completed"\)/);
  });
});
