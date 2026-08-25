/**
 * Heuristic DC Code Modification form extraction.
 * Distinguishes applicant pages from blank official reviewer sections.
 */

import {
  emptyExtractedRequest,
  type CitedCodeSection,
  type ExtractedModificationRequest,
  type FormPage,
  type FormPageRole,
  type ProposedMeasure,
} from "./model";

const REVIEWER_MARKERS = [
  /for official use only/i,
  /dob reviewer/i,
  /doee reviewer/i,
  /conditions of approval/i,
  /dob approval date/i,
  /reserved for .*reviewer/i,
];

const APPLICANT_MARKERS = [
  /applicant request/i,
  /requests? a modification/i,
  /proposed alternative/i,
  /compensating measures/i,
  /flood hazard/i,
  /strict (application|compliance).{0,40}impractical/i,
  /complies with (the )?intent/i,
];

const BLANK_VALUE = /^(?:_{2,}|\.{3,}|[-–—]+|n\/a|tbd)?$/i;

export const HEURISTIC_FIELD_WARNINGS = {
  requestedModification:
    "Could not extract a requested modification from applicant pages.",
  citedSections: "No applicant-cited code sections were found.",
  proposedMeasures: "No proposed alternative measures were found.",
} as const;

export function classifyPageRole(page: Pick<FormPage, "text">): FormPageRole {
  const text = page.text ?? "";
  const hasReviewer = REVIEWER_MARKERS.some((re) => re.test(text));
  const hasApplicant = APPLICANT_MARKERS.some((re) => re.test(text));
  if (hasReviewer && hasApplicant) return "mixed";
  if (hasReviewer) return "reviewer";
  if (hasApplicant) return "applicant";
  return text.trim() ? "unknown" : "unknown";
}

export function stripReviewerSections(text: string): string {
  let next = text ?? "";
  next = next.replace(/for official use only[\s\S]*$/i, "");
  next = next.replace(
    /^(?:dob|doee)\s+(?:reviewer|approval|comments|decision)[^:\n]*:[^\n]*$/gim,
    "",
  );
  next = next.replace(/^conditions of approval:[^\n]*$/gim, "");
  return next.replace(/[ \t]+\n/g, "\n").trim();
}

export function applicantPagesFrom(pages: FormPage[]): FormPage[] {
  return pages
    .map((page) => {
      const role = page.role ?? classifyPageRole(page);
      return { ...page, role };
    })
    .filter((page) => page.role !== "reviewer")
    .map((page) =>
      page.role === "mixed"
        ? { ...page, text: stripReviewerSections(page.text) }
        : page,
    )
    .filter((page) => (page.text ?? "").trim().length > 0);
}

function usableFieldValue(raw: string | undefined | null): string | null {
  if (raw == null) return null;
  const value = raw.replace(/\s+/g, " ").trim();
  if (!value || BLANK_VALUE.test(value) || /^_+$/.test(value)) return null;
  if (/reviewer|official use only|approval date/i.test(value) && value.length < 40) {
    return null;
  }
  return value;
}

