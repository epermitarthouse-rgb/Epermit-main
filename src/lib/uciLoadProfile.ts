/** Parse and display helpers for D2.1 load profile `load_summary` JSON. */

export type UciLoadProfileAnalysisStatus =
  | "preliminary"
  | "missing_inputs"
  | "blocked";

export interface UciLoadProfileInputUsed {
  key: string;
  source: string;
  value?: unknown;
}

export interface UciLoadProfileSourceDocument {
  id?: string;
  document_type?: string;
  file_name?: string;
}

export interface UciLoadProfileSummary {
  version: string;
  utility_type: string;
  analysis_status: UciLoadProfileAnalysisStatus;
  inputs_used: UciLoadProfileInputUsed[];
  missing_inputs: string[];
  needs_verification: string[];
  assumptions: {
    template_id: string | null;
    template_version: string | null;
    notes: string[];
  };
  calculated_values: Record<string, unknown>;
  candidate_values?: UciLoadCandidate[];
  verified_values?: Record<string, UciVerifiedLoadValue>;
  load_extraction?: UciLoadExtractionMeta | null;
  source_documents: UciLoadProfileSourceDocument[];
  generated_at: string;
  generated_by: string;
  generated_by_user_id?: string;
  requires_human_review: boolean;
}

export type UciLoadCandidateStatus =
  | "candidate"
  | "approved"
  | "rejected"
  | "stale";

export type UciLoadExtractionMethod =
  | "structured_application"
  | "pdf_text"
  | "table"
  | "vision"
  | "ocr";

export interface UciLoadCandidate {
  candidate_id: string;
  field_key: string;
  raw_value: string;
  normalized_value: unknown;
  unit: string | null;
  status: UciLoadCandidateStatus;
  source_type: "provider_application" | "pepco_portal_document" | "project_document" | "uci_document_finding";
  source_document_name: string;
  source_document_id: string | null;
  source_storage_path: string;
  source_content_hash: string;
  page_number: number | null;
  evidence_text: string;
  extraction_method: UciLoadExtractionMethod;
  confidence: number | null;
  conflict_group: string | null;
  requires_human_review: boolean;
  external_application_id?: string | null;
  extraction_schema_version?: string;
  entity_type?: string;
  entity_name?: string | null;
  is_project_total?: boolean;
  schedule_heading?: string | null;
  generic_specification_reference?: boolean;
  nested_object_unnormalized?: boolean;
  field_unit_mismatch?: boolean;
  panel_identifier_missing?: boolean;
  replaces_candidate_id?: string | null;
  superseded_by_candidate_id?: string | null;
  can_satisfy_package?: boolean;
  approval_blocked_reason?: string | null;
  stale_reason?: string | null;
  ambiguous?: boolean;
  review_note?: string | null;
  resolved_at?: string | null;
  resolved_by?: string | null;
  finding_id?: string | null;
  finding_schema_version?: string | null;
  bridge_schema_version?: string | null;
  document_role?: string[];
  package_eligible?: boolean;
}

export interface UciVerifiedLoadValue {
  field_key: string;
  value: unknown;
  unit: string | null;
  method: "source_extracted_and_human_verified" | "user_entered_and_verified" | "template_calculated";
  approved_by: string;
  approved_at: string;
  source_document_name: string;
  source_document_id: string | null;
  source_storage_path: string;
  page_number: number | null;
  evidence_text: string;
  extraction_method: UciLoadExtractionMethod;
  edited: boolean;
  review_note: string | null;
  original_candidate_id: string;
  source_content_hash: string;
}

export interface UciLoadExtractionMeta {
  schema_version?: string;
  external_application_id?: string;
  last_extracted_at?: string;
  last_extracted_by?: string;
  extraction_status?: "complete" | "partial";
  documents_discovered?: number;
  documents_processed?: number;
  documents_selected?: number;
  documents_downloaded?: number;
  documents_parsed?: number;
  documents_failed?: number;
  candidates_extracted?: number;
  candidates_skipped_unchanged?: number;
  failed_documents?: Array<{
    document_name: string | null;
    source_type?: string;
    stage: string;
    message: string;
  }>;
  source_document_ranking?: Array<{
    file_name?: string;
    score?: number;
    reasons?: string[];
    source_type?: string;
  }>;
  document_findings_bridge?: {
    bridge_schema_version?: string;
    last_imported_at?: string;
    last_imported_by?: string;
    external_application_id?: string;
    findings_considered?: number;
    findings_imported?: number;
    findings_skipped?: number;
    candidates_created?: number;
    candidates_reused?: number;
    candidates_superseded?: number;
    status?: "complete" | "partial";
    failed_findings?: Array<{ finding_id: string | null; message: string }>;
  };
}

