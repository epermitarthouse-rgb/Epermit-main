"use strict";

/**
 * Merge per-sheet Code Modification evidence into one finding per measure.
 * JS port of src/lib/codeModification/mergeEvidence.ts — keep in sync.
 */

const {
  canonicalMeasureKey,
  preferCanonicalMeasureId,
  preferCanonicalMeasureLabel,
} = require("./code-mod-canonical-measure.js");
const { materialValuesConflict } = require("./code-mod-material-value-conflict.js");
const {
  hasRevisionResolution,
  isAddendumEvidenceSource,
  isRevisionEvidenceSource,
  isRevisionResolutionPair,
} = require("./code-mod-revision-reference.js");
const { excerptsContradict, evidencePolarity } = require("./code-mod-evidence-polarity.js");
const {
  hasValidatedModelConflict,
  normalizeRawObservations,
  evidenceTextForValidation,
  isAbsenceOrIncompleteLanguage,
} = require("./code-mod-raw-observation-normalization.js");
const {
  assessComponentCoverage,
  observationRelatesToMeasure,
  observationsShareComponent,
} = require("./code-mod-measure-component-completeness.js");
const { isIncompleteEvidenceLanguage } = require("./code-mod-evidence-polarity.js");

const STATUS_RANK = {
  conflicting: 5,
  requires_professional_dob_review: 4,
  verified: 3,
  partially_supported: 2,
  not_found: 1,
};

const NOT_FOUND_NOTE = "No relevant evidence was found in the reviewed drawing set.";
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

