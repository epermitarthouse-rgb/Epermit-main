/**
 * Deterministic normalization of raw per-sheet LLM observations before synthesis.
 * Raw model status labels are hints — final conflict requires validated contradiction.
 */

import { evidencePolarity } from "./evidencePolarity";
import { referencesRevisionDocument } from "./revisionReference";
import { isEvidenceStatus, type EvidenceSource, type EvidenceStatus } from "./model";

export interface NormalizableObservation {
  status: EvidenceStatus | string;
  source?: EvidenceSource | null;
  note?: string | null;
  relevant?: boolean | null;
}

const GENERIC_PER_SHEET_NOT_FOUND = /^no evidence for this measure on this sheet\.?$/i;

const EXPLICIT_CONTRADICTION =
  /\b(conflict(?:s|ing)?|contradict(?:s|ion|ory)?|disagree(?:s|ment)?|inconsistent|does not match|differs from)\b/i;

const INCOMPLETE_EVIDENCE =
  /\b(cannot (?:determine|verify|confirm)|unclear|insufficient|unable to (?:determine|verify)|not enough (?:information|evidence)|cannot assess)\b/i;

export function normalizeEvidenceStatus(raw: string | null | undefined): EvidenceStatus {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (value === "verified_in_submitted_documents" || value === "supported") return "verified";
  if (value === "partial" || value === "partially_supported") return "partially_supported";
  if (value === "not_found_in_submitted_documents" || value === "missing") return "not_found";
  if (value === "conflicting_information" || value === "conflict") return "conflicting";
  if (
    value === "requires_professional_dob_review" ||
    value === "requires_professional_/_dob_review" ||
    value === "manual_review"
  ) {
    return "requires_professional_dob_review";
  }
  return isEvidenceStatus(value) ? value : "requires_professional_dob_review";
}

export function observationText(observation: NormalizableObservation): string {
  return [observation.source?.excerpt, observation.note].filter(Boolean).join(" ").trim();
}

/** Excerpt-first text for status validation — avoids model note labels triggering false contradictions. */
export function evidenceTextForValidation(observation: NormalizableObservation): string {
  const excerpt = String(observation.source?.excerpt ?? "").trim();
  if (excerpt) return excerpt;
  return String(observation.note ?? "").trim();
}

function isGenericPerSheetNotFound(text: string): boolean {
  return GENERIC_PER_SHEET_NOT_FOUND.test(text.trim());
}

function hasExplicitContradictionLanguage(text: string): boolean {
  return EXPLICIT_CONTRADICTION.test(text);
}

function isIncompleteEvidenceLanguage(text: string): boolean {
  return INCOMPLETE_EVIDENCE.test(text);
}

function supportingStatusFromPolarity(polarity: ReturnType<typeof evidencePolarity>): EvidenceStatus {
  return polarity === "positive" ? "verified" : "partially_supported";
}

/**
 * Reclassify a raw model status using excerpt/note polarity and deferral semantics.
 * Absence on one sheet ≠ contradiction; model `conflicting` is downgraded unless validated.
 */
export function validateModelStatusAgainstEvidence(
  observation: NormalizableObservation,
  options?: { measureText?: string },
): EvidenceStatus {
  void options?.measureText;
  const status = normalizeEvidenceStatus(observation.status);
  const text = evidenceTextForValidation(observation);
  const polarity = evidencePolarity(text);

  if (status === "requires_professional_dob_review") {
    if (polarity === "positive") return "verified";
    if (polarity === "negative" || isIncompleteEvidenceLanguage(text)) {
      return "not_found";
    }
    return status;
  }

  if (status === "conflicting") {
    if (!text || isGenericPerSheetNotFound(text)) return "not_found";
    if (isIncompleteEvidenceLanguage(text)) return "not_found";
    if (referencesRevisionDocument(text)) {
      return polarity === "positive" ? "verified" : "partially_supported";
    }
    if (hasExplicitContradictionLanguage(text)) return "conflicting";
    if (polarity === "positive") return "verified";
    if (polarity === "negative") return "not_found";
    if (/\d/.test(text)) return "verified";
    return "not_found";
  }

  if (status === "verified" || status === "partially_supported") {
    if (!text) return "not_found";
    if (isGenericPerSheetNotFound(text)) return "not_found";
    if (polarity === "negative" && !referencesRevisionDocument(text)) return "not_found";
    if (polarity === "positive") return "verified";
    if (referencesRevisionDocument(text)) return "partially_supported";
    return status;
  }

  if (status === "not_found") {
    if (polarity === "positive" && text && !isGenericPerSheetNotFound(text)) return "verified";
    return "not_found";
  }

  return status;
}

export function normalizeRawObservation(
  observation: NormalizableObservation,
  measureText: string,
): NormalizableObservation {
  const status = validateModelStatusAgainstEvidence(observation, { measureText });
  if (status === observation.status) return observation;
  return { ...observation, status };
}

export function normalizeRawObservations<T extends NormalizableObservation>(
  observations: T[],
  measureText: string,
): T[] {
  return observations.map((observation) => ({
    ...observation,
    status: validateModelStatusAgainstEvidence(observation, { measureText }),
  }));
}

export function hasValidatedModelConflict(observation: NormalizableObservation): boolean {
  const text = evidenceTextForValidation(observation);
  if (observation.status !== "conflicting") return false;
  if (!text) return false;
  return hasExplicitContradictionLanguage(text);
}