export type LoadReviewTab = "pending" | "approved" | "unresolved" | "stale" | "rejected";

export const DEFAULT_LOAD_REVIEW_TAB: LoadReviewTab = "pending";

export const LOAD_REVIEW_TAB_STORAGE_KEY = "uci-connected-load-review-tab";

export type PendingReviewGroup =
  | "package_eligible"
  | "panels"
  | "equipment"
  | "specification_reference";

export interface EntityCandidateGroup {
  entityKey: string;
  entityLabel: string;
  entityType: string;
  candidates: UciLoadCandidate[];
}

export interface LoadReviewTabCounts {
  pending: number;
  approved: number;
  unresolved: number;
  stale: number;
  rejected: number;
}

export interface LoadReviewSummaryHeader {
  counts: LoadReviewTabCounts;
  connectedLoadComplete: boolean;
  packageEligibleApprovedCount: number;
  lastExtractedAt: string | null;
  extractionStatus: string | null;
}

export interface StaleHistoryGroup {
  schemaVersion: string;
  extractedAt: string | null;
  candidates: UciLoadCandidate[];
}

const PACKAGE_SATISFACTION_FIELD_KEYS = new Set([
  "connected_load_kw",
  "connected_load_kva",
  "demand_load_kw",
  "demand_load_kva",
  "connected_equipment_or_load_data",
]);

const LOAD_FIELD_KEYS_REQUIRING_UNIT = new Set([
  "connected_load_kw",
  "connected_load_kva",
  "demand_load_kw",
  "demand_load_kva",
  "panel_connected_load_kw",
  "panel_connected_load_kva",
  "panel_demand_load_kw",
  "panel_demand_load_kva",
]);

export interface UciLoadCandidateExtractionResponse {
  coordination_record_id: string;
  project_id: string;
  external_application_id: string;
  extraction_status?: "complete" | "partial";
  candidates: UciLoadCandidate[];
  failed_documents?: Array<{
    document_name: string | null;
    source_type?: string;
    stage: string;
    message: string;
  }>;
  documents_discovered?: number;
  documents_selected?: number;
  documents_valid_storage_paths?: number;
  documents_downloaded?: number;
  documents_parsed?: number;
  documents_failed?: number;
  candidates_produced?: number;
  extraction: UciLoadExtractionMeta;
  application: Record<string, unknown>;
}

export interface UciLoadCandidatesListResponse {
  coordination_record_id: string;
  external_application_id: string | null;
  candidates: UciLoadCandidate[];
  verified_values: Record<string, UciVerifiedLoadValue>;
  load_extraction: UciLoadExtractionMeta | null;
  connected_load_satisfied: boolean;
}

export interface UciLoadCandidateResolveResponse {
  coordination_record_id: string;
  candidate: UciLoadCandidate;
  verified_values: Record<string, UciVerifiedLoadValue>;
  connected_load_satisfied: boolean;
  application: Record<string, unknown>;
}

const ENGINEERING_NUMERIC_KEYS = new Set([
  "kw",
  "kilowatts",
  "amperage",
  "amps",
  "amperes",
  "service_voltage",
  "voltage",
  "phase",
  "meter_count",
  "btu",
  "btu_h",
  "btuh",
  "gpm",
  "dfu",
  "service_size",
]);

export function isUciLoadProfileSummary(value: unknown): value is UciLoadProfileSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.version === "string" &&
    typeof rec.utility_type === "string" &&
    typeof rec.analysis_status === "string" &&
    Array.isArray(rec.missing_inputs)
  );
}

export function getLoadProfileDraftApplication<
  T extends { record_source?: string | null; idempotency_key?: string | null; load_summary?: unknown },
>(applications: T[] | null | undefined): T | null {
  if (!applications?.length) return null;
  return (
    applications.find(
      (app) =>
        app.record_source === "agent_draft" &&
        String(app.idempotency_key || "").startsWith("agent_2_load_profile:"),
    ) ?? null
  );
}

