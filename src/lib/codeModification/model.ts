/**
 * DC Construction Code Modification Review model (Phase 2).
 * Evidence review is distinct from standard compliance findings.
 */

import {
  ANALYSIS_TYPE_DC_MODIFICATION,
  ANALYSIS_TYPE_STANDARD,
  computeSheetFingerprint,
  fingerprintsMatch,
  shouldMarkAnalysisStale,
  type CodeAnalyzerRunStatus,
  type CodeAnalyzerSheetInput,
} from "@/lib/codeAnalyzer/model";

export { ANALYSIS_TYPE_DC_MODIFICATION, ANALYSIS_TYPE_STANDARD };

export const EVIDENCE_STATUSES = [
  "verified",
  "partially_supported",
  "not_found",
  "conflicting",
  "requires_professional_dob_review",
] as const;

export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export const OVERALL_STATUSES = [
  "evidence_appears_complete",
  "evidence_partially_supported",
  "material_evidence_missing",
  "manual_review_required",
] as const;

export type OverallStatus = (typeof OVERALL_STATUSES)[number];

export const OVERALL_STATUS_LABELS: Record<OverallStatus, string> = {
  evidence_appears_complete: "Evidence appears complete",
  evidence_partially_supported: "Evidence partially supported",
  material_evidence_missing: "Material evidence missing",
  manual_review_required: "Manual review required",
};

export const EVIDENCE_STATUS_LABELS: Record<EvidenceStatus, string> = {
  verified: "Verified in submitted documents",
  partially_supported: "Partially supported",
  not_found: "Not found in submitted documents",
  conflicting: "Conflicting information",
  requires_professional_dob_review: "Requires professional / DOB review",
};

export type FormPageRole = "applicant" | "reviewer" | "mixed" | "unknown";

export interface FormPage {
  pageNumber: number;
  text: string;
  role?: FormPageRole;
}

export interface CitedCodeSection {
  citation: string;
  year?: string | null;
  source: "applicant";
  label: "Applicant-cited code";
}

export interface ProposedMeasure {
  id: string;
  description: string;
  category?: string | null;
  /** Applicant form page the measure was extracted from, when known. */
  sourcePageNumber?: number | null;
  /** Short source snippet (section label or original blob prefix). */
  sourceContext?: string | null;
}

export interface ExtractedModificationRequest {
  projectAddress?: string | null;
  requestedModification: string;
  citedSections: CitedCodeSection[];
  impracticalReason?: string | null;
  compliesWithIntent?: boolean | null;
  proposedMeasures: ProposedMeasure[];
  floodHazardApplicable?: boolean | null;
  supportingNarrative?: string | null;
  extractionWarnings: string[];
}

export interface EvidenceSource {
  documentId?: string | null;
  fileName?: string | null;
  sheetId?: string | null;
  pageNumber?: number | null;
  sheetLabel?: string | null;
  excerpt?: string | null;
}

export interface EvidenceFinding {
  id: string;
  measureId?: string | null;
  measure: string;
  status: EvidenceStatus;
  source?: EvidenceSource | null;
  note?: string | null;
}

export interface CodeModificationReview {
  id?: string;
  run_id: string;
  project_id: string;
  /** Primary form document (legacy single-form reviews). */
  form_document_id: string;
  /** Full document set used for this review when available. */
  form_document_ids?: string[];
  form_fingerprint: string;
  extracted_request: ExtractedModificationRequest;
  evidence: EvidenceFinding[];
  overall_status: OverallStatus;
  extraction_warnings: string[];
  created_at?: string;
  updated_at?: string;
}

export interface AllowedEvidenceRef {
  documentId?: string | null;
  sheetId?: string | null;
  pageNumber?: number | null;
  fileName?: string | null;
  sheetLabel?: string | null;
}

export function emptyExtractedRequest(
  warnings: string[] = [],
): ExtractedModificationRequest {
  return {
    projectAddress: null,
    requestedModification: "",
    citedSections: [],
    impracticalReason: null,
    compliesWithIntent: null,
    proposedMeasures: [],
    floodHazardApplicable: null,
    supportingNarrative: null,
    extractionWarnings: warnings,
  };
}

export function computeFormFingerprint(input: {
  formDocumentId: string;
  updatedAt?: string | null;
  pageCount?: number | null;
}): string {
  return [input.formDocumentId, input.updatedAt ?? "", String(input.pageCount ?? "")].join("|");
}

export function computeFormsFingerprint(
  forms: Array<{
    formDocumentId: string;
    updatedAt?: string | null;
    pageCount?: number | null;
  }>,
): string {
  if (forms.length === 0) return "";
  if (forms.length === 1) return computeFormFingerprint(forms[0]!);
  return forms
    .slice()
    .sort((a, b) => a.formDocumentId.localeCompare(b.formDocumentId))
    .map((form) => computeFormFingerprint(form))
    .join("||");
}

export function formDocumentIdsMatch(
  reviewIds: string[] | null | undefined,
  currentIds: string[],
): boolean {
  const a = [...(reviewIds ?? [])].sort();
  const b = [...currentIds].sort();
  if (a.length !== b.length) return false;
  return a.every((id, index) => id === b[index]);
}

export function computeModificationSourceFingerprint(
  formFingerprint: string,
  sheetFingerprint: string,
): string {
  return `form:${formFingerprint}||sheets:${sheetFingerprint}`;
}

export function modificationSheetFingerprint(sheets: CodeAnalyzerSheetInput[]): string {
  return computeSheetFingerprint(sheets);
}

export function shouldMarkModificationReviewStale(input: {
  runStatus?: CodeAnalyzerRunStatus | null;
  runFingerprint?: string | null;
  currentFingerprint: string;
  formChanged?: boolean;
  pendingSourceCount?: number;
}): boolean {
  if (input.formChanged) return true;
  return shouldMarkAnalysisStale({
    runStatus: input.runStatus,
    runFingerprint: input.runFingerprint,
    currentFingerprint: input.currentFingerprint,
    pendingSourceCount: input.pendingSourceCount,
  });
}

export function formFingerprintsMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return fingerprintsMatch(a, b);
}

export function isOverallStatus(value: string | null | undefined): value is OverallStatus {
  return OVERALL_STATUSES.includes(value as OverallStatus);
}

export function isEvidenceStatus(value: string | null | undefined): value is EvidenceStatus {
  return EVIDENCE_STATUSES.includes(value as EvidenceStatus);
}

export function computeOverallStatus(findings: EvidenceFinding[]): OverallStatus {
  if (findings.length === 0) return "manual_review_required";
  const statuses = findings.map((f) => f.status);
  if (
    statuses.includes("conflicting") ||
    statuses.includes("requires_professional_dob_review")
  ) {
    return "manual_review_required";
  }
  if (statuses.includes("not_found")) return "material_evidence_missing";
  if (statuses.includes("partially_supported")) return "evidence_partially_supported";
  if (statuses.every((s) => s === "verified")) return "evidence_appears_complete";
  return "manual_review_required";
}
