/** UCI document processing manifest and coverage helpers. */

export type DocumentProcessingStatus =
  | "pending"
  | "processing"
  | "complete"
  | "partial"
  | "failed"
  | "duplicate"
  | "unsupported";

export type DocumentRunStatus = "pending" | "processing" | "complete" | "partial" | "failed";

export type UciDocumentRole =
  | "utility_application"
  | "service_configuration"
  | "one_line_diagram"
  | "panel_schedule"
  | "load_calculation"
  | "equipment_schedule"
  | "equipment_cut_sheet"
  | "site_plan"
  | "civil_plan"
  | "electrical_plan"
  | "electrical_specification"
  | "COMcheck"
  | "authorization"
  | "correspondence"
  | "submission_receipt"
  | "confirmation"
  | "cost_or_invoice"
  | "equipment_evidence"
  | "meter_or_service_evidence"
  | "closeout_document"
  | "supporting_document"
  | "historical_or_superseded";

export interface UciPageCoverage {
  total_pages: number;
  pages_discovered: number;
  pages_processed: number;
  pages_with_text: number;
  pages_with_tables: number;
  pages_sent_to_vision: number;
  pages_sent_to_ocr: number;
  pages_vision_processed?: number;
  pages_ocr_processed?: number;
  blank_pages: number;
  failed_pages: number;
  fallback_pending?: number;
  skipped_duplicate_pages: number;
}

export type UciPageStatus =
  | "pending"
  | "text_extracted"
  | "table_extracted"
  | "blank"
  | "vision_required"
  | "vision_processing"
  | "vision_processed"
  | "vision_failed"
  | "ocr_required"
  | "ocr_processing"
  | "ocr_processed"
  | "ocr_failed"
  | "human_required"
  | "failed";

export interface UciPageAnalysis {
  page_number: number;
  page_type: string;
  native_text_length: number;
  text_quality_score: number;
  layout_dependency: string;
  recommended_method: string;
  reason: string;
  status: string;
}

export interface UciPageRecord {
  page_number: number;
  status: UciPageStatus | string;
  text_length?: number;
  failure_reason?: string | null;
  page_analysis?: UciPageAnalysis;
  extraction_methods?: string[];
  vision_result?: Record<string, unknown> | null;
  ocr_result?: Record<string, unknown> | null;
}

export interface UciFallbackProviderStatus {
  vision_available: boolean;
  ocr_available: boolean;
  warnings: string[];
}

export interface UciDocumentManifestEntry {
  document_id: string;
  source_type: string;
  provider_slug: string;
  external_application_id: string;
  original_filename: string;
  portal_document_name: string | null;
  portal_document_type: string | null;
  portal_document_status: string | null;
  content_hash: string;
  mime_type: string | null;
  file_size: number | null;
  page_count: number | null;
  document_roles: UciDocumentRole[];
  role_confidence: string[];
  uci_stages: string[];
  processing_status: DocumentProcessingStatus;
  pages_processed: number;
  extraction_methods_used: string[];
  findings_count: number;
  failed_pages: unknown[];
  failure_reason: string | null;
  duplicate_of: string | null;
  schema_version: string;
  processed_at: string | null;
  page_coverage: UciPageCoverage | null;
  page_records?: UciPageRecord[] | null;
  findings_extraction_status?: FindingsExtractionStatus | null;
  findings_quality_warnings?: string[];
}

export type FindingsExtractionStatus =
  | "findings_created"
  | "no_supported_findings"
  | "extraction_incomplete"
  | "vision_required_for_structured_findings"
  | "parser_failed"
  | "conflicts_require_review";

export interface UciDocumentCoverageSummary {
  documents_discovered: number;
  documents_registered: number;
  complete: number;
  partial: number;
  failed: number;
  duplicate: number;
  unsupported: number;
  pending: number;
  processing: number;
  total_pages: number;
  processed_pages: number;
  failed_pages: number;
  findings_extracted: number;
  findings_pending_review: number;
  verified_findings: number;
  required_uci_fields_found: string[];
  required_uci_fields_missing: string[];
}

export interface UciDocumentFinding {
  finding_id: string;
  document_id: string;
  document_role: string[];
  uci_stages: string[];
  field_key: string;
  field_label?: string;
  category: string;
  fact_type?: string | null;
  raw_value: string;
  normalized_value: unknown;
  unit: string | null;
  entity_type: string;
  entity_name: string | null;
  page_number: number | null;
  evidence_text: string;
  extraction_method: string;
  confidence: number | null;
  verification_status: string;
  requires_human_review: boolean;
  review_blocked_reason?: string | null;
  package_eligible?: boolean;
  aggregation_role?: string | null;
  utility_type?: string | null;
  energy_domain?: string | null;
  capacity_type?: string | null;
  source_document_name: string;
}

