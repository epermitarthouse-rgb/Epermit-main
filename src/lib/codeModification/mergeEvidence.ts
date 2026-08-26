/**
 * Merge per-sheet Code Modification evidence into one finding per measure.
 * Preserves observations from every reviewed sheet instead of last-match overwrite.
 *
 * Synthesis pipeline:
 * A. canonicalize measures
 * B. collect observations
 * C. deduplicate observations
 * D. classify relevance/polarity
 * E. resolve revision/reference relationships
 * F. detect material-value conflicts
 * G. aggregate status
 * H. select strongest relevant citations
 * I. validate one-row-per-measure invariant
 * J. render concise note
 */

import {
  canonicalMeasureKey,
  preferCanonicalMeasureId,
  preferCanonicalMeasureLabel,
} from "./canonicalMeasure";
import {
  hasRevisionResolution,
  isAddendumEvidenceSource,
  isRevisionEvidenceSource,
} from "./revisionReference";
import { excerptsContradict, evidencePolarity } from "./evidencePolarity";
import {
  hasValidatedModelConflict,
  normalizeRawObservations,
} from "./rawObservationNormalization";
import {
  NOT_FOUND_NOTE,
  classifyObservationPassage,
  classifyObservationRelevance,
  computeDeterministicEvidenceStatus,
  enforceSynthesisConsistency,
  observationsForReviewNote,
  partitionObservationsByClassification,
  shouldTreatAsConflict,
  validateFinalConsistency,
} from "./evidenceClassification";
import type { EvidenceFinding, EvidenceSource, EvidenceStatus } from "./model";

export {
  classifyObservationRelevance,
} from "./evidenceClassification";

export { excerptsContradict, evidencePolarity };

export interface SheetEvidenceObservation {
  status: EvidenceStatus;
  source?: EvidenceSource | null;
  note?: string | null;
  /** Explicit synthesis metadata — not inferred from list order. */
  relevant?: boolean | null;
}

export interface MergeableEvidenceFinding extends EvidenceFinding {
  observations?: SheetEvidenceObservation[];
}

export { isAddendumEvidenceSource, isRevisionEvidenceSource };

const STATUS_RANK: Record<EvidenceStatus, number> = {
  conflicting: 5,
  requires_professional_dob_review: 4,
  verified: 3,
  partially_supported: 2,
  not_found: 1,
};

const PLACEHOLDER_NOT_FOUND_NOTE = "No drawing evidence was reviewed for this measure.";

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function sourceIdentity(source: EvidenceSource | null | undefined): string | null {
  if (!source) return null;
  if (source.sheetId) return `sheet:${source.sheetId}`;
  if (source.documentId) {
    const page =
      typeof source.pageNumber === "number" && Number.isFinite(source.pageNumber)
        ? `:${source.pageNumber}`
        : "";
    return `doc:${source.documentId}${page}`;
  }
  const label = normalizeText(source.sheetLabel || source.fileName);
  if (!label) return null;
  const page =
    typeof source.pageNumber === "number" && Number.isFinite(source.pageNumber)
      ? `:${source.pageNumber}`
      : "";
  return `label:${label}${page}`;
}

function observationText(observation: SheetEvidenceObservation): string {
  return [observation.source?.excerpt, observation.note].filter(Boolean).join(" ").trim();
}

function observationIdentity(observation: SheetEvidenceObservation): string {
  return [
    sourceIdentity(observation.source) ?? "no-source",
    observation.status,
    normalizeText(observationText(observation)),
  ].join("|");
}

function formatSourceCitation(source: EvidenceSource | null | undefined): string | null {
  if (!source) return null;
  const label = source.sheetLabel || source.fileName;
  if (label && typeof source.pageNumber === "number") {
    return `${label} p.${source.pageNumber}`;
  }
  return label || source.documentId || source.sheetId || null;
}

function isSupportingStatus(status: EvidenceStatus): boolean {
  return status === "verified" || status === "partially_supported";
}

function isSubstantiveObservation(observation: SheetEvidenceObservation): boolean {
  if (hasValidatedModelConflict(observation)) return true;
  if (observation.status === "requires_professional_dob_review") {
    return Boolean(observationText(observation));
  }
  if (isSupportingStatus(observation.status)) return Boolean(observationText(observation));
  return false;
}

function isGenericPerSheetNotFound(text: string): boolean {
  return /^no evidence for this measure on this sheet\.?$/i.test(text.trim());
}

function dedupeObservations(observations: SheetEvidenceObservation[]): SheetEvidenceObservation[] {
  const seen = new Set<string>();
  const deduped: SheetEvidenceObservation[] = [];
  for (const observation of observations) {
    const key = observationIdentity(observation);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(observation);
  }
  return deduped;
}

