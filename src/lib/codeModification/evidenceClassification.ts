/**
 * Normalized per-passage evidence classification for Code Mod synthesis.
 * SUPPORTS | CONTRADICTS | NOT_RELEVANT — silence and omission are never CONTRADICTS.
 */

import { excerptsContradict, evidencePolarity, isIncompleteEvidenceLanguage } from "./evidencePolarity";
import { materialValuesConflict } from "./materialValueConflict";
import {
  assessComponentCoverage,
  observationRelatesToMeasure,
  observationsShareComponent,
} from "./measureComponentCompleteness";
import { isRevisionResolutionPair, referencesRevisionDocument } from "./revisionReference";
import {
  evidenceTextForValidation,
  hasValidatedModelConflict,
  isAbsenceOrIncompleteLanguage,
  observationText,
  type NormalizableObservation,
} from "./rawObservationNormalization";
import type { EvidenceFinding, EvidenceStatus } from "./model";

export type PassageClassification = "SUPPORTS" | "CONTRADICTS" | "NOT_RELEVANT";

export const NOT_FOUND_NOTE = "No relevant evidence was found in the reviewed drawing set.";

const GENERIC_PER_SHEET_NOT_FOUND = /^no evidence for this measure on this sheet\.?$/i;

/** Absence scoped to a single sheet/plan/diagram — not a cross-set contradiction. */
const PER_SHEET_SCOPED_ABSENCE =
  /\b(?:no evidence(?:\s+(?:of|for|on))?|not shown|not indicated|not depicted|not mentioned|not provided)[\s\S]{0,96}\bon (?:this|the|that|[\w-]+(?:[-\s][\w-]+)*)\s+(?:sheet|plan|drawing|diagram)\b/i;

export function isPerSheetScopedAbsence(text: string | null | undefined): boolean {
  const normalized = String(text ?? "").trim();
  if (!normalized) return false;
  if (GENERIC_PER_SHEET_NOT_FOUND.test(normalized)) return true;
  return PER_SHEET_SCOPED_ABSENCE.test(normalized);
}

function isSupportingStatus(status: EvidenceStatus | string): boolean {
  return status === "verified" || status === "partially_supported";
}

function isGenericPerSheetNotFound(text: string): boolean {
  return GENERIC_PER_SHEET_NOT_FOUND.test(text.trim());
}

function isSubstantiveObservation(observation: NormalizableObservation): boolean {
  if (hasValidatedModelConflict(observation)) return true;
  if (observation.status === "requires_professional_dob_review") {
    return Boolean(observationText(observation));
  }
  if (isSupportingStatus(observation.status)) return Boolean(observationText(observation));
  return false;
}

/** True when observation text is measure-local and may affect synthesis. */
export function isObservationRelevant(
  observation: NormalizableObservation,
  measureText: string,
): boolean {
  if (typeof observation.relevant === "boolean") return observation.relevant;
  if (observation.status === "not_found") {
    const text = observationText(observation);
    if (!text || isGenericPerSheetNotFound(text)) return false;
    return false;
  }
  if (!isSubstantiveObservation(observation)) return false;
  return observationRelatesToMeasure(observationText(observation), measureText);
}

/**
 * Classify one normalized observation passage.
 * Absence, silence, unrelated sheets, and extraction uncertainty → NOT_RELEVANT.
 */
