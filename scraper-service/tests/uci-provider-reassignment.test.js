"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  stripProviderSpecificMetadata,
  isProviderSpecificApplication,
  reassignCoordinationProvider,
} = require("../app/services/uci/uci-provider-reassignment.service.js");
const { LOAD_PROFILE_IDEMPOTENCY_KEY } = require("../app/services/uci/uci-load-profile.service.js");
const { APPLICATION_PACKAGE_IDEMPOTENCY_KEY } = require("../app/services/uci/uci-application-builder.service.js");

const TENANT_A = "tenant-a-0000-4000-8000-000000000101";
const PROJECT_A = "project-a";
const USER_A = "user-a";
const COORD_ID = "coord-electric-1";
const BGE_ID = "global-bge";
const DOMINION_ID = "global-dominion";

const PROVIDERS = [
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
    id: DOMINION_ID,
    slug: "dominion",
    name: "Dominion Energy Virginia",
    display_name: "Dominion Energy Virginia",
    utility_type: "electric",
    tenant_id: null,
    is_global_template: true,
    is_active: true,
  },
];

function makeReassignmentSupabase(opts = {}) {
  const tables = {
    projects: opts.projects || [
      {
        id: PROJECT_A,
        user_id: USER_A,
        tenant_id: TENANT_A,
        name: "Culpeper",
        address: "100 Main St",
        city: "Culpeper",
        state: "VA",
        zip_code: "22701",
        portal_data: {},
      },
    ],
    utility_providers: opts.providers || PROVIDERS,
    tenant_memberships: [{ tenant_id: TENANT_A, user_id: USER_A, role: "owner" }],
    tenants: [{ id: TENANT_A, is_demo: false, name: "Tenant A" }],
    coordination_records: opts.coordination_records || [
      {
        id: COORD_ID,
        project_id: PROJECT_A,
        user_id: USER_A,
        tenant_id: TENANT_A,
        utility_provider_id: BGE_ID,
        utility_type: "electric",
        scope_description: "",
        current_stage: 2,
        current_stage_state: "COMPLETED",
        metadata: {
          uci_site_address: { formatted: "100 Main St, Culpeper, VA 22701" },
          stage2_readiness: { ready: true },
          pepco_dashboard_discovery: { cards: [] },
          uci_provider_mapping: { provider_slug: "bge" },
        },
        utility_providers: PROVIDERS[0],
      },
    ],
    coordination_applications: opts.coordination_applications || [
      {
        id: "app-load-profile",
        coordination_record_id: COORD_ID,
        project_id: PROJECT_A,
        idempotency_key: LOAD_PROFILE_IDEMPOTENCY_KEY,
        provider_slug: "bge",
        load_summary: { stage2_readiness: { ready: true } },
      },
      {
        id: "app-package",
        coordination_record_id: COORD_ID,
        project_id: PROJECT_A,
        idempotency_key: APPLICATION_PACKAGE_IDEMPOTENCY_KEY,
        provider_slug: "bge",
        agent_draft_metadata: { bge_specific: true },
      },
    ],
    coordination_stage_transitions: [],
    submission_validation_attempts: [],
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
        in(col, values) {
          chain._inFilter = { col, values };
          return chain;
        },
        or() {
          chain._tenantOr = true;
          return chain;
        },
        order() {
          return chain;
        },
        delete() {
          return {
            in(col, values) {
              const before = rows.length;
              for (let i = rows.length - 1; i >= 0; i -= 1) {
                if (values.includes(rows[i][col])) rows.splice(i, 1);
              }
              return Promise.resolve({
                data: null,
                error: null,
                count: before - rows.length,
              });
            },
            then(resolve, reject) {
              return Promise.resolve({ data: null, error: null }).then(resolve, reject);
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
                    single() {
                      const idx = rows.findIndex((r) =>
                        Object.entries(chain._filters).every(([k, v]) => String(r[k]) === String(v)),
                      );
                      if (idx >= 0) rows[idx] = { ...rows[idx], ...patch };
                      return Promise.resolve({ data: rows[idx] ?? null, error: null });
                    },
                  };
                },
                then(resolve, reject) {
                  const idx = rows.findIndex((r) =>
                    Object.entries(chain._filters).every(([k, v]) => String(r[k]) === String(v)),
                  );
                  if (idx >= 0) rows[idx] = { ...rows[idx], ...patch };
                  return Promise.resolve({ data: rows[idx] ?? null, error: null }).then(resolve, reject);
                },
              };
            },
          };
        },
        maybeSingle() {
          const row = rows.find((r) =>
            Object.entries(chain._filters).every(([k, v]) => String(r[k]) === String(v)),
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
            return Object.entries(chain._filters).every(([k, v]) => String(r[k]) === String(v));
          });
          if (table === "utility_providers" && chain._tenantOr) {
            filtered = rows.filter((r) => r.is_active && r.is_global_template && r.tenant_id == null);
          }
          return Promise.resolve({ data: filtered, error: null }).then(resolve, reject);
        },
      };
      return chain;
    },
    __tables: tables,
  };
}