function formatObservationNotes(
  observations: SheetEvidenceObservation[],
  measureText: string,
  options?: { includeNotFound?: boolean },
): string | null {
  const includeNotFound = options?.includeNotFound === true;
  const parts: string[] = [];
  const seenNotes = new Set<string>();
  const seenCitations = new Set<string>();

  for (const observation of observations) {
    if (!includeNotFound && observation.status === "not_found") continue;
    if (!classifyObservationRelevance(observation, measureText) && observation.status === "not_found") {
      continue;
    }
    if (!classifyObservationRelevance(observation, measureText)) continue;

    const citation = formatSourceCitation(observation.source);
    const text = observationText(observation);
    const rendered =
      citation && text ? `${citation}: ${text}` : citation || text || null;
    if (!rendered) continue;

    const dedupeKey = normalizeText(rendered);
    if (seenNotes.has(dedupeKey)) continue;

    const citationKey = sourceIdentity(observation.source) ?? normalizeText(citation ?? "");
    if (citationKey && seenCitations.has(citationKey) && citation && text) continue;

    seenNotes.add(dedupeKey);
    if (citationKey) seenCitations.add(citationKey);
    parts.push(rendered);
  }

  return parts.length ? parts.join(" ") : null;
}

function observationFromFinding(finding: EvidenceFinding): SheetEvidenceObservation {
  return {
    status: finding.status,
    source: finding.source ?? null,
    note: finding.note ?? null,
  };
}

function isPlaceholderNotFoundObservation(observation: SheetEvidenceObservation): boolean {
  return (
    observation.status === "not_found" &&
    !observation.source &&
    observation.note === PLACEHOLDER_NOT_FOUND_NOTE
  );
}

/** C. deduplicate observations and drop seed placeholders when real observations exist. */
function effectiveObservations(observations: SheetEvidenceObservation[]): SheetEvidenceObservation[] {
  const withoutPlaceholders = observations.filter(
    (observation) => !isPlaceholderNotFoundObservation(observation),
  );
  return dedupeObservations(
    withoutPlaceholders.length > 0 ? withoutPlaceholders : observations,
  );
}

function pickPrimaryObservation(
  observations: SheetEvidenceObservation[],
  measureText: string,
  options?: { preferRevisionPrecedence?: boolean; requireRelevant?: boolean },
): SheetEvidenceObservation | null {
  const preferRevision = options?.preferRevisionPrecedence === true;
  const requireRelevant = options?.requireRelevant !== false;
  const pool = observations.filter((observation) =>
    requireRelevant ? classifyObservationRelevance(observation, measureText) : true,
  );
  const candidates =
    pool.length > 0
      ? pool
      : requireRelevant
        ? []
        : observations.filter(isSubstantiveObservation);
  const fallback = candidates.length > 0 ? candidates : requireRelevant ? [] : observations;
  if (fallback.length === 0) return null;

  const ranked = fallback.slice().sort((left, right) => {
    const statusDelta = (STATUS_RANK[right.status] ?? 0) - (STATUS_RANK[left.status] ?? 0);
    if (statusDelta !== 0) return statusDelta;
    const leftKey = sourceIdentity(left.source) ?? "";
    const rightKey = sourceIdentity(right.source) ?? "";
    return leftKey.localeCompare(rightKey);
  });

  if (preferRevision) {
    const revision = ranked.find(
      (observation) =>
        isSupportingStatus(observation.status) && isRevisionEvidenceSource(observation.source),
    );
    if (revision) return revision;
  }

  return ranked[0] ?? null;
}

/** J. render concise final note without unrelated per-sheet not_found noise. */
function renderFinalNote(input: {
  status: EvidenceStatus;
  observations: SheetEvidenceObservation[];
  finding: MergeableEvidenceFinding;
  primary: SheetEvidenceObservation | null;
  revisionResolution?: boolean;
}): string | null {
  const { status, observations, finding, primary, revisionResolution } = input;
  const measureText = finding.measure;
  const notePool = observationsForReviewNote(observations, measureText, { revisionResolution });

  if (status === "not_found") {
    return NOT_FOUND_NOTE;
  }

  if (status === "conflicting") {
    return (
      formatObservationNotes(notePool.length > 0 ? notePool : observations, measureText) ||
      finding.note ||
      "Conflicting evidence across submitted drawing sheets."
    );
  }

  if (notePool.length >= 2) {
    const ranked = notePool
      .slice()
      .sort((left, right) => {
        const statusDelta = (STATUS_RANK[right.status] ?? 0) - (STATUS_RANK[left.status] ?? 0);
        if (statusDelta !== 0) return statusDelta;
        return (sourceIdentity(left.source) ?? "").localeCompare(sourceIdentity(right.source) ?? "");
      })
      .slice(0, 2);
    return formatObservationNotes(ranked, measureText) || primary?.note || finding.note || null;
  }

  if (primary) {
    return formatObservationNotes([primary], measureText) || primary.note || finding.note || null;
  }

  return finding.note ?? null;
}

