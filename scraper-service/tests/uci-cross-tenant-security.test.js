"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const http = require("http");
const { createUciRouter } = require("../app/routes/uci.routes.js");
const {
  assertTenantAccess,
  requireTenantProjectAccess,
  assertEntityTenantMatch,
} = require("../app/services/uci/uci-access.service.js");
const {
  loadTenantContextForProject,
  DEMO_TENANT_ID,
} = require("../app/services/uci/uci-tenant-context.service.js");
const {
  buildUciStoragePath,
  parseUciStoragePathTenant,
  resolveTenantNamespaceForProject,
} = require("../app/services/uci/uci-document-storage.service.js");

const TENANT_A = "tenant-a-0000-4000-8000-000000000101";
const TENANT_B = "tenant-b-0000-4000-8000-000000000102";
const PROJECT_A = "project-a";
const PROJECT_B = "project-b";
const COORD_A = "coord-a";
const USER_A = "user-a";
const USER_B = "user-b";
const USER_DEMO = "user-demo";

function makeTenantSupabase(opts = {}) {
  const tenants = opts.tenants || [
    { id: TENANT_A, is_demo: false },
    { id: TENANT_B, is_demo: false },
    { id: DEMO_TENANT_ID, is_demo: true },
  ];

  const memberships = opts.memberships || [
    { tenant_id: TENANT_A, user_id: USER_A, role: "owner" },
    { tenant_id: TENANT_B, user_id: USER_B, role: "owner" },
    { tenant_id: DEMO_TENANT_ID, user_id: USER_DEMO, role: "member" },
  ];

  const projects = opts.projects || [
    { id: PROJECT_A, user_id: USER_A, tenant_id: TENANT_A },
    { id: PROJECT_B, user_id: USER_B, tenant_id: TENANT_B },
  ];

  const coordination = opts.coordination || [
    { id: COORD_A, project_id: PROJECT_A, tenant_id: TENANT_A, current_stage: 4, metadata: {} },
  ];

  const providers = opts.providers || [
    { id: "global-pepco", slug: "pepco", name: "PEPCO", tenant_id: null, is_global_template: true, is_active: true },
  ];

  return {
    auth: {
      getUser: async (token) => {
        const map = {
          userA: { id: USER_A },
          userB: { id: USER_B },
          demo: { id: USER_DEMO },
        };
        const user = map[token];
        return user ? { data: { user }, error: null } : { data: { user: null }, error: new Error("invalid") };
      },
    },
    from(table) {
      const rows =
        table === "projects"
          ? projects
          : table === "coordination_records"
            ? coordination
            : table === "utility_providers"
              ? providers
              : table === "tenants"
                ? tenants
                : table === "tenant_memberships"
                  ? memberships
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
        is(col, val) {
          chain._filters[col] = val;
          return chain;
        },
        or() {
          return chain;
        },
        order() {
          return chain;
        },
        maybeSingle: async () => {
          const match = rows.find((r) =>
            Object.entries(chain._filters).every(([k, v]) => r[k] === v),
          );
          return { data: match ?? null, error: null };
        },
        then(resolve) {
          const filtered = rows.filter((r) =>
            Object.entries(chain._filters).every(([k, v]) => r[k] === v),
          );
          resolve({ data: filtered, error: null });
        },
      };
      return chain;
    },
    async rpc(name, args) {
      const uid = args._user_id;
      const tid = args._tenant_id;
      const pid = args._project_id;

      if (name === "has_project_access") {
        if (uid === USER_A && pid === PROJECT_A) return { data: true, error: null };
        if (uid === USER_B && pid === PROJECT_B) return { data: true, error: null };
        return { data: false, error: null };
      }

      if (name === "has_project_editor_access") {
        if (uid === USER_A && pid === PROJECT_A) return { data: true, error: null };
        if (uid === USER_B && pid === PROJECT_B) return { data: true, error: null };
        return { data: false, error: null };
      }

      if (name === "can_access_tenant") {
        const member = memberships.find((m) => m.user_id === uid && m.tenant_id === tid);
        if (!member) return { data: false, error: null };
        const tenant = tenants.find((t) => t.id === tid);
        const userDemoOnly = memberships
          .filter((m) => m.user_id === uid)
          .every((m) => tenants.find((t) => t.id === m.tenant_id)?.is_demo);
        if (tenant?.is_demo) return { data: userDemoOnly, error: null };
        return { data: !userDemoOnly, error: null };
      }

      return { data: null, error: null };
    },
  };
}