function uniqueCitations(items: CitedCodeSection[]): CitedCodeSection[] {
  const seen = new Set<string>();
  const out: CitedCodeSection[] = [];
  for (const item of items) {
    const key = item.citation.replace(/\s+/g, " ").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function extractCitedSections(text: string): CitedCodeSection[] {
  const found: CitedCodeSection[] = [];
  const ibc = /IBC\s+(\d+(?:\.\d+)*)(?:\s*\((\d{4})\))?/gi;
  for (const match of text.matchAll(ibc)) {
    const year = match[2] ?? null;
    found.push({
      citation: year ? `IBC ${match[1]} (${year})` : `IBC ${match[1]}`,
      year,
      source: "applicant",
      label: "Applicant-cited code",
    });
  }
  const dcmr = /12A\s*DCMR\s+(\d+(?:\.\d+)*)/gi;
  for (const match of text.matchAll(dcmr)) {
    found.push({
      citation: `12A DCMR ${match[1]}`,
      year: null,
      source: "applicant",
      label: "Applicant-cited code",
    });
  }
  return uniqueCitations(found);
}

function extractAddress(text: string): string | null {
  const match = text.match(
    /(?:project\s*(?:\/\s*)?address|property address|site address)\s*[:]\s*([^\n]+)/i,
  );
  return usableFieldValue(match?.[1] ?? null);
}

function extractRequestedModification(text: string): string {
  const patterns = [
    /requests?\s+a\s+modification\s+of\s+([^\n]+(?:\n[^\n]+)?)/i,
    /modification\s+(?:of|to|concerning)\s+([^\n]+)/i,
    /applicant request:\s*([\s\S]{20,400}?)(?:\n\s*\n|reason |proposed )/i,
  ];
  for (const re of patterns) {
    const match = text.match(re);
    const value = usableFieldValue(match?.[1] ?? null);
    if (value) return value.replace(/\s+/g, " ").replace(/\.$/, "").trim();
  }
  return "";
}

function extractImpracticalReason(text: string): string | null {
  const labeled = text.match(
    /reason[^:\n]*impractical[^:\n]*:\s*([^\n]+(?:\n(?!\n)[^\n]+)*)/i,
  );
  if (labeled) return usableFieldValue(labeled[1]);
  const sentence = text.match(/([^.]*\bimpractical\b[^.]*\.)/i);
  return usableFieldValue(sentence?.[1] ?? null);
}

function extractCompliesWithIntent(text: string): boolean | null {
  if (/complies with (the )?intent/i.test(text)) return true;
  if (/does not comply with (the )?intent/i.test(text)) return false;
  return null;
}

function extractFloodHazard(text: string): boolean | null {
  const match = text.match(/flood\s+hazard[^:\n]*:\s*(yes|no)\b/i);
  if (!match) return null;
  return match[1].toLowerCase() === "yes";
}

function extractNarrative(text: string): string | null {
  const match = text.match(
    /supporting narrative:\s*([\s\S]+?)(?:\n\s*\n|for official use|$)/i,
  );
  return usableFieldValue(match?.[1] ?? null);
}

const MEASURE_ACTION_VERBS =
  "Provide|Maintain|Incorporate|Incorporated|Install|Ensure|Limit|Keep|Add|Include|Equip|Supply|Furnish|Construct|Upgrade|Replace|Extend|Reduce|Restrict|Monitor|Signal|Mark|Label|Post";

const MEASURE_INTRO_MARKERS =
  /(?:in lieu of|following|proposed|compensating|alternative measures|life safety measures|shall provide|will provide)\b/i;

function stripMeasureIntroBoilerplate(clause: string): string {
  let value = clause.replace(/\s+/g, " ").trim();
  if (!value) return value;

  const actionStart = value.match(new RegExp(`\\b(${MEASURE_ACTION_VERBS})\\b`, "i"));
  if (!actionStart || actionStart.index == null || actionStart.index === 0) {
    return value;
  }

  const prefix = value.slice(0, actionStart.index);
  if (MEASURE_INTRO_MARKERS.test(prefix) || /:\s*$/.test(prefix.trim())) {
    value = value.slice(actionStart.index).trim();
  }
  return value;
}

function splitDetachedTrailingClause(clause: string): string[] {
  const value = clause.replace(/\s+/g, " ").trim();
  const match = value.match(
    new RegExp(`^(.{10,}?)\\.\\s+((?:${MEASURE_ACTION_VERBS})\\b[\\s\\S]+)$`, "i"),
  );
  if (!match) return [value];
  const head = stripMeasureIntroBoilerplate(match[1]);
  const tail = stripMeasureIntroBoilerplate(match[2]);
  if (head && tail && head.toLowerCase() !== tail.toLowerCase()) {
    return [head, tail];
  }
  return [value];
}

function finalizeMeasureClause(clause: string): string[] {
  const parts: string[] = [];
  for (const segment of splitDetachedTrailingClause(clause)) {
    const cleaned = normalizeMeasureClause(stripMeasureIntroBoilerplate(segment));
    if (cleaned.length >= 10) parts.push(cleaned);
  }
  return parts;
}

function normalizeMeasureClause(clause: string): string {
  let value = clause.replace(/^[,.\s]+/, "").replace(/\s+/g, " ").trim();
  if (value && /^[a-z]/.test(value)) {
    value = value.charAt(0).toUpperCase() + value.slice(1);
  }
  return value.replace(/[.,;]+$/, "").trim();
}

export function splitMeasureDescription(description: string): string[] {
  const text = description.replace(/\s+/g, " ").trim();
  if (!text) return [];

  const numbered = [...text.matchAll(/\b(\d+)\s*[.)]\s+(.+?)(?=\s\d+\s*[.)]\s|$)/gi)];
  if (numbered.length >= 2) {
    return numbered.map((match) => normalizeMeasureClause(match[2])).filter(Boolean);
  }

  const splitOnActionVerbs = (input: string): string[] => {
    const boundary = new RegExp(
      `(?:[.;]\\s+|,\\s*)(?=(?:${MEASURE_ACTION_VERBS})\\s+)`,
      "gi",
    );
    const segments = input
      .split(boundary)
      .map((part) => normalizeMeasureClause(part))
      .filter((part) => part.length >= 10);
    return segments.length >= 2 ? segments : [input.trim()];
  };

  const parts = splitOnActionVerbs(text);
  const expanded: string[] = [];
  for (const part of parts) {
    const nested = splitOnActionVerbs(part);
    expanded.push(...(nested.length >= 2 ? nested : [part]));
  }

  const final: string[] = [];
  for (const part of expanded) {
    const subParts = part
      .split(/,\s*(?=(?:include|maintain|provide|install|ensure|limit|incorporate|incorporated)\s+)/i)
      .map((segment) => normalizeMeasureClause(segment))
      .filter((segment) => segment.length >= 10);
    if (subParts.length >= 2) {
      for (const subPart of subParts) {
        final.push(...finalizeMeasureClause(subPart));
      }
      continue;
    }
    const embedded = part.match(
      /^((?:incorporate|incorporated)\b[\s\S]*?\brecommendations\b[\s\S]*?)\s+include\s+(?:a|the)\s+(.+)$/i,
    );
    if (embedded) {
      final.push(...finalizeMeasureClause(embedded[1]));
      final.push(...finalizeMeasureClause(`Include ${embedded[2]}`));
      continue;
    }
    final.push(...finalizeMeasureClause(part));
  }

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const part of final) {
    const key = part.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(part);
  }
  return unique.length >= 2 ? unique : [text];
}