function classifyObservationRelevance(observation, measureText) {
  if (typeof observation.relevant === "boolean") return observation.relevant;
  if (observation.status === "not_found") {
    const text = observationText(observation);
    if (!text) return false;
    if (isGenericPerSheetNotFound(text)) return false;
    return false;
  }
  if (!isSubstantiveObservation(observation)) return false;
  return observationRelatesToMeasure(observationText(observation), measureText);
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

function observationsContradict(observations, measureText) {
  const substantive = observations.filter(
    (observation) =>
      isSubstantiveObservation(observation) &&
      classifyObservationRelevance(observation, measureText),
  );

  for (let i = 0; i < substantive.length; i += 1) {
    for (let j = i + 1; j < substantive.length; j += 1) {
      if (isRevisionResolutionPair(substantive[i], substantive[j], observations, evidencePolarity)) {
        continue;
      }

      const left = observationText(substantive[i]);
      const right = observationText(substantive[j]);
      if (excerptsContradict(left, right)) return true;

      const leftSource = sourceIdentity(substantive[i].source);
      const rightSource = sourceIdentity(substantive[j].source);
      if (!leftSource || !rightSource || leftSource === rightSource) continue;

      if (
        isIncompleteEvidenceLanguage(left) ||
        isIncompleteEvidenceLanguage(right) ||
        !observationsShareComponent(left, right, measureText)
      ) {
        continue;
      }

      const leftPolarity = evidencePolarity(left);
      const rightPolarity = evidencePolarity(right);
      const leftNegative = leftPolarity === "negative";
      const rightNegative = rightPolarity === "negative";
      const leftPositive = leftPolarity === "positive";
      const rightPositive = rightPolarity === "positive";

      if ((leftNegative && rightPositive) || (rightNegative && leftPositive)) {
        return true;
      }
    }
  }

  const substantiveTexts = substantive.map((observation) => observationText(observation)).filter(Boolean);
  return materialValuesConflict(substantiveTexts, measureText);
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

function aggregateStatus(observations) {
  if (observations.some((observation) => observation.status === "requires_professional_dob_review")) {
    return "requires_professional_dob_review";
  }
  const supporting = observations.filter((observation) => isSupportingStatus(observation.status));
  if (supporting.length > 0) {
    if (supporting.some((observation) => observation.status === "verified")) return "verified";
    return "partially_supported";
  }
  return "not_found";
}

function reconcileFinalStatus({ shouldConflict, observations, measure }) {
  if (shouldConflict) return "conflicting";

  const isRelevant = (observation) => classifyObservationRelevance(observation, measure);

  if (
    observations.some(
      (observation) =>
        observation.status === "requires_professional_dob_review" && isRelevant(observation),
    )
  ) {
    return "requires_professional_dob_review";
  }

  const relevantSupporting = observations.filter(
    (observation) => isRelevant(observation) && isSupportingStatus(observation.status),
  );

  if (relevantSupporting.length === 0) return "not_found";

  const allAbsenceOnly = relevantSupporting.every((observation) =>
    isAbsenceOrIncompleteLanguage(evidenceTextForValidation(observation)),
  );
  if (allAbsenceOnly) return "not_found";

  const substantiveTexts = observations
    .filter((observation) => isRelevant(observation))
    .map((observation) => observationText(observation))
    .filter(Boolean);

  const componentCoverage = assessComponentCoverage(measure, substantiveTexts);
  if (componentCoverage.total > 1) {
    if (componentCoverage.supported === 0) {
      return relevantSupporting.length > 0 ? "partially_supported" : "not_found";
    }
    if (componentCoverage.supported < componentCoverage.total) return "partially_supported";
  }

  if (relevantSupporting.some((observation) => observation.status === "verified")) return "verified";
  return "partially_supported";
}

function renderFinalNote({ status, observations, finding, supporting, primary }) {
  const measureText = finding.measure;

  if (status === "not_found") {
    return NOT_FOUND_NOTE;
  }

  if (status === "conflicting") {
    const conflictPool = observations.filter(
      (observation) =>
        classifyObservationRelevance(observation, measureText) &&
        (hasValidatedModelConflict(observation) ||
          isSupportingStatus(observation.status) ||
          evidencePolarity(observationText(observation)) !== "neutral"),
    );
    return (
      formatObservationNotes(conflictPool, measureText) ||
      finding.note ||
      "Conflicting evidence across submitted drawing sheets."
    );
  }

  if (supporting.length >= 2) {
    const ranked = supporting
      .slice()
      .sort((left, right) => (STATUS_RANK[right.status] || 0) - (STATUS_RANK[left.status] || 0))
      .slice(0, 2);
    return formatObservationNotes(ranked, measureText) || (primary && primary.note) || finding.note || null;
  }

  return (primary && primary.note) || finding.note || null;
}

function validateSynthesisInvariants(finding) {
  const violations = [];
  const observations = finding.observations || [];
  const relevantSupporting = observations.filter(
    (observation) =>
      classifyObservationRelevance(observation, finding.measure) &&
      isSupportingStatus(observation.status),
  );

  if (finding.status === "not_found" && finding.source) {
    violations.push("not_found finding must not retain a primary citation");
  }
  if (
    (finding.status === "verified" || finding.status === "partially_supported") &&
    !finding.source
  ) {
    violations.push("supported finding must retain a primary citation");
  }
  if (finding.status === "verified" && relevantSupporting.length === 0) {
    violations.push("verified status requires at least one relevant supporting observation");
  }
  if (finding.status === "verified" && relevantSupporting.length > 0) {
    const absenceOnly = relevantSupporting.every((observation) =>
      isAbsenceOrIncompleteLanguage(evidenceTextForValidation(observation)),
    );
    if (absenceOnly) {
      violations.push("verified status cannot rest on absence-only evidence");
    }
  }
  if (finding.status === "not_found" && relevantSupporting.length > 0) {
    violations.push("not_found status conflicts with supporting observations");
  }
  if (finding.status === "conflicting") {
    const hasGenuine =
      observations.some((observation) => hasValidatedModelConflict(observation)) ||
      observationsContradict(observations, finding.measure);
    if (!hasGenuine) {
      violations.push("conflicting status requires validated contradiction");
    }
  }
  return violations;
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
  const relevantSupporting = supporting.filter((observation) =>
    classifyObservationRelevance(observation, finding.measure),
  );

  const shouldConflict =
    !revisionResolution &&
    (observations.some(
      (observation) =>
        hasValidatedModelConflict(observation) &&
        classifyObservationRelevance(observation, finding.measure),
    ) ||
      observationsContradict(observations, finding.measure));

  const preferRevision = revisionResolution || options.preferAddendumPrecedence === true;
  const status = reconcileFinalStatus({
    shouldConflict,
    observations,
    measure: finding.measure,
  });

  const professionalReview = observations.filter(
    (observation) =>
      observation.status === "requires_professional_dob_review" &&
      classifyObservationRelevance(observation, finding.measure),
  );
  const primaryPool =
    relevantSupporting.length > 0
      ? relevantSupporting
      : status === "requires_professional_dob_review"
        ? professionalReview
        : shouldConflict
          ? observations.filter(
              (observation) =>
                classifyObservationRelevance(observation, finding.measure) &&
                (hasValidatedModelConflict(observation) || isSupportingStatus(observation.status)),
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
    supporting: relevantSupporting,
    primary,
  });

  if (
    status === "not_found" ||
    !primary ||
    !classifyObservationRelevance(primary, finding.measure)
  ) {
    return {
      id: finding.id,
      measureId: finding.measureId || null,
      measure: finding.measure,
      status: "not_found",
      source: null,
      note: NOT_FOUND_NOTE,
      observations,
    };
  }

  return {
    id: finding.id,
    measureId: finding.measureId || null,
    measure: finding.measure,
    status,
    source: (primary.source && primary.source) || null,
    note,
    observations,
  };
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
};