export function validateSynthesisInvariants(finding: MergeableEvidenceFinding): string[] {
  return validateFinalConsistency(finding);
}

export function synthesizeMeasureEvidence(
  finding: MergeableEvidenceFinding,
  options?: { preferAddendumPrecedence?: boolean },
): MergeableEvidenceFinding {
  // B. collect observations
  const collected =
    finding.observations && finding.observations.length > 0
      ? finding.observations
      : [observationFromFinding(finding)];

  // 2. normalize raw model observations
  const normalized = normalizeRawObservations(collected, finding.measure);

  // 3–5. dedupe observations (relevance/polarity already applied in normalization)
  const observations = effectiveObservations(normalized);

  // 7. resolve revision/reference relationships
  const revisionResolution = hasRevisionResolution(
    observations,
    isSubstantiveObservation,
    evidencePolarity,
  );

  const supporting = observations.filter((observation) => isSupportingStatus(observation.status));
  const classified = partitionObservationsByClassification(observations, finding.measure);
  const relevantSupporting = classified.supports;

  // 8. detect genuine conflicts — NOT_RELEVANT passages excluded
  const shouldConflict = shouldTreatAsConflict({
    observations,
    measureText: finding.measure,
    revisionResolution,
  });

  // G. aggregate status with deterministic classification reconciliation
  const preferRevision = revisionResolution || options?.preferAddendumPrecedence === true;
  const status = computeDeterministicEvidenceStatus({
    observations,
    measureText: finding.measure,
    shouldConflict,
  });

  // H. select strongest relevant citations
  const professionalReview = classified.professionalReview;
  const primaryPool =
    relevantSupporting.length > 0
      ? relevantSupporting
      : status === "requires_professional_dob_review"
        ? professionalReview
        : shouldConflict
          ? observations.filter(
              (observation) =>
                classifyObservationPassage(observation, finding.measure) !== "NOT_RELEVANT",
            )
          : [];

  const primary = pickPrimaryObservation(primaryPool, finding.measure, {
    preferRevisionPrecedence: preferRevision,
    requireRelevant: true,
  });

  const note = renderFinalNote({
    status,
    observations,
    finding,
    primary,
    revisionResolution: preferRevision,
  });

  const synthesized =
    status === "not_found" ||
    !primary ||
    !classifyObservationRelevance(primary, finding.measure)
      ? {
          id: finding.id,
          measureId: finding.measureId ?? null,
          measure: finding.measure,
          status: "not_found" as const,
          source: null,
          note: NOT_FOUND_NOTE,
          observations,
        }
      : {
          id: finding.id,
          measureId: finding.measureId ?? null,
          measure: finding.measure,
          status,
          source: primary.source ?? null,
          note,
          observations,
        };

  return enforceSynthesisConsistency(synthesized);
}

/** A/I. canonicalize measures and enforce one-row-per-measure invariant. */
export function mergeMeasureEvidence(
  existing: MergeableEvidenceFinding[],
  incoming: EvidenceFinding[],
  options?: { deferSynthesis?: boolean },
): MergeableEvidenceFinding[] {
  const byMeasure = new Map<string, MergeableEvidenceFinding>();

  for (const finding of existing) {
    const key = canonicalMeasureKey(finding);
    byMeasure.set(key, {
      ...finding,
      observations:
        finding.observations && finding.observations.length > 0
          ? finding.observations.slice()
          : [observationFromFinding(finding)],
    });
  }

  for (const finding of incoming) {
    const key = canonicalMeasureKey(finding);
    const prev = byMeasure.get(key);
    const nextObservation = observationFromFinding(finding);

    if (!prev) {
      byMeasure.set(key, {
        ...finding,
        observations: [nextObservation],
      });
      continue;
    }

    const observations = [...(prev.observations ?? [observationFromFinding(prev)]), nextObservation];
    byMeasure.set(key, {
      ...prev,
      id: prev.id || finding.id,
      measureId: preferCanonicalMeasureId(prev.measureId, finding.measureId),
      measure: preferCanonicalMeasureLabel(prev.measure, finding.measure),
      observations,
    });
  }

  const merged = Array.from(byMeasure.values());
  if (options?.deferSynthesis) return merged;
  return merged.map((finding) => synthesizeMeasureEvidence(finding));
}

export function mergeFindingsFromSheets(
  existing: EvidenceFinding[],
  incoming: EvidenceFinding[],
): EvidenceFinding[] {
  return mergeMeasureEvidence(existing, incoming);
}

export function validateOneRowPerMeasure(findings: EvidenceFinding[]): boolean {
  const keys = new Set<string>();
  for (const finding of findings) {
    const key = canonicalMeasureKey(finding);
    if (keys.has(key)) return false;
    keys.add(key);
  }
  return true;
}