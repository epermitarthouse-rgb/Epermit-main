"use strict";

/**
 * Row 4 — Cross-tenant UCI security tests (Week 1–2 Foundation).
 * Tenant A user must not read or write Tenant B resources across all UCI routes.
 * Separated from cross-project tests in uci-d13-routes-integration.test.js.
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const http = require("http");
const { createUciRouter } = require("../app/routes/uci.routes.js");
const {
  assertTenantAccess,
  requireTenantProjectAccess,
  assertEntityTenantMatch,
  requireCoordinationRecordAccess,
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
const { resolvePepcoDownloadedDocumentFile } = require("../app/services/uci/uci-pepco-document-download.service.js");

const TENANT_A = "tenant-a-0000-4000-8000-000000000101";
const TENANT_B = "tenant-b-0000-4000-8000-000000000102";
const PROJECT_A = "project-a";
const PROJECT_B = "project-b";
const COORD_A = "coord-a";
const COORD_B = "coord-b";
const APP_B = "app-row-b";
const COMM_B = "comm-row-b";
const EQUIP_B = "equip-row-b";
const JOB_B = "job-row-b";
const APP_UUID_B = "app-uuid-row-b";
const USER_A = "user-a";
const USER_B = "user-b";
const USER_DEMO = "user-demo";

const pepcoDiscoveryMeta = {
  pepco_application_detail_discovery: {
    applications: [
      {
        applicationUuid: APP_UUID_B,
        documents: [{ documentName: "plan.pdf" }],
        downloadedFiles: [
          {
            documentName: "plan.pdf",
            fileName: "plan.pdf",
            status: "saved",
            detectedPdf: true,
            storageBucket: "project-documents",
            storagePath: `uci/${TENANT_B}/${PROJECT_B}/${COORD_B}/pepco/${APP_UUID_B}/plan.pdf`,
          },
        ],
      },
    ],
  },
};

/**
 * @param {object} [opts]
 */
