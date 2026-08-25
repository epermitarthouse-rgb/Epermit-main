"use strict";

const { evidencePolarity } = require("./code-mod-evidence-polarity.js");
const { referencesRevisionDocument } = require("./code-mod-revision-reference.js");

const EVIDENCE_STATUSES = new Set([
  "verified",
  "partially_supported",
  "not_found",
  "conflicting",
  "requires_professional_dob_review",
]);

const GENERIC_PER_SHEET_NOT_FOUND = /^no evidence for this measure on this sheet\.?$/i;

const EXPLICIT_CONTRADICTION =
  /\b(conflict(?:s|ing)?|contradict(?:s|ion|ory)?|disagree(?:s|ment)?|inconsistent|does not match|differs from)\b/i;

const INCOMPLETE_EVIDENCE =
  /\b(cannot (?:determine|verify|confirm)|unclear|insufficient|unable to (?:determine|verify)|not enough (?:information|evidence)|cannot assess)\b/i;

function normalizeEvidenceStatus(raw) {
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
  return EVIDENCE_STATUSES.has(value) ? value : "requires_professional_dob_review";
}

function observationText(observation) {
  return [observation.source && observation.source.excerpt, observation.note].filter(Boolean).join(" ").trim();
}

function evidenceTextForValidation(observation) {
  const excerpt = String((observation.source && observation.source.excerpt) || "").trim();
  if (excerpt) return excerpt;
  return String(observation.note || "").trim();
}

function isGenericPerSheetNotFound(text) {
  return GENERIC_PER_SHEET_NOT_FOUND.test(text.trim());
}

function hasExplicitContradictionLanguage(text) {
  return EXPLICIT_CONTRADICTION.test(text);
}

function isIncompleteEvidenceLanguage(text) {
  return INCOMPLETE_EVIDENCE.test(text);
}

function validateModelStatusAgainstEvidence(observation) {
  const status = normalizeEvidenceStatus(observation.status);
  const text = evidenceTextForValidation(observation);
  const polarity = evidencePolarity(text);

  if (status === "requires_professional_dob_review") {
    if (polarity === "positive") return "verified";
    if (polarity === "negative" || isIncompleteEvidenceLanguage(text)) return "not_found";
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

function normalizeRawObservations(observations, measureText) {
  void measureText;
  return observations.map((observation) => ({
    ...observation,
    status: validateModelStatusAgainstEvidence(observation),
  }));
}

function hasValidatedModelConflict(observation) {
  const text = evidenceTextForValidation(observation);
  if (observation.status !== "conflicting") return false;
  if (!text) return false;
  return hasExplicitContradictionLanguage(text);
}

module.exports = {
  normalizeEvidenceStatus,
  validateModelStatusAgainstEvidence,
  normalizeRawObservations,
  hasValidatedModelConflict,
  observationText,
};
