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
  });
});
