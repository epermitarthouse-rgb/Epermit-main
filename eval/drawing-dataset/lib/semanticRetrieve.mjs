/**
 * Phase 2A.5 multi-signal evidence retrieval.
 * Similarity ranks candidates; it does not prove technical correctness.
 */

import { tokenizeEvidence } from "./layoutSemanticPrep.mjs";

export const SEMANTIC_VERSION = "phase2a5.semantic.v1";

const TECH_TERMS = new Set([
  "ada", "hydraulic", "refrigerant", "insulation", "foundation", "masonry",
  "penetration", "sprinkler", "gpm", "density", "discharge", "keyed",
  "partition", "toilet", "accessible", "clearance", "egress", "occupancy",
  "fire", "smoke", "damper", "exhaust", "hood", "panel", "transformer",
  "voltage", "conduit", "riser", "footing", "rebar", "reinforcement",
  "schedule", "detail", "section", "elevation", "note", "callout",
]);

const ABSENCE_RE = /\b(?:absence|absent|missing|no\s+(?:specific|detailed|visible)|lacks?|without|not\s+(?:shown|provided|detailed|described|indicated))\b/i;
const NUMBER_RE = /\b\d+(?:\.\d+)?\b/g;

export function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function extractNumbers(text) {
  return [...String(text || "").matchAll(NUMBER_RE)].map((match) => match[0]);
}

export function isAbsenceClaim(text) {
  return ABSENCE_RE.test(String(text || ""));
}

function locationKeywords(location) {
  return tokenizeEvidence(location).filter((token) => token.length > 2);
}

function jaccard(left, right) {
  const a = new Set(left);
  const b = new Set(right);
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const token of a) if (b.has(token)) inter += 1;
  return inter / (a.size + b.size - inter);
}

function scoreAssociation(query, item, context = {}) {
  const hay = String(item.text || "");
  const hayNorm = normalizeText(hay);
  const signals = [];
  let score = 0;

  if (query.evidenceNorm.length >= 12 && hayNorm.includes(query.evidenceNorm)) {
    score += 1.0;
    signals.push("full_normalized_span");
  } else if (query.evidenceWindow && hayNorm.includes(query.evidenceWindow)) {
    score += 0.72;
    signals.push("partial_span");
  }

  const hayTokens = tokenizeEvidence(hay);
  const shared = query.evidenceTokens.filter((token) => hayTokens.includes(token));
  const overlap = query.evidenceTokens.length
    ? shared.length / query.evidenceTokens.length
    : 0;
  const jac = jaccard(query.evidenceTokens, hayTokens);
  if (shared.length >= 2) {
    score += Math.min(0.55, overlap * 0.55 + jac * 0.25);
    signals.push("token_overlap");
  }

  const techShared = shared.filter((token) => TECH_TERMS.has(token) || query.techTokens.includes(token));
  if (techShared.length) {
    score += Math.min(0.2, techShared.length * 0.06);
    signals.push("technical_terminology");
  }

  const numberHits = query.numbers.filter((num) => hay.includes(num) || hayNorm.includes(num));
  if (numberHits.length) {
    score += Math.min(0.35, numberHits.length * 0.12);
    signals.push("numeric_fact");
  }

  const locHits = query.locationTokens.filter((token) => hayNorm.includes(token));
  if (locHits.length) {
    score += Math.min(0.18, locHits.length * 0.05);
    signals.push("location_keyword");
  }

  if (item.regionKind && query.preferredRegionKinds.includes(item.regionKind)) {
    score += 0.08;
    signals.push("spatial_region_bias");
  }

  if (context.relationshipSupport) {
    score += 0.1;
    signals.push("explicit_relationship_support");
  }

  // Observation / title tokens help paraphrased findings whose "evidence" is meta-description.
  const obsShared = query.observationTokens.filter((token) => hayTokens.includes(token));
  if (obsShared.length >= 3 && shared.length < 2) {
    score += Math.min(0.25, obsShared.length * 0.04);
    signals.push("observation_paraphrase_tokens");
  }

  return {
    score: Math.round(Math.min(score, 1.35) * 1000) / 1000,
    signals: [...new Set(signals)],
    sharedTokens: shared.slice(0, 12),
    numberHits,
    locationHits: locHits.slice(0, 8),
  };
}

function preferredRegions(location, evidence) {
  const text = `${location || ""} ${evidence || ""}`.toLowerCase();
  const kinds = [];
  if (/\bnote/.test(text)) kinds.push("notes_band", "notes");
  if (/\bschedule/.test(text)) kinds.push("schedule_candidate");
  if (/\btitle|sheet\b/.test(text)) kinds.push("title_block");
  if (/\bplan|field|detail|section|elevation|hydraulic|partition/.test(text)) kinds.push("drawing_field");
  return kinds;
}

