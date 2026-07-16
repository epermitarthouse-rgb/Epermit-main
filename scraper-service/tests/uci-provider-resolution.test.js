"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const http = require("http");
const path = require("node:path");
const { createUciRouter } = require("../app/routes/uci.routes.js");
const {
  RESOLUTION_STATUSES,
  validateProviderResolutionResult,
  TERRITORY_DATA_UNAVAILABLE_MESSAGE,
} = require("../app/services/uci/uci-provider-resolution-contract.js");
const {
  buildNextPortalDataWithResolution,
  mergeProviderResolutionIntoCoordinationMetadata,
  readProviderResolutionForServiceType,
} = require("../app/services/uci/uci-provider-resolution-persistence.js");
const {
  buildTerritoryUnavailableResolution,
  isTerritoryDataAvailableForServiceType,
  resolveProviderResolutionForProject,
  confirmProviderResolutionForProject,
  overrideProviderResolutionForProject,
} = require("../app/services/uci/uci-provider-resolution.service.js");
const { buildProviderSetupAddressContext } = require("../app/services/uci/uci-provider-setup.service.js");
const { initCoordinationForProviders } = require("../app/services/uci/uci-records.service.js");
const { resolveProviderAlias } = require("../app/services/uci/uci-provider-directory.service.js");
const { clearTerritoryDatasetCache } = require("../app/services/uci/territory/territory-dataset-loader.service.js");

const TENANT_A = "tenant-a-0000-4000-8000-000000000101";
const PROJECT_A = "project-a";
const USER_A = "user-a";
const PEPCO_ID = "global-pepco";
const BGE_ID = "global-bge";

const EMPTY_TERRITORY_DIR = path.join(__dirname, "fixtures", "territory-empty");

const BASE_PROJECT = {
  id: PROJECT_A,
  user_id: USER_A,
  tenant_id: TENANT_A,
  name: "Project A",
  address: "100 Main St",
  city: "Washington",
  state: "DC",
  zip_code: "20001",
  portal_data: {},
};

const PROVIDERS = [
  {
    id: PEPCO_ID,
    slug: "pepco",
    name: "PEPCO",
    display_name: "PEPCO",
    utility_type: "electric",
    tenant_id: null,
    is_global_template: true,
    is_active: true,
  },
  {
    id: BGE_ID,
    slug: "bge",
    name: "BGE",
    display_name: "BGE",
    utility_type: "electric",
    tenant_id: null,
    is_global_template: true,
    is_active: true,
  },
  {
    id: "global-washgas",
    slug: "washington-gas",
    name: "Washington Gas",
    display_name: "Washington Gas",
    utility_type: "gas",
    tenant_id: null,
    is_global_template: true,
    is_active: true,
  },
];

/**
 * @param {object} [opts]
 */