export function classifyObservationPassage(
  observation: NormalizableObservation,
  measureText: string,
): PassageClassification {
  if (!isObservationRelevant(observation, measureText)) return "NOT_RELEVANT";

  const validationText = evidenceTextForValidation(observation);
  const fullText = observationText(observation);

  if (!validationText && !fullText) return "NOT_RELEVANT";
  if (isGenericPerSheetNotFound(fullText)) return "NOT_RELEVANT";
  if (isPerSheetScopedAbsence(validationText) || isPerSheetScopedAbsence(fullText)) {
    return "NOT_RELEVANT";
  }

  if (hasValidatedModelConflict(observation)) return "CONTRADICTS";

  if (isAbsenceOrIncompleteLanguage(validationText) || isAbsenceOrIncompleteLanguage(fullText)) {
    return "NOT_RELEVANT";
  }

  const polarity = evidencePolarity(validationText);

  if (observation.status === "conflicting") {
    if (polarity === "negative") return "NOT_RELEVANT";
    if (polarity === "positive") return "SUPPORTS";
    return "NOT_RELEVANT";
  }

  if (observation.status === "requires_professional_dob_review") {
    if (polarity === "negative" || isIncompleteEvidenceLanguage(validationText)) return "NOT_RELEVANT";
    if (polarity === "positive") return "SUPPORTS";
    return "NOT_RELEVANT";
  }

  if (isSupportingStatus(observation.status)) {
    if (polarity === "negative") return "NOT_RELEVANT";
    if (polarity === "positive") return "SUPPORTS";
    if (/\d/.test(validationText)) return "SUPPORTS";
    return "SUPPORTS";
  }

  if (observation.status === "not_found") {
    if (polarity === "positive") return "SUPPORTS";
    return "NOT_RELEVANT";
  }

  return "NOT_RELEVANT";
}

export interface ClassifiedObservations {
  supports: NormalizableObservation[];
  contradicts: NormalizableObservation[];
  notRelevant: NormalizableObservation[];
  professionalReview: NormalizableObservation[];
}

export function partitionObservationsByClassification(
  observations: NormalizableObservation[],
  measureText: string,
): ClassifiedObservations {
  const supports: NormalizableObservation[] = [];
  const contradicts: NormalizableObservation[] = [];
  const notRelevant: NormalizableObservation[] = [];
  const professionalReview: NormalizableObservation[] = [];

  for (const observation of observations) {
    if (
      observation.status === "requires_professional_dob_review" &&
      isObservationRelevant(observation, measureText)
    ) {
      professionalReview.push(observation);
      continue;
    }

    const classification = classifyObservationPassage(observation, measureText);
    if (classification === "SUPPORTS") supports.push(observation);
    else if (classification === "CONTRADICTS") contradicts.push(observation);
    else notRelevant.push(observation);
  }

  return { supports, contradicts, notRelevant, professionalReview };
}

function observationsGenuinelyContradict(
  observations: NormalizableObservation[],
  measureText: string,
): boolean {
  const pool = observations.filter(
    (observation) =>
      isObservationRelevant(observation, measureText) &&
      (classifyObservationPassage(observation, measureText) !== "NOT_RELEVANT" ||
        isSubstantiveObservation(observation)),
  );

  for (let i = 0; i < pool.length; i += 1) {
    for (let j = i + 1; j < pool.length; j += 1) {
      if (
        isRevisionResolutionPair(pool[i]!, pool[j]!, observations, evidencePolarity)
      ) {
        continue;
      }

      const left = observationText(pool[i]!);
      const right = observationText(pool[j]!);
      if (excerptsContradict(left, right)) return true;

      if (
        isIncompleteEvidenceLanguage(left) ||
        isIncompleteEvidenceLanguage(right) ||
        isAbsenceOrIncompleteLanguage(left) ||
        isAbsenceOrIncompleteLanguage(right) ||
        isPerSheetScopedAbsence(left) ||
        isPerSheetScopedAbsence(right) ||
        !observationsShareComponent(left, right, measureText)
      ) {
        continue;
      }

      const leftPolarity = evidencePolarity(left);
      const rightPolarity = evidencePolarity(right);
      if (
        (leftPolarity === "negative" && rightPolarity === "positive") ||
        (rightPolarity === "negative" && leftPolarity === "positive")
      ) {
        return true;
      }
    }
  }

  const substantiveTexts = pool
    .filter((observation) => classifyObservationPassage(observation, measureText) === "SUPPORTS")
    .map((observation) => observationText(observation))
    .filter(Boolean);

  return materialValuesConflict(substantiveTexts, measureText);
}

export function shouldTreatAsConflict(input: {
  observations: NormalizableObservation[];
  measureText: string;
  revisionResolution: boolean;
}): boolean {
  if (input.revisionResolution) return false;

  const { contradicts } = partitionObservationsByClassification(
    input.observations,
    input.measureText,
  );

  if (contradicts.length > 0) return true;
  return observationsGenuinelyContradict(input.observations, input.measureText);
}

