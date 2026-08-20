"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { buildCoordinationScopeKey } = require("../app/services/uci/uci-load-extraction-scope.service.js");
const {
  DOCUMENT_PROCESSING_SCHEMA_VERSION,
  MANUAL_DOCUMENT_SCOPE_KEY,
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
const {
  buildLayoutAwarePageText,
} = require("../app/services/uci/uci-pdf-page-analysis.service.js");
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
        insert(row) {
          const copy = { id: row.id || `${table}-${store.length + 1}`, ...row };
          store.push(copy);
          state.insertRow = copy;
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
          return Promise.resolve({ data: state.insertRow || rows[0] || null, error: null });
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
  it("preserves physical PDF rows for deterministic schedule parsing", () => {
    const text = buildLayoutAwarePageText([
      { str: "101", transform: [1, 0, 0, 1, 10, 700] },
      { str: "OVEN", transform: [1, 0, 0, 1, 60, 700] },
      { str: "208 V", transform: [1, 0, 0, 1, 200, 700] },
      { str: "03/10/2026", transform: [1, 0, 0, 1, 400, 650] },
    ]);

    assert.equal(text, "101 OVEN 208 V\n03/10/2026");
  });

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

  it("processes coordination-scoped manual documents without a utility application", async () => {
    const record = baseRecord({
      metadata: {
        uci_provider_mapping: { method: PROVIDER_SETUP_METHOD, provider_slug: "pepco" },
      },
    });
    const manualDocument = {
      id: "manual-doc-1",
      project_id: PROJECT_ID,
      document_type: "other",
      file_name: "client-load-schedule.pdf",
      file_path: `${USER_ID}/${PROJECT_ID}/manual-doc-1/client-load-schedule.pdf`,
      file_type: "application/pdf",
      description: `Agent 2 manual upload · coordination ${COORD_ID}`,
      created_at: "2026-08-14T00:00:00.000Z",
    };
    const tables = {
      coordination_records: [record],
      project_documents: [manualDocument],
    };
    const supabase = createMockSupabase(tables);
    const deps = {
      downloadFromSupabaseStorage: async () => ({
        ok: true,
        data: {
          arrayBuffer: async () => Buffer.from("%PDF-1.4\nService voltage 480 V three phase"),
        },
      }),
      extractPdfPages: async () => [
        { pageNumber: 1, text: "Service voltage 480 V three phase" },
      ],
    };

    const manualResult = await runDocumentProcessing(supabase, {
      coordinationRecordId: COORD_ID,
      userId: USER_ID,
      externalApplicationId: null,
      deps,
    });

    assert.equal(manualResult.external_application_id, "");
    assert.equal(manualResult.documents.length, 1);
    assert.equal(manualResult.documents[0].source_type, "manual_upload");
    assert.ok(manualResult.findings_count > 0);
    const updatedMetadata = tables.coordination_records[0].metadata;
    const manualState = getDocumentProcessingState(updatedMetadata, null, COORD_ID);
    assert.ok(manualState);
    assert.equal(manualState.project_id, PROJECT_ID);
    assert.equal(manualState.coordination_record_id, COORD_ID);
    assert.equal(manualState.tenant_id, TENANT_A);
    assert.ok(updatedMetadata.uci_document_processing.applications[buildCoordinationScopeKey(COORD_ID)]);

    record.metadata.pepco_application_detail_discovery = {
      applications: [{ applicationUuid: EXT_APP_A, downloadedFiles: [] }],
    };
    const linkedResult = await runDocumentProcessing(supabase, {
      coordinationRecordId: COORD_ID,
      userId: USER_ID,
      externalApplicationId: EXT_APP_A,
      deps,
    });

    const linkedManualDocuments = linkedResult.documents.filter(
      (document) => document.source_type === "manual_upload",
    );
    assert.equal(linkedManualDocuments.length, 1);
    assert.equal(linkedManualDocuments[0].processing_status, "duplicate");
    assert.equal(linkedManualDocuments[0].document_id, manualResult.documents[0].document_id);
    const linkedDocumentIds = linkedResult.documents.map((document) => document.document_id);
    assert.equal(new Set(linkedDocumentIds).size, linkedDocumentIds.length);
    const linkedState = getDocumentProcessingState(record.metadata, EXT_APP_A, COORD_ID);
    const linkedFindingIds = linkedState.findings.map((finding) => finding.finding_id);
    assert.equal(new Set(linkedFindingIds).size, linkedFindingIds.length);
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

  it("accepts native text for cut sheets without vision fallback", () => {
    const longNativeText =
      "Appliance cut sheet reference for rooftop unit RTU-1 with model serial and BTU input summary ".repeat(2);
    const result = processDocumentPages(
      [{ pageNumber: 1, text: longNativeText }],
      { preferNativeTextRoles: ["equipment_cut_sheet"] },
    );
    assert.equal(result.page_coverage.pages_sent_to_vision, 0);
    assert.equal(result.processing_status, "complete");
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

  it("reprocesses a selected document from its stored path and replaces its findings", async () => {
    const record = baseRecord();
    const tables = { coordination_records: [record], project_documents: [] };
    const supabase = createMockSupabase(tables);
    const downloads = [];
    let voltage = 480;
    const pageText = () =>
      `NEW PANELBOARD "MDP" 800A, ${voltage === 480 ? "277/480" : "120/208"}V, 3-PH M CT CABINET AND METER`;
    const deps = {
      downloadFromSupabaseStorage: async ({ storagePath }) => {
        downloads.push(String(storagePath));
        return {
          ok: true,
          data: { arrayBuffer: async () => Buffer.from(`%PDF-1.4\n${pageText()}`) },
        };
      },
      extractPdfPages: async () => [
        { pageNumber: 1, text: pageText() },
      ],
    };

    await runDocumentProcessing(supabase, {
      coordinationRecordId: COORD_ID,
      userId: USER_ID,
      externalApplicationId: EXT_APP_A,
      refresh: true,
      deps,
    });
    const before = getDocumentProcessingState(record.metadata, EXT_APP_A);
    const target = before.documents.find(
      (document) => document.original_filename === ONE_LINE_FILE.fileName,
    );
    const untouched = before.documents.find(
      (document) => document.original_filename === PANEL_FILE.fileName,
    );
    assert.ok(target);
    assert.ok(untouched);

    downloads.length = 0;
    voltage = 208;
    await runDocumentProcessing(supabase, {
      coordinationRecordId: COORD_ID,
      userId: USER_ID,
      externalApplicationId: EXT_APP_A,
      refresh: true,
      documentIds: [target.document_id],
      deps,
    });

    const after = getDocumentProcessingState(record.metadata, EXT_APP_A);
    assert.deepEqual(downloads, [ONE_LINE_FILE.storagePath]);
    assert.equal(
      after.documents.find((document) => document.document_id === untouched.document_id).processed_at,
      untouched.processed_at,
    );
    const targetFindings = after.findings.filter(
      (finding) => finding.document_id === target.document_id,
    );
    assert.ok(targetFindings.length > 0);
    assert.ok(targetFindings.some((finding) => String(finding.raw_value).includes("208")));
    assert.ok(targetFindings.every((finding) => !String(finding.raw_value).includes("480")));
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

  it("extracts electric synthetic load letter project totals for two projects with identical text", () => {
    const text = [
      "Groundbreak 02/22/2027",
      "Requested service amperage 1000 A",
      "Requested voltage 120/208 V",
      "Wire configuration 4 wire",
      "Meter count 1",
      "Project connected load 410 kVA",
      "Project demand load 315 kVA",
      "Requested in-service target 01/15/2027",
    ].join("\n");

    for (const [projectId, contentHash] of [
      ["proj-highland-springs", "hash-highland-load-letter"],
      ["proj-culpeper", "hash-culpeper-load-letter"],
    ]) {
      const { findings } = extractBroadFindingsFromPages(
        [{ pageNumber: 1, text }],
        {
          source_type: "manual_upload",
          source_document_name: "01_Synthetic_Load_Letter.pdf",
          source_document_id: `${projectId}-load-letter`,
          source_content_hash: contentHash,
          external_application_id: "",
        },
        `uci_doc:${projectId}`,
        ["supporting_document"],
      );

      const connected = findings.find((f) => f.field_key === "connected_load_kva");
      const demand = findings.find((f) => f.field_key === "demand_load_kva");
      assert.equal(connected?.normalized_value, 410, projectId);
      assert.equal(demand?.normalized_value, 315, projectId);
      assert.equal(connected?.entity_type, "project_service", projectId);
      assert.equal(demand?.entity_type, "project_service", projectId);
      assert.equal(connected?.is_project_total, true, projectId);
      assert.equal(demand?.is_project_total, true, projectId);
      assert.equal(connected?.package_eligible, true, projectId);
      assert.equal(demand?.package_eligible, true, projectId);
    }
  });
});
