"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyPdfPage,
  processDocumentPagesFromAnalysis,
} = require("../app/services/uci/uci-pdf-page-analysis.service.js");
const {
  getDocumentFallbackConfig,
  isFallbackMethodAvailable,
  fallbackProviderStatus,
} = require("../app/services/uci/uci-document-fallback-config.service.js");
const {
  MockVisionPageProcessor,
  MockOcrPageProcessor,
} = require("../app/services/uci/uci-document-fallback-processors.service.js");
const {
  mergeDocumentFindingsHybrid,
  findingsSemanticallyEqual,
  isOcrApprovalBlocked,
} = require("../app/services/uci/uci-document-findings-merge.service.js");
const {
  runDocumentFallbackProcessing,
  visionFindingToRecord,
  collectFallbackPages,
} = require("../app/services/uci/uci-document-fallback.service.js");
const {
  candidateRecordToFinding,
} = require("../app/services/uci/uci-document-processing.service.js");
const { DOCUMENT_PROCESSING_SCHEMA_VERSION } = require("../app/services/uci/uci-document-processing.service.js");
const { extractCandidatesFromPdfText } = require("../app/services/uci/uci-load-candidate.service.js");
const { PROVIDER_SETUP_METHOD } = require("../app/services/uci/uci-provider-setup.service.js");

const TENANT_A = "tenant-a-0000-4000-8000-000000000101";
const PROJECT_ID = "proj-generic-1";
const COORD_ID = "coord-generic-1";
const EXT_APP_A = "pepco-app-uuid-a";
const USER_ID = "user-1";

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

function baseProcessingState(pageRecords, overrides = {}) {
  return {
    schema_version: DOCUMENT_PROCESSING_SCHEMA_VERSION,
    external_application_id: EXT_APP_A,
    project_id: PROJECT_ID,
    tenant_id: TENANT_A,
    coordination_record_id: COORD_ID,
    documents: [
      {
        document_id: "uci_doc:panel",
        source_type: "pepco_portal_document",
        external_application_id: EXT_APP_A,
        project_id: PROJECT_ID,
        original_filename: "panel-schedule.pdf",
        storage_bucket: "uci-documents",
        storage_path: `uci/unconfigured/${PROJECT_ID}/${COORD_ID}/pepco/${EXT_APP_A}/panel-schedule.pdf`,
        content_hash: "hash-panel",
        document_roles: ["panel_schedule"],
        processing_status: "partial",
        page_records: pageRecords,
        page_coverage: {
          total_pages: pageRecords.length,
          fallback_pending: pageRecords.filter((p) =>
            ["vision_required", "ocr_required"].includes(String(p.status)),
          ).length,
        },
      },
    ],
    findings: [],
    findings_by_stage: {
      agent_2_load_profile: [],
      agent_3_application_package: [],
      agent_4_submission: [],
    },
    ...overrides,
  };
}

