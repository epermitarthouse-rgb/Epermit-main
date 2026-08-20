/** Parse and display helpers for D3 application package drafts. */

import type { CoordinationApplication, DraftStatus } from "@/types/uci";

export type UciApplicationPackageStatus = "blocked" | "incomplete" | "ready_for_review";
export type UciPackageReviewItemStatus =
  | "not_reviewed"
  | "confirmed"
  | "needs_correction"
  | "ready_for_re_review";
export type UciPackageReviewStatus =
  | "draft"
  | "ready_for_review"
  | "needs_changes"
  | "reviewed";
export type UciPackageValidationStatus = "not_run" | "passed" | "found_blockers";

export interface UciPackageFieldResult {
  key: string;
  label: string;
  status: string;
  value?: unknown;
  source?: string;
  note?: string;
  address_source?: string;
}

function firstEvidenceSource(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const sources = Array.isArray(record.evidence_sources) ? record.evidence_sources : [];
  const first = sources.find(
    (entry): entry is Record<string, unknown> =>
      Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
  );
  return first ?? {};
}

export function getPackageFieldSourceHref(
  field: UciPackageFieldResult,
  context: {
    coordinationId: string;
    applicationId: string;
    projectId: string;
  },
): string | null {
  const returnTo = `/uci/records/${encodeURIComponent(context.coordinationId)}?tab=application-prep&application=${encodeURIComponent(context.applicationId)}&item=${encodeURIComponent(`field:${field.key}`)}#package-field-${encodeURIComponent(field.key)}`;
  if (field.source?.startsWith("load_summary.verified_values")) {
    const value =
      field.value && typeof field.value === "object" && !Array.isArray(field.value)
        ? (field.value as Record<string, unknown>)
        : {};
    const evidence = firstEvidenceSource(field.value);
    const fieldKey =
      field.source.slice("load_summary.verified_values.".length) || field.key;
    const verifiedValueId = String(
      value.original_candidate_id ?? evidence.candidate_id ?? fieldKey,
    );
    const sourceDocumentId = String(
      value.source_document_id ?? evidence.source_document_id ?? "",
    );
    const params = new URLSearchParams({
      tab: "load-profile",
      section: "verified_inputs",
      field_key: fieldKey,
      verified_value_id: verifiedValueId,
      return_to: returnTo,
    });
    if (sourceDocumentId) params.set("source_document_id", sourceDocumentId);
    return `/uci/records/${encodeURIComponent(context.coordinationId)}?${params.toString()}#verified-input-${encodeURIComponent(fieldKey)}`;
  }
  if (field.source?.startsWith("project.")) {
    const projectField = field.source.slice("project.".length);
    const params = new URLSearchParams({
      project: context.projectId,
      mode: "edit",
      field: projectField,
      return_to: returnTo,
    });
    return `/projects?${params.toString()}#project-field-${encodeURIComponent(projectField)}`;
  }
  return null;
}

export interface UciPackageReviewItem {
  kind?: "field" | "document";
  key?: string;
  status?: UciPackageReviewItemStatus;
  mapping_snapshot?: Record<string, unknown>;
  reviewed_by_user_id?: string | null;
  reviewed_at?: string | null;
  note?: string | null;
  issue_area?: "mapping" | "signature" | null;
}

export interface UciPackageReview {
  version?: string;
  status?: UciPackageReviewStatus;
  items?: Record<string, UciPackageReviewItem>;
  reviewed_by_user_id?: string | null;
  reviewer_display?: string | null;
  reviewed_at?: string | null;
  review_notes?: string | null;
  reviewed_snapshot?: Record<string, unknown> | null;
  review_history?: Array<Record<string, unknown>>;
  package_correction?: {
    active?: boolean;
    note?: string | null;
    requested_by_user_id?: string | null;
    requested_at?: string | null;
    cleared_at?: string | null;
  } | null;
}

