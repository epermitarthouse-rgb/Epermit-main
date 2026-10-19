"use strict";

const {
  extractIdentifiers,
  extractCrossSheetRefs,
  identifiersEqual,
  normalizeIdentifier,
  sheetNumberFromName,
} = require("./identifiers.js");
const { prefixOf } = require("../review/disciplines.js");

const MAX_HITS = 8;
const MAX_QUOTE = 320;
const MAX_CHUNK_CHARS = 1000;
const MAX_CHUNKS = 16;
const CHUNK_OVERLAP = 80;

const PREFIX_DISCIPLINE = {
  A: "architectural",
  G: "architectural",
  LS: "egress_life_safety",
  DM: "architectural",
  CV: "architectural",
  E: "electrical",
  P: "plumbing",
  M: "mechanical",
  MD: "mechanical",
  S: "structural",
  FP: "fire_protection",
  EQ: "equipment",
  EN: "energy",
  FS: "equipment",
  K: "equipment",
};

const GENERIC_TOPIC = new Set([
  "width", "note", "notes", "plan", "plans", "sheet", "door", "wall", "type", "detail",
  "details", "schedule", "legend", "room", "area", "height", "length", "size", "clear",
  "exit", "access", "general", "information", "documentation", "compliance", "required",
  "provide", "floor", "section", "symbol", "typical", "shown", "missing",
]);

const INTERESTING_RE =
  /\b(?:shall|provide|insulation|corridor|egress|accessible|sprinkler|rating|schedule|see sheet|refer to|[A-Z]{1,4}-\d+(?:\.\d+)+)\b/gi;

