import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  buildLoadScheduleRows,
  buildPackageReadinessChecklist,
  buildSourceDocumentRows,
  buildVerifiedInputRows,
  getDefaultReviewQueueTab,
  getLoadProfileOverview,
  getLoadScheduleTotals,
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
  deduplicateCandidatesForDisplay,
  formatCandidateFieldLabel,
  getLoadReviewTabCandidates,
  parseLoadProfileSummary,
  type UciLoadCandidate,
  type UciLoadProfileSummary,
  type UciVerifiedLoadValue,
} from "@/lib/uciLoadProfile";

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

    it("requires reviewer note", () => {
      const err = validateManualVerifiedInput({
        field_key: "service_voltage",
        value: "480",
        unit: "V",
        review_note: "",
      });
      expect(err).toContain("note");
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