export function parseLoadProfileSummary(loadSummary: unknown): UciLoadProfileSummary | null {
  if (!isUciLoadProfileSummary(loadSummary)) return null;
  const raw = loadSummary as UciLoadProfileSummary;
  return {
    ...raw,
    inputs_used: Array.isArray(raw.inputs_used) ? raw.inputs_used : [],
    missing_inputs: Array.isArray(raw.missing_inputs) ? raw.missing_inputs : [],
    needs_verification: Array.isArray(raw.needs_verification) ? raw.needs_verification : [],
    assumptions: {
      template_id: raw.assumptions?.template_id ?? null,
      template_version: raw.assumptions?.template_version ?? null,
      notes: Array.isArray(raw.assumptions?.notes) ? raw.assumptions.notes : [],
    },
    source_documents: Array.isArray(raw.source_documents) ? raw.source_documents : [],
    calculated_values:
      raw.calculated_values &&
      typeof raw.calculated_values === "object" &&
      !Array.isArray(raw.calculated_values)
        ? raw.calculated_values
        : {},
    candidate_values: Array.isArray(raw.candidate_values) ? raw.candidate_values : [],
    verified_values:
      raw.verified_values &&
      typeof raw.verified_values === "object" &&
      !Array.isArray(raw.verified_values)
        ? raw.verified_values
        : {},
    load_extraction:
      raw.load_extraction && typeof raw.load_extraction === "object"
        ? raw.load_extraction
        : null,
  };
}

export function formatLoadProfileAnalysisStatus(status: string | undefined): string {
  switch (status) {
    case "missing_inputs":
      return "Missing inputs";
    case "blocked":
      return "Blocked";
    case "preliminary":
      return "Preliminary — human review required";
    default:
      return status || "Not analyzed";
  }
}

export function loadProfileStatusTone(
  status: string | undefined,
): "neutral" | "warning" | "blocked" | "info" {
  if (status === "blocked") return "blocked";
  if (status === "missing_inputs") return "warning";
  if (status === "preliminary") return "info";
  return "neutral";
}

/** Returns verified numeric entries only — empty when none supplied. */
export function getVerifiedCalculatedValues(
  summary: UciLoadProfileSummary | null,
): Array<{ key: string; value: unknown }> {
  if (!summary) return [];
  if (summary.verified_values && Object.keys(summary.verified_values).length > 0) {
    return Object.entries(summary.verified_values).map(([key, entry]) => ({
      key,
      value: entry.value,
    }));
  }
  if (!summary.calculated_values || typeof summary.calculated_values !== "object") {
    return [];
  }
  return Object.entries(summary.calculated_values).filter(([key, value]) => {
    if (value == null || value === "") return false;
    return !ENGINEERING_NUMERIC_KEYS.has(key.toLowerCase()) || typeof value === "number" || typeof value === "string";
  }).map(([key, value]) => ({ key, value }));
}

export function getPendingLoadCandidates(
  summary: UciLoadProfileSummary | null,
  externalApplicationId?: string | null,
): UciLoadCandidate[] {
  if (!summary?.candidate_values?.length) return [];
  const ext = externalApplicationId ? String(externalApplicationId).trim() : "";
  return summary.candidate_values.filter((c) => {
    if (c.status === "approved" || c.status === "rejected") return false;
    if (ext && c.external_application_id && c.external_application_id !== ext) return false;
    return true;
  });
}

export function isConnectedLoadSatisfied(summary: UciLoadProfileSummary | null): boolean {
  if (!summary?.verified_values) return false;
  const keys = new Set([
    "connected_load_kw",
    "connected_load_kva",
    "demand_load_kw",
    "demand_load_kva",
    "connected_equipment_or_load_data",
  ]);
  for (const [key, entry] of Object.entries(summary.verified_values)) {
    if (!keys.has(key)) continue;
    if (entry.value == null || entry.value === "") continue;
    if (key === "connected_equipment_or_load_data") {
      if (typeof entry.value === "object" && entry.value !== null && Object.keys(entry.value).length > 0) {
        return true;
      }
      continue;
    }
    if (entry.unit) return true;
  }
  return false;
}

export function formatCandidateEntityLabel(candidate: UciLoadCandidate): string {
  switch (candidate.entity_type) {
    case "electrical_panel":
      if (candidate.panel_identifier_missing || !candidate.entity_name) {
        return "Unidentified panel";
      }
      return `Panel ${candidate.entity_name}`;
    case "equipment":
      return candidate.entity_name ? `Equipment: ${candidate.entity_name}` : "Equipment";
    case "specification_reference":
      return "Specification reference";
    case "unclassified_load_total":
      return "Unclassified load total";
    case "project_service":
    default:
      return "Project / service";
  }
}

