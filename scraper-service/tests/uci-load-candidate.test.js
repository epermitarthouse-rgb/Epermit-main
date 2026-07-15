"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  LOAD_EXTRACTION_SCHEMA_VERSION,
  STALE_EXTRACTION_SCHEMA_VERSIONS,
  resolveLoadFieldKey,
  fieldKeyMatchesUnit,
  isServicePhaseEvidence,
  canCandidateSatisfyPackage,
  approvalBlockedReason,
  extractPanelLoadCandidatesFromPdfText,
  extractServicePhaseCandidatesFromPdfText,
  rankLoadSourceDocument,
  rankAndSortLoadDocuments,
  buildCandidateRecord,
  discoverLoadSourceDocuments,
  discoverProjectDocumentSources,
  extractCandidatesFromStructuredApplication,
  classifyLoadTotalCandidate,
  deduplicateLoadCandidates,
  linkSupersededCandidates,
  extractCandidatesFromPdfText,
  extractCandidatesFromTables,
  mergeCandidates,
  markStaleCandidates,
  assignConflictGroups,
  getVerifiedValuesForPackage,
  isConnectedLoadDataSatisfied,
  resolveLoadCandidate,
  addManualVerifiedValue,
  validateManualVerifiedPayload,
  runLoadCandidateExtraction,
  LoadCandidateExtractionError,
  extractPdfPages,
} = require("../app/services/uci/uci-load-candidate.service.js");
const { validatePepcoStoragePathForRecord } = require("../app/services/uci/uci-package-document-bridge.service.js");
const {
  evaluateRequiredFields,
  runApplicationPackageBuild,
  APPLICATION_PACKAGE_IDEMPOTENCY_KEY,
} = require("../app/services/uci/uci-application-builder.service.js");
const { LOAD_PROFILE_IDEMPOTENCY_KEY } = require("../app/services/uci/uci-load-profile.service.js");
const { PROVIDER_SETUP_METHOD } = require("../app/services/uci/uci-provider-setup.service.js");

const TENANT_A = "tenant-a-0000-4000-8000-000000000101";
const TENANT_B = "tenant-b-0000-4000-8000-000000000102";
const PROJECT_ID = "proj-generic-1";
const COORD_ID = "coord-generic-1";
const EXT_APP_A = "pepco-app-uuid-a";
const EXT_APP_B = "pepco-app-uuid-b";
const USER_ID = "user-1";

const PANEL_FILE = {
  documentName: "E602 - ELECTRICAL PANEL SCHEDULES.pdf",
  fileName: "E602 - ELECTRICAL PANEL SCHEDULES.pdf",
  status: "saved",
  storageStatus: "stored",
  storageBucket: "project-documents",
  storagePath: `uci/${TENANT_A}/${PROJECT_ID}/${COORD_ID}/pepco/${EXT_APP_A}/E602 - ELECTRICAL PANEL SCHEDULES.pdf`,
  contentHash: "hash-panel",
  idempotencyKey: "pepco:panel",
  downloadedAt: "2026-07-15T10:00:00.000Z",
};

const ONE_LINE_FILE = {
  documentName: "E601 - ELECTRICAL ONE-LINE DIAGRAMS.pdf",
  fileName: "E601 - ELECTRICAL ONE-LINE DIAGRAMS.pdf",
  status: "saved",
  storageStatus: "stored",
  storageBucket: "project-documents",
  storagePath: `uci/${TENANT_A}/${PROJECT_ID}/${COORD_ID}/pepco/${EXT_APP_A}/E601 - ELECTRICAL ONE-LINE DIAGRAMS.pdf`,
  contentHash: "hash-oneline",
  idempotencyKey: "pepco:oneline",
  downloadedAt: "2026-07-15T10:00:00.000Z",
};

function baseRecord(overrides = {}) {
  return {
    id: COORD_ID,
    project_id: PROJECT_ID,
    tenant_id: TENANT_A,
    utility_provider_id: "prov-1",
    utility_type: "electric",
    metadata: {
      uci_provider_mapping: { method: PROVIDER_SETUP_METHOD, provider_slug: "pepco" },
      pepco_application_detail_discovery: {
        applications: [
          {
            applicationUuid: EXT_APP_A,
            projectDetails: {
              applicationDetails: {
                electricServiceLoads: { centralAC: 2, centralHeat: 1 },
                serviceAmperage: 400,
                serviceVoltage: 480,
                phase: "three phase",
                meterCount: 2,
              },
            },
            documents: [
              { documentName: PANEL_FILE.documentName, documentType: "Panel Schedule" },
              { documentName: ONE_LINE_FILE.documentName, documentType: "One Line Diagram" },
            ],
            downloadedFiles: [PANEL_FILE, ONE_LINE_FILE],
          },
          {
            applicationUuid: EXT_APP_B,
            downloadedFiles: [
              {
                ...PANEL_FILE,
                storagePath: `uci/${TENANT_A}/${PROJECT_ID}/${COORD_ID}/pepco/${EXT_APP_B}/other-panel.pdf`,
                external_application_id: EXT_APP_B,
              },
            ],
          },
        ],
      },
    },
    utility_providers: { slug: "pepco", name: "PEPCO" },
    ...overrides,
  };
}

/**
 * @param {Record<string, Array<Record<string, unknown>>>} tables
 */
