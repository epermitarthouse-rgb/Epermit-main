import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isTerminalCodeModRunStatus } from "./runReviewAsyncV2.ts";

describe("runReviewAsyncV2", () => {
  it("treats current, partial, failed, and cancelled as terminal run statuses", () => {
    assert.equal(isTerminalCodeModRunStatus("current"), true);
    assert.equal(isTerminalCodeModRunStatus("partial"), true);
    assert.equal(isTerminalCodeModRunStatus("failed"), true);
    assert.equal(isTerminalCodeModRunStatus("cancelled"), true);
    assert.equal(isTerminalCodeModRunStatus("running"), false);
    assert.equal(isTerminalCodeModRunStatus("queued"), false);
  });
});
