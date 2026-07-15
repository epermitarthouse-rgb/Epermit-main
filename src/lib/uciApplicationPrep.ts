/** Parse and display helpers for D3 application package drafts. */

import type { CoordinationApplication, DraftStatus } from "@/types/uci";

export type UciApplicationPackageStatus = "blocked" | "incomplete" | "ready_for_review";

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

export interface UciApplicationPackageMetadata {
  version?: string;
  template_id?: string | null;
  package_status?: UciApplicationPackageStatus;
  missing_documents?: string[];
  missing_fields?: string[];
  load_profile_analysis_status?: string | null;
  requires_human_review?: boolean;
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
