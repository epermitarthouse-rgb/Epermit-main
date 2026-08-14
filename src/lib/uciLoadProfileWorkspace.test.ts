import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  buildLoadScheduleRows,
  buildPackageReadinessChecklist,
  buildServiceSizingFields,
  buildSourceDocumentRows,
  buildVerifiedInputRows,
  deriveSourceDocumentStatus,
  getDefaultReviewQueueTab,
  getLoadProfileOverview,
  getLoadScheduleTotals,
  getServiceSizingRecommendation,
  groupSourceDocumentsByCategory,
  inferDocumentCategory,
  persistWorkspaceSection,
  readStoredWorkspaceSection,
  validateManualVerifiedInput,
  WORKSPACE_SECTION_STORAGE_KEY,
  type WorkspaceSection,
} from "@/lib/uciLoadProfileWorkspace";
import {
  candidateDisplayFingerprint,
  consolidateCandidatesForReview,
  deduplicateCandidatesForDisplay,
  formatCandidateFieldLabel,
  getLoadReviewTabCandidates,
  parseLoadProfileSummary,
  type UciLoadCandidate,
  type UciLoadProfileSummary,
  type UciVerifiedLoadValue,
} from "@/lib/uciLoadProfile";
import type { UciDocumentManifestEntry } from "@/lib/uciDocumentProcessing";

const baseSummary = (): UciLoadProfileSummary => ({
  version: "d2.1-v1",
  utility_type: "electric",
  analysis_status: "preliminary",
  inputs_used: [],
  missing_inputs: [],
  needs_verification: [],
  assumptions: { template_id: null, template_version: null, notes: [] },
  calculated_values: {},
  candidate_values: [],
  verified_values: {},
  source_documents: [],
  generated_at: "2026-07-15T12:00:00.000Z",
  generated_by: "agent_2_load_profile",
  requires_human_review: true,
});

const candidate = (overrides: Partial<UciLoadCandidate> = {}): UciLoadCandidate => ({
  candidate_id: "load_candidate:test",
  field_key: "connected_load_kw",
  raw_value: "200",
  normalized_value: 200,
  unit: "kW",
  status: "candidate",
  source_type: "pepco_portal_document",
  source_document_name: "panel.pdf",
  source_document_id: null,
  source_storage_path: "path",
  source_content_hash: "hash",
  page_number: 1,
  evidence_text: "connected load 200 KW",
  extraction_method: "pdf_text",
  confidence: 0.7,
  conflict_group: null,
  requires_human_review: true,
  external_application_id: "app-a",
  ...overrides,
});

const verified = (
  key: string,
  entry: Partial<UciVerifiedLoadValue> & { value: unknown },
): Record<string, UciVerifiedLoadValue> => ({
  [key]: {
    field_key: key,
    unit: entry.unit ?? "kW",
    method: entry.method ?? "source_extracted_and_human_verified",
    approved_by: "user-1",
    approved_at: "2026-07-15T12:00:00.000Z",
    source_document_name: "calc.pdf",
    source_document_id: null,
    source_storage_path: "p",
    page_number: 1,
    evidence_text: "evidence",
    extraction_method: "pdf_text",
    edited: false,
    review_note: null,
    original_candidate_id: "c1",
    source_content_hash: "h",
    ...entry,
  },
});

const manifestDocument = (
  overrides: Partial<UciDocumentManifestEntry> = {},
): UciDocumentManifestEntry => ({
  document_id: "uci_doc:test",
  source_type: "pepco_portal_document",
  provider_slug: "pepco",
  external_application_id: "app-a",
  original_filename: "test.pdf",
  portal_document_name: null,
  portal_document_type: null,
  portal_document_status: null,
  content_hash: "hash",
  mime_type: "application/pdf",
  file_size: 100,
  page_count: 1,
  document_roles: ["supporting_document"],
  role_confidence: ["low"],
  uci_stages: ["agent_2_load_profile"],
  processing_status: "complete",
  pages_processed: 1,
  extraction_methods_used: ["native_text"],
  findings_count: 0,
  failed_pages: [],
  failure_reason: null,
  duplicate_of: null,
  schema_version: "row-doc-v2",
  processed_at: "2026-08-14T12:58:07.472Z",
  page_coverage: {
    total_pages: 1,
    pages_discovered: 1,
    pages_processed: 1,
    pages_with_text: 1,
    pages_with_tables: 0,
    pages_sent_to_vision: 0,
    pages_sent_to_ocr: 0,
    blank_pages: 0,
    failed_pages: 0,
    fallback_pending: 0,
    skipped_duplicate_pages: 0,
  },
  findings_extraction_status: "no_supported_findings",
  ...overrides,
});

