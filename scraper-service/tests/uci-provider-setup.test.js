"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveProjectAddressForProviderSetup,
  buildHumanAssistedMappingMetadata,
  parseProviderSetupConfirmation,
  buildProviderSetupContext,
  normalizeUnresolvedUtilityTypes,
  PROVIDER_SETUP_METHOD,
  TERRITORY_MATCHING_UNAVAILABLE_MESSAGE,
} = require("../app/services/uci/uci-provider-setup.service.js");
const {
  initCoordinationForProviders,
  mergeProviderMappingMetadata,
} = require("../app/services/uci/uci-records.service.js");

describe("UCI D2.0 human-assisted provider setup", () => {
  it("prefers structured project address over portal_data.location", () => {
    const address = resolveProjectAddressForProviderSetup({
      address: "123 Main St",
      city: "Washington",
      state: "DC",
      zip_code: "20001",
      jurisdiction: "Washington DC",
      portal_data: { location: "Fallback Sheridan Rd" },
    });

    assert.equal(address.source, "structured");
    assert.equal(address.formatted, "123 Main St, Washington, DC, 20001");
    assert.equal(address.complete, true);
    assert.equal(address.fallback_used, false);
  });

  it("uses portal_data.location only when structured fields are empty", () => {
    const address = resolveProjectAddressForProviderSetup({
      address: null,
      city: null,
      state: null,
      zip_code: null,
      portal_data: { location: "Sheridan Rd NW, Washington DC" },
    });

    assert.equal(address.source, "portal_data_location");
    assert.equal(address.formatted, "Sheridan Rd NW, Washington DC");
    assert.equal(address.fallback_used, true);
    assert.match(String(address.fallback_note || ""), /portal_data\.location/i);
  });

  it("returns none when no address sources exist", () => {
    const address = resolveProjectAddressForProviderSetup({
      address: "",
      city: "",
      portal_data: {},
    });

    assert.equal(address.source, "none");
    assert.equal(address.formatted, null);
    assert.equal(address.complete, false);
  });

  it("builds human-assisted mapping metadata without territory matching", () => {
    const address = resolveProjectAddressForProviderSetup({
      address: "1 Demo Way",
      city: "Baltimore",
      state: "MD",
      zip_code: "21201",
    });
    const metadata = buildHumanAssistedMappingMetadata({
      userId: "user-1",
      confirmedAt: "2026-07-14T12:00:00.000Z",
      address,
      selectedProviderSlugs: ["pepco"],
      unresolvedUtilityTypes: ["gas"],
    });

    assert.equal(metadata.method, PROVIDER_SETUP_METHOD);
    assert.equal(metadata.confirmed_by_user_id, "user-1");
    assert.equal(metadata.address_source, "structured");
    assert.deepEqual(metadata.selected_provider_slugs, ["pepco"]);
    assert.deepEqual(metadata.unresolved_utility_types, ["gas"]);
    assert.equal(metadata.territory_matching_available, false);
  });

  it("requires provider_setup.confirmed=true", () => {
    const address = resolveProjectAddressForProviderSetup({ address: "1 Demo Way" });
    assert.throws(
      () => parseProviderSetupConfirmation({ confirmed: false }, address),
      (err) => err.code === "INVALID_BODY",
    );
  });

  it("validates address_source_acknowledged when supplied", () => {
    const address = resolveProjectAddressForProviderSetup({
      portal_data: { location: "Fallback only" },
    });
    assert.throws(
      () =>
        parseProviderSetupConfirmation(
          { confirmed: true, address_source_acknowledged: "structured" },
          address,
        ),
      (err) => err.code === "INVALID_BODY",
    );

    const parsed = parseProviderSetupConfirmation(
      { confirmed: true, address_source_acknowledged: "portal_data_location" },
      address,
    );
    assert.deepEqual(parsed.unresolvedUtilityTypes, []);
  });

  it("does not auto-suggest providers in setup context", () => {
    const context = buildProviderSetupContext({
      project: {
        address: "100 Test Ave",
        city: "Arlington",
        state: "VA",
        zip_code: "22201",
      },
      providers: [
        {
          id: "prov-1",
          slug: "pepco",
          name: "PEPCO",
          utility_type: "electric",
          automation_status: "partial",
        },
      ],
      existingRecords: [],
    });

    assert.equal(context.mapping_method, PROVIDER_SETUP_METHOD);
    assert.equal(context.territory_matching_available, false);
    assert.equal(context.auto_selection_enabled, false);
    assert.equal(context.territory_matching_message, TERRITORY_MATCHING_UNAVAILABLE_MESSAGE);
    assert.equal(context.providers[0].suggested, false);
    assert.equal(context.providers[0].already_initialized, false);
  });

  it("marks already initialized providers without auto-selecting them", () => {
    const context = buildProviderSetupContext({
      project: { address: "100 Test Ave" },
      providers: [{ id: "prov-1", slug: "pepco", name: "PEPCO", utility_type: "electric" }],
      existingRecords: [{ utility_providers: { slug: "pepco" } }],
    });

    assert.equal(context.providers[0].already_initialized, true);
    assert.equal(context.providers[0].suggested, false);
  });

  it("normalizes unresolved utility types", () => {
    assert.deepEqual(
      normalizeUnresolvedUtilityTypes([" Gas ", "GAS", "", "water"]),
      ["gas", "water"],
    );
  });

  it("mergeProviderMappingMetadata stamps per-provider slug", () => {
    const merged = mergeProviderMappingMetadata(
      { pepco_dashboard_discovery_status: "ok" },
      {
        method: PROVIDER_SETUP_METHOD,
        confirmed_by_user_id: "user-1",
        confirmed_at: "2026-07-14T12:00:00.000Z",
        selected_provider_slugs: ["pepco"],
      },
      "pepco",
    );

    assert.equal(merged.pepco_dashboard_discovery_status, "ok");
    assert.equal(merged.uci_provider_mapping.provider_slug, "pepco");
    assert.equal(merged.uci_provider_mapping.method, PROVIDER_SETUP_METHOD);
  });
});

