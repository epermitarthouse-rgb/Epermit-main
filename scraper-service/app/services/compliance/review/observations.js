"use strict";

const FACT_PATTERNS = [
  { element: "dimension", re: /\d+(?:\.\d+)?\s*(?:["″]|in(?:ch(?:es)?)?|ft|feet|')/i },
  { element: "fire_rating", re: /\bone\s+hours?\b|\b[1I]\s*h(?:r)?\b|\b\d+(?:\.\d+)?\s*-?\s*(?:hours?|hrs?|hr|minutes?|mins?)\b/i },
  { element: "emergency_lighting", re: /\bemergency\s+light/i },
  { element: "plumbing_note", re: /\bwater[\s-]*hammer|\bgfci\b|\bdraft[\s-]*stop\b/i },
  { element: "sheet_reference", re: /\b[A-Z]{1,3}-\d+(?:\.\d+)+\b/ },
  { element: "tag", re: /\b(?:KH|EL|WT|PT)-\d+\b|\bwall\s+type\b/i },
  { element: "note", re: /\b(?:note|shall|provide|legend|schedule)\b/i },
];

/**
 * @param {string} text
 */
function classifyElement(text) {
  for (const pattern of FACT_PATTERNS) {
    if (pattern.re.test(text)) return pattern.element;
  }
  return null;
}

/**
 * Observations are copied from extracted text or real regions.
 * A quote is stored only when that string is in the source text.
 * A region is stored only when coordinates were supplied.
 * @param {{
 *   sheetId?: string | null;
 *   fileName?: string | null;
 *   page?: number | null;
 *   title?: string | null;
 *   discipline?: string | null;
 *   pageText?: string | null;
 *   items?: Array<{ str?: string; region?: Record<string, unknown> | null }>;
 * }} input
 */
function buildObservations(input) {
  const source = String(input.pageText || "");
  const observations = [];
  const seen = new Set();
  const items = Array.isArray(input.items) && input.items.length
    ? input.items
    : source
        .split(/\n+/)
        .map((line) => ({ str: line.trim(), region: null }))
        .filter((item) => item.str);

  for (const item of items) {
    const region = item.region && typeof item.region === "object" ? item.region : null;
    if (item.readable === false && region) {
      const key = `unreadable|${region.x || 0}|${region.y || 0}`;
      if (seen.has(key)) continue;
      seen.add(key);
      observations.push({
        sheetId: input.sheetId || null,
        fileName: input.fileName || null,
        page: input.page ?? null,
        title: input.title || null,
        discipline: input.discipline || null,
        element: "graphic",
        observedValue: null,
        evidenceType: "unreadable_region",
        quote: null,
        region,
        confidence: "unreadable",
        limitations: item.limitations || "The crop was rendered from the original PDF and remains unreadable.",
        extractionMethod: item.extractionMethod || "ocr-crop",
        kind: "unknown",
      });
      if (observations.length >= 80) break;
      continue;
    }
    const quote = String(item.str || "").replace(/\s+/g, " ").trim();
    if (quote.length < 2 || quote.length > 240) continue;
    if (source && !source.includes(quote) && !source.replace(/\s+/g, " ").includes(quote)) continue;
    const element = classifyElement(quote);
    if (!element) continue;
    const key = `${element}|${quote.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const method = String(item.extractionMethod || "");
    const fromOcr = /vision|ocr|tesseract/.test(method);
    observations.push({
      sheetId: input.sheetId || null,
      fileName: input.fileName || null,
      page: input.page ?? null,
      title: input.title || null,
      discipline: input.discipline || null,
      element,
      observedValue: quote,
      evidenceType: fromOcr ? "ocr_crop" : region ? "text_layer_region" : "text_layer",
      quote,
      region,
      confidence: item.confidence ?? "extracted",
      limitations: region ? null : "Text was extracted without a PDF region.",
      extractionMethod: item.extractionMethod || (region ? "pdfjs-text-layer" : "pdf-text"),
      kind: "observed_fact",
    });
    if (observations.length >= 80) break;
  }
  return observations;
}

module.exports = {
  buildObservations,
  classifyElement,
};
