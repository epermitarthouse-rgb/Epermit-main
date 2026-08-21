"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  validateApplicationTemplateManifest,
  resolveApplicationTemplateManifest,
  saveProviderApplicationTemplate,
  saveCoordinationApplicationTemplate,
  readCoordinationActiveTemplate,
  buildTemplateStorageKey,
  ACTIVE_APPLICATION_TEMPLATE_META_KEY,
} = require("../app/services/uci/uci-provider-application-template.service.js");

const DOMINION_MANUAL_TEMPLATE = {
  version: "manual-dominion-electric-v1",
  provider_slug: "dominion",
  utility_type: "electric",
  application_type: "new_service",
  description: "Operator-uploaded Dominion electric new-service checklist",
  required_documents: [
    {
      key: "load_calculation_worksheet",
      label: "Load calculation worksheet",
      aliases: ["load_worksheet", "load_calc", "load_calculation"],
    },
    {
      key: "site_plan",
      label: "Site plan",
      aliases: ["site_plan", "civil_plan", "site", "plot_plan"],
    },
    {
      key: "single_line_diagram",
      label: "Single-line diagram",
      aliases: ["single_line", "single_line_diagram", "electrical_single_line", "one_line"],
    },
  ],
  required_fields: [
    {
      key: "project_address",
      label: "Project address",
      source: "project.address",
      required: true,
    },
    {
      key: "connected_load_data",
      label: "Connected load data",
      source: "load_summary.calculated_values",
      required: true,
    },
  ],
};

function createProviderTemplateMockSupabase(initialProviders, initialCoordinationRecords = []) {
  const providers = initialProviders.map((row) => ({
    ...row,
    uci_application_templates: row.uci_application_templates ?? {},
  }));
  const coordinationRecords = initialCoordinationRecords.map((row) => ({
    metadata: {},
    ...row,
  }));

  return {
    from(table) {
      assert.ok(["utility_providers", "coordination_records"].includes(table));
      const store = table === "utility_providers" ? providers : coordinationRecords;
      const filters = [];
      const state = { mode: "select", updatePatch: null };

      const api = {
        select() {
          return api;
        },
        eq(column, value) {
          filters.push({ column, value });
          return api;
        },
        update(patch) {
          state.mode = "update";
          state.updatePatch = patch;
          return api;
        },
        maybeSingle() {
          const row = store.find((entry) =>
            filters.every((filter) => String(entry[filter.column]) === String(filter.value)),
          );
          return Promise.resolve({ data: row ?? null, error: null });
        },
        single() {
          const row = store.find((entry) =>
            filters.every((filter) => String(entry[filter.column]) === String(filter.value)),
          );
          if (row && state.mode === "update" && state.updatePatch) {
            Object.assign(row, state.updatePatch);
          }
          return Promise.resolve({ data: row ?? null, error: null });
        },
      };

      return api;
    },
    _coordinationRecords: coordinationRecords,
  };
}

function createCoordinationTemplateMockSupabase(initialProviders, initialCoordinationRecords = []) {
  return createProviderTemplateMockSupabase(initialProviders, initialCoordinationRecords);
}

