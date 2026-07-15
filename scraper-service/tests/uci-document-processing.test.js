"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  DOCUMENT_PROCESSING_SCHEMA_VERSION,
  UCI_DOCUMENT_ROLES,
  classifyDocumentRoles,
  mapRolesToUciStages,
  discoverAllUciDocuments,
  buildManifestEntry,
  processDocumentPages,
  candidateRecordToFinding,
  filterFindingsForUciStage,
  markStaleFindings,
  computeCoverageSummary,
  evaluateRunCompletion,
  sanitizeManifestEntryForApi,
  getDocumentProcessingState,
  runDocumentProcessing,
  externalApplicationExistsInRecord,
  buildProcessingFailure,
  resolveFindingUciStages,
  evaluateDocumentFindingsExtraction,
  extractBroadFindingsFromPages,
} = require("../app/services/uci/uci-document-processing.service.js");
const {
  buildCandidateRecord,
  extractCandidatesFromPdfText,
} = require("../app/services/uci/uci-load-candidate.service.js");
const { PROVIDER_SETUP_METHOD } = require("../app/services/uci/uci-provider-setup.service.js");

const TENANT_A = "tenant-a-0000-4000-8000-000000000101";
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
            documents: [
              { documentName: PANEL_FILE.documentName, documentType: "Panel Schedule" },
              { documentName: ONE_LINE_FILE.documentName, documentType: "One Line" },
            ],
            downloadedFiles: [PANEL_FILE, ONE_LINE_FILE],
          },
          {
            applicationUuid: EXT_APP_B,
            downloadedFiles: [
              {
                ...PANEL_FILE,
                storagePath: `uci/${TENANT_A}/${PROJECT_ID}/${COORD_ID}/pepco/${EXT_APP_B}/other.pdf`,
                contentHash: "hash-other-app",
                fileName: "other.pdf",
                documentName: "other.pdf",
              },
            ],
          },
        ],
      },
    },
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