describe("Row 2 cross-tenant security", () => {
  it("User A cannot access Tenant B", async () => {
    const supabase = makeTenantSupabase();
    const ok = await assertTenantAccess({ supabase, userId: USER_A, tenantId: TENANT_B });
    assert.equal(ok, false);
  });

  it("User A can access Tenant A", async () => {
    const supabase = makeTenantSupabase();
    const ok = await assertTenantAccess({ supabase, userId: USER_A, tenantId: TENANT_A });
    assert.equal(ok, true);
  });

  it("User A cannot access Project B", async () => {
    const supabase = makeTenantSupabase();
    await assert.rejects(
      () => requireTenantProjectAccess({ supabase, userId: USER_A, projectId: PROJECT_B }),
      (err) => err.code === "TENANT_ACCESS_DENIED" || err.code === "PROJECT_ACCESS_DENIED",
    );
  });

  it("demo user cannot access production tenant", async () => {
    const supabase = makeTenantSupabase();
    const ok = await assertTenantAccess({ supabase, userId: USER_DEMO, tenantId: TENANT_A });
    assert.equal(ok, false);
  });

  it("production user cannot access demo tenant", async () => {
    const supabase = makeTenantSupabase();
    const ok = await assertTenantAccess({ supabase, userId: USER_A, tenantId: DEMO_TENANT_ID });
    assert.equal(ok, false);
  });

  it("assertEntityTenantMatch rejects tampered tenant_id", () => {
    assert.throws(
      () =>
        assertEntityTenantMatch({
          expectedTenantId: TENANT_A,
          actualTenantId: TENANT_B,
        }),
      /not found/,
    );
  });

  it("storage namespace derived from project not missing tenant", async () => {
    const supabase = makeTenantSupabase();
    const derived = await resolveTenantNamespaceForProject(supabase, PROJECT_A, undefined);
    assert.equal(derived, TENANT_A);
  });

  it("buildUciStoragePath uses tenant segment", () => {
    const path = buildUciStoragePath({
      tenantNamespace: TENANT_A,
      projectId: PROJECT_A,
      coordinationRecordId: COORD_A,
      providerSlug: "pepco",
      externalApplicationId: "app-1",
      fileName: "doc.pdf",
    });
    assert.match(path, new RegExp(`^uci/${TENANT_A}/${PROJECT_A}/`));
  });

  it("loadTenantContextForProject returns tenant from project", async () => {
    const supabase = makeTenantSupabase();
    const ctx = await loadTenantContextForProject(supabase, PROJECT_A);
    assert.equal(ctx.tenantId, TENANT_A);
    assert.equal(ctx.isDemoTenant, false);
  });
});

describe("Row 2 cross-tenant route denial", () => {
  let server;
  let baseUrl;

  before(async () => {
    const supabase = makeTenantSupabase();
    const app = express();
    app.use(express.json());
    app.use("/api/uci", createUciRouter({ supabase }));
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  it("User A cannot read Project B coordination", async () => {
    const res = await fetch(`${baseUrl}/api/uci/projects/${PROJECT_B}/coordination`, {
      headers: { Authorization: "Bearer userA" },
    });
    assert.equal(res.status, 403);
  });

  it("User A can read Project A coordination", async () => {
    const res = await fetch(`${baseUrl}/api/uci/projects/${PROJECT_A}/coordination`, {
      headers: { Authorization: "Bearer userA" },
    });
    assert.equal(res.status, 200);
  });

  it("User A cannot list providers for Project B", async () => {
    const res = await fetch(`${baseUrl}/api/uci/providers?projectId=${PROJECT_B}`, {
      headers: { Authorization: "Bearer userA" },
    });
    assert.equal(res.status, 403);
  });
});
