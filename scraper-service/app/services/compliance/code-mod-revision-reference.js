"use strict";

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

const REVISION_FILENAME_TOKENS =
  /(?:^|[^a-z0-9])(addendum|revision|bulletin|asi|supplement(?:al)?|reissued|amendment)(?:[^a-z0-9]|$)/;

const REVISION_NOUN =
  "(?:addendum|revision|supplement(?:al)?|amendment|bulletin|asi|attached|following|subsequent|reissued)";

function isRevisionEvidenceSource(source) {
  if (!source) return false;
  const label = normalizeText(source.fileName || source.sheetLabel);
  return REVISION_FILENAME_TOKENS.test(label);
}

function isAddendumEvidenceSource(source) {
  return isRevisionEvidenceSource(source);
}

function referencesRevisionDocument(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  return (
    new RegExp(`\\b${REVISION_NOUN}\\b`).test(normalized) ||
    /\b(?:attached sheet|separate sheet|subsequent sheet|supplemental sheet|reissued sheet)\b/.test(
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

function extractReferencedTargets(text) {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  const targets = [];
  const push = (kind, token) => {
    const value = token.trim().toLowerCase();
    if (!value) return;
    if (targets.some((target) => target.kind === kind && target.token === value)) return;
    targets.push({ kind, token: value });
  };

  for (const match of normalized.matchAll(
    /\b(?:see|refer(?:red)? to|deferred to|shown on|provided on|detailed on)\s+(?:the\s+)?([a-z0-9][a-z0-9._-]{1,40})\b/gi,
  )) {
    push("document", match[1]);
  }
  for (const match of normalized.matchAll(
    /\b(?:see|refer(?:red)? to)\s+(?:sheet|drawing|detail)\s+([a-z0-9][a-z0-9._-]{1,40})\b/gi,
  )) {
    push("sheet", match[1]);
  }
  for (const match of normalized.matchAll(new RegExp(`\\b(${REVISION_NOUN})\\b`, "gi"))) {
    push("revision", match[1]);
  }
  return targets;
}

function sourceTokens(source) {
  if (!source) return [];
  return [source.sheetId, source.documentId, source.sheetLabel, source.fileName]
    .filter(Boolean)
    .map((value) => normalizeText(String(value)))
    .flatMap((token) => {
      const base = token.replace(/\.[a-z0-9]+$/, "");
      return [token, base];
    });
}

function targetMatchesSource(target, source) {
  if (!source) return false;
  const tokens = sourceTokens(source);
  if (tokens.some((token) => token.includes(target.token) || target.token.includes(token))) {
    return true;
  }
  if (target.kind === "revision" && isRevisionEvidenceSource(source)) return true;
  return false;
}

function observationText(observation) {
  return [observation.source && observation.source.excerpt, observation.note].filter(Boolean).join(" ").trim();
}

function observationSourcesMatch(left, right) {
  if (left === right) return true;
  const leftKey = [
    left.source && left.source.sheetId,
    left.source && left.source.documentId,
    left.source && left.source.fileName,
    left.source && left.source.pageNumber,
  ].join("|");
  const rightKey = [
    right.source && right.source.sheetId,
    right.source && right.source.documentId,
    right.source && right.source.fileName,
    right.source && right.source.pageNumber,
  ].join("|");
  return Boolean(leftKey) && leftKey === rightKey;
}

function isSupportingStatus(status) {
  return status === "verified" || status === "partially_supported";
}

function hasPositiveProvision(text, polarity) {
  return polarity(text) === "positive";
}

function isDeferralResolutionPair(base, candidate, allObservations, polarity) {
  if (!isSupportingStatus(candidate.status)) return false;
  if (observationSourcesMatch(base, candidate)) return false;

  const baseText = observationText(base);
  const candidateText = observationText(candidate);
  if (!referencesRevisionDocument(baseText)) return false;
  if (!hasPositiveProvision(candidateText, polarity)) return false;

  const targets = extractReferencedTargets(baseText);
  if (targets.length > 0) {
    const candidateMatchesTarget = targets.some((target) =>
      targetMatchesSource(target, candidate.source),
    );
    if (candidateMatchesTarget) return true;

    const referencedPresent = allObservations.some(
      (observation) =>
        observation !== candidate &&
        isSupportingStatus(observation.status) &&
        targets.some((target) => targetMatchesSource(target, observation.source)),
    );
    if (referencedPresent) return false;

    return false;
  }

  return isRevisionEvidenceSource(candidate.source);
}

function isRevisionResolutionPair(left, right, allObservations, polarity) {
  return (
    isDeferralResolutionPair(left, right, allObservations, polarity) ||
    isDeferralResolutionPair(right, left, allObservations, polarity)
  );
}

function hasRevisionResolution(observations, isSubstantive, polarity) {
  const substantive = observations.filter(isSubstantive);
  for (let i = 0; i < substantive.length; i += 1) {
    for (let j = i + 1; j < substantive.length; j += 1) {
      if (isRevisionResolutionPair(substantive[i], substantive[j], observations, polarity)) {
        return true;
      }
    }
  }
  return false;
}

module.exports = {
  isRevisionEvidenceSource,
  isAddendumEvidenceSource,
  referencesRevisionDocument,
  extractReferencedTargets,
  isRevisionResolutionPair,
  hasRevisionResolution,
};