export interface UciCanonicalPackageReviewItem {
  id: string;
  kind: "field" | "document";
  key: string;
  status: UciPackageReviewItemStatus;
  ready: boolean;
  snapshot: Record<string, unknown>;
  note?: string | null;
  issue_area?: "mapping" | "signature" | null;
}

export interface UciCanonicalPackageReviewSummary {
  status: UciPackageReviewStatus;
  all_confirmed: boolean;
  ready_for_final_review: boolean;
  active_correction_count: number;
  active_corrections?: UciCanonicalPackageReviewItem[];
  confirmed_count: number;
  total_count: number;
  items: UciCanonicalPackageReviewItem[];
}

export function parseCanonicalPackageReviewSummary(
  value: unknown,
): UciCanonicalPackageReviewSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const summary = value as Partial<UciCanonicalPackageReviewSummary>;
  if (
    typeof summary.ready_for_final_review !== "boolean" ||
    typeof summary.confirmed_count !== "number" ||
    typeof summary.total_count !== "number" ||
    !Array.isArray(summary.items)
  ) {
    return null;
  }
  return summary as UciCanonicalPackageReviewSummary;
}

export const PERSISTED_PROJECT_DOCUMENT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isPersistedProjectDocumentId(value: unknown): boolean {
  const id = value != null ? String(value).trim() : "";
  if (!id) return false;
  if (/^generated-/i.test(id)) return false;
  return PERSISTED_PROJECT_DOCUMENT_ID.test(id);
}

export function isDocumentMappingReady(document: UciApplicationPackageDocument): boolean {
  return (
    document.status === "attached" &&
    isPersistedProjectDocumentId(document.project_document_id) &&
    (!document.signature_required || document.signature_status === "signed_manual_verified")
  );
}

export interface UciApplicationPackageDocument {
  key: string;
  label?: string;
  status: "attached" | "missing";
  project_document_id?: string | null;
  document_type?: string | null;
  file_name?: string | null;
  source?: string;
  user_confirmed?: boolean;
  pepco_document_name?: string | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
  content_hash?: string | null;
  idempotency_key?: string | null;
  external_application_id?: string | null;
  confirmed_by?: string | null;
  confirmed_at?: string | null;
  signature_required?: boolean;
  signature_status?: "unknown" | "unsigned" | "signed_manual_verified";
  signature_verified_by?: string | null;
  signature_verified_at?: string | null;
  signature_review_note?: string | null;
}

export type UciPackageDocumentCandidateSource = "project_document" | "pepco_portal";

export interface UciPackageDocumentCandidate {
  candidate_id: string;
  source_type: UciPackageDocumentCandidateSource;
  project_id: string;
  tenant_id: string | null;
  coordination_record_id: string;
  external_application_id: string | null;
  file_name: string | null;
  pepco_document_name: string | null;
  pepco_document_type: string | null;
  project_document_id: string | null;
  document_type: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  content_hash: string | null;
  idempotency_key: string | null;
  timestamp: string | null;
  suggested_package_slot: string | null;
  confidence: "high" | "medium" | "low" | null;
  suggestion_reason: string | null;
}

export interface UciPackageDocumentCandidatesResponse {
  coordination_record_id: string;
  project_id: string;
  tenant_id: string | null;
  external_application_id?: string | null;
  available_applications?: Array<{
    external_application_id: string;
    project_name: string | null;
    document_count: number;
    downloaded_count: number;
  }>;
  required_slots: Array<{ key: string; label: string }>;
  candidates: UciPackageDocumentCandidate[];
  suggestions_by_slot: Record<string, UciPackageDocumentCandidate[]>;
}

export function isPackageDocumentCandidateAlreadyMapped(
  document: UciApplicationPackageDocument,
  candidate: UciPackageDocumentCandidate | undefined,
): boolean {
  if (!candidate || document.status !== "attached") return false;
  if (candidate.source_type === "project_document") {
    return (
      Boolean(document.project_document_id) &&
      document.project_document_id === candidate.project_document_id
    );
  }
  return (
    Boolean(document.storage_path) &&
    document.storage_path === candidate.storage_path &&
    (document.external_application_id ?? null) ===
      (candidate.external_application_id ?? null)
  );
}

