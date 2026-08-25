"use strict";

/**
 * Merge per-sheet Code Modification evidence into one finding per measure.
 * JS port of src/lib/codeModification/mergeEvidence.ts — keep in sync.
 */

const STATUS_RANK = {
  conflicting: 5,
  requires_professional_dob_review: 4,
  verified: 3,
  partially_supported: 2,
  not_found: 1,
};

function measureKey(finding) {
  return (finding.measureId || finding.measure || finding.id).toLowerCase();
}

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

function isAddendumEvidenceSource(source) {
  const label = normalizeText(source && (source.fileName || source.sheetLabel));
  return /(?:^|[^a-z0-9])(addendum|revision|supplement|amendment)(?:[^a-z0-9]|$)/.test(label);
}

function isSupportingStatus(status) {
  return status === "verified" || status === "partially_supported";
}

function isSubstantiveObservation(observation) {
  if (observation.status === "conflicting") return true;
  if (isSupportingStatus(observation.status)) return Boolean(observationText(observation));
  return false;
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
  for (const observation of observations) {
    if (!includeNotFound && observation.status === "not_found") continue;
    const citation = formatSourceCitation(observation.source);
    const text = observationText(observation);
    if (citation && text) {
      parts.push(`${citation}: ${text}`);
    } else if (citation) {
      parts.push(citation);
    } else if (text) {
      parts.push(text);
    }
  }
  return parts.length ? parts.join(" ") : null;
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

function referencesRevisionDocument(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;

  const REVISION_NOUN = "(?:addendum|revision|supplement|amendment|attached|following|subsequent)";
  return (
    /\b(?:addendum|revision|supplement|amendment|attached sheet|separate sheet|subsequent sheet)\b/.test(
      normalized,
    ) ||
    /\bnot included (on|in)\b/.test(normalized) ||
    new RegExp(`\\bsee (the )?${REVISION_NOUN}\\b`).test(normalized) ||
    new RegExp(`\\brefer(?:red)? to (the )?${REVISION_NOUN}\\b`).test(normalized) ||
    new RegExp(`\\b(deferred|detailed|shown|provided) (on|in|to) (the )?${REVISION_NOUN}\\b`).test(
      normalized,
    ) ||
    /\bsee (sheet|drawing|detail)\b/.test(normalized)
  );
}

function hasPositiveProvision(text) {
  return evidencePolarity(text) === "positive";
}

function isRevisionResolutionPair(left, right) {
  const leftAddendum = isAddendumEvidenceSource(left.source);
  const rightAddendum = isAddendumEvidenceSource(right.source);
  if (leftAddendum === rightAddendum) return false;

  const base = leftAddendum ? right : left;
  const addendum = leftAddendum ? left : right;
  if (!isAddendumEvidenceSource(addendum.source)) return false;
  if (!isSupportingStatus(addendum.status)) return false;

  const baseText = observationText(base);
  const addendumText = observationText(addendum);
  if (!referencesRevisionDocument(baseText)) return false;
  return hasPositiveProvision(addendumText);
}

function observationsContradict(observations) {
  const substantive = observations.filter(isSubstantiveObservation);

  for (let i = 0; i < substantive.length; i += 1) {
    for (let j = i + 1; j < substantive.length; j += 1) {
      if (isRevisionResolutionPair(substantive[i], substantive[j])) continue;

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
      const leftPositive =
        substantive[i].status === "verified" || leftPolarity === "positive";
      const rightPositive =
        substantive[j].status === "verified" || rightPolarity === "positive";

      if ((leftNegative && rightPositive) || (rightNegative && leftPositive)) {
        return true;
      }
    }
  }

  return false;
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
    observation.note === "No drawing evidence was reviewed for this measure."
  );
}

function effectiveObservations(observations) {
  const withoutPlaceholders = observations.filter(
    (observation) => !isPlaceholderNotFoundObservation(observation),
  );
  return dedupeObservations(withoutPlaceholders.length > 0 ? withoutPlaceholders : observations);
}

function hasRevisionResolution(observations) {
  const substantive = observations.filter(isSubstantiveObservation);
  for (let i = 0; i < substantive.length; i += 1) {
    for (let j = i + 1; j < substantive.length; j += 1) {
      if (isRevisionResolutionPair(substantive[i], substantive[j])) return true;
    }
  }
  return false;
}

function pickPrimaryObservation(observations, options = {}) {
  const preferAddendum = options.preferAddendumPrecedence === true;
  const pool = observations.filter(isSubstantiveObservation);
  const candidates = pool.length > 0 ? pool : observations;

  const ranked = candidates
    .slice()
    .sort((left, right) => (STATUS_RANK[right.status] || 0) - (STATUS_RANK[left.status] || 0));

  if (preferAddendum) {
    const addendum = ranked.find(
      (observation) =>
        isSupportingStatus(observation.status) && isAddendumEvidenceSource(observation.source),
    );
    if (addendum) return addendum;
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

function synthesizeMeasureEvidence(finding, options = {}) {
  const observations = effectiveObservations(
    finding.observations && finding.observations.length > 0
      ? finding.observations
      : [observationFromFinding(finding)],
  );

  const revisionResolution = hasRevisionResolution(observations);
  const explicitConflict = observations.some((observation) => observation.status === "conflicting");
  const supporting = observations.filter((observation) => isSupportingStatus(observation.status));
  const uniqueSupportedSources = new Set(
    supporting.map((observation) => sourceIdentity(observation.source)).filter(Boolean),
  );

  const shouldConflict =
    explicitConflict ||
    (!revisionResolution &&
      uniqueSupportedSources.size >= 2 &&
      observationsContradict(observations));

  if (shouldConflict) {
    const primary = pickPrimaryObservation(
      observations.filter(
        (observation) =>
          observation.status === "conflicting" || isSupportingStatus(observation.status),
      ),
    );
    const combinedNote =
      formatObservationNotes(observations) ||
      finding.note ||
      "Conflicting evidence across submitted drawing sheets.";
    return {
      id: finding.id,
      measureId: finding.measureId || null,
      measure: finding.measure,
      status: "conflicting",
      source: (primary.source && primary.source) || null,
      note: combinedNote,
    };
  }

  const preferAddendum = revisionResolution || options.preferAddendumPrecedence === true;
  const status = aggregateStatus(observations);
  const primary = pickPrimaryObservation(supporting.length > 0 ? supporting : observations, {
    preferAddendumPrecedence: preferAddendum,
  });

  const note =
    supporting.length >= 2
      ? formatObservationNotes(supporting) || primary.note || finding.note || null
      : primary.note || finding.note || null;

  return {
    id: finding.id,
    measureId: finding.measureId || null,
    measure: finding.measure,
    status,
    source: (primary.source && primary.source) || null,
    note,
  };
}

function mergeMeasureEvidence(existing, incoming, options = {}) {
  const byMeasure = new Map();

  for (const finding of existing) {
    const key = measureKey(finding);
    byMeasure.set(key, {
      ...finding,
      observations:
        finding.observations && finding.observations.length > 0
          ? finding.observations.slice()
          : [observationFromFinding(finding)],
    });
  }

  for (const finding of incoming) {
    const key = measureKey(finding);
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

module.exports = {
  mergeFindingsFromSheets,
  mergeMeasureEvidence,
  synthesizeMeasureEvidence,
  excerptsContradict,
  evidencePolarity,
  isAddendumEvidenceSource,
};
