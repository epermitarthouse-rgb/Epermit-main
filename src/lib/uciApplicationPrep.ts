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
