"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");

const { createAdminRouter } = require("../app/routes/admin.routes.js");
const { createRequirePlatformAdmin } = require("../app/services/governance/require-platform-admin.js");

const MIGRATION_PATH = path.join(
  __dirname,
  "../../supabase/migrations/20260918180000_admin_overview_metrics_service_role.sql",
);

const SUPER_ADMIN = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PLATFORM_ADMIN = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const PLATFORM_ADMIN_2 = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const NORMAL_USER = "dddddddd-dddd-dddd-dddd-dddddddddddd";

/**
 * @param {object} [opts]
 */
function makeOverviewSupabase(opts = {}) {
  const userRoles = opts.userRoles || [
    { user_id: SUPER_ADMIN, role: "super_admin" },
    { user_id: PLATFORM_ADMIN, role: "admin" },
  ];
  const profiles = opts.profiles || [
    { user_id: SUPER_ADMIN, access_status: "active" },
    { user_id: PLATFORM_ADMIN, access_status: "active" },
    { user_id: PLATFORM_ADMIN_2, access_status: "active" },
    { user_id: NORMAL_USER, access_status: "active" },
  ];
  const rpcPayload = opts.rpcPayload ?? null;
  const rpcError = opts.rpcError ?? null;

  const authUsers = {
    super: { id: SUPER_ADMIN, email: "super@test" },
    admin: { id: PLATFORM_ADMIN, email: "admin@test" },
    user: { id: NORMAL_USER, email: "user@test" },
  };

  return {
    userRoles,
    profiles,
    auth: {
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
      if (name === "admin_overview_metrics") {
        if (rpcError) {
          return { data: null, error: rpcError };
        }
        if (rpcPayload) {
          return { data: rpcPayload, error: null };
        }
        return { data: null, error: new Error("Not authorized") };
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
            : [];

      const chain = {
        _filters: {},
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
        in(col, vals) {
          chain._inFilters = { col, vals };
          return chain;
        },
        then(resolve) {
          if (chain._countHead && table === "profiles") {
            let filtered = profiles.filter((row) =>
              Object.entries(chain._filters).every(([key, val]) => row[key] === val),
            );
            return resolve({ count: filtered.length, error: null });
          }

          if (table === "user_roles" && chain._inFilters) {
            const filtered = userRoles.filter((row) =>
              chain._inFilters.vals.includes(row.role),
            );
            return resolve({ data: filtered, error: null });
          }

          const filtered = rows.filter((row) =>
            Object.entries(chain._filters).every(([key, val]) => row[key] === val),
          );
          return resolve({ data: filtered, error: null, count: filtered.length });
        },
      };
      return chain;
    },
  };
}

/**
 * @param {ReturnType<typeof makeOverviewSupabase>} supabase
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
 * @param {string} token
 */
function requestOverview(app, token) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const { port } = server.address();
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/admin/v1/overview`, {
          headers: { authorization: `Bearer ${token}` },
        });
        const json = await res.json().catch(() => ({}));
        resolve({ status: res.status, body: json });
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

describe("admin overview metrics migration", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");

  it("uses backend-safe auth gate", () => {
    assert.match(sql, /PERFORM public\._admin_require_backend_caller\(\)/);
    assert.doesNotMatch(sql, /PERFORM public\._admin_require_platform_admin\(\)/);
  });

  it("grants execute to service_role", () => {
    assert.match(
      sql,
      /GRANT EXECUTE ON FUNCTION public\.admin_overview_metrics\(\) TO authenticated, service_role/,
    );
  });

  it("counts distinct admin and super_admin users for platform_admins", () => {
    assert.match(sql, /COUNT\(DISTINCT ur\.user_id\)/);
    assert.match(sql, /'admin'::public\.app_role, 'super_admin'::public\.app_role/);
  });

  it("returns governance and audit overview fields", () => {
    assert.match(sql, /'governance_enforce_mode'/);
    assert.match(sql, /'audit_events_24h'/);
    assert.match(sql, /'pending_invitations_30d'/);
  });
});

describe("admin overview route", () => {
  it("returns RPC payload for authorized admin (service-role backend path)", async () => {
    const supabase = makeOverviewSupabase({
      rpcPayload: {
        total_users: 4,
        active_users: 4,
        deactivated_users: 0,
        platform_admins: 3,
        audit_events_24h: 12,
        governance_enforce_mode: "enforce",
        pending_invitations_30d: 1,
      },
    });
    const app = mountAdminApp(supabase);
    const res = await requestOverview(app, "super");

    assert.equal(res.status, 200);
    assert.equal(res.body.platform_admins, 3);
    assert.equal(res.body.governance_enforce_mode, "enforce");
    assert.equal(res.body.audit_events_24h, 12);
    assert.equal(res.body.pending_invitations_30d, 1);
  });

  it("rejects non-admin users before RPC (cannot bypass Express gate)", async () => {
    const supabase = makeOverviewSupabase({
      rpcPayload: {
        total_users: 999,
        platform_admins: 999,
        governance_enforce_mode: "enforce",
      },
    });
    const app = mountAdminApp(supabase);
    const res = await requestOverview(app, "user");

    assert.equal(res.status, 403);
    assert.equal(res.body.error, "PLATFORM_ADMIN_REQUIRED");
  });

  it("fallback still works when RPC genuinely fails", async () => {
    const supabase = makeOverviewSupabase({
      userRoles: [
        { user_id: SUPER_ADMIN, role: "super_admin" },
        { user_id: SUPER_ADMIN, role: "admin" },
        { user_id: PLATFORM_ADMIN, role: "admin" },
        { user_id: PLATFORM_ADMIN_2, role: "admin" },
      ],
      profiles: [
        { user_id: SUPER_ADMIN, access_status: "active" },
        { user_id: PLATFORM_ADMIN, access_status: "active" },
        { user_id: PLATFORM_ADMIN_2, access_status: "active" },
        { user_id: NORMAL_USER, access_status: "active" },
      ],
      rpcError: new Error("rpc unavailable"),
    });
    const app = mountAdminApp(supabase);
    const res = await requestOverview(app, "admin");

    assert.equal(res.status, 200);
    assert.equal(res.body.total_users, 4);
    assert.equal(res.body.active_users, 4);
    assert.equal(res.body.platform_admins, 3);
    assert.equal("governance_enforce_mode" in res.body, false);
    assert.equal("audit_events_24h" in res.body, false);
  });

  it("fallback counts admin and super_admin distinctly without double-count", async () => {
    const supabase = makeOverviewSupabase({
      userRoles: [
        { user_id: SUPER_ADMIN, role: "super_admin" },
        { user_id: SUPER_ADMIN, role: "admin" },
        { user_id: PLATFORM_ADMIN, role: "admin" },
      ],
      profiles: [
        { user_id: SUPER_ADMIN, access_status: "active" },
        { user_id: PLATFORM_ADMIN, access_status: "active" },
        { user_id: NORMAL_USER, access_status: "active" },
      ],
      rpcError: new Error("Not authorized"),
    });
    const app = mountAdminApp(supabase);
    const res = await requestOverview(app, "super");

    assert.equal(res.status, 200);
    assert.equal(res.body.platform_admins, 2);
  });
});
