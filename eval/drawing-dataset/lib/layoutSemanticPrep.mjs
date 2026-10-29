/**
 * Phase 2A.5 preparation helpers.
 * Produces paraphrase-tolerant region candidates without claiming grounding gains.
 */

const STOP = new Set([
  "the", "and", "for", "with", "from", "that", "this", "shall", "must", "provide",
  "provided", "per", "see", "note", "notes", "drawing", "drawings", "sheet", "plan",
  "area", "room", "inch", "inches", "feet", "foot", "clear", "width", "height",
]);

export function tokenizeEvidence(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP.has(token));
}

/**
 * Rank region-associated OCR/text blocks by shared significant tokens.
 * Status values here must never be counted as layoutMatched / verified grounding.
 */
export function paraphraseRegionCandidates(evidence, associations, options = {}) {
  const minShared = options.minSharedTokens ?? 3;
  const maxCandidates = options.maxCandidates ?? 5;
  const tokens = tokenizeEvidence(evidence);
  if (tokens.length < minShared) {
    return {
      status: "insufficient_tokens",
      groundingClaimed: false,
      independentlyVerified: false,
      candidates: [],
      note: "Too few significant tokens for paraphrase candidate ranking.",
    };
  }
  const scored = [];
  for (const item of associations || []) {
    const hayTokens = new Set(tokenizeEvidence(item.text));
    if (!hayTokens.size) continue;
    const shared = tokens.filter((token) => hayTokens.has(token));
    if (shared.length < minShared) continue;
    const score = shared.length / tokens.length;
    scored.push({
      regionId: item.regionId,
      regionKind: item.regionKind,
      associationMethod: item.associationMethod || null,
      origin: item.origin || null,
      extractionMethod: item.extractionMethod || null,
      sharedTokens: shared.slice(0, 12),
      sharedCount: shared.length,
      score: Math.round(score * 1000) / 1000,
      sampleText: String(item.text || "").slice(0, 160),
      independentlyVerified: false,
    });
  }
  scored.sort((left, right) => right.sharedCount - left.sharedCount || right.score - left.score);
  const candidates = scored.slice(0, maxCandidates);
  return {
    status: candidates.length ? "paraphrase_token_overlap_candidate" : "no_paraphrase_candidate",
    groundingClaimed: false,
    independentlyVerified: false,
    evidenceTokenCount: tokens.length,
    candidates,
    note: candidates.length
      ? "Prep-only paraphrase candidates for Phase 2A.5. Not counted as layout grounding."
      : "No region text shared enough significant tokens with the finding evidence.",
  };
}

export function prepareFindingSemanticRows(findings, pageByPath) {
  return (findings || []).map((row) => {
    const original = row.original || row;
    const page = pageByPath.get(row.relativePath) || null;
    const prep = page
      ? paraphraseRegionCandidates(original.drawingEvidence, page.associations)
      : {
        status: "no_layout_page",
        groundingClaimed: false,
        independentlyVerified: false,
        candidates: [],
        note: "Finding sheet has no layout page record in this run.",
      };
    return {
      clientReportId: row.clientReportId,
      wordingSha256: row.wordingSha256,
      relativePath: row.relativePath,
      sheetNumber: row.sheetNumber,
      labelStatus: row.labelStatus,
      originalEvidence: original.drawingEvidence,
      wordingUnchanged: true,
      layoutGroundingStatus: row.layoutGrounding?.status || null,
      semanticPrep: prep,
      groundingClaimed: false,
      independentlyVerified: false,
    };
  });
}