describe("uci-document-processing.service", () => {
  it("discovers every document for the selected external application", () => {
    const discovery = discoverAllUciDocuments(baseRecord(), {
      externalApplicationId: EXT_APP_A,
      projectDocuments: [],
    });
    assert.equal(discovery.documents.length, 2);
    assert.ok(discovery.documents.every((d) => d.external_application_id === EXT_APP_A));
  });

  it("excludes documents from other external applications", () => {
    const discovery = discoverAllUciDocuments(baseRecord(), {
      externalApplicationId: EXT_APP_A,
      projectDocuments: [],
    });
    const paths = discovery.documents.map((d) => d.storage_path);
    assert.ok(!paths.some((p) => String(p).includes(EXT_APP_B)));
  });

  it("assigns document roles without irrelevant status", () => {
    const roles = classifyDocumentRoles({
      fileName: "E602 - ELECTRICAL PANEL SCHEDULES.pdf",
      portalDocumentType: "Panel Schedule",
    });
    assert.ok(roles.some((r) => r.role === "panel_schedule"));
    assert.ok(!roles.some((r) => r.role === "irrelevant"));
    assert.ok(UCI_DOCUMENT_ROLES.includes("panel_schedule"));
  });

  it("classifies underscore-heavy filenames for one-line and COMcheck roles", () => {
    const oneLine = classifyDocumentRoles({
      fileName: "E601_-_ELECTRICAL_ONE-LINE_DIAGRAMS.pdf",
    });
    assert.ok(oneLine.some((r) => r.role === "one_line_diagram"));

    const comcheck = classifyDocumentRoles({
      fileName: "_LTG_COMcheck_-_Sample_Project.pdf",
    });
    assert.ok(comcheck.some((r) => r.role === "COMcheck"));
  });

  it("allows multiple roles per document", () => {
    const roles = classifyDocumentRoles({
      fileName: "SITE PLAN AND CIVIL PLAN.pdf",
    });
    const roleNames = roles.map((r) => r.role);
    assert.ok(roleNames.includes("site_plan"));
    assert.ok(roleNames.includes("civil_plan"));
  });

  it("maps roles to UCI stages", () => {
    const stages = mapRolesToUciStages([{ role: "panel_schedule" }, { role: "one_line_diagram" }]);
    assert.ok(stages.includes("agent_2_load_profile"));
    assert.ok(stages.includes("agent_3_application_package"));
  });

  it("accounts for every page in processDocumentPages", () => {
    const result = processDocumentPages([
      { pageNumber: 1, text: "Service voltage 480 V three phase" },
      { pageNumber: 2, text: "" },
      { pageNumber: 3, text: "x" },
    ]);
    assert.equal(result.page_coverage.total_pages, 3);
    assert.equal(result.page_coverage.pages_discovered, 3);
    assert.equal(result.page_coverage.pages_sent_to_ocr, 1);
    assert.equal(result.processing_status, "partial");
    assert.ok(result.failure_reason);
  });

  it("marks partial when vision is required for low-text pages", () => {
    const result = processDocumentPages([{ pageNumber: 1, text: "ab" }]);
    assert.equal(result.page_coverage.pages_sent_to_vision, 1);
    assert.equal(result.processing_status, "partial");
  });

  it("builds manifest entries for every discovered document", () => {
    const discovery = discoverAllUciDocuments(baseRecord(), {
      externalApplicationId: EXT_APP_A,
      projectDocuments: [],
    });
    const entries = discovery.documents.map((d) => buildManifestEntry(d));
    assert.equal(entries.length, 2);
    assert.ok(entries.every((e) => e.document_id));
    assert.ok(entries.every((e) => e.document_roles.length > 0));
    assert.ok(entries.every((e) => e.processing_status === "pending"));
  });

  it("filters Agent 2 load-related findings after broad extraction", () => {
    const candidate = buildCandidateRecord({
      field_key: "service_voltage",
      raw_value: "480",
      normalized_value: 480,
      unit: "V",
      source_type: "pepco_portal_document",
      source_document_name: "one-line.pdf",
      source_storage_path: "p",
      source_content_hash: "h",
      extraction_method: "pdf_text",
      external_application_id: EXT_APP_A,
    });
    const finding = candidateRecordToFinding(candidate, "doc-1", ["one_line_diagram"]);
    const agent2 = filterFindingsForUciStage([finding], "agent_2_load_profile");
    assert.equal(agent2.length, 1);
    const agent4 = filterFindingsForUciStage([finding], "agent_4_submission");
    assert.equal(agent4.length, 0);
  });

  it("extracts broad findings from PDF text before stage filtering", () => {
    const text = "Main service size 400 A at 480 V";
    const source = {
      source_type: "pepco_portal_document",
      source_document_name: "panel.pdf",
      source_document_id: null,
      source_storage_path: "path",
      source_content_hash: "hash",
      external_application_id: EXT_APP_A,
    };
    const candidates = extractCandidatesFromPdfText(text, 1, source);
    const findings = candidates.map((c) =>
      candidateRecordToFinding(c, "doc-1", ["panel_schedule"]),
    );
    assert.ok(findings.length >= 1);
    assert.ok(findings.every((f) => f.verification_status === "raw"));
    assert.ok(findings.every((f) => f.requires_human_review === true));
  });

  it("marks stale findings on content hash refresh", () => {
    const findings = [
      {
        finding_id: "f1",
        source_content_hash: "hash-panel",
        verification_status: "raw",
      },
      {
        finding_id: "f2",
        source_content_hash: "other",
        verification_status: "verified",
      },
    ];
    const updated = markStaleFindings(findings, "hash-panel");
    assert.equal(updated[0].verification_status, "stale");
    assert.equal(updated[1].verification_status, "verified");
  });

  it("sanitizes storage paths from API manifest entries", () => {
    const entry = sanitizeManifestEntryForApi({
      document_id: "d1",
      storage_path: "uci/secret/path.pdf",
      storage_bucket: "project-documents",
      original_filename: "test.pdf",
    });
    assert.equal(entry.storage_path, undefined);
    assert.equal(entry.storage_bucket, undefined);
  });

  it("blocks run completion when pages are unaccounted", () => {
    const completion = evaluateRunCompletion({
      external_application_id: EXT_APP_A,
      documents: [
        {
          document_id: "d1",
          external_application_id: EXT_APP_A,
          original_filename: "a.pdf",
          processing_status: "partial",
          failure_reason: "Parser partial",
          page_coverage: {
            total_pages: 3,
            pages_discovered: 3,
            pages_processed: 1,
            blank_pages: 0,
            failed_pages: 0,
            pages_sent_to_vision: 0,
          },
        },
      ],
      coverage: {},
    });
    assert.equal(completion.run_status, "partial");
    assert.ok(completion.blockers.some((b) => b.includes("unaccounted")));
  });

  it("processes all documents without aborting on single failure", async () => {
    const tables = {
      coordination_records: [baseRecord()],
      project_documents: [],
    };
    const supabase = createMockSupabase(tables);

    let call = 0;
    const result = await runDocumentProcessing(supabase, {
      coordinationRecordId: COORD_ID,
      userId: USER_ID,
      externalApplicationId: EXT_APP_A,
      refresh: true,
      deps: {
        downloadFromSupabaseStorage: async ({ storagePath }) => {
          call += 1;
          if (String(storagePath).includes("E602")) {
            return { ok: false, errorMessage: "storage_missing" };
          }
          return {
            ok: true,
            data: {
              arrayBuffer: async () => Buffer.from("%PDF-1.4\nService 480 V\fPage2 text here enough"),
            },
          };
        },
        extractPdfPages: async () => [
          { pageNumber: 1, text: "Service voltage 480 V" },
          { pageNumber: 2, text: "Panel MDP demand load 100 kVA" },
        ],
      },
    });

    assert.ok(result.documents.length >= 2);
    assert.ok(result.documents.some((d) => d.processing_status === "failed"));
    assert.ok(result.documents.some((d) => d.processing_status === "complete" || d.processing_status === "partial"));
    assert.ok(result.failed_documents.length >= 1);
    assert.notEqual(result.run_status, "complete");

    const state = getDocumentProcessingState(tables.coordination_records[0].metadata, EXT_APP_A);
    assert.ok(state);
    assert.equal(state.schema_version, DOCUMENT_PROCESSING_SCHEMA_VERSION);
    assert.ok(Array.isArray(state.findings));
    assert.ok(state.findings_by_stage.agent_2_load_profile.length >= 0);
  });

  it("reuses duplicate content hash without reprocessing", async () => {
    const priorState = {
      schema_version: DOCUMENT_PROCESSING_SCHEMA_VERSION,
      external_application_id: EXT_APP_A,
      documents: [
        {
          document_id: "prior-doc",
          content_hash: "hash-oneline",
          processing_status: "complete",
          original_filename: ONE_LINE_FILE.fileName,
          schema_version: DOCUMENT_PROCESSING_SCHEMA_VERSION,
          document_roles: ["one_line_diagram"],
          page_coverage: {
            total_pages: 1,
            pages_discovered: 1,
            pages_processed: 1,
            blank_pages: 0,
            failed_pages: 0,
            pages_sent_to_vision: 0,
          },
        },
      ],
      findings: [],
    };

    const record = baseRecord({
      metadata: {
        ...baseRecord().metadata,
        uci_document_processing: {
          schema_version: DOCUMENT_PROCESSING_SCHEMA_VERSION,
          applications: {
            [EXT_APP_A]: priorState,
          },
        },
      },
    });

    const tables = {
      coordination_records: [record],
      project_documents: [],
    };
    const supabase = createMockSupabase(tables);

    const result = await runDocumentProcessing(supabase, {
      coordinationRecordId: COORD_ID,
      userId: USER_ID,
      externalApplicationId: EXT_APP_A,
      refresh: false,
      deps: {
        downloadFromSupabaseStorage: async () => ({
          ok: true,
          data: {
            arrayBuffer: async () => Buffer.from("%PDF-1.4\ncontent"),
          },
        }),
        extractPdfPages: async () => [{ pageNumber: 1, text: "Service 480 V" }],
      },
    });

    const duplicate = result.documents.find((d) => d.processing_status === "duplicate");
    assert.ok(duplicate);
    assert.equal(duplicate.failure_reason, "Exact duplicate content hash");
  });

  it("computes coverage summary counts", () => {
    const docs = [
      { processing_status: "complete", page_coverage: { total_pages: 2, pages_processed: 2, failed_pages: 0 } },
      { processing_status: "failed", page_coverage: null },
    ];
    const findings = [
      { verification_status: "raw", field_key: "service_voltage" },
      { verification_status: "stale", field_key: "connected_load_kw" },
    ];
    const coverage = computeCoverageSummary(docs, findings);
    assert.equal(coverage.documents_registered, 2);
    assert.equal(coverage.complete, 1);
    assert.equal(coverage.failed, 1);
    assert.equal(coverage.findings_extracted, 1);
    assert.equal(coverage.total_pages, 2);
  });

  it("resolves selected external application from legacy pepco discovery metadata", () => {
    assert.equal(externalApplicationExistsInRecord(baseRecord(), EXT_APP_A), true);
    assert.equal(externalApplicationExistsInRecord(baseRecord(), EXT_APP_B), true);
    assert.equal(externalApplicationExistsInRecord(baseRecord(), "missing-app"), false);
  });

  it("returns structured 404 when external application is not found", async () => {
    const supabase = createMockSupabase({
      coordination_records: [baseRecord()],
      project_documents: [],
    });

    await assert.rejects(
      () =>
        runDocumentProcessing(supabase, {
          coordinationRecordId: COORD_ID,
          userId: USER_ID,
          externalApplicationId: "missing-app",
        }),
      (err) => {
        assert.equal(err.statusCode, 404);
        assert.equal(err.code, "APPLICATION_NOT_FOUND");
        return true;
      },
    );
  });

  it("returns structured 422 when no downloaded documents exist for the application", async () => {
    const emptyAppRecord = baseRecord({
      metadata: {
        ...baseRecord().metadata,
        pepco_application_detail_discovery: {
          applications: [
            {
              applicationUuid: EXT_APP_A,
              documents: [],
              downloadedFiles: [],
            },
          ],
        },
      },
    });
    const supabase = createMockSupabase({
      coordination_records: [emptyAppRecord],
      project_documents: [],
    });

    await assert.rejects(
      () =>
        runDocumentProcessing(supabase, {
          coordinationRecordId: COORD_ID,
          userId: USER_ID,
          externalApplicationId: EXT_APP_A,
        }),
      (err) => {
        assert.equal(err.statusCode, 422);
        assert.equal(err.code, "NO_DOWNLOADED_DOCUMENTS");
        return true;
      },
    );
  });

  it("survives project_documents schema mismatch and discovers legacy downloadedFiles", async () => {
    const tables = {
      coordination_records: [baseRecord()],
      project_documents: [],
    };

    const supabase = {
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
            if (row && state.mode === "update" && state.patch) {
              Object.assign(row, state.patch);
            }
            return Promise.resolve({ data: row ?? null, error: null });
          },
          update(patch) {
            state.mode = "update";
            state.patch = patch;
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

    const result = await runDocumentProcessing(supabase, {
      coordinationRecordId: COORD_ID,
      userId: USER_ID,
      externalApplicationId: EXT_APP_A,
      deps: {
        downloadFromSupabaseStorage: async () => ({
          ok: true,
          data: {
            arrayBuffer: async () => Buffer.from("%PDF-1.4\nService voltage 480 V"),
          },
        }),
        extractPdfPages: async () => [{ pageNumber: 1, text: "Service voltage 480 V" }],
      },
    });

    assert.ok(result.status);
    assert.equal(result.documents_discovered, 2);
    assert.ok(result.documents_registered >= 2);
    assert.notEqual(result.run_status, "pending");
  });

  it("tags missing storage objects with structured per-document failure codes", async () => {
    const supabase = createMockSupabase({
      coordination_records: [baseRecord()],
      project_documents: [],
    });

    const result = await runDocumentProcessing(supabase, {
      coordinationRecordId: COORD_ID,
      userId: USER_ID,
      externalApplicationId: EXT_APP_A,
      refresh: true,
      deps: {
        downloadFromSupabaseStorage: async () => ({ ok: false, errorMessage: "not_found" }),
        extractPdfPages: async () => [{ pageNumber: 1, text: "x" }],
      },
    });

    assert.ok(result.failed_documents.length >= 1);
    assert.ok(
      result.failed_documents.every(
        (f) => typeof f.code === "string" && typeof f.stage === "string",
      ),
    );
    assert.ok(result.failed_documents.some((f) => f.code === "STORAGE_OBJECT_MISSING"));
  });

  it("includes structured partial run counts in the API response", async () => {
    const supabase = createMockSupabase({
      coordination_records: [baseRecord()],
      project_documents: [],
    });

    let call = 0;
    const result = await runDocumentProcessing(supabase, {
      coordinationRecordId: COORD_ID,
      userId: USER_ID,
      externalApplicationId: EXT_APP_A,
      refresh: true,
      deps: {
        downloadFromSupabaseStorage: async ({ storagePath }) => {
          call += 1;
          if (String(storagePath).includes("E602")) {
            return { ok: false, errorMessage: "storage_missing" };
          }
          return {
            ok: true,
            data: {
              arrayBuffer: async () => Buffer.from("%PDF-1.4\nService 480 V\fPage2 text here enough"),
            },
          };
        },
        extractPdfPages: async () => [
          { pageNumber: 1, text: "Service voltage 480 V" },
          { pageNumber: 2, text: "Panel MDP demand load 100 kVA" },
        ],
      },
    });

    assert.equal(result.status, result.run_status);
    assert.ok(result.documents_discovered >= 2);
    assert.ok(result.documents_failed >= 1);
    assert.ok(result.documents_complete + result.documents_partial + result.documents_failed >= 2);
  });

  it("builds structured processing failure entries with codes", () => {
    const entry = buildProcessingFailure({
      document_name: "test.pdf",
      source_type: "pepco_portal_document",
      stage: "storage_download",
      code: "STORAGE_OBJECT_MISSING",
      message: "The downloaded utility document could not be retrieved.",
    });
    assert.equal(entry.code, "STORAGE_OBJECT_MISSING");
    assert.equal(entry.stage, "storage_download");
  });

  it("maps equipment counts to Agent 2 only, not Agent 3", () => {
    const finding = candidateRecordToFinding(
      {
        field_key: "central_ac_count",
        raw_value: "1",
        normalized_value: 1,
        unit: "count",
        entity_type: "equipment",
        entity_name: "Central AC",
        category: "equipment_load",
        evidence_text: "Central AC count: 1",
        extraction_method: "structured_application",
        source_document_name: "provider_application_metadata",
        source_content_hash: "structured:app",
      },
      "doc-structured",
      ["utility_application", "service_configuration"],
    );
    assert.ok(finding.uci_stages.includes("agent_2_load_profile"));
    assert.ok(!finding.uci_stages.includes("agent_3_application_package"));
  });

  it("flags high-value documents with zero engineering findings", () => {
    const quality = evaluateDocumentFindingsExtraction(
      [{ pageNumber: 1, text: "Some native text content here", analysis: { status: "text_extracted" } }],
      ["one_line_diagram"],
      [{ field_key: "package_document_present", uci_stages: ["agent_3_application_package"] }],
    );
    assert.equal(quality.status, "no_supported_findings");
    assert.ok(quality.warnings.length > 0);
  });

  it("extracts one-line service facts through broad findings builder", () => {
    const text = `NEW PANELBOARD "MDP" 800A, 120/208V, 3-PH M CT CABINET AND METER`;
    const { findings } = extractBroadFindingsFromPages(
      [{ pageNumber: 1, text }],
      {
        source_type: "pepco_portal_document",
        source_document_name: "one-line.pdf",
        source_content_hash: "h1",
        external_application_id: EXT_APP_A,
      },
      "doc-oneline",
      ["one_line_diagram"],
    );
    assert.ok(findings.some((f) => f.field_key === "service_voltage" && f.raw_value === "120/208"));
    assert.ok(
      findings.some((f) => f.field_key === "main_distribution_panel_rating" && f.entity_name === "MDP"),
    );
    assert.ok(findings.some((f) => f.field_key === "ct_cabinet_present"));
    assert.ok(findings.some((f) => f.uci_stages.includes("agent_2_load_profile")));
    assert.ok(!findings.some((f) => f.field_key === "service_amperage"));
  });
});
