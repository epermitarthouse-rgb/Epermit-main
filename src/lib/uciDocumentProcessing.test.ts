import { describe, expect, it } from "vitest";
import {
  formatDocumentRole,
  formatPageCoverage,
  formatProcessingStatus,
  formatUciStage,
  groupFindingsByStage,
  hasSensitiveStorageFields,
  processingStatusTone,
  runStatusTone,
  type UciDocumentCoverageSummary,
  type UciDocumentFinding,
  type UciDocumentManifestEntry,
} from "@/lib/uciDocumentProcessing";

const sampleDoc = (): UciDocumentManifestEntry => ({
  document_id: "uci_doc:abc",
  source_type: "pepco_portal_document",
  provider_slug: "pepco",
  external_application_id: "app-a",
  original_filename: "E602 - PANEL SCHEDULES.pdf",
  portal_document_name: "E602 - PANEL SCHEDULES.pdf",
  portal_document_type: "Panel Schedule",
  portal_document_status: null,
  content_hash: "hash-1",
  mime_type: "application/pdf",
  file_size: 1024,
  page_count: 4,
  document_roles: ["panel_schedule"],
  role_confidence: ["high"],
  uci_stages: ["agent_2_load_profile"],
  processing_status: "complete",
  pages_processed: 4,
  extraction_methods_used: ["pdf_text"],
  findings_count: 12,
  failed_pages: [],
  failure_reason: null,
  duplicate_of: null,
  schema_version: "row-doc-v1",
  processed_at: "2026-07-15T12:00:00.000Z",
  page_coverage: {
    total_pages: 4,
    pages_discovered: 4,
    pages_processed: 4,
    pages_with_text: 3,
    pages_with_tables: 1,
    pages_sent_to_vision: 0,
    pages_sent_to_ocr: 0,
    blank_pages: 1,
    failed_pages: 0,
    skipped_duplicate_pages: 0,
  },
});

describe("uciDocumentProcessing", () => {
  it("formats role badges with human-readable labels", () => {
    expect(formatDocumentRole("panel_schedule")).toBe("Panel schedule");
    expect(formatDocumentRole("one_line_diagram")).toBe("One-line diagram");
  });

  it("formats processing status without irrelevant label", () => {
    expect(formatProcessingStatus("complete")).toBe("Complete");
    expect(formatProcessingStatus("partial")).toBe("Partial");
    expect(formatProcessingStatus("unsupported")).toBe("Unsupported");
    expect(formatProcessingStatus("irrelevant" as never)).not.toBe("Irrelevant");
  });

  it("renders page coverage summary", () => {
    const text = formatPageCoverage(sampleDoc().page_coverage);
    expect(text).toContain("4/4 accounted");
  });

  it("maps processing status tones", () => {
    expect(processingStatusTone("complete")).toBe("success");
    expect(processingStatusTone("partial")).toBe("warning");
    expect(processingStatusTone("failed")).toBe("destructive");
  });

  it("maps run status tones for partial runs", () => {
    expect(runStatusTone("partial")).toBe("warning");
    expect(runStatusTone("complete")).toBe("success");
  });

  it("groups findings by UCI stage", () => {
    const findings: UciDocumentFinding[] = [
      {
        finding_id: "f1",
        document_id: "d1",
        document_role: ["panel_schedule"],
        uci_stages: ["agent_2_load_profile"],
        field_key: "panel_demand_load_kva",
        category: "panel_load",
        raw_value: "100",
        normalized_value: 100,
        unit: "kVA",
        entity_type: "electrical_panel",
        entity_name: "MDP",
        page_number: 2,
        evidence_text: "TOTAL DEMAND LOAD 100 kVA",
        extraction_method: "pdf_text",
        confidence: 0.7,
        verification_status: "raw",
        requires_human_review: true,
        source_document_name: "panel.pdf",
      },
      {
        finding_id: "f2",
        document_id: "d1",
        document_role: ["site_plan"],
        uci_stages: ["agent_3_application_package"],
        field_key: "site_plan_reference",
        category: "site_plan_information",
        raw_value: "site",
        normalized_value: null,
        unit: null,
        entity_type: "",
        entity_name: null,
        page_number: 1,
        evidence_text: "site plan",
        extraction_method: "pdf_text",
        confidence: null,
        verification_status: "raw",
        requires_human_review: true,
        source_document_name: "site.pdf",
      },
    ];
    const groups = groupFindingsByStage(findings);
    expect(groups.agent_2_load_profile).toHaveLength(1);
    expect(groups.agent_3_application_package).toHaveLength(1);
  });

  it("detects sensitive storage fields that must not be shown", () => {
    expect(hasSensitiveStorageFields({ storage_path: "secret" })).toBe(true);
    expect(hasSensitiveStorageFields({ original_filename: "a.pdf" })).toBe(false);
  });

  it("formats UCI stage labels for agent consumers", () => {
    expect(formatUciStage("agent_2_load_profile")).toContain("Load Profile Analyzer");
    expect(formatUciStage("agent_3_application_package")).toContain("Application Builder");
  });

  it("supports empty coverage summary state", () => {
    const coverage: UciDocumentCoverageSummary = {
      documents_discovered: 0,
      documents_registered: 0,
      complete: 0,
      partial: 0,
      failed: 0,
      duplicate: 0,
      unsupported: 0,
      pending: 0,
      processing: 0,
      total_pages: 0,
      processed_pages: 0,
      failed_pages: 0,
      findings_extracted: 0,
      findings_pending_review: 0,
      verified_findings: 0,
      required_uci_fields_found: [],
      required_uci_fields_missing: [],
    };
    expect(coverage.documents_discovered).toBe(0);
  });
});

