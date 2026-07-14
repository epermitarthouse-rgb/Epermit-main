"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  assertProjectAccess,
  assertProjectEditorAccess,
  requireProjectAccess,
  assertCoordinationBelongsToProject,
  assertEntityProjectMatch,
} = require("../app/services/uci/uci-access.service.js");

const PROJECT_A = "project-a";
const PROJECT_B = "project-b";
const COORD_A = "coord-a";
const USER_OWNER = "user-owner";
const USER_EDITOR = "user-editor";
const USER_VIEWER = "user-viewer";
const USER_DENIED = "user-denied";

/**
 * @param {object} [opts]
 */
function makeSupabase(opts = {}) {
  const team = opts.team || [
    { project_id: PROJECT_A, user_id: USER_EDITOR, role: "editor" },
    { project_id: PROJECT_A, user_id: USER_VIEWER, role: "viewer" },
  ];
  const projects = opts.projects || [{ id: PROJECT_A, user_id: USER_OWNER }];

  return {
    from(table) {
      const rows =
        table === "project_team_members"
          ? team
          : table === "projects"
            ? projects
            : table === "coordination_records"
              ? [
                  {
                    id: COORD_A,
                    project_id: PROJECT_A,
                  },
                ]
              : [];
      const chain = {
        _filters: {},
        select() {
          return chain;
        },
        eq(col, val) {
          chain._filters[col] = val;
          return chain;
        },
        maybeSingle: async () => {
          const match = rows.find((r) =>
            Object.entries(chain._filters).every(([k, v]) => r[k] === v),
          );
          return { data: match ?? null, error: null };
        },
      };
      return chain;
    },
    async rpc(name, args) {
      const uid = args._user_id;
      const pid = args._project_id;
      if (pid === PROJECT_B) return { data: false, error: null };
      if (uid === USER_DENIED) return { data: false, error: null };

      if (name === "has_project_access") {
        if (uid === USER_OWNER || uid === USER_EDITOR || uid === USER_VIEWER) {
          return { data: true, error: null };
        }
        return { data: false, error: null };
      }

      if (name === "has_project_editor_access") {
        if (uid === USER_OWNER || uid === USER_EDITOR) return { data: true, error: null };
        return { data: false, error: null };
      }

      return { data: null, error: new Error(`unknown rpc ${name}`) };
    },
  };
}

describe("uci-access hardening (NB-D1-001)", () => {
  it("allows project owner read access", async () => {
    const supabase = makeSupabase();
    const ok = await assertProjectAccess({
      supabase,
      userId: USER_OWNER,
      projectId: PROJECT_A,
    });
    assert.equal(ok, true);
  });

  it("allows team viewer read access", async () => {
    const supabase = makeSupabase();
    const ok = await assertProjectAccess({
      supabase,
      userId: USER_VIEWER,
      projectId: PROJECT_A,
    });
    assert.equal(ok, true);
  });

  it("denies unrelated user read access", async () => {
    const supabase = makeSupabase();
    const ok = await assertProjectAccess({
      supabase,
      userId: USER_DENIED,
      projectId: PROJECT_A,
    });
    assert.equal(ok, false);
  });

  it("allows editor write access", async () => {
    const supabase = makeSupabase();
    const ok = await assertProjectEditorAccess({
      supabase,
      userId: USER_EDITOR,
      projectId: PROJECT_A,
    });
    assert.equal(ok, true);
  });

  it("denies viewer write access", async () => {
    const supabase = makeSupabase();
    const ok = await assertProjectEditorAccess({
      supabase,
      userId: USER_VIEWER,
      projectId: PROJECT_A,
    });
    assert.equal(ok, false);
  });

  it("requireProjectAccess with write:true rejects viewers", async () => {
    const supabase = makeSupabase();
    await assert.rejects(
      () =>
        requireProjectAccess({
          supabase,
          userId: USER_VIEWER,
          projectId: PROJECT_A,
          write: true,
        }),
      (err) => {
        assert.equal(err.code, "PROJECT_EDITOR_ACCESS_DENIED");
        assert.equal(err.statusCode, 403);
        return true;
      },
    );
  });

  it("assertCoordinationBelongsToProject rejects cross-project coordination id", async () => {
    const supabase = makeSupabase();
    await assert.rejects(
      () =>
        assertCoordinationBelongsToProject({
          supabase,
          projectId: PROJECT_B,
          coordinationRecordId: COORD_A,
        }),
      (err) => {
        assert.equal(err.code, "NOT_FOUND");
        return true;
      },
    );
  });

  it("assertEntityProjectMatch hides cross-project child access", () => {
    assert.throws(
      () =>
        assertEntityProjectMatch({
          expectedProjectId: PROJECT_A,
          actualProjectId: PROJECT_B,
          entityLabel: "Application",
        }),
      (err) => {
        assert.equal(err.code, "NOT_FOUND");
        return true;
      },
    );
  });
});