/** Deterministic final status from classified passages — not LLM labels. */
export function computeDeterministicEvidenceStatus(input: {
  observations: NormalizableObservation[];
  measureText: string;
  shouldConflict: boolean;
}): EvidenceStatus {
  const { observations, measureText, shouldConflict } = input;
  const { supports, contradicts, professionalReview } = partitionObservationsByClassification(
    observations,
    measureText,
  );

  if (shouldConflict) return "conflicting";

  if (professionalReview.length > 0) return "requires_professional_dob_review";

  const hasSupports = supports.length > 0;
  const hasContradicts = contradicts.length > 0;

  if (!hasSupports && !hasContradicts) return "not_found";

  if (hasContradicts && !hasSupports) {
    return "conflicting";
  }

  if (hasSupports && hasContradicts) {
    return "conflicting";
  }

  const substantiveTexts = supports.map((observation) => observationText(observation)).filter(Boolean);
  const allAbsenceOnly = supports.every((observation) =>
    isAbsenceOrIncompleteLanguage(evidenceTextForValidation(observation)),
  );
  if (allAbsenceOnly) return "not_found";

  const componentCoverage = assessComponentCoverage(measureText, substantiveTexts);
  if (componentCoverage.total > 1) {
    if (componentCoverage.supported === 0) return "partially_supported";
    if (componentCoverage.supported < componentCoverage.total) return "partially_supported";
  }

  if (supports.some((observation) => observation.status === "verified")) return "verified";
  return "partially_supported";
}

export interface MergeableFindingForValidation extends EvidenceFinding {
  observations?: NormalizableObservation[];
}

export function classifyPrimaryCitation(
  finding: MergeableFindingForValidation,
): PassageClassification {
  if (!finding.source) return "NOT_RELEVANT";
  const text = evidenceTextForValidation({
    status: "verified",
    source: finding.source,
    note: finding.note,
  });
  if (!text || isAbsenceOrIncompleteLanguage(text)) return "NOT_RELEVANT";
  if (!isObservationRelevant({ status: "verified", source: finding.source, note: finding.note }, finding.measure)) {
    return "NOT_RELEVANT";
  }
  const polarity = evidencePolarity(text);
  if (polarity === "negative") return "NOT_RELEVANT";
  if (polarity === "positive" || /\d/.test(text)) return "SUPPORTS";
  return "SUPPORTS";
}

/** Observations eligible for rendered review notes. */
export function observationsForReviewNote(
  observations: NormalizableObservation[],
  measureText: string,
  options?: { revisionResolution?: boolean },
): NormalizableObservation[] {
  const revisionResolution = options?.revisionResolution === true;
  return observations.filter((observation) => {
    const classification = classifyObservationPassage(observation, measureText);
    if (classification === "SUPPORTS" || classification === "CONTRADICTS") return true;
    if (
      revisionResolution &&
      classification === "NOT_RELEVANT" &&
      referencesRevisionDocument(evidenceTextForValidation(observation))
    ) {
      return true;
    }
    return false;
  });
}

export function validateFinalConsistency(finding: MergeableFindingForValidation): string[] {
  const violations: string[] = [];
  const observations = finding.observations ?? [];
  const measureText = finding.measure;
  const { supports } = partitionObservationsByClassification(observations, measureText);

  if (finding.status === "not_found" && finding.source) {
    violations.push("not_found finding must not retain a primary citation");
  }
  if (
    (finding.status === "verified" || finding.status === "partially_supported") &&
    !finding.source
  ) {
    violations.push("supported finding must retain a primary citation");
  }
  if (finding.status === "verified" && supports.length === 0) {
    violations.push("verified status requires at least one SUPPORTS passage");
  }
  if (finding.status === "verified" && supports.length > 0) {
    const absenceOnly = supports.every((observation) =>
      isAbsenceOrIncompleteLanguage(evidenceTextForValidation(observation)),
    );
    if (absenceOnly) {
      violations.push("verified status cannot rest on absence-only evidence");
    }
  }
  if (finding.status === "not_found" && supports.length > 0) {
    violations.push("not_found status conflicts with SUPPORTS passages");
  }
  if (finding.status === "conflicting") {
    const conflict = observationsGenuinelyContradict(observations, measureText);
    const { contradicts } = partitionObservationsByClassification(observations, measureText);
    if (!conflict && contradicts.length === 0) {
      violations.push("conflicting status requires validated contradiction");
    }
  }
  if (finding.status === "requires_professional_dob_review") {
    const { professionalReview } = partitionObservationsByClassification(observations, measureText);
    if (professionalReview.length === 0) {
      violations.push("professional review requires relevant unresolved evidence");
    }
  }
  if (finding.note && /\bNOT_RELEVANT\b/i.test(finding.note)) {
    violations.push("review note must not contain NOT_RELEVANT classification labels");
  }
  if (finding.source && finding.status !== "not_found") {
    if (classifyPrimaryCitation(finding) === "NOT_RELEVANT") {
      violations.push("primary citation must be relevant SUPPORTS or CONTRADICTS evidence");
    }
  }
  if (finding.status === "verified" && finding.note && supports.length === 0) {
    if (isAbsenceOrIncompleteLanguage(finding.note)) {
      violations.push("verified status cannot accompany absence-only review note");
    }
  }
  return violations;
}

