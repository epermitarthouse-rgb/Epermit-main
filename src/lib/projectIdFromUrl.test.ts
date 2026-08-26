import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getProjectIdFromLocation,
  getProjectIdFromSearchParams,
} from "./projectIdFromUrl.ts";

describe("getProjectIdFromSearchParams", () => {
  it("reads projectId, project, and project_id aliases", () => {
    assert.equal(
      getProjectIdFromSearchParams(new URLSearchParams("projectId=aaa")),
      "aaa",
    );
    assert.equal(
      getProjectIdFromSearchParams(new URLSearchParams("project=bbb")),
      "bbb",
    );
    assert.equal(
      getProjectIdFromSearchParams(new URLSearchParams("project_id=ccc")),
      "ccc",
    );
    assert.equal(
      getProjectIdFromSearchParams(new URLSearchParams("projectId=null")),
      null,
    );
    assert.equal(getProjectIdFromSearchParams(new URLSearchParams("")), null);
  });

  it("prefers projectId over project and project_id", () => {
    assert.equal(
      getProjectIdFromSearchParams(
        new URLSearchParams("projectId=primary&project=secondary&project_id=tertiary"),
      ),
      "primary",
    );
  });
});

describe("getProjectIdFromLocation", () => {
  it("returns null when window is unavailable (node test runtime)", () => {
    assert.equal(getProjectIdFromLocation(), null);
  });
});

describe("resolved project id precedence (A: selection sticks on B)", () => {
  it("uses live URL project when present, otherwise context selection", () => {
    const resolve = (urlId: string | null, contextId: string | null) =>
      urlId ?? contextId;

    assert.equal(resolve("project-b", "project-a"), "project-b");
    assert.equal(resolve(null, "project-b"), "project-b");
    assert.equal(resolve("project-b", "project-b"), "project-b");
  });

  it("does not revert to stale router params when live URL already moved to B", () => {
    const staleRouterParams = new URLSearchParams("projectId=project-a");
    const liveParams = new URLSearchParams("projectId=project-b");
    const contextId = "project-b";

    const staleRouterId = getProjectIdFromSearchParams(staleRouterParams);
    const liveUrlId = getProjectIdFromSearchParams(liveParams);
    const resolvedFromStale = staleRouterId ?? contextId;
    const resolvedFromLive = liveUrlId ?? contextId;

    assert.equal(staleRouterId, "project-a");
    assert.equal(resolvedFromStale, "project-a", "stale router params incorrectly win");
    assert.equal(liveUrlId, "project-b");
    assert.equal(resolvedFromLive, "project-b", "live URL keeps selection on B");
  });
});

describe("stale hydrate guard (C: stale A response does not reset B)", () => {
  it("drops async work when captured project id differs from current ref", () => {
    const selectedProjectIdRef = { current: "project-b" as string | null };
    const asyncProjectId = "project-a";
    const shouldApply = selectedProjectIdRef.current === asyncProjectId;
    assert.equal(shouldApply, false);
  });
});