/**
 * @param {Record<string, Array<Record<string, unknown>>>} tables
 */
function createInitMockSupabase(tables) {
  return {
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
          if (row && state.mode === "update" && state.updatePatch) {
            Object.assign(row, state.updatePatch);
          }
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
            const copy = {
              ...state.insertRow,
              id: `${table}-${store.length + 1}`,
            };
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
}

describe("UCI D2.0 initCoordinationForProviders metadata", () => {
  it("persists mapping metadata on new records and init transitions", async () => {
    const tables = {
      coordination_records: [],
      coordination_stage_transitions: [],
    };
    const supabase = createInitMockSupabase(tables);
    const mappingMetadata = {
      method: PROVIDER_SETUP_METHOD,
      confirmed_by_user_id: "user-1",
      confirmed_at: "2026-07-14T12:00:00.000Z",
      address_source: "structured",
      selected_provider_slugs: ["pepco"],
      unresolved_utility_types: [],
      territory_matching_available: false,
    };

    const result = await initCoordinationForProviders(supabase, {
      projectId: "proj-1",
      userId: "user-1",
      resolvedProviders: [
        { id: "prov-1", slug: "pepco", utility_type: "electric" },
      ],
      providerSetupMetadata: mappingMetadata,
    });

    assert.equal(result.created.length, 1);
    const record = tables.coordination_records[0];
    assert.equal(record.metadata.uci_provider_mapping.provider_slug, "pepco");
    assert.equal(record.metadata.uci_provider_mapping.method, PROVIDER_SETUP_METHOD);

    const transition = tables.coordination_stage_transitions[0];
    assert.equal(transition.metadata.uci_provider_mapping.method, PROVIDER_SETUP_METHOD);
  });

  it("remains idempotent and updates metadata on already existed records", async () => {
    const tables = {
      coordination_records: [
        {
          id: "coord-existing",
          project_id: "proj-1",
          utility_provider_id: "prov-1",
          scope_description: "",
          metadata: {},
        },
      ],
      coordination_stage_transitions: [],
    };
    const supabase = createInitMockSupabase(tables);
    const mappingMetadata = {
      method: PROVIDER_SETUP_METHOD,
      confirmed_by_user_id: "user-1",
      confirmed_at: "2026-07-14T12:30:00.000Z",
      address_source: "none",
      selected_provider_slugs: ["pepco"],
      unresolved_utility_types: ["gas"],
      territory_matching_available: false,
    };

    const result = await initCoordinationForProviders(supabase, {
      projectId: "proj-1",
      userId: "user-1",
      resolvedProviders: [
        { id: "prov-1", slug: "pepco", utility_type: "electric" },
      ],
      providerSetupMetadata: mappingMetadata,
    });

    assert.equal(result.created.length, 0);
    assert.equal(result.already_existed.length, 1);
    assert.equal(tables.coordination_records.length, 1);
    assert.equal(
      tables.coordination_records[0].metadata.uci_provider_mapping.confirmed_at,
      "2026-07-14T12:30:00.000Z",
    );
    assert.deepEqual(
      tables.coordination_records[0].metadata.uci_provider_mapping.unresolved_utility_types,
      ["gas"],
    );
    assert.equal(tables.coordination_stage_transitions.length, 0);
  });
});
