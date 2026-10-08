import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  asyncRunTerminalKey,
  isTerminalStandardRunStatus,
  shouldHydrateStandardAsyncResults,
} from "./asyncRunCompletion.ts";

describe("asyncRunCompletion", () => {
  it("treats current and partial as hydratable terminal states", () => {
    assert.equal(shouldHydrateStandardAsyncResults("current"), true);
    assert.equal(shouldHydrateStandardAsyncResults("partial"), true);
    assert.equal(shouldHydrateStandardAsyncResults("failed"), false);
    assert.equal(shouldHydrateStandardAsyncResults("cancelled"), false);
    assert.equal(shouldHydrateStandardAsyncResults("running"), false);
  });

  it("isTerminalStandardRunStatus includes failed and cancelled", () => {
    assert.equal(isTerminalStandardRunStatus("current"), true);
    assert.equal(isTerminalStandardRunStatus("partial"), true);
    assert.equal(isTerminalStandardRunStatus("failed"), true);
    assert.equal(isTerminalStandardRunStatus("cancelled"), true);
    assert.equal(isTerminalStandardRunStatus("queued"), false);
  });

  it("asyncRunTerminalKey dedupes repeated polling ticks", () => {
    const a = asyncRunTerminalKey("run-1", "current");
    const b = asyncRunTerminalKey("run-1", "current");
    const c = asyncRunTerminalKey("run-1", "partial");
    assert.equal(a, b);
    assert.notEqual(a, c);
  });
});