export function buildQuery(finding) {
  const original = finding.original || finding;
  const evidence = original.drawingEvidence || "";
  const observation = original.observation || "";
  const location = original.drawingLocation || "";
  const title = original.title || "";
  const evidenceTokens = tokenizeEvidence(`${evidence} ${title}`);
  const observationTokens = tokenizeEvidence(observation);
  const evidenceNorm = normalizeText(evidence);
  const words = evidenceNorm.split(" ").filter((word) => word.length > 2);
  return {
    evidence,
    observation,
    location,
    title,
    evidenceNorm,
    evidenceTokens,
    observationTokens,
    evidenceWindow: words.length >= 4 ? words.slice(0, 6).join(" ") : null,
    numbers: extractNumbers(`${evidence} ${observation} ${location}`),
    locationTokens: locationKeywords(location),
    techTokens: [...evidenceTokens, ...observationTokens].filter((token) => TECH_TERMS.has(token)),
    preferredRegionKinds: preferredRegions(location, evidence),
    absenceClaim: isAbsenceClaim(`${evidence} ${observation}`),
    sheetRefs: [...`${evidence} ${observation} ${original.recommendation || ""}`.matchAll(
      /\b([A-Z]{1,4}-?\d{1,3}(?:\.\d{1,3})?(?:-\d{1,2})?)\b/g,
    )].map((match) => match[1]),
  };
}

function relationshipSupports(query, relationships) {
  const blob = normalizeText(query.evidence + " " + query.observation + " " + query.location);
  for (const rel of relationships || []) {
    if (!["sheet_reference", "note_number_to_callout", "equipment_tag_cooccurrence", "schedule_region_text"].includes(rel.type)) {
      continue;
    }
    const evidenceText = normalizeText((rel.evidence || []).join(" "));
    if (!evidenceText) continue;
    const shared = query.evidenceTokens.filter((token) => evidenceText.includes(token));
    if (shared.length >= 2 || query.numbers.some((num) => evidenceText.includes(num))) {
      return true;
    }
    if (rel.type === "note_number_to_callout" && /\bnote\b/.test(blob) && evidenceText) {
      return true;
    }
  }
  return false;
}

/**
 * Retrieve ranked evidence candidates from a layout page record.
 */
export function retrieveEvidenceCandidates(finding, page, options = {}) {
  const maxCandidates = options.maxCandidates ?? 8;
  if (!page) {
    return {
      status: "no_layout_page",
      query: buildQuery(finding),
      candidates: [],
      retrievalSuccess: false,
    };
  }
  const query = buildQuery(finding);
  const relSupport = relationshipSupports(query, page.relationships);
  const scored = [];
  for (const item of page.associations || []) {
    if (!item?.text) continue;
    const rated = scoreAssociation(query, item, { relationshipSupport: relSupport });
    if (rated.score < 0.12 && rated.signals.length === 0) continue;
    if (rated.score < 0.18 && !rated.signals.includes("numeric_fact") && !rated.signals.includes("full_normalized_span")) {
      continue;
    }
    scored.push({
      text: String(item.text).slice(0, 240),
      bbox: item.bbox || null,
      regionId: item.regionId || null,
      regionKind: item.regionKind || null,
      origin: item.origin || null,
      extractionMethod: item.extractionMethod || null,
      associationMethod: item.associationMethod || null,
      score: rated.score,
      signals: rated.signals,
      sharedTokens: rated.sharedTokens,
      numberHits: rated.numberHits,
      locationHits: rated.locationHits,
      independentlyVerified: false,
      role: "evidence_candidate",
    });
  }

  // Also score text clusters (often better for multi-line notes).
  for (const cluster of page.clusters || []) {
    if (!cluster?.text) continue;
    const rated = scoreAssociation(query, { text: cluster.text, regionKind: cluster.kind }, { relationshipSupport: relSupport });
    if (rated.score < 0.22) continue;
    scored.push({
      text: String(cluster.text).slice(0, 240),
      bbox: cluster.bbox || null,
      regionId: null,
      regionKind: cluster.kind || null,
      clusterId: cluster.id,
      origin: (cluster.origins || [])[0] || null,
      extractionMethod: (cluster.extractionMethods || [])[0] || null,
      associationMethod: "cluster",
      score: rated.score,
      signals: [...rated.signals, "text_cluster"],
      sharedTokens: rated.sharedTokens,
      numberHits: rated.numberHits,
      locationHits: rated.locationHits,
      independentlyVerified: false,
      role: "evidence_candidate",
    });
  }

  scored.sort((left, right) => right.score - left.score || (right.sharedTokens?.length || 0) - (left.sharedTokens?.length || 0));
  const deduped = [];
  const seen = new Set();
  for (const candidate of scored) {
    const key = `${normalizeText(candidate.text).slice(0, 80)}|${candidate.regionId || candidate.clusterId || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
    if (deduped.length >= maxCandidates) break;
  }

  return {
    status: deduped.length ? "candidates_retrieved" : "no_candidates",
    query,
    relationshipSupport: relSupport,
    candidates: deduped,
    retrievalSuccess: deduped.length > 0,
    bestScore: deduped[0]?.score || 0,
  };
}
