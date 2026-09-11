"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const http = require("node:http");

const {
  resolveRoleDefaultFeatureAccess,
  resolveActiveUserDefaultFeatureAccess,
  combineFeatureAccessLevels,
  EDITOR_WRITE_FEATURES,
  FEATURE_KEYS,
} = require("../app/services/governance/governance.constants.js");
const {
  getEnforceMode,
  enforceModeFromEnv,
  assertFeatureAccess,
  assertCredentialGrant,
  resolveGlobalFeatureAccess,
  resolveFeatureAccess,
  computeEffectivePermissions,
  sanitizeAuditJson,
} = require("../app/services/governance/governance.service.js");
const {
  fetchEmailsForUserIds,
  fetchEmailForUserId,
  findUserIdsByEmailSearch,
} = require("../app/services/governance/admin-auth-emails.service.js");
const { createRequirePlatformAdmin } = require("../app/services/governance/require-platform-admin.js");
const { requireAuthenticatedUser } = require("../app/services/uci/uci-access.service.js");

const USER_ACTIVE = "11111111-1111-1111-1111-111111111111";
const USER_DEACTIVATED = "22222222-2222-2222-2222-222222222222";
const USER_NON_ADMIN = "33333333-3333-3333-3333-333333333333";
const USER_VIEWER = "55555555-5555-5555-5555-555555555555";
const USER_ADMIN = "44444444-4444-4444-4444-444444444444";
const PROJECT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CREDENTIAL_A = "cccccccc-cccc-cccc-cccc-cccccccccccc";

/**
 * @param {object} [opts]
 */