export interface UciApplicationPackageMetadata {
  version?: string;
  template_id?: string | null;
  package_status?: UciApplicationPackageStatus;
  missing_documents?: string[];
  missing_fields?: string[];
  load_profile_analysis_status?: string | null;
  requires_human_review?: boolean;
  checklist_mode?: "production" | "synthetic_test";
  checklist_label?: string | null;
  authoritative_requirements?: boolean;
  external_submission_allowed?: boolean | null;
  requirements_approval?: {
    status?: "approved";
    approved_by_display?: string | null;
    approved_at?: string | null;
    version?: string | null;
  } | null;
  built_at?: string | null;
  built_by_user_id?: string | null;
  synthetic_checklist?: {
    status?: "draft" | "approved";
    label?: string;
    approved_by_user_id?: string | null;
    approved_by_display?: string | null;
    approved_at?: string | null;
    approval_note?: string | null;
  } | null;
  signature_requirements?: Array<{
    document_key: string;
    requirement_key: string;
    signature_status: "unknown" | "unsigned" | "signed_manual_verified";
    satisfied: boolean;
    verified_by?: string | null;
    verified_at?: string | null;
    review_note?: string | null;
  }>;
  field_results?: UciPackageFieldResult[];
  package_review?: UciPackageReview | null;
  notes?: string[];
  project_address?: {
    formatted?: string | null;
    source?: "structured" | "portal_data_location" | "utility_portal" | "manual" | "jurisdiction_scrape" | "confirmed" | "none" | string;
    complete?: boolean;
    fallback_used?: boolean;
    selection_reason?: string | null;
    external_application_id?: string | null;
  };
  address_source_acknowledged?: string | null;
  address_mismatch?: boolean;
  mismatch_warning?: string | null;
  address_review_required?: boolean;
  last_review?: {
    status?: DraftStatus;
    notes?: string | null;
    reviewed_at?: string;
  };
}

function canonicalReviewSnapshot(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalReviewSnapshot);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [
          key,
          canonicalReviewSnapshot((value as Record<string, unknown>)[key]),
        ]),
    );
  }
  return value ?? null;
}

function stableReviewSnapshot(value: unknown): string {
  return JSON.stringify(canonicalReviewSnapshot(value));
}

function fieldMappingSnapshot(field: UciPackageFieldResult): Record<string, unknown> {
  return {
    key: field.key,
    label: field.label,
    status: field.status,
    value: field.value ?? null,
    source: field.source ?? "",
    address_source: field.address_source ?? null,
  };
}

function documentMappingSnapshot(document: UciApplicationPackageDocument): Record<string, unknown> {
  return {
    key: document.key,
    label: document.label ?? document.key,
    status: document.status,
    file_name: document.file_name ?? null,
    source: document.source ?? null,
    project_document_id: document.project_document_id ?? null,
    external_application_id: document.external_application_id ?? null,
    storage_path: document.storage_path ?? null,
    content_hash: document.content_hash ?? null,
    signature_required: document.signature_required === true,
    signature_status: document.signature_required ? document.signature_status ?? "unknown" : null,
    signature_verified_at: document.signature_verified_at ?? null,
  };
}

export function getPackageReviewItemStatus(
  review: UciPackageReview | null | undefined,
  kind: "field" | "document",
  key: string,
  currentSnapshot: Record<string, unknown>,
): UciPackageReviewItemStatus {
  const stored = review?.items?.[`${kind}:${key}`];
  if (
    (stored?.status === "confirmed" || stored?.status === "needs_correction") &&
    stableReviewSnapshot(stored.mapping_snapshot) === stableReviewSnapshot(currentSnapshot)
  ) {
    return stored.status;
  }
  if (
    (stored?.status === "confirmed" || stored?.status === "needs_correction") &&
    ((kind === "field" && currentSnapshot.status === "present") ||
      (kind === "document" &&
        currentSnapshot.status === "attached" &&
        isPersistedProjectDocumentId(currentSnapshot.project_document_id) &&
        (!currentSnapshot.signature_required ||
          currentSnapshot.signature_status === "signed_manual_verified")))
  ) {
    return "ready_for_re_review";
  }
  if (stored?.status === "confirmed" || stored?.status === "needs_correction") {
    return "needs_correction";
  }
  return "not_reviewed";
}