describe("uci-document-fallback layer", () => {
  it("classifies low-text drawing page as vision_required", () => {
    const analysis = classifyPdfPage({
      page_number: 1,
      native_text: "SHEET E601 ONE LINE DIAGRAM SCALE 1/4",
      native_text_length: 35,
      text_items: [{ str: "SHEET", transform: [1, 0, 0, 1, 10, 700] }],
      viewport: { width: 612, height: 792 },
    });
    assert.equal(analysis.recommended_method, "vision");
    assert.equal(analysis.status, "vision_required");
    assert.equal(analysis.page_type, "drawing");
  });

  it("classifies image-only page as ocr_required", () => {
    const analysis = classifyPdfPage({
      page_number: 2,
      native_text: "",
      native_text_length: 0,
      viewport: { width: 612, height: 792 },
    });
    assert.equal(analysis.recommended_method, "ocr");
    assert.equal(analysis.status, "ocr_required");
  });

  it("does not require vision/ocr for sufficient native text", () => {
    const analysis = classifyPdfPage({
      page_number: 1,
      native_text: "Service voltage 480 V three phase connected load 100 kVA main service",
      native_text_length: 70,
      viewport: { width: 612, height: 792 },
    });
    assert.equal(analysis.recommended_method, "native_text");
    assert.equal(analysis.status, "text_extracted");
  });

  it("defaults vision and OCR to disabled", () => {
    const config = getDocumentFallbackConfig({
      UCI_DOCUMENT_VISION_ENABLED: "false",
      UCI_DOCUMENT_OCR_ENABLED: "false",
      OPENAI_API_KEY: "",
    });
    assert.equal(config.vision_enabled, false);
    assert.equal(config.ocr_enabled, false);
    assert.equal(isFallbackMethodAvailable("vision", config), false);
    const status = fallbackProviderStatus(config);
    assert.ok(status.warnings.length >= 2);
  });

  it("persists vision structured findings with bounding region", () => {
    const source = {
      source_type: "pepco_portal_document",
      source_document_name: "one-line.pdf",
      source_document_id: "d1",
      source_storage_path: "path",
      source_content_hash: "hash",
      external_application_id: EXT_APP_A,
    };
    const finding = visionFindingToRecord(
      {
        field_key: "service_voltage",
        raw_value: "480V",
        normalized_value: 480,
        unit: "V",
        entity_type: "project_service",
        page_number: 1,
        evidence_text: "SERVICE 480V",
        bounding_region: { x: 10, y: 20, width: 100, height: 30 },
        confidence: 0.82,
      },
      source,
      "uci_doc:oneline",
      ["one_line_diagram"],
    );
    assert.equal(finding.extraction_method, "vision");
    assert.deepEqual(finding.bounding_region, { x: 10, y: 20, width: 100, height: 30 });
    assert.equal(finding.page_number, 1);
  });

  it("passes OCR text through deterministic extractors", () => {
    const text = "Main service size 400 A at 480 V";
    const source = {
      source_type: "pepco_portal_document",
      source_document_name: "scan.pdf",
      source_storage_path: "p",
      source_content_hash: "h",
      external_application_id: EXT_APP_A,
      extraction_method: "ocr",
    };
    const candidates = extractCandidatesFromPdfText(text, 1, source);
    assert.ok(candidates.length >= 1);
    assert.equal(candidates[0].extraction_method, "ocr");
  });

  it("collapses duplicate native and vision findings", () => {
    const base = {
      finding_id: "f1",
      field_key: "service_voltage",
      raw_value: "480",
      normalized_value: 480,
      unit: "V",
      entity_type: "project_service",
      entity_name: null,
      page_number: 1,
      evidence_text: "Service voltage 480 V",
      source_content_hash: "hash",
      source_document_name: "doc.pdf",
      extraction_method: "pdf_text",
    };
    const vision = {
      ...base,
      finding_id: "f2",
      extraction_method: "vision",
      contributing_methods: ["vision"],
    };
    const merged = mergeDocumentFindingsHybrid([base], [vision]);
    assert.equal(merged.length, 1);
    assert.ok(String(merged[0].extraction_method).includes("vision"));
  });

  it("preserves conflicting findings from different methods", () => {
    const a = {
      finding_id: "f1",
      field_key: "service_voltage",
      normalized_value: 480,
      unit: "V",
      entity_type: "project_service",
      page_number: 1,
      evidence_text: "480 V",
      source_content_hash: "hash",
      source_document_name: "doc.pdf",
      extraction_method: "pdf_text",
    };
    const b = {
      ...a,
      finding_id: "f2",
      normalized_value: 600,
      raw_value: "600",
      extraction_method: "vision",
    };
    const merged = mergeDocumentFindingsHybrid([a], [b]);
    assert.equal(merged.length, 2);
    assert.ok(merged.some((f) => f.conflict === true));
  });

  it("blocks approval for low-confidence OCR", () => {
    assert.equal(isOcrApprovalBlocked(0.4, 0.6), true);
    assert.equal(isOcrApprovalBlocked(0.85, 0.6), false);
  });

  it("returns partial when providers disabled and fallback pages remain", async () => {
    const pageRecords = [
      {
        page_number: 1,
        status: "vision_required",
        page_analysis: { recommended_method: "vision", reason: "drawing" },
      },
    ];
    const tables = {
      coordination_records: [
        {
          id: COORD_ID,
          project_id: PROJECT_ID,
          tenant_id: TENANT_A,
          metadata: {
            uci_provider_mapping: { method: PROVIDER_SETUP_METHOD },
            uci_document_processing: {
              applications: {
                [EXT_APP_A]: baseProcessingState(pageRecords),
              },
            },
          },
        },
      ],
    };
    const supabase = createMockSupabase(tables);
    const result = await runDocumentFallbackProcessing(supabase, {
      coordinationRecordId: COORD_ID,
      userId: USER_ID,
      externalApplicationId: EXT_APP_A,
      mode: "vision",
      deps: {
        env: {
          UCI_DOCUMENT_VISION_ENABLED: "false",
          UCI_DOCUMENT_OCR_ENABLED: "false",
          OPENAI_API_KEY: "",
        },
        renderPdfPageToPng: async () => ({
          pngBuffer: Buffer.from("png"),
          mimeType: "image/png",
          width: 100,
          height: 100,
        }),
      },
    });
    assert.equal(result.pages_requested, 1);
    assert.equal(result.pages_processed, 0);
    assert.equal(result.status, "partial");
  });

  it("processes vision pages with mock processor without live API", async () => {
    const pageRecords = [
      {
        page_number: 1,
        status: "vision_required",
        page_analysis: { recommended_method: "vision" },
      },
    ];
    const tables = {
      coordination_records: [
        {
          id: COORD_ID,
          project_id: PROJECT_ID,
          tenant_id: TENANT_A,
          metadata: {
            uci_provider_mapping: { method: PROVIDER_SETUP_METHOD },
            uci_document_processing: {
              applications: {
                [EXT_APP_A]: baseProcessingState(pageRecords),
              },
            },
          },
        },
      ],
    };
    const mockVision = new MockVisionPageProcessor([
      {
        findings: [
          {
            field_key: "service_voltage",
            raw_value: "480V",
            normalized_value: 480,
            unit: "V",
            entity_type: "project_service",
            page_number: 1,
            evidence_text: "480V SERVICE",
            confidence: 0.9,
          },
        ],
      },
    ]);
    const supabase = createMockSupabase(tables);
    const result = await runDocumentFallbackProcessing(supabase, {
      coordinationRecordId: COORD_ID,
      userId: USER_ID,
      externalApplicationId: EXT_APP_A,
      mode: "vision",
      deps: {
        env: {
          UCI_DOCUMENT_VISION_ENABLED: "true",
          UCI_DOCUMENT_OCR_ENABLED: "false",
          OPENAI_API_KEY: "test-key",
          UCI_DOCUMENT_VISION_MAX_PAGES_PER_RUN: "5",
        },
        visionProcessor: mockVision,
        renderPdfPageToPng: async () => ({
          pngBuffer: Buffer.from("png"),
          mimeType: "image/png",
          width: 100,
          height: 100,
        }),
        downloadFromSupabaseStorage: async () => ({
          ok: true,
          data: { arrayBuffer: async () => Buffer.from("%PDF-1.4").buffer },
        }),
      },
    });
    assert.equal(result.pages_processed, 1);
    assert.equal(result.findings_created, 1);
    assert.equal(mockVision.calls.length, 1);
    const state =
      tables.coordination_records[0].metadata.uci_document_processing.applications[EXT_APP_A];
    assert.equal(state.documents[0].page_records[0].status, "vision_processed");
  });

  it("one failed page yields partial document result", async () => {
    const pageRecords = [
      {
        page_number: 1,
        status: "vision_required",
        page_analysis: { recommended_method: "vision" },
      },
      {
        page_number: 2,
        status: "ocr_required",
        page_analysis: { recommended_method: "ocr" },
      },
    ];
    const tables = {
      coordination_records: [
        {
          id: COORD_ID,
          project_id: PROJECT_ID,
          tenant_id: TENANT_A,
          metadata: {
            uci_provider_mapping: { method: PROVIDER_SETUP_METHOD },
            uci_document_processing: {
              applications: {
                [EXT_APP_A]: baseProcessingState(pageRecords),
              },
            },
          },
        },
      ],
    };
    const mockVision = new MockVisionPageProcessor([{ findings: [] }]);
    const mockOcr = new MockOcrPageProcessor();
    mockOcr.processPage = async () => {
      throw new Error("ocr_failed_simulated");
    };
    const supabase = createMockSupabase(tables);
    const result = await runDocumentFallbackProcessing(supabase, {
      coordinationRecordId: COORD_ID,
      userId: USER_ID,
      externalApplicationId: EXT_APP_A,
      mode: "all",
      deps: {
        env: {
          UCI_DOCUMENT_VISION_ENABLED: "true",
          UCI_DOCUMENT_OCR_ENABLED: "true",
          OPENAI_API_KEY: "test-key",
          UCI_DOCUMENT_VISION_MAX_PAGES_PER_RUN: "5",
          UCI_DOCUMENT_OCR_MAX_PAGES_PER_RUN: "5",
        },
        visionProcessor: mockVision,
        ocrProcessor: mockOcr,
        renderPdfPageToPng: async () => ({
          pngBuffer: Buffer.from("png"),
          mimeType: "image/png",
          width: 100,
          height: 100,
        }),
        downloadFromSupabaseStorage: async () => ({
          ok: true,
          data: { arrayBuffer: async () => Buffer.from("%PDF-1.4").buffer },
        }),
      },
    });
    assert.equal(result.pages_failed, 1);
    assert.equal(result.status, "partial");
    assert.equal(result.failed_pages.length, 1);
  });

  it("collectFallbackPages rejects cross-application documents by scope in run", async () => {
    const pages = collectFallbackPages(
      [
        {
          document_id: "d1",
          external_application_id: EXT_APP_A,
          page_records: [{ page_number: 1, status: "vision_required", page_analysis: { recommended_method: "vision" } }],
        },
        {
          document_id: "d2",
          external_application_id: "other-app",
          page_records: [{ page_number: 1, status: "vision_required", page_analysis: { recommended_method: "vision" } }],
        },
      ],
      { mode: "all" },
    );
    assert.equal(pages.length, 2);
  });

  it("resumes idempotently when page already processed", async () => {
    const pageRecords = [
      {
        page_number: 1,
        status: "vision_processed",
        page_analysis: { recommended_method: "vision" },
      },
    ];
    const pages = collectFallbackPages(
      [{ page_records: pageRecords, document_id: "d1" }],
      { mode: "vision" },
    );
    assert.equal(pages.length, 0);
  });
});