function makeSupabase(opts = {}) {
  const profiles = opts.profiles || [
    { user_id: USER_ACTIVE, access_status: "active" },
    { user_id: USER_DEACTIVATED, access_status: "deactivated" },
    { user_id: USER_NON_ADMIN, access_status: "active" },
    { user_id: USER_ADMIN, access_status: "active" },
  ];

  const userRoles = opts.userRoles || [{ user_id: USER_ADMIN, role: "admin" }];

  const grants = opts.grants || [
    {
      user_id: USER_NON_ADMIN,
      credential_id: CREDENTIAL_A,
      grant_level: "manage",
      project_id: null,
      jurisdiction: null,
    },
  ];

  const governanceConfig = opts.governanceConfig || [{ enforce_mode: "legacy" }];
  const featurePermissions = opts.featurePermissions || [];

  return {
    auth: {
      getUser: async (token) => {
        const map = {
          active: {
            data: { user: { id: USER_ACTIVE, email: "active@test" } },
            error: null,
          },
          deactivated: {
            data: { user: { id: USER_DEACTIVATED, email: "deact@test" } },
            error: null,
          },
          user: {
            data: { user: { id: USER_NON_ADMIN, email: "user@test" } },
            error: null,
          },
          admin: {
            data: { user: { id: USER_ADMIN, email: "admin@test" } },
            error: null,
          },
        };
        return (
          map[token] || {
            data: { user: null },
            error: new Error("invalid"),
          }
        );
      },
      admin: {
        updateUserById: async () => ({ error: null }),
      },
    },
    from(table) {
      const rows =
        table === "profiles"
          ? profiles
          : table === "user_roles"
            ? userRoles
            : table === "user_portal_credential_grants"
              ? grants
              : table === "governance_config"
                ? governanceConfig
                : table === "projects"
                  ? [{ id: PROJECT_A, user_id: "00000000-0000-0000-0000-000000000099" }]
                  : table === "project_team_members"
                    ? [
                        {
                          project_id: PROJECT_A,
                          user_id: USER_VIEWER,
                          role: "viewer",
                        },
                      ]
                    : table === "user_feature_permissions"
                      ? featurePermissions
                      : table === "user_project_access_overrides"
                        ? opts.projectAccessOverrides || []
                        : table === "portal_credentials"
                          ? opts.portalCredentials || [
                              {
                                id: CREDENTIAL_A,
                                jurisdiction: "Test Jurisdiction",
                                portal_username: "test@example.com",
                              },
                            ]
                          : table === "user_scraped_data_scope"
                            ? []
                            : table === "platform_audit_events"
                              ? []
                              : [];

      const chain = {
        _filters: {},
        _single: false,
        _limit: null,
        select() {
          return chain;
        },
        insert(payload) {
          chain._insert = payload;
          return chain;
        },
        upsert(payload) {
          chain._upsert = payload;
          return chain;
        },
        update() {
          return chain;
        },
        delete() {
          return chain;
        },
        eq(col, val) {
          chain._filters[col] = val;
          return chain;
        },
        is(col, val) {
          chain._is = { col, val };
          return chain;
        },
        neq(col, val) {
          chain._neq = { col, val };
          return chain;
        },
        in() {
          return chain;
        },
        or() {
          return chain;
        },
        order() {
          return chain;
        },
        range() {
          return chain;
        },
        limit(n) {
          chain._limit = n;
          return chain;
        },
        maybeSingle: async () => {
          const match = rows.find((r) => {
            const filtersOk = Object.entries(chain._filters).every(([k, v]) => r[k] === v);
            const isOk = chain._is
              ? (chain._is.val == null ? r[chain._is.col] == null : r[chain._is.col] === chain._is.val)
              : true;
            return filtersOk && isOk;
          });
          return { data: match ?? null, error: null };
        },
        single: async () => {
          const match = rows.find((r) => {
            const filtersOk = Object.entries(chain._filters).every(([k, v]) => r[k] === v);
            const isOk = chain._is
              ? (chain._is.val == null ? r[chain._is.col] == null : r[chain._is.col] === chain._is.val)
              : true;
            return filtersOk && isOk;
          });
          return { data: match ?? null, error: match ? null : new Error("not found") };
        },
        then(resolve) {
          let filtered = rows.filter((r) => {
            const filtersOk = Object.entries(chain._filters).every(([k, v]) => r[k] === v);
            const isOk = chain._is
              ? (chain._is.val == null ? r[chain._is.col] == null : r[chain._is.col] === chain._is.val)
              : true;
            return filtersOk && isOk;
          });
          if (chain._neq) {
            filtered = filtered.filter(
              (r) => r[chain._neq.col] !== chain._neq.val,
            );
          }
          if (chain._limit != null) {
            filtered = filtered.slice(0, chain._limit);
          }
          return Promise.resolve(resolve({ data: filtered, error: null, count: filtered.length }));
        },
      };
      return chain;
    },
    async rpc(name, args) {
      if (name === "is_user_active") {
        const profile = profiles.find((p) => p.user_id === args.p_user_id);
        return {
          data: profile ? profile.access_status === "active" : true,
          error: null,
        };
      }
      if (name === "has_role") {
        const isAdmin = userRoles.some(
          (r) => r.user_id === args._user_id && r.role === args._role,
        );
        return { data: isAdmin, error: null };
      }
      if (name === "has_project_access") {
        return {
          data:
            args._user_id === USER_NON_ADMIN ||
            args._user_id === USER_VIEWER ||
            args._user_id === USER_ADMIN,
          error: null,
        };
      }
      return { data: null, error: new Error(`unknown rpc ${name}`) };
    },
  };
}

describe("governance constants", () => {
  it("defines expected feature keys and editor write subset", () => {
    assert.ok(FEATURE_KEYS.includes("scraper.run"));
    assert.ok(FEATURE_KEYS.includes("credentials.self"));
    assert.equal(EDITOR_WRITE_FEATURES.includes("scraper.run"), true);
    assert.equal(EDITOR_WRITE_FEATURES.includes("billing.quickbooks"), false);
  });

  it("resolves role defaults per matrix", () => {
    assert.equal(resolveRoleDefaultFeatureAccess("owner", "billing.quickbooks"), "write");
    assert.equal(resolveRoleDefaultFeatureAccess("viewer", "scraper.run"), "read");
    assert.equal(resolveRoleDefaultFeatureAccess("editor", "scraper.run"), "write");
    assert.equal(resolveRoleDefaultFeatureAccess("editor", "billing.quickbooks"), "read");
    assert.equal(resolveRoleDefaultFeatureAccess("none", "scraper.run"), "none");
  });
});