function createMockSupabase(tables) {
  return {
    from(table) {
      const store = tables[table] || (tables[table] = []);
      const filters = [];
      const state = { mode: "select", patch: null, insertRow: null };

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
        insert(row) {
          state.mode = "insert";
          state.insertRow = row;
          store.push(row);
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

describe("uci-load-candidate.service", () => {
  it("ranks panel schedule above one-line diagram", () => {
    const panel = rankLoadSourceDocument({ fileName: "E602 - ELECTRICAL PANEL SCHEDULES.pdf" });
    const oneLine = rankLoadSourceDocument({ fileName: "E601 - ELECTRICAL ONE-LINE DIAGRAMS.pdf" });
    assert.ok(panel.score > oneLine.score);
    assert.ok(panel.reasons.includes("panel schedule"));
  });

  it("discovers only selected external application documents", () => {
    const record = baseRecord();
    const discovery = discoverLoadSourceDocuments(record, { externalApplicationId: EXT_APP_A });
    assert.equal(discovery.documents.length, 2);
    assert.ok(discovery.documents.every((d) => d.external_application_id === EXT_APP_A));
  });

  it("extracts structured provider application candidates with evidence", () => {
    const record = baseRecord();
    const app = record.metadata.pepco_application_detail_discovery.applications[0];
    const candidates = extractCandidatesFromStructuredApplication(app, EXT_APP_A);
    assert.ok(candidates.some((c) => c.field_key === "central_ac_count"));
    assert.ok(candidates.some((c) => c.field_key === "central_heat_count"));
    assert.ok(candidates.some((c) => c.field_key === "service_amperage"));
    assert.ok(candidates.every((c) => c.nested_object_unnormalized !== true));
    assert.ok(candidates.every((c) => String(c.raw_value) !== "[object Object]"));
    assert.equal(candidates[0].extraction_method, "structured_application");
    assert.equal(candidates[0].status, "candidate");
    assert.equal(candidates[0].requires_human_review, true);
  });

  it("extracts PDF text candidates with page evidence and unit", () => {
    const text = "Main service size 400 A at 480 V on page 2";
    const source = {
      source_type: "pepco_portal_document",
      source_document_name: "panel.pdf",
      source_document_id: "id-1",
      source_storage_path: "uci/.../panel.pdf",
      source_content_hash: "hash-1",
      external_application_id: EXT_APP_A,
    };
    const candidates = extractCandidatesFromPdfText(text, 2, source);
    const amps = candidates.find((c) => c.field_key === "service_amperage");
    assert.ok(amps);
    assert.equal(amps.page_number, 2);
    assert.ok(amps.evidence_text.includes("400"));
    assert.equal(amps.unit, "A");
    assert.equal(amps.normalized_value, 400);
  });

  it("keeps values without units unresolved for connected load numerics", () => {
    const text = "connected load 150";
    const source = {
      source_type: "pepco_portal_document",
      source_document_name: "load.pdf",
      source_document_id: null,
      source_storage_path: "path",
      source_content_hash: "hash",
      external_application_id: EXT_APP_A,
    };
    const candidates = extractCandidatesFromPdfText(text, 1, source);
    const load = candidates.find((c) => c.field_key === "connected_load_kw");
    if (load) {
      assert.equal(load.normalized_value, null);
      assert.equal(load.ambiguous, true);
    } else {
      assert.equal(candidates.length, 0);
    }
  });

  it("extracts table rows when pdf text patterns miss", () => {
    const text = "Connected load\t200\tKW";
    const source = {
      source_type: "pepco_portal_document",
      source_document_name: "table.pdf",
      source_document_id: null,
      source_storage_path: "path",
      source_content_hash: "hash",
      external_application_id: EXT_APP_A,
    };
    const candidates = extractCandidatesFromTables(text, 1, source);
    assert.ok(candidates.length >= 1);
    assert.equal(candidates[0].extraction_method, "table");
  });

  it("groups conflicting candidates without auto-resolution", () => {
    const a = buildCandidateRecord({
      field_key: "service_amperage",
      raw_value: "400",
      normalized_value: 400,
      unit: "A",
      source_type: "pepco_portal_document",
      source_document_name: "a.pdf",
      source_storage_path: "p/a",
      source_content_hash: "h1",
      extraction_method: "pdf_text",
      external_application_id: EXT_APP_A,
    });
    const b = buildCandidateRecord({
      field_key: "service_amperage",
      raw_value: "600",
      normalized_value: 600,
      unit: "A",
      source_type: "pepco_portal_document",
      source_document_name: "b.pdf",
      source_storage_path: "p/b",
      source_content_hash: "h2",
      extraction_method: "pdf_text",
      external_application_id: EXT_APP_A,
    });
    const grouped = assignConflictGroups([a, b]);
    assert.ok(grouped[0].conflict_group);
    assert.equal(grouped[0].conflict_group, grouped[1].conflict_group);
  });

  it("does not write candidates into verified output automatically", () => {
    const summary = {
      candidate_values: [
        buildCandidateRecord({
          field_key: "connected_load_kw",
          raw_value: "200",
          normalized_value: 200,
          unit: "kW",
          source_type: "pepco_portal_document",
          source_document_name: "x.pdf",
          source_storage_path: "p",
          source_content_hash: "h",
          extraction_method: "pdf_text",
          external_application_id: EXT_APP_A,
        }),
      ],
      verified_values: {},
    };
    assert.equal(isConnectedLoadDataSatisfied(summary), false);
    assert.deepEqual(getVerifiedValuesForPackage(summary), {});
  });

  it("approval writes verified values with provenance", async () => {
    const candidate = buildCandidateRecord({
      field_key: "connected_load_kw",
      raw_value: "200",
      normalized_value: 200,
      unit: "kW",
      entity_type: "project_service",
      is_project_total: true,
      source_type: "pepco_portal_document",
      source_document_name: "panel.pdf",
      source_storage_path: "p",
      source_content_hash: "hash",
      page_number: 3,
      evidence_text: "OVERALL CONNECTED LOAD 200 KW",
      extraction_method: "pdf_text",
      external_application_id: EXT_APP_A,
    });
    const tables = {
      coordination_records: [baseRecord()],
      coordination_applications: [
        {
          id: "load-draft-1",
          coordination_record_id: COORD_ID,
          project_id: PROJECT_ID,
          record_source: "agent_draft",
          idempotency_key: LOAD_PROFILE_IDEMPOTENCY_KEY,
          load_summary: { candidate_values: [candidate], verified_values: {} },
        },
      ],
    };
    const supabase = createMockSupabase(tables);
    const result = await resolveLoadCandidate(supabase, {
      coordinationRecordId: COORD_ID,
      userId: USER_ID,
      candidateId: candidate.candidate_id,
      action: "approve",
    });
    assert.equal(result.connected_load_satisfied, true);
    assert.equal(result.verified_values.connected_load_kw.method, "source_extracted_and_human_verified");
    assert.equal(result.verified_values.connected_load_kw.original_candidate_id, candidate.candidate_id);
    assert.equal(result.verified_values.connected_load_kw.page_number, 3);
  });

  it("edited approval preserves original candidate reference", async () => {
    const candidate = buildCandidateRecord({
      field_key: "demand_load_kw",
      raw_value: "180",
      normalized_value: 180,
      unit: "kW",
      source_type: "pepco_portal_document",
      source_document_name: "panel.pdf",
      source_storage_path: "p",
      source_content_hash: "hash",
      extraction_method: "pdf_text",
      external_application_id: EXT_APP_A,
    });
    const tables = {
      coordination_records: [baseRecord()],
      coordination_applications: [
        {
          id: "load-draft-1",
          coordination_record_id: COORD_ID,
          project_id: PROJECT_ID,
          record_source: "agent_draft",
          idempotency_key: LOAD_PROFILE_IDEMPOTENCY_KEY,
          load_summary: { candidate_values: [candidate], verified_values: {} },
        },
      ],
    };
    const supabase = createMockSupabase(tables);
    const result = await resolveLoadCandidate(supabase, {
      coordinationRecordId: COORD_ID,
      userId: USER_ID,
      candidateId: candidate.candidate_id,
      action: "edit_approve",
      edited_value: 190,
      edited_unit: "kW",
    });
    assert.equal(result.verified_values.demand_load_kw.value, 190);
    assert.equal(result.verified_values.demand_load_kw.edited, true);
    assert.equal(result.verified_values.demand_load_kw.method, "user_entered_and_verified");
    assert.equal(result.verified_values.demand_load_kw.original_candidate_id, candidate.candidate_id);
  });

  it("rejected candidate does not satisfy connected_load_data", async () => {
    const candidate = buildCandidateRecord({
      field_key: "connected_load_kw",
      raw_value: "200",
      normalized_value: 200,
      unit: "kW",
      source_type: "pepco_portal_document",
      source_document_name: "panel.pdf",
      source_storage_path: "p",
      source_content_hash: "hash",
      extraction_method: "pdf_text",
      external_application_id: EXT_APP_A,
    });
    const tables = {
      coordination_records: [baseRecord()],
      coordination_applications: [
        {
          id: "load-draft-1",
          coordination_record_id: COORD_ID,
          project_id: PROJECT_ID,
          record_source: "agent_draft",
          idempotency_key: LOAD_PROFILE_IDEMPOTENCY_KEY,
          load_summary: { candidate_values: [candidate], verified_values: {} },
        },
      ],
    };
    const supabase = createMockSupabase(tables);
    await resolveLoadCandidate(supabase, {
      coordinationRecordId: COORD_ID,
      userId: USER_ID,
      candidateId: candidate.candidate_id,
      action: "reject",
    });
    const fieldEval = evaluateRequiredFields(
      { address: "1 Main St", project_type: "commercial", description: "test" },
      { verified_values: {}, candidate_values: [candidate] },
      [{ key: "connected_load_data", label: "Connected load data", source: "load_summary.verified_values", required: true }],
      baseRecord(),
    );
    assert.ok(fieldEval.missingFields.includes("connected_load_data"));
  });

  it("approved required fields remove connected_load_data from missing fields", () => {
    const loadSummary = {
      verified_values: {
        connected_load_kw: {
          field_key: "connected_load_kw",
          value: 200,
          unit: "kW",
          method: "source_extracted_and_human_verified",
        },
      },
    };
    const fieldEval = evaluateRequiredFields(
      { address: "1 Main St", project_type: "commercial", description: "test" },
      loadSummary,
      [{ key: "connected_load_data", label: "Connected load data", source: "load_summary.verified_values", required: true }],
      baseRecord(),
    );
    assert.ok(!fieldEval.missingFields.includes("connected_load_data"));
  });

  it("skips duplicate extraction for unchanged content hash", async () => {
    const existingCandidate = buildCandidateRecord({
      field_key: "service_amperage",
      raw_value: "400",
      normalized_value: 400,
      unit: "A",
      source_type: "provider_application",
      source_document_name: "provider_application_metadata",
      source_storage_path: "",
      source_content_hash: `structured:${EXT_APP_A}:serviceAmperage`,
      extraction_method: "structured_application",
      external_application_id: EXT_APP_A,
    });
    existingCandidate.extraction_schema_version = LOAD_EXTRACTION_SCHEMA_VERSION;

    const tables = {
      coordination_records: [baseRecord()],
      project_documents: [],
      coordination_applications: [
        {
          id: "load-draft-1",
          coordination_record_id: COORD_ID,
          project_id: PROJECT_ID,
          record_source: "agent_draft",
          idempotency_key: LOAD_PROFILE_IDEMPOTENCY_KEY,
          load_summary: {
            candidate_values: [existingCandidate],
            verified_values: {},
            calculated_values: {},
          },
        },
      ],
    };
    const supabase = createMockSupabase(tables);
    const result = await runLoadCandidateExtraction(supabase, {
      coordinationRecordId: COORD_ID,
      userId: USER_ID,
      externalApplicationId: EXT_APP_A,
      deps: {
        maxDocuments: 0,
        downloadFromSupabaseStorage: async () => ({ ok: false, data: null }),
      },
    });
    assert.ok(result.extraction.candidates_skipped_unchanged >= 1);
  });

  it("marks candidates stale when source content changes", () => {
    const candidate = buildCandidateRecord({
      field_key: "service_amperage",
      raw_value: "400",
      normalized_value: 400,
      unit: "A",
      source_type: "pepco_portal_document",
      source_document_name: "panel.pdf",
      source_storage_path: "uci/tenant/proj/coord/pepco/app/panel.pdf",
      source_content_hash: "old-hash",
      extraction_method: "pdf_text",
      external_application_id: EXT_APP_A,
    });
    const updated = markStaleCandidates([candidate], {
      "uci/tenant/proj/coord/pepco/app/panel.pdf": "new-hash",
    });
    assert.equal(updated[0].status, "stale");
  });

  it("rejects cross-application storage paths during discovery scoping", () => {
    const record = baseRecord();
    const wrongPath = `uci/${TENANT_A}/${PROJECT_ID}/${COORD_ID}/pepco/${EXT_APP_B}/E602.pdf`;
    assert.equal(
      validatePepcoStoragePathForRecord(wrongPath, {
        projectId: PROJECT_ID,
        coordinationRecordId: COORD_ID,
        tenantId: TENANT_A,
      }),
      true,
    );
    const discovery = discoverLoadSourceDocuments(record, { externalApplicationId: EXT_APP_A });
    assert.ok(discovery.documents.every((d) => d.external_application_id === EXT_APP_A));
  });

  it("includes eligible ranked project_documents", () => {
    const docs = discoverProjectDocumentSources(
      [
        {
          id: "doc-1",
          project_id: PROJECT_ID,
          file_name: "LOAD CALCULATION SUMMARY.pdf",
          file_path: `${PROJECT_ID}/load-calc.pdf`,
          document_type: "electrical",
        },
        {
          id: "doc-2",
          project_id: PROJECT_ID,
          file_name: "site-photo.jpg",
          file_path: `${PROJECT_ID}/photo.jpg`,
        },
      ],
      PROJECT_ID,
    );
    assert.equal(docs.length, 1);
    assert.equal(docs[0].source_type, "project_document");
  });

  it("does not use table extraction when pdf text already matched on page", () => {
    const pdfText = extractCandidatesFromPdfText(
      "connected load 250 KW",
      1,
      {
        source_type: "pepco_portal_document",
        source_document_name: "x.pdf",
        source_document_id: null,
        source_storage_path: "p",
        source_content_hash: "h",
        external_application_id: EXT_APP_A,
      },
    );
    assert.ok(pdfText.length > 0);
    const table = extractCandidatesFromTables("connected load\t999\tKW", 1, {
      source_type: "pepco_portal_document",
      source_document_name: "x.pdf",
      source_document_id: null,
      source_storage_path: "p",
      source_content_hash: "h",
      external_application_id: EXT_APP_A,
    });
    assert.ok(table.length > 0);
    assert.notEqual(pdfText[0].normalized_value, 999);
  });

  it("package rebuild preserves verified snapshot metadata", async () => {
    const loadSummary = {
      version: "d2.1-v1",
      utility_type: "electric",
      analysis_status: "missing_inputs",
      calculated_values: {},
      verified_values: {
        connected_load_kw: {
          field_key: "connected_load_kw",
          value: 200,
          unit: "kW",
          method: "source_extracted_and_human_verified",
          approved_by: USER_ID,
          approved_at: "2026-07-15T12:00:00.000Z",
          source_document_name: "panel.pdf",
          source_document_id: null,
          source_storage_path: "p",
          page_number: 1,
          evidence_text: "connected load 200 KW",
          extraction_method: "pdf_text",
          edited: false,
          review_note: null,
          original_candidate_id: "c1",
          source_content_hash: "hash",
        },
      },
      missing_inputs: [],
      inputs_used: [],
      needs_verification: [],
      assumptions: { template_id: null, template_version: null, notes: [] },
      source_documents: [],
      generated_at: "2026-07-14T12:00:00.000Z",
      generated_by: "agent_2_load_profile",
      requires_human_review: true,
    };

    const record = baseRecord();
    const tables = {
      coordination_records: [record],
      projects: [
        {
          id: PROJECT_ID,
          address: "100 Generic Way",
          project_type: "commercial",
          description: "Generic project",
        },
      ],
      project_documents: [
        {
          id: "pd-1",
          project_id: PROJECT_ID,
          document_type: "single_line_diagram",
          file_name: "E601 - ELECTRICAL ONE-LINE DIAGRAMS.pdf",
        },
      ],
      coordination_applications: [
        {
          id: "app-load-1",
          coordination_record_id: COORD_ID,
          project_id: PROJECT_ID,
          record_source: "agent_draft",
          idempotency_key: LOAD_PROFILE_IDEMPOTENCY_KEY,
          application_type: "load_profile",
          load_summary: loadSummary,
        },
      ],
    };

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

    const result = await runApplicationPackageBuild(supabase, {
      coordinationRecordId: COORD_ID,
      userId: USER_ID,
      externalApplicationId: EXT_APP_A,
    });

    const pkgMeta = result.application.agent_draft_metadata.application_package;
    assert.equal(pkgMeta.connected_load_satisfied, true);
    assert.ok(pkgMeta.verified_load_snapshot.connected_load_kw);
    assert.ok(!result.missing_fields.includes("connected_load_data"));
    assert.deepEqual(result.application.load_summary.verified_values, loadSummary.verified_values);
  });

  it("survives project_documents schema mismatch with partial structured extraction", async () => {
    const tables = {
      coordination_records: [baseRecord()],
      project_documents: [],
      coordination_applications: [
        {
          id: "load-draft-1",
          coordination_record_id: COORD_ID,
          project_id: PROJECT_ID,
          record_source: "agent_draft",
          idempotency_key: LOAD_PROFILE_IDEMPOTENCY_KEY,
          load_summary: { candidate_values: [], verified_values: {}, calculated_values: {} },
        },
      ],
    };

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
          update(patch) {
            state.mode = "update";
            state.updatePatch = patch;
            return api;
          },
          then(resolve, reject) {
            if (table === "project_documents") {
              return Promise.resolve({
                data: null,
                error: { message: "column project_documents.content_hash does not exist" },
              }).then(resolve, reject);
            }
            const rows = store.filter((r) =>
              filters.every((f) => String(r[f.column]) === String(f.value)),
            );
            return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
          },
        };
        return api;
      },
    };

    const result = await runLoadCandidateExtraction(supabase, {
      coordinationRecordId: COORD_ID,
      userId: USER_ID,
      externalApplicationId: EXT_APP_A,
      deps: {
        maxDocuments: 0,
        downloadFromSupabaseStorage: async () => ({ ok: false, data: null }),
      },
    });

    assert.equal(result.extraction_status, "partial");
    assert.ok(result.failed_documents.some((f) => f.stage === "project_documents_fetch"));
    assert.ok(result.candidates.some((c) => c.field_key === "central_ac_count"));
  });

  it("returns partial when one PDF parse fails but structured metadata succeeds", async () => {
    const tables = {
      coordination_records: [baseRecord()],
      project_documents: [],
      coordination_applications: [
        {
          id: "load-draft-1",
          coordination_record_id: COORD_ID,
          project_id: PROJECT_ID,
          record_source: "agent_draft",
          idempotency_key: LOAD_PROFILE_IDEMPOTENCY_KEY,
          load_summary: { candidate_values: [], verified_values: {}, calculated_values: {} },
        },
      ],
    };
    const supabase = createMockSupabase(tables);
    const result = await runLoadCandidateExtraction(supabase, {
      coordinationRecordId: COORD_ID,
      userId: USER_ID,
      externalApplicationId: EXT_APP_A,
      deps: {
        maxDocuments: 1,
        downloadFromSupabaseStorage: async () => ({
          ok: true,
          data: { arrayBuffer: async () => Buffer.from("%PDF-bad").buffer },
        }),
        extractPdfPages: async () => {
          throw new Error("corrupt pdf");
        },
      },
    });
    assert.equal(result.extraction_status, "partial");
    assert.ok(result.failed_documents.some((f) => f.stage === "pdf_parse"));
    assert.ok(result.candidates.some((c) => c.extraction_method === "structured_application"));
  });

  it("returns partial when storage download fails for one document", async () => {
    const tables = {
      coordination_records: [baseRecord()],
      project_documents: [],
      coordination_applications: [
        {
          id: "load-draft-1",
          coordination_record_id: COORD_ID,
          project_id: PROJECT_ID,
          record_source: "agent_draft",
          idempotency_key: LOAD_PROFILE_IDEMPOTENCY_KEY,
          load_summary: { candidate_values: [], verified_values: {}, calculated_values: {} },
        },
      ],
    };
    const supabase = createMockSupabase(tables);
    const result = await runLoadCandidateExtraction(supabase, {
      coordinationRecordId: COORD_ID,
      userId: USER_ID,
      externalApplicationId: EXT_APP_A,
      deps: {
        maxDocuments: 1,
        downloadFromSupabaseStorage: async () => ({
          ok: false,
          data: null,
          errorMessage: "object not found",
        }),
      },
    });
    assert.equal(result.extraction_status, "partial");
    assert.ok(result.failed_documents.some((f) => f.stage === "storage_download"));
    assert.ok(result.extraction.structured_candidates_extracted >= 1);
  });

  it("throws controlled error when all document sources fail and structured metadata is absent", async () => {
    const record = baseRecord({
      metadata: {
        uci_provider_mapping: { method: PROVIDER_SETUP_METHOD, provider_slug: "pepco" },
        pepco_application_detail_discovery: {
          applications: [
            {
              applicationUuid: EXT_APP_A,
              documents: [{ documentName: PANEL_FILE.documentName, documentType: "Panel Schedule" }],
              downloadedFiles: [PANEL_FILE],
            },
          ],
        },
      },
    });
    const tables = {
      coordination_records: [record],
      project_documents: [],
      coordination_applications: [
        {
          id: "load-draft-1",
          coordination_record_id: COORD_ID,
          project_id: PROJECT_ID,
          record_source: "agent_draft",
          idempotency_key: LOAD_PROFILE_IDEMPOTENCY_KEY,
          load_summary: { candidate_values: [], verified_values: {}, calculated_values: {} },
        },
      ],
    };
    const supabase = createMockSupabase(tables);
    await assert.rejects(
      () =>
        runLoadCandidateExtraction(supabase, {
          coordinationRecordId: COORD_ID,
          userId: USER_ID,
          externalApplicationId: EXT_APP_A,
          deps: {
            maxDocuments: 1,
            downloadFromSupabaseStorage: async () => ({ ok: false, data: null, errorMessage: "missing" }),
          },
        }),
      (err) => {
        assert.equal(err.code, "LOAD_CANDIDATE_EXTRACTION_FAILED");
        assert.ok(err.stage);
        return true;
      },
    );
  });

  it("pdf-parse runtime accepts Node Buffer in production import path", async () => {
    const pdfParse = require("pdf-parse");
    assert.equal(typeof pdfParse, "function");
    await assert.rejects(
      () => extractPdfPages(Buffer.from("not-a-real-pdf")),
      (err) => {
        assert.ok(err instanceof Error);
        return true;
      },
    );
  });

  it("LoadCandidateExtractionError exposes safe structured fields", () => {
    const err = new LoadCandidateExtractionError({
      stage: "pdf_parse",
      documentName: "panel.pdf",
      message: "corrupt pdf",
      statusCode: 422,
    });
    assert.equal(err.code, "LOAD_CANDIDATE_EXTRACTION_FAILED");
    assert.equal(err.stage, "pdf_parse");
    assert.equal(err.document_name, "panel.pdf");
    assert.equal(err.statusCode, 422);
  });

  it("maps kVA demand evidence to demand_load_kva", () => {
    const source = {
      source_type: "pepco_portal_document",
      source_document_name: "schedule.pdf",
      source_document_id: null,
      source_storage_path: "path",
      source_content_hash: "hash",
      external_application_id: EXT_APP_A,
    };
    const text = "TOTAL DEMAND LOAD: 250 kVA";
    const candidates = extractPanelLoadCandidatesFromPdfText(text, 1, source);
    const match = candidates.find((c) => c.field_key === "panel_demand_load_kva");
    assert.ok(match);
    assert.equal(match.unit, "kVA");
    assert.equal(match.normalized_value, 250);
    assert.equal(match.entity_type, "electrical_panel");
    assert.equal(match.panel_identifier_missing, true);
    assert.notEqual(match.entity_type, "project_service");
    assert.equal(match.field_unit_mismatch, false);
  });

  it("maps kW demand evidence to demand_load_kw", () => {
    assert.equal(resolveLoadFieldKey("demand", "kW", false), "demand_load_kw");
    assert.equal(resolveLoadFieldKey("demand", "KW", false), "demand_load_kw");
    assert.ok(fieldKeyMatchesUnit("demand_load_kw", "kW"));
  });

  it("does not convert kVA to kW without power factor", () => {
    assert.equal(resolveLoadFieldKey("demand", "kVA", false), "demand_load_kva");
    assert.notEqual(resolveLoadFieldKey("demand", "kVA", false), "demand_load_kw");
  });

  it("keeps separate panel totals from conflicting", () => {
    const source = {
      source_type: "pepco_portal_document",
      source_document_name: "schedule.pdf",
      source_document_id: null,
      source_storage_path: "path",
      source_content_hash: "hash",
      external_application_id: EXT_APP_A,
    };
    const text = [
      "PANEL A",
      "TOTAL DEMAND LOAD: 100 kVA",
      "PANEL B",
      "TOTAL DEMAND LOAD: 200 kVA",
    ].join("\n");
    const candidates = extractPanelLoadCandidatesFromPdfText(text, 1, source);
    assert.equal(candidates.length, 2);
    assert.notEqual(candidates[0].entity_name, candidates[1].entity_name);
    const grouped = assignConflictGroups(candidates);
    assert.equal(grouped[0].conflict_group, null);
    assert.equal(grouped[1].conflict_group, null);
  });

  it("panel totals do not satisfy connected load requirement", () => {
    const candidate = buildCandidateRecord({
      field_key: "panel_demand_load_kva",
      raw_value: "250",
      normalized_value: 250,
      unit: "kVA",
      entity_type: "electrical_panel",
      entity_name: "MDP-1",
      is_project_total: false,
      source_type: "pepco_portal_document",
      source_document_name: "schedule.pdf",
      source_storage_path: "p",
      source_content_hash: "h",
      extraction_method: "pdf_text",
      external_application_id: EXT_APP_A,
    });
    assert.equal(canCandidateSatisfyPackage(candidate), false);
    assert.ok(approvalBlockedReason(candidate));
  });

  it("explicit building/service total can satisfy package after approval", () => {
    const candidate = buildCandidateRecord({
      field_key: "demand_load_kva",
      raw_value: "500",
      normalized_value: 500,
      unit: "kVA",
      entity_type: "project_service",
      is_project_total: true,
      source_type: "pepco_portal_document",
      source_document_name: "schedule.pdf",
      source_storage_path: "p",
      source_content_hash: "h",
      evidence_text: "BUILDING TOTAL DEMAND LOAD 500 kVA",
      extraction_method: "pdf_text",
      external_application_id: EXT_APP_A,
    });
    assert.equal(canCandidateSatisfyPackage(candidate), true);
    const summary = {
      verified_values: {
        demand_load_kva: {
          field_key: "demand_load_kva",
          value: 500,
          unit: "kVA",
        },
      },
    };
    assert.equal(isConnectedLoadDataSatisfied(summary), true);
  });

  it("rejects generic motor phase references", () => {
    const source = {
      source_type: "pepco_portal_document",
      source_document_name: "spec.pdf",
      source_document_id: null,
      source_storage_path: "path",
      source_content_hash: "hash",
      external_application_id: EXT_APP_A,
    };
    const text = "Motor starters shall be suitable for three-phase branch circuits";
    const candidates = extractServicePhaseCandidatesFromPdfText(text, 1, source);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].generic_specification_reference, true);
    assert.equal(candidates[0].normalized_value, null);
    assert.ok(approvalBlockedReason(candidates[0]));
  });

  it("accepts service-phase notation from one-line context", () => {
    const source = {
      source_type: "pepco_portal_document",
      source_document_name: "oneline.pdf",
      source_document_id: null,
      source_storage_path: "path",
      source_content_hash: "hash",
      external_application_id: EXT_APP_A,
    };
    const text = "Incoming electrical service: three-phase 480V switchboard";
    const candidates = extractServicePhaseCandidatesFromPdfText(text, 1, source);
    const phase = candidates.find((c) => c.normalized_value === "three_phase");
    assert.ok(phase);
    assert.equal(phase.generic_specification_reference, false);
    assert.ok(isServicePhaseEvidence(phase.evidence_text));
  });

  it("marks row6-v1 candidates stale without touching approved values", () => {
    const oldCandidate = buildCandidateRecord({
      field_key: "demand_load_kw",
      raw_value: "100",
      normalized_value: 100,
      unit: "kW",
      source_type: "pepco_portal_document",
      source_document_name: "old.pdf",
      source_storage_path: "p/old",
      source_content_hash: "old-hash",
      extraction_method: "pdf_text",
      external_application_id: EXT_APP_A,
    });
    oldCandidate.extraction_schema_version = "row6-v1";
    const approved = { ...oldCandidate, status: "approved", candidate_id: "approved-1" };
    const updated = markStaleCandidates([oldCandidate, approved], { "p/old": "old-hash" });
    assert.equal(updated[0].status, "stale");
    assert.equal(updated[1].status, "approved");
    assert.equal(LOAD_EXTRACTION_SCHEMA_VERSION, "row6-v3");
    assert.ok(STALE_EXTRACTION_SCHEMA_VERSIONS.has("row6-v1"));
    assert.ok(STALE_EXTRACTION_SCHEMA_VERSIONS.has("row6-v2"));
  });

  it("bare TOTAL DEMAND LOAD in panel schedule is not project/service", () => {
    const source = {
      source_type: "pepco_portal_document",
      source_document_name: "schedule.pdf",
      source_document_id: null,
      source_storage_path: "path",
      source_content_hash: "hash",
      external_application_id: EXT_APP_A,
    };
    const text = "PANEL SCHEDULE\nTOTAL DEMAND LOAD: 51.33 kVA";
    const candidates = extractCandidatesFromPdfText(text, 1, source);
    assert.ok(
      !candidates.some(
        (c) => c.field_key === "demand_load_kva" && c.entity_type === "project_service",
      ),
    );
    const panel = candidates.find((c) => c.field_key === "panel_demand_load_kva");
    assert.ok(panel);
    assert.equal(panel.normalized_value, 51.33);
  });

  it("explicit total building/service evidence creates project/service candidate", () => {
    const source = {
      source_type: "pepco_portal_document",
      source_document_name: "load-calc.pdf",
      source_document_id: null,
      source_storage_path: "path",
      source_content_hash: "hash-bldg",
      external_application_id: EXT_APP_A,
    };
    const text = "TOTAL BUILDING LOAD DEMAND 420 kVA";
    const candidates = extractCandidatesFromPdfText(text, 1, source);
    const project = candidates.find(
      (c) => c.field_key === "demand_load_kva" && c.entity_type === "project_service",
    );
    assert.ok(project);
    assert.equal(project.is_project_total, true);
    assert.equal(canCandidateSatisfyPackage(project), true);
  });

  it("unidentified panel total stays panel-level and blocked", () => {
    const source = {
      source_type: "pepco_portal_document",
      source_document_name: "schedule.pdf",
      source_document_id: null,
      source_storage_path: "path",
      source_content_hash: "hash",
      external_application_id: EXT_APP_A,
    };
    const candidates = extractPanelLoadCandidatesFromPdfText("TOTAL DEMAND LOAD: 46.73 kVA", 1, source);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].entity_type, "electrical_panel");
    assert.equal(candidates[0].panel_identifier_missing, true);
    assert.equal(canCandidateSatisfyPackage(candidates[0]), false);
    assert.ok(approvalBlockedReason(candidates[0]));
  });

  it("same evidence does not produce both panel and project candidates", () => {
    const source = {
      source_type: "pepco_portal_document",
      source_document_name: "schedule.pdf",
      source_document_id: null,
      source_storage_path: "path",
      source_content_hash: "hash-dedup",
      external_application_id: EXT_APP_A,
    };
    const text = "PANEL MDP\nTOTAL DEMAND LOAD: 100 kVA";
    const candidates = extractCandidatesFromPdfText(text, 1, source);
    const loadMeaningMatches = candidates.filter((c) =>
      String(c.field_key).includes("demand_load"),
    );
    assert.equal(loadMeaningMatches.length, 1);
    assert.equal(loadMeaningMatches[0].field_key, "panel_demand_load_kva");
    assert.equal(loadMeaningMatches[0].entity_type, "electrical_panel");
  });

  it("overlapping evidence windows are deduplicated", () => {
    const source = {
      source_type: "pepco_portal_document",
      source_document_name: "schedule.pdf",
      source_document_id: null,
      source_storage_path: "path",
      source_content_hash: "hash-overlap",
      external_application_id: EXT_APP_A,
    };
    const panel = buildCandidateRecord({
      field_key: "panel_demand_load_kva",
      raw_value: "100",
      normalized_value: 100,
      unit: "kVA",
      entity_type: "electrical_panel",
      entity_name: "MDP",
      is_project_total: false,
      source_type: "pepco_portal_document",
      source_document_name: "schedule.pdf",
      source_storage_path: "p",
      source_content_hash: "hash-overlap",
      evidence_text: "TOTAL DEMAND LOAD: 100 kVA",
      extraction_method: "pdf_text",
      external_application_id: EXT_APP_A,
      page_number: 1,
    });
    const misclassified = buildCandidateRecord({
      field_key: "demand_load_kva",
      raw_value: "100",
      normalized_value: 100,
      unit: "kVA",
      entity_type: "project_service",
      is_project_total: false,
      source_type: "pepco_portal_document",
      source_document_name: "schedule.pdf",
      source_storage_path: "p",
      source_content_hash: "hash-overlap",
      evidence_text: "TOTAL DEMAND LOAD: 100 kVA",
      extraction_method: "pdf_text",
      external_application_id: EXT_APP_A,
      page_number: 1,
    });
    const deduped = deduplicateLoadCandidates([misclassified, panel]);
    assert.equal(deduped.length, 1);
    assert.equal(deduped[0].field_key, "panel_demand_load_kva");
    assert.equal(deduped[0].entity_type, "electrical_panel");
  });

  it("identified panel classification wins over generic classification", () => {
    const identified = buildCandidateRecord({
      field_key: "panel_demand_load_kva",
      raw_value: "200",
      normalized_value: 200,
      unit: "kVA",
      entity_type: "electrical_panel",
      entity_name: "MDP Surface",
      is_project_total: false,
      source_type: "pepco_portal_document",
      source_document_name: "schedule.pdf",
      source_storage_path: "p",
      source_content_hash: "h",
      evidence_text: "PANEL MDP Surface TOTAL DEMAND LOAD 200 kVA",
      extraction_method: "pdf_text",
      external_application_id: EXT_APP_A,
      page_number: 2,
    });
    const generic = buildCandidateRecord({
      field_key: "demand_load_kva",
      raw_value: "200",
      normalized_value: 200,
      unit: "kVA",
      entity_type: "project_service",
      is_project_total: false,
      source_type: "pepco_portal_document",
      source_document_name: "schedule.pdf",
      source_storage_path: "p",
      source_content_hash: "h",
      evidence_text: "PANEL MDP Surface TOTAL DEMAND LOAD 200 kVA",
      extraction_method: "pdf_text",
      external_application_id: EXT_APP_A,
      page_number: 2,
    });
    const winner = deduplicateLoadCandidates([generic, identified])[0];
    assert.equal(winner.entity_name, "MDP Surface");
    assert.equal(winner.field_key, "panel_demand_load_kva");
  });

  it("superseded candidates link to replacements where supported", () => {
    const stale = buildCandidateRecord({
      field_key: "demand_load_kva",
      raw_value: "100",
      normalized_value: 100,
      unit: "kVA",
      entity_type: "project_service",
      is_project_total: false,
      source_type: "pepco_portal_document",
      source_document_name: "schedule.pdf",
      source_storage_path: "p",
      source_content_hash: "hash-link",
      evidence_text: "TOTAL DEMAND LOAD 100 kVA",
      extraction_method: "pdf_text",
      external_application_id: EXT_APP_A,
      page_number: 1,
    });
    stale.status = "stale";
    stale.extraction_schema_version = "row6-v2";
    const replacement = buildCandidateRecord({
      field_key: "panel_demand_load_kva",
      raw_value: "100",
      normalized_value: 100,
      unit: "kVA",
      entity_type: "electrical_panel",
      entity_name: "MDP",
      is_project_total: false,
      source_type: "pepco_portal_document",
      source_document_name: "schedule.pdf",
      source_storage_path: "p",
      source_content_hash: "hash-link",
      evidence_text: "TOTAL DEMAND LOAD 100 kVA",
      extraction_method: "pdf_text",
      external_application_id: EXT_APP_A,
      page_number: 1,
    });
    const linked = linkSupersededCandidates([stale, replacement]);
    assert.equal(linked[0].superseded_by_candidate_id, replacement.candidate_id);
    assert.equal(linked[1].replaces_candidate_id, stale.candidate_id);
  });

  it("approved values remain unchanged after re-extraction merge", () => {
    const approved = buildCandidateRecord({
      field_key: "demand_load_kva",
      raw_value: "500",
      normalized_value: 500,
      unit: "kVA",
      entity_type: "project_service",
      is_project_total: true,
      source_type: "pepco_portal_document",
      source_document_name: "calc.pdf",
      source_storage_path: "p",
      source_content_hash: "approved-hash",
      evidence_text: "TOTAL BUILDING LOAD 500 kVA",
      extraction_method: "pdf_text",
      external_application_id: EXT_APP_A,
    });
    approved.status = "approved";
    const incoming = buildCandidateRecord({
      field_key: "panel_demand_load_kva",
      raw_value: "100",
      normalized_value: 100,
      unit: "kVA",
      entity_type: "electrical_panel",
      entity_name: "MDP",
      is_project_total: false,
      source_type: "pepco_portal_document",
      source_document_name: "schedule.pdf",
      source_storage_path: "p2",
      source_content_hash: "new-hash",
      evidence_text: "TOTAL DEMAND LOAD 100 kVA",
      extraction_method: "pdf_text",
      external_application_id: EXT_APP_A,
    });
    const merged = mergeCandidates([approved], [incoming], false);
    const stillApproved = merged.find((c) => c.status === "approved");
    assert.ok(stillApproved);
    assert.equal(stillApproved.normalized_value, 500);
  });

  it("ignores blank electric load rows in structured metadata", () => {
    const app = {
      projectDetails: {
        applicationDetails: {
          electricServiceLoads: {
            centralAC: 0,
            centralHeat: "",
            emptyRow: {},
          },
        },
      },
    };
    const candidates = extractCandidatesFromStructuredApplication(app, EXT_APP_A);
    assert.equal(candidates.length, 0);
  });

  it("validateManualVerifiedPayload rejects missing unit for engineering fields", () => {
    assert.throws(
      () =>
        validateManualVerifiedPayload({
          field_key: "connected_load_kw",
          value: 200,
          review_note: "Engineer confirmed",
          source_reference: "calc",
        }),
      (err) => err.code === "UNIT_REQUIRED",
    );
  });

  it("validateManualVerifiedPayload rejects field unit mismatch", () => {
    assert.throws(
      () =>
        validateManualVerifiedPayload({
          field_key: "connected_load_kva",
          value: 200,
          unit: "kW",
          review_note: "note",
          source_reference: "ref",
        }),
      (err) => err.code === "FIELD_UNIT_MISMATCH",
    );
  });

  it("validateManualVerifiedPayload requires review note", () => {
    assert.throws(
      () =>
        validateManualVerifiedPayload({
          field_key: "service_voltage",
          value: 480,
          unit: "V",
          review_note: "",
        }),
      (err) => err.code === "REVIEW_NOTE_REQUIRED",
    );
  });

  it("manual verified value stores user_entered_and_verified without overwriting candidates", async () => {
    const existingCandidate = buildCandidateRecord({
      field_key: "connected_load_kw",
      raw_value: "150",
      normalized_value: 150,
      unit: "kW",
      entity_type: "project_service",
      is_project_total: true,
      source_type: "pepco_portal_document",
      source_document_name: "panel.pdf",
      source_storage_path: "p",
      source_content_hash: "hash",
      extraction_method: "pdf_text",
      external_application_id: EXT_APP_A,
    });
    const tables = {
      coordination_records: [baseRecord()],
      coordination_applications: [
        {
          id: "load-draft-1",
          coordination_record_id: COORD_ID,
          project_id: PROJECT_ID,
          record_source: "agent_draft",
          idempotency_key: LOAD_PROFILE_IDEMPOTENCY_KEY,
          load_summary: { candidate_values: [existingCandidate], verified_values: {} },
        },
      ],
    };
    const supabase = createMockSupabase(tables);
    const result = await addManualVerifiedValue(supabase, {
      coordinationRecordId: COORD_ID,
      userId: USER_ID,
      field_key: "connected_load_kw",
      value: 220,
      unit: "kW",
      source_reference: "Engineer calc sheet",
      review_note: "Overall connected load confirmed by PE",
    });
    assert.equal(result.connected_load_satisfied, true);
    assert.equal(result.verified_values.connected_load_kw.method, "user_entered_and_verified");
    assert.equal(result.verified_values.connected_load_kw.value, 220);
    const draft = tables.coordination_applications[0];
    assert.equal(draft.load_summary.candidate_values.length, 1);
    assert.equal(draft.load_summary.candidate_values[0].status, "candidate");
  });
});