export function summarizePackageReview(
  metadata: UciApplicationPackageMetadata | null | undefined,
  documents: UciApplicationPackageDocument[],
  draftStatus?: DraftStatus,
): {
  status: UciPackageReviewStatus;
  allConfirmed: boolean;
  readyForFinalReview: boolean;
  activeCorrectionCount: number;
  confirmedCount: number;
  totalCount: number;
  fields: Array<UciPackageFieldResult & { reviewStatus: UciPackageReviewItemStatus; snapshot: Record<string, unknown> }>;
  documents: Array<UciApplicationPackageDocument & { reviewStatus: UciPackageReviewItemStatus; snapshot: Record<string, unknown> }>;
} {
  const review = metadata?.package_review;
  const fields = (metadata?.field_results ?? []).map((field) => {
    const snapshot = fieldMappingSnapshot(field);
    return {
      ...field,
      snapshot,
      reviewStatus: getPackageReviewItemStatus(review, "field", field.key, snapshot),
    };
  });
  const reviewedDocuments = documents.map((document) => {
    const snapshot = documentMappingSnapshot(document);
    return {
      ...document,
      snapshot,
      reviewStatus: getPackageReviewItemStatus(review, "document", document.key, snapshot),
    };
  });
  const items = [...fields, ...reviewedDocuments];
  const allConfirmed =
    items.length > 0 &&
    metadata?.package_status === "ready_for_review" &&
    fields.every((item) => item.status === "present" && item.reviewStatus === "confirmed") &&
    reviewedDocuments.every(
      (item) => isDocumentMappingReady(item) && item.reviewStatus === "confirmed",
    );
  const activeCorrectionCount = items.filter(
    (item) =>
      item.reviewStatus === "needs_correction" ||
      item.reviewStatus === "ready_for_re_review",
  ).length;
  const status: UciPackageReviewStatus =
    draftStatus === "reviewed" && Boolean(review?.reviewed_snapshot)
      ? "reviewed"
      : activeCorrectionCount > 0
        ? "needs_changes"
        : metadata?.package_status === "ready_for_review"
          ? "ready_for_review"
          : "draft";
  return {
    status,
    allConfirmed,
    readyForFinalReview: allConfirmed && activeCorrectionCount === 0,
    activeCorrectionCount,
    confirmedCount: items.filter((item) => item.reviewStatus === "confirmed").length,
    totalCount: items.length,
    fields,
    documents: reviewedDocuments,
  };
}

export function formatPackageReviewStatus(status: UciPackageReviewStatus): string {
  if (status === "ready_for_review") return "Ready for review";
  if (status === "needs_changes") return "Needs changes";
  if (status === "reviewed") return "Reviewed";
  return "Draft";
}

export function formatPackageReviewItemStatus(status: UciPackageReviewItemStatus): string {
  if (status === "confirmed") return "Confirmed";
  if (status === "needs_correction") return "Needs correction";
  if (status === "ready_for_re_review") return "Ready for re-review";
  return "Not reviewed";
}

export function getPackageValidationStatus(
  metadata: UciApplicationPackageMetadata | null | undefined,
  validation: Record<string, unknown> | null | undefined,
): UciPackageValidationStatus {
  if (
    metadata?.package_status === "blocked" ||
    metadata?.package_status === "incomplete" ||
    validation?.ok === false
  ) {
    return "found_blockers";
  }
  if (validation?.ok === true) return "passed";
  return "not_run";
}