describe("governance enforce modes", () => {
  const originalEnv = process.env.GOVERNANCE_ENFORCE;

  afterEach(() => {
    if (originalEnv == null) {
      delete process.env.GOVERNANCE_ENFORCE;
    } else {
      process.env.GOVERNANCE_ENFORCE = originalEnv;
    }
  });

  it("maps env override before DB config", async () => {
    process.env.GOVERNANCE_ENFORCE = "enforce";
    assert.equal(enforceModeFromEnv(), "enforce");

    const supabase = makeSupabase({
      governanceConfig: [{ enforce_mode: "legacy" }],
    });
    assert.equal(await getEnforceMode(supabase), "enforce");
  });

  it("falls back to governance_config when env unset", async () => {
    delete process.env.GOVERNANCE_ENFORCE;
    const supabase = makeSupabase({
      governanceConfig: [{ enforce_mode: "shadow" }],
    });
    assert.equal(await getEnforceMode(supabase), "shadow");
  });

  it("legacy mode allows denied feature access", async () => {
    delete process.env.GOVERNANCE_ENFORCE;
    const supabase = makeSupabase({
      governanceConfig: [{ enforce_mode: "legacy" }],
      profiles: [{ user_id: USER_NON_ADMIN, access_status: "active" }],
      userRoles: [],
    });

    await assertFeatureAccess({
      supabase,
      userId: USER_NON_ADMIN,
      projectId: PROJECT_A,
      featureKey: "billing.quickbooks",
      requiredLevel: "write",
    });
  });

  it("enforce mode rejects insufficient feature access", async () => {
    process.env.GOVERNANCE_ENFORCE = "enforce";
    const supabase = makeSupabase({
      governanceConfig: [{ enforce_mode: "legacy" }],
    });

    await assert.rejects(
      () =>
        assertFeatureAccess({
          supabase,
          userId: USER_VIEWER,
          projectId: PROJECT_A,
          featureKey: "billing.quickbooks",
          requiredLevel: "write",
        }),
      (err) => {
        assert.equal(/** @type {Error & { code?: string }} */ (err).code, "FEATURE_ACCESS_DENIED");
        return true;
      },
    );
  });

  it("active users receive write global defaults for all standard features", async () => {
    const supabase = makeSupabase({
      featurePermissions: [],
      profiles: [{ user_id: USER_NON_ADMIN, access_status: "active" }],
      userRoles: [],
    });

    for (const featureKey of FEATURE_KEYS) {
      assert.equal(
        resolveActiveUserDefaultFeatureAccess(featureKey),
        "write",
        featureKey,
      );
      assert.equal(
        await resolveGlobalFeatureAccess(supabase, USER_NON_ADMIN, featureKey),
        "write",
        featureKey,
      );
    }

    assert.equal(combineFeatureAccessLevels("write", "read"), "read");
  });

  it("viewer project role caps global write inside assigned projects", async () => {
    const supabase = makeSupabase({ featurePermissions: [] });

    const globalLevel = await resolveGlobalFeatureAccess(
      supabase,
      USER_VIEWER,
      "code.analyzer",
    );
    assert.equal(globalLevel, "write");

    const projectLevel = await resolveFeatureAccess(
      supabase,
      USER_VIEWER,
      PROJECT_A,
      "code.analyzer",
    );
    assert.equal(projectLevel, "read");
  });

  it("global feature override takes precedence over per-project override", async () => {
    process.env.GOVERNANCE_ENFORCE = "shadow";
    const supabase = makeSupabase({
      featurePermissions: [
        {
          user_id: USER_VIEWER,
          project_id: null,
          feature_key: "billing.quickbooks",
          access_level: "none",
        },
        {
          user_id: USER_VIEWER,
          project_id: PROJECT_A,
          feature_key: "billing.quickbooks",
          access_level: "write",
        },
      ],
    });

    const level = await resolveFeatureAccess(
      supabase,
      USER_VIEWER,
      PROJECT_A,
      "billing.quickbooks",
    );
    assert.equal(level, "none");
  });

  it("shadow mode allows but resolveFeatureAccess still computes level", async () => {
    process.env.GOVERNANCE_ENFORCE = "shadow";
    const supabase = makeSupabase();

    const level = await resolveFeatureAccess(
      supabase,
      USER_VIEWER,
      PROJECT_A,
      "billing.quickbooks",
    );
    assert.equal(level, "read");

    await assertFeatureAccess({
      supabase,
      userId: USER_VIEWER,
      projectId: PROJECT_A,
      featureKey: "billing.quickbooks",
      requiredLevel: "write",
    });
  });
});

