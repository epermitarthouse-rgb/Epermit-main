/**
 * Revision / addendum / supplemental document reconciliation for Code Mod synthesis.
 */

import type { EvidenceSource } from "./model";
import type { SheetEvidenceObservation } from "./mergeEvidence";

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

const REVISION_FILENAME_TOKENS =
  /(?:^|[^a-z0-9])(addendum|revision|bulletin|asi|supplement(?:al)?|reissued|amendment)(?:[^a-z0-9]|$)/;

const REVISION_NOUN =
  "(?:addendum|revision|supplement(?:al)?|amendment|bulletin|asi|attached|following|subsequent|reissued)";

/** Filename / label fallback for revision-like documents. */
export function isRevisionEvidenceSource(source: EvidenceSource | null | undefined): boolean {
  if (!source) return false;
  const label = normalizeText(source.fileName || source.sheetLabel);
  return REVISION_FILENAME_TOKENS.test(label);
}

/** @deprecated Use isRevisionEvidenceSource — kept for existing imports/tests. */
export function isAddendumEvidenceSource(source: EvidenceSource | null | undefined): boolean {
  return isRevisionEvidenceSource(source);
}

export function referencesRevisionDocument(text: string): boolean {
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

export interface ReferencedTarget {
  kind: "sheet" | "document" | "revision";
  token: string;
}

/** Extract referenced sheet/document tokens from deferral language. */
export function extractReferencedTargets(text: string): ReferencedTarget[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const targets: ReferencedTarget[] = [];
  const push = (kind: ReferencedTarget["kind"], token: string) => {
    const value = token.trim().toLowerCase();
    if (!value) return;
    if (targets.some((target) => target.kind === kind && target.token === value)) return;
    targets.push({ kind, token: value });
  };

  for (const match of normalized.matchAll(
    /\b(?:see|refer(?:red)? to|deferred to|shown on|provided on|detailed on)\s+(?:the\s+)?([a-z0-9][a-z0-9._-]{1,40})\b/gi,
  )) {
    push("document", match[1]!);
  }

  for (const match of normalized.matchAll(
    /\b(?:see|refer(?:red)? to)\s+(?:sheet|drawing|detail)\s+([a-z0-9][a-z0-9._-]{1,40})\b/gi,
  )) {
    push("sheet", match[1]!);
  }

  for (const match of normalized.matchAll(new RegExp(`\\b(${REVISION_NOUN})\\b`, "gi"))) {
    push("revision", match[1]!);
  }

  return targets;
}

function sourceTokens(source: EvidenceSource | null | undefined): string[] {
  if (!source) return [];
  const tokens = [
    source.sheetId,
    source.documentId,
    source.sheetLabel,
    source.fileName,
  ]
    .filter(Boolean)
    .map((value) => normalizeText(String(value)));
  return tokens.flatMap((token) => {
    const base = token.replace(/\.[a-z0-9]+$/, "");
    return [token, base];
  });
}

function targetMatchesSource(target: ReferencedTarget, source: EvidenceSource | null | undefined): boolean {
  if (!source) return false;
  const tokens = sourceTokens(source);
  if (tokens.some((token) => token.includes(target.token) || target.token.includes(token))) {
    return true;
  }
  if (target.kind === "revision" && isRevisionEvidenceSource(source)) return true;
  return false;
}

function observationText(observation: SheetEvidenceObservation): string {
  return [observation.source?.excerpt, observation.note].filter(Boolean).join(" ").trim();
}

function isSupportingStatus(status: SheetEvidenceObservation["status"]): boolean {
  return status === "verified" || status === "partially_supported";
}

export function hasPositiveProvision(text: string, polarity: (text: string) => "negative" | "positive" | "neutral"): boolean {
  return polarity(text) === "positive";
}

/** Priority: reference text → stable IDs → revision metadata → filename fallback. */
export function isRevisionResolutionPair(
  left: SheetEvidenceObservation,
  right: SheetEvidenceObservation,
  allObservations: SheetEvidenceObservation[],
  polarity: (text: string) => "negative" | "positive" | "neutral",
): boolean {
  const leftRevision = isRevisionEvidenceSource(left.source);
  const rightRevision = isRevisionEvidenceSource(right.source);
  if (leftRevision === rightRevision) return false;

  const base = leftRevision ? right : left;
  const revision = leftRevision ? left : right;
  if (!isRevisionEvidenceSource(revision.source)) return false;
  if (!isSupportingStatus(revision.status)) return false;

  const baseText = observationText(base);
  const revisionText = observationText(revision);
  if (!referencesRevisionDocument(baseText)) return false;
  if (!hasPositiveProvision(revisionText, polarity)) return false;

  const targets = extractReferencedTargets(baseText);
  if (targets.length > 0) {
    const referencedPresent = allObservations.some(
      (observation) =>
        observation !== revision &&
        isSupportingStatus(observation.status) &&
        targets.some((target) => targetMatchesSource(target, observation.source)),
    );
    if (referencedPresent && !targetMatchesSource(targets[0]!, revision.source)) {
      // Explicit reference points elsewhere — do not reconcile against an unrelated revision doc.
      return false;
    }
    if (targets.some((target) => targetMatchesSource(target, revision.source))) {
      return true;
    }
  }

  // Stable IDs / revision metadata / filename fallback when deferral language exists.
  return true;
}

export function hasRevisionResolution(
  observations: SheetEvidenceObservation[],
  isSubstantive: (observation: SheetEvidenceObservation) => boolean,
  polarity: (text: string) => "negative" | "positive" | "neutral",
): boolean {
  const substantive = observations.filter(isSubstantive);
  for (let i = 0; i < substantive.length; i += 1) {
    for (let j = i + 1; j < substantive.length; j += 1) {
      if (isRevisionResolutionPair(substantive[i]!, substantive[j]!, observations, polarity)) {
        return true;
      }
    }
  }
  return false;
}
