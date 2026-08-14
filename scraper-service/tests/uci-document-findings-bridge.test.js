"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  BRIDGE_SCHEMA_VERSION,
  buildBridgeCandidateId,
  skipReasonForFinding,
  findingToCandidate,
  findingUnchangedForBridge,
  findReusableCandidateByEvidence,
  markSupersededDirectCandidates,
  reconcileMissingInputs,
  importDocumentFindingsToLoadProfile,
} = require("../app/services/uci/uci-document-findings-bridge.service.js");
const {
  DOCUMENT_PROCESSING_SCHEMA_VERSION,
  MANUAL_DOCUMENT_SCOPE_KEY,
} = require("../app/services/uci/uci-document-processing.service.js");
const { LOAD_PROFILE_IDEMPOTENCY_KEY } = require("../app/services/uci/uci-load-profile.service.js");
const { PROVIDER_SETUP_METHOD } = require("../app/services/uci/uci-provider-setup.service.js");
const { canCandidateSatisfyPackage } = require("../app/services/uci/uci-load-candidate.service.js");

const TENANT_A = "tenant-a-0000-4000-8000-000000000101";
const PROJECT_ID = "proj-generic-1";
const COORD_ID = "coord-generic-1";
const EXT_APP_A = "pepco-app-uuid-a";
const EXT_APP_B = "pepco-app-uuid-b";
const USER_ID = "user-1";

function baseRecord(overrides = {}) {
  return {
    id: COORD_ID,
    project_id: PROJECT_ID,
    tenant_id: TENANT_A,
    utility_provider_id: "prov-1",
    utility_type: "electric",
    metadata: {
      uci_provider_mapping: { method: PROVIDER_SETUP_METHOD, provider_slug: "pepco" },
      uci_document_processing: {
        schema_version: DOCUMENT_PROCESSING_SCHEMA_VERSION,
        applications: {
          [EXT_APP_A]: {
            schema_version: DOCUMENT_PROCESSING_SCHEMA_VERSION,
            external_application_id: EXT_APP_A,
            project_id: PROJECT_ID,
            tenant_id: TENANT_A,
            findings: [],
            findings_by_stage: { agent_2_load_profile: [] },
            documents: [],
          },
        },
      },
    },
    ...overrides,
  };
}

function agent2Finding(overrides = {}) {
  return {
    finding_id: "finding:service-voltage-1",
    document_id: "uci_doc:oneline",
    document_role: ["one_line_diagram"],
    uci_stages: ["agent_2_load_profile"],
    field_key: "service_voltage",
    category: "service_voltage",
    raw_value: "480",
    normalized_value: 480,
    unit: "V",
    entity_type: "project_service",
    entity_name: null,
    page_number: 1,
    evidence_text: "Service voltage 480 V three phase",
    extraction_method: "pdf_text",
    confidence: 0.7,
    verification_status: "raw",
    source_content_hash: "hash-oneline",
    schema_version: DOCUMENT_PROCESSING_SCHEMA_VERSION,
    requires_human_review: true,
    source_document_name: "one-line.pdf",
    external_application_id: EXT_APP_A,
    ...overrides,
  };
}

function createMockSupabase(tables) {
  return {
    from(table) {
      const store = tables[table] || (tables[table] = []);
      const filters = [];
      const state = { mode: "select", patch: null };

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
          const rows = store.filter((row) =>
            filters.every((f) => String(row[f.column]) === String(f.value)),
          );
          return Promise.resolve({ data: rows[0] ?? null, error: null });
        },
        single() {
          if (state.mode === "update") {
            const row = store.find((r) =>
              filters.every((f) => String(r[f.column]) === String(f.value)),
            );
            if (row && state.patch) Object.assign(row, state.patch);
            return Promise.resolve({ data: row ?? null, error: null });
          }
          const rows = store.filter((row) =>
            filters.every((f) => String(row[f.column]) === String(f.value)),
          );
          return Promise.resolve({ data: rows[0] ?? null, error: null });
        },
        update(patch) {
          state.mode = "update";
          state.patch = patch;
          return api;
        },
        then(resolve, reject) {
          try {
            if (state.mode === "update") {
              const row = store.find((r) =>
                filters.every((f) => String(r[f.column]) === String(f.value)),
              );
              if (row && state.patch) Object.assign(row, state.patch);
              return resolve({ data: row, error: null });
            }
            const rows = store.filter((row) =>
              filters.every((f) => String(row[f.column]) === String(f.value)),
            );
            return resolve({ data: rows, error: null });
          } catch (err) {
            if (reject) return reject(err);
            throw err;
          }
        },
      };
      return api;
    },
  };
}