describe("uci-provider-reassignment helpers", () => {
  it("strips provider-specific metadata while preserving generic Stage 2 fields", () => {
    const stripped = stripProviderSpecificMetadata({
      uci_site_address: { formatted: "100 Main St" },
      stage2_readiness: { ready: true },
      pepco_dashboard_discovery: { cards: [] },
      uci_last_portal_sync_summary: { status: "idle" },
      uci_lifecycle_proposals: [{ stage: 5 }],
    });
    assert.deepEqual(stripped, {
      uci_site_address: { formatted: "100 Main St" },
      stage2_readiness: { ready: true },
    });
  });

  it("keeps load profile applications and removes provider package drafts", () => {
    assert.equal(isProviderSpecificApplication({ idempotency_key: LOAD_PROFILE_IDEMPOTENCY_KEY }, "bge"), false);
    assert.equal(
      isProviderSpecificApplication({ idempotency_key: APPLICATION_PACKAGE_IDEMPOTENCY_KEY }, "bge"),
      true,
    );
    assert.equal(isProviderSpecificApplication({ provider_slug: "bge" }, "bge"), true);
    assert.equal(isProviderSpecificApplication({ provider_slug: "dominion" }, "bge"), false);
  });
});

describe("reassignCoordinationProvider", () => {
  it("reassigns provider, preserves lifecycle stage, and removes provider-specific applications", async () => {
    const supabase = makeReassignmentSupabase();
    const originalRunBuild = require("../app/services/uci/uci-application-builder.service.js")
      .runApplicationPackageBuild;
    require("../app/services/uci/uci-application-builder.service.js").runApplicationPackageBuild = async () => ({
      id: "app-package-new",
      provider_slug: "dominion",
    });

    try {
      const result = await reassignCoordinationProvider(supabase, {
        coordinationRecordId: COORD_ID,
        userId: USER_A,
        newProviderId: DOMINION_ID,
        reason: "BGE was manually selected in error for Culpeper, VA",
      });

      assert.equal(result.coordination_record.utility_provider_id, DOMINION_ID);
      assert.equal(result.coordination_record.current_stage, 2);
      assert.equal(result.coordination_record.current_stage_state, "COMPLETED");
      assert.equal(result.removed_application_ids.length, 1);
      assert.equal(result.removed_application_ids[0], "app-package");
      assert.equal(supabase.__tables.coordination_applications.length, 1);
      assert.equal(
        supabase.__tables.coordination_applications[0].idempotency_key,
        LOAD_PROFILE_IDEMPOTENCY_KEY,
      );
      assert.equal(result.coordination_record.metadata.stage2_readiness.ready, true);
      assert.equal(result.coordination_record.metadata.pepco_dashboard_discovery, undefined);
      assert.equal(result.coordination_record.metadata.uci_provider_mapping.provider_slug, "dominion");
      assert.equal(Array.isArray(result.coordination_record.metadata.uci_provider_reassignment_history), true);
      assert.equal(result.records.length, 1);
      assert.equal(result.records[0].utility_provider_id, DOMINION_ID);
    } finally {
      require("../app/services/uci/uci-application-builder.service.js").runApplicationPackageBuild =
        originalRunBuild;
    }
  });

  it("rejects reassignment to the same provider", async () => {
    const supabase = makeReassignmentSupabase();
    await assert.rejects(
      () =>
        reassignCoordinationProvider(supabase, {
          coordinationRecordId: COORD_ID,
          userId: USER_A,
          newProviderId: BGE_ID,
          reason: "noop",
        }),
      (err) => err.code === "PROVIDER_UNCHANGED",
    );
  });
});
