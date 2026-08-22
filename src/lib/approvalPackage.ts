/**
 * Normalizes persisted approval_package JSON into the shape expected by Review UI cards.
 * Backend agents may store alternate field names (e.g. document `name` vs `document_name`).
 */

export interface LicenseWarningObject {
  professional_name?: string;
  license_type?: string;
  license_number?: string;
  role_on_project?: string;
  status?: string;
  issue?: string;
}

export interface NormalizedLicenseValidation {
  all_active?: boolean;
  hard_stop?: boolean;
  hard_stop_reason?: string;
  warnings?: string[];
  results?: Array<Record<string, unknown>>;
  error?: string;
}

export interface NormalizedDocumentPreparation {
  total_documents?: number;
  valid_count?: number;
  invalid_count?: number;
  missing_count?: number;
  deficiencies?: string[];
  checklist_results?: Array<{ item?: string; status?: string; note?: string }>;
  eif_status?: string;
  documents?: Array<{
    document_name?: string;
    document_type?: string;
    validation_status?: string;
    validation_notes?: string;
    file_format?: string;
    file_size_bytes?: number;
    upload_order?: number;
  }>;
  error?: string;
}

export interface NormalizedApprovalPackage {
  assembled_at?: string;
  property_intelligence?: Record<string, unknown> | null;
  license_validation?: NormalizedLicenseValidation | null;
  document_preparation?: NormalizedDocumentPreparation | null;
  permit_classification?: Record<string, unknown> | null;
  agent_summary?: Array<{ agent_name: string; status: string; error?: string | null; duration_ms: number }>;
  escalation_required?: boolean;
  hard_stop?: boolean;
  all_agents_succeeded?: boolean;
}

export function formatLicenseWarning(warning: unknown): string {
  if (typeof warning === "string") return warning;
  if (warning && typeof warning === "object") {
    const w = warning as LicenseWarningObject;
    const parts = [
      w.professional_name,
      w.role_on_project,
      w.license_type && w.license_number ? `${w.license_type} #${w.license_number}` : w.license_number,
      w.issue || (w.status ? `License is ${w.status}` : undefined),
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : "License validation warning";
  }
  return String(warning);
}

function normalizeLicenseValidation(raw: unknown): NormalizedLicenseValidation | null {
  if (raw == null) return null;
  if (typeof raw !== "object") return null;
  const lv = raw as Record<string, unknown>;
  if (typeof lv.error === "string") {
    return { error: lv.error };
  }
  return {
    all_active: lv.all_active as boolean | undefined,
    hard_stop: lv.hard_stop as boolean | undefined,
    hard_stop_reason: lv.hard_stop_reason as string | undefined,
    warnings: Array.isArray(lv.warnings) ? lv.warnings.map(formatLicenseWarning) : [],
    results: Array.isArray(lv.results) ? (lv.results as Array<Record<string, unknown>>) : [],
  };
}

function normalizeDocument(raw: unknown) {
  if (!raw || typeof raw !== "object") return {};
  const d = raw as Record<string, unknown>;
  return {
    document_name: (d.document_name ?? d.name) as string | undefined,
    document_type: (d.document_type ?? d.type) as string | undefined,
    validation_status: (d.validation_status ?? d.status) as string | undefined,
    validation_notes: (d.validation_notes ?? d.notes) as string | undefined,
    file_format: (d.file_format ?? d.format) as string | undefined,
    file_size_bytes: d.file_size_bytes as number | undefined,
    upload_order: (d.upload_order ?? d.order) as number | undefined,
  };
}

function normalizeChecklistItem(raw: unknown) {
  if (!raw || typeof raw !== "object") return {};
  const item = raw as Record<string, unknown>;
  const found = item.found;
  let status = item.status as string | undefined;
  if (!status && found === true) status = "pass";
  if (!status && found === false) status = "fail";
  return {
    item: (item.item ?? item.label) as string | undefined,
    status,
    note: (item.note ?? item.document_name) as string | undefined,
  };
}

function normalizeDocumentPreparation(raw: unknown): NormalizedDocumentPreparation | null {
  if (raw == null) return null;
  if (typeof raw !== "object") return null;
  const dp = raw as Record<string, unknown>;
  if (typeof dp.error === "string") {
    return { error: dp.error };
  }
  return {
    total_documents: dp.total_documents as number | undefined,
    valid_count: dp.valid_count as number | undefined,
    invalid_count: dp.invalid_count as number | undefined,
    missing_count: dp.missing_count as number | undefined,
    deficiencies: Array.isArray(dp.deficiencies) ? (dp.deficiencies as string[]) : [],
    checklist_results: Array.isArray(dp.checklist_results)
      ? dp.checklist_results.map(normalizeChecklistItem)
      : [],
    eif_status: dp.eif_status as string | undefined,
    documents: Array.isArray(dp.documents) ? dp.documents.map(normalizeDocument) : [],
  };
}

function normalizePropertyIntelligence(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw !== "object") return null;
  return raw as Record<string, unknown>;
}

function normalizePermitClassification(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw !== "object") return null;
  return raw as Record<string, unknown>;
}

export function normalizeApprovalPackage(raw: unknown): NormalizedApprovalPackage | null {
  if (raw == null) return null;
  if (typeof raw !== "object") return null;
  const pkg = raw as Record<string, unknown>;
  return {
    assembled_at: pkg.assembled_at as string | undefined,
    property_intelligence: normalizePropertyIntelligence(pkg.property_intelligence),
    license_validation: normalizeLicenseValidation(pkg.license_validation),
    document_preparation: normalizeDocumentPreparation(pkg.document_preparation),
    permit_classification: normalizePermitClassification(pkg.permit_classification),
    agent_summary: Array.isArray(pkg.agent_summary)
      ? (pkg.agent_summary as NormalizedApprovalPackage["agent_summary"])
      : undefined,
    escalation_required: pkg.escalation_required as boolean | undefined,
    hard_stop: pkg.hard_stop as boolean | undefined,
    all_agents_succeeded: pkg.all_agents_succeeded as boolean | undefined,
  };
}

export function getPropertyIntelligenceError(
  propertyIntelligence: Record<string, unknown> | null | undefined,
): string | null {
  if (!propertyIntelligence) return null;
  return typeof propertyIntelligence.error === "string" ? propertyIntelligence.error : null;
}