const CANDIDATE_FIELD_LABELS: Record<string, string> = {
  connected_load_kw: "Connected load",
  connected_load_kva: "Connected load",
  demand_load_kw: "Demand load",
  demand_load_kva: "Demand load",
  panel_connected_load_kw: "Connected load",
  panel_connected_load_kva: "Connected load",
  panel_demand_load_kw: "Demand load",
  panel_demand_load_kva: "Demand load",
  phase: "Service phase",
  service_voltage: "Service voltage",
  requested_voltage: "Requested voltage",
  service_amperage: "Service amperage",
  meter_count: "Meter count",
  central_ac_count: "Central AC",
  central_heat_count: "Central heat",
  service_configuration: "Service configuration",
  wire_configuration: "Wire configuration",
};

export function formatCandidateFieldLabel(fieldKey: string): string {
  return CANDIDATE_FIELD_LABELS[fieldKey] ?? fieldKey.replace(/_/g, " ");
}

export function candidateDisplayFingerprint(candidate: UciLoadCandidate): string {
  return [
    candidate.source_content_hash,
    candidate.source_document_name,
    candidate.page_number ?? "",
    String(candidate.normalized_value ?? candidate.raw_value),
    candidate.unit ?? "",
    candidate.evidence_text.slice(0, 120),
    candidate.entity_type ?? "",
    candidate.entity_name ?? "",
    candidate.field_key,
  ].join("|");
}

