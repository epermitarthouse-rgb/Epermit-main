"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const http = require("node:http");

const {
  adminCreateUser,
  validateEmail,
  validateTemporaryPassword,
} = require("../app/services/governance/admin-create-user.service.js");
const { sanitizeAuditJson } = require("../app/services/governance/governance.service.js");
const { createRequirePlatformAdmin } = require("../app/services/governance/require-platform-admin.js");
const { createAdminRouter } = require("../app/routes/admin.routes.js");

const USER_ADMIN = "44444444-4444-4444-4444-444444444444";
const USER_DEACTIVATED = "22222222-2222-2222-2222-222222222222";
const USER_NON_ADMIN = "33333333-3333-3333-3333-333333333333";
const NEW_USER = "99999999-9999-9999-9999-999999999999";
const PROJECT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

/**
 * @param {object} [opts]
 */
function makeSupabase(opts = {}) {
  const profiles = opts.profiles || [];
  const projects = opts.projects || [{ id: PROJECT_A }];
  const teamMembers = opts.teamMembers || [];
  /** @type {Array<Record<string, unknown>>} */
  const auditEvents = opts.auditEvents || [];

  let createUserImpl = opts.createUserImpl;
  let deleteUserCalls = 0;

  if (!createUserImpl) {
    createUserImpl = async ({ email }) => ({
      data: { user: { id: NEW_USER, email } },
      error: null,
    });
  }

  return {
    auth: {
      getUser: async (token) => {
        const map = {
          admin: { data: { user: { id: USER_ADMIN, email: "admin@test" } }, error: null },
          deactivated: {
            data: { user: { id: USER_DEACTIVATED, email: "deact@test" } },
            error: null,
          },
          user: { data: { user: { id: USER_NON_ADMIN, email: "user@test" } }, error: null },
        };
        return map[token] || { data: { user: null }, error: new Error("invalid") };
      },
      admin: {
        createUser: async (payload) => createUserImpl(payload),
        deleteUser: async () => {
          deleteUserCalls += 1;
          return { error: null };
        },
      },
    },
    from(table) {
      const rows =
        table === "profiles"
          ? profiles
          : table === "projects"
            ? projects
            : table === "project_team_members"
              ? teamMembers
              : table === "platform_audit_events"
                ? auditEvents
                : table === "user_roles"
                  ? [{ user_id: USER_ADMIN, role: "admin" }]
                  : [];

      const chain = {
        _filters: {},
        _upsert: null,
        _insert: null,
        select() {
          return chain;
        },
        upsert(payload) {
          chain._upsert = payload;
          if (table === "profiles") {
            profiles.push({ ...payload });
          }
          if (table === "project_team_members") {
            teamMembers.push({ ...payload });
          }
          return chain;
        },
        insert(payload) {
          chain._insert = payload;
          if (table === "platform_audit_events") {
            auditEvents.push(payload);
          }
          return chain;
        },
        update() {
          return chain;
        },
        eq(col, val) {
          chain._filters[col] = val;
          return chain;
        },
        maybeSingle: async () => {
          const match = rows.find((r) =>
            Object.entries(chain._filters).every(([k, v]) => r[k] === v || r.id === v),
          );
          return { data: match ?? null, error: null };
        },
        then(resolve) {
          return Promise.resolve(resolve({ data: rows, error: null }));
        },
      };
      return chain;
    },
    async rpc(name, args) {
      if (name === "is_user_active") {
        const active = args?.p_user_id !== USER_DEACTIVATED;
        return { data: active, error: null };
      }
      if (name === "has_role") {
        const isAdmin = args?._user_id === USER_ADMIN && args?._role === "admin";
        return { data: isAdmin, error: null };
      }
      if (name === "admin_append_audit_event") {
        auditEvents.push({ action: "via_rpc" });
        return { data: "audit-id", error: null };
      }
      return { data: null, error: new Error(`unknown rpc ${name}`) };
    },
    get deleteUserCalls() {
      return deleteUserCalls;
    },
  };
}

