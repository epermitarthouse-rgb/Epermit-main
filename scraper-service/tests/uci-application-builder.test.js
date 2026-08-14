"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  validateProviderContext,
  loadTemplateManifest,
  findLoadProfileDraftApplication,
  matchRequiredDocuments,
  evaluateRequiredFields,
  resolvePackageStatus,
  runApplicationPackageBuild,
  reviewApplicationPackage,
  inferSignatureStatus,
  APPLICATION_PACKAGE_IDEMPOTENCY_KEY,
} = require("../app/services/uci/uci-application-builder.service.js");
const { LOAD_PROFILE_IDEMPOTENCY_KEY } = require("../app/services/uci/uci-load-profile.service.js");
const { PROVIDER_SETUP_METHOD } = require("../app/services/uci/uci-provider-setup.service.js");

const BASE_PROJECT = {
  id: "proj-1",
  project_type: "tenant_improvement",
  description: "QSR fit-out",
  address: "100 Main St",
  city: "Washington",
  state: "DC",
  zip_code: "20001",
};

const HUMAN_ASSISTED_RECORD = {
  id: "coord-1",
  project_id: "proj-1",
  utility_provider_id: "prov-1",
  utility_type: "electric",
  current_stage: 2,
  current_stage_state: "IN_PROGRESS",
  metadata: {
    uci_provider_mapping: {
      method: "human_assisted",
      provider_slug: "pepco",
    },
  },
  utility_providers: { slug: "pepco", name: "PEPCO" },
};

const LOAD_PROFILE_DRAFT = {
  id: "app-load-1",
  record_source: "agent_draft",
  idempotency_key: LOAD_PROFILE_IDEMPOTENCY_KEY,
  application_type: "load_profile",
  load_summary: {
    version: "d2.1-v1",
    utility_type: "electric",
    analysis_status: "missing_inputs",
    calculated_values: {},
    missing_inputs: ["connected_equipment_or_load_data"],
    inputs_used: [],
    needs_verification: [],
    assumptions: { template_id: null, template_version: null, notes: [] },
    source_documents: [],
    generated_at: "2026-07-14T12:00:00.000Z",
    generated_by: "agent_2_load_profile",
    requires_human_review: true,
  },
};

