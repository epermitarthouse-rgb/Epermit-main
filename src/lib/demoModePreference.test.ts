import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isDemoNavHref } from "./demoModePreference.ts";

describe("isDemoNavHref", () => {
  it("matches executive Demo landing aliases", () => {
    assert.equal(isDemoNavHref("/demo"), true);
    assert.equal(isDemoNavHref("/demo/"), true);
    assert.equal(isDemoNavHref("/demo/mcdonalds"), true);
    assert.equal(isDemoNavHref("/demo/mcdonalds?x=1"), true);
  });

  it("does not match other demo-ish routes", () => {
    assert.equal(isDemoNavHref("/demos"), false);
    assert.equal(isDemoNavHref("/dashboard"), false);
    assert.equal(isDemoNavHref("/code-analyzer"), false);
  });
});