describe("credential grant-only access", () => {
  const originalEnv = process.env.GOVERNANCE_ENFORCE;

  afterEach(() => {
    if (originalEnv == null) {
      delete process.env.GOVERNANCE_ENFORCE;
    } else {
      process.env.GOVERNANCE_ENFORCE = originalEnv;
    }
  });

  it("allows manage grant holder", async () => {
    process.env.GOVERNANCE_ENFORCE = "enforce";
    const supabase = makeSupabase();

    await assertCredentialGrant({
      supabase,
      userId: USER_NON_ADMIN,
      credentialId: CREDENTIAL_A,
      requiredLevel: "manage",
    });
  });

  it("allows default use when no grant row in enforce mode", async () => {
    process.env.GOVERNANCE_ENFORCE = "enforce";
    const supabase = makeSupabase({ grants: [] });

    await assertCredentialGrant({
      supabase,
      userId: USER_NON_ADMIN,
      credentialId: CREDENTIAL_A,
      requiredLevel: "use",
    });
  });

  it("denies when explicit none override is set", async () => {
    process.env.GOVERNANCE_ENFORCE = "enforce";
    const supabase = makeSupabase({
      grants: [
        {
          user_id: USER_NON_ADMIN,
          credential_id: CREDENTIAL_A,
          grant_level: "none",
          project_id: null,
          jurisdiction: null,
        },
      ],
    });

    await assert.rejects(
      () =>
        assertCredentialGrant({
          supabase,
          userId: USER_NON_ADMIN,
          credentialId: CREDENTIAL_A,
          requiredLevel: "use",
        }),
      (err) => {
        assert.equal(/** @type {Error & { code?: string }} */ (err).code, "CREDENTIAL_GRANT_DENIED");
        return true;
      },
    );
  });
});

describe("requirePlatformAdmin middleware", () => {
  /**
   * @param {import("express").RequestHandler} middleware
   * @param {string} token
   */
  function invokeMiddleware(middleware, token) {
    return new Promise((resolve) => {
      const req = {
        headers: { authorization: `Bearer ${token}` },
      };
      const res = {
        statusCode: 200,
        body: null,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(payload) {
          this.body = payload;
          resolve(this);
          return this;
        },
      };
      middleware(req, res, () => {
        resolve({ statusCode: 200, body: { ok: true }, passed: true });
      });
    });
  }

  it("rejects deactivated admin", async () => {
    const supabase = makeSupabase({
      userRoles: [{ user_id: USER_DEACTIVATED, role: "admin" }],
    });
    const middleware = createRequirePlatformAdmin({ supabase });
    const out = await invokeMiddleware(middleware, "deactivated");
    assert.equal(out.statusCode, 403);
    assert.equal(out.body?.error, "USER_DEACTIVATED");
  });

  it("rejects non-admin authenticated user", async () => {
    const supabase = makeSupabase();
    const middleware = createRequirePlatformAdmin({ supabase });
    const out = await invokeMiddleware(middleware, "user");
    assert.equal(out.statusCode, 403);
    assert.equal(out.body?.error, "PLATFORM_ADMIN_REQUIRED");
  });

  it("allows platform admin", async () => {
    const supabase = makeSupabase();
    const middleware = createRequirePlatformAdmin({ supabase });
    const out = await invokeMiddleware(middleware, "admin");
    assert.equal(/** @type {{ passed?: boolean }} */ (out).passed, true);
  });
});

describe("requireAuthenticatedUser access_status gate", () => {
  it("rejects deactivated users", async () => {
    const supabase = makeSupabase();
    await assert.rejects(
      () =>
        requireAuthenticatedUser(
          { headers: { authorization: "Bearer deactivated" } },
          supabase,
        ),
      (err) => {
        assert.equal(/** @type {Error & { code?: string }} */ (err).code, "USER_DEACTIVATED");
        return true;
      },
    );
  });
});

