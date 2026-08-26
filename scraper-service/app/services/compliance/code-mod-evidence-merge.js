"use strict";

/**
 * Merge per-sheet Code Modification evidence into one finding per measure.
 * JS port of src/lib/codeModification/mergeEvidence.ts — keep in sync.
 */

const {
  canonicalMeasureKey,
  measuresAreCanonicallyEquivalent,
  preferCanonicalMeasureId,
  preferCanonicalMeasureLabel,
} = require("./code-mod-canonical-measure.js");
const {
  hasRevisionResolution,
  isAddendumEvidenceSource,
  isRevisionEvidenceSource,
} = require("./code-mod-revision-reference.js");
const { excerptsContradict, evidencePolarity } = require("./code-mod-evidence-polarity.js");
const {
  hasValidatedModelConflict,
  normalizeRawObservations,
} = require("./code-mod-raw-observation-normalization.js");
const {
  NOT_FOUND_NOTE,
  classifyObservationPassage,
  classifyObservationRelevance,
  computeDeterministicEvidenceStatus,
  enforceSynthesisConsistency,
  observationsForReviewNote,
  partitionObservationsByClassification,
  shouldTreatAsConflict,
  validateFinalConsistency,
} = require("./code-mod-evidence-classification.js");

const STATUS_RANK = {
  conflicting: 5,
  requires_professional_dob_review: 4,
  verified: 3,
  partially_supported: 2,
  not_found: 1,
};

const PLACEHOLDER_NOT_FOUND_NOTE = "No drawing evidence was reviewed for this measure.";

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function sourceIdentity(source) {
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

function observationText(observation) {
  return [observation.source && observation.source.excerpt, observation.note]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function observationIdentity(observation) {
  return [
    sourceIdentity(observation.source) || "no-source",
    observation.status,
    normalizeText(observationText(observation)),
  ].join("|");
}

function formatSourceCitation(source) {
  if (!source) return null;
  const label = source.sheetLabel || source.fileName;
  if (label && typeof source.pageNumber === "number") {
    return `${label} p.${source.pageNumber}`;
  }
  return label || source.documentId || source.sheetId || null;
}

function isSupportingStatus(status) {
  return status === "verified" || status === "partially_supported";
}

function isSubstantiveObservation(observation) {
  if (hasValidatedModelConflict(observation)) return true;
  if (observation.status === "requires_professional_dob_review") {
    return Boolean(observationText(observation));
  }
  if (isSupportingStatus(observation.status)) return Boolean(observationText(observation));
  return false;
}

function isGenericPerSheetNotFound(text) {
  return /^no evidence for this measure on this sheet\.?$/i.test(text.trim());
}

function dedupeObservations(observations) {
  const seen = new Set();
  const deduped = [];
  for (const observation of observations) {
    const key = observationIdentity(observation);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(observation);
  }
  return deduped;
}

function formatObservationNotes(observations, measureText, options = {}) {
  const includeNotFound = options.includeNotFound === true;
  const parts = [];
  const seenNotes = new Set();
  const seenCitations = new Set();

  for (const observation of observations) {
    if (!includeNotFound && observation.status === "not_found") continue;
    if (
      !classifyObservationRelevance(observation, measureText) &&
      observation.status === "not_found"
    ) {
      continue;
    }
    if (!classifyObservationRelevance(observation, measureText)) continue;

    const citation = formatSourceCitation(observation.source);
    const text = observationText(observation);
    const rendered = citation && text ? `${citation}: ${text}` : citation || text || null;
    if (!rendered) continue;

    const dedupeKey = normalizeText(rendered);
    if (seenNotes.has(dedupeKey)) continue;

    const citationKey = sourceIdentity(observation.source) || normalizeText(citation || "");
    if (citationKey && seenCitations.has(citationKey) && citation && text) continue;

    seenNotes.add(dedupeKey);
    if (citationKey) seenCitations.add(citationKey);
    parts.push(rendered);
  }

  return parts.length ? parts.join(" ") : null;
}

function observationFromFinding(finding) {
  return {
    status: finding.status,
    source: finding.source || null,
    note: finding.note || null,
  };
}

function isPlaceholderNotFoundObservation(observation) {
  return (
    observation.status === "not_found" &&
    !observation.source &&
    observation.note === PLACEHOLDER_NOT_FOUND_NOTE
  );
}

function effectiveObservations(observations) {
  const withoutPlaceholders = observations.filter(
    (observation) => !isPlaceholderNotFoundObservation(observation),
  );
  return dedupeObservations(withoutPlaceholders.length > 0 ? withoutPlaceholders : observations);
}

function pickPrimaryObservation(observations, measureText, options = {}) {
  const preferRevision = options.preferRevisionPrecedence === true;
  const requireRelevant = options.requireRelevant !== false;
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
    const statusDelta = (STATUS_RANK[right.status] || 0) - (STATUS_RANK[left.status] || 0);
    if (statusDelta !== 0) return statusDelta;
    const leftKey = sourceIdentity(left.source) || "";
    const rightKey = sourceIdentity(right.source) || "";
    return leftKey.localeCompare(rightKey);
  });

  if (preferRevision) {
    const revision = ranked.find(
      (observation) =>
        isSupportingStatus(observation.status) && isRevisionEvidenceSource(observation.source),
    );
    if (revision) return revision;
  }

  return ranked[0] || null;
}