function unique(values) {
  const out = [];
  const seen = new Set();
  for (const value of values || []) {
    const text = String(value || "").trim();
    if (!text) continue;
    const key = text.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function inferDiscipline(record) {
  const current = String(record.discipline || "").trim();
  if (current && !/^(general|unknown|unspecified|n\/a|na|null)$/i.test(current)) return current;
  const prefix = prefixOf(record.fileName || record.sheetNumber || record.title || "");
  return PREFIX_DISCIPLINE[prefix] || null;
}

function splitEvidence(text) {
  if (!text) return [];
  if (text.length <= MAX_CHUNK_CHARS) {
    return [{ text, charStart: 0, charEnd: text.length }];
  }
  const interesting = [];
  const marker = new RegExp(INTERESTING_RE.source, "gi");
  let match;
  while ((match = marker.exec(text)) && interesting.length < MAX_CHUNKS) {
    const start = Math.max(0, match.index - 180);
    const end = Math.min(text.length, start + MAX_CHUNK_CHARS);
    interesting.push({ charStart: start, charEnd: end });
    if (match.index === marker.lastIndex) marker.lastIndex += 1;
  }
  const slots = Math.max(1, MAX_CHUNKS - interesting.length);
  const stride = Math.max(
    MAX_CHUNK_CHARS - CHUNK_OVERLAP,
    Math.ceil((text.length - MAX_CHUNK_CHARS) / Math.max(1, slots - 1)),
  );
  const sampled = [];
  for (let index = 0; index < slots; index += 1) {
    const start = Math.min(index * stride, Math.max(0, text.length - MAX_CHUNK_CHARS));
    const end = Math.min(text.length, start + MAX_CHUNK_CHARS);
    sampled.push({ charStart: start, charEnd: end });
    if (end >= text.length) break;
  }
  const windows = [...interesting, ...sampled].sort((a, b) => a.charStart - b.charStart);
  const kept = [];
  for (const window of windows) {
    const previous = kept[kept.length - 1];
    if (previous && window.charStart < previous.charStart + 400) continue;
    const slice = text.slice(window.charStart, window.charEnd).trim();
    if (!slice) continue;
    kept.push({ text: slice, charStart: window.charStart, charEnd: window.charEnd });
    if (kept.length >= MAX_CHUNKS) break;
  }
  return kept.length ? kept : [{ text: text.slice(0, MAX_CHUNK_CHARS), charStart: 0, charEnd: Math.min(text.length, MAX_CHUNK_CHARS) }];
}

/**
 * Bounded evidence chunks for one sheet. Already-bounded chunks are kept as-is.
 * @param {Record<string, unknown>} record
 */
function buildDrawingChunks(record) {
  const text = String(record?.text || "").replace(/\u0000/g, "").trim();
  const sheetNumber = record?.sheetNumber || sheetNumberFromName(record?.fileName);
  const discipline = inferDiscipline({ ...record, sheetNumber });
  const bounded = Number.isInteger(record?.chunkIndex) && text.length <= MAX_CHUNK_CHARS;
  const pieces = bounded
    ? [{ text, charStart: Number(record.charStart) || 0, charEnd: Number(record.charEnd) || text.length }]
    : splitEvidence(text);
  const sourcePieces = pieces.length ? pieces : [{ text: "", charStart: 0, charEnd: 0 }];
  return sourcePieces.map((piece, index) => {
    const chunkIndex = bounded ? record.chunkIndex : index;
    const identifiers = unique([
      sheetNumber,
      ...(record.identifiers || []),
      ...extractIdentifiers(`${record.fileName || ""} ${record.title || ""} ${piece.text}`),
    ]);
    const references = unique([
      ...(record.references || []),
      ...(record.crossSheetRefs || []),
      ...extractCrossSheetRefs(piece.text, sheetNumber),
    ]);
    return {
      ...record,
      sheetNumber: sheetNumber || null,
      discipline,
      text: piece.text,
      chunkIndex,
      charStart: piece.charStart,
      charEnd: piece.charEnd,
      identifiers,
      references,
      embeddingStatus: record.embeddingStatus || (record.embedding ? "present" : undefined),
      sourceLocation: {
        pageNumber: Number(record.pageNumber) || 1,
        charStart: piece.charStart,
        charEnd: piece.charEnd,
      },
    };
  });
}

/**
 * In-run drawing evidence index. Idempotent by project, document, sheet, page, and chunk.
 * Stores text, observations, and region coordinates. It does not store page images.
 */
function createDrawingIndex() {
  /** @type {Map<string, Record<string, unknown>>} */
  const records = new Map();
  return {
    upsert(record) {
      const chunks = buildDrawingChunks(record || {});
      let stored = null;
      for (const chunk of chunks) {
        const key = [
          chunk.projectId || "",
          chunk.documentId || "",
          chunk.sheetId || chunk.fileName || "",
          chunk.pageNumber || 1,
          chunk.chunkIndex || 0,
        ].join(":");
        const next = {
          ...chunk,
          identifiers: unique(chunk.identifiers),
          references: unique(chunk.references),
        };
        const prev = records.get(key);
        if (
          prev &&
          prev.text === next.text &&
          (prev.regions || []).length === (next.regions || []).length &&
          (prev.observations || []).length === (next.observations || []).length &&
          prev.embeddingStatus === next.embeddingStatus &&
          (prev.embedding || null) === (next.embedding || null)
        ) {
          stored = prev;
          continue;
        }
        records.set(key, next);
        stored = next;
      }
      return stored;
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
      .filter((token) => token.length > 2 && !GENERIC_TOPIC.has(token)),
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

function hasEmbedding(record) {
  return Array.isArray(record?.embedding) && record.embedding.length > 0 && record.embeddingStatus !== "missing";
}

function embeddingStatusOf(record) {
  if (record?.embeddingStatus) return record.embeddingStatus;
  return hasEmbedding(record) ? "present" : "missing";
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
  return null;
}

function disciplineNames(query) {
  return [query?.discipline, ...(query?.disciplines || [])]
    .map((value) => String(value || "").toLowerCase())
    .filter(Boolean);
}

function disciplineCompatible(query, record) {
  const wanted = disciplineNames(query);
  const have = String(record?.discipline || "").toLowerCase();
  if (!wanted.length || !have || have === "general") return false;
  return wanted.some((name) => have === name || have.includes(name) || name.includes(have));
}

function topicRelevant(topic, text, title) {
  const needle = String(topic || "").toLowerCase().trim();
  if (needle.length < 2) return { kind: null };
  const phrase = needle.includes(" ");
  const generic = !phrase && GENERIC_TOPIC.has(needle);
  if (text.includes(needle) && (phrase || !generic)) return { kind: "text", generic: false };
  if (title.includes(needle) && (phrase || !generic)) return { kind: "metadata", generic: false };
  if (text.includes(needle) && generic) return { kind: "generic", generic: true };
  return { kind: null };
}

/**
 * Hybrid rank: exact identifiers, metadata, keywords, cross-sheet references, optional vectors.
 * Low-relevance sheets are omitted. A missing embedding is not a match.
 * @param {ReturnType<createDrawingIndex> | { list: () => Array<Record<string, unknown>> }} index
 * @param {{
 *   topics?: string[];
 *   identifiers?: string[];
 *   discipline?: string | null;
 *   disciplines?: string[];
 *   currentSheetId?: string | null;
 *   queryEmbedding?: number[] | null;
 *   limit?: number;
 * }} query
 */
function hybridRetrieveDrawings(index, query) {
  const topics = (query.topics || []).map((topic) => String(topic || "").toLowerCase().trim()).filter(Boolean);
  const identifiers = (query.identifiers || []).map(normalizeIdentifier).filter((id) => id.length >= 3);
  const limit = Math.max(1, Math.min(query.limit || MAX_HITS, MAX_HITS));
  const hits = [];

  for (const record of index.list()) {
    if (query.currentSheetId && record.sheetId && String(record.sheetId) === String(query.currentSheetId)) {
      continue;
    }
    const text = String(record.text || "").toLowerCase();
    const title = `${record.title || ""} ${record.sheetNumber || ""} ${record.contentClass || ""} ${record.fileName || ""}`.toLowerCase();
    const recordIds = (record.identifiers || []).map(normalizeIdentifier).filter(Boolean);
    const matchedIds = [];
    let exact = 0;
    for (const id of identifiers) {
      const idHit = recordIds.some((item) => identifiersEqual(item, id))
        || identifiersEqual(record.sheetNumber, id);
      if (idHit) {
        exact += 20;
        matchedIds.push(id);
      }
    }
    const matchedTopics = [];
    let keyword = 0;
    let metadata = 0;
    let genericHits = 0;
    for (const topic of topics) {
      const found = topicRelevant(topic, text, title);
      if (found.kind === "text") {
        keyword += topic.includes(" ") ? 8 : 5;
        matchedTopics.push(topic);
      } else if (found.kind === "metadata") {
        metadata += 4;
        matchedTopics.push(topic);
      } else if (found.kind === "generic") {
        genericHits += 1;
      }
    }
    const referenceBoost = (record.references || []).some((ref) =>
      identifiers.some((id) => identifiersEqual(ref, id)),
    )
      ? 12
      : 0;
    const compatible = disciplineCompatible(query, record);
    const sharedTopic = matchedTopics.length > 0;
    const sharedId = exact > 0 || referenceBoost > 0;
    const embeddingStatus = embeddingStatusOf(record);
    const embedded = embeddingStatus === "present" && hasEmbedding(record);
    const vectorScore = embedded ? cosine(query.queryEmbedding, record.embedding) : 0;
    const vectorUseful = embedded && vectorScore >= 0.5 && (sharedTopic || sharedId || (compatible && genericHits > 0));
    const relevant = sharedId || sharedTopic || vectorUseful;
    if (!relevant) continue;
    const overlapTokens = tokenSet(topics.join(" "));
    const recordTokens = tokenSet(text);
    let overlap = 0;
    for (const token of overlapTokens) if (recordTokens.has(token)) overlap += 1;
    const disciplineBonus = compatible && (sharedTopic || sharedId) ? 3 : 0;
    const score = exact + keyword + metadata + referenceBoost + disciplineBonus + Math.min(overlap, 3) + (vectorUseful ? vectorScore * 5 : 0);
    const needles = [...matchedTopics, ...matchedIds.map((id) => id), ...topics.filter((topic) => text.includes(topic))];
    let quote = quoteFromRecord(record, needles);
    if (!quote && sharedId) quote = quoteFromRecord(record, [record.sheetNumber, ...(record.identifiers || [])]);
    if (!quote) continue;
    const region = Array.isArray(record.regions) && record.regions.length ? record.regions[0] : record.sourceLocation || null;
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
      diagnostics: {
        embeddingStatus,
        relevant: true,
      },
      provenance: {
        method: "hybrid-drawing",
        embeddingStatus,
        legs: {
          exactIdentifier: exact > 0,
          keyword: keyword > 0,
          metadata: metadata > 0,
          tokenOverlap: overlap > 0,
          crossSheetReference: referenceBoost > 0,
          discipline: compatible,
          vector: vectorUseful,
        },
      },
    });
  }

  hits.sort((a, b) => b.score - a.score || String(a.fileName || "").localeCompare(String(b.fileName || "")));
  return hits.slice(0, limit);
}

/**
 * Embed chunk and question text when a caller injects the existing embed function.
 * A failure leaves embeddingStatus "missing" and does not invent a vector match.
 * @param {ReturnType<createDrawingIndex>} index
 * @param {Array<{ id?: string; topics?: string[]; identifiers?: string[] }>} questions
 * @param {((texts: string[]) => Promise<number[][]>) | null | undefined} embedTexts
 */
async function applyQueryEmbeddings(index, questions, embedTexts) {
  const records = index.list();
  if (typeof embedTexts !== "function") {
    for (const record of records) {
      if (!record.embeddingStatus) record.embeddingStatus = hasEmbedding(record) ? "present" : "unavailable";
    }
    return { embeddingStatus: "unavailable", embedded: 0, queryEmbeddings: {} };
  }
  const pending = records.filter((record) => !hasEmbedding(record));
  const queries = (questions || []).map((question) => ({
    id: question.id,
    text: [...(question.topics || []), ...(question.identifiers || [])].filter(Boolean).join(" "),
  }));
  const inputs = [...pending.map((record) => String(record.text || "").slice(0, 2000)), ...queries.map((query) => query.text || "drawing")];
  if (!inputs.length) return { embeddingStatus: "present", embedded: 0, queryEmbeddings: {} };
  try {
    const vectors = await embedTexts(inputs);
    if (!Array.isArray(vectors) || vectors.length !== inputs.length) {
      throw new Error("embedding count did not match input");
    }
    pending.forEach((record, indexPosition) => {
      const vector = vectors[indexPosition];
      if (Array.isArray(vector) && vector.length) {
        record.embedding = vector;
        record.embeddingStatus = "present";
      } else {
        record.embedding = null;
        record.embeddingStatus = "missing";
      }
    });
    const queryEmbeddings = {};
    queries.forEach((query, indexPosition) => {
      queryEmbeddings[query.id] = vectors[pending.length + indexPosition];
    });
    const missing = records.some((record) => record.embeddingStatus === "missing");
    return { embeddingStatus: missing ? "missing" : "present", embedded: pending.length, queryEmbeddings };
  } catch {
    for (const record of records) {
      if (!hasEmbedding(record)) {
        record.embedding = null;
        record.embeddingStatus = "missing";
      }
    }
    return { embeddingStatus: "missing", embedded: 0, queryEmbeddings: {} };
  }
}

module.exports = {
  createDrawingIndex,
  buildDrawingChunks,
  hybridRetrieveDrawings,
  applyQueryEmbeddings,
  cosine,
  MAX_HITS,
  MAX_CHUNK_CHARS,
  MAX_CHUNKS,
};
