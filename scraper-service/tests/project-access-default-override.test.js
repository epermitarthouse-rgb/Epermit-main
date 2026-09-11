"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const http = require("node:http");

const { createAdminRouter } = require("../app/routes/admin.routes.js");
const { createRequirePlatformAdmin } = require("../app/services/governance/require-platform-admin.js");
const {
  resolveProjectAccessLevel,
  hasProjectMembership,
  computeEffectivePermissions,
} = require("../app/services/governance/governance.service.js");

const USER_ADMIN = "44444444-4444-4444-4444-444444444444";
const USER_TARGET = "e0f249c2-28b3-4140-968e-faa5efb77b3e";
const PROJECT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PROJECT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const PROJECT_C = "cccccccc-cccc-cccc-cccc-cccccccccccc";

/**
 * Supabase stub for default+override project access tests.
 * @param {object} [opts]
 */
function makeProjectAccessSupabase(opts = {}) {
  const overrides = [...(opts.overrides || [])];
  const projects = opts.projects || [
    { id: PROJECT_A, name: "Alpha", user_id: "00000000-0000-0000-0000-000000000099" },
    { id: PROJECT_B, name: "Beta", user_id: "00000000-0000-0000-0000-000000000099" },
    { id: PROJECT_C, name: "Gamma", user_id: "00000000-0000-0000-0000-000000000099" },
  ];
  const profiles = opts.profiles || [{ user_id: USER_TARGET, access_status: "active" }];
  const userRoles = opts.userRoles || [];

  return {
    auth: {
      getUser: async (token) => {
        if (token === "admin") {
          return { data: { user: { id: USER_ADMIN, email: "admin@test" } }, error: null };
        }
        return { data: { user: null }, error: new Error("invalid") };
      },
      admin: { updateUserById: async () => ({ error: null }) },
    },
    from(table) {
      const rows =
        table === "profiles"
          ? profiles
          : table === "user_roles"
            ? userRoles
            : table === "projects"
              ? projects
              : table === "project_team_members"
                ? opts.teamMembers || []
                : table === "user_project_access_overrides"
                  ? overrides
                  : table === "user_feature_permissions"
                    ? []
                    : table === "user_scraped_data_scope"
                      ? []
                      : table === "user_portal_credential_grants"
                        ? []
                        : table === "portal_credentials"
                          ? []
                          : table === "platform_audit_events"
                            ? []
                            : table === "user_access_reviews"
                              ? []
                              : table === "governance_config"
                                ? [{ enforce_mode: "legacy" }]
                                : [];

      const chain = {
        _filters: {},
        _upsert: null,
        _delete: false,
        _insert: null,
        _single: false,
        select() {
          return chain;
        },
        insert(payload) {
          chain._insert = payload;
          if (table === "platform_audit_events") {
            return Promise.resolve({ data: { id: "audit-1" }, error: null });
          }
          return chain;
        },
        upsert(payload) {
          chain._upsert = payload;
          const row = {
            user_id: payload.user_id,
            project_id: payload.project_id,
            access_level: payload.access_level,
            granted_by: payload.granted_by ?? null,
          };
          const idx = overrides.findIndex(
            (item) => item.user_id === row.user_id && item.project_id === row.project_id,
          );
          if (idx >= 0) {
            overrides[idx] = { ...overrides[idx], ...row };
          } else {
            overrides.push(row);
          }
          return Promise.resolve({ data: row, error: null });
        },
        delete() {
          chain._delete = true;
          return chain;
        },
        eq(col, val) {
          chain._filters[col] = val;
          if (chain._delete && table === "user_project_access_overrides") {
            for (let i = overrides.length - 1; i >= 0; i -= 1) {
              const row = overrides[i];
              const matches = Object.entries(chain._filters).every(([k, v]) => row[k] === v);
              if (matches) {
                overrides.splice(i, 1);
              }
            }
          }
          return chain;
        },
        is() {
          return chain;
        },
        order() {
          return chain;
        },
        limit() {
          return chain;
        },
        maybeSingle: async () => {
          const match = rows.find((row) =>
            Object.entries(chain._filters).every(([k, v]) => row[k] === v),
          );
          return { data: match ?? null, error: null };
        },
        single: async () => {
          const match = rows.find((row) =>
            Object.entries(chain._filters).every(([k, v]) => row[k] === v),
          );
          return { data: match ?? null, error: match ? null : new Error("not found") };
        },
        then(resolve) {
          let filtered = rows.filter((row) =>
            Object.entries(chain._filters).every(([k, v]) => row[k] === v),
          );
          return Promise.resolve(resolve({ data: filtered, error: null, count: filtered.length }));
        },
      };
      return chain;
    },
    async rpc(name, args) {
      if (name === "is_user_active") {
        const profile = profiles.find((row) => row.user_id === args.p_user_id);
        return { data: profile ? profile.access_status === "active" : true, error: null };
      }
      if (name === "has_role") {
        const isAdmin = userRoles.some(
          (row) => row.user_id === args._user_id && row.role === args._role,
        );
        return { data: isAdmin, error: null };
      }
      if (name === "_resolve_project_access_level") {
        const userId = args.p_user_id;
        const projectId = args.p_project_id;
        const profile = profiles.find((row) => row.user_id === userId);
        if (!profile || profile.access_status !== "active") {
          return { data: "none", error: null };
        }
        const isAdmin = userRoles.some((row) => row.user_id === userId && row.role === "admin");
        if (isAdmin) {
          return { data: "write", error: null };
        }
        const owned = projects.find((row) => row.id === projectId && row.user_id === userId);
        if (owned) {
          return { data: "owner", error: null };
        }
        const override = overrides.find(
          (row) => row.user_id === userId && row.project_id === projectId,
        );
        if (override) {
          return { data: override.access_level, error: null };
        }
        return { data: "write", error: null };
      }
      if (name === "has_project_access") {
        const { data: level } = await this.rpc("_resolve_project_access_level", {
          p_user_id: args._user_id,
          p_project_id: args._project_id,
        });
        return { data: ["owner", "read", "write"].includes(level), error: null };
      }
      if (name === "has_project_editor_access") {
        const { data: level } = await this.rpc("_resolve_project_access_level", {
          p_user_id: args._user_id,
          p_project_id: args._project_id,
        });
        return { data: ["owner", "write"].includes(level), error: null };
      }
      if (name === "admin_get_effective_permissions") {
        return { data: null, error: new Error("use fallback") };
      }
      if (name === "admin_append_audit_event") {
        return { data: "audit-1", error: null };
      }
      return { data: null, error: new Error(`unknown rpc ${name}`) };
    },
  };
}