export interface UciDocumentProcessingManifestResponse {
  coordination_record_id: string;
  external_application_id: string;
  run_status: DocumentRunStatus;
  run_started_at?: string | null;
  run_completed_at?: string | null;
  coverage: UciDocumentCoverageSummary;
  documents: UciDocumentManifestEntry[];
  findings_count: number;
  findings_by_stage_counts: {
    agent_2_load_profile: number;
    agent_3_application_package: number;
    agent_4_submission: number;
  };
  completion_blockers?: string[];
  failed_documents?: Array<{
    document_name: string | null;
    source_type?: string;
    stage: string;
    code?: string;
    message: string;
  }>;
  findings?: UciDocumentFinding[];
  findings_by_stage?: Record<string, UciDocumentFinding[]>;
  fallback_provider_status?: UciFallbackProviderStatus;
  fallback_processing?: {
    last_run_at?: string;
    pages_processed?: number;
    pages_failed?: number;
    findings_created?: number;
    failed_pages?: Array<{
      document_name?: string;
      page_number?: number;
      method?: string;
      message?: string;
    }>;
  } | null;
  fallback_config?: {
    vision_enabled?: boolean;
    ocr_enabled?: boolean;
    vision_max_pages_per_run?: number;
    ocr_max_pages_per_run?: number;
  } | null;
}

export interface UciDocumentProcessingRunResponse {
  status: DocumentRunStatus;
  coordination_record_id: string;
  external_application_id: string;
  run_status: DocumentRunStatus;
  documents_discovered: number;
  documents_registered: number;
  documents_complete: number;
  documents_partial: number;
  documents_failed: number;
  coverage: UciDocumentCoverageSummary;
  documents: UciDocumentManifestEntry[];
  findings_count: number;
  findings_by_stage_counts: {
    agent_2_load_profile: number;
    agent_3_application_package: number;
    agent_4_submission: number;
  };
  failed_documents: Array<{
    document_name: string | null;
    source_type?: string;
    stage: string;
    code?: string;
    message: string;
  }>;
  completion_blockers: string[];
}

const ROLE_LABELS: Record<string, string> = {
  utility_application: "Utility application",
  service_configuration: "Service configuration",
  one_line_diagram: "One-line diagram",
  panel_schedule: "Panel schedule",
  load_calculation: "Load calculation",
  equipment_schedule: "Equipment schedule",
  equipment_cut_sheet: "Equipment cut sheet",
  site_plan: "Site plan",
  civil_plan: "Civil plan",
  electrical_plan: "Electrical plan",
  electrical_specification: "Electrical specification",
  COMcheck: "COMcheck",
  authorization: "Authorization",
  correspondence: "Correspondence",
  submission_receipt: "Submission receipt",
  confirmation: "Confirmation",
  cost_or_invoice: "Cost / invoice",
  equipment_evidence: "Equipment evidence",
  meter_or_service_evidence: "Meter / service evidence",
  closeout_document: "Closeout document",
  supporting_document: "Supporting document",
  historical_or_superseded: "Historical / superseded",
};

const STATUS_LABELS: Record<DocumentProcessingStatus, string> = {
  pending: "Pending",
  processing: "Processing",
  complete: "Complete",
  partial: "Partial",
  failed: "Failed",
  duplicate: "Duplicate",
  unsupported: "Unsupported",
};

const STAGE_LABELS: Record<string, string> = {
  agent_2_load_profile: "Agent 2 — Load profile",
  agent_3_application_package: "Agent 3 — Application package",
  agent_4_submission: "Agent 4 — Submission",
  equipment_workflow: "Equipment workflow",
  meter_workflow: "Meter workflow",
  cost_workflow: "Cost workflow",
  closeout_workflow: "Closeout workflow",
  portfolio_audit: "Portfolio / audit",
};

export function formatDocumentRole(role: string): string {
  return ROLE_LABELS[role] ?? role.replace(/_/g, " ");
}

export function formatProcessingStatus(status: string | undefined): string {
  if (!status) return "Pending";
  return STATUS_LABELS[status as DocumentProcessingStatus] ?? status.replace(/_/g, " ");
}

export function formatUciStage(stage: string): string {
  return STAGE_LABELS[stage] ?? stage.replace(/_/g, " ");
}

export function processingStatusTone(
  status: string | undefined,
): "neutral" | "success" | "warning" | "destructive" | "secondary" {
  switch (status) {
    case "complete":
      return "success";
    case "partial":
      return "warning";
    case "failed":
      return "destructive";
    case "duplicate":
    case "unsupported":
      return "secondary";
    case "processing":
      return "neutral";
    default:
      return "neutral";
  }
}

