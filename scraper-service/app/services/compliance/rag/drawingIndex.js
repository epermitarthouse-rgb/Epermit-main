"use strict";

const { extractIdentifiers, normalizeIdentifier, sheetNumberFromName } = require("./identifiers.js");

const MAX_HITS = 8;
const MAX_QUOTE = 320;

/**
 * In-run drawing evidence index. Idempotent by project, document, sheet, and page.
 * Stores text, observations, and region coordinates. It does not store page images.
 */
function createDrawingIndex() {
  /** @type {Map<string, Record<string, unknown>>} */
  const records = new Map();
  return {
    upsert(record) {
      const key = [
        record.projectId || "",
        record.documentId || "",
        record.sheetId || record.fileName || "",
        record.pageNumber || 1,
      ].join(":");
      const next = {
        ...record,
        sheetNumber: record.sheetNumber || sheetNumberFromName(record.fileName),
        identifiers: [
          ...new Set([
            ...(record.identifiers || []),
            ...extractIdentifiers(`${record.fileName || ""} ${record.title || ""} ${record.text || ""}`),
          ]),
        ],
        references: record.references || extractIdentifiers(record.text),
      };
      const prev = records.get(key);
      if (
        prev &&
        prev.text === next.text &&
        (prev.regions || []).length === (next.regions || []).length &&
        (prev.observations || []).length === (next.observations || []).length
      ) {
        return prev;
      }
      records.set(key, next);
      return next;
    },
    list() {
      return [...records.values()];
    },
    get size() {
      return records.size;
    },
  };
}

function tokenSet(text) {
  return new Set(
    String(text || "")
      .toLowerCase()
      .split(/[^a-z0-9.]+/)
      .filter((token) => token.length > 2),
  );
}

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / Math.sqrt(na * nb);
}

/**
 * Quote must be a verbatim slice of the record text or an observation quote.
 * @param {Record<string, unknown>} record
 * @param {string[]} needles
 */
function quoteFromRecord(record, needles) {
  const text = String(record.text || "");
  const observations = Array.isArray(record.observations) ? record.observations : [];
  for (const needle of needles) {
    const raw = String(needle || "").trim();
    if (raw.length < 2) continue;
    const at = text.toLowerCase().indexOf(raw.toLowerCase());
    if (at >= 0) {
      const start = Math.max(0, at - 40);
      const slice = text.slice(start, at + raw.length + 80).replace(/\s+/g, " ").trim();
      return slice.slice(0, MAX_QUOTE);
    }
    for (const observation of observations) {
      const quote = String(observation.quote || "");
      if (quote && quote.toLowerCase().includes(raw.toLowerCase())) return quote.slice(0, MAX_QUOTE);
    }
  }
  const fallback = text.replace(/\s+/g, " ").trim().slice(0, 160);
  return fallback || null;
}

/**
 * Hybrid rank: exact identifiers, metadata, keywords, cross-sheet references, optional vectors.
 * @param {ReturnType<createDrawingIndex> | { list: () => Array<Record<string, unknown>> }} index
 * @param {{
 *   topics?: string[];
 *   identifiers?: string[];
 *   discipline?: string | null;
 *   currentSheetId?: string | null;
 *   queryEmbedding?: number[] | null;
 *   limit?: number;
 * }} query
 */
function hybridRetrieveDrawings(index, query) {
  const topics = (query.topics || []).map((topic) => topic.toLowerCase()).filter(Boolean);
  const identifiers = (query.identifiers || []).map(normalizeIdentifier).filter(Boolean);
  const limit = Math.max(1, Math.min(query.limit || MAX_HITS, MAX_HITS));
  const hits = [];

  for (const record of index.list()) {
    if (query.currentSheetId && record.sheetId && String(record.sheetId) === String(query.currentSheetId)) {
      continue;
    }
    if (query.discipline && record.discipline && String(record.discipline).toLowerCase() !== query.discipline.toLowerCase()) {
      const topicHit = topics.some((topic) => String(record.text || "").toLowerCase().includes(topic));
      const idHit = identifiers.some((id) =>
        (record.identifiers || []).some((item) => normalizeIdentifier(item).includes(id)),
      );
      if (!topicHit && !idHit) continue;
    }

    const haystack = `${record.fileName || ""} ${record.title || ""} ${record.text || ""} ${record.sheetNumber || ""}`.toLowerCase();
    const recordIds = (record.identifiers || []).map(normalizeIdentifier);
    let exact = 0;
    const matchedIds = [];
    for (const id of identifiers) {
      if (recordIds.some((item) => item.includes(id) || id.includes(item))) {
        exact += 10;
        matchedIds.push(id);
      }
    }
    let keyword = 0;
    const matchedTopics = [];
    for (const topic of topics) {
      if (haystack.includes(topic.toLowerCase())) {
        keyword += 3;
        matchedTopics.push(topic);
      }
    }
    const queryTokens = tokenSet(topics.join(" "));
    const recordTokens = tokenSet(haystack);
    let overlap = 0;
    for (const token of queryTokens) if (recordTokens.has(token)) overlap += 1;
    const referenceBoost = (record.references || []).some((ref) =>
      identifiers.includes(normalizeIdentifier(ref)),
    )
      ? 4
      : 0;
    const vector = cosine(query.queryEmbedding, record.embedding);
    const phrase = keyword > 0;
    if (exact === 0 && !phrase && vector < 0.5) continue;
    const score = exact + keyword + overlap + referenceBoost + vector * 5;
    const needles = [...matchedTopics, ...matchedIds, ...topics];
    const quote = quoteFromRecord(record, needles);
    if (!quote) continue;
    const region = Array.isArray(record.regions) && record.regions.length ? record.regions[0] : null;
    hits.push({
      sourceType: "drawing",
      projectId: record.projectId || null,
      documentId: record.documentId || null,
      sheetId: record.sheetId || null,
      fileName: record.fileName || null,
      sheetNumber: record.sheetNumber || null,
      pageNumber: record.pageNumber || null,
      discipline: record.discipline || null,
      revision: record.revision || null,
      quote,
      region,
      score,
      matchedTopics,
      matchedIds,
      extractionMethod: record.extractionMethod || "pdfjs-text-layer",
      provesRequirementSatisfied: false,
      provenance: {
        method: "hybrid-drawing",
        legs: {
          exactIdentifier: exact > 0,
          keyword: keyword > 0,
          tokenOverlap: overlap > 0,
          crossSheetReference: referenceBoost > 0,
          vector: vector > 0,
        },
      },
    });
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

module.exports = {
  createDrawingIndex,
  hybridRetrieveDrawings,
  cosine,
  MAX_HITS,
};
