import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isDemoRoute } from "./demo-routes.ts";

describe("isDemoRoute", () => {
  it("badges the McDonald's executive demo and /demo prefix", () => {
    assert.equal(isDemoRoute("/demo/mcdonalds"), true);
    assert.equal(isDemoRoute("/demo"), true);
    assert.equal(isDemoRoute("/demo/"), true);
  });

  it("does not badge Interactive Demos or real LOA/contact surfaces", () => {
    assert.equal(isDemoRoute("/demos"), false);
    assert.equal(isDemoRoute("/contact"), false);
    assert.equal(isDemoRoute("/onboarding/authorization"), false);
    assert.equal(isDemoRoute("/auth"), false);
  });

  it("badges fabricated portfolio/matrix stubs used by executive CTAs", () => {
    assert.equal(isDemoRoute("/portfolio/executive"), true);
    assert.equal(isDemoRoute("/matrix/ai-workflow"), true);
    assert.equal(isDemoRoute("/utility/conflict-hunter"), true);
  });

  it("keeps Operations Board on fabricated/demo provenance while mock sections exist", () => {
    assert.equal(isDemoRoute("/operations"), true);
  });
});