export function normalizeProposedMeasures(measures: ProposedMeasure[]): ProposedMeasure[] {
  const expanded: ProposedMeasure[] = [];
  for (const measure of measures ?? []) {
    const description = measure.description.trim();
    if (!description) continue;
    const parts = splitMeasureDescription(description);
    const sourceContext =
      measure.sourceContext ?? (parts.length > 1 ? description.slice(0, 160) : null);
    if (parts.length <= 1) {
      expanded.push({
        ...measure,
        description,
        sourcePageNumber: measure.sourcePageNumber ?? null,
        sourceContext,
      });
      continue;
    }
    for (const part of parts) {
      expanded.push({
        id: `measure-${expanded.length + 1}`,
        description: part,
        category: measure.category ?? null,
        sourcePageNumber: measure.sourcePageNumber ?? null,
        sourceContext,
      });
    }
  }
  return expanded.map((measure, index) => ({
    ...measure,
    id: `measure-${index + 1}`,
  }));
}

export function reconcileExtractionWarnings(
  extracted: ExtractedModificationRequest,
): string[] {
  return extracted.extractionWarnings.filter((warning) => {
    if (
      warning === HEURISTIC_FIELD_WARNINGS.requestedModification &&
      usableFieldValue(extracted.requestedModification)
    ) {
      return false;
    }
    if (
      warning === HEURISTIC_FIELD_WARNINGS.citedSections &&
      extracted.citedSections.length > 0
    ) {
      return false;
    }
    if (
      warning === HEURISTIC_FIELD_WARNINGS.proposedMeasures &&
      extracted.proposedMeasures.length > 0
    ) {
      return false;
    }
    return true;
  });
}

function extractProposedMeasures(text: string, sourcePageNumber: number | null = null): ProposedMeasure[] {
  const section = text.match(
    /proposed alternative[\s\S]*?(?:flood hazard|supporting narrative|for official use|$)/i,
  );
  const block = section?.[0] ?? text;
  const sectionLabel = section ? "Proposed alternative / compensating measures" : null;
  const measures: ProposedMeasure[] = [];

  const pushMeasure = (raw: string | null | undefined) => {
    const description = usableFieldValue(raw);
    if (!description) return;
    if (/proposed alternative|compensating measures|flood hazard/i.test(description)) {
      return;
    }
    measures.push({
      id: `measure-${measures.length + 1}`,
      description,
      sourcePageNumber,
      sourceContext: sectionLabel,
    });
  };

  for (const line of block.split(/\n+/)) {
    const item = line.match(/^\s*(?:\d+\s*[.)]|[-*•])\s+(.+)$/);
    pushMeasure(item?.[1]);
  }
  if (measures.length > 0) return normalizeProposedMeasures(measures);

  // pdf.js extraction joins text items with spaces, so numbered lists often
  // appear on one line: "1. Sprinkler ... 2. Stair ... 3. Alarm ..."
  // Digits and punctuation may be split: "1 . Sprinkler ... 2 . Stair ..."
  for (const match of block.matchAll(
    /\b(\d+)\s*[.)]\s+(.+?)(?=\s\d+\s*[.)]\s|\sFlood Hazard|\sSupporting narrative|\sFOR OFFICIAL USE|$)/gi,
  )) {
    pushMeasure(match[2]);
  }
  if (measures.length > 0) return normalizeProposedMeasures(measures);

  if (!section) return normalizeProposedMeasures(measures);

  const paragraph = usableFieldValue(block.replace(/proposed alternative[^:]*:/i, ""));
  if (paragraph && !/proposed alternative|compensating measures|flood hazard/i.test(paragraph)) {
    pushMeasure(paragraph);
  }

  return normalizeProposedMeasures(measures);
}