describe("default+override project access (governance JS)", () => {
  it("defaults active users to write when no override row exists", async () => {
    const supabase = makeProjectAccessSupabase();
    assert.equal(await resolveProjectAccessLevel(supabase, USER_TARGET, PROJECT_A), "write");
    assert.equal(await hasProjectMembership(supabase, USER_TARGET, PROJECT_A), true);
  });

  it("honors explicit none override", async () => {
    const supabase = makeProjectAccessSupabase({
      overrides: [
        {
          user_id: USER_TARGET,
          project_id: PROJECT_A,
          access_level: "none",
        },
      ],
    });
    assert.equal(await resolveProjectAccessLevel(supabase, USER_TARGET, PROJECT_A), "none");
    assert.equal(await hasProjectMembership(supabase, USER_TARGET, PROJECT_A), false);
    assert.equal(await resolveProjectAccessLevel(supabase, USER_TARGET, PROJECT_B), "write");
  });

  it("honors explicit read override and denies editor access via RPC", async () => {
    const supabase = makeProjectAccessSupabase({
      overrides: [
        {
          user_id: USER_TARGET,
          project_id: PROJECT_B,
          access_level: "read",
        },
      ],
    });
    assert.equal(await resolveProjectAccessLevel(supabase, USER_TARGET, PROJECT_B), "read");
    const readOk = await supabase.rpc("has_project_access", {
      _user_id: USER_TARGET,
      _project_id: PROJECT_B,
    });
    const writeOk = await supabase.rpc("has_project_editor_access", {
      _user_id: USER_TARGET,
      _project_id: PROJECT_B,
    });
    assert.equal(readOk.data, true);
    assert.equal(writeOk.data, false);
  });

  it("surfaces persisted none override in admin project_access view", async () => {
    const supabase = makeProjectAccessSupabase({
      overrides: [
        {
          user_id: USER_TARGET,
          project_id: PROJECT_A,
          access_level: "none",
        },
      ],
    });

    const result = await computeEffectivePermissions(supabase, USER_TARGET);
    const rows = /** @type {Array<{ project_id: string, control: string, effective_access: string }>} */ (
      result.project_access || []
    );
    const alpha = rows.find((row) => row.project_id === PROJECT_A);
    const beta = rows.find((row) => row.project_id === PROJECT_B);
    assert.ok(alpha);
    assert.equal(alpha.control, "none");
    assert.equal(alpha.effective_access, "none");
    assert.ok(beta);
    assert.equal(beta.control, "default");
    assert.equal(beta.effective_access, "write");
    assert.equal(result.access_summaries?.projects_exception_count, 1);
  });
});

