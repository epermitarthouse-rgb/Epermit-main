import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  DEFAULT_LOAD_REVIEW_TAB,
  LOAD_REVIEW_TAB_STORAGE_KEY,
  getPendingLoadCandidates,
  getLoadReviewTabCandidates,
  getLoadReviewTabCounts,
  getPendingReviewGroup,
  groupPendingReviewCandidates,
  groupCandidatesByEntity,
  formatCandidateFieldLabel,
  formatCandidateEntityLabel,
  deduplicateCandidatesForDisplay,
  isPendingLoadReviewCandidate,
  isRejectedLoadReviewCandidate,
  isStaleLoadReviewCandidate,
  isUnresolvedLoadCandidate,
  persistLoadReviewTab,
  readStoredLoadReviewTab,
  getVerifiedCalculatedValues,
  isConnectedLoadSatisfied,
  formatCandidateValue,
  isCandidateApprovalBlocked,
  parseLoadProfileSummary,
  type UciLoadCandidate,
  type UciLoadProfileSummary,
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

describe("uciLoadProfile Row 6 helpers", () => {
  it("filters pending candidates by external application", () => {
    const summary = parseLoadProfileSummary({
      ...baseSummary(),
      candidate_values: [
        candidate({ external_application_id: "app-a" }),
        candidate({ candidate_id: "c2", external_application_id: "app-b" }),
      ],
    });
    expect(getPendingLoadCandidates(summary, "app-a")).toHaveLength(1);
  });

  it("reads verified values instead of calculated_values", () => {
    const summary = parseLoadProfileSummary({
      ...baseSummary(),
      verified_values: {
        connected_load_kw: {
          field_key: "connected_load_kw",
          value: 200,
          unit: "kW",
          method: "source_extracted_and_human_verified",
          approved_by: "u1",
          approved_at: "2026-07-15T12:00:00.000Z",
          source_document_name: "panel.pdf",
          source_document_id: null,
          source_storage_path: "p",
          page_number: 1,
          evidence_text: "ev",
          extraction_method: "pdf_text",
          edited: false,
          review_note: null,
          original_candidate_id: "c1",
          source_content_hash: "h",
        },
      },
    });
    expect(getVerifiedCalculatedValues(summary)).toEqual([{ key: "connected_load_kw", value: 200 }]);
    expect(isConnectedLoadSatisfied(summary)).toBe(true);
  });

  it("does not treat candidates as verified", () => {
    const summary = parseLoadProfileSummary({
      ...baseSummary(),
      candidate_values: [candidate()],
    });
    expect(isConnectedLoadSatisfied(summary)).toBe(false);
    expect(getVerifiedCalculatedValues(summary)).toEqual([]);
  });
});

describe("formatLoadCandidateExtractionError", () => {
  it("includes stage and document name for structured extraction errors", async () => {
    const { formatLoadCandidateExtractionError } = await import("@/lib/uciApi");
    const err = Object.assign(new Error("corrupt pdf"), {
      stage: "pdf_parse",
      document_name: "panel.pdf",
    });
    expect(formatLoadCandidateExtractionError(err, "fallback")).toContain("pdf_parse");
    expect(formatLoadCandidateExtractionError(err, "fallback")).toContain("panel.pdf");
  });
});

describe("candidate display helpers", () => {
  it("never renders nested objects as [object Object]", () => {
    const candidate = {
      ...candidateFixture(),
      raw_value: "centralAC: 2",
      normalized_value: { centralAC: 2 },
    };
    expect(formatCandidateValue(candidate)).toBe("centralAC: 2");
  });

  it("blocks approval for panel-only and stale candidates", () => {
    const panel = {
      ...candidateFixture(),
      field_key: "panel_demand_load_kva",
      entity_type: "electrical_panel",
      entity_name: "MDP-1",
      is_project_total: false,
      can_satisfy_package: false,
      approval_blocked_reason: "Panel-level totals cannot satisfy package connected load requirement",
    };
    expect(isCandidateApprovalBlocked(panel)).toBe(true);
    const stale = { ...candidateFixture(), status: "stale" as const };
    expect(isCandidateApprovalBlocked(stale)).toBe(true);
  });
});

function candidateFixture() {
  return {
    candidate_id: "c1",
    field_key: "demand_load_kva",
    raw_value: "250",
    normalized_value: 250,
    unit: "kVA",
    status: "candidate" as const,
    source_type: "pepco_portal_document" as const,
    source_document_name: "schedule.pdf",
    source_document_id: null,
    source_storage_path: "p",
    source_content_hash: "h",
    page_number: 1,
    evidence_text: "TOTAL DEMAND LOAD 250 kVA",
    extraction_method: "pdf_text" as const,
    confidence: 0.8,
    conflict_group: null,
    requires_human_review: true,
  };
}

