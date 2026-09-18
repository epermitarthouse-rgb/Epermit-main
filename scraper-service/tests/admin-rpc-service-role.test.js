"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");

const { createAdminRouter } = require("../app/routes/admin.routes.js");
const { createRequirePlatformAdmin } = require("../app/services/governance/require-platform-admin.js");
const { computeEffectivePermissions } = require("../app/services/governance/governance.service.js");

const MIGRATION_PATH = path.join(
  __dirname,
  "../../supabase/migrations/20260918180100_admin_rpcs_service_role_backend_caller.sql",
);

const ACTOR_MIGRATION_PATH = path.join(
  __dirname,
  "../../supabase/migrations/20260918180200_admin_mutation_rpc_actor_attribution.sql",
);

const SUPER_ADMIN = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PLATFORM_ADMIN = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const NORMAL_USER = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const TARGET_USER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const SOURCE_USER = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

/** @type {Array<[string, string]>} */
const BACKEND_RPCS = [
  ["admin_get_effective_permissions", "admin_get_effective_permissions\\(p_user_id UUID\\)"],
  ["admin_list_audit_events", "admin_list_audit_events\\("],
  ["admin_copy_permissions", "admin_copy_permissions\\("],
  ["admin_set_feature_permission", "admin_set_feature_permission\\("],
  ["admin_delete_feature_permission", "admin_delete_feature_permission\\("],
  ["admin_set_scraped_data_scope", "admin_set_scraped_data_scope\\("],
  ["admin_set_credential_grant", "admin_set_credential_grant\\("],
  ["admin_activate_user", "admin_activate_user\\("],
  ["admin_deactivate_user", "admin_deactivate_user\\("],
];

/**
 * Extract the CREATE OR REPLACE body for a function name from migration SQL.
 * @param {string} sql
 * @param {string} fnPattern
 */
