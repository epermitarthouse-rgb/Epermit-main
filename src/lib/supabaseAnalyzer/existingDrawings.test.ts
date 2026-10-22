import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  analysisModeControlOptions,
  analysisModeShortLabel,
  displayAnalysisMode,
  normalizeNewRunAnalysisMode,
} from "./analysisMode.ts";
import { existingDrawingsLabel, savedSheetCount } from "./pendingSelection.ts";

describe("Supabase analyzer existing drawings label", () => {
  it("uses the saved job count rather than a fixed number", () => {
    const jobs = Array.from({ length: 82 }, (_, index) => ({ status: "completed" }));
    jobs.push({ status: "cancelled" });
    assert.equal(savedSheetCount(jobs), 82);
    assert.equal(existingDrawingsLabel(savedSheetCount(jobs)), "82 drawings already uploaded");
    assert.equal(existingDrawingsLabel(1), "1 drawing already uploaded");
  });
});

describe("Supabase analyzer mode control", () => {
  it("maps the V2 control onto stored modes and leaves a null historical mode as legacy", () => {
    assert.deepEqual(
      analysisModeControlOptions.map((option) => option.value),
      ["both", "ibc_only", "local_only"],
    );
    assert.deepEqual(
      analysisModeControlOptions.map((option) => option.label),
      ["Both (Recommended)", "IBC Only", "Local Only"],
    );
    assert.equal(normalizeNewRunAnalysisMode(undefined), "both");
    assert.equal(normalizeNewRunAnalysisMode(""), "both");
    for (const option of analysisModeControlOptions) {
      assert.equal(normalizeNewRunAnalysisMode(option.value), option.value);
      assert.notEqual(displayAnalysisMode(option.value), "Legacy review");
    }
    assert.equal(displayAnalysisMode(null), "Legacy review");
    assert.equal(displayAnalysisMode(undefined), "Legacy review");
    assert.equal(analysisModeShortLabel(null), "Legacy");
    assert.equal(analysisModeShortLabel(undefined), "Legacy");
  });
});