describe("UCI provider application template service", () => {
  it("validates manual template manifests", () => {
    const valid = validateApplicationTemplateManifest(DOMINION_MANUAL_TEMPLATE);
    assert.equal(valid.ok, true);

    const invalid = validateApplicationTemplateManifest({ provider_slug: "dominion" });
    assert.equal(invalid.ok, false);
  });

  it("uses built-in PEPCO template before manual store", async () => {
    const supabase = createProviderTemplateMockSupabase([
      {
        id: "prov-pepco",
        slug: "pepco",
        uci_application_templates: {
          [buildTemplateStorageKey("electric")]: {
            manifest: { ...DOMINION_MANUAL_TEMPLATE, provider_slug: "pepco" },
          },
        },
      },
    ]);

    const resolved = await resolveApplicationTemplateManifest(supabase, {
      providerSlug: "pepco",
      providerId: "prov-pepco",
      utilityType: "electric",
    });

    assert.equal(resolved.resolution.source, "builtin");
    assert.equal(resolved.resolution.status, "ready");
    assert.equal(resolved.template?.provider_slug, "pepco");
  });

  it("reports dominion production template as missing until manual upload", async () => {
    const supabase = createProviderTemplateMockSupabase([
      { id: "prov-dominion", slug: "dominion", uci_application_templates: {} },
    ]);

    const missing = await resolveApplicationTemplateManifest(supabase, {
      providerSlug: "dominion",
      providerId: "prov-dominion",
      utilityType: "electric",
    });
    assert.equal(missing.template, null);
    assert.equal(missing.resolution.status, "missing");
    assert.equal(missing.resolution.generic_fallback_available, true);

    await saveProviderApplicationTemplate(supabase, {
      providerId: "prov-dominion",
      utilityType: "electric",
      manifest: DOMINION_MANUAL_TEMPLATE,
      userId: "user-1",
    });

    const ready = await resolveApplicationTemplateManifest(supabase, {
      providerSlug: "dominion",
      providerId: "prov-dominion",
      utilityType: "electric",
    });
    assert.equal(ready.resolution.source, "manual_upload");
    assert.equal(ready.resolution.status, "ready");
    assert.equal(ready.template?.provider_slug, "dominion");
  });

  it("loads dominion synthetic checklist without manual upload", async () => {
    const supabase = createProviderTemplateMockSupabase([
      { id: "prov-dominion", slug: "dominion", uci_application_templates: {} },
    ]);

    const resolved = await resolveApplicationTemplateManifest(supabase, {
      providerSlug: "dominion",
      providerId: "prov-dominion",
      utilityType: "electric",
      checklistMode: "synthetic_test",
    });

    assert.equal(resolved.resolution.source, "builtin_synthetic");
    assert.equal(resolved.template?.checklist_mode, "synthetic_test");
  });

  it("ignores global provider template when coordination context has no activation", async () => {
    const supabase = createCoordinationTemplateMockSupabase(
      [
        {
          id: "prov-dominion",
          slug: "dominion",
          uci_application_templates: {
            [buildTemplateStorageKey("electric")]: { manifest: DOMINION_MANUAL_TEMPLATE },
          },
        },
      ],
      [
        {
          id: "coord-portsmouth",
          utility_type: "electric",
          utility_provider_id: "prov-dominion",
          metadata: { uci_provider_mapping: { provider_slug: "dominion" } },
        },
      ],
    );

    const missing = await resolveApplicationTemplateManifest(supabase, {
      providerSlug: "dominion",
      providerId: "prov-dominion",
      utilityType: "electric",
      coordinationMetadata: {},
    });
    assert.equal(missing.template, null);
    assert.equal(missing.resolution.status, "missing");
    assert.equal(missing.resolution.coordination_scoped, true);
  });

  it("activates coordination-scoped template and exposes required document slots", async () => {
    const coordinationRecord = {
      id: "coord-portsmouth",
      utility_type: "electric",
      utility_provider_id: "prov-dominion",
      metadata: { uci_provider_mapping: { provider_slug: "dominion" } },
      utility_providers: { slug: "dominion" },
    };
    const supabase = createCoordinationTemplateMockSupabase(
      [{ id: "prov-dominion", slug: "dominion", uci_application_templates: {} }],
      [coordinationRecord],
    );

    await saveCoordinationApplicationTemplate(supabase, {
      coordinationId: "coord-portsmouth",
      record: coordinationRecord,
      utilityType: "electric",
      userId: "user-demo",
      manifest: DOMINION_MANUAL_TEMPLATE,
    });

    const updatedRecord = supabase._coordinationRecords[0];
    assert.ok(updatedRecord.metadata[ACTIVE_APPLICATION_TEMPLATE_META_KEY]);

    const ready = await resolveApplicationTemplateManifest(supabase, {
      providerSlug: "dominion",
      providerId: "prov-dominion",
      utilityType: "electric",
      coordinationMetadata: updatedRecord.metadata,
    });
    assert.equal(ready.resolution.source, "coordination_manual");
    assert.equal(ready.resolution.status, "ready");
    assert.equal(ready.template?.required_documents?.length, 3);

    const active = readCoordinationActiveTemplate(updatedRecord.metadata, "electric");
    assert.equal(active?.manifest.provider_slug, "dominion");
  });

  it("rejects coordination template when provider_slug mismatches", async () => {
    const coordinationRecord = {
      id: "coord-portsmouth",
      utility_type: "electric",
      utility_provider_id: "prov-dominion",
      metadata: { uci_provider_mapping: { provider_slug: "dominion" } },
      utility_providers: { slug: "dominion" },
    };
    const supabase = createCoordinationTemplateMockSupabase(
      [{ id: "prov-dominion", slug: "dominion", uci_application_templates: {} }],
      [coordinationRecord],
    );

    await assert.rejects(
      () =>
        saveCoordinationApplicationTemplate(supabase, {
          coordinationId: "coord-portsmouth",
          record: coordinationRecord,
          utilityType: "electric",
          userId: "user-demo",
          manifest: { ...DOMINION_MANUAL_TEMPLATE, provider_slug: "pepco" },
        }),
      (err) => err.code === "TEMPLATE_PROVIDER_MISMATCH",
    );
  });
});
