import { uciAuthenticatedFetch } from "@/lib/uciApi";

async function registryFetchJson<T>(
  path: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
  errorFallback: string,
): Promise<T> {
  const res = await uciAuthenticatedFetch(path, init);
  if (!res.ok) {
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = { message: text };
    }
    throw new Error(String(body.message || body.error || errorFallback));
  }
  return (await res.json()) as T;
}

export type UciDocumentRoleConfidence = "high" | "medium" | "low";
export type UciClassificationReview =
  | "auto_accepted"
  | "review_recommended"
  | "needs_classification";

export type UciDocumentProvenance =
  | "unknown"
  | "manual_upload"
  | "portal_harvest"
  | "email_inbound"
  | "uci_generated"
  | "loa_signed"
  | "stage_upload"
  | "load_profile"
  | "application_builder"
  | "reclassified";

export interface UciRegistryProjectDocument {
  id: string;
  project_id: string;
  document_type: string;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size?: number;
  description?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface UciDocumentRegistryEntry {
  id: string;
  project_document_id: string;
  coordination_record_id: string;
  detected_role: string | null;
  manual_role: string | null;
  effective_role: string | null;
  role_confidence: UciDocumentRoleConfidence;
  classification_review: UciClassificationReview;
  provenance: UciDocumentProvenance;
  signature_status: string | null;
  stage_consumers: number[];
  provider_slot_keys: string[];
  project_document: UciRegistryProjectDocument | null;
  metadata?: Record<string, unknown>;
  classified_at?: string | null;
  role_overridden_at?: string | null;
}

export interface UciDocumentRegistryResponse {
  coordination_record_id: string;
  project_id: string;
  documents: UciDocumentRegistryEntry[];
  needs_review: UciDocumentRegistryEntry[];
  total_count: number;
}

export interface UciProviderRequirementSlot {
  key: string;
  label: string;
  aliases: string[];
  signature_required: boolean;
  signature_status: string | null;
  ready: boolean;
  matched_project_document_id: string | null;
  matched_file_name: string | null;
  matched_effective_role: string | null;
  matched_confidence: string | null;
}

export interface UciProviderRequirementsResponse {
  coordination_record_id: string;
  provider_slug: string | null;
  template_version: string | null;
  readiness: {
    ready_count: number;
    total_count: number;
    label: string;
    complete: boolean;
  };
  missing_slots: string[];
  signature_required_slots: string[];
  slots: UciProviderRequirementSlot[];
}

export const UCI_DOCUMENT_ROLES = [
  "load_letter",
  "load_calculation_worksheet",
  "single_line_diagram",
  "equipment_schedule",
  "construction_schedule",
  "equipment_cut_sheet",
  "site_plan",
  "letter_of_authorization",
  "class_of_service",
  "ciac",
  "equipment_evidence",
  "meter_regulator",
  "closeout",
  "panel_schedule",
  "electrical_plan",
  "comcheck",
  "service_plan",
  "correspondence",
  "supporting_document",
  "other",
] as const;

export function formatDocumentRoleLabel(role: string | null | undefined): string {
  if (!role) return "Unclassified";
  return role
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function classificationReviewTone(
  review: UciClassificationReview,
): "default" | "secondary" | "destructive" | "outline" {
  if (review === "auto_accepted") return "default";
  if (review === "review_recommended") return "secondary";
  return "destructive";
}

export function confidenceTone(
  confidence: UciDocumentRoleConfidence,
): "default" | "secondary" | "outline" {
  if (confidence === "high") return "default";
  if (confidence === "medium") return "secondary";
  return "outline";
}

export async function getCoordinationDocumentRegistry(
  coordinationId: string,
): Promise<UciDocumentRegistryResponse> {
  return registryFetchJson(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/document-registry`,
    {},
    "Failed to load document registry",
  );
}

export async function syncCoordinationDocumentRegistry(
  coordinationId: string,
): Promise<{ coordination_record_id: string; entries: UciDocumentRegistryEntry[]; total_count: number }> {
  return registryFetchJson(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/document-registry/sync`,
    { method: "POST" },
    "Failed to sync document registry",
  );
}

export async function overrideCoordinationDocumentRole(
  coordinationId: string,
  projectDocumentId: string,
  payload: { manual_role: string; note?: string },
): Promise<UciDocumentRegistryEntry> {
  return registryFetchJson(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/document-registry/${encodeURIComponent(projectDocumentId)}/role`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "Failed to update document classification",
  );
}

export async function registerCoordinationDocument(
  coordinationId: string,
  payload: {
    project_document_id: string;
    provenance?: string;
    hint_role?: string;
  },
): Promise<UciDocumentRegistryEntry> {
  return registryFetchJson(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/document-registry/register`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "Failed to register document",
  );
}

export async function getCoordinationProviderRequirements(
  coordinationId: string,
): Promise<UciProviderRequirementsResponse> {
  return registryFetchJson(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/document-registry/provider-requirements`,
    {},
    "Failed to load provider requirements",
  );
}

export async function setApplicationPackageSignatureStatus(
  applicationId: string,
  payload: {
    document_key: string;
    signature_status: "unknown" | "unsigned" | "signed_manual_verified";
    review_note?: string;
  },
): Promise<{
  application: import("@/types/uci").CoordinationApplication;
  package_status: string;
  document_key: string;
  signature_status: string;
}> {
  return registryFetchJson(
    `/api/uci/applications/${encodeURIComponent(applicationId)}/package-documents/signature`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "Failed to update signature status",
  );
}
