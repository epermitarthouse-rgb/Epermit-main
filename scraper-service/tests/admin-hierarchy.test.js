"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const http = require("node:http");

const { createAdminRouter } = require("../app/routes/admin.routes.js");
const { createRequirePlatformAdmin } = require("../app/services/governance/require-platform-admin.js");
const {
  assertCanManageUserLifecycle,
  assertSuperAdminActor,
  resolvePrimaryPlatformRole,
  attachPlatformRoleFields,
} = require("../app/services/governance/admin-role.service.js");
const { isPlatformAdmin, isSuperAdmin } = require("../app/services/governance/governance.service.js");

const SUPER_ADMIN = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SUPER_ADMIN_2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const PLATFORM_ADMIN = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const PLATFORM_ADMIN_2 = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const NORMAL_USER = "dddddddd-dddd-dddd-dddd-dddddddddddd";

/**
 * Mutable supabase stub for admin hierarchy route tests.
 * @param {object} [opts]
 */
function makeHierarchySupabase(opts = {}) {
  /** @type {Array<{ user_id: string, role: string }>} */
  let userRoles = [...(opts.userRoles || [])];
  const profiles = opts.profiles || [
    { user_id: SUPER_ADMIN, access_status: "active" },
    { user_id: SUPER_ADMIN_2, access_status: "active" },
    { user_id: PLATFORM_ADMIN, access_status: "active" },
    { user_id: PLATFORM_ADMIN_2, access_status: "active" },
    { user_id: NORMAL_USER, access_status: "active" },
  ];
  /** @type {Array<Record<string, unknown>>} */
  const auditEvents = [];

  const authUsers = {
    super: { id: SUPER_ADMIN, email: "super@test" },
    super2: { id: SUPER_ADMIN_2, email: "super2@test" },
    admin: { id: PLATFORM_ADMIN, email: "admin@test" },
    user: { id: NORMAL_USER, email: "user@test" },
  };

  return {
    userRoles,
    auditEvents,
    auth: {
      getUser: async (token) => {
        const map = {
          super: { data: { user: authUsers.super }, error: null },
          super2: { data: { user: authUsers.super2 }, error: null },
          admin: { data: { user: authUsers.admin }, error: null },
          user: { data: { user: authUsers.user }, error: null },
        };
        return map[token] || { data: { user: null }, error: new Error("invalid") };
      },
      admin: { updateUserById: async () => ({ error: null }) },
    },
    async rpc(name, args) {
      if (name === "has_role") {
        const match = userRoles.some(
          (row) =>
            row.user_id === args._user_id && row.role === args._role,
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
      if (name === "admin_activate_user" || name === "admin_deactivate_user") {
        return { data: { ok: true }, error: null };
      }
      if (name === "admin_append_audit_event") {
        auditEvents.push(args);
        return { data: "audit-id", error: null };
      }
      return { data: null, error: new Error(`unknown rpc ${name}`) };
    },
    from(table) {
      const chain = {
        _filters: {},
        _deleteRole: null,
        _deleteRequested: false,
        _upsert: null,
        _countHead: false,
        select(_cols, opts) {
          if (opts?.head) {
            chain._countHead = true;
          }
          return chain;
        },
        insert(payload) {
          if (table === "platform_audit_events") {
            auditEvents.push(payload);
            return Promise.resolve({ data: { id: "audit-1" }, error: null });
          }
          return chain;
        },
        upsert(payload) {
          chain._upsert = payload;
          if (table === "user_roles") {
            const exists = userRoles.some(
              (row) =>
                row.user_id === payload.user_id && row.role === payload.role,
            );
            if (!exists) {
              userRoles.push({
                user_id: payload.user_id,
                role: payload.role,
              });
            }
          }
          return Promise.resolve({ data: payload, error: null });
        },
        delete() {
          chain._deleteRequested = true;
          return chain;
        },
        eq(col, val) {
          chain._filters[col] = val;
          if (chain._deleteRequested && col === "role" && table === "user_roles") {
            chain._deleteRole = val;
          }
          return chain;
        },
        in(col, vals) {
          chain._inFilters = chain._inFilters || {};
          chain._inFilters[col] = vals;
          return chain;
        },
        limit() {
          return chain;
        },
        maybeSingle: async () => {
          const rows = getFilteredRows(
            table,
            chain._filters,
            profiles,
            userRoles,
            chain._inFilters,
          );
          return { data: rows[0] ?? null, error: null };
        },
        then(resolve) {
          if (chain._countHead && table === "user_roles") {
            let rows = getFilteredRows(
              table,
              chain._filters,
              profiles,
              userRoles,
              chain._inFilters,
            );
            return resolve({ count: rows.length, error: null });
          }

          if (chain._deleteRequested && chain._deleteRole && table === "user_roles") {
            userRoles = userRoles.filter(
              (row) =>
                !(
                  row.user_id === chain._filters.user_id &&
                  row.role === chain._deleteRole
                ),
            );
            return resolve({ data: null, error: null });
          }

          const rows = getFilteredRows(
            table,
            chain._filters,
            profiles,
            userRoles,
            chain._inFilters,
          );
          return resolve({ data: rows, error: null });
        },
      };
      return chain;
    },
  };
}

/**
 * @param {string} table
 * @param {Record<string, unknown>} filters
 * @param {Array<{ user_id: string, access_status: string }>} profiles
 * @param {Array<{ user_id: string, role: string }>} userRoles
 */
function getFilteredRows(table, filters, profiles, userRoles, inFilters = {}) {
  const rows =
    table === "profiles"
      ? profiles
      : table === "user_roles"
        ? userRoles
        : [];

  return rows.filter((row) => {
    const eqOk = Object.entries(filters).every(([key, val]) => row[key] === val);
    const inOk = Object.entries(inFilters).every(([key, val]) =>
      /** @type {string[]} */ (val).includes(row[key]),
    );
    return eqOk && inOk;
  });
}

/**
 * @param {ReturnType<typeof makeHierarchySupabase>} supabase
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
function requestAdmin(app, method, path, token, body) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const { port } = server.address();
      try {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: body != null ? JSON.stringify(body) : undefined,
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

describe("admin role hierarchy helpers", () => {
  it("resolvePrimaryPlatformRole prefers super_admin", () => {
    assert.equal(resolvePrimaryPlatformRole(["user", "admin", "super_admin"]), "super_admin");
    assert.equal(resolvePrimaryPlatformRole(["admin"]), "admin");
    assert.equal(resolvePrimaryPlatformRole([]), "user");
  });

  it("attachPlatformRoleFields prefers super_admin when both admin rows exist", () => {
    const payload = attachPlatformRoleFields({
      platform_admin: true,
      platform_role: "admin",
      platform_roles: ["admin", "super_admin"],
    });
    assert.equal(payload.platform_role, "super_admin");
    assert.equal(payload.super_admin, true);
    assert.equal(payload.platform_admin, true);
    assert.deepEqual(payload.platform_roles, ["admin", "super_admin"]);
  });

  it("platform admin cannot manage another admin", () => {
    const result = assertCanManageUserLifecycle({
      actorRole: "admin",
      targetRole: "admin",
      actorId: PLATFORM_ADMIN,
      targetId: SUPER_ADMIN,
    });
    assert.equal(result.allowed, false);
    assert.equal(result.code, "ADMIN_HIERARCHY_DENIED");
  });

  it("blocks self lifecycle actions", () => {
    const result = assertCanManageUserLifecycle({
      actorRole: "super_admin",
      targetRole: "super_admin",
      actorId: SUPER_ADMIN,
      targetId: SUPER_ADMIN,
    });
    assert.equal(result.allowed, false);
    assert.equal(result.code, "SELF_ACTION_BLOCKED");
  });

  it("requires super admin for role mutations", () => {
    const result = assertSuperAdminActor({ actorRole: "admin" });
    assert.equal(result.allowed, false);
    assert.equal(result.code, "SUPER_ADMIN_REQUIRED");
  });
});

describe("admin hierarchy API", () => {
  /** @type {ReturnType<typeof makeHierarchySupabase>} */
  let supabase;

  beforeEach(() => {
    supabase = makeHierarchySupabase({
      userRoles: [
        { user_id: SUPER_ADMIN, role: "super_admin" },
        { user_id: SUPER_ADMIN_2, role: "super_admin" },
        { user_id: PLATFORM_ADMIN, role: "admin" },
      ],
    });
  });

  it("A: super admin grants platform admin to normal user", async () => {
    const app = mountAdminApp(supabase);
    const res = await requestAdmin(
      app,
      "POST",
      `/api/admin/v1/access/users/${NORMAL_USER}/platform-role`,
      "super",
      { action: "promote-to-admin" },
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.platform_role, "admin");
    assert.ok(
      supabase.userRoles.some(
        (row) => row.user_id === NORMAL_USER && row.role === "admin",
      ),
    );
  });

  it("B: super admin promotes platform admin to super admin", async () => {
    const app = mountAdminApp(supabase);
    const res = await requestAdmin(
      app,
      "POST",
      `/api/admin/v1/access/users/${PLATFORM_ADMIN}/platform-role`,
      "super",
      { action: "promote-to-super-admin" },
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.platform_role, "super_admin");
  });

  it("C: super admin demotes super admin when another remains", async () => {
    const app = mountAdminApp(supabase);
    const res = await requestAdmin(
      app,
      "POST",
      `/api/admin/v1/access/users/${SUPER_ADMIN_2}/platform-role`,
      "super",
      { action: "demote-super-admin" },
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.super_admin, false);
  });

  it("D: last super admin cannot demote self", async () => {
    supabase = makeHierarchySupabase({
      userRoles: [{ user_id: SUPER_ADMIN, role: "super_admin" }],
    });
    const app = mountAdminApp(supabase);
    const res = await requestAdmin(
      app,
      "POST",
      `/api/admin/v1/access/users/${SUPER_ADMIN}/platform-role`,
      "super",
      { action: "demote-super-admin" },
    );
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "SELF_ROLE_CHANGE_BLOCKED");
  });

  it("E: platform admin can deactivate normal user", async () => {
    const app = mountAdminApp(supabase);
    const res = await requestAdmin(
      app,
      "POST",
      `/api/admin/v1/access/users/${NORMAL_USER}/deactivate`,
      "admin",
      { reason: "test" },
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.access_status, "deactivated");
  });

  it("F: platform admin cannot deactivate another platform admin", async () => {
    supabase.userRoles.push({ user_id: PLATFORM_ADMIN_2, role: "admin" });
    const app = mountAdminApp(supabase);
    const res = await requestAdmin(
      app,
      "POST",
      `/api/admin/v1/access/users/${PLATFORM_ADMIN_2}/deactivate`,
      "admin",
      { reason: "test" },
    );
    assert.equal(res.status, 403);
    assert.equal(res.body.error, "ADMIN_HIERARCHY_DENIED");
  });

  it("F2: platform admin cannot revoke platform admin role", async () => {
    supabase.userRoles.push({ user_id: PLATFORM_ADMIN_2, role: "admin" });
    const app = mountAdminApp(supabase);
    const res = await requestAdmin(
      app,
      "POST",
      `/api/admin/v1/access/users/${PLATFORM_ADMIN_2}/platform-role`,
      "admin",
      { action: "revoke-admin" },
    );
    assert.equal(res.status, 403);
    assert.equal(res.body.error, "SUPER_ADMIN_REQUIRED");
  });

  it("G: platform admin cannot demote super admin", async () => {
    const app = mountAdminApp(supabase);
    const res = await requestAdmin(
      app,
      "POST",
      `/api/admin/v1/access/users/${SUPER_ADMIN}/platform-role`,
      "admin",
      { action: "demote-super-admin" },
    );
    assert.equal(res.status, 403);
    assert.equal(res.body.error, "SUPER_ADMIN_REQUIRED");
  });

  it("H: normal user denied admin routes", async () => {
    const app = mountAdminApp(supabase);
    const res = await requestAdmin(
      app,
      "GET",
      "/api/admin/v1/access/users",
      "user",
    );
    assert.equal(res.status, 403);
    assert.equal(res.body.error, "PLATFORM_ADMIN_REQUIRED");
  });

  it("I: super admin cannot change own role", async () => {
    const app = mountAdminApp(supabase);
    const res = await requestAdmin(
      app,
      "POST",
      `/api/admin/v1/access/users/${SUPER_ADMIN}/platform-role`,
      "super",
      { action: "demote-super-admin" },
    );
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "SELF_ROLE_CHANGE_BLOCKED");
  });

  it("J: super_admin and admin both access admin dashboard middleware", async () => {
    const adminSupabase = makeHierarchySupabase({
      userRoles: [{ user_id: PLATFORM_ADMIN, role: "admin" }],
    });
    const superSupabase = makeHierarchySupabase({
      userRoles: [{ user_id: SUPER_ADMIN, role: "super_admin" }],
    });

    assert.equal(await isPlatformAdmin(adminSupabase, PLATFORM_ADMIN), true);
    assert.equal(await isSuperAdmin(adminSupabase, PLATFORM_ADMIN), false);
    assert.equal(await isPlatformAdmin(superSupabase, SUPER_ADMIN), true);
    assert.equal(await isSuperAdmin(superSupabase, SUPER_ADMIN), true);

    const middleware = createRequirePlatformAdmin({ supabase: superSupabase });
    const out = await new Promise((resolve) => {
      middleware(
        { headers: { authorization: "Bearer super" } },
        {
          status(code) {
            this.statusCode = code;
            return this;
          },
          json(payload) {
            resolve({ statusCode: this.statusCode, body: payload });
            return this;
          },
        },
        () => resolve({ statusCode: 200, passed: true }),
      );
    });
    assert.equal(/** @type {{ passed?: boolean }} */ (out).passed, true);
  });
});