describe("audit sanitization", () => {
  it("never retains password fields in audit json", () => {
    const sanitized = sanitizeAuditJson({
      portal_username: "user",
      portal_password: "secret",
      nested: { refresh_token: "abc", ok: true },
    });

    assert.deepEqual(sanitized, {
      portal_username: "user",
      nested: { ok: true },
    });
  });
});

/**
 * @param {object} [opts]
 */
function makeEffectivePermissionsSupabase(opts = {}) {
  const userId = opts.userId || USER_ADMIN;
  const projectCount = opts.projectCount ?? 2;
  const platformAdmin = opts.platformAdmin ?? true;

  const profiles = [
    {
      user_id: userId,
      access_status: opts.accessStatus || "active",
    },
  ];

  const userRoles = platformAdmin
    ? [{ user_id: userId, role: "admin" }]
    : [{ user_id: userId, role: "user" }];

  const projects = Array.from({ length: projectCount }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    name: `Project ${index}`,
    user_id: userId,
  }));

  const featurePermissions = opts.featurePermissions || [];
  const scrapedScopes = opts.scrapedScopes || [];
  const credentialGrants = opts.credentialGrants || [];
  const projectAccessOverrides = opts.projectAccessOverrides || [];
  const portalCredentials = opts.portalCredentials || [
    {
      id: CREDENTIAL_A,
      jurisdiction: "Test Jurisdiction",
      portal_username: "test@example.com",
    },
  ];

  return {
    from(table) {
      const rows =
        table === "profiles"
          ? profiles
          : table === "user_roles"
            ? userRoles
            : table === "projects"
              ? projects
              : table === "project_team_members"
                ? []
                : table === "user_feature_permissions"
                  ? featurePermissions
                  : table === "user_scraped_data_scope"
                    ? scrapedScopes
                    : table === "user_portal_credential_grants"
                      ? credentialGrants
                      : table === "user_project_access_overrides"
                        ? projectAccessOverrides
                        : table === "portal_credentials"
                          ? portalCredentials
                          : table === "user_access_reviews"
                            ? []
                            : [];

      const chain = {
        _filters: {},
        _single: false,
        select() {
          return chain;
        },
        eq(col, val) {
          chain._filters[col] = val;
          return chain;
        },
        order() {
          return chain;
        },
        maybeSingle: async () => {
          const match = rows.find((row) =>
            Object.entries(chain._filters).every(([k, v]) => row[k] === v),
          );
          return { data: match ?? null, error: null };
        },
        then(resolve) {
          let filtered = rows.filter((row) =>
            Object.entries(chain._filters).every(([k, v]) => row[k] === v),
          );
          return Promise.resolve(
            resolve({
              data: filtered,
              error: null,
              count: table === "user_roles" ? filtered.length : filtered.length,
            }),
          );
        },
      };
      return chain;
    },
    async rpc(name, args) {
      if (name === "admin_get_effective_permissions") {
        return { data: null, error: new Error("Not authorized") };
      }
      if (name === "is_user_active") {
        const profile = profiles.find((row) => row.user_id === args.p_user_id);
        return {
          data: profile ? profile.access_status === "active" : true,
          error: null,
        };
      }
      if (name === "has_role") {
        const isAdmin = userRoles.some(
          (row) => row.user_id === args._user_id && row.role === args._role,
        );
        return { data: isAdmin, error: null };
      }
      if (name === "_resolve_project_access_level") {
        return { data: "write", error: null };
      }
      if (name === "has_project_access") {
        return { data: true, error: null };
      }
      return { data: null, error: new Error(`unknown rpc ${name}`) };
    },
  };
}

/**
 * Minimal supabase stub for RPC-success paths that still enrich access views.
 * @param {object} rpcPayload
 */
