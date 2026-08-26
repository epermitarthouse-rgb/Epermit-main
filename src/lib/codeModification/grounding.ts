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
import type { NormalizableObservation } from "./rawObservationNormalization";

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

function expandLabelVariants(value: string | null | undefined): string[] {
  const normalized = normalizeRef(value);
  if (!normalized) return [];
  const variants = new Set<string>([normalized]);
  if (normalized.endsWith(".pdf")) {
    variants.add(normalized.replace(/\.pdf$/, ""));
  } else {
    variants.add(`${normalized}.pdf`);
  }
  return [...variants];
}

function labelsMatchForRef(
  source: NonNullable<EvidenceFinding["source"]>,
  ref: AllowedEvidenceRef,
): boolean {
  const sourceLabels = new Set([
    ...expandLabelVariants(source.sheetLabel),
    ...expandLabelVariants(source.fileName),
  ]);
  const refLabels = new Set([
    ...expandLabelVariants(ref.sheetLabel),
    ...expandLabelVariants(ref.fileName),
  ]);
  const matchingLabel = [...sourceLabels].some((label) => refLabels.has(label));
  if (!matchingLabel) return false;
  if (source.pageNumber == null || ref.pageNumber == null) return true;
  return source.pageNumber === ref.pageNumber;
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
    if (labelsMatchForRef(source, ref)) return true;
    if (
      source.pageNumber != null &&
      ref.pageNumber === source.pageNumber &&
      !source.sheetId &&
      !source.documentId &&
      !source.sheetLabel &&
      !source.fileName
    ) {
      return true;
    }
    return false;
  });
}

function filterObservationsForGrounding(
  observations: NormalizableObservation[] | undefined,
  allowed: AllowedEvidenceRef[],
): NormalizableObservation[] | undefined {
  if (!observations?.length) return observations;
  const filtered = observations.filter((observation) => {
    if (!sourceHasSheetOrPage(observation.source)) return true;
    return sourceIsAllowed(observation.source, allowed);
  });
  return filtered.length > 0 ? filtered : undefined;
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
  return isEvidenceStatus(raw) ? raw : "not_found";
}

/**
 * A supported finding without an allowed sheet/page becomes not_found.
 * Conflicting without a source becomes requires_professional_dob_review.
 * Preserves internal observations for downstream final invariants.
 */
export function validateAndGroundFindings(
  findings: Array<
    EvidenceFinding & {
      observations?: NormalizableObservation[];
    }
  >,
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
    const observations = filterObservationsForGrounding(finding.observations, allowed);

    const applyObservations = (result: EvidenceFinding): EvidenceFinding =>
      observations && observations.length > 0 ? { ...result, observations } : result;

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
          note: "Not found in submitted documents. The cited sheet/page is missing or not in the drawing set.",
        };
      }
      return applyObservations(grounded);
    }

    if (status === "conflicting" && !allowedSource) {
      return {
        ...grounded,
        status: "requires_professional_dob_review",
        source: sourceHasSheetOrPage(source) ? null : source,
        note: "Conflicting information was claimed without a submitted source and requires professional / DOB review.",
      };
    }

    return applyObservations(grounded);
  });
}

export { computeOverallStatus };