describe("Connected load review tabs", () => {
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

  it("defaults to Pending review tab", () => {
    expect(DEFAULT_LOAD_REVIEW_TAB).toBe("pending");
    expect(readStoredLoadReviewTab()).toBe("pending");
  });

  it("persists active tab across refresh", () => {
    persistLoadReviewTab("unresolved");
    expect(storage.get(LOAD_REVIEW_TAB_STORAGE_KEY)).toBe("unresolved");
    expect(readStoredLoadReviewTab()).toBe("unresolved");
  });

  it("computes correct counts per tab", () => {
    const summary = parseLoadProfileSummary({
      ...baseSummary(),
      candidate_values: [
        candidate({ candidate_id: "pending-1", field_key: "service_amperage", unit: "A" }),
        candidate({
          candidate_id: "unresolved-1",
          conflict_group: "conflict:demand_load_kva:abc",
        }),
        candidate({ candidate_id: "stale-1", status: "stale" }),
        candidate({ candidate_id: "rejected-1", status: "rejected" }),
        candidate({ candidate_id: "other-app", external_application_id: "app-b" }),
      ],
      verified_values: {
        demand_load_kva: {
          field_key: "demand_load_kva",
          value: 250,
          unit: "kVA",
          method: "source_extracted_and_human_verified",
          approved_by: "u1",
          approved_at: "2026-07-15T12:00:00.000Z",
          source_document_name: "schedule.pdf",
          source_document_id: null,
          source_storage_path: "p",
          page_number: 1,
          evidence_text: "ev",
          extraction_method: "pdf_text",
          edited: false,
          review_note: null,
          original_candidate_id: "approved-1",
          source_content_hash: "h",
        },
      },
    });

    const counts = getLoadReviewTabCounts(summary, "app-a");
    expect(counts.pending).toBe(1);
    expect(counts.approved).toBe(1);
    expect(counts.unresolved).toBe(1);
    expect(counts.stale).toBe(1);
    expect(counts.rejected).toBe(1);
  });

  it("excludes stale candidates from Pending", () => {
    const stale = candidate({ status: "stale" });
    expect(isPendingLoadReviewCandidate(stale)).toBe(false);
    expect(isStaleLoadReviewCandidate(stale)).toBe(true);
    const summary = parseLoadProfileSummary({
      ...baseSummary(),
      candidate_values: [candidate(), stale],
    });
    expect(getLoadReviewTabCandidates(summary, "pending", "app-a")).toHaveLength(1);
    expect(getLoadReviewTabCandidates(summary, "stale", "app-a")).toHaveLength(1);
  });

  it("shows approved values only in Approved tab source", () => {
    const summary = parseLoadProfileSummary({
      ...baseSummary(),
      candidate_values: [
        candidate({ status: "approved", candidate_id: "approved-candidate" }),
      ],
      verified_values: {
        connected_load_kw: {
          field_key: "connected_load_kw",
          value: 200,
          unit: "kW",
          method: "source_extracted_and_human_verified",
          approved_by: "u1",
          approved_at: "2026-07-15T12:00:00.000Z",
          source_document_name: "panel.pdf",
          source_document_id: null,
          source_storage_path: "p",
          page_number: 1,
          evidence_text: "ev",
          extraction_method: "pdf_text",
          edited: false,
          review_note: null,
          original_candidate_id: "c1",
          source_content_hash: "h",
        },
      },
    });
    expect(getLoadReviewTabCandidates(summary, "approved", "app-a")).toHaveLength(0);
    expect(getLoadReviewTabCounts(summary, "app-a").approved).toBe(1);
  });

  it("routes conflicts to Unresolved tab", () => {
    const conflict = candidate({ conflict_group: "conflict:demand_load_kva:xyz" });
    expect(isUnresolvedLoadCandidate(conflict)).toBe(true);
    expect(isPendingLoadReviewCandidate(conflict)).toBe(false);
    const summary = parseLoadProfileSummary({
      ...baseSummary(),
      candidate_values: [conflict],
    });
    expect(getLoadReviewTabCandidates(summary, "unresolved", "app-a")).toHaveLength(1);
    expect(getLoadReviewTabCandidates(summary, "pending", "app-a")).toHaveLength(0);
  });

  it("routes rejected candidates to Rejected tab", () => {
    const rejected = candidate({ status: "rejected", resolved_at: "2026-07-15T13:00:00.000Z" });
    expect(isRejectedLoadReviewCandidate(rejected)).toBe(true);
    const summary = parseLoadProfileSummary({
      ...baseSummary(),
      candidate_values: [rejected],
    });
    expect(getLoadReviewTabCandidates(summary, "rejected", "app-a")).toHaveLength(1);
    expect(getLoadReviewTabCandidates(summary, "pending", "app-a")).toHaveLength(0);
  });

  it("moves candidates between tabs after simulated actions", () => {
    const pending = candidate({ candidate_id: "to-approve" });
    const toReject = candidate({ candidate_id: "to-reject" });
    let summary = parseLoadProfileSummary({
      ...baseSummary(),
      candidate_values: [pending, toReject],
    });

    expect(getLoadReviewTabCounts(summary, "app-a").pending).toBe(2);

    summary = parseLoadProfileSummary({
      ...summary!,
      candidate_values: [
        { ...pending, status: "approved" },
        { ...toReject, status: "rejected", resolved_at: "2026-07-15T13:00:00.000Z" },
      ],
      verified_values: {
        demand_load_kva: {
          field_key: "demand_load_kva",
          value: 250,
          unit: "kVA",
          method: "source_extracted_and_human_verified",
          approved_by: "u1",
          approved_at: "2026-07-15T13:00:00.000Z",
          source_document_name: "schedule.pdf",
          source_document_id: null,
          source_storage_path: "p",
          page_number: 1,
          evidence_text: "ev",
          extraction_method: "pdf_text",
          edited: false,
          review_note: null,
          original_candidate_id: "to-approve",
          source_content_hash: "h",
        },
      },
    });

    const counts = getLoadReviewTabCounts(summary, "app-a");
    expect(counts.pending).toBe(0);
    expect(counts.approved).toBe(1);
    expect(counts.rejected).toBe(1);
  });

  it("keeps package-eligible grouping separate from panel values", () => {
    const project = candidate({
      candidate_id: "project",
      field_key: "demand_load_kva",
      entity_type: "project_service",
      can_satisfy_package: true,
    });
    const panel = candidate({
      candidate_id: "panel",
      field_key: "panel_demand_load_kva",
      entity_type: "electrical_panel",
      entity_name: "MDP-1",
      can_satisfy_package: false,
    });
    const groups = groupPendingReviewCandidates([project, panel]);
    expect(getPendingReviewGroup(project)).toBe("package_eligible");
    expect(getPendingReviewGroup(panel)).toBe("panels");
    expect(groups.package_eligible).toHaveLength(1);
    expect(groups.panels).toHaveLength(1);
    expect(groups.equipment).toHaveLength(0);
  });

  it("uses entity-first grouping and human-readable field labels", () => {
    const panelA = candidate({
      candidate_id: "panel-a",
      field_key: "panel_demand_load_kva",
      entity_type: "electrical_panel",
      entity_name: "MDP",
      normalized_value: 51.33,
      unit: "kVA",
    });
    const panelB = candidate({
      candidate_id: "panel-b",
      field_key: "panel_demand_load_kva",
      entity_type: "electrical_panel",
      entity_name: "MDP Surface",
      normalized_value: 100.27,
      unit: "kVA",
    });
    const groups = groupCandidatesByEntity([panelA, panelB]);
    expect(groups).toHaveLength(2);
    expect(formatCandidateFieldLabel("panel_demand_load_kva")).toBe("Demand load");
    expect(formatCandidateFieldLabel("demand_load_kva")).toBe("Demand load");
    expect(formatCandidateFieldLabel("demand_load_kva")).not.toBe("demand_load_kva");
    expect(groups[0].entityLabel).toContain("Panel");
  });

  it("renders unidentified panel label correctly", () => {
    const unidentified = candidate({
      field_key: "panel_demand_load_kva",
      entity_type: "electrical_panel",
      panel_identifier_missing: true,
      entity_name: null,
    });
    expect(formatCandidateEntityLabel(unidentified)).toBe("Unidentified panel");
    expect(isUnresolvedLoadCandidate(unidentified)).toBe(true);
    expect(isPendingLoadReviewCandidate(unidentified)).toBe(false);
  });

  it("deduplicates duplicate candidates for display", () => {
    const a = candidate({ candidate_id: "dup-1" });
    const b = candidate({ candidate_id: "dup-2" });
    expect(deduplicateCandidatesForDisplay([a, b])).toHaveLength(1);
  });

  it("returns empty tab lists for empty states", () => {
    const summary = parseLoadProfileSummary(baseSummary());
    expect(getLoadReviewTabCandidates(summary, "pending", "app-a")).toEqual([]);
    expect(getLoadReviewTabCandidates(summary, "unresolved", "app-a")).toEqual([]);
    expect(getLoadReviewTabCandidates(summary, "stale", "app-a")).toEqual([]);
    expect(getLoadReviewTabCandidates(summary, "rejected", "app-a")).toEqual([]);
    expect(getLoadReviewTabCounts(summary, "app-a").approved).toBe(0);
  });
});
