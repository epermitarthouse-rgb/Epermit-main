import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CODE_ANALYZER_V2_REQUIRED_MESSAGE,
  assertNewAnalysisUsesV2,
  isCodeAnalyzerAsyncV2Enabled,
} from "./featureFlags.ts";

describe("featureFlags", () => {
  it("defaults Code Analyzer Async V2 to disabled when the build flag is unset", () => {
    assert.equal(isCodeAnalyzerAsyncV2Enabled(), false);
  });

  it("refuses a new analysis attempt instead of selecting the legacy path", () => {
    assert.throws(
      () => assertNewAnalysisUsesV2(),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, CODE_ANALYZER_V2_REQUIRED_MESSAGE);
        assert.equal(err.message.includes("legacy browser path"), true);
        assert.equal("v1" in err, false);
        return true;
      },
    );
  });

  it("does not start a legacy browser analysis from the production entry points", () => {
    const ui = readFileSync(
      new URL("../../components/compliance/AIComplianceAnalyzer.tsx", import.meta.url),
      "utf8",
    );
    const codeMod = readFileSync(
      new URL("../codeModification/runReviewAsyncV2.ts", import.meta.url),
      "utf8",
    );
    assert.equal(/\bcreateAnalyzerRun\(/.test(ui), false);
    assert.equal(/\bprocessComplianceBatch\(/.test(ui), false);
    assert.equal(/\bpersistPendingAnalyzerSources\(/.test(ui), false);
    assert.equal(/\brunDcCodeModificationReview\(/.test(codeMod), false);
    assert.match(ui, /CODE_ANALYZER_V2_REQUIRED_MESSAGE/);
    assert.match(codeMod, /CODE_ANALYZER_V2_REQUIRED_MESSAGE/);
  });
});
