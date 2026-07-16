import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldApplyProjectScopedResponse } from "./uciProjectScopedRequest.js";

describe("uciProjectScopedRequest", () => {
  it("allows parallel same-project requests to share one generation", () => {
    const generation = 3;
    const projectId = "project-a";
    assert.equal(
      shouldApplyProjectScopedResponse(generation, projectId, generation, projectId),
      true,
    );
    assert.equal(
      shouldApplyProjectScopedResponse(generation, projectId, generation, projectId),
      true,
    );
  });

  it("rejects responses after a newer project generation is created", () => {
    const requestGeneration = 2;
    const requestedProjectId = "project-a";
    assert.equal(
      shouldApplyProjectScopedResponse(requestGeneration, requestedProjectId, 3, "project-a"),
      false,
    );
  });

  it("rejects responses when the selected project changed", () => {
    const requestGeneration = 4;
    assert.equal(
      shouldApplyProjectScopedResponse(requestGeneration, "project-a", requestGeneration, "project-b"),
      false,
    );
  });

  it("rejects aborted prior-project responses from clearing the new project", () => {
    const abortedGeneration = 1;
    const currentGeneration = 2;
    assert.equal(
      shouldApplyProjectScopedResponse(abortedGeneration, "project-a", currentGeneration, "project-b"),
      false,
    );
  });

  it("accepts current generation for the currently selected project", () => {
    assert.equal(shouldApplyProjectScopedResponse(5, "project-b", 5, "project-b"), true);
  });
});