describe("document processing API errors", () => {
  it("displays actionable server error messages", async () => {
    const { UciApiError, formatDocumentProcessingUserError } = await import("@/lib/uciApi");
    const err = new UciApiError(
      "No downloaded documents were found for the selected utility application.",
      { code: "NO_DOWNLOADED_DOCUMENTS", httpStatus: 422 },
    );
    expect(formatDocumentProcessingUserError(err, "Document processing failed")).toContain(
      "No downloaded documents were found",
    );

    const appErr = new UciApiError("The selected utility application could not be resolved.", {
      code: "APPLICATION_NOT_FOUND",
      httpStatus: 404,
    });
    expect(formatDocumentProcessingUserError(appErr, "fallback")).toContain(
      "could not be resolved",
    );
  });
});

describe("findings presentation", () => {
  it("groups findings by engineering meaning without duplicating cards per stage", async () => {
    const { groupFindingsByEngineeringMeaning } = await import("@/lib/uciDocumentProcessing");
    const findings = [
      {
        finding_id: "f1",
        document_id: "d1",
        document_role: ["one_line_diagram"],
        uci_stages: ["agent_2_load_profile", "agent_3_application_package"],
        field_key: "service_voltage",
        field_label: "Service voltage",
        category: "service_voltage",
        raw_value: "120/208",
        normalized_value: "120/208",
        unit: "V",
        entity_type: "project_service",
        entity_name: null,
        page_number: 1,
        evidence_text: "120/208V service",
        extraction_method: "one_line_pdf_text",
        confidence: 0.9,
        verification_status: "raw",
        requires_human_review: true,
        source_document_name: "one-line.pdf",
      },
      {
        finding_id: "f2",
        document_id: "d1",
        document_role: ["one_line_diagram"],
        uci_stages: ["agent_2_load_profile"],
        field_key: "main_distribution_panel_rating",
        field_label: "MDP rating",
        category: "main_distribution_equipment",
        raw_value: "800",
        normalized_value: 800,
        unit: "A",
        entity_type: "main_distribution_panel",
        entity_name: "MDP",
        page_number: 1,
        evidence_text: 'NEW PANELBOARD "MDP" 800A',
        extraction_method: "one_line_pdf_text",
        confidence: 0.85,
        verification_status: "raw",
        requires_human_review: true,
        source_document_name: "one-line.pdf",
      },
    ];
    const groups = groupFindingsByEngineeringMeaning(findings);
    expect(groups["Service entrance"]).toHaveLength(1);
    expect(groups["Main distribution equipment"]).toHaveLength(1);
  });
});