describe("admin create user validation", () => {
  it("validates email and temporary password", () => {
    assert.equal(validateEmail("bad").ok, false);
    assert.equal(validateEmail("user@example.com").ok, true);
    assert.equal(validateTemporaryPassword("short").ok, false);
    assert.equal(validateTemporaryPassword("longenough").ok, true);
  });

  it("strips password fields from audit json", () => {
    const sanitized = sanitizeAuditJson({
      email: "user@example.com",
      temporary_password: "secret123",
      nested: { password: "hidden" },
    });
    assert.equal(sanitized.email, "user@example.com");
    assert.equal(sanitized.temporary_password, undefined);
    assert.equal(sanitized.nested.password, undefined);
  });
});

describe("adminCreateUser service", () => {
  it("creates auth user, profile flags, and audit without returning password", async () => {
    const supabase = makeSupabase();
    const result = await adminCreateUser(supabase, {
      actorId: USER_ADMIN,
      email: "new@example.com",
      temporaryPassword: "TempPass123",
      fullName: "New User",
      companyName: "Acme",
      jobTitle: "PM",
    });

    assert.equal(result.ok, true);
    assert.equal(result.user_id, NEW_USER);
    assert.equal(result.must_change_password, true);
    assert.equal(result.created_by_admin, true);
    assert.equal(result.email, "new@example.com");
    assert.equal("temporary_password" in result, false);
    assert.equal("password" in result, false);
  });

  it("rejects duplicate email", async () => {
    const supabase = makeSupabase({
      createUserImpl: async () => ({
        data: { user: null },
        error: new Error("User already registered"),
      }),
    });

    await assert.rejects(
      () =>
        adminCreateUser(supabase, {
          actorId: USER_ADMIN,
          email: "dup@example.com",
          temporaryPassword: "TempPass123",
          fullName: "Dup User",
        }),
      (err) => {
        assert.equal(err.statusCode, 409);
        return true;
      },
    );
  });

  it("rolls back auth user when profile setup fails", async () => {
    const supabase = makeSupabase();
    const originalFrom = supabase.from.bind(supabase);
    supabase.from = (table) => {
      const chain = originalFrom(table);
      if (table === "profiles") {
        const originalUpsert = chain.upsert.bind(chain);
        chain.upsert = () => {
          originalUpsert({});
          chain.then = (resolve) =>
            Promise.resolve(resolve({ data: null, error: new Error("profile fail") }));
          return chain;
        };
      }
      return chain;
    };

    await assert.rejects(
      () =>
        adminCreateUser(supabase, {
          actorId: USER_ADMIN,
          email: "fail@example.com",
          temporaryPassword: "TempPass123",
          fullName: "Fail User",
        }),
      /Profile setup failed/,
    );
    assert.equal(supabase.deleteUserCalls, 1);
  });

  it("creates initial project membership and audits it", async () => {
    const supabase = makeSupabase();
    const result = await adminCreateUser(supabase, {
      actorId: USER_ADMIN,
      email: "team@example.com",
      temporaryPassword: "TempPass123",
      fullName: "Team User",
      projectId: PROJECT_A,
      projectRole: "editor",
    });

    assert.equal(result.initial_project_id, PROJECT_A);
    assert.equal(result.initial_project_role, "editor");
  });
});

describe("POST /api/admin/v1/access/users route", () => {
  /** @type {http.Server | null} */
  let server = null;
  /** @type {number | null} */
  let port = null;

  beforeEach(async () => {
    const app = express();
    app.use(express.json());
    const supabase = makeSupabase({
      profiles: [
        { user_id: USER_ADMIN, access_status: "active" },
        { user_id: USER_DEACTIVATED, access_status: "deactivated" },
        { user_id: USER_NON_ADMIN, access_status: "active" },
      ],
    });
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

  async function postCreate(token, body) {
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/v1/access/users`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    return { status: res.status, json };
  }

  it("allows platform admin to create user", async () => {
    const { status, json } = await postCreate("admin", {
      email: "created@example.com",
      temporary_password: "TempPass123",
      full_name: "Created User",
    });
    assert.equal(status, 201);
    assert.equal(json.ok, true);
    assert.equal(json.must_change_password, true);
    assert.equal(json.temporary_password, undefined);
  });

  it("rejects non-admin", async () => {
    const { status } = await postCreate("user", {
      email: "x@example.com",
      temporary_password: "TempPass123",
      full_name: "X",
    });
    assert.equal(status, 403);
  });

  it("rejects deactivated admin", async () => {
    const { status } = await postCreate("deactivated", {
      email: "x@example.com",
      temporary_password: "TempPass123",
      full_name: "X",
    });
    assert.equal(status, 403);
  });
});
