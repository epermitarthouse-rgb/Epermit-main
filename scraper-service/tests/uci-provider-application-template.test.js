"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  validateApplicationTemplateManifest,
  resolveApplicationTemplateManifest,
  saveProviderApplicationTemplate,
  buildTemplateStorageKey,
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

function createProviderTemplateMockSupabase(initialProviders) {
  const providers = initialProviders.map((row) => ({
    ...row,
    uci_application_templates: row.uci_application_templates ?? {},
  }));

  return {
    from(table) {
      assert.equal(table, "utility_providers");
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
          const row = providers.find((entry) =>
            filters.every((filter) => String(entry[filter.column]) === String(filter.value)),
          );
          return Promise.resolve({ data: row ?? null, error: null });
        },
        single() {
          const row = providers.find((entry) =>
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
  };
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
});