export function formatPackageValidationStatus(status: UciPackageValidationStatus): string {
  if (status === "passed") return "Passed";
  if (status === "found_blockers") return "Found blockers";
  return "Not run";
}

export function formatPackageMappedValue(value: unknown): string {
  if (value == null || value === "") return "Not mapped";
  if (typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (record.value != null) {
      return `${String(record.value)}${record.unit ? ` ${String(record.unit)}` : ""}`;
    }
    return Object.entries(record)
      .map(([key, nested]) => {
        if (nested && typeof nested === "object" && !Array.isArray(nested)) {
          const item = nested as Record<string, unknown>;
          return `${key.replace(/_/g, " ")}: ${String(item.value ?? "—")}${item.unit ? ` ${String(item.unit)}` : ""}`;
        }
        return `${key.replace(/_/g, " ")}: ${String(nested)}`;
      })
      .join("; ");
  }
  return String(value);
}

export function formatPackageFieldProvenance(field: UciPackageFieldResult): string {
  const source = field.source ?? "";
  if (source.startsWith("project.")) return "Project record";
  if (!source.startsWith("load_summary.verified_values")) {
    return "Package source";
  }

  const value =
    field.value && typeof field.value === "object" && !Array.isArray(field.value)
      ? (field.value as Record<string, unknown>)
      : {};
  const evidenceSources = Array.isArray(value.evidence_sources)
    ? value.evidence_sources.filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
      )
    : [];
  const primaryEvidence = evidenceSources[0];
  const documentName = String(
    primaryEvidence?.source_document_name ?? value.source_document_name ?? "",
  ).trim();
  const pageValue = primaryEvidence?.page_number ?? value.page_number;
  const page =
    typeof pageValue === "number" || (typeof pageValue === "string" && pageValue.trim())
      ? ` · page ${String(pageValue)}`
      : "";
  return `Load Profile Analyzer — Verified Input${documentName ? ` · ${documentName}` : ""}${page}`;
}

export const APPLICATION_PACKAGE_IDEMPOTENCY_PREFIX = "agent_3_application_package:";

export function getApplicationPackageDraftApplication(
  applications: CoordinationApplication[] | null | undefined,
): CoordinationApplication | null {
  if (!applications?.length) return null;
  return (
    applications.find(
      (app) =>
        app.record_source === "agent_draft" &&
        String(app.idempotency_key || "").startsWith(APPLICATION_PACKAGE_IDEMPOTENCY_PREFIX),
    ) ?? null
  );
}

export function parseApplicationPackageMetadata(
  application: CoordinationApplication | null | undefined,
): UciApplicationPackageMetadata | null {
  const raw = application?.agent_draft_metadata?.application_package;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as UciApplicationPackageMetadata;
}

export function parsePackageDocuments(value: unknown): UciApplicationPackageDocument[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => {
      const rec = item as Record<string, unknown>;
      return {
        key: String(rec.key ?? ""),
        label: rec.label != null ? String(rec.label) : undefined,
        status: rec.status === "attached" ? "attached" : "missing",
        project_document_id:
          rec.project_document_id != null ? String(rec.project_document_id) : null,
        document_type: rec.document_type != null ? String(rec.document_type) : null,
        file_name: rec.file_name != null ? String(rec.file_name) : null,
        source: rec.source != null ? String(rec.source) : undefined,
        user_confirmed: rec.user_confirmed === true,
        pepco_document_name:
          rec.pepco_document_name != null ? String(rec.pepco_document_name) : null,
        storage_bucket: rec.storage_bucket != null ? String(rec.storage_bucket) : null,
        storage_path: rec.storage_path != null ? String(rec.storage_path) : null,
        content_hash: rec.content_hash != null ? String(rec.content_hash) : null,
        idempotency_key: rec.idempotency_key != null ? String(rec.idempotency_key) : null,
        external_application_id:
          rec.external_application_id != null ? String(rec.external_application_id) : null,
        confirmed_by: rec.confirmed_by != null ? String(rec.confirmed_by) : null,
        confirmed_at: rec.confirmed_at != null ? String(rec.confirmed_at) : null,
        signature_required: rec.signature_required === true,
        signature_status:
          rec.signature_status === "unsigned" ||
          rec.signature_status === "signed_manual_verified"
            ? rec.signature_status
            : rec.signature_required === true
              ? "unknown"
              : undefined,
        signature_verified_by:
          rec.signature_verified_by != null ? String(rec.signature_verified_by) : null,
        signature_verified_at:
          rec.signature_verified_at != null ? String(rec.signature_verified_at) : null,
        signature_review_note:
          rec.signature_review_note != null ? String(rec.signature_review_note) : null,
      };
    })
    .filter((doc) => doc.key);
}

