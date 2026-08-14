"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const http = require("http");
const { createUciRouter } = require("../app/routes/uci.routes.js");
const {
  buildProviderSetupAddressContext,
  parseProviderSetupConfirmation,
  buildHumanAssistedMappingMetadata,
  PROVIDER_SETUP_METHOD,
} = require("../app/services/uci/uci-provider-setup.service.js");
const { getActiveProvidersBySlugsForTenant } = require("../app/services/uci/uci-providers-tenant.service.js");

const TENANT_A = "tenant-a-0000-4000-8000-000000000101";
const TENANT_B = "tenant-b-0000-4000-8000-000000000102";
const PROJECT_A = "project-a";
const USER_A = "user-a";

/**
 * @param {object} [opts]
 */
function makeInitSupabase(opts = {}) {
  const projects = opts.projects || [
    {
      id: PROJECT_A,
      user_id: USER_A,
      tenant_id: TENANT_A,
      name: "Project A",
      address: "100 Main St",
      city: "Washington",
      state: "DC",
      zip_code: "20001",
      portal_data: { location: "200 Sheridan Rd NW, Washington DC" },
    },
  ];

  const providers = opts.providers || [
    {
      id: "global-pepco",
      slug: "pepco",
      name: "PEPCO",
      utility_type: "electric",
      tenant_id: null,
      is_global_template: true,
      is_active: true,
      automation_status: "placeholder",
    },
    {
      id: "tenant-b-only",
      slug: "bge",
      name: "BGE Tenant B",
      utility_type: "electric",
      tenant_id: TENANT_B,
      is_global_template: false,
      is_active: true,
      automation_status: "placeholder",
    },
  ];

  const tables = {
    projects,
    utility_providers: providers,
    tenant_memberships: [{ tenant_id: TENANT_A, user_id: USER_A, role: "owner" }],
    tenants: [{ id: TENANT_A, is_demo: false, name: "Tenant A" }],
    coordination_records: opts.coordination_records || [],
    coordination_stage_transitions: [],
  };

  return {
    auth: {
      getUser: async (token) =>
        token === "userA"
          ? { data: { user: { id: USER_A } }, error: null }
          : { data: { user: null }, error: new Error("invalid") },
    },
    rpc(name, args) {
      const uid = args._user_id;
      const tid = args._tenant_id;
      const pid = args._project_id;

      if (name === "has_project_access") {
        if (uid === USER_A && pid === PROJECT_A) return Promise.resolve({ data: true, error: null });
        return Promise.resolve({ data: false, error: null });
      }
      if (name === "has_project_editor_access") {
        if (uid === USER_A && pid === PROJECT_A) return Promise.resolve({ data: true, error: null });
        return Promise.resolve({ data: false, error: null });
      }
      if (name === "can_access_tenant") {
        const ok = uid === USER_A && String(tid) === TENANT_A;
        return Promise.resolve({ data: ok, error: null });
      }
      return Promise.resolve({ data: null, error: new Error(`unknown rpc ${name}`) });
    },
    from(table) {
      const rows = tables[table] || [];
      const chain = {
        _filters: {},
        _tenantOr: false,
        _inFilter: null,
        select() {
          return chain;
        },
        eq(col, val) {
          chain._filters[col] = val;
          return chain;
        },
        is(col, val) {
          chain._filters[`${col}__is`] = val;
          return chain;
        },
        or() {
          chain._tenantOr = true;
          return chain;
        },
        in(col, values) {
          chain._inFilter = { col, values };
          return chain;
        },
        order() {
          return chain;
        },
        insert(row) {
          const inserted = { id: `${table}-new-${rows.length + 1}`, ...row };
          rows.push(inserted);
          return {
            select() {
              return { single: async () => ({ data: inserted, error: null }) };
            },
            then(resolve, reject) {
              return Promise.resolve({ error: null }).then(resolve, reject);
            },
          };
        },
        update(patch) {
          return {
            eq(col, val) {
              chain._filters[col] = val;
              return {
                then(resolve, reject) {
                  const idx = rows.findIndex((r) =>
                    Object.entries(chain._filters).every(([k, v]) => r[k] === v),
                  );
                  if (idx >= 0) rows[idx] = { ...rows[idx], ...patch };
                  return Promise.resolve({ data: rows[idx] ?? null, error: null }).then(
                    resolve,
                    reject,
                  );
                },
              };
            },
          };
        },
        maybeSingle() {
          const row = rows.find((r) =>
            Object.entries(chain._filters).every(([k, v]) => {
              if (k.endsWith("__is")) {
                const colName = k.replace(/__is$/, "");
                return v === null ? r[colName] == null : r[colName] === v;
              }
              return String(r[k]) === String(v);
            }),
          );
          return Promise.resolve({ data: row ?? null, error: null });
        },
        single() {
          return chain.maybeSingle();
        },
        then(resolve, reject) {
          let filtered = rows.filter((r) => {
            if (chain._inFilter && !chain._inFilter.values.includes(r[chain._inFilter.col])) {
              return false;
            }
            return Object.entries(chain._filters).every(([k, v]) => {
              if (k.endsWith("__is")) {
                const colName = k.replace(/__is$/, "");
                return v === null ? r[colName] == null : r[colName] === v;
              }
              return String(r[k]) === String(v);
            });
          });

          if (table === "utility_providers" && chain._tenantOr) {
            filtered = rows.filter((r) => {
              if (!r.is_active) return false;
              if (r.is_global_template && r.tenant_id == null) return true;
              return String(r.tenant_id) === TENANT_A;
            });
          }

          return Promise.resolve({ data: filtered, error: null }).then(resolve, reject);
        },
      };
      return chain;
    },
  };
}