describe("UCI D3 application builder service", () => {
  it("loads PEPCO electric template manifest from repo registry", () => {
    const template = loadTemplateManifest("pepco", "electric");
    assert.ok(template);
    assert.equal(template.provider_slug, "pepco");
    assert.equal(template.utility_type, "electric");
    assert.ok(Array.isArray(template.required_documents));
    assert.ok(Array.isArray(template.required_fields));
  });

  it("loads Dominion synthetic checklist only when explicitly requested", () => {
    assert.equal(loadTemplateManifest("dominion", "electric"), null);
    const template = loadTemplateManifest("dominion", "electric", {
      checklistMode: "synthetic_test",
    });
    assert.ok(template);
    assert.equal(template.authoritative, false);
    assert.equal(template.checklist_mode, "synthetic_test");
    assert.match(String(template.label), /NOT DOMINION PROVIDED/);
  });

  it("recognizes underscore-delimited unsigned synthetic filenames", () => {
    assert.equal(inferSignatureStatus("06_Synthetic_LOA_UNSIGNED.pdf"), "unsigned");
  });

  it("rejects missing provider context", () => {
    const result = validateProviderContext({ utility_type: "electric" });
    assert.equal(result.ok, false);
    assert.equal(result.code, "PROVIDER_CONTEXT_REQUIRED");
  });

  it("accepts human-assisted coordination with provider slug", () => {
    const result = validateProviderContext(HUMAN_ASSISTED_RECORD);
    assert.equal(result.ok, true);
    assert.equal(result.providerSlug, "pepco");
  });

  it("finds load profile draft among applications", () => {
    const found = findLoadProfileDraftApplication([
      { record_source: "portal_sync", idempotency_key: null },
      LOAD_PROFILE_DRAFT,
    ]);
    assert.equal(found?.id, "app-load-1");
  });

  it("matches project documents by template aliases", () => {
    const template = loadTemplateManifest("pepco", "electric");
    const required = /** @type {Array<Record<string, unknown>>} */ (template.required_documents);
    const result = matchRequiredDocuments(
      [
        { id: "doc-1", document_type: "site_plan", file_name: "site.pdf" },
        { id: "doc-2", document_type: "single_line", file_name: "sld.pdf" },
      ],
      required,
    );
    assert.ok(result.packageDocuments.some((d) => d.key === "site_plan" && d.status === "attached"));
    assert.ok(result.packageDocuments.some((d) => d.key === "single_line_diagram" && d.status === "attached"));
    assert.ok(result.missingDocuments.includes("equipment_cut_sheets"));
    assert.ok(result.missingDocuments.includes("letter_of_authorization"));
  });

  it("flags missing engineering fields without inventing values", () => {
    const template = loadTemplateManifest("pepco", "electric");
    const required = /** @type {Array<Record<string, unknown>>} */ (template.required_fields);
    const result = evaluateRequiredFields(
      BASE_PROJECT,
      LOAD_PROFILE_DRAFT.load_summary,
      required,
    );
    assert.ok(result.fieldResults.some((f) => f.key === "project_address" && f.status === "present"));
    assert.ok(result.missingFields.includes("connected_load_data"));
    const loadField = result.fieldResults.find((f) => f.key === "connected_load_data");
    assert.equal(loadField?.value, null);
  });

  it("uses portal_data.location when structured street is empty", () => {
    const template = loadTemplateManifest("pepco", "electric");
    const required = /** @type {Array<Record<string, unknown>>} */ (template.required_fields);
    const result = evaluateRequiredFields(
      {
        project_type: "tenant_improvement",
        description: "QSR fit-out",
        address: "",
        portal_data: { location: "200 Sheridan Rd NW, Washington DC" },
      },
      LOAD_PROFILE_DRAFT.load_summary,
      required,
    );
    const addressField = result.fieldResults.find((f) => f.key === "project_address");
    assert.equal(addressField?.status, "present");
    assert.equal(addressField?.value, "200 Sheridan Rd NW, Washington DC");
    assert.equal(addressField?.address_source, "jurisdiction_scrape");
    assert.equal(result.missingFields.includes("project_address"), false);
    assert.equal(result.addressResolution.canonical_address_source, "jurisdiction_scrape");
    assert.equal(result.addressResolution.address_source, "portal_data_location");
  });

  it("parses JSON-string portal_data.location for application package address", () => {
    const template = loadTemplateManifest("pepco", "electric");
    const required = /** @type {Array<Record<string, unknown>>} */ (template.required_fields);
    const result = evaluateRequiredFields(
      {
        project_type: "tenant_improvement",
        address: "",
        portal_data: JSON.stringify({ location: "Sheridan Rd NW, Washington DC" }),
      },
      LOAD_PROFILE_DRAFT.load_summary,
      required,
    );
    const addressField = result.fieldResults.find((f) => f.key === "project_address");
    assert.equal(addressField?.status, "present");
    assert.equal(addressField?.address_source, "jurisdiction_scrape");
  });

  it("uses acknowledged portal_data source when structured and scraped addresses differ", () => {
    const template = loadTemplateManifest("pepco", "electric");
    const required = /** @type {Array<Record<string, unknown>>} */ (template.required_fields);
    const record = {
      metadata: {
        uci_provider_mapping: {
          method: PROVIDER_SETUP_METHOD,
          address_source_acknowledged: "portal_data_location",
        },
      },
    };
    const result = evaluateRequiredFields(
      {
        project_type: "tenant_improvement",
        address: "100 Old Main St",
        city: "Washington",
        state: "DC",
        portal_data: { location: "200 Sheridan Rd NW, Washington DC" },
      },
      LOAD_PROFILE_DRAFT.load_summary,
      required,
      record,
    );
    const addressField = result.fieldResults.find((f) => f.key === "project_address");
    assert.equal(addressField?.status, "present");
    assert.equal(addressField?.value, "200 Sheridan Rd NW, Washington DC");
    assert.equal(addressField?.address_source, "portal_data_location");
    assert.equal(result.addressResolution.address_mismatch, true);
    assert.equal(result.addressResolution.address_review_required, false);
    assert.equal(result.missingFields.includes("project_address_review"), false);
  });

  it("requires address review when structured and scraped addresses differ without acknowledgement", () => {
    const template = loadTemplateManifest("pepco", "electric");
    const required = /** @type {Array<Record<string, unknown>>} */ (template.required_fields);
    const result = evaluateRequiredFields(
      {
        project_type: "tenant_improvement",
        address: "100 Old Main St",
        city: "Washington",
        state: "DC",
        portal_data: { location: "200 Sheridan Rd NW, Washington DC" },
      },
      LOAD_PROFILE_DRAFT.load_summary,
      required,
    );
    const addressField = result.fieldResults.find((f) => f.key === "project_address");
    assert.equal(addressField?.status, "present");
    assert.equal(result.addressResolution.address_review_required, true);
    assert.ok(result.missingFields.includes("project_address_review"));
  });

  it("marks project address missing when neither structured nor portal_data.location exists", () => {
    const template = loadTemplateManifest("pepco", "electric");
    const required = /** @type {Array<Record<string, unknown>>} */ (template.required_fields);
    const result = evaluateRequiredFields(
      { project_type: "tenant_improvement", address: "", portal_data: {} },
      LOAD_PROFILE_DRAFT.load_summary,
      required,
    );
    const addressField = result.fieldResults.find((f) => f.key === "project_address");
    assert.equal(addressField?.status, "missing");
    assert.ok(result.missingFields.includes("project_address"));
  });

  it("treats equal structured and scraped addresses as present without review flag", () => {
    const template = loadTemplateManifest("pepco", "electric");
    const required = /** @type {Array<Record<string, unknown>>} */ (template.required_fields);
    const result = evaluateRequiredFields(
      {
        project_type: "tenant_improvement",
        address: "100 Main St",
        city: "Washington",
        state: "DC",
        zip_code: "20001",
        portal_data: { location: "100 Main St, Washington, DC, 20001" },
      },
      LOAD_PROFILE_DRAFT.load_summary,
      required,
    );
    const addressField = result.fieldResults.find((f) => f.key === "project_address");
    assert.equal(addressField?.status, "present");
    assert.equal(result.addressResolution.address_mismatch, false);
    assert.equal(result.addressResolution.address_review_required, false);
  });

  it("resolves incomplete package when documents or load inputs missing", () => {
    assert.equal(
      resolvePackageStatus({
        missingDocuments: ["site_plan"],
        missingFields: [],
        loadSummary: LOAD_PROFILE_DRAFT.load_summary,
        hasLoadProfileDraft: true,
      }),
      "incomplete",
    );
    assert.equal(
      resolvePackageStatus({
        missingDocuments: [],
        missingFields: [],
        loadSummary: { analysis_status: "preliminary", calculated_values: {} },
        hasLoadProfileDraft: true,
      }),
      "ready_for_review",
    );
    assert.equal(
      resolvePackageStatus({
        missingDocuments: [],
        missingFields: [],
        loadSummary: null,
        hasLoadProfileDraft: false,
      }),
      "blocked",
    );
  });
});