function makeResolutionSupabase(opts = {}) {
  const projects = opts.projects || [{ ...BASE_PROJECT }];
  const tables = {
    projects,
    utility_providers: opts.providers || PROVIDERS,
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
        return Promise.resolve({ data: uid === USER_A && pid === PROJECT_A, error: null });
      }
      if (name === "has_project_editor_access") {
        return Promise.resolve({ data: uid === USER_A && pid === PROJECT_A, error: null });
      }
      if (name === "can_access_tenant") {
        return Promise.resolve({
          data: uid === USER_A && String(tid) === TENANT_A,
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: new Error(`unknown rpc ${name}`) });
    },
    from(table) {
      const rows = tables[table] || (tables[table] = []);
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
        update(patch) {
          return {
            eq(col, val) {
              chain._filters[col] = val;
              return {
                then(resolve, reject) {
                  const idx = rows.findIndex((r) =>
                    Object.entries(chain._filters).every(([k, v]) => String(r[k]) === String(v)),
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
    __tables: tables,
  };
}

function buildSampleResult(overrides = {}) {
  return {
    service_type: "electric",
    status: "territory_data_unavailable",
    resolution_tier: null,
    resolution_method: "manual_selection",
    confidence: "none",
    address: {
      formatted: "100 Main St, Washington, DC, 20001",
      source: "project",
      latitude: null,
      longitude: null,
      geocode_provider: null,
      geocoded_at: null,
    },
    source: {
      name: "EIA Energy Atlas",
      dataset_vintage: null,
      layer_id: null,
      source_url: null,
      generated_at: null,
      available: false,
    },
    candidates: [],
    suggested_provider_id: null,
    boundary_risk: false,
    boundary_distance_miles: null,
    requires_human_confirmation: true,
    confirmed_provider_id: null,
    confirmed_by: null,
    confirmed_at: null,
    override_reason: null,
    notes: null,
    resolver_version: "d2.2-v1",
    resolved_at: "2026-07-17T00:00:00.000Z",
    ...overrides,
  };
}

describe("UCI D2.2 provider resolution contract", () => {
  for (const status of RESOLUTION_STATUSES) {
    it(`validates contract shape for status=${status}`, () => {
      const base = buildSampleResult({ status });
      if (status === "ambiguous") {
        base.requires_human_confirmation = true;
        base.candidates = [
          {
            provider_id: PEPCO_ID,
            provider_slug: "pepco",
            display_name: "PEPCO",
            match_reason: "territory_polygon",
          },
          {
            provider_id: BGE_ID,
            provider_slug: "bge",
            display_name: "BGE",
            match_reason: "territory_polygon",
          },
        ];
      }
      if (status === "confirmed") {
        base.requires_human_confirmation = false;
        base.confirmed_provider_id = PEPCO_ID;
        base.confirmed_by = USER_A;
        base.confirmed_at = "2026-07-17T00:00:00.000Z";
      }
      if (status === "overridden") {
        base.requires_human_confirmation = false;
        base.confirmed_provider_id = BGE_ID;
        base.confirmed_by = USER_A;
        base.confirmed_at = "2026-07-17T00:00:00.000Z";
        base.override_reason = "Field knowledge";
        base.suggested_provider_id = PEPCO_ID;
      }
      if (status === "boundary_risk" in base === false && base.boundary_risk) {
        base.requires_human_confirmation = true;
      }
      const check = validateProviderResolutionResult(base);
      assert.equal(check.ok, true, status);
    });
  }

  it("rejects ambiguous without human confirmation", () => {
    const check = validateProviderResolutionResult(
      buildSampleResult({ status: "ambiguous", requires_human_confirmation: false }),
    );
    assert.equal(check.ok, false);
  });

  it("rejects override without reason", () => {
    const check = validateProviderResolutionResult(
      buildSampleResult({
        status: "overridden",
        confirmed_provider_id: BGE_ID,
        override_reason: "",
      }),
    );
    assert.equal(check.ok, false);
  });
});

describe("UCI D2.2 provider resolution service", () => {
  const originalTerritoryDir = process.env.UCI_TERRITORY_DATA_DIR;

  beforeEach(() => {
    clearTerritoryDatasetCache();
    process.env.UCI_TERRITORY_STORAGE_ENABLED = "false";
    process.env.UCI_TERRITORY_DATA_DIR = EMPTY_TERRITORY_DIR;
  });

  afterEach(() => {
    clearTerritoryDatasetCache();
    if (originalTerritoryDir) process.env.UCI_TERRITORY_DATA_DIR = originalTerritoryDir;
    else delete process.env.UCI_TERRITORY_DATA_DIR;
  });

  it("returns territory_data_unavailable without fake polygon matches", async () => {
    const supabase = makeResolutionSupabase();
    const addressContext = buildProviderSetupAddressContext(BASE_PROJECT);
    const result = buildTerritoryUnavailableResolution({
      serviceType: "electric",
      addressContext,
    });
    assert.equal(result.status, "territory_data_unavailable");
    assert.equal(result.suggested_provider_id, null);
    assert.deepEqual(result.candidates, []);
    assert.equal(result.requires_human_confirmation, true);
    assert.equal(await isTerritoryDataAvailableForServiceType("electric"), false);
    assert.equal(await isTerritoryDataAvailableForServiceType("gas"), false);
  });

  it("persists resolve result in portal_data without overwriting unrelated metadata", async () => {
    const supabase = makeResolutionSupabase({
      projects: [
        {
          ...BASE_PROJECT,
          portal_data: {
            location: "Scraped location",
            _permitpilot: {
              canonical_address: { formatted: "100 Main St", source: "manual" },
            },
          },
        },
      ],
    });

    const payload = await resolveProviderResolutionForProject(supabase, {
      projectId: PROJECT_A,
      userId: USER_A,
      serviceType: "electric",
      addressSourceAcknowledged: "structured",
    });

    assert.equal(payload.resolution.status, "territory_data_unavailable");
    const project = supabase.__tables.projects[0];
    assert.ok(project.portal_data._permitpilot.canonical_address);
    assert.equal(project.portal_data.location, "Scraped location");
    const stored = readProviderResolutionForServiceType(project, "electric");
    assert.equal(stored?.status, "territory_data_unavailable");
    assert.equal(stored?.notes, TERRITORY_DATA_UNAVAILABLE_MESSAGE);
  });

  it("manual confirmation stores canonical provider id and actor", async () => {
    const supabase = makeResolutionSupabase();
    await resolveProviderResolutionForProject(supabase, {
      projectId: PROJECT_A,
      userId: USER_A,
      serviceType: "electric",
    });

    const confirmed = await confirmProviderResolutionForProject(supabase, {
      projectId: PROJECT_A,
      userId: USER_A,
      serviceType: "electric",
      providerId: PEPCO_ID,
      notes: "Confirmed manually",
    });

    assert.equal(confirmed.resolution.status, "confirmed");
    assert.equal(confirmed.resolution.confirmed_provider_id, PEPCO_ID);
    assert.equal(confirmed.resolution.confirmed_by, USER_A);
    assert.ok(confirmed.resolution.confirmed_at);
    assert.equal(confirmed.resolution.resolution_method, "manual_selection");
  });

  it("override preserves original suggestion and requires reason", async () => {
    const supabase = makeResolutionSupabase();
    const projectWithSuggestion = {
      ...BASE_PROJECT,
      portal_data: buildNextPortalDataWithResolution(BASE_PROJECT, "electric", {
        ...buildSampleResult({
          status: "ambiguous",
          suggested_provider_id: PEPCO_ID,
          requires_human_confirmation: true,
          candidates: [
            {
              provider_id: PEPCO_ID,
              provider_slug: "pepco",
              display_name: "PEPCO",
              match_reason: "territory_polygon",
            },
            {
              provider_id: BGE_ID,
              provider_slug: "bge",
              display_name: "BGE",
              match_reason: "territory_polygon",
            },
          ],
        }),
      }),
    };
    supabase.__tables.projects[0] = projectWithSuggestion;

    await assert.rejects(
      () =>
        overrideProviderResolutionForProject(supabase, {
          projectId: PROJECT_A,
          userId: USER_A,
          serviceType: "electric",
          providerId: BGE_ID,
          overrideReason: "",
        }),
      (err) => err.code === "INVALID_BODY",
    );

    const overridden = await overrideProviderResolutionForProject(supabase, {
      projectId: PROJECT_A,
      userId: USER_A,
      serviceType: "electric",
      providerId: BGE_ID,
      overrideReason: "Customer account is with BGE",
    });

    assert.equal(overridden.resolution.status, "overridden");
    assert.equal(overridden.resolution.confirmed_provider_id, BGE_ID);
    assert.equal(overridden.resolution.original_suggestion?.suggested_provider_id, PEPCO_ID);
    assert.equal(overridden.resolution.candidates.length, 2);
    assert.equal(overridden.resolution.override_reason, "Customer account is with BGE");
  });

  it("rejects gas provider confirmation for electric service type", async () => {
    const supabase = makeResolutionSupabase();
    await assert.rejects(
      () =>
        confirmProviderResolutionForProject(supabase, {
          projectId: PROJECT_A,
          userId: USER_A,
          serviceType: "electric",
          providerId: "global-washgas",
        }),
      (err) => err.code === "SERVICE_TYPE_MISMATCH",
    );
  });

  it("does not fuzzy-guess unknown provider aliases", () => {
    const result = resolveProviderAlias("Dominon Energy Typo");
    assert.notEqual(result.status, "found");
  });

  it("mergeProviderResolutionIntoCoordinationMetadata preserves existing keys", () => {
    const merged = mergeProviderResolutionIntoCoordinationMetadata(
      {
        pepco_dashboard_discovery_status: "ok",
        uci_provider_mapping: { method: "human_assisted", confirmed: true },
      },
      buildSampleResult({ status: "confirmed", confirmed_provider_id: PEPCO_ID }),
    );
    assert.equal(merged.pepco_dashboard_discovery_status, "ok");
    assert.equal(merged.uci_provider_mapping.method, "human_assisted");
    assert.equal(merged.uci_provider_resolution.status, "confirmed");
  });

  it("init remains idempotent and attaches resolution snapshot without dropping mapping metadata", async () => {
    const tables = { coordination_records: [], coordination_stage_transitions: [] };
    const supabase = {
      from(table) {
        const store = tables[table] || (tables[table] = []);
        const filters = [];
        const state = { mode: "select", updatePatch: null, insertRow: null };
        const api = {
          select() {
            return api;
          },
          eq(column, value) {
            filters.push({ column, value });
            return api;
          },
          in(column, values) {
            filters.push({ column, values });
            return api;
          },
          order() {
            return api;
          },
          insert(row) {
            state.mode = "insert";
            state.insertRow = row;
            return api;
          },
          update(patch) {
            state.mode = "update";
            state.updatePatch = patch;
            return api;
          },
          single() {
            if (state.mode === "insert" && state.insertRow) {
              const copy = {
                ...state.insertRow,
                id: `${table}-${store.length + 1}`,
                metadata: state.insertRow.metadata ?? {},
              };
              store.push(copy);
              return Promise.resolve({ data: copy, error: null });
            }
            const row = store.find((r) =>
              filters.every((f) => {
                if (f.values) return f.values.includes(r[f.column]);
                return String(r[f.column]) === String(f.value);
              }),
            );
            if (row && state.mode === "update" && state.updatePatch) Object.assign(row, state.updatePatch);
            return Promise.resolve({ data: row ?? null, error: null });
          },
          then(resolve, reject) {
            if (state.mode === "update") {
              const row = store.find((r) =>
                filters.every((f) => String(r[f.column]) === String(f.value)),
              );
              if (row && state.updatePatch) Object.assign(row, state.updatePatch);
              return Promise.resolve({ data: row ?? null, error: null }).then(resolve, reject);
            }
            if (state.mode === "insert" && state.insertRow) {
              const copy = { ...state.insertRow, id: `${table}-${store.length + 1}` };
              store.push(copy);
              state.mode = "select";
              state.insertRow = null;
              return Promise.resolve({ error: null }).then(resolve, reject);
            }
            const rows = store.filter((r) =>
              filters.every((f) => {
                if (f.values) return f.values.includes(r[f.column]);
                return String(r[f.column]) === String(f.value);
              }),
            );
            return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
          },
        };
        return api;
      },
    };

    const resolutionSnapshot = buildSampleResult({
      status: "confirmed",
      confirmed_provider_id: PEPCO_ID,
      confirmed_by: USER_A,
      confirmed_at: "2026-07-17T00:00:00.000Z",
      requires_human_confirmation: false,
    });

    await initCoordinationForProviders(supabase, {
      projectId: PROJECT_A,
      userId: USER_A,
      resolvedProviders: [{ id: PEPCO_ID, slug: "pepco", utility_type: "electric" }],
      providerSetupMetadata: {
        method: "human_assisted",
        confirmed: true,
        confirmed_by_user_id: USER_A,
        confirmed_at: "2026-07-17T00:00:00.000Z",
        selected_provider_slugs: ["pepco"],
      },
      providerResolutionBySlug: { pepco: resolutionSnapshot },
    });

    const record = tables.coordination_records[0];
    assert.equal(record.metadata.uci_provider_mapping.provider_slug, "pepco");
    assert.equal(record.metadata.uci_provider_resolution.status, "confirmed");

    await initCoordinationForProviders(supabase, {
      projectId: PROJECT_A,
      userId: USER_A,
      resolvedProviders: [{ id: PEPCO_ID, slug: "pepco", utility_type: "electric" }],
      providerSetupMetadata: {
        method: "human_assisted",
        confirmed: true,
        confirmed_by_user_id: USER_A,
        confirmed_at: "2026-07-17T00:00:01.000Z",
        selected_provider_slugs: ["pepco"],
      },
      providerResolutionBySlug: { pepco: resolutionSnapshot },
    });
    assert.equal(tables.coordination_records.length, 1);
  });
});

describe("UCI D2.2 provider resolution routes", () => {
  /**
   * @param {import('http').RequestOptions} options
   * @param {string} [body]
   */
  function request(baseUrl, options, body) {
    return new Promise((resolve, reject) => {
      const req = http.request(`${baseUrl}${options.path}`, options, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {
            json = raw;
          }
          resolve({ status: res.statusCode, body: json });
        });
      });
      req.on("error", reject);
      if (body) req.write(body);
      req.end();
    });
  }

  it("GET/POST provider-resolution endpoints enforce tenant project access", async () => {
    clearTerritoryDatasetCache();
    process.env.UCI_TERRITORY_STORAGE_ENABLED = "false";
    process.env.UCI_TERRITORY_DATA_DIR = EMPTY_TERRITORY_DIR;
    const supabase = makeResolutionSupabase();
    const app = express();
    app.use(express.json());
    app.use("/api/uci", createUciRouter({ supabase }));
    const server = app.listen(0);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    try {
      const unauthorized = await request(baseUrl, {
        method: "GET",
        path: `/api/uci/projects/${PROJECT_A}/provider-resolution`,
      });
      assert.ok(unauthorized.status === 401 || unauthorized.status === 403);

      const resolveRes = await request(
        baseUrl,
        {
          method: "POST",
          path: `/api/uci/projects/${PROJECT_A}/provider-resolution/resolve`,
          headers: {
            Authorization: "Bearer userA",
            "Content-Type": "application/json",
          },
        },
        JSON.stringify({ service_type: "electric", address_source_acknowledged: "structured" }),
      );
      assert.equal(resolveRes.status, 200);
      assert.equal(resolveRes.body.resolution.status, "territory_data_unavailable");
      assert.equal(resolveRes.body.resolution.suggested_provider_id, null);

      const getRes = await request(baseUrl, {
        method: "GET",
        path: `/api/uci/projects/${PROJECT_A}/provider-resolution?service_type=electric`,
        headers: { Authorization: "Bearer userA" },
      });
      assert.equal(getRes.status, 200);
      assert.equal(getRes.body.resolutions.electric.status, "territory_data_unavailable");
    } finally {
      server.close();
    }
  });
});