function extractFunctionBlock(sql, fnPattern) {
  const re = new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${fnPattern}[\\s\\S]*?\\$\\$;`,
    "m",
  );
  const match = sql.match(re);
  assert.ok(match, `missing function block for ${fnPattern}`);
  return match[0];
}

/**
 * @param {object} [opts]
 */
function makeAdminSupabase(opts = {}) {
  const userRoles = opts.userRoles || [
    { user_id: SUPER_ADMIN, role: "super_admin" },
    { user_id: PLATFORM_ADMIN, role: "admin" },
  ];
  const profiles = opts.profiles || [
    { user_id: SUPER_ADMIN, access_status: "active" },
    { user_id: PLATFORM_ADMIN, access_status: "active" },
    { user_id: TARGET_USER, access_status: "active" },
    { user_id: SOURCE_USER, access_status: "active" },
    { user_id: NORMAL_USER, access_status: "active" },
  ];
  const rpcHandlers = opts.rpcHandlers || {};
  const auditEvents = opts.auditEvents || [
    {
      id: "11111111-1111-1111-1111-111111111111",
      action: "feature_permission.changed",
      created_at: "2026-09-18T10:00:00.000Z",
      actor_id: PLATFORM_ADMIN,
      target_type: "user",
      target_id: TARGET_USER,
    },
  ];

  const authUsers = {
    super: { id: SUPER_ADMIN, email: "super@test" },
    admin: { id: PLATFORM_ADMIN, email: "admin@test" },
    user: { id: NORMAL_USER, email: "user@test" },
  };

  return {
    userRoles,
    profiles,
    auditEvents,
    auth: {
      admin: {
        updateUserById: async () => ({ error: null }),
      },
      getUser: async (token) => {
        const map = {
          super: { data: { user: authUsers.super }, error: null },
          admin: { data: { user: authUsers.admin }, error: null },
          user: { data: { user: authUsers.user }, error: null },
        };
        return map[token] || { data: { user: null }, error: new Error("invalid") };
      },
    },
    async rpc(name, args) {
      if (Object.prototype.hasOwnProperty.call(rpcHandlers, name)) {
        return rpcHandlers[name](args);
      }
      if (name === "has_role") {
        const match = userRoles.some(
          (row) => row.user_id === args._user_id && row.role === args._role,
        );
        return { data: match, error: null };
      }
      if (name === "is_user_active") {
        const profile = profiles.find((row) => row.user_id === args.p_user_id);
        return {
          data: profile ? profile.access_status === "active" : true,
          error: null,
        };
      }
      return { data: null, error: new Error(`unknown rpc ${name}`) };
    },
    from(table) {
      const rows =
        table === "profiles"
          ? profiles
          : table === "user_roles"
            ? userRoles
            : table === "platform_audit_events"
              ? auditEvents
              : [];

      const chain = {
        _filters: {},
        _lt: null,
        _limit: null,
        _countHead: false,
        select(_cols, selectOpts) {
          if (selectOpts?.head) {
            chain._countHead = true;
          }
          return chain;
        },
        eq(col, val) {
          chain._filters[col] = val;
          return chain;
        },
        lt(col, val) {
          chain._lt = { col, val };
          return chain;
        },
        order() {
          return chain;
        },
        limit(n) {
          chain._limit = n;
          return chain;
        },
        in(col, vals) {
          chain._inFilters = { col, vals };
          return chain;
        },
        update() {
          return chain;
        },
        maybeSingle: async () => {
          const match = rows.find((row) =>
            Object.entries(chain._filters).every(([key, val]) => row[key] === val),
          );
          return { data: match ?? null, error: null };
        },
        then(resolve) {
          if (chain._countHead && table === "profiles") {
            const filtered = profiles.filter((row) =>
              Object.entries(chain._filters).every(([key, val]) => row[key] === val),
            );
            return resolve({ count: filtered.length, error: null });
          }

          let filtered = rows.filter((row) =>
            Object.entries(chain._filters).every(([key, val]) => row[key] === val),
          );
          if (chain._lt) {
            filtered = filtered.filter((row) => row[chain._lt.col] < chain._lt.val);
          }
          if (chain._limit != null) {
            filtered = filtered.slice(0, chain._limit);
          }
          return resolve({ data: filtered, error: null, count: filtered.length });
        },
      };
      return chain;
    },
  };
}

/**
 * @param {ReturnType<typeof makeAdminSupabase>} supabase
 */
function mountAdminApp(supabase) {
  const app = express();
  app.use(express.json());
  const requirePlatformAdmin = createRequirePlatformAdmin({ supabase });
  app.use(requirePlatformAdmin);
  app.use(createAdminRouter({ supabase }));
  return app;
}

/**
 * @param {import("express").Application} app
 * @param {string} method
 * @param {string} path
 * @param {string} token
 * @param {unknown} [body]
 */
async function requestAdmin(app, method, path, token, body) {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, body: json };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("admin RPC service-role migration", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");

  for (const [label, fnPattern] of BACKEND_RPCS) {
    it(`${label} uses backend-safe auth gate`, () => {
      const block = extractFunctionBlock(sql, fnPattern);
      assert.match(block, /PERFORM public\._admin_require_backend_caller\(\)/);
      assert.doesNotMatch(block, /PERFORM public\._admin_require_platform_admin\(\)/);
    });
  }

  it("admin_activate_user and admin_deactivate_user skip auth.uid hierarchy checks for service_role", () => {
    const activate = extractFunctionBlock(sql, "admin_activate_user\\(");
    const deactivate = extractFunctionBlock(sql, "admin_deactivate_user\\(");
    assert.match(activate, /<> 'service_role'/);
    assert.match(deactivate, /<> 'service_role'/);
    assert.match(deactivate, /Cannot deactivate the last super admin/);
  });

  it("grants service_role execute on backend-invoked admin RPCs", () => {
    const grantTargets = [
      "admin_get_effective_permissions(UUID)",
      "admin_list_audit_events(INTEGER, TIMESTAMPTZ, UUID, TEXT, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ)",
      "admin_copy_permissions(UUID, UUID)",
      "admin_set_feature_permission(UUID, UUID, TEXT, TEXT)",
      "admin_delete_feature_permission(UUID, UUID, TEXT)",
      "admin_set_scraped_data_scope(UUID, TEXT, TEXT)",
      "admin_set_credential_grant(UUID, UUID, TEXT, UUID, TEXT)",
    ];
    for (const fn of grantTargets) {
      assert.match(
        sql,
        new RegExp(
          `GRANT EXECUTE ON FUNCTION public\\.${fn.replace(/[()]/g, "\\$&")} TO authenticated, service_role`,
        ),
      );
    }
  });

  it("does not alter admin_list_member_directory (browser JWT only)", () => {
    assert.doesNotMatch(sql, /admin_list_member_directory/);
  });
});

describe("admin RPC routes with service-role backend path", () => {
  it("copy permissions succeeds when RPC authorized (no fallback)", async () => {
    let called = false;
    const supabase = makeAdminSupabase({
      rpcHandlers: {
        admin_copy_permissions: (args) => {
          called = true;
          assert.equal(args.p_from_user_id, SOURCE_USER);
          assert.equal(args.p_to_user_id, TARGET_USER);
          return {
            data: {
              from_user_id: SOURCE_USER,
              to_user_id: TARGET_USER,
              feature_permissions: 2,
              scraped_data_scope: 1,
              credential_grants: 3,
            },
            error: null,
          };
        },
      },
    });
    const app = mountAdminApp(supabase);
    const res = await requestAdmin(
      app,
      "POST",
      `/api/admin/v1/access/users/${TARGET_USER}/copy-from/${SOURCE_USER}`,
      "super",
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(called, true);
  });

  it("copy permissions returns 500 when RPC fails (no fallback)", async () => {
    const supabase = makeAdminSupabase({
      rpcHandlers: {
        admin_copy_permissions: () => ({
          data: null,
          error: { message: "Not authorized" },
        }),
      },
    });
    const app = mountAdminApp(supabase);
    const res = await requestAdmin(
      app,
      "POST",
      `/api/admin/v1/access/users/${TARGET_USER}/copy-from/${SOURCE_USER}`,
      "admin",
    );

    assert.equal(res.status, 500);
  });

  it("audit events returns RPC payload for authorized admin", async () => {
    const supabase = makeAdminSupabase({
      rpcHandlers: {
        admin_list_audit_events: () => ({
          data: {
            events: [{ id: "evt-1", action: "feature_permission.changed" }],
            next_cursor: null,
          },
          error: null,
        }),
      },
    });
    const app = mountAdminApp(supabase);
    const res = await requestAdmin(app, "GET", "/api/admin/v1/audit/events?limit=10", "admin");

    assert.equal(res.status, 200);
    assert.equal(res.body.events.length, 1);
    assert.equal(res.body.events[0].action, "feature_permission.changed");
  });

  it("audit events fallback works when RPC fails", async () => {
    const supabase = makeAdminSupabase({
      rpcHandlers: {
        admin_list_audit_events: () => ({
          data: null,
          error: { message: "Not authorized" },
        }),
      },
    });
    const app = mountAdminApp(supabase);
    const res = await requestAdmin(app, "GET", "/api/admin/v1/audit/events?limit=10", "super");

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.events));
    assert.equal(res.body.events.length, 1);
    assert.equal(res.body.pagination.limit, 10);
  });

  it("rejects non-admin before RPC on audit and copy routes", async () => {
    const supabase = makeAdminSupabase({
      rpcHandlers: {
        admin_list_audit_events: () => ({
          data: { events: [{ id: "secret" }], next_cursor: null },
          error: null,
        }),
        admin_copy_permissions: () => ({
          data: { ok: true },
          error: null,
        }),
      },
    });
    const app = mountAdminApp(supabase);

    const auditRes = await requestAdmin(app, "GET", "/api/admin/v1/audit/events", "user");
    assert.equal(auditRes.status, 403);
    assert.equal(auditRes.body.error, "PLATFORM_ADMIN_REQUIRED");

    const copyRes = await requestAdmin(
      app,
      "POST",
      `/api/admin/v1/access/users/${TARGET_USER}/copy-from/${SOURCE_USER}`,
      "user",
    );
    assert.equal(copyRes.status, 403);
    assert.equal(copyRes.body.error, "PLATFORM_ADMIN_REQUIRED");
  });

  it("computeEffectivePermissions uses RPC payload when backend RPC succeeds", async () => {
    const rpcPayload = {
      user_id: TARGET_USER,
      access_status: "active",
      platform_admin: false,
      platform_roles: [],
      feature_permissions: [],
      scraped_data_scope: [],
      credential_grants: [],
      projects: [],
      risks: [],
    };
    const supabase = makeAdminSupabase({
      rpcHandlers: {
        admin_get_effective_permissions: (args) => {
          assert.equal(args.p_user_id, TARGET_USER);
          return { data: rpcPayload, error: null };
        },
        _resolve_project_access_level: () => ({ data: "write", error: null }),
        has_project_access: () => ({ data: true, error: null }),
      },
    });

    const result = await computeEffectivePermissions(supabase, TARGET_USER);
    assert.equal(result.user_id, TARGET_USER);
    assert.equal(result.access_status, "active");
    assert.ok(Array.isArray(result.platform_roles));
  });

  it("computeEffectivePermissions falls back when RPC unauthorized", async () => {
    const supabase = makeAdminSupabase({
      rpcHandlers: {
        admin_get_effective_permissions: () => ({
          data: null,
          error: new Error("Not authorized"),
        }),
        _resolve_project_access_level: () => ({ data: "write", error: null }),
        has_project_access: () => ({ data: true, error: null }),
      },
    });

    const result = await computeEffectivePermissions(supabase, TARGET_USER);
    assert.equal(result.user_id, TARGET_USER);
    assert.ok(Array.isArray(result.feature_permissions));
    assert.ok(result.global_features);
  });
});

/** @type {Array<[string, string]>} */
const MUTATION_RPCS_WITH_ACTOR = [
  ["admin_copy_permissions", "admin_copy_permissions\\("],
  ["admin_set_feature_permission", "admin_set_feature_permission\\("],
  ["admin_delete_feature_permission", "admin_delete_feature_permission\\("],
  ["admin_set_scraped_data_scope", "admin_set_scraped_data_scope\\("],
  ["admin_set_credential_grant", "admin_set_credential_grant\\("],
  ["admin_activate_user", "admin_activate_user\\("],
  ["admin_deactivate_user", "admin_deactivate_user\\("],
];

describe("admin mutation RPC actor attribution migration", () => {
  const sql = fs.readFileSync(ACTOR_MIGRATION_PATH, "utf8");

  it("defines _admin_resolve_actor using COALESCE pattern", () => {
    const block = extractFunctionBlock(sql, "_admin_resolve_actor\\(");
    assert.match(block, /COALESCE\(p_actor_id, auth\.uid\(\)\)/);
  });

  for (const [label, fnPattern] of MUTATION_RPCS_WITH_ACTOR) {
    it(`${label} accepts p_actor_id and resolves actor for grants and audit`, () => {
      const block = extractFunctionBlock(sql, fnPattern);
      assert.match(block, /p_actor_id UUID DEFAULT NULL/);
      assert.match(block, /v_actor := public\._admin_resolve_actor\(p_actor_id\)/);
      assert.match(block, /PERFORM public\._admin_require_backend_caller\(\)/);
      assert.doesNotMatch(block, /granted_by\s*=\s*auth\.uid\(\)/);
      assert.doesNotMatch(block, /,\s*auth\.uid\(\)\s*\)/);
    });
  }

  it("grants service_role execute on new actor-aware signatures", () => {
    const grantTargets = [
      "admin_copy_permissions(UUID, UUID, UUID)",
      "admin_set_feature_permission(UUID, UUID, TEXT, TEXT, UUID)",
      "admin_delete_feature_permission(UUID, UUID, TEXT, UUID)",
      "admin_set_scraped_data_scope(UUID, TEXT, TEXT, UUID)",
      "admin_set_credential_grant(UUID, UUID, TEXT, UUID, TEXT, UUID)",
      "admin_deactivate_user(UUID, TEXT, UUID)",
      "admin_activate_user(UUID, TEXT, UUID)",
    ];
    for (const fn of grantTargets) {
      assert.match(
        sql,
        new RegExp(
          `GRANT EXECUTE ON FUNCTION public\\.${fn.replace(/[()]/g, "\\$&")} TO authenticated, service_role`,
        ),
      );
    }
  });
});

describe("admin mutation routes pass JWT actor to RPCs", () => {
  it("copy permissions passes p_actor_id from JWT admin", async () => {
    /** @type {Record<string, unknown> | null} */
    let capturedArgs = null;
    const supabase = makeAdminSupabase({
      rpcHandlers: {
        admin_copy_permissions: (args) => {
          capturedArgs = args;
          return {
            data: {
              from_user_id: SOURCE_USER,
              to_user_id: TARGET_USER,
              feature_permissions: 1,
              scraped_data_scope: 0,
              credential_grants: 0,
            },
            error: null,
          };
        },
      },
    });
    const app = mountAdminApp(supabase);
    const res = await requestAdmin(
      app,
      "POST",
      `/api/admin/v1/access/users/${TARGET_USER}/copy-from/${SOURCE_USER}`,
      "admin",
    );

    assert.equal(res.status, 200);
    assert.equal(capturedArgs?.p_actor_id, PLATFORM_ADMIN);
    assert.equal(capturedArgs?.p_from_user_id, SOURCE_USER);
    assert.equal(capturedArgs?.p_to_user_id, TARGET_USER);
  });

  it("feature permission passes JWT actor, not body p_actor_id", async () => {
    /** @type {Record<string, unknown> | null} */
    let capturedArgs = null;
    const supabase = makeAdminSupabase({
      rpcHandlers: {
        admin_set_feature_permission: (args) => {
          capturedArgs = args;
          return { data: { access_level: "read" }, error: null };
        },
      },
    });
    const app = mountAdminApp(supabase);
    const res = await requestAdmin(
      app,
      "PUT",
      `/api/admin/v1/access/users/${TARGET_USER}/features`,
      "super",
      {
        features: [
          {
            feature_key: "projects",
            access_level: "read",
            p_actor_id: NORMAL_USER,
          },
        ],
      },
    );

    assert.equal(res.status, 200);
    assert.equal(capturedArgs?.p_actor_id, SUPER_ADMIN);
    assert.notEqual(capturedArgs?.p_actor_id, NORMAL_USER);
  });

  it("activate user passes p_actor_id from JWT admin", async () => {
    /** @type {Record<string, unknown> | null} */
    let capturedArgs = null;
    const supabase = makeAdminSupabase({
      rpcHandlers: {
        admin_activate_user: (args) => {
          capturedArgs = args;
          return { data: { user_id: TARGET_USER, access_status: "active" }, error: null };
        },
      },
    });
    const app = mountAdminApp(supabase);
    const res = await requestAdmin(
      app,
      "POST",
      `/api/admin/v1/access/users/${TARGET_USER}/activate`,
      "admin",
      { reason: "test", p_actor_id: NORMAL_USER },
    );

    assert.equal(res.status, 200);
    assert.equal(capturedArgs?.p_actor_id, PLATFORM_ADMIN);
    assert.equal(capturedArgs?.p_user_id, TARGET_USER);
  });

  it("deactivate user passes p_actor_id from JWT super admin", async () => {
    /** @type {Record<string, unknown> | null} */
    let capturedArgs = null;
    const supabase = makeAdminSupabase({
      userRoles: [
        { user_id: SUPER_ADMIN, role: "super_admin" },
        { user_id: PLATFORM_ADMIN, role: "admin" },
        { user_id: TARGET_USER, role: "user" },
      ],
      rpcHandlers: {
        admin_deactivate_user: (args) => {
          capturedArgs = args;
          return {
            data: {
              user_id: TARGET_USER,
              access_status: "deactivated",
              credential_grants_revoked: 0,
            },
            error: null,
          };
        },
      },
    });
    const app = mountAdminApp(supabase);
    const res = await requestAdmin(
      app,
      "POST",
      `/api/admin/v1/access/users/${TARGET_USER}/deactivate`,
      "super",
      { reason: "test" },
    );

    assert.equal(res.status, 200);
    assert.equal(capturedArgs?.p_actor_id, SUPER_ADMIN);
  });

  it("rejects non-admin before mutation RPC on activate route", async () => {
    let rpcCalled = false;
    const supabase = makeAdminSupabase({
      rpcHandlers: {
        admin_activate_user: () => {
          rpcCalled = true;
          return { data: { ok: true }, error: null };
        },
      },
    });
    const app = mountAdminApp(supabase);
    const res = await requestAdmin(
      app,
      "POST",
      `/api/admin/v1/access/users/${TARGET_USER}/activate`,
      "user",
      { reason: "test" },
    );

    assert.equal(res.status, 403);
    assert.equal(res.body.error, "PLATFORM_ADMIN_REQUIRED");
    assert.equal(rpcCalled, false);
  });
});