function makeTenantSupabase(opts = {}) {
  const tenants = opts.tenants || [
    { id: TENANT_A, is_demo: false, name: "Tenant A" },
    { id: TENANT_B, is_demo: false, name: "Tenant B" },
    { id: DEMO_TENANT_ID, is_demo: true, name: "Demo" },
  ];

  const memberships = opts.memberships || [
    { tenant_id: TENANT_A, user_id: USER_A, role: "owner" },
    { tenant_id: TENANT_B, user_id: USER_B, role: "owner" },
    { tenant_id: DEMO_TENANT_ID, user_id: USER_DEMO, role: "member" },
  ];

  const projects = opts.projects || [
    { id: PROJECT_A, user_id: USER_A, tenant_id: TENANT_A, name: "Project A" },
    { id: PROJECT_B, user_id: USER_B, tenant_id: TENANT_B, name: "Project B" },
  ];

  const coordination = opts.coordination || [
    {
      id: COORD_A,
      project_id: PROJECT_A,
      tenant_id: TENANT_A,
      current_stage: 4,
      current_stage_state: "IN_PROGRESS",
      metadata: {},
      utility_providers: { slug: "pepco", name: "PEPCO" },
    },
    {
      id: COORD_B,
      project_id: PROJECT_B,
      tenant_id: TENANT_B,
      current_stage: 4,
      current_stage_state: "IN_PROGRESS",
      metadata: pepcoDiscoveryMeta,
      utility_providers: { slug: "pepco", name: "PEPCO" },
    },
  ];

  const providers = opts.providers || [
    {
      id: "global-pepco",
      slug: "pepco",
      name: "PEPCO Global",
      tenant_id: null,
      is_global_template: true,
      is_active: true,
    },
    {
      id: "tenant-b-only",
      slug: "bge",
      name: "BGE Tenant B",
      tenant_id: TENANT_B,
      is_global_template: false,
      is_active: true,
    },
  ];

  const tables = {
    coordination_records: coordination,
    coordination_applications: [
      {
        id: APP_B,
        coordination_record_id: COORD_B,
        project_id: PROJECT_B,
        tenant_id: TENANT_B,
        draft_status: "draft",
      },
    ],
    coordination_communications: [
      {
        id: COMM_B,
        coordination_record_id: COORD_B,
        project_id: PROJECT_B,
        tenant_id: TENANT_B,
        raw_subject: "Invoice",
        raw_body: "pay now",
      },
    ],
    coordination_equipment: [
      {
        id: EQUIP_B,
        coordination_record_id: COORD_B,
        project_id: PROJECT_B,
        tenant_id: TENANT_B,
        equipment_type: "transformer",
        status: "ordered",
      },
    ],
    coordination_costs: [],
    coordination_milestones: [],
    coordination_stage_transitions: [],
    scrape_jobs: [
      {
        id: JOB_B,
        coordination_record_id: COORD_B,
        project_id: PROJECT_B,
        tenant_id: TENANT_B,
        status: "queued",
      },
    ],
    utility_providers: providers,
    tenants,
    tenant_memberships: memberships,
    projects,
  };

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
    storage: {
      from() {
        return {
          download: async () => ({ data: null, error: { message: "not_found" } }),
        };
      },
    },
    from(table) {
      const rows = tables[table] || [];
      const chain = {
        _filters: {},
        _tenantOr: false,
        _tenantIdFilter: null,
        select() {
          return chain;
        },
        insert(row) {
          const inserted = { id: `${table}-new`, ...row };
          rows.push(inserted);
          return {
            select() {
              return { single: async () => ({ data: inserted, error: null }) };
            },
          };
        },
        update(patch) {
          return {
            eq(col, val) {
              chain._filters[col] = val;
              return {
                select() {
                  return {
                    single: async () => {
                      const idx = rows.findIndex((r) =>
                        Object.entries(chain._filters).every(([k, v]) => r[k] === v),
                      );
                      if (idx >= 0) rows[idx] = { ...rows[idx], ...patch };
                      return { data: rows[idx] ?? null, error: null };
                    },
                  };
                },
                then(resolve) {
                  resolve({ error: null });
                },
              };
            },
          };
        },
        eq(col, val) {
          chain._filters[col] = val;
          return chain;
        },
        is(col, val) {
          chain._filters[col] = val;
          return chain;
        },
        in() {
          return chain;
        },
        or(expr) {
          chain._tenantOr = true;
          const match = String(expr || "").match(/tenant_id\.eq\.([^,)]+)/);
          if (match) chain._tenantIdFilter = match[1];
          return chain;
        },
        order() {
          return chain;
        },
        limit() {
          return chain;
        },
        maybeSingle: async () => {
          const match = rows.find((r) =>
            Object.entries(chain._filters).every(([k, v]) => r[k] === v),
          );
          return { data: match ?? null, error: null };
        },
        single: async () => {
          const match = rows.find((r) =>
            Object.entries(chain._filters).every(([k, v]) => r[k] === v),
          );
          return { data: match ?? null, error: null };
        },
        then(resolve, reject) {
          let filtered = rows.filter((r) =>
            Object.entries(chain._filters).every(([k, v]) => r[k] === v),
          );
          if (table === "utility_providers" && chain._tenantOr) {
            filtered = filtered.filter(
              (p) =>
                (p.is_global_template && !p.tenant_id) ||
                (chain._tenantIdFilter && p.tenant_id === chain._tenantIdFilter),
            );
          }
          return Promise.resolve({ data: filtered, error: null }).then(resolve, reject);
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

async function startUciServer(supabase) {
  const app = express();
  app.use(express.json());
  app.use("/api/uci", createUciRouter({ supabase }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = /** @type {import("net").AddressInfo} */ (server.address()).port;
  return {
    baseUrl: `http://127.0.0.1:${port}/api/uci`,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

const AUTH_A = { Authorization: "Bearer userA" };
const AUTH_B = { Authorization: "Bearer userB" };

/** @type {{ baseUrl: string, close: () => Promise<void> } | null} */
let server = null;

describe("Row 4 — tenant access primitives", () => {
  it("User A cannot access Tenant B", async () => {
    const ok = await assertTenantAccess({
      supabase: makeTenantSupabase(),
      userId: USER_A,
      tenantId: TENANT_B,
    });
    assert.equal(ok, false);
  });

  it("User A can access Tenant A", async () => {
    const ok = await assertTenantAccess({
      supabase: makeTenantSupabase(),
      userId: USER_A,
      tenantId: TENANT_A,
    });
    assert.equal(ok, true);
  });

  it("User A cannot access Project B (read)", async () => {
    await assert.rejects(
      () =>
        requireTenantProjectAccess({
          supabase: makeTenantSupabase(),
          userId: USER_A,
          projectId: PROJECT_B,
        }),
      (err) => err.code === "TENANT_ACCESS_DENIED" || err.code === "PROJECT_ACCESS_DENIED",
    );
  });

  it("User A cannot write Project B", async () => {
    await assert.rejects(
      () =>
        requireTenantProjectAccess({
          supabase: makeTenantSupabase(),
          userId: USER_A,
          projectId: PROJECT_B,
          write: true,
        }),
      (err) => err.code === "TENANT_ACCESS_DENIED" || err.code === "PROJECT_EDITOR_ACCESS_DENIED",
    );
  });

  it("demo user cannot access production tenant", async () => {
    const ok = await assertTenantAccess({
      supabase: makeTenantSupabase(),
      userId: USER_DEMO,
      tenantId: TENANT_A,
    });
    assert.equal(ok, false);
  });

  it("production user cannot access demo tenant", async () => {
    const ok = await assertTenantAccess({
      supabase: makeTenantSupabase(),
      userId: USER_A,
      tenantId: DEMO_TENANT_ID,
    });
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

  it("requireCoordinationRecordAccess rejects cross-tenant coordination id", async () => {
    await assert.rejects(
      () =>
        requireCoordinationRecordAccess({
          supabase: makeTenantSupabase(),
          userId: USER_A,
          coordinationRecordId: COORD_B,
        }),
      (err) => err.statusCode === 403,
    );
  });
});

describe("Row 4 — storage namespace isolation", () => {
  it("derives tenant namespace from project server-side", async () => {
    const derived = await resolveTenantNamespaceForProject(
      makeTenantSupabase(),
      PROJECT_A,
      undefined,
    );
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

  it("parseUciStoragePathTenant extracts tenant from path", () => {
    const parsed = parseUciStoragePathTenant(
      `uci/${TENANT_B}/${PROJECT_B}/${COORD_B}/pepco/${APP_UUID_B}/plan.pdf`,
    );
    assert.deepEqual(parsed, { tenantNamespace: TENANT_B, projectId: PROJECT_B });
  });

  it("legacy unconfigured paths parse without tenant enforcement", () => {
    const parsed = parseUciStoragePathTenant(`uci/unconfigured/${PROJECT_A}/${COORD_A}/pepco/x/f.pdf`);
    assert.equal(parsed?.tenantNamespace, "unconfigured");
  });

  it("loadTenantContextForProject returns tenant from project", async () => {
    const ctx = await loadTenantContextForProject(makeTenantSupabase(), PROJECT_A);
    assert.equal(ctx.tenantId, TENANT_A);
    assert.equal(ctx.isDemoTenant, false);
  });

  it("User A cannot resolve Tenant B document via storage service", async () => {
    await assert.rejects(
      () =>
        resolvePepcoDownloadedDocumentFile({
          supabase: makeTenantSupabase(),
          userId: USER_A,
          coordinationId: COORD_B,
          applicationUuid: APP_UUID_B,
          documentIndex: 0,
        }),
      (err) => err.statusCode === 403,
    );
  });
});

describe("Row 4 — provider tenant scoping", () => {
  before(async () => {
    server = await startUciServer(makeTenantSupabase());
  });

  after(async () => {
    if (server) await server.close();
    server = null;
  });

  it("User A providers for Project A exclude Tenant B-only provider", async () => {
    const res = await fetch(`${server.baseUrl}/providers?projectId=${PROJECT_A}`, {
      headers: AUTH_A,
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.tenant_id, TENANT_A);
    const slugs = (body.providers || []).map((p) => p.slug);
    assert.ok(slugs.includes("pepco"));
    assert.equal(slugs.includes("bge"), false);
  });

  it("User A provider-setup for Project A excludes Tenant B-only provider", async () => {
    const res = await fetch(`${server.baseUrl}/projects/${PROJECT_A}/provider-setup`, {
      headers: AUTH_A,
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    const slugs = (body.providers || []).map((p) => p.slug);
    assert.ok(slugs.includes("pepco"));
    assert.equal(slugs.includes("bge"), false);
    assert.equal(body.tenant_id, TENANT_A);
  });

  it("User A cannot list providers for Project B", async () => {
    const res = await fetch(`${server.baseUrl}/providers?projectId=${PROJECT_B}`, {
      headers: AUTH_A,
    });
    assert.equal(res.status, 403);
  });
});

describe("Row 4 — cross-tenant UCI route denial (User A → Tenant B)", () => {
  before(async () => {
    server = await startUciServer(makeTenantSupabase());
  });

  after(async () => {
    if (server) await server.close();
    server = null;
  });

  const readRoutes = [
    ["provider setup", `/projects/${PROJECT_B}/provider-setup`],
    ["coordination list", `/projects/${PROJECT_B}/coordination`],
    ["coordination detail", `/coordination/${COORD_B}`],
    ["applications list", `/coordination/${COORD_B}/applications`],
    ["sync runs", `/coordination/${COORD_B}/sync-runs`],
    ["communications", `/coordination/${COORD_B}/communications`],
    ["milestones", `/coordination/${COORD_B}/milestones`],
    ["costs", `/coordination/${COORD_B}/costs`],
    ["equipment", `/coordination/${COORD_B}/equipment`],
    ["portfolio", `/projects/${PROJECT_B}/portfolio_view`],
    ["events", `/events/recent?project_id=${PROJECT_B}`],
    ["needs attention", `/communications/needs_attention?project_id=${PROJECT_B}`],
    [
      "document view",
      `/coordination/${COORD_B}/discovery/pepco/application-details/${APP_UUID_B}/documents/0/view`,
    ],
    [
      "document download",
      `/coordination/${COORD_B}/discovery/pepco/application-details/${APP_UUID_B}/documents/0/download`,
    ],
    [
      "load candidate list",
      `/coordination/${COORD_B}/load-profile/candidates?external_application_id=ext-1`,
    ],
  ];

  for (const [label, path] of readRoutes) {
    it(`GET ${label} denied for Tenant B`, async () => {
      const res = await fetch(`${server.baseUrl}${path}`, { headers: AUTH_A });
      assert.equal(res.status, 403, `${label} should return 403`);
    });
  }

  const writeRoutes = [
    [
      "coordination init",
      "POST",
      `/projects/${PROJECT_B}/coordination/init`,
      {
        providers: ["pepco"],
        provider_setup: { confirmed: true, address_source_acknowledged: "structured" },
      },
    ],
    [
      "lifecycle transition",
      "POST",
      `/coordination/${COORD_B}/transition`,
      { to_stage: 5, to_state: "IN_PROGRESS", reason: "test" },
    ],
    [
      "lifecycle apply",
      "POST",
      `/coordination/${COORD_B}/lifecycle-proposals/apply`,
      { external_application_id: "ext-1", proposal_checksum: "deadbeef" },
    ],
    [
      "lifecycle reject",
      "POST",
      `/coordination/${COORD_B}/lifecycle-proposals/reject`,
      { external_application_id: "ext-1", proposal_checksum: "deadbeef" },
    ],
    ["load profile", "POST", `/coordination/${COORD_B}/load-profile/analyze`, {}],
    [
      "load profile document link",
      "POST",
      `/coordination/${COORD_B}/load-profile/documents/link`,
      { project_document_ids: ["doc-1"] },
    ],
    [
      "load candidate extract",
      "POST",
      `/coordination/${COORD_B}/load-profile/extract-candidates`,
      { external_application_id: "ext-1" },
    ],
    [
      "load candidate resolve",
      "POST",
      `/coordination/${COORD_B}/load-profile/candidates/resolve`,
      { candidate_id: "load_candidate:abc", action: "approve" },
    ],
    ["application build", "POST", `/coordination/${COORD_B}/applications`, {}],
    ["portal sync", "POST", `/coordination/${COORD_B}/sync`, { provider_slug: "pepco" }],
    [
      "sync cancel",
      "POST",
      `/coordination/${COORD_B}/sync-runs/${JOB_B}/cancel`,
      {},
    ],
    ["classify comms", "POST", `/coordination/${COORD_B}/communications/classify`, {}],
    ["COS analyze", "POST", `/coordination/${COORD_B}/cos/analyze`, {}],
    [
      "cost upsert",
      "POST",
      `/coordination/${COORD_B}/costs`,
      { cost_type: "ciac", estimated_amount: 100 },
    ],
    [
      "equipment create",
      "POST",
      `/coordination/${COORD_B}/equipment`,
      { equipment_type: "transformer", status: "ordered" },
    ],
    ["meter set", "POST", `/coordination/${COORD_B}/meter-set/prepare`, {}],
    ["closeout", "POST", `/coordination/${COORD_B}/closeout/prepare`, {}],
    ["pepco discovery", "POST", `/coordination/${COORD_B}/discovery/pepco`, {}],
    [
      "application review",
      "POST",
      `/applications/${APP_B}/review`,
      { status: "reviewed" },
    ],
    ["application submit", "POST", `/applications/${APP_B}/submit`, {}],
    [
      "communication reclassify",
      "POST",
      `/communications/${COMM_B}/reclassify`,
      { classification: "ciac_invoice" },
    ],
    [
      "equipment check-in",
      "POST",
      `/equipment/${EQUIP_B}/check-in`,
      { status: "ordered" },
    ],
  ];

  for (const [label, method, path, body] of writeRoutes) {
    it(`${method} ${label} denied for Tenant B`, async () => {
      const res = await fetch(`${server.baseUrl}${path}`, {
        method,
        headers: { ...AUTH_A, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      assert.equal(res.status, 403, `${label} should return 403`);
    });
  }

  it("User A can read own Tenant A coordination", async () => {
    const res = await fetch(`${server.baseUrl}/projects/${PROJECT_A}/coordination`, {
      headers: AUTH_A,
    });
    assert.equal(res.status, 200);
  });

  it("User B cannot read Tenant A coordination (reverse isolation)", async () => {
    const res = await fetch(`${server.baseUrl}/projects/${PROJECT_A}/coordination`, {
      headers: AUTH_B,
    });
    assert.equal(res.status, 403);
  });

  it("route id tampering: User A uses Tenant B coordination id on sync-runs detail", async () => {
    const res = await fetch(`${server.baseUrl}/coordination/${COORD_B}/sync-runs/${JOB_B}`, {
      headers: AUTH_A,
    });
    assert.equal(res.status, 403);
  });
});