/** Downgrade inconsistent synthesized findings before persist/API. */
export function enforceSynthesisConsistency(
  finding: MergeableFindingForValidation,
): MergeableFindingForValidation {
  const violations = validateFinalConsistency(finding);
  if (violations.length === 0) return finding;

  const observations = finding.observations ?? [];
  const { supports } = partitionObservationsByClassification(observations, finding.measure);

  if (
    finding.status === "verified" &&
    (supports.length === 0 ||
      supports.every((observation) =>
        isAbsenceOrIncompleteLanguage(evidenceTextForValidation(observation)),
      ))
  ) {
    return {
      ...finding,
      status: "not_found",
      source: null,
      note: NOT_FOUND_NOTE,
    };
  }

  if (finding.status === "not_found" && finding.source) {
    return {
      ...finding,
      source: null,
      note: NOT_FOUND_NOTE,
    };
  }

  if (finding.status === "conflicting") {
    const shouldConflict = shouldTreatAsConflict({
      observations,
      measureText: finding.measure,
      revisionResolution: false,
    });
    const status = computeDeterministicEvidenceStatus({
      observations,
      measureText: finding.measure,
      shouldConflict,
    });
    if (status !== "conflicting") {
      const { supports: supportPassages } = partitionObservationsByClassification(
        observations,
        finding.measure,
      );
      const primary = supportPassages[0] ?? null;
      if (status === "not_found" || !primary) {
        return {
          ...finding,
          status: "not_found",
          source: null,
          note: NOT_FOUND_NOTE,
        };
      }
      return {
        ...finding,
        status,
        source: primary.source ?? null,
        note: observationText(primary) || finding.note,
      };
    }
  }

  if (finding.status === "requires_professional_dob_review") {
    const { professionalReview } = partitionObservationsByClassification(
      observations,
      finding.measure,
    );
    if (professionalReview.length === 0) {
      return {
        ...finding,
        status: "not_found",
        source: null,
        note: NOT_FOUND_NOTE,
      };
    }
  }

  if (finding.source) {
    if (classifyPrimaryCitation(finding) === "NOT_RELEVANT") {
      const fallback = supports[0] ?? null;
      if (!fallback) {
        return {
          ...finding,
          status: "not_found",
          source: null,
          note: NOT_FOUND_NOTE,
        };
      }
      const nextStatus =
        finding.status === "conflicting" || finding.status === "requires_professional_dob_review"
          ? computeDeterministicEvidenceStatus({
              observations,
              measureText: finding.measure,
              shouldConflict: shouldTreatAsConflict({
                observations,
                measureText: finding.measure,
                revisionResolution: false,
              }),
            })
          : finding.status;
      return {
        ...finding,
        status: nextStatus,
        source: fallback.source ?? null,
        note: observationText(fallback) || finding.note,
      };
    }
  }

  return finding;
}

/** @deprecated Use isObservationRelevant — kept for existing imports. */
export function classifyObservationRelevance(
  observation: NormalizableObservation,
  measureText: string,
): boolean {
  return isObservationRelevant(observation, measureText);
}