describe("uciLoadProfileWorkspace", () => {
  describe("overview status logic", () => {
    it("returns not_analyzed when summary is null", () => {
      const overview = getLoadProfileOverview(null);
      expect(overview.workspaceState).toBe("not_analyzed");
      expect(overview.completionPercent).toBe(0);
    });

    it("flags panel-only evidence as blocking connected load", () => {
      const summary = parseLoadProfileSummary({
        ...baseSummary(),
        candidate_values: [
          candidate({
            field_key: "panel_demand_load_kva",
            entity_type: "electrical_panel",
            entity_name: "MDP",
            unit: "kVA",
            normalized_value: 100,
          }),
        ],
      });
      const overview = getLoadProfileOverview(summary, { externalApplicationId: "app-a" });
      expect(overview.hasOnlyPanelEvidence).toBe(true);
      expect(overview.connectedLoadSatisfied).toBe(false);
      expect(overview.blockingIssues.some((b) => b.includes("Panel-level"))).toBe(true);
    });

    it("does not mark complete when only panel verified values exist", () => {
      const summary = parseLoadProfileSummary({
        ...baseSummary(),
        verified_values: verified("panel_demand_load_kva", {
          value: 100,
          unit: "kVA",
        }),
      });
      const overview = getLoadProfileOverview(summary);
      expect(overview.connectedLoadSatisfied).toBe(false);
      expect(overview.workspaceState).not.toBe("ready_for_application_package");
    });

    it("recomputes stale missing-input status from verified Stage 2 values", () => {
      const summary = parseLoadProfileSummary({
        ...baseSummary(),
        analysis_status: "missing_inputs",
        missing_inputs: [],
        verified_values: {
          ...verified("connected_load_kva", { value: 410, unit: "kVA" }),
          ...verified("demand_load_kva", { value: 315, unit: "kVA" }),
          ...verified("requested_voltage", { value: "120/208", unit: "V" }),
          ...verified("phase", { value: "3", unit: "phase" }),
          ...verified("wire_configuration", { value: "4", unit: "wire" }),
        },
      });
      expect(summary?.analysis_status).toBe("preliminary");
      expect(summary?.missing_inputs).toEqual([]);
    });

    it("does not let optional pending evidence block Stage 2 readiness", () => {
      const summary = parseLoadProfileSummary({
        ...baseSummary(),
        candidate_values: [
          candidate({
            field_key: "panel_rating",
            entity_type: "electrical_panel",
            is_project_total: false,
            unit: "A",
          }),
        ],
        verified_values: {
          ...verified("connected_load_kva", { value: 410, unit: "kVA" }),
          ...verified("demand_load_kva", { value: 315, unit: "kVA" }),
          ...verified("requested_voltage", { value: "120/208", unit: "V" }),
          ...verified("phase", { value: "3", unit: "phase" }),
          ...verified("wire_configuration", { value: "4", unit: "wire" }),
        },
      });
      expect(getLoadProfileOverview(summary).workspaceState).toBe("ready_for_service_sizing");
    });
  });

  describe("source document grouping", () => {
    it("infers panel schedule category from filename patterns", () => {
      expect(inferDocumentCategory("E602 - ELECTRICAL PANEL SCHEDULES.pdf")).toBe(
        "panel_schedules",
      );
      expect(inferDocumentCategory("E601 - ONE LINE DIAGRAM.pdf")).toBe("one_line_diagram");
    });

    it("groups source documents by category", () => {
      const summary = parseLoadProfileSummary({
        ...baseSummary(),
        load_extraction: {
          source_document_ranking: [
            { file_name: "panel schedule.pdf", score: 10, reasons: ["panel schedule"] },
            { file_name: "one-line.pdf", score: 5, reasons: ["one line"] },
          ],
        },
      });
      const rows = buildSourceDocumentRows(summary);
      const groups = groupSourceDocumentsByCategory(rows);
      expect(groups.panel_schedules.length + groups.one_line_diagram.length).toBeGreaterThan(0);
    });

    it("merges ranked documents with active candidates and excludes stale counts", () => {
      const summary = parseLoadProfileSummary({
        ...baseSummary(),
        load_extraction: {
          source_document_ranking: [
            {
              file_name: "E601 - ONE LINE DIAGRAM.pdf",
              source_type: "pepco_portal_document",
              score: 90,
              reasons: ["one line"],
            },
          ],
        },
        candidate_values: [
          candidate({
            source_type: "uci_document_finding",
            source_document_name: "E601 - ONE LINE DIAGRAM.pdf",
          }),
          candidate({
            candidate_id: "stale-e601",
            status: "stale",
            source_type: "uci_document_finding",
            source_document_name: "E601 - ONE LINE DIAGRAM.pdf",
          }),
        ],
      });

      const rows = buildSourceDocumentRows(summary);
      expect(rows).toHaveLength(1);
      expect(rows[0].candidateCount).toBe(1);
      expect(rows[0].processingStatus).toBe("processed");
    });

    it("uses authoritative manifest metadata for zero-findings and fallback states", () => {
      const summary = parseLoadProfileSummary({
        ...baseSummary(),
        load_extraction: {
          source_document_ranking: [
            { file_name: "parsed-empty.pdf", score: 10, reasons: [] },
            { file_name: "needs-vision.pdf", score: 5, reasons: [] },
          ],
        },
      });
      const rows = buildSourceDocumentRows(summary, "app-a", [
        manifestDocument({ document_id: "parsed", original_filename: "parsed-empty.pdf" }),
        manifestDocument({
          document_id: "fallback",
          original_filename: "needs-vision.pdf",
          processing_status: "partial",
          pages_processed: 0,
          failure_reason: "One or more pages require Vision or OCR fallback processing",
          page_coverage: {
            ...manifestDocument().page_coverage!,
            pages_processed: 0,
            pages_with_text: 0,
            pages_sent_to_vision: 1,
            fallback_pending: 1,
          },
          page_records: [{ page_number: 1, status: "vision_required" }],
        }),
      ]);

      expect(rows.find((row) => row.documentName === "parsed-empty.pdf")?.status).toBe(
        "parsed_no_candidates",
      );
      expect(rows.find((row) => row.documentName === "needs-vision.pdf")?.status).toBe(
        "needs_fallback",
      );
    });

    it("distinguishes all five source document status semantics", () => {
      expect(
        deriveSourceDocumentStatus(manifestDocument({ findings_count: 2 })).status,
      ).toBe("parsed_candidates");
      expect(deriveSourceDocumentStatus(manifestDocument()).status).toBe(
        "parsed_no_candidates",
      );
      expect(
        deriveSourceDocumentStatus(
          manifestDocument({ processing_status: "pending", processed_at: null }),
        ).status,
      ).toBe("pending");
      expect(
        deriveSourceDocumentStatus(
          manifestDocument({
            processing_status: "failed",
            failure_reason: "Parser failure",
          }),
        ).status,
      ).toBe("failed");
      expect(
        deriveSourceDocumentStatus(
          manifestDocument({
            processing_status: "partial",
            page_records: [{ page_number: 1, status: "ocr_required" }],
          }),
        ).status,
      ).toBe("needs_fallback");
      expect(
        deriveSourceDocumentStatus(
          manifestDocument({
            processing_status: "partial",
            findings_count: 2,
            fallback_status: "attempted_failed",
            failure_reason: "Parsed with fallback warning: one fallback page failed",
          }),
        ),
      ).toMatchObject({
        status: "parsed_candidates",
        statusLabel: "Parsed with fallback warning",
      });
    });
  });

  describe("verified input grouping", () => {
    it("groups project service and panel verified values separately", () => {
      const summary = parseLoadProfileSummary({
        ...baseSummary(),
        verified_values: {
          ...verified("service_voltage", { value: 480, unit: "V" }),
          ...verified("panel_demand_load_kva", { value: 51, unit: "kVA" }),
        },
      });
      const groups = buildVerifiedInputRows(summary);
      expect(groups.project_service.some((r) => r.label === "Service voltage")).toBe(true);
      expect(groups.panels).toHaveLength(1);
      expect(groups.panels[0].satisfiesPackage).toBe(false);
    });
  });

  describe("load schedule totals", () => {
    it("uses verified project values only in schedule rows", () => {
      const summary = parseLoadProfileSummary({
        ...baseSummary(),
        verified_values: {
          ...verified("connected_load_kw", { value: 200, unit: "kW" }),
          ...verified("panel_demand_load_kva", { value: 100, unit: "kVA" }),
        },
      });
      const rows = buildLoadScheduleRows(summary);
      expect(rows).toHaveLength(1);
      expect(rows[0].unit).toBe("kW");
    });

    it("excludes panel totals from schedule totals", () => {
      const summary = parseLoadProfileSummary({
        ...baseSummary(),
        verified_values: {
          ...verified("connected_load_kw", { value: 200, unit: "kW" }),
          ...verified("panel_demand_load_kva", { value: 100, unit: "kVA" }),
        },
      });
      const totals = getLoadScheduleTotals(summary);
      expect(totals.connectedKw).toBe(200);
      expect(totals.connectedKva).toBeNull();
    });

    it("keeps kW and kVA separate without conversion", () => {
      const summary = parseLoadProfileSummary({
        ...baseSummary(),
        verified_values: {
          ...verified("connected_load_kw", { value: 100, unit: "kW" }),
          ...verified("connected_load_kva", { value: 150, unit: "kVA" }),
        },
      });
      const totals = getLoadScheduleTotals(summary);
      expect(totals.connectedKw).toBe(100);
      expect(totals.connectedKva).toBe(150);
      expect(totals.canFinalize).toBe(false);
      expect(totals.finalizeMessage).toContain(
        "approved engineering factors or template inputs",
      );
    });

    it("does not require a factor when verified project demand is provided", () => {
      const summary = parseLoadProfileSummary({
        ...baseSummary(),
        verified_values: {
          ...verified("connected_load_kva", { value: 410, unit: "kVA" }),
          ...verified("demand_load_kva", { value: 315, unit: "kVA" }),
        },
      });

      const rows = buildLoadScheduleRows(summary);
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.demandFactorDisplay === "N/A — verified demand provided"))
        .toBe(true);

      const totals = getLoadScheduleTotals(summary);
      expect(totals.connectedKva).toBe(410);
      expect(totals.demandKva).toBe(315);
      expect(totals.canFinalize).toBe(true);
      expect(totals.finalizeMessage).toContain("no demand factor or template is required");
    });

    it("keeps the factor unresolved when project demand must be derived", () => {
      const summary = parseLoadProfileSummary({
        ...baseSummary(),
        verified_values: verified("connected_load_kva", { value: 410, unit: "kVA" }),
      });

      const rows = buildLoadScheduleRows(summary);
      expect(rows[0].demandFactorDisplay).toBe("Unresolved");
      expect(getLoadScheduleTotals(summary).canFinalize).toBe(false);
    });

    it("excludes unapproved candidates from schedule", () => {
      const summary = parseLoadProfileSummary({
        ...baseSummary(),
        candidate_values: [candidate({ normalized_value: 500, unit: "kW" })],
        verified_values: {},
      });
      expect(buildLoadScheduleRows(summary)).toHaveLength(0);
      expect(getLoadScheduleTotals(summary).connectedKw).toBeNull();
    });
  });

  describe("manual verified input validation", () => {
    it("requires unit for numeric engineering fields", () => {
      const err = validateManualVerifiedInput({
        field_key: "connected_load_kw",
        value: "200",
        unit: "",
        review_note: "Engineer confirmed overall load",
        source_reference: "calc sheet",
      });
      expect(err).toContain("Unit");
    });

    it("rejects mismatched field and unit", () => {
      const err = validateManualVerifiedInput({
        field_key: "connected_load_kva",
        value: "200",
        unit: "kW",
        review_note: "note",
        source_reference: "ref",
      });
      expect(err).toContain("kVA");
    });

    it("allows optional note after explicit UI confirmation", () => {
      const err = validateManualVerifiedInput({
        field_key: "service_voltage",
        value: "480",
        unit: "V",
        review_note: "",
      });
      expect(err).toBeNull();
    });
  });

  describe("package readiness checklist", () => {
    it("explains connected_load_data when only panel evidence exists", () => {
      const summary = parseLoadProfileSummary({
        ...baseSummary(),
        candidate_values: [
          candidate({
            field_key: "panel_demand_load_kva",
            entity_type: "electrical_panel",
            entity_name: "MDP",
            unit: "kVA",
          }),
        ],
      });
      const items = buildPackageReadinessChecklist(summary, { hasProjectAddress: true });
      const connected = items.find((i) => i.key === "connected_load_data");
      expect(connected?.status).toBe("needs_review");
      expect(connected?.detail).toContain("Panel totals");
    });

    it("marks connected_load_data complete when project load verified", () => {
      const summary = parseLoadProfileSummary({
        ...baseSummary(),
        verified_values: verified("connected_load_kw", { value: 200, unit: "kW" }),
      });
      const items = buildPackageReadinessChecklist(summary);
      const connected = items.find((i) => i.key === "connected_load_data");
      expect(connected?.status).toBe("complete");
    });

    it("treats verified project demand as sufficient without template approval", () => {
      const summary = parseLoadProfileSummary({
        ...baseSummary(),
        verified_values: {
          ...verified("connected_load_kva", { value: 410, unit: "kVA" }),
          ...verified("demand_load_kva", { value: 315, unit: "kVA" }),
        },
      });

      const overview = getLoadProfileOverview(summary);
      expect(overview.verifiedProjectDemandSatisfied).toBe(true);

      const sizing = buildServiceSizingFields(summary);
      expect(sizing).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ key: "demand_load_kva", value: "315", approved: true }),
        ]),
      );

      const items = buildPackageReadinessChecklist(summary);
      const schedule = items.find((item) => item.key === "approved_load_schedule");
      expect(schedule?.status).toBe("complete");
      expect(schedule?.detail).toContain("no demand factor or template is required");
    });

    it("requires human service-size input when no approved rule or recommendation exists", () => {
      const summary = parseLoadProfileSummary({
        ...baseSummary(),
        verified_values: {
          ...verified("connected_load_kva", { value: 410, unit: "kVA" }),
          ...verified("demand_load_kva", { value: 315, unit: "kVA" }),
          ...verified("requested_voltage", { value: "120/208", unit: "V" }),
          ...verified("phase", { value: "3", unit: "phase" }),
          ...verified("requested_service_amperage", { value: 1000, unit: "A" }),
        },
      });

      expect(getServiceSizingRecommendation(summary)).toMatchObject({
        status: "requires_human_input",
        missingInputs: [],
      });
      const items = buildPackageReadinessChecklist(summary, {
        hasProjectAddress: false,
        packageDocumentsComplete: false,
      });
      expect(items.some((item) => item.key === "required_documents")).toBe(false);
      expect(items.find((item) => item.key === "service_size_recommendation")).toMatchObject({
        status: "needs_review",
      });
    });

    it("marks voltage and phase as needs verification when candidates exist", () => {
      const summary = parseLoadProfileSummary({
        ...baseSummary(),
        candidate_values: [
          candidate({
            candidate_id: "voltage",
            field_key: "requested_voltage",
            normalized_value: 480,
            unit: "V",
          }),
          candidate({
            candidate_id: "phase",
            field_key: "phase",
            normalized_value: "three_phase",
            unit: "phase",
          }),
        ],
      });
      const items = buildPackageReadinessChecklist(summary);
      expect(items.find((item) => item.key === "voltage")?.status).toBe("needs_review");
      expect(items.find((item) => item.key === "phase")?.status).toBe("needs_review");
    });
  });

  describe("review queue default tab", () => {
    it("defaults to pending when actionable candidates exist", () => {
      const summary = parseLoadProfileSummary({
        ...baseSummary(),
        candidate_values: [candidate({ status: "candidate" })],
      });
      expect(getDefaultReviewQueueTab(summary, "app-a")).toBe("pending");
    });

    it("falls back to unresolved when no pending candidates", () => {
      const summary = parseLoadProfileSummary({
        ...baseSummary(),
        candidate_values: [
          candidate({
            status: "candidate",
            unit: null,
            field_key: "connected_load_kw",
            normalized_value: null,
            ambiguous: true,
          }),
        ],
      });
      expect(getDefaultReviewQueueTab(summary, "app-a")).toBe("unresolved");
    });
  });

  describe("stale and duplicate candidate display", () => {
    it("hides stale candidates from pending tab", () => {
      const summary = parseLoadProfileSummary({
        ...baseSummary(),
        candidate_values: [candidate({ status: "stale" })],
      });
      expect(getLoadReviewTabCandidates(summary, "pending", "app-a")).toHaveLength(0);
      expect(getLoadReviewTabCandidates(summary, "stale", "app-a")).toHaveLength(1);
    });

    it("deduplicates duplicate candidates for display", () => {
      const a = candidate({ candidate_id: "a" });
      const b = candidate({ candidate_id: "b" });
      expect(deduplicateCandidatesForDisplay([a, b])).toHaveLength(1);
      expect(candidateDisplayFingerprint(a)).toBe(candidateDisplayFingerprint(b));
    });

    it("consolidates agreeing facts while preserving conflicting values", () => {
      const application = candidate({
        candidate_id: "application",
        field_key: "phase",
        normalized_value: "three_phase",
        unit: "phase",
        source_document_name: "Application.pdf",
      });
      const e601 = candidate({
        candidate_id: "e601",
        field_key: "phase",
        normalized_value: "three_phase",
        unit: "phase",
        source_document_name: "E601.pdf",
        source_content_hash: "e601",
      });
      const conflict = candidate({
        candidate_id: "conflict",
        field_key: "phase",
        normalized_value: "single_phase",
        unit: "phase",
        source_document_name: "E602.pdf",
        source_content_hash: "e602",
      });
      const groups = consolidateCandidatesForReview([application, e601, conflict]);
      expect(groups).toHaveLength(2);
      expect(groups.find((group) => group.primary.normalized_value === "three_phase")?.candidates)
        .toHaveLength(2);
    });
  });

  describe("human-readable labels", () => {
    it("maps field keys to readable labels", () => {
      expect(formatCandidateFieldLabel("service_voltage")).toBe("Service voltage");
      expect(formatCandidateFieldLabel("panel_demand_load_kva")).toBe("Demand load");
    });
  });

  describe("workspace section persistence", () => {
    const storage = new Map<string, string>();

    beforeEach(() => {
      storage.clear();
      vi.stubGlobal("sessionStorage", {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
        removeItem: (key: string) => {
          storage.delete(key);
        },
        clear: () => storage.clear(),
        key: () => null,
        length: storage.size,
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("persists and reads active workspace section", () => {
      const section: WorkspaceSection = "load_schedule";
      persistWorkspaceSection(section);
      expect(storage.get(WORKSPACE_SECTION_STORAGE_KEY)).toBe(section);
      expect(readStoredWorkspaceSection()).toBe(section);
    });
  });
});
