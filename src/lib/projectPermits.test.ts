import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  __projectPermitsTestHooks,
  discussionOf,
  linkPermitsToProject,
  listProjectPermits,
  loadPipelineOverview,
  loadPortalCommentMarkers,
  prefillFromPermit,
  requestCommentProcessing,
  summarizeProjectState,
  type ProjectPermitsClient,
} from "./projectPermits";

type Call = { kind: string; name: string; args?: unknown };

function fakeClient(opts: {
  rows?: Record<string, Record<string, unknown>[]>;
  rpc?: (name: string, args: unknown) => { data: unknown; error: { message?: string; code?: string } | null };
  invoke?: (name: string, body: unknown) => Promise<{ data: unknown; error: { message?: string; context?: unknown } | null }>;
  selectError?: { message?: string; code?: string };
}) {
  const calls: Call[] = [];
  const c: ProjectPermitsClient = {
    from(table) {
      return {
        select(columns) {
          calls.push({ kind: "select", name: table, args: columns });
          const result = { data: opts.selectError ? null : opts.rows?.[table] ?? [], error: opts.selectError ?? null };
          const builder = {
            eq: () => builder,
            in: () => builder,
            not: () => builder,
            order: () => builder,
            limit: () => builder,
            then: (resolve: (v: unknown) => void) => resolve(result),
          };
          return builder as never;
        },
      };
    },
    rpc(name, args) {
      calls.push({ kind: "rpc", name, args });
      return Promise.resolve(opts.rpc ? opts.rpc(name, args) : { data: null, error: null });
    },
    ...(opts.invoke
      ? {
          functions: {
            invoke: (name: string, o: { body: Record<string, unknown> }) => {
              calls.push({ kind: "invoke", name, args: o.body });
              return opts.invoke!(name, o.body);
            },
          },
        }
      : {}),
  };
  __projectPermitsTestHooks.setClient(c);
  return calls;
}

afterEach(() => __projectPermitsTestHooks.setClient(null));

describe("project permits", () => {
  it("lists linked permits and drops links whose permit the caller cannot read", async () => {
    fakeClient({
      rows: {
        project_permits: [
          { permit_id: "p1", created_at: "2026-11-01", permits: { id: "p1", permit_number: "BCIV2500152", jurisdiction: "Washington DC", address: "1 Main", title: null, status_raw: "In Review", last_synced_at: null } },
          { permit_id: "p2", created_at: "2026-11-02", permits: null },
        ],
      },
    });
    const rows = await listProjectPermits("proj");
    assert.deepEqual(rows.map((r) => r.permit_number), ["BCIV2500152"]);
  });

  it("links unique permit ids through the editor RPC and shows server reasons plainly", async () => {
    const calls = fakeClient({ rpc: () => ({ data: 2, error: null }) });
    assert.equal(await linkPermitsToProject("proj", ["a", "a", "b"]), 2);
    assert.deepEqual(calls[0], { kind: "rpc", name: "link_project_permits", args: { p_project_id: "proj", p_permit_ids: ["a", "b"] } });

    fakeClient({ rpc: () => ({ data: null, error: { message: "permit not available to this account", code: "42501" } }) });
    await assert.rejects(linkPermitsToProject("proj", ["x"]), /Permit not available to this account/);
    fakeClient({ rpc: () => ({ data: null, error: { message: "relation \"x\" violates something internal", code: "XX000" } }) });
    await assert.rejects(linkPermitsToProject("proj", ["x"]), /^Error: Linking permits failed\. Please try again\.$/);
  });

  it("prefills only blank fields from the chosen permit", () => {
    const permit = { permit_number: "B1", address: "1 Main St", jurisdiction: "Washington DC", title: "New building" };
    assert.deepEqual(prefillFromPermit({ name: "", permit_number: "", address: "", jurisdiction: "" }, permit), {
      permit_number: "B1",
      address: "1 Main St",
      jurisdiction: "Washington DC",
      name: "New building",
    });
    assert.deepEqual(prefillFromPermit({ name: "Mine", permit_number: "X", address: "Here", jurisdiction: "There" }, permit), {});
  });
});

describe("comment processing", () => {
  it("overview is empty without ids and when the migration is not applied", async () => {
    const calls = fakeClient({ rpc: () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function in the schema cache" } }) });
    assert.deepEqual(await loadPipelineOverview({}), []);
    assert.equal(calls.length, 0);
    assert.deepEqual(await loadPipelineOverview({ permitIds: ["p1"] }), []);
  });

  it("starts processing through the edge function, and falls back to a queued request when it is unavailable", async () => {
    const calls = fakeClient({ invoke: async () => ({ data: { claimed: 1 }, error: null }) });
    assert.equal(await requestCommentProcessing("proj"), "started");
    assert.deepEqual(calls[0], { kind: "invoke", name: "permit-comment-pipeline", args: { action: "process", project_id: "proj" } });

    const fallback = fakeClient({
      invoke: async () => ({ data: null, error: { message: "Edge Function returned a non-2xx status code", context: { status: 503 } } }),
      rpc: () => ({ data: "due", error: null }),
    });
    assert.equal(await requestCommentProcessing("proj"), "queued");
    assert.equal(fallback[1].name, "request_project_comment_processing");

    fakeClient({
      invoke: async () => ({ data: null, error: { message: "non-2xx", context: { status: 403, json: async () => ({ error: "not allowed to change this project" }) } } }),
    });
    await assert.rejects(requestCommentProcessing("proj"), /Not allowed to change this project/);
  });

  it("summarizes a project's permits by the least settled state", () => {
    assert.equal(summarizeProjectState([]), null);
    assert.equal(summarizeProjectState([{ processing_state: "processed" }, { processing_state: "no_comments" }]), "processed");
    assert.equal(summarizeProjectState([{ processing_state: "processed" }, { processing_state: "retrying" }]), "retrying");
  });

  it("markers only include removed or changed comments; a missing column yields none", async () => {
    fakeClient({
      rows: {
        parsed_comments: [
          { id: "c1", portal_permit_id: "p1", portal_removed_at: "2026-11-10", portal_changed_at: null, portal_latest_text: null },
          { id: "c2", portal_permit_id: "p1", portal_removed_at: null, portal_changed_at: null, portal_latest_text: null },
        ],
      },
    });
    const m = await loadPortalCommentMarkers("proj");
    assert.deepEqual([...m.keys()], ["c1"]);
    fakeClient({ selectError: { code: "42703", message: "column parsed_comments.portal_removed_at does not exist" } });
    assert.equal((await loadPortalCommentMarkers("proj")).size, 0);
  });

  it("extracts the discussion of a persisted comment", () => {
    assert.equal(discussionOf("ref: 1\ncycle: 1\nfull_discussion_text:\nLine A\nLine B\nstatus: Resolved\n"), "Line A\nLine B");
    assert.equal(discussionOf("plain text"), "plain text");
  });
});