function renderFinalNote({ status, observations, finding, primary, revisionResolution }) {
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
      .sort((left, right) => (STATUS_RANK[right.status] || 0) - (STATUS_RANK[left.status] || 0))
      .slice(0, 2);
    return formatObservationNotes(ranked, measureText) || (primary && primary.note) || finding.note || null;
  }

  if (primary) {
    return formatObservationNotes([primary], measureText) || (primary && primary.note) || finding.note || null;
  }

  return finding.note || null;
}

function validateSynthesisInvariants(finding) {
  return validateFinalConsistency(finding);
}

function synthesizeMeasureEvidence(finding, options = {}) {
  const collected =
    finding.observations && finding.observations.length > 0
      ? finding.observations
      : [observationFromFinding(finding)];

  const normalized = normalizeRawObservations(collected, finding.measure);
  const observations = effectiveObservations(normalized);
  const revisionResolution = hasRevisionResolution(
    observations,
    isSubstantiveObservation,
    evidencePolarity,
  );
  const supporting = observations.filter((observation) => isSupportingStatus(observation.status));
  const classified = partitionObservationsByClassification(observations, finding.measure);
  const relevantSupporting = classified.supports;

  const shouldConflict = shouldTreatAsConflict({
    observations,
    measureText: finding.measure,
    revisionResolution,
  });

  const preferRevision = revisionResolution || options.preferAddendumPrecedence === true;
  const status = computeDeterministicEvidenceStatus({
    observations,
    measureText: finding.measure,
    shouldConflict,
  });

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
          measureId: finding.measureId || null,
          measure: finding.measure,
          status: "not_found",
          source: null,
          note: NOT_FOUND_NOTE,
          observations,
        }
      : {
          id: finding.id,
          measureId: finding.measureId || null,
          measure: finding.measure,
          status,
          source: (primary.source && primary.source) || null,
          note,
          observations,
        };

  return enforceSynthesisConsistency(synthesized);
}

function mergeMeasureEvidence(existing, incoming, options = {}) {
  const byMeasure = new Map();

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

    const observations = [...(prev.observations || [observationFromFinding(prev)]), nextObservation];
    byMeasure.set(key, {
      ...prev,
      id: prev.id || finding.id,
      measureId: preferCanonicalMeasureId(prev.measureId, finding.measureId),
      measure: preferCanonicalMeasureLabel(prev.measure, finding.measure),
      observations,
    });
  }

  const merged = Array.from(byMeasure.values());
  if (options.deferSynthesis) return merged;
  return merged.map((finding) => synthesizeMeasureEvidence(finding));
}

function mergeFindingsFromSheets(existing, incoming) {
  return mergeMeasureEvidence(existing, incoming);
}

function validateOneRowPerMeasure(findings) {
  const keys = new Set();
  for (const finding of findings) {
    const key = canonicalMeasureKey(finding);
    if (keys.has(key)) return false;
    keys.add(key);
  }
  return true;
}

function findingObservations(finding) {
  if (finding.observations && finding.observations.length > 0) {
    return finding.observations.slice();
  }
  return [observationFromFinding(finding)];
}

function resolveConsolidationKey(finding, keys, groups) {
  const key = canonicalMeasureKey(finding);
  for (const existingKey of keys) {
    const representative = groups.get(existingKey) && groups.get(existingKey)[0];
    if (!representative) continue;
    if (
      existingKey === key ||
      (finding.measureId &&
        representative.measureId &&
        finding.measureId === representative.measureId) ||
      measuresAreCanonicallyEquivalent(finding.measure, representative.measure)
    ) {
      return existingKey;
    }
  }
  return key;
}

function mergeFindingGroup(group) {
  if (group.length === 1) {
    return enforceSynthesisConsistency(synthesizeMeasureEvidence(group[0]));
  }

  let combined = {
    ...group[0],
    observations: [],
  };

  for (const finding of group) {
    combined = {
      id: combined.id || finding.id,
      measureId: preferCanonicalMeasureId(combined.measureId, finding.measureId),
      measure: preferCanonicalMeasureLabel(combined.measure, finding.measure),
      status: finding.status,
      source: finding.source || null,
      note: finding.note || null,
      observations: [...(combined.observations || []), ...findingObservations(finding)],
    };
  }

  return enforceSynthesisConsistency(synthesizeMeasureEvidence(combined));
}

function consolidateFinalMeasureResults(findings) {
  const groups = new Map();
  const keys = [];

  for (const finding of findings) {
    const key = resolveConsolidationKey(finding, keys, groups);
    if (!groups.has(key)) keys.push(key);
    const bucket = groups.get(key) || [];
    bucket.push(finding);
    groups.set(key, bucket);
  }

  return keys.map((key) => mergeFindingGroup(groups.get(key) || []));
}

function stripInternalObservations(finding) {
  const { observations, ...rest } = finding;
  return rest;
}

function enforceFinalPersistenceInvariants(findings) {
  const consolidated = consolidateFinalMeasureResults(findings);
  return consolidated.map((finding) => {
    let current = enforceSynthesisConsistency(finding);
    if (validateFinalConsistency(current).length > 0) {
      current = enforceSynthesisConsistency(synthesizeMeasureEvidence(current));
    }
    return stripInternalObservations(enforceSynthesisConsistency(current));
  });
}

module.exports = {
  mergeFindingsFromSheets,
  mergeMeasureEvidence,
  synthesizeMeasureEvidence,
  excerptsContradict,
  evidencePolarity,
  isAddendumEvidenceSource,
  isRevisionEvidenceSource,
  classifyObservationRelevance,
  validateOneRowPerMeasure,
  validateSynthesisInvariants,
  consolidateFinalMeasureResults,
  enforceFinalPersistenceInvariants,
};
