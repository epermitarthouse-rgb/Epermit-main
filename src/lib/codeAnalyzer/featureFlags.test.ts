import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isCodeAnalyzerAsyncV2Enabled } from "./featureFlags.ts";

describe("featureFlags", () => {
  it("defaults Code Analyzer Async V2 to disabled", () => {
    assert.equal(isCodeAnalyzerAsyncV2Enabled(), false);
  });
});
