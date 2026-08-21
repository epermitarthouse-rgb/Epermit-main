import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzerWorkflowFor } from "./workflow.ts";

describe("analyzerWorkflowFor mode separation", () => {
  it("keeps standard compliance on /api/analyze-drawing for any jurisdiction", () => {
    assert.deepEqual(analyzerWorkflowFor("standard", "dc"), {
      ok: true,
      endpoint: "/api/analyze-drawing",
    });
    assert.deepEqual(analyzerWorkflowFor("standard", "new-york"), {
      ok: true,
      endpoint: "/api/analyze-drawing",
    });
  });

  it("routes DC modification review to its own endpoint", () => {
    assert.deepEqual(analyzerWorkflowFor("dc_code_modification", "dc"), {
      ok: true,
      endpoint: "/api/analyze-code-modification",
    });
  });

  it("rejects modification review off DC", () => {
    assert.deepEqual(analyzerWorkflowFor("dc_code_modification", "new-york"), {
      ok: false,
      reason: "dc_only",
    });
    assert.deepEqual(analyzerWorkflowFor("dc_code_modification", "california"), {
      ok: false,
      reason: "dc_only",
    });
  });
});