function makeRpcEffectivePermissionsSupabase(rpcPayload) {
  const userId = String(rpcPayload.user_id || USER_VIEWER);
  const projectsList = Array.isArray(rpcPayload.projects) ? rpcPayload.projects : [];
  const allProjects = projectsList.map((project) => ({
    id: String(project.project_id),
    name: project.project_name ? String(project.project_name) : null,
    user_id: "00000000-0000-0000-0000-000000000099",
  }));
  const profiles = [
    {
      user_id: userId,
      access_status: rpcPayload.access_status || "active",
    },
  ];

  return {
    async rpc(name, args) {
      if (name === "admin_get_effective_permissions") {
        return { data: rpcPayload, error: null };
      }
      if (name === "_resolve_project_access_level") {
        return { data: "write", error: null };
      }
      if (name === "has_project_access") {
        return { data: true, error: null };
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
            ? []
            : table === "projects"
              ? allProjects
              : table === "portal_credentials"
                ? [
                    {
                      id: CREDENTIAL_A,
                      jurisdiction: "Test Jurisdiction",
                      portal_username: "test@example.com",
                    },
                  ]
                : table === "user_project_access_overrides"
                  ? []
                  : table === "project_team_members"
                    ? [
                        {
                          project_id: PROJECT_A,
                          user_id: userId,
                          role: "viewer",
                        },
                      ]
                    : [];

      const chain = {
        _filters: {},
        _limit: null,
        select() {
          return chain;
        },
        eq(col, val) {
          chain._filters[col] = val;
          return chain;
        },
        order() {
          return chain;
        },
        limit(n) {
          chain._limit = n;
          return chain;
        },
        maybeSingle: async () => {
          const match = rows.find((row) =>
            Object.entries(chain._filters).every(([k, v]) => row[k] === v),
          );
          return { data: match ?? null, error: null };
        },
        then(resolve) {
          let filtered = rows.filter((row) =>
            Object.entries(chain._filters).every(([k, v]) => row[k] === v),
          );
          if (chain._limit != null) {
            filtered = filtered.slice(0, chain._limit);
          }
          return Promise.resolve(resolve({ data: filtered, error: null }));
        },
      };
      return chain;
    },
  };
}

describe("computeEffectivePermissions", () => {
  it("returns RPC-compatible shape from batched fallback", async () => {
    const userId = USER_ADMIN;
    const supabase = makeEffectivePermissionsSupabase({
      userId,
      projectCount: 3,
      platformAdmin: true,
      credentialGrants: [
        {
          id: "grant-1",
          user_id: userId,
          credential_id: CREDENTIAL_A,
          grant_level: "use",
          project_id: null,
          jurisdiction: null,
          granted_by: USER_ADMIN,
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    });

    const result = await computeEffectivePermissions(supabase, userId);

    assert.equal(result.user_id, userId);
    assert.equal(result.access_status, "active");
    assert.equal(result.platform_admin, true);
    assert.ok(Array.isArray(result.platform_roles));
    assert.ok(Array.isArray(result.feature_permissions));
    assert.ok(Array.isArray(result.scraped_data_scope));
    assert.ok(Array.isArray(result.credential_grants));
    assert.equal(result.credential_grants.length, 1);
    assert.ok(Array.isArray(result.projects));
    assert.equal(result.projects.length, 3);
    assert.ok(Array.isArray(result.risks));
    assert.equal(result.projects[0].features["scraper.run"], "write");
    assert.ok(Array.isArray(result.project_access));
    assert.ok(Array.isArray(result.credential_access));
    assert.ok(result.access_summaries);
  });

  it("computes many projects without per-feature DB round trips", async () => {
    const userId = USER_ADMIN;
    const supabase = makeEffectivePermissionsSupabase({
      userId,
      projectCount: 80,
      platformAdmin: true,
    });

    const started = Date.now();
    const result = await computeEffectivePermissions(supabase, userId);
    const elapsed = Date.now() - started;

    assert.equal(result.projects.length, 80);
    assert.ok(elapsed < 500, `expected fast in-memory path, took ${elapsed}ms`);
  });

  it("enriches RPC payload in memory when RPC succeeds", async () => {
    const userId = USER_VIEWER;
    const supabase = makeRpcEffectivePermissionsSupabase({
      user_id: userId,
      access_status: "active",
      platform_admin: false,
      platform_roles: [],
      feature_permissions: [],
      scraped_data_scope: [],
      credential_grants: [],
      projects: [
        {
          project_id: PROJECT_A,
          project_name: "Project A",
          project_role: "viewer",
        },
      ],
      risks: [],
    });

    const result = await computeEffectivePermissions(supabase, userId);
    assert.equal(result.projects.length, 1);
    assert.equal(result.projects[0].features["billing.quickbooks"], "read");
    assert.ok(Array.isArray(result.projects[0].scraped_data_scopes));
    assert.ok(Array.isArray(result.project_access));
    assert.ok(result.access_summaries);
  });

  it("applies global feature overrides when enriching RPC payload", async () => {
    const userId = USER_VIEWER;
    const supabase = makeRpcEffectivePermissionsSupabase({
      user_id: userId,
      access_status: "active",
      platform_admin: false,
      platform_roles: [],
      feature_permissions: [
        {
          project_id: null,
          feature_key: "code.analyzer",
          access_level: "none",
        },
      ],
      scraped_data_scope: [],
      credential_grants: [],
      projects: [
        {
          project_id: PROJECT_A,
          project_name: "Project A",
          project_role: "admin",
        },
      ],
      risks: [],
    });

    const result = await computeEffectivePermissions(supabase, userId);
    assert.equal(result.projects[0].features["code.analyzer"], "none");
    assert.equal(result.projects[0].features["billing.quickbooks"], "write");
    assert.equal(result.global_features["code.analyzer"], "none");
    assert.equal(result.global_features["billing.quickbooks"], "write");
  });

  it("includes global_features for users with zero projects", async () => {
    const userId = USER_NON_ADMIN;
    const supabase = makeEffectivePermissionsSupabase({
      userId,
      projectCount: 0,
      platformAdmin: false,
    });

    const result = await computeEffectivePermissions(supabase, userId);
    assert.equal(result.projects.length, 0);
    assert.equal(result.global_features["code.analyzer"], "write");
    assert.equal(result.global_features["billing.quickbooks"], "write");
    assert.ok(Array.isArray(result.project_access));
    assert.ok(Array.isArray(result.credential_access));
  });
});

describe("admin auth email helpers", () => {
  const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const USER_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  function makeAuthEmailSupabase(usersByPage) {
    return {
      auth: {
        admin: {
          async listUsers({ page }) {
            const users = usersByPage[page] || [];
            return { data: { users }, error: null };
          },
          async getUserById(userId) {
            for (const pageUsers of Object.values(usersByPage)) {
              const match = pageUsers.find((user) => user.id === userId);
              if (match) {
                return { data: { user: match }, error: null };
              }
            }
            return { data: { user: null }, error: new Error("not found") };
          },
        },
      },
    };
  }

  it("fetchEmailsForUserIds resolves emails with early exit", async () => {
    const supabase = makeAuthEmailSupabase({
      1: [
        { id: USER_A, email: "alpha@example.com" },
        { id: USER_B, email: "beta@example.com" },
      ],
    });

    const emails = await fetchEmailsForUserIds(supabase, [USER_B]);
    assert.equal(emails.get(USER_B), "beta@example.com");
    assert.equal(emails.has(USER_A), false);
  });

  it("fetchEmailForUserId returns a single email", async () => {
    const supabase = makeAuthEmailSupabase({
      1: [{ id: USER_A, email: "alpha@example.com" }],
    });

    assert.equal(await fetchEmailForUserId(supabase, USER_A), "alpha@example.com");
    assert.equal(await fetchEmailForUserId(supabase, USER_B), null);
  });

  it("findUserIdsByEmailSearch matches email substrings", async () => {
    const supabase = makeAuthEmailSupabase({
      1: [
        { id: USER_A, email: "dlakey@commun-et.com" },
        { id: USER_B, email: "daniyalzahid12@yahoo.com" },
      ],
    });

    const danMatches = await findUserIdsByEmailSearch(supabase, "daniyal");
    assert.deepEqual(danMatches, [USER_B]);

    const lakeyMatches = await findUserIdsByEmailSearch(supabase, "commun-et");
    assert.deepEqual(lakeyMatches, [USER_A]);
  });
});