/**
 * @param {Record<string, Array<Record<string, unknown>>>} tables
 */
function createApplicationBuilderMockSupabase(tables) {
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
        order() {
          return api;
        },
        maybeSingle() {
          const row = store.find((r) =>
            filters.every((f) => String(r[f.column]) === String(f.value)),
          );
          return Promise.resolve({ data: row ?? null, error: null });
        },
        single() {
          if (state.mode === "insert" && state.insertRow) {
            const copy = { ...state.insertRow, id: `${table}-${store.length + 1}` };
            store.push(copy);
            return Promise.resolve({ data: copy, error: null });
          }
          const row = store.find((r) =>
            filters.every((f) => String(r[f.column]) === String(f.value)),
          );
          if (row && state.mode === "update" && state.updatePatch) {
            Object.assign(row, state.updatePatch);
          }
          return Promise.resolve({ data: row ?? null, error: null });
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
        then(resolve, reject) {
          const rows = store.filter((r) =>
            filters.every((f) => String(r[f.column]) === String(f.value)),
          );
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };

      return api;
    },
  };
}

describe("UCI D3 runApplicationPackageBuild integration", () => {
  it("creates then updates the same application package draft idempotently", async () => {
    const tables = {
      coordination_records: [{ ...HUMAN_ASSISTED_RECORD }],
      projects: [{ ...BASE_PROJECT, id: "proj-1" }],
      project_documents: [
        { id: "doc-1", project_id: "proj-1", document_type: "site_plan", file_name: "site.pdf" },
      ],
      coordination_applications: [{ ...LOAD_PROFILE_DRAFT, coordination_record_id: "coord-1", project_id: "proj-1" }],
    };

    const supabase = createApplicationBuilderMockSupabase(tables);

    try {
      const first = await runApplicationPackageBuild(supabase, {
        coordinationRecordId: "coord-1",
        userId: "user-1",
      });
      assert.equal(first.package_status, "incomplete");
      assert.equal(first.application.idempotency_key, APPLICATION_PACKAGE_IDEMPOTENCY_KEY);
      assert.equal(first.application.record_source, "agent_draft");
      assert.equal(first.stage_unchanged, true);
      assert.equal(tables.coordination_applications.length, 2);

      const second = await runApplicationPackageBuild(supabase, {
        coordinationRecordId: "coord-1",
        userId: "user-1",
      });
      assert.equal(tables.coordination_applications.length, 2);
      const pkg = tables.coordination_applications.find(
        (a) => a.idempotency_key === APPLICATION_PACKAGE_IDEMPOTENCY_KEY,
      );
      assert.equal(second.application.id, pkg?.id);
      assert.equal(second.application.draft_status, "draft");
    } finally {
      // no module patches
    }
  });

  it("rebuilt package resolves portal_data.location and stores address snapshot metadata", async () => {
    const tables = {
      coordination_records: [
        {
          ...HUMAN_ASSISTED_RECORD,
          metadata: {
            uci_provider_mapping: {
              method: PROVIDER_SETUP_METHOD,
              address_source_acknowledged: "portal_data_location",
            },
          },
        },
      ],
      projects: [
        {
          id: "proj-1",
          project_type: "tenant_improvement",
          description: "QSR fit-out",
          address: "",
          portal_data: { location: "200 Sheridan Rd NW, Washington DC" },
        },
      ],
      project_documents: [
        { id: "doc-1", project_id: "proj-1", document_type: "site_plan", file_name: "site.pdf" },
      ],
      coordination_applications: [
        { ...LOAD_PROFILE_DRAFT, coordination_record_id: "coord-1", project_id: "proj-1" },
      ],
    };

    const supabase = createApplicationBuilderMockSupabase(tables);
    const result = await runApplicationPackageBuild(supabase, {
      coordinationRecordId: "coord-1",
      userId: "user-1",
    });

    const pkgMeta = result.application.agent_draft_metadata.application_package;
    assert.equal(pkgMeta.project_address.formatted, "200 Sheridan Rd NW, Washington DC");
    assert.equal(pkgMeta.project_address.source, "portal_data_location");
    assert.equal(pkgMeta.address_source_acknowledged, "portal_data_location");
    assert.equal(result.missing_fields.includes("project_address"), false);
    const addressField = pkgMeta.field_results.find((f) => f.key === "project_address");
    assert.equal(addressField?.status, "present");
  });

  it("uses selected PEPCO propertyAddress when canonical and jurisdiction sources are absent", async () => {
    const tables = {
      coordination_records: [
        {
          ...HUMAN_ASSISTED_RECORD,
          metadata: {
            ...HUMAN_ASSISTED_RECORD.metadata,
            pepco_application_detail_discovery: {
              applications: [
                {
                  applicationUuid: "pepco-app-1",
                  overview: { propertyAddress: "10432 Campus Way S, Upper Marlboro, MD" },
                },
                {
                  applicationUuid: "pepco-app-2",
                  overview: { propertyAddress: "999 Wrong App Rd" },
                },
              ],
            },
          },
        },
      ],
      projects: [
        {
          id: "proj-1",
          project_type: "tenant_improvement",
          description: "QSR fit-out",
          address: "",
          portal_data: { tabs: { info: {} } },
        },
      ],
      project_documents: [],
      coordination_applications: [
        { ...LOAD_PROFILE_DRAFT, coordination_record_id: "coord-1", project_id: "proj-1" },
      ],
    };

    const supabase = createApplicationBuilderMockSupabase(tables);
    const result = await runApplicationPackageBuild(supabase, {
      coordinationRecordId: "coord-1",
      userId: "user-1",
      externalApplicationId: "pepco-app-1",
    });

    const pkgMeta = result.application.agent_draft_metadata.application_package;
    assert.equal(pkgMeta.project_address.formatted, "10432 Campus Way S, Upper Marlboro, MD");
    assert.equal(pkgMeta.project_address.source, "utility_portal");
    assert.equal(pkgMeta.project_address.external_application_id, "pepco-app-1");
    assert.equal(result.missing_fields.includes("project_address"), false);
  });

  it("rejects build when load profile draft is missing", async () => {
    const tables = {
      coordination_records: [{ ...HUMAN_ASSISTED_RECORD }],
      projects: [{ ...BASE_PROJECT, id: "proj-1" }],
      project_documents: [],
      coordination_applications: [],
    };

    const supabase = createApplicationBuilderMockSupabase(tables);

    try {
      await assert.rejects(
        () =>
          runApplicationPackageBuild(supabase, {
            coordinationRecordId: "coord-1",
            userId: "user-1",
          }),
        (err) => {
          assert.equal(/** @type {{ code?: string }} */ (err).code, "LOAD_PROFILE_REQUIRED");
          return true;
        },
      );
    } finally {
      // no module patches
    }
  });

  it("does not modify portal_sync or load_profile rows", async () => {
    const tables = {
      coordination_records: [{ ...HUMAN_ASSISTED_RECORD }],
      projects: [{ ...BASE_PROJECT, id: "proj-1" }],
      project_documents: [],
      coordination_applications: [
        { ...LOAD_PROFILE_DRAFT, coordination_record_id: "coord-1", project_id: "proj-1" },
        {
          id: "portal-app-1",
          coordination_record_id: "coord-1",
          project_id: "proj-1",
          record_source: "portal_sync",
          provider_slug: "pepco",
          external_application_id: "ext-1",
          portal_status: "Submitted",
          package_documents: [],
        },
      ],
    };

    const supabase = createApplicationBuilderMockSupabase(tables);

    try {
      await runApplicationPackageBuild(supabase, {
        coordinationRecordId: "coord-1",
        userId: "user-1",
      });
      const portal = tables.coordination_applications.find((a) => a.id === "portal-app-1");
      const loadProfile = tables.coordination_applications.find((a) => a.id === "app-load-1");
      assert.equal(portal?.record_source, "portal_sync");
      assert.equal(portal?.portal_status, "Submitted");
      assert.equal(loadProfile?.application_type, "load_profile");
    } finally {
      // no module patches
    }
  });

  it("reviews application package draft", async () => {
    const packageApp = {
      id: "app-pkg-1",
      project_id: "proj-1",
      record_source: "agent_draft",
      idempotency_key: APPLICATION_PACKAGE_IDEMPOTENCY_KEY,
      draft_status: "draft",
      agent_draft_metadata: {
        application_package: { package_status: "ready_for_review" },
      },
    };

    const tables = { coordination_applications: [packageApp] };
    const supabase = createApplicationBuilderMockSupabase(tables);

    const result = await reviewApplicationPackage(supabase, {
      applicationId: "app-pkg-1",
      userId: "user-1",
      review: { status: "reviewed", notes: "Demo review" },
    });
    assert.equal(result.review_status, "reviewed");
    assert.equal(tables.coordination_applications[0].draft_status, "reviewed");
  });

  it("rejects review while package is incomplete", async () => {
    const tables = {
      coordination_applications: [
        {
          id: "app-pkg-incomplete",
          project_id: "proj-1",
          record_source: "agent_draft",
          idempotency_key: APPLICATION_PACKAGE_IDEMPOTENCY_KEY,
          draft_status: "draft",
          agent_draft_metadata: {
            application_package: { package_status: "incomplete" },
          },
        },
      ],
    };
    await assert.rejects(
      () =>
        reviewApplicationPackage(createApplicationBuilderMockSupabase(tables), {
          applicationId: "app-pkg-incomplete",
          userId: "user-1",
          review: { status: "reviewed" },
        }),
      (err) => err.code === "PACKAGE_NOT_READY",
    );
  });

  it("rejects review on portal_sync application rows", async () => {
    const tables = {
      coordination_applications: [
        {
          id: "app-portal-1",
          project_id: "proj-1",
          record_source: "portal_sync",
          idempotency_key: null,
          draft_status: "draft",
        },
      ],
    };
    const supabase = createApplicationBuilderMockSupabase(tables);

    await assert.rejects(
      () =>
        reviewApplicationPackage(supabase, {
          applicationId: "app-portal-1",
          userId: "user-1",
          review: { status: "reviewed" },
        }),
      (err) => {
        assert.equal(/** @type {{ code?: string }} */ (err).code, "NOT_AGENT_DRAFT");
        return true;
      },
    );
  });
});
