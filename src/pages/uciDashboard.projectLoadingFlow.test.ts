import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldApplyProjectScopedResponse } from "../lib/uciProjectScopedRequest.js";

type RequestType = "provider_setup" | "provider_resolution";

type SimulatedRequest = {
  generation: number;
  requestedProjectId: string;
  requestType: RequestType;
};

function simulateLoadHandler(
  currentGeneration: number,
  currentProjectId: string | null,
  request: SimulatedRequest,
  outcome: "success" | "error" | "empty",
): { applied: boolean; loadingCleared: boolean; stateUpdated: boolean } {
  const { generation, requestedProjectId, requestType } = request;
  let loadingCleared = false;
  let stateUpdated = false;

  const canApply = () =>
    shouldApplyProjectScopedResponse(
      generation,
      requestedProjectId,
      currentGeneration,
      currentProjectId,
    );

  try {
    if (!canApply()) {
      return { applied: false, loadingCleared: false, stateUpdated: false };
    }

    if (outcome === "error") {
      throw new Error(`${requestType} failed`);
    }

    if (outcome === "success" || outcome === "empty") {
      stateUpdated = true;
    }
  } catch {
    if (canApply()) {
      stateUpdated = false;
    }
  } finally {
    if (canApply()) {
      loadingCleared = true;
    }
  }

  return { applied: stateUpdated, loadingCleared, stateUpdated };
}

describe("UCI project loading flow simulation", () => {
  it("starts address and provider-status requests under the same generation", () => {
    const generation = 2;
    const projectId = "project-a";
    const address = simulateLoadHandler(generation, projectId, {
      generation,
      requestedProjectId: projectId,
      requestType: "provider_setup",
    }, "success");
    const resolution = simulateLoadHandler(generation, projectId, {
      generation,
      requestedProjectId: projectId,
      requestType: "provider_resolution",
    }, "success");

    assert.equal(address.loadingCleared, true);
    assert.equal(resolution.loadingCleared, true);
    assert.equal(address.stateUpdated, true);
    assert.equal(resolution.stateUpdated, true);
  });

  it("does not let parallel same-project requests invalidate each other", () => {
    const generation = 5;
    const projectId = "project-a";
    const first = simulateLoadHandler(generation, projectId, {
      generation,
      requestedProjectId: projectId,
      requestType: "provider_setup",
    }, "success");
    const second = simulateLoadHandler(generation, projectId, {
      generation,
      requestedProjectId: projectId,
      requestType: "provider_resolution",
    }, "success");

    assert.equal(first.loadingCleared, true);
    assert.equal(second.loadingCleared, true);
  });

  it("invalidates only prior-project responses after switching A to B", () => {
    const stale = simulateLoadHandler(3, "project-b", {
      generation: 2,
      requestedProjectId: "project-a",
      requestType: "provider_setup",
    }, "success");
    const current = simulateLoadHandler(3, "project-b", {
      generation: 3,
      requestedProjectId: "project-b",
      requestType: "provider_setup",
    }, "success");

    assert.equal(stale.applied, false);
    assert.equal(stale.loadingCleared, false);
    assert.equal(current.applied, true);
    assert.equal(current.loadingCleared, true);
  });

  it("prevents aborted prior-project responses from clearing new project loading", () => {
    const aborted = simulateLoadHandler(4, "project-b", {
      generation: 3,
      requestedProjectId: "project-a",
      requestType: "provider_resolution",
    }, "success");
    assert.equal(aborted.loadingCleared, false);
  });

  it("clears loading on API error for the current generation", () => {
    const result = simulateLoadHandler(6, "project-a", {
      generation: 6,
      requestedProjectId: "project-a",
      requestType: "provider_setup",
    }, "error");
    assert.equal(result.stateUpdated, false);
    assert.equal(result.loadingCleared, true);
  });

  it("clears loading on empty response for the current generation", () => {
    const result = simulateLoadHandler(7, "project-a", {
      generation: 7,
      requestedProjectId: "project-a",
      requestType: "provider_setup",
    }, "empty");
    assert.equal(result.loadingCleared, true);
  });

  it("keeps provider-resolution success independent from address-context success", () => {
    const generation = 8;
    const projectId = "project-a";
    const address = simulateLoadHandler(generation, projectId, {
      generation,
      requestedProjectId: projectId,
      requestType: "provider_setup",
    }, "success");
    const resolution = simulateLoadHandler(generation, projectId, {
      generation,
      requestedProjectId: projectId,
      requestType: "provider_resolution",
    }, "success");

    assert.equal(address.stateUpdated, true);
    assert.equal(resolution.stateUpdated, true);
  });

  it("does not leave loading stuck after repeated project switching", () => {
    let currentGeneration = 0;
    let currentProjectId: string | null = null;

    const selectProject = (projectId: string) => {
      currentGeneration += 1;
      currentProjectId = projectId;
      return currentGeneration;
    };

    const genA = selectProject("project-a");
    const genB = selectProject("project-b");
    const genC = selectProject("project-c");

    const staleA = simulateLoadHandler(genC, "project-c", {
      generation: genA,
      requestedProjectId: "project-a",
      requestType: "provider_setup",
    }, "success");
    const staleB = simulateLoadHandler(genC, "project-c", {
      generation: genB,
      requestedProjectId: "project-b",
      requestType: "provider_resolution",
    }, "success");
    const currentCSetup = simulateLoadHandler(genC, "project-c", {
      generation: genC,
      requestedProjectId: "project-c",
      requestType: "provider_setup",
    }, "success");
    const currentCResolution = simulateLoadHandler(genC, "project-c", {
      generation: genC,
      requestedProjectId: "project-c",
      requestType: "provider_resolution",
    }, "success");

    assert.equal(staleA.loadingCleared, false);
    assert.equal(staleB.loadingCleared, false);
    assert.equal(currentCSetup.loadingCleared, true);
    assert.equal(currentCResolution.loadingCleared, true);
  });
});
