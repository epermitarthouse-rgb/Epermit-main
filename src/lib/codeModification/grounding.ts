/**
 * Ground Code Modification findings to submitted sheets/pages only.
 * Unknown sheet references are rejected; approval claims are stripped.
 */

import {
  computeOverallStatus,
  isEvidenceStatus,
  type AllowedEvidenceRef,
  type EvidenceFinding,
  type EvidenceStatus,
} from "./model";

const APPROVAL_CLAIM =
  /\b(?:dob|department of buildings)\s+(?:has\s+)?(?:approved|rejected)\b|\b(?:officially|formally)\s+approved\b|\bapproval\s+(?:granted|issued|probability)\b|\bdob approved\b|\bdob rejected\b/gi;

export function stripApprovalClaims(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(APPROVAL_CLAIM, "requires professional / DOB review")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeRef(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function sourceHasSheetOrPage(
  source: EvidenceFinding["source"] | null | undefined,
): boolean {
  if (!source) return false;
  if (typeof source.pageNumber === "number" && Number.isFinite(source.pageNumber)) {
    return true;
  }
  return Boolean(source.sheetId || source.sheetLabel || source.fileName || source.documentId);
}

export function sourceIsAllowed(
  source: EvidenceFinding["source"] | null | undefined,
  allowed: AllowedEvidenceRef[],
): boolean {
  if (!sourceHasSheetOrPage(source) || !source) return false;
  if (!allowed.length) return false;

  return allowed.some((ref) => {
    if (source.sheetId && ref.sheetId && source.sheetId === ref.sheetId) return true;
    if (
      source.documentId &&
      ref.documentId &&
      source.documentId === ref.documentId &&
      (source.pageNumber == null ||
        ref.pageNumber == null ||
        source.pageNumber === ref.pageNumber)
    ) {
      return true;
    }
    const sourceLabel = normalizeRef(source.sheetLabel || source.fileName);
    const refLabel = normalizeRef(ref.sheetLabel || ref.fileName);
    if (sourceLabel && refLabel && sourceLabel === refLabel) {
      if (source.pageNumber == null || ref.pageNumber == null) return true;
      return source.pageNumber === ref.pageNumber;
    }
    if (
      source.pageNumber != null &&
      ref.pageNumber === source.pageNumber &&
      !source.sheetId &&
      !source.documentId &&
      !sourceLabel
    ) {
      return true;
    }
    return false;
  });
}

function normalizeStatus(status: string | null | undefined): EvidenceStatus {
  const raw = (status ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  if (raw === "verified_in_submitted_documents" || raw === "supported") return "verified";
  if (raw === "partial" || raw === "partially_supported") return "partially_supported";
  if (raw === "not_found_in_submitted_documents" || raw === "missing") return "not_found";
  if (raw === "conflicting_information" || raw === "conflict") return "conflicting";
  if (
    raw === "requires_professional_dob_review" ||
    raw === "requires_professional_/_dob_review" ||
    raw === "manual_review"
  ) {
    return "requires_professional_dob_review";
  }
  return isEvidenceStatus(raw) ? raw : "requires_professional_dob_review";
}

/**
 * A supported finding without an allowed sheet/page becomes not_found.
 * Conflicting without a source becomes requires_professional_dob_review.
 */
export function validateAndGroundFindings(
  findings: EvidenceFinding[],
  allowed: AllowedEvidenceRef[],
): EvidenceFinding[] {
  return findings.map((finding, index) => {
    const status = normalizeStatus(finding.status);
    const note = stripApprovalClaims(finding.note);
    const excerpt = stripApprovalClaims(finding.source?.excerpt ?? "");
    const source = finding.source
      ? { ...finding.source, excerpt: excerpt || finding.source.excerpt || null }
      : null;
    const allowedSource = sourceIsAllowed(source, allowed);
    const grounded: EvidenceFinding = {
      id: finding.id || `finding-${index + 1}`,
      measureId: finding.measureId ?? null,
      measure: finding.measure || "Unnamed measure",
      status,
      source: source,
      note: note || null,
    };

    if (status === "verified" || status === "partially_supported") {
      if (!allowedSource) {
        return {
          ...grounded,
          status: "not_found",
          source: null,
          note: note
            ? `${note} Evidence was not grounded to a submitted sheet or page.`
            : "Not found in submitted documents. The cited sheet/page is missing or not in the drawing set.",
        };
      }
      return grounded;
    }

    if (status === "conflicting" && !allowedSource) {
      return {
        ...grounded,
        status: "requires_professional_dob_review",
        source: sourceHasSheetOrPage(source) ? null : source,
        note: note
          ? `${note} Conflict could not be grounded to a submitted source.`
          : "Conflicting information was claimed without a submitted source and requires professional / DOB review.",
      };
    }

    return grounded;
  });
}

export { computeOverallStatus };
