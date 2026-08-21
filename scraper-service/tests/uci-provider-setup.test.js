"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildProviderSetupAddressContext,
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
  it("uses structured address when street address is present", () => {
    const ctx = buildProviderSetupAddressContext({
      address: "123 Main St",
      city: "Washington",
      state: "DC",
      zip_code: "20001",
      jurisdiction: "Washington DC",
      portal_data: { location: "Fallback Sheridan Rd" },
    });

    assert.equal(ctx.recommended_address_source, "structured");
    assert.equal(ctx.address.source, "structured");
    assert.equal(ctx.address.formatted, "123 Main St, Washington, DC, 20001");
    assert.equal(ctx.address.complete, true);
    assert.equal(ctx.address_mismatch, true);
  });

  it("uses portal_data.location when structured street is empty", () => {
    const ctx = buildProviderSetupAddressContext({
      address: null,
      city: null,
      state: null,
      zip_code: null,
      portal_data: { location: "Sheridan Rd NW, Washington DC" },
    });

    assert.equal(ctx.recommended_address_source, "portal_data_location");
    assert.equal(ctx.canonical_source, "jurisdiction_scrape");
    assert.equal(ctx.address.source, "portal_data_location");
    assert.equal(ctx.address.formatted, "Sheridan Rd NW, Washington DC");
    assert.equal(ctx.address.fallback_used, false);
  });

  it("does not prefer jurisdiction-only structured fields over scraped location", () => {
    const ctx = buildProviderSetupAddressContext({
      address: "",
      city: "",
      jurisdiction: "Washington DC",
      portal_data: { location: "Sheridan Rd NW, Washington DC" },
    });

    assert.equal(ctx.recommended_address_source, "portal_data_location");
    assert.equal(ctx.canonical_source, "jurisdiction_scrape");
    assert.equal(ctx.address.source, "portal_data_location");
  });

  it("returns none when no address sources exist", () => {
    const ctx = buildProviderSetupAddressContext({
      address: "",
      city: "",
      portal_data: {},
    });

    assert.equal(ctx.recommended_address_source, "none");
    assert.equal(ctx.address.formatted, null);
  });

  it("reads portal_data.location from JSON-string portal_data blobs", () => {
    const ctx = buildProviderSetupAddressContext({
      address: "",
      portal_data: JSON.stringify({ location: "Sheridan Rd NW, Washington DC" }),
    });
    assert.equal(ctx.recommended_address_source, "portal_data_location");
    assert.equal(ctx.address.formatted, "Sheridan Rd NW, Washington DC");
  });

  it("resolveApplicationPackageAddress honors coordination-record acknowledged source", () => {
    const {
      resolveApplicationPackageAddress,
    } = require("../app/services/uci/uci-provider-setup.service.js");
    const resolution = resolveApplicationPackageAddress(
      {
        address: "100 Old Main St",
        city: "Washington",
        state: "DC",
        portal_data: { location: "200 Sheridan Rd NW, Washington DC" },
      },
      {
        metadata: {
          uci_provider_mapping: {
            address_source_acknowledged: "portal_data_location",
          },
        },
      },
    );
    assert.equal(resolution.address.formatted, "200 Sheridan Rd NW, Washington DC");
    assert.equal(resolution.address_source, "portal_data_location");
    assert.equal(resolution.address_mismatch, true);
    assert.equal(resolution.address_review_required, false);
  });

  it("legacy resolveProjectAddressForProviderSetup matches recommended source", () => {
    const address = resolveProjectAddressForProviderSetup({
      address: "123 Main St",
      city: "Washington",
      state: "DC",
      portal_data: { location: "Different" },
    });
    assert.equal(address.source, "structured");
  });

  it("builds human-assisted mapping metadata with confirmed flag", () => {
    const ctx = buildProviderSetupAddressContext({
      address: "1 Demo Way",
      city: "Baltimore",
      state: "MD",
      zip_code: "21201",
    });
    const metadata = buildHumanAssistedMappingMetadata({
      userId: "user-1",
      confirmedAt: "2026-07-14T12:00:00.000Z",
      address: ctx.address,
      selectedProviderSlugs: ["pepco"],
      unresolvedUtilityTypes: ["gas"],
      addressSourceAcknowledged: "structured",
      addressMismatch: false,
    });

    assert.equal(metadata.method, PROVIDER_SETUP_METHOD);
    assert.equal(metadata.confirmed, true);
    assert.equal(metadata.confirmed_by_user_id, "user-1");
    assert.equal(metadata.address_source_acknowledged, "structured");
    assert.deepEqual(metadata.selected_provider_slugs, ["pepco"]);
    assert.deepEqual(metadata.unresolved_utility_types, ["gas"]);
    assert.equal(metadata.territory_matching_available, false);
  });

  it("requires provider_setup object", () => {
    const ctx = buildProviderSetupAddressContext({ address: "1 Demo Way" });
    assert.throws(
      () => parseProviderSetupConfirmation(null, ctx),
      (err) => err.code === "PROVIDER_SETUP_REQUIRED",
    );
  });

  it("requires provider_setup.confirmed=true", () => {
    const ctx = buildProviderSetupAddressContext({ address: "1 Demo Way" });
    assert.throws(
      () =>
        parseProviderSetupConfirmation(
          { confirmed: false, address_source_acknowledged: "structured" },
          ctx,
        ),
      (err) => err.code === "INVALID_BODY",
    );
  });

  it("requires address_source_acknowledged", () => {
    const ctx = buildProviderSetupAddressContext({
      portal_data: { location: "Fallback only" },
    });
    assert.throws(
      () => parseProviderSetupConfirmation({ confirmed: true }, ctx),
      (err) => err.code === "INVALID_BODY",
    );

    const parsed = parseProviderSetupConfirmation(
      { confirmed: true, address_source_acknowledged: "portal_data_location" },
      ctx,
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
    assert.ok(Array.isArray(context.available_address_sources));
    assert.deepEqual(context.utility_types_in_catalog, [
      "electric",
      "gas",
      "water",
      "sewer",
      "telecom",
    ]);
  });

  it("marks already initialized providers without auto-selecting them", () => {
    const context = buildProviderSetupContext({
      project: { address: "100 Test Ave" },
      providers: [{ id: "prov-1", slug: "pepco", name: "PEPCO", utility_type: "electric" }],
      existingRecords: [
        {
          utility_providers: { slug: "pepco" },
          current_stage: 1,
          current_stage_state: "COMPLETED",
        },
      ],
    });

    assert.equal(context.providers[0].already_initialized, true);
    assert.equal(context.providers[0].suggested, false);
  });

  it("keeps Stage 1 NOT_STARTED providers selectable in setup", () => {
    const context = buildProviderSetupContext({
      project: { address: "100 Test Ave" },
      providers: [{ id: "prov-1", slug: "dominion", name: "Dominion", utility_type: "electric" }],
      existingRecords: [
        {
          utility_providers: { slug: "dominion" },
          current_stage: 1,
          current_stage_state: "NOT_STARTED",
        },
      ],
    });

    assert.equal(context.providers[0].already_initialized, false);
  });

  it("normalizes unresolved utility types", () => {
    assert.deepEqual(
      normalizeUnresolvedUtilityTypes([" Gas ", "GAS", "", "water"]),
      ["gas", "water"],
    );
  });

  it("rejects unsupported unresolved utility types instead of collapsing them", () => {
    assert.throws(
      () => normalizeUnresolvedUtilityTypes(["steam"]),
      (err) => err.code === "UNSUPPORTED_UTILITY_TYPE",
    );
  });

  it("mergeProviderMappingMetadata stamps per-provider slug", () => {
    const merged = mergeProviderMappingMetadata(
      { pepco_dashboard_discovery_status: "ok" },
      {
        method: PROVIDER_SETUP_METHOD,
        confirmed: true,
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
        maybeSingle() {
          return api.single();
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
  it("requires provider setup metadata", async () => {
    const supabase = createInitMockSupabase({
      coordination_records: [],
      coordination_stage_transitions: [],
    });

    await assert.rejects(
      () =>
        initCoordinationForProviders(supabase, {
          projectId: "proj-1",
          userId: "user-1",
          resolvedProviders: [{ id: "prov-1", slug: "pepco", utility_type: "electric" }],
          providerSetupMetadata: null,
        }),
      (err) => err.code === "PROVIDER_SETUP_REQUIRED",
    );
  });

  it("persists mapping metadata on new records and init transitions", async () => {
    const tables = {
      coordination_records: [],
      coordination_stage_transitions: [],
    };
    const supabase = createInitMockSupabase(tables);
    const mappingMetadata = {
      method: PROVIDER_SETUP_METHOD,
      confirmed: true,
      confirmed_by_user_id: "user-1",
      confirmed_at: "2026-07-14T12:00:00.000Z",
      address_source: "structured",
      address_source_acknowledged: "structured",
      selected_provider_slugs: ["pepco"],
      unresolved_utility_types: [],
      territory_matching_available: false,
    };

    const result = await initCoordinationForProviders(supabase, {
      projectId: "proj-1",
      userId: "user-1",
      resolvedProviders: [{ id: "prov-1", slug: "pepco", utility_type: "electric" }],
      providerSetupMetadata: mappingMetadata,
    });

    assert.equal(result.created.length, 1);
    const record = tables.coordination_records[0];
    assert.equal(record.metadata.uci_provider_mapping.provider_slug, "pepco");
    assert.equal(record.metadata.uci_provider_mapping.confirmed, true);

    const transition = tables.coordination_stage_transitions[0];
    assert.equal(transition.metadata.uci_provider_mapping.method, PROVIDER_SETUP_METHOD);
  });

  it("creates exactly one record for a single selected electric provider", async () => {
    const tables = {
      coordination_records: [],
      coordination_stage_transitions: [],
    };
    const supabase = createInitMockSupabase(tables);
    const result = await initCoordinationForProviders(supabase, {
      projectId: "proj-portsmouth",
      userId: "user-1",
      resolvedProviders: [{ id: "dom-id", slug: "dominion-energy-virginia", utility_type: "electric" }],
      providerSetupMetadata: {
        method: PROVIDER_SETUP_METHOD,
        confirmed: true,
        confirmed_by_user_id: "user-1",
        confirmed_at: "2026-08-21T12:00:00.000Z",
        address_source: "structured",
        address_source_acknowledged: "structured",
        selected_provider_slugs: ["dominion-energy-virginia"],
        unresolved_utility_types: [],
        territory_matching_available: false,
      },
    });
    assert.equal(result.created.length, 1);
    assert.equal(tables.coordination_records.length, 1);
    assert.equal(tables.coordination_records[0].utility_type, "electric");
  });

  it("initializes separate provider/type records across all supported utility types", async () => {
    const tables = {
      coordination_records: [],
      coordination_stage_transitions: [],
    };
    const supabase = createInitMockSupabase(tables);
    const utilityTypes = ["electric", "gas", "water", "sewer", "telecom"];
    const resolvedProviders = utilityTypes.map((utilityType) => ({
      id: `provider-${utilityType}`,
      slug: `provider-${utilityType}`,
      utility_type: utilityType,
    }));
    const result = await initCoordinationForProviders(supabase, {
      projectId: "any-project",
      userId: "user-1",
      resolvedProviders,
      providerSetupMetadata: {
        method: PROVIDER_SETUP_METHOD,
        confirmed: true,
        confirmed_by_user_id: "user-1",
        confirmed_at: "2026-08-14T12:00:00.000Z",
        address_source: "structured",
        address_source_acknowledged: "structured",
        selected_provider_slugs: resolvedProviders.map((provider) => provider.slug),
        unresolved_utility_types: [],
        territory_matching_available: false,
      },
    });
    assert.equal(result.created.length, utilityTypes.length);
    assert.deepEqual(
      tables.coordination_records.map((record) => record.utility_type),
      utilityTypes,
    );
    assert.equal(tables.coordination_stage_transitions.length, utilityTypes.length);
  });

  it("remains idempotent and updates metadata on already existed records", async () => {
    const tables = {
      coordination_records: [
        {
          id: "coord-existing",
          project_id: "proj-1",
          utility_provider_id: "prov-1",
          utility_type: "electric",
          scope_description: "",
          current_stage: 1,
          current_stage_state: "COMPLETED",
          metadata: {},
        },
      ],
      coordination_stage_transitions: [],
    };
    const supabase = createInitMockSupabase(tables);
    const mappingMetadata = {
      method: PROVIDER_SETUP_METHOD,
      confirmed: true,
      confirmed_by_user_id: "user-1",
      confirmed_at: "2026-07-14T12:30:00.000Z",
      address_source: "none",
      address_source_acknowledged: "none",
      selected_provider_slugs: ["pepco"],
      unresolved_utility_types: ["gas"],
      territory_matching_available: false,
    };

    const result = await initCoordinationForProviders(supabase, {
      projectId: "proj-1",
      userId: "user-1",
      resolvedProviders: [{ id: "prov-1", slug: "pepco", utility_type: "electric" }],
      providerSetupMetadata: mappingMetadata,
    });

    assert.equal(result.created.length, 0);
    assert.equal(result.already_existed.length, 1);
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

  it("initializes existing Stage 1 NOT_STARTED records without creating duplicates", async () => {
    const tables = {
      coordination_records: [
        {
          id: "coord-clean-slate",
          project_id: "proj-1",
          utility_provider_id: "prov-1",
          utility_type: "electric",
          scope_description: "",
          current_stage: 1,
          current_stage_state: "NOT_STARTED",
          metadata: { uci_provider_resolution: { status: "confirmed" } },
        },
      ],
      coordination_stage_transitions: [],
    };
    const supabase = createInitMockSupabase(tables);
    const mappingMetadata = {
      method: PROVIDER_SETUP_METHOD,
      confirmed: true,
      confirmed_by_user_id: "user-1",
      confirmed_at: "2026-08-21T12:00:00.000Z",
      address_source: "structured",
      address_source_acknowledged: "structured",
      selected_provider_slugs: ["dominion"],
      unresolved_utility_types: [],
      territory_matching_available: false,
    };

    const result = await initCoordinationForProviders(supabase, {
      projectId: "proj-1",
      userId: "user-1",
      resolvedProviders: [{ id: "prov-1", slug: "dominion", utility_type: "electric" }],
      providerSetupMetadata: mappingMetadata,
    });

    assert.equal(tables.coordination_records.length, 1);
    assert.equal(result.created.length, 1);
    assert.equal(result.already_existed.length, 0);
    assert.equal(tables.coordination_records[0].current_stage_state, "COMPLETED");
    assert.equal(tables.coordination_stage_transitions.length, 1);
    assert.equal(tables.coordination_stage_transitions[0].to_stage, 1);
    assert.equal(tables.coordination_stage_transitions[0].to_state, "COMPLETED");
    assert.equal(
      tables.coordination_records[0].metadata.uci_provider_mapping.confirmed_at,
      "2026-08-21T12:00:00.000Z",
    );

    const repeat = await initCoordinationForProviders(supabase, {
      projectId: "proj-1",
      userId: "user-1",
      resolvedProviders: [{ id: "prov-1", slug: "dominion", utility_type: "electric" }],
      providerSetupMetadata: mappingMetadata,
    });
    assert.equal(repeat.created.length, 0);
    assert.equal(repeat.already_existed.length, 1);
    assert.equal(tables.coordination_stage_transitions.length, 1);
  });
});