describe("PUT /api/admin/v1/access/users/:id/projects/:projectId/role", () => {
  /** @type {http.Server | null} */
  let server = null;
  /** @type {number | null} */
  let port = null;
  /** @type {ReturnType<typeof makeProjectAccessSupabase>} */
  let supabase;

  beforeEach(async () => {
    supabase = makeProjectAccessSupabase({
      profiles: [
        { user_id: USER_ADMIN, access_status: "active" },
        { user_id: USER_TARGET, access_status: "active" },
      ],
      userRoles: [{ user_id: USER_ADMIN, role: "admin" }],
    });

    const app = express();
    app.use(express.json());
    const requirePlatformAdmin = createRequirePlatformAdmin({ supabase });
    app.use(requirePlatformAdmin);
    app.use(createAdminRouter({ supabase }));

    server = http.createServer(app);
    await new Promise((resolve) => {
      server.listen(0, resolve);
    });
    port = /** @type {http.Server} */ (server).address().port;
  });

  afterEach(async () => {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      server = null;
      port = null;
    }
  });

  async function putProjectAccess(userId, projectId, body) {
    const res = await fetch(
      `http://127.0.0.1:${port}/api/admin/v1/access/users/${encodeURIComponent(userId)}/projects/${encodeURIComponent(projectId)}/role`,
      {
        method: "PUT",
        headers: {
          Authorization: "Bearer admin",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    const json = await res.json();
    return { status: res.status, json };
  }

  it("persists none override to user_project_access_overrides", async () => {
    const { status, json } = await putProjectAccess(USER_TARGET, PROJECT_A, {
      access_level: "none",
    });
    assert.equal(status, 200);
    assert.equal(json.access_level, "none");

    const result = await computeEffectivePermissions(supabase, USER_TARGET);
    const row = (result.project_access || []).find(
      (item) => item.project_id === PROJECT_A,
    );
    assert.ok(row);
    assert.equal(row.control, "none");
  });

  it("clears override when access_level is default", async () => {
    await putProjectAccess(USER_TARGET, PROJECT_A, { access_level: "none" });
    const cleared = await putProjectAccess(USER_TARGET, PROJECT_A, { access_level: "default" });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.json.access_level, "default");

    const result = await computeEffectivePermissions(supabase, USER_TARGET);
    const row = (result.project_access || []).find(
      (item) => item.project_id === PROJECT_A,
    );
    assert.ok(row);
    assert.equal(row.control, "default");
    assert.equal(row.effective_access, "write");
  });

  it("maps legacy role none to none override", async () => {
    const { status, json } = await putProjectAccess(USER_TARGET, PROJECT_B, { role: "none" });
    assert.equal(status, 200);
    assert.equal(json.access_level, "none");
  });
});
