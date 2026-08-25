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
  if (observation.status === "conflicting") return true;
  if (isSupportingStatus(observation.status)) return Boolean(observationText(observation));
  return false;
}

const NEGATIVE_EVIDENCE =
  /\b(not included|not shown|not provided|not indicated|not present|not depicted|absent|omitted|excluded|without|does not include|does not show|does not indicate)\b/;

const POSITIVE_EVIDENCE =
  /\b(included|shown|provided|indicated|present|installed|depicted|noted|provided for|designed for|class i|class 1|class ii|class 2)\b/;

function evidencePolarity(text) {
  const normalized = normalizeText(text);
  if (!normalized) return "neutral";
  const negative = NEGATIVE_EVIDENCE.test(normalized);
  const positive = POSITIVE_EVIDENCE.test(normalized);
  if (negative && !positive) return "negative";
  if (positive && !negative) return "positive";
  if (negative && positive) {
    const negPosPhrases = [
      ["not included", "included"],
      ["not shown", "shown"],
      ["not provided", "provided"],
      ["not indicated", "indicated"],
      ["not present", "present"],
      ["not depicted", "depicted"],
    ];
    for (const [negPhrase, posWord] of negPosPhrases) {
      if (
        new RegExp(`\\b${negPhrase}\\b`).test(normalized) &&
        new RegExp(`\\b${posWord}\\b`).test(normalized)
      ) {
        return "negative";
      }
    }
    return "neutral";
  }
  return "neutral";
}

function excerptsContradict(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b || a === b) return false;

  const leftPolarity = evidencePolarity(a);
  const rightPolarity = evidencePolarity(b);
  if (leftPolarity === "negative" && rightPolarity === "positive") return true;
  if (leftPolarity === "positive" && rightPolarity === "negative") return true;

  return (
    (/\bnot included\b/.test(a) && /\bincluded\b/.test(b)) ||
    (/\bincluded\b/.test(a) && /\bnot included\b/.test(b))
  );
}

function isGenericPerSheetNotFound(text) {
  return /^no evidence for this measure on this sheet\.?$/i.test(text.trim());
}

function classifyObservationRelevance(observation) {
  if (typeof observation.relevant === "boolean") return observation.relevant;
  if (observation.status === "not_found") {
    const text = observationText(observation);
    if (!text) return false;
    if (isGenericPerSheetNotFound(text)) return false;
    return false;
  }
  return isSubstantiveObservation(observation);
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

function formatObservationNotes(observations, options = {}) {
  const includeNotFound = options.includeNotFound === true;
  const parts = [];
  const seenNotes = new Set();
  const seenCitations = new Set();

  for (const observation of observations) {
    if (!includeNotFound && observation.status === "not_found") continue;
    if (!classifyObservationRelevance(observation) && observation.status === "not_found") continue;

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
  const substantive = observations.filter(isSubstantiveObservation);

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

function pickPrimaryObservation(observations, options = {}) {
  const preferRevision = options.preferRevisionPrecedence === true;
  const requireRelevant = options.requireRelevant !== false;
  const pool = observations.filter((observation) =>
    requireRelevant ? classifyObservationRelevance(observation) : true,
  );
  const candidates = pool.length > 0 ? pool : observations.filter(isSubstantiveObservation);
  const fallback = candidates.length > 0 ? candidates : observations;

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

  return ranked[0] || observations[0];
}

function aggregateStatus(observations) {
  if (observations.some((observation) => observation.status === "conflicting")) {
    return "conflicting";
  }
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

function renderFinalNote({ status, observations, finding, supporting, primary }) {
  if (status === "not_found") {
    const relevant = observations.filter((observation) => classifyObservationRelevance(observation));
    if (relevant.length === 0) return NOT_FOUND_NOTE;
    return formatObservationNotes(relevant) || NOT_FOUND_NOTE;
  }

  if (status === "conflicting") {
    const conflictPool = observations.filter(
      (observation) =>
        observation.status === "conflicting" ||
        isSupportingStatus(observation.status) ||
        evidencePolarity(observationText(observation)) !== "neutral",
    );
    return (
      formatObservationNotes(conflictPool) ||
      finding.note ||
      "Conflicting evidence across submitted drawing sheets."
    );
  }

  if (supporting.length >= 2) {
    const ranked = supporting
      .slice()
      .sort((left, right) => (STATUS_RANK[right.status] || 0) - (STATUS_RANK[left.status] || 0))
      .slice(0, 2);
    return formatObservationNotes(ranked) || primary.note || finding.note || null;
  }

  return primary.note || finding.note || null;
}

function synthesizeMeasureEvidence(finding, options = {}) {
  const collected =
    finding.observations && finding.observations.length > 0
      ? finding.observations
      : [observationFromFinding(finding)];

  const observations = effectiveObservations(collected);
  const revisionResolution = hasRevisionResolution(
    observations,
    isSubstantiveObservation,
    evidencePolarity,
  );
  const explicitConflict = observations.some((observation) => observation.status === "conflicting");
  const supporting = observations.filter((observation) => isSupportingStatus(observation.status));
  const relevantSupporting = supporting.filter((observation) =>
    classifyObservationRelevance(observation),
  );

  const shouldConflict =
    explicitConflict ||
    (!revisionResolution && observationsContradict(observations, finding.measure));

  const preferRevision = revisionResolution || options.preferAddendumPrecedence === true;
  const status = shouldConflict ? "conflicting" : aggregateStatus(observations);

  const primary = shouldConflict
    ? pickPrimaryObservation(
        observations.filter(
          (observation) =>
            observation.status === "conflicting" || isSupportingStatus(observation.status),
        ),
        { requireRelevant: true },
      )
    : pickPrimaryObservation(relevantSupporting.length > 0 ? relevantSupporting : observations, {
        preferRevisionPrecedence: preferRevision,
        requireRelevant: status !== "not_found",
      });

  const note = renderFinalNote({
    status,
    observations,
    finding,
    supporting: relevantSupporting,
    primary,
  });

  if (status === "not_found" && !classifyObservationRelevance(primary)) {
    return {
      id: finding.id,
      measureId: finding.measureId || null,
      measure: finding.measure,
      status,
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
};