export function deduplicateCandidatesForDisplay(candidates: UciLoadCandidate[]): UciLoadCandidate[] {
  const seen = new Set<string>();
  const out: UciLoadCandidate[] = [];
  for (const candidate of candidates) {
    const key = candidateDisplayFingerprint(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

export function groupCandidatesByEntity(candidates: UciLoadCandidate[]): EntityCandidateGroup[] {
  const map = new Map<string, EntityCandidateGroup>();
  for (const candidate of deduplicateCandidatesForDisplay(candidates)) {
    const entityLabel = formatCandidateEntityLabel(candidate);
    const entityKey = `${candidate.entity_type ?? "unknown"}|${candidate.entity_name ?? ""}|${entityLabel}`;
    if (!map.has(entityKey)) {
      map.set(entityKey, {
        entityKey,
        entityLabel,
        entityType: candidate.entity_type ?? "unknown",
        candidates: [],
      });
    }
    map.get(entityKey)!.candidates.push(candidate);
  }
  return [...map.values()];
}

export function formatCandidateValue(candidate: UciLoadCandidate): string {
  if (candidate.normalized_value == null || candidate.normalized_value === "") {
    return candidate.raw_value;
  }
  if (typeof candidate.normalized_value === "object") {
    return candidate.raw_value;
  }
  return String(candidate.normalized_value);
}

export function isCandidateApprovalBlocked(candidate: UciLoadCandidate): boolean {
  if (candidate.status === "stale") return true;
  if (candidate.ambiguous === true) return true;
  if (candidate.approval_blocked_reason) return true;
  if (candidate.field_unit_mismatch === true) return true;
  if (candidate.nested_object_unnormalized === true) return true;
  if (candidate.generic_specification_reference === true) return true;
  return false;
}

export function hasInventedEngineeringValues(summary: UciLoadProfileSummary | null): boolean {
  if (!summary?.calculated_values) return false;
  return Object.keys(summary.calculated_values).some((key) =>
    ENGINEERING_NUMERIC_KEYS.has(key.toLowerCase()),
  );
}

function matchesExternalApplication(
  candidate: UciLoadCandidate,
  externalApplicationId?: string | null,
): boolean {
  const ext = externalApplicationId ? String(externalApplicationId).trim() : "";
  if (!ext) return true;
  if (!candidate.external_application_id) return true;
  return candidate.external_application_id === ext;
}

function scopedCandidates(
  summary: UciLoadProfileSummary | null,
  externalApplicationId?: string | null,
): UciLoadCandidate[] {
  if (!summary?.candidate_values?.length) return [];
  return summary.candidate_values.filter((c) =>
    matchesExternalApplication(c, externalApplicationId),
  );
}

export function isCandidateMissingUnit(candidate: UciLoadCandidate): boolean {
  if (!LOAD_FIELD_KEYS_REQUIRING_UNIT.has(candidate.field_key)) return false;
  return candidate.unit == null || candidate.unit === "";
}

export function isCandidateKeptUnresolved(candidate: UciLoadCandidate): boolean {
  return (
    candidate.status === "candidate" &&
    candidate.resolved_at != null &&
    candidate.resolved_at !== ""
  );
}

export function isUnresolvedLoadCandidate(candidate: UciLoadCandidate): boolean {
  if (candidate.status !== "candidate") return false;
  return (
    candidate.conflict_group != null ||
    candidate.ambiguous === true ||
    candidate.generic_specification_reference === true ||
    candidate.field_unit_mismatch === true ||
    candidate.nested_object_unnormalized === true ||
    candidate.entity_type === "unclassified_load_total" ||
    candidate.panel_identifier_missing === true ||
    (candidate.entity_type === "electrical_panel" && !candidate.entity_name) ||
    isCandidateMissingUnit(candidate) ||
    isCandidateKeptUnresolved(candidate)
  );
}

export function isPendingLoadReviewCandidate(candidate: UciLoadCandidate): boolean {
  if (candidate.status !== "candidate") return false;
  return !isUnresolvedLoadCandidate(candidate);
}

export function isStaleLoadReviewCandidate(candidate: UciLoadCandidate): boolean {
  return candidate.status === "stale";
}

export function isRejectedLoadReviewCandidate(candidate: UciLoadCandidate): boolean {
  return candidate.status === "rejected";
}

export function getUnresolvedBlockingReason(candidate: UciLoadCandidate): string {
  if (candidate.approval_blocked_reason) return candidate.approval_blocked_reason;
  if (candidate.conflict_group) return "Conflicting values require human resolution";
  if (candidate.ambiguous) return "Value is ambiguous";
  if (isCandidateMissingUnit(candidate)) return "Missing unit for load field";
  if (candidate.entity_type === "electrical_panel" && !candidate.entity_name) {
    return "Panel identifier missing for panel-level total";
  }
  if (candidate.generic_specification_reference) {
    return "Generic specification reference — not service configuration";
  }
  if (isCandidateKeptUnresolved(candidate)) return "Kept unresolved by reviewer";
  return "Requires review";
}

export function getPendingReviewGroup(candidate: UciLoadCandidate): PendingReviewGroup {
  if (candidate.entity_type === "specification_reference") return "specification_reference";
  if (candidate.entity_type === "equipment") return "equipment";
  if (
    candidate.entity_type === "electrical_panel" ||
    candidate.entity_type === "unclassified_load_total"
  ) {
    return "panels";
  }
  return "package_eligible";
}

export function groupPendingReviewCandidates(
  candidates: UciLoadCandidate[],
): Record<PendingReviewGroup, UciLoadCandidate[]> {
  const groups: Record<PendingReviewGroup, UciLoadCandidate[]> = {
    package_eligible: [],
    panels: [],
    equipment: [],
    specification_reference: [],
  };
  for (const candidate of candidates) {
    groups[getPendingReviewGroup(candidate)].push(candidate);
  }
  return groups;
}

export function verifiedValueSatisfiesConnectedLoad(
  fieldKey: string,
  entry: UciVerifiedLoadValue,
): boolean {
  if (!PACKAGE_SATISFACTION_FIELD_KEYS.has(fieldKey)) return false;
  if (fieldKey.startsWith("panel_")) return false;
  if (entry.value == null || entry.value === "") return false;
  if (fieldKey === "connected_equipment_or_load_data") {
    return (
      typeof entry.value === "object" &&
      entry.value !== null &&
      Object.keys(entry.value).length > 0
    );
  }
  return entry.unit != null && entry.unit !== "";
}

export function getApprovedVerifiedValues(
  summary: UciLoadProfileSummary | null,
): Array<{ key: string; entry: UciVerifiedLoadValue }> {
  if (!summary?.verified_values) return [];
  return Object.entries(summary.verified_values).map(([key, entry]) => ({ key, entry }));
}

export function countPackageEligibleApprovedValues(summary: UciLoadProfileSummary | null): number {
  return getApprovedVerifiedValues(summary).filter(({ key, entry }) =>
    verifiedValueSatisfiesConnectedLoad(key, entry),
  ).length;
}

export function getLoadReviewTabCandidates(
  summary: UciLoadProfileSummary | null,
  tab: LoadReviewTab,
  externalApplicationId?: string | null,
): UciLoadCandidate[] {
  const scoped = scopedCandidates(summary, externalApplicationId);
  switch (tab) {
    case "pending":
      return scoped.filter(isPendingLoadReviewCandidate);
    case "unresolved":
      return scoped.filter(isUnresolvedLoadCandidate);
    case "stale":
      return scoped.filter(isStaleLoadReviewCandidate);
    case "rejected":
      return scoped.filter(isRejectedLoadReviewCandidate);
    case "approved":
      return [];
    default:
      return [];
  }
}

export function getLoadReviewTabCounts(
  summary: UciLoadProfileSummary | null,
  externalApplicationId?: string | null,
): LoadReviewTabCounts {
  const scoped = scopedCandidates(summary, externalApplicationId);
  return {
    pending: scoped.filter(isPendingLoadReviewCandidate).length,
    approved: getApprovedVerifiedValues(summary).length,
    unresolved: scoped.filter(isUnresolvedLoadCandidate).length,
    stale: scoped.filter(isStaleLoadReviewCandidate).length,
    rejected: scoped.filter(isRejectedLoadReviewCandidate).length,
  };
}

export function getLoadReviewSummaryHeader(
  summary: UciLoadProfileSummary | null,
  externalApplicationId?: string | null,
): LoadReviewSummaryHeader {
  return {
    counts: getLoadReviewTabCounts(summary, externalApplicationId),
    connectedLoadComplete: isConnectedLoadSatisfied(summary),
    packageEligibleApprovedCount: countPackageEligibleApprovedValues(summary),
    lastExtractedAt: summary?.load_extraction?.last_extracted_at ?? null,
    extractionStatus: summary?.load_extraction?.extraction_status ?? null,
  };
}

export function findReplacementCandidate(
  staleCandidate: UciLoadCandidate,
  summary: UciLoadProfileSummary | null,
  externalApplicationId?: string | null,
): UciLoadCandidate | null {
  const active = getLoadReviewTabCandidates(summary, "pending", externalApplicationId).concat(
    getLoadReviewTabCandidates(summary, "unresolved", externalApplicationId),
  );
  return (
    active.find(
      (c) =>
        c.candidate_id !== staleCandidate.candidate_id &&
        (c.replaces_candidate_id === staleCandidate.candidate_id ||
          staleCandidate.superseded_by_candidate_id === c.candidate_id ||
          (c.source_content_hash === staleCandidate.source_content_hash &&
            c.page_number === staleCandidate.page_number &&
            String(c.normalized_value) === String(staleCandidate.normalized_value) &&
            c.unit === staleCandidate.unit)),
    ) ?? null
  );
}

export function groupStaleHistoryCandidates(
  candidates: UciLoadCandidate[],
  defaultExtractedAt: string | null,
): StaleHistoryGroup[] {
  /** @type {Map<string, StaleHistoryGroup>} */
  const map = new Map();
  for (const candidate of candidates) {
    const schemaVersion = candidate.extraction_schema_version ?? "unknown";
    const extractedAt = defaultExtractedAt;
    const key = `${schemaVersion}|${extractedAt ?? ""}`;
    if (!map.has(key)) {
      map.set(key, { schemaVersion, extractedAt, candidates: [] });
    }
    map.get(key).candidates.push(candidate);
  }
  return [...map.values()].sort((a, b) => {
    const aTime = a.extractedAt ?? "";
    const bTime = b.extractedAt ?? "";
    return bTime.localeCompare(aTime);
  });
}

export function readStoredLoadReviewTab(): LoadReviewTab {
  if (typeof sessionStorage === "undefined") return DEFAULT_LOAD_REVIEW_TAB;
  const stored = sessionStorage.getItem(LOAD_REVIEW_TAB_STORAGE_KEY);
  if (
    stored === "pending" ||
    stored === "approved" ||
    stored === "unresolved" ||
    stored === "stale" ||
    stored === "rejected"
  ) {
    return stored;
  }
  return DEFAULT_LOAD_REVIEW_TAB;
}

export function persistLoadReviewTab(tab: LoadReviewTab): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(LOAD_REVIEW_TAB_STORAGE_KEY, tab);
}

export function formatVerifiedApprovalMethod(method: UciVerifiedLoadValue["method"]): string {
  switch (method) {
    case "source_extracted_and_human_verified":
      return "Source extracted & human verified";
    case "user_entered_and_verified":
      return "User entered & verified";
    case "template_calculated":
      return "Template calculated";
    default:
      return method;
  }
}