async function startServer(supabase) {
  const app = express();
  app.use(express.json());
  app.use("/api/uci", createUciRouter({ supabase }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}/api/uci`,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

describe("Row 5 — provider init API hardening", () => {
  /** @type {{ baseUrl: string, close: () => Promise<void> } | null} */
  let httpServer = null;

  before(async () => {
    httpServer = await startServer(makeInitSupabase());
  });

  after(async () => {
    if (httpServer) await httpServer.close();
    httpServer = null;
  });

  const auth = { Authorization: "Bearer userA", "Content-Type": "application/json" };

  it("rejects init without provider_setup", async () => {
    const res = await fetch(`${httpServer.baseUrl}/projects/${PROJECT_A}/coordination/init`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ providers: ["pepco"] }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "PROVIDER_SETUP_REQUIRED");
  });

  it("rejects init when confirmed is false", async () => {
    const res = await fetch(`${httpServer.baseUrl}/projects/${PROJECT_A}/coordination/init`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        providers: ["pepco"],
        provider_setup: { confirmed: false, address_source_acknowledged: "structured" },
      }),
    });
    assert.equal(res.status, 400);
  });

  it("rejects init with zero providers", async () => {
    const res = await fetch(`${httpServer.baseUrl}/projects/${PROJECT_A}/coordination/init`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        providers: [],
        provider_setup: { confirmed: true, address_source_acknowledged: "structured" },
      }),
    });
    assert.equal(res.status, 400);
  });

  it("rejects tenant-invisible provider slug", async () => {
    const res = await fetch(`${httpServer.baseUrl}/projects/${PROJECT_A}/coordination/init`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        providers: ["bge"],
        provider_setup: { confirmed: true, address_source_acknowledged: "structured" },
      }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "INVALID_PROVIDER");
  });

  it("creates, searches, and initializes tenant providers for all supported types", async () => {
    const utilityTypes = ["electric", "gas", "water", "sewer", "telecom"];
    const createdProviders = [];

    for (const utilityType of utilityTypes) {
      const createRes = await fetch(`${httpServer.baseUrl}/projects/${PROJECT_A}/providers`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          name: `Custom ${utilityType} service`,
          utility_type: utilityType,
        }),
      });
      assert.equal(createRes.status, 201);
      const created = await createRes.json();
      assert.equal(created.provider.utility_type, utilityType);
      createdProviders.push(created.provider);

      const searchRes = await fetch(
        `${httpServer.baseUrl}/providers?projectId=${PROJECT_A}&utilityType=${utilityType}`,
        { headers: auth },
      );
      assert.equal(searchRes.status, 200);
      const search = await searchRes.json();
      assert.ok(
        search.providers.some((provider) => provider.id === created.provider.id),
        `${utilityType} provider must be visible after create`,
      );
    }

    const initRes = await fetch(
      `${httpServer.baseUrl}/projects/${PROJECT_A}/coordination/init`,
      {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          providers: createdProviders.map((provider) => provider.slug),
          provider_setup: {
            confirmed: true,
            address_source_acknowledged: "structured",
          },
        }),
      },
    );
    assert.equal(initRes.status, 200);
    const initialized = await initRes.json();
    assert.equal(initialized.created.length, utilityTypes.length);
    assert.deepEqual(
      initialized.created.map((record) => record.utility_type).sort(),
      [...utilityTypes].sort(),
    );
  });

  it("returns the existing provider for a duplicate create", async () => {
    const payload = {
      name: "Custom water service",
      utility_type: "water",
    };
    const first = await fetch(`${httpServer.baseUrl}/projects/${PROJECT_A}/providers`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify(payload),
    });
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    assert.equal(firstBody.created, false);

    const duplicate = await fetch(`${httpServer.baseUrl}/projects/${PROJECT_A}/providers`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify(payload),
    });
    assert.equal(duplicate.status, 200);
    const duplicateBody = await duplicate.json();
    assert.equal(duplicateBody.created, false);
    assert.equal(duplicateBody.provider.id, firstBody.provider.id);
    assert.equal(duplicateBody.provider.slug, firstBody.provider.slug);
  });

  it("rejects unsupported provider types without coercion", async () => {
    const res = await fetch(`${httpServer.baseUrl}/projects/${PROJECT_A}/providers`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "Steam Utility", utility_type: "steam" }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "UNSUPPORTED_UTILITY_TYPE");
  });

  it("accepts valid confirmed init and persists mapping metadata", async () => {
    const res = await fetch(`${httpServer.baseUrl}/projects/${PROJECT_A}/coordination/init`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        providers: ["pepco"],
        provider_setup: {
          confirmed: true,
          address_source_acknowledged: "structured",
          unresolved_utility_types: ["gas"],
        },
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.created.length, 1);
    const mapping = body.created[0].metadata.uci_provider_mapping;
    assert.equal(mapping.method, PROVIDER_SETUP_METHOD);
    assert.equal(mapping.confirmed, true);
    assert.equal(mapping.address_source_acknowledged, "structured");
    assert.equal(mapping.address_mismatch, true);
    assert.deepEqual(mapping.unresolved_utility_types, ["gas"]);
  });

  it("remains idempotent on repeated confirmed init", async () => {
    const payload = {
      providers: ["pepco"],
      provider_setup: {
        confirmed: true,
        address_source_acknowledged: "portal_data_location",
      },
    };
    const res = await fetch(`${httpServer.baseUrl}/projects/${PROJECT_A}/coordination/init`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify(payload),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.created.length, 0);
    assert.equal(body.already_existed.length, 1);
    const pepcoRecord = body.records.find(
      (record) => record.utility_provider_id === "global-pepco",
    );
    assert.equal(
      pepcoRecord.metadata.uci_provider_mapping.address_source_acknowledged,
      "portal_data_location",
    );
  });
});

describe("Row 5 — address precedence and acknowledgement", () => {
  it("uses structured address when street is present", () => {
    const ctx = buildProviderSetupAddressContext({
      address: "123 Main St",
      city: "Washington",
      state: "DC",
      zip_code: "20001",
    });
    assert.equal(ctx.recommended_address_source, "structured");
    assert.equal(ctx.address_mismatch, false);
  });

  it("uses scraped location when structured street is empty", () => {
    const ctx = buildProviderSetupAddressContext({
      address: "",
      city: "",
      state: "",
      portal_data: { location: "Sheridan Rd NW, Washington DC" },
    });
    assert.equal(ctx.recommended_address_source, "portal_data_location");
    assert.equal(ctx.address.source, "portal_data_location");
  });

  it("detects mismatch between structured street and scraped location", () => {
    const ctx = buildProviderSetupAddressContext({
      address: "123 Main St",
      city: "Washington",
      state: "DC",
      portal_data: { location: "200 Sheridan Rd NW, Washington DC" },
    });
    assert.equal(ctx.address_mismatch, true);
    assert.ok(ctx.mismatch_warning);
  });

  it("requires address_source_acknowledged and stores acknowledged snapshot", () => {
    const ctx = buildProviderSetupAddressContext({
      address: "123 Main St",
      city: "Washington",
      state: "DC",
      portal_data: { location: "200 Sheridan Rd NW, Washington DC" },
    });
    const parsed = parseProviderSetupConfirmation(
      { confirmed: true, address_source_acknowledged: "portal_data_location" },
      ctx,
    );
    assert.equal(parsed.addressSourceAcknowledged, "portal_data_location");
    assert.equal(parsed.address.formatted, "200 Sheridan Rd NW, Washington DC");
  });
});

describe("Row 5 — tenant provider slug resolution", () => {
  it("excludes another tenant private provider", async () => {
    const supabase = makeInitSupabase();
    const { providers, missingSlugs } = await getActiveProvidersBySlugsForTenant(
      supabase,
      TENANT_A,
      ["pepco", "bge"],
    );
    assert.deepEqual(missingSlugs, ["bge"]);
    assert.equal(providers.length, 1);
    assert.equal(providers[0].slug, "pepco");
  });
});