export function runStatusTone(
  status: string | undefined,
): "neutral" | "success" | "warning" | "destructive" {
  switch (status) {
    case "complete":
      return "success";
    case "partial":
      return "warning";
    case "failed":
      return "destructive";
    default:
      return "neutral";
  }
}

export function formatPageCoverage(coverage: UciPageCoverage | null | undefined): string {
  if (!coverage) return "—";
  const total = coverage.total_pages ?? 0;
  const processed = coverage.pages_processed ?? 0;
  const failed = coverage.failed_pages ?? 0;
  const vision = coverage.pages_sent_to_vision ?? 0;
  const ocr = coverage.pages_sent_to_ocr ?? 0;
  const pending = coverage.fallback_pending ?? 0;
  if (total === 0) return "No pages";
  return `${processed}/${total} accounted${failed ? ` · ${failed} failed` : ""}${vision ? ` · ${vision} vision` : ""}${ocr ? ` · ${ocr} OCR` : ""}${pending ? ` · ${pending} fallback pending` : ""}`;
}

export function formatExtractionMethodBadge(method: string): string {
  switch (method) {
    case "pdf_text":
    case "native_text":
      return "Native text";
    case "table":
      return "Table";
    case "vision":
    case "vision_required":
      return "Vision";
    case "ocr":
    case "ocr_required":
      return "OCR";
    default:
      return method;
  }
}

export function countFallbackPages(documents: UciDocumentManifestEntry[]): {
  vision: number;
  ocr: number;
  total: number;
} {
  let vision = 0;
  let ocr = 0;
  for (const doc of documents) {
    for (const page of doc.page_records ?? []) {
      const status = String(page.status ?? "");
      if (status === "vision_required" || status === "vision_failed") vision += 1;
      if (status === "ocr_required" || status === "ocr_failed") ocr += 1;
    }
  }
  return { vision, ocr, total: vision + ocr };
}

export function formatFindingFieldLabel(finding: UciDocumentFinding): string {
  if (finding.field_label?.trim()) return finding.field_label;
  return finding.field_key.replace(/_/g, " ");
}

export function formatFindingCategory(category: string): string {
  return CATEGORY_GROUP_LABELS[category] ?? category.replace(/_/g, " ");
}

const CATEGORY_GROUP_LABELS: Record<string, string> = {
  service_entrance: "Service entrance",
  main_distribution_equipment: "Main distribution equipment",
  panel_rating: "Branch panels",
  disconnect_rating: "Main distribution equipment",
  metering_equipment: "Metering equipment",
  lighting_totals: "Lighting totals",
  lighting_detail: "Lighting detail rows",
  hvac_gas_capacity: "HVAC gas capacity",
  hvac_thermal_cooling: "HVAC thermal cooling capacity",
  equipment_schedule: "Equipment schedule rows",
  service_voltage: "Service entrance",
  phase: "Service entrance",
  wire_configuration: "Service entrance",
  meter_count: "Metering equipment",
  connected_load: "Supporting evidence",
  demand_load: "Supporting evidence",
  panel_load: "Branch panels",
  compliance_evidence: "Supporting evidence",
  equipment_evidence: "Supporting evidence",
  package_document_evidence: "Supporting evidence",
  service_configuration: "Supporting evidence",
  service_amperage: "Service entrance",
  load_category: "Supporting evidence",
  thermal_capacity: "HVAC thermal cooling capacity",
  gas_load: "HVAC gas capacity",
};

export function groupFindingsByEngineeringMeaning(
  findings: UciDocumentFinding[],
): Record<string, UciDocumentFinding[]> {
  const groups: Record<string, UciDocumentFinding[]> = {};
  for (const finding of findings) {
    const key = formatFindingCategory(finding.category || "uncategorized");
    if (!groups[key]) groups[key] = [];
    groups[key].push(finding);
  }
  return groups;
}

export function groupFindingsByCategory(
  findings: UciDocumentFinding[],
): Record<string, UciDocumentFinding[]> {
  const groups: Record<string, UciDocumentFinding[]> = {};
  for (const finding of findings) {
    const key = finding.category || "uncategorized";
    if (!groups[key]) groups[key] = [];
    groups[key].push(finding);
  }
  return groups;
}

export function groupFindingsByStage(
  findings: UciDocumentFinding[],
): Record<string, UciDocumentFinding[]> {
  const groups: Record<string, UciDocumentFinding[]> = {};
  for (const finding of findings) {
    const stages = finding.uci_stages?.length ? finding.uci_stages : ["unmapped"];
    const primary = stages[0];
    if (!groups[primary]) groups[primary] = [];
    groups[primary].push(finding);
  }
  return groups;
}

export function hasSensitiveStorageFields(doc: Record<string, unknown>): boolean {
  return "storage_path" in doc || "storage_bucket" in doc;
}
