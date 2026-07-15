import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardSource = readFileSync(join(__dirname, "UciDashboard.tsx"), "utf8");

describe("ApplicationPrepSection document mapping selection", () => {
  it("does not pre-select the first candidate when slot state is empty", () => {
    assert.doesNotMatch(
      dashboardSource,
      /selectedCandidateBySlot\[slotKey\]\s*\?\?\s*suggested\[0\]\?\.candidate_id/,
      "select value must not fall back to the first suggested candidate",
    );
    assert.doesNotMatch(
      dashboardSource,
      /selectedCandidateBySlot\[slotKey\]\s*\?\?\s*candidates\[0\]\?\.candidate_id/,
      "select value must not fall back to the first listed candidate",
    );
  });

  it("binds select and confirm to explicit per-slot candidate_id state", () => {
    assert.match(dashboardSource, /const slotSelection = selectedCandidateBySlot\[slotKey\] \?\? ""/);
    assert.match(dashboardSource, /value=\{slotSelection \|\| undefined\}/);
    assert.match(dashboardSource, /candidate_id: candidateId/);
    assert.match(dashboardSource, /value=\{candidate\.candidate_id\}/);
    assert.match(dashboardSource, /disabled=\{mappingBusySlot === slotKey \|\| !slotSelection\}/);
    assert.match(dashboardSource, /placeholder="Select a document"/);
  });

  it("clears slot selection after confirm and prunes stale candidate ids on refresh", () => {
    assert.match(dashboardSource, /delete next\[slotKey\]/);
    assert.match(dashboardSource, /validCandidateIds\.has\(candidateId\)/);
  });
});
