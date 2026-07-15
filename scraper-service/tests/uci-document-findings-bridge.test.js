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
  importDocumentFindingsToLoadProfile,
} = require("../app/services/uci/uci-document-findings-bridge.service.js");
const { DOCUMENT_PROCESSING_SCHEMA_VERSION } = require("../app/services/uci/uci-document-processing.service.js");
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
});