export function heuristicExtractModificationRequest(
  pages: FormPage[],
): ExtractedModificationRequest {
  const applicantPages = applicantPagesFrom(pages);
  const text = applicantPages.map((p) => p.text).join("\n\n");
  const warnings: string[] = [];

  if (applicantPages.length === 0) {
    warnings.push("No applicant pages found; official-use sections were ignored.");
    return emptyExtractedRequest(warnings);
  }

  const citedSections = extractCitedSections(text);
  const proposedMeasures = normalizeProposedMeasures(
    applicantPages.flatMap((page) => {
      if (!/proposed alternative|compensating measures/i.test(page.text)) return [];
      return extractProposedMeasures(page.text, page.pageNumber);
    }),
  );
  const requestedModification = extractRequestedModification(text);
  const extracted = {
    projectAddress: extractAddress(text),
    requestedModification,
    citedSections,
    impracticalReason: extractImpracticalReason(text),
    compliesWithIntent: extractCompliesWithIntent(text),
    proposedMeasures,
    floodHazardApplicable: extractFloodHazard(text),
    supportingNarrative: extractNarrative(text),
    extractionWarnings: warnings,
  } satisfies ExtractedModificationRequest;

  if (!requestedModification) {
    warnings.push(HEURISTIC_FIELD_WARNINGS.requestedModification);
  }
  if (citedSections.length === 0) {
    warnings.push(HEURISTIC_FIELD_WARNINGS.citedSections);
  }
  if (proposedMeasures.length === 0) {
    warnings.push(HEURISTIC_FIELD_WARNINGS.proposedMeasures);
  }
  extracted.extractionWarnings = warnings;
  return extracted;
}

export function mergeExtractedRequests(
  primary: ExtractedModificationRequest,
  secondary: ExtractedModificationRequest,
): ExtractedModificationRequest {
  const pick = (a?: string | null, b?: string | null) => {
    const left = usableFieldValue(a);
    const right = usableFieldValue(b);
    if (left && right) return left.length >= right.length ? left : right;
    return left ?? right ?? null;
  };
  const measures = normalizeProposedMeasures([...primary.proposedMeasures]);
  const seen = new Set(measures.map((m) => m.description.toLowerCase()));
  for (const measure of normalizeProposedMeasures(secondary.proposedMeasures)) {
    const key = measure.description.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    measures.push({ ...measure, id: `measure-${measures.length + 1}` });
  }
  const warnings = [
    ...primary.extractionWarnings,
    ...secondary.extractionWarnings,
  ].filter((w, i, arr) => arr.indexOf(w) === i);

  let complies = primary.compliesWithIntent;
  if (complies == null) complies = secondary.compliesWithIntent;
  let flood = primary.floodHazardApplicable;
  if (flood == null) flood = secondary.floodHazardApplicable;

  const merged: ExtractedModificationRequest = {
    projectAddress: pick(primary.projectAddress, secondary.projectAddress),
    requestedModification:
      pick(primary.requestedModification, secondary.requestedModification) ?? "",
    citedSections: uniqueCitations([
      ...primary.citedSections,
      ...secondary.citedSections,
    ]),
    impracticalReason: pick(primary.impracticalReason, secondary.impracticalReason),
    compliesWithIntent: complies,
    proposedMeasures: normalizeProposedMeasures(measures),
    floodHazardApplicable: flood,
    supportingNarrative: pick(primary.supportingNarrative, secondary.supportingNarrative),
    extractionWarnings: warnings,
  };
  merged.extractionWarnings = reconcileExtractionWarnings(merged);
  return merged;
}

export function pagesAreSparse(pages: FormPage[]): boolean {
  const texts = (pages ?? []).map((p) => (p.text ?? "").trim());
  const total = texts.join(" ").length;
  const substantial = texts.filter((t) => t.length >= 80).length;
  return total < 240 || substantial === 0;
}