function recordWithFindings(findings) {
  const record = baseRecord();
  record.metadata.uci_document_processing.applications[EXT_APP_A].findings = findings;
  record.metadata.uci_document_processing.applications[EXT_APP_A].findings_by_stage = {
    agent_2_load_profile: findings,
  };
  return record;
}

describe("uci-document-findings-bridge.service", () => {
  it("ignores non-Agent-2 findings", () => {
    const finding = agent2Finding({
      uci_stages: ["agent_3_application_package"],
      category: "site_plan_information",
    });
    assert.equal(skipReasonForFinding(finding, EXT_APP_A, baseRecord()), "not_agent_2_stage");
  });

  it("rejects cross-application findings", () => {
    const finding = agent2Finding({ external_application_id: EXT_APP_B });
    assert.equal(skipReasonForFinding(finding, EXT_APP_A, baseRecord()), "cross_application_finding");
  });

  it("keeps specification references review-only", () => {
    const finding = agent2Finding({
      entity_type: "specification_reference",
      field_key: "service_voltage",
    });
    assert.equal(
      skipReasonForFinding(finding, EXT_APP_A, baseRecord()),
      "specification_reference_review_only",
    );
  });

  it("maps panel findings as package-ineligible", () => {
    const finding = agent2Finding({
      finding_id: "finding:panel-1",
      field_key: "panel_demand_load_kva",
      entity_type: "electrical_panel",
      entity_name: "MDP",
      normalized_value: 100,
      unit: "kVA",
      evidence_text: "PANEL MDP TOTAL DEMAND LOAD 100 kVA",
    });
    const candidate = findingToCandidate(finding, { externalApplicationId: EXT_APP_A, document: null });
    assert.equal(candidate.entity_type, "electrical_panel");
    assert.equal(canCandidateSatisfyPackage(candidate), false);
    assert.equal(candidate.package_eligible, false);
  });

  it("maps explicit project total as package-eligible candidate when evidence supports it", () => {
    const finding = agent2Finding({
      finding_id: "finding:project-load",
      field_key: "connected_load_kva",
      normalized_value: 500,
      unit: "kVA",
      entity_type: "project_service",
      is_project_total: true,
      evidence_text: "TOTAL BUILDING LOAD 500 kVA",
    });
    const candidate = findingToCandidate(finding, { externalApplicationId: EXT_APP_A, document: null });
    assert.equal(candidate.is_project_total, true);
    assert.equal(canCandidateSatisfyPackage(candidate), true);
    assert.equal(candidate.package_eligible, true);
  });

  it("skips HVAC thermal capacities without explicit electrical units", () => {
    const finding = agent2Finding({
      field_key: "connected_load_kw",
      unit: null,
      evidence_text: "HVAC thermal capacity 120000 BTU/h",
      normalized_value: 120000,
    });
    assert.equal(skipReasonForFinding(finding, EXT_APP_A, baseRecord()), "non_electric_thermal_load");
  });

  it("preserves finding_id on bridged candidates", () => {
    const finding = agent2Finding();
    const candidate = findingToCandidate(finding, { externalApplicationId: EXT_APP_A, document: null });
    assert.equal(candidate.finding_id, finding.finding_id);
    assert.equal(candidate.source_type, "uci_document_finding");
    assert.equal(candidate.bridge_schema_version, BRIDGE_SCHEMA_VERSION);
    assert.equal(candidate.candidate_id, buildBridgeCandidateId(finding.finding_id));
  });

  it("imports Agent 2 findings into load_summary candidate_values", async () => {
    const findings = [
      agent2Finding(),
      agent2Finding({
        finding_id: "finding:panel-1",
        field_key: "panel_demand_load_kva",
        entity_type: "electrical_panel",
        entity_name: "MDP",
        normalized_value: 51.33,
        unit: "kVA",
        evidence_text: "PANEL MDP TOTAL DEMAND LOAD 51.33 kVA",
      }),
    ];
    const tables = {
      coordination_records: [recordWithFindings(findings)],
      coordination_applications: [
        {
          id: "load-draft-1",
          coordination_record_id: COORD_ID,
          project_id: PROJECT_ID,
          record_source: "agent_draft",
          idempotency_key: LOAD_PROFILE_IDEMPOTENCY_KEY,
          load_summary: { candidate_values: [], verified_values: {} },
        },
      ],
    };
    const supabase = createMockSupabase(tables);
    const result = await importDocumentFindingsToLoadProfile(supabase, {
      coordinationRecordId: COORD_ID,
      userId: USER_ID,
      externalApplicationId: EXT_APP_A,
    });

    assert.equal(result.candidates_created, 2);
    assert.equal(result.findings_imported, 2);
    const draft = tables.coordination_applications[0];
    assert.equal(draft.load_summary.candidate_values.length, 2);
    assert.ok(
      draft.load_summary.candidate_values.every((c) => c.source_type === "uci_document_finding"),
    );
  });

  it("imports manual findings without an application and reuses them after linking", async () => {
    const finding = agent2Finding({
      external_application_id: "",
      document_id: "uci_doc:manual-1",
      source_document_name: "client-load-schedule.pdf",
      source_content_hash: "project_doc:manual-1",
    });
    const manualState = {
      schema_version: DOCUMENT_PROCESSING_SCHEMA_VERSION,
      external_application_id: "",
      project_id: PROJECT_ID,
      coordination_record_id: COORD_ID,
      tenant_id: TENANT_A,
      findings: [finding],
      findings_by_stage: { agent_2_load_profile: [finding] },
      documents: [
        {
          document_id: "uci_doc:manual-1",
          source_type: "manual_upload",
          source_document_id: "manual-1",
          original_filename: "client-load-schedule.pdf",
          content_hash: "project_doc:manual-1",
        },
      ],
    };
    const record = baseRecord({
      metadata: {
        uci_document_processing: {
          schema_version: DOCUMENT_PROCESSING_SCHEMA_VERSION,
          applications: { [MANUAL_DOCUMENT_SCOPE_KEY]: manualState },
        },
      },
    });
    const tables = {
      coordination_records: [record],
      coordination_applications: [
        {
          id: "load-draft-manual",
          coordination_record_id: COORD_ID,
          project_id: PROJECT_ID,
          record_source: "agent_draft",
          idempotency_key: LOAD_PROFILE_IDEMPOTENCY_KEY,
          load_summary: { candidate_values: [], verified_values: {} },
        },
      ],
    };
    const supabase = createMockSupabase(tables);

    const manualImport = await importDocumentFindingsToLoadProfile(supabase, {
      coordinationRecordId: COORD_ID,
      userId: USER_ID,
      externalApplicationId: null,
    });
    assert.equal(manualImport.candidates_created, 1);
    assert.equal(tables.coordination_applications[0].load_summary.candidate_values.length, 1);

    record.metadata.uci_document_processing.applications[EXT_APP_A] = {
      ...manualState,
      external_application_id: EXT_APP_A,
    };
    const linkedImport = await importDocumentFindingsToLoadProfile(supabase, {
      coordinationRecordId: COORD_ID,
      userId: USER_ID,
      externalApplicationId: EXT_APP_A,
    });
    assert.equal(linkedImport.candidates_created, 0);
    assert.equal(linkedImport.candidates_reused, 1);
    assert.equal(tables.coordination_applications[0].load_summary.candidate_values.length, 1);
  });

  it("creates no duplicate candidates on repeated unchanged import", async () => {
    const findings = [agent2Finding()];
    const tables = {
      coordination_records: [recordWithFindings(findings)],
      coordination_applications: [
        {
          id: "load-draft-1",
          coordination_record_id: COORD_ID,
          project_id: PROJECT_ID,
          record_source: "agent_draft",
          idempotency_key: LOAD_PROFILE_IDEMPOTENCY_KEY,
          load_summary: { candidate_values: [], verified_values: {} },
        },
      ],
    };
    const supabase = createMockSupabase(tables);

    const first = await importDocumentFindingsToLoadProfile(supabase, {
      coordinationRecordId: COORD_ID,
      userId: USER_ID,
      externalApplicationId: EXT_APP_A,
    });
    assert.equal(first.candidates_created, 1);

    const second = await importDocumentFindingsToLoadProfile(supabase, {
      coordinationRecordId: COORD_ID,
      userId: USER_ID,
      externalApplicationId: EXT_APP_A,
    });
    assert.equal(second.candidates_created, 0);
    assert.equal(second.candidates_reused, 1);
    assert.equal(tables.coordination_applications[0].load_summary.candidate_values.length, 1);
  });

  it("collapses duplicate evidence against direct extraction candidates", () => {
    const finding = agent2Finding();
    const bridged = findingToCandidate(finding, { externalApplicationId: EXT_APP_A, document: null });
    const direct = {
      ...bridged,
      candidate_id: "load_candidate:direct",
      source_type: "pepco_portal_document",
      finding_id: null,
    };
    const reusable = findReusableCandidateByEvidence([direct], bridged);
    assert.ok(reusable);
    assert.equal(reusable.candidate_id, "load_candidate:direct");
  });

  it("does not reuse evidence when parser classification changes scope", () => {
    const finding = agent2Finding({
      finding_id: "finding:corrected-project-demand",
      field_key: "demand_load_kva",
      normalized_value: 315,
      unit: "kVA",
      entity_type: "project_service",
      is_project_total: true,
      evidence_text: "Project demand load 315 kVA",
    });
    const corrected = findingToCandidate(finding, {
      externalApplicationId: EXT_APP_A,
      document: null,
    });
    const oldPanelClassification = {
      ...corrected,
      candidate_id: "load_candidate:old-panel",
      field_key: "panel_demand_load_kva",
      entity_type: "unclassified_load_total",
      is_project_total: false,
    };
    assert.equal(
      findReusableCandidateByEvidence([oldPanelClassification], corrected),
      null,
    );
  });

  it("marks changed findings as superseded and imports replacement", async () => {
    const original = agent2Finding({ normalized_value: 480 });
    const tables = {
      coordination_records: [recordWithFindings([original])],
      coordination_applications: [
        {
          id: "load-draft-1",
          coordination_record_id: COORD_ID,
          project_id: PROJECT_ID,
          record_source: "agent_draft",
          idempotency_key: LOAD_PROFILE_IDEMPOTENCY_KEY,
          load_summary: { candidate_values: [], verified_values: {} },
        },
      ],
    };
    const supabase = createMockSupabase(tables);

    await importDocumentFindingsToLoadProfile(supabase, {
      coordinationRecordId: COORD_ID,
      userId: USER_ID,
      externalApplicationId: EXT_APP_A,
    });

    const changed = agent2Finding({ normalized_value: 600, raw_value: "600" });
    tables.coordination_records[0].metadata.uci_document_processing.applications[EXT_APP_A].findings = [
      changed,
    ];
    tables.coordination_records[0].metadata.uci_document_processing.applications[
      EXT_APP_A
    ].findings_by_stage.agent_2_load_profile = [changed];

    const result = await importDocumentFindingsToLoadProfile(supabase, {
      coordinationRecordId: COORD_ID,
      userId: USER_ID,
      externalApplicationId: EXT_APP_A,
      refresh: true,
    });

    assert.equal(result.candidates_created, 1);
    const candidates = tables.coordination_applications[0].load_summary.candidate_values;
    const active = candidates.filter((c) => c.status === "candidate");
    const stale = candidates.filter((c) => c.status === "stale");
    assert.equal(active.length, 1);
    assert.equal(Number(active[0].normalized_value), 600);
    assert.ok(stale.length >= 1);
  });

  it("refreshes candidates only for the selected document", async () => {
    const target = agent2Finding({ document_id: "doc-target" });
    const unrelated = agent2Finding({
      finding_id: "finding:unrelated",
      document_id: "doc-unrelated",
      field_key: "phase",
      normalized_value: 3,
      raw_value: "3",
      unit: "phase",
    });
    const record = recordWithFindings([target, unrelated]);
    record.metadata.uci_document_processing.applications[EXT_APP_A].documents = [
      { document_id: "doc-target", original_filename: "target.pdf" },
      { document_id: "doc-unrelated", original_filename: "unrelated.pdf" },
    ];
    const tables = {
      coordination_records: [record],
      coordination_applications: [
        {
          id: "load-draft-1",
          coordination_record_id: COORD_ID,
          project_id: PROJECT_ID,
          record_source: "agent_draft",
          idempotency_key: LOAD_PROFILE_IDEMPOTENCY_KEY,
          load_summary: { candidate_values: [], verified_values: {} },
        },
      ],
    };
    const supabase = createMockSupabase(tables);
    await importDocumentFindingsToLoadProfile(supabase, {
      coordinationRecordId: COORD_ID,
      userId: USER_ID,
      externalApplicationId: EXT_APP_A,
    });
    const before = tables.coordination_applications[0].load_summary.candidate_values;
    const unrelatedBefore = before.find((candidate) => candidate.finding_id === "finding:unrelated");
    assert.equal(unrelatedBefore.status, "candidate");

    const changedTarget = agent2Finding({
      document_id: "doc-target",
      normalized_value: 208,
      raw_value: "208",
    });
    record.metadata.uci_document_processing.applications[EXT_APP_A].findings = [
      changedTarget,
      unrelated,
    ];
    record.metadata.uci_document_processing.applications[
      EXT_APP_A
    ].findings_by_stage.agent_2_load_profile = [changedTarget, unrelated];

    await importDocumentFindingsToLoadProfile(supabase, {
      coordinationRecordId: COORD_ID,
      userId: USER_ID,
      externalApplicationId: EXT_APP_A,
      refresh: true,
      documentIds: ["doc-target"],
    });

    const after = tables.coordination_applications[0].load_summary.candidate_values;
    const unrelatedAfter = after.filter(
      (candidate) => candidate.finding_id === "finding:unrelated",
    );
    assert.equal(unrelatedAfter.length, 1);
    assert.equal(unrelatedAfter[0].status, "candidate");
    assert.equal(
      after.filter(
        (candidate) =>
          candidate.finding_id === target.finding_id && candidate.status === "candidate",
      ).length,
      1,
    );
  });

  it("does not overwrite approved verified values", async () => {
    const findings = [agent2Finding()];
    const tables = {
      coordination_records: [recordWithFindings(findings)],
      coordination_applications: [
        {
          id: "load-draft-1",
          coordination_record_id: COORD_ID,
          project_id: PROJECT_ID,
          record_source: "agent_draft",
          idempotency_key: LOAD_PROFILE_IDEMPOTENCY_KEY,
          load_summary: {
            candidate_values: [],
            verified_values: {
              service_voltage: {
                field_key: "service_voltage",
                value: 480,
                unit: "V",
                method: "source_extracted_and_human_verified",
                approved_by: USER_ID,
                approved_at: "2026-07-15T12:00:00.000Z",
                source_document_name: "manual",
                source_document_id: null,
                source_storage_path: "",
                page_number: null,
                evidence_text: "approved",
                extraction_method: "pdf_text",
                edited: false,
                review_note: null,
                original_candidate_id: "c1",
                source_content_hash: "h",
              },
            },
          },
        },
      ],
    };
    const supabase = createMockSupabase(tables);
    await importDocumentFindingsToLoadProfile(supabase, {
      coordinationRecordId: COORD_ID,
      userId: USER_ID,
      externalApplicationId: EXT_APP_A,
    });
    const verified = tables.coordination_applications[0].load_summary.verified_values.service_voltage;
    assert.equal(verified.value, 480);
    assert.equal(verified.method, "source_extracted_and_human_verified");
  });

  it("returns partial result for malformed finding without failing import", async () => {
    const findings = [
      agent2Finding(),
      { finding_id: "bad", uci_stages: ["agent_2_load_profile"], field_key: "" },
    ];
    const tables = {
      coordination_records: [recordWithFindings(findings)],
      coordination_applications: [
        {
          id: "load-draft-1",
          coordination_record_id: COORD_ID,
          project_id: PROJECT_ID,
          record_source: "agent_draft",
          idempotency_key: LOAD_PROFILE_IDEMPOTENCY_KEY,
          load_summary: { candidate_values: [], verified_values: {} },
        },
      ],
    };
    const supabase = createMockSupabase(tables);
    const result = await importDocumentFindingsToLoadProfile(supabase, {
      coordinationRecordId: COORD_ID,
      userId: USER_ID,
      externalApplicationId: EXT_APP_A,
    });
    assert.equal(result.status, "partial");
    assert.equal(result.candidates_created, 1);
    assert.ok(result.findings_skipped >= 1);
  });

  it("detects unchanged findings for idempotency", () => {
    const finding = agent2Finding();
    const prior = findingToCandidate(finding, { externalApplicationId: EXT_APP_A, document: null });
    assert.equal(findingUnchangedForBridge(prior, finding), true);
    assert.equal(findingUnchangedForBridge(prior, { ...finding, normalized_value: 600 }), false);
  });

  it("retires unapproved direct candidates once canonical findings exist", () => {
    const candidates = [
      {
        candidate_id: "direct",
        status: "candidate",
        source_type: "pepco_portal_document",
        source_document_name: "E602.pdf",
        external_application_id: EXT_APP_A,
      },
      {
        candidate_id: "approved",
        status: "approved",
        source_type: "pepco_portal_document",
        source_document_name: "E602.pdf",
        external_application_id: EXT_APP_A,
      },
    ];
    const count = markSupersededDirectCandidates(
      candidates,
      { documents: [{ original_filename: "E602.pdf" }] },
      EXT_APP_A,
    );
    assert.equal(count, 1);
    assert.equal(candidates[0].status, "stale");
    assert.equal(candidates[1].status, "approved");
  });

  it("clears evidenced inputs without promoting panel totals to project load", () => {
    const phase = findingToCandidate(
      agent2Finding({
        finding_id: "phase",
        field_key: "phase",
        normalized_value: "3",
        raw_value: "3-phase",
        unit: "phase",
      }),
      { externalApplicationId: EXT_APP_A, document: null },
    );
    const equipment = findingToCandidate(
      agent2Finding({
        finding_id: "equipment",
        field_key: "equipment_schedule_watts",
        normalized_value: 1000,
        raw_value: "1000",
        unit: "W",
        entity_type: "equipment",
        entity_name: "504",
      }),
      { externalApplicationId: EXT_APP_A, document: null },
    );
    const panel = findingToCandidate(
      agent2Finding({
        finding_id: "panel",
        field_key: "panel_connected_load_kva",
        normalized_value: 80,
        raw_value: "80",
        unit: "kVA",
        entity_type: "electrical_panel",
        entity_name: "C",
      }),
      { externalApplicationId: EXT_APP_A, document: null },
    );
    const missing = reconcileMissingInputs(
      {
        missing_inputs: [
          "phase",
          "equipment_schedule",
          "connected_equipment_or_load_data",
          "uploaded_specifications_or_plans",
          "meter_count",
        ],
      },
      [phase, equipment, panel],
      { documents: [{ document_id: "doc-1" }] },
    );
    assert.deepEqual(missing, ["meter_count"]);
    assert.equal(panel.is_project_total, false);
  });
});