export function formatApplicationPackageStatus(status: string | undefined): string {
  switch (status) {
    case "blocked":
      return "Blocked";
    case "incomplete":
      return "Incomplete — missing items";
    case "ready_for_review":
      return "Ready for human review";
    default:
      return status || "Not prepared";
  }
}

export function applicationPackageStatusTone(
  status: string | undefined,
): "neutral" | "warning" | "blocked" | "info" {
  if (status === "blocked") return "blocked";
  if (status === "incomplete") return "warning";
  if (status === "ready_for_review") return "info";
  return "neutral";
}

export function canSubmitApplication(draftStatus: DraftStatus | undefined): boolean {
  return draftStatus === "reviewed";
}

export function formatPackageDocumentSource(source: string | undefined): string {
  if (source === "pepco_portal") return "PEPCO portal";
  if (source === "project_documents") return "PermitPilot upload";
  return source?.replace(/_/g, " ") ?? "Unknown";
}

export function formatSuggestionConfidence(
  confidence: UciPackageDocumentCandidate["confidence"],
): string {
  if (!confidence) return "No suggestion";
  return `${confidence.charAt(0).toUpperCase()}${confidence.slice(1)} confidence (suggested only)`;
}

export function formatDraftStatus(status: DraftStatus | undefined): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "reviewed":
      return "Reviewed";
    case "needs_changes":
      return "Needs changes";
    case "submitted":
      return "Submitted";
    case "failed":
      return "Failed";
    default:
      return status || "Unknown";
  }
}

/** Starter manifest operators can edit before saving a manual provider template. */
export function buildManualApplicationTemplateStarter(params: {
  providerSlug: string;
  utilityType: string;
  applicationType?: string;
}): Record<string, unknown> {
  const providerSlug = String(params.providerSlug || "utility").trim().toLowerCase();
  const utilityType = String(params.utilityType || "electric").trim().toLowerCase();
  const applicationType = String(params.applicationType || "new_service").trim().toLowerCase();
  return {
    version: `manual-${providerSlug}-${utilityType}-v1`,
    provider_slug: providerSlug,
    utility_type: utilityType,
    application_type: applicationType,
    description: `Manual ${providerSlug} ${utilityType} application package template`,
    required_documents: [
      {
        key: "site_plan",
        label: "Site plan",
        aliases: ["site_plan", "civil_plan", "site", "plot_plan"],
      },
      {
        key: "single_line_diagram",
        label: "Single-line diagram",
        aliases: ["single_line", "single_line_diagram", "electrical_single_line", "one_line"],
      },
    ],
    required_fields: [
      {
        key: "project_address",
        label: "Project address",
        source: "project.address",
        required: true,
      },
      {
        key: "connected_load_data",
        label: "Connected load data",
        source: "load_summary.verified_values",
        required: true,
      },
    ],
  };
}

export function formatApplicationTemplateSource(source: string | null | undefined): string {
  switch (String(source || "").trim().toLowerCase()) {
    case "builtin":
      return "Built-in provider template";
    case "builtin_synthetic":
      return "Built-in synthetic checklist";
    case "manual_upload":
      return "Manual provider template";
    case "missing":
      return "No template configured";
    default:
      return source ? String(source) : "Unknown";
  }
}
