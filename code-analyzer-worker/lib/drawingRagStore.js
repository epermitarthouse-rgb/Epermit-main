"use strict";

const crypto = require("crypto");
const { vectorToPg } = require("./chunk.js");
const { buildDrawingChunks } = require("../../scraper-service/app/services/compliance/rag/drawingIndex.js");

const TABLE = "code_analyzer_drawing_chunks";

function fingerprint(text) {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex").slice(0, 32);
}

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function chunkKey(record) {
  const chunkIndex = Number.isInteger(record.chunkIndex)
    ? record.chunkIndex
    : Number.isInteger(record.chunk_index)
      ? record.chunk_index
      : 0;
  return [
    record.documentId || record.document_id || "none",
    record.sheetId || record.sheet_id || record.fileName || record.file_name || "sheet",
    record.pageNumber || record.page_number || 1,
    record.revision || "unspecified",
    chunkIndex,
  ].join(":");
}

function embeddingValue(record) {
  if (Array.isArray(record.embedding) && record.embedding.length === 1536) return vectorToPg(record.embedding);
  if (typeof record.embedding === "string" && record.embedding.startsWith("[")) return record.embedding;
  return null;
}

function parseEmbedding(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.startsWith("[")) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function sheetIdentity(row) {
  return [
    row.project_id,
    row.document_id || "",
    row.sheet_id || "",
    row.file_name || "",
    row.page_number || 1,
    row.revision || "",
  ].join("|");
}

/**
 * Drawing identity across documents: the sheet number when known, otherwise the file
 * name and page. A newer document with the same identity replaces the older one.
 */
function drawingIdentity(row) {
  const number = String(row.sheet_number || "").toUpperCase().replace(/[\s\-_.]/g, "");
  if (number) return `${row.project_id}|n:${number}`;
  const name = String(row.file_name || "").toLowerCase().replace(/\.[a-z0-9]+$/, "").trim();
  if (!name) return null;
  return `${row.project_id}|f:${name}|p:${row.page_number || 1}`;
}

/**
 * Active rows can still hold an older document for the same drawing (written before
 * replacement retirement existed). Keep only the most recently written document per drawing.
 * @param {Array<Record<string, unknown>>} rows
 */
function latestDocumentPerDrawing(rows) {
  const newest = new Map();
  for (const row of rows) {
    const identity = drawingIdentity(row);
    if (!identity || !row.document_id) continue;
    const at = String(row.updated_at || row.created_at || "");
    const prior = newest.get(identity);
    if (!prior || at > prior.at) newest.set(identity, { documentId: row.document_id, at });
  }
  return rows.filter((row) => {
    const identity = drawingIdentity(row);
    if (!identity || !row.document_id) return true;
    return newest.get(identity)?.documentId === row.document_id;
  });
}

function summarizeEmbeddings(records) {
  if (!records.length) return "unavailable";
  if (records.every((record) => record.embeddingStatus === "present")) return "present";
  if (records.some((record) => record.embeddingStatus === "missing")) return "missing";
  return "unavailable";
}

async function applyEmbeddings(records, embedTexts) {
  const indexes = [];
  const next = records.map((record, index) => {
    if (Array.isArray(record.embedding) && record.embedding.length === 1536) {
      return { ...record, embeddingStatus: "present" };
    }
    if (typeof record.embedding === "string" && record.embedding.startsWith("[")) {
      return { ...record, embeddingStatus: "present" };
    }
    indexes.push(index);
    return { ...record, embedding: null };
  });
  if (!indexes.length) return next;
  if (typeof embedTexts !== "function") {
    for (const index of indexes) next[index].embeddingStatus = "unavailable";
    return next;
  }
  try {
    const vectors = await embedTexts(indexes.map((index) => String(next[index].text || "").slice(0, 2000)));
    if (!Array.isArray(vectors) || vectors.length !== indexes.length) throw new Error("embedding count");
    indexes.forEach((index, position) => {
      const vector = vectors[position];
      if (Array.isArray(vector) && vector.length === 1536) {
        next[index].embedding = vector;
        next[index].embeddingStatus = "present";
      } else {
        next[index].embedding = null;
        next[index].embeddingStatus = "missing";
      }
    });
    return next;
  } catch {
    for (const index of indexes) {
      next[index].embedding = null;
      next[index].embeddingStatus = "missing";
    }
    return next;
  }
}

/**
 * Attach a stored embedding when the chunk key and text fingerprint are unchanged,
 * so a rerun on the same drawings does not pay to embed the same text again.
 * @param {Array<Record<string, unknown>>} expanded
 * @param {Map<string, { content_fingerprint?: string; embedding?: unknown }>} existingByKey keyed by `${project_id}:${chunk_key}`
 */
function reuseStoredEmbeddings(expanded, existingByKey) {
  let reused = 0;
  const next = expanded.map((record) => {
    if (embeddingValue(record)) return record;
    const row = recordToRow(record);
    const prior = existingByKey.get(`${row.project_id}:${row.chunk_key}`);
    if (!prior || prior.content_fingerprint !== row.content_fingerprint) return record;
    const embedding = Array.isArray(prior.embedding) ? prior.embedding : parseEmbedding(prior.embedding);
    if (!Array.isArray(embedding) || embedding.length !== 1536) return record;
    reused += 1;
    return { ...record, embedding, embeddingStatus: "present" };
  });
  return { records: next, reused };
}

function expandRecords(records) {
  const expanded = [];
  for (const record of records || []) {
    const projectId = record?.projectId || record?.project_id;
    if (!projectId) continue;
    const chunks = buildDrawingChunks({ ...record, projectId });
    for (const chunk of chunks) expanded.push({ ...chunk, projectId });
  }
  return expanded;
}

function stripRaster(value) {
  if (!value || typeof value !== "object") return null;
  const copy = { ...value };
  delete copy.imageBase64;
  delete copy.image;
  delete copy.png;
  delete copy.imageType;
  return copy;
}

function recordToRow(record) {
  const text = String(record.text || "").slice(0, 12000) || "(no extracted text)";
  const observations = (record.observations || []).slice(0, 40).map((item) => ({
    element: item.element || null,
    quote: item.quote || null,
    observedValue: item.observedValue || null,
    region: stripRaster(item.region),
    evidenceType: item.evidenceType || null,
    extractionMethod: item.extractionMethod || null,
    limitations: item.limitations || null,
    confidence: item.confidence ?? null,
    kind: item.kind || null,
  }));
  const regions = (record.regions || []).slice(0, 12).map(stripRaster).filter(Boolean);
  const embedding = embeddingValue(record);
  const sourceLocation = record.sourceLocation || {
    pageNumber: Number(record.pageNumber) || 1,
    charStart: Number(record.charStart) || 0,
    charEnd: Number(record.charEnd) || text.length,
  };
  return {
    project_id: record.projectId,
    document_id: isUuid(record.documentId) ? record.documentId : null,
    sheet_id: isUuid(record.sheetId) ? record.sheetId : null,
    file_name: record.fileName || null,
    sheet_number: record.sheetNumber || null,
    sheet_title: record.title || null,
    discipline: record.discipline || null,
    revision: record.revision || null,
    content_class: record.contentClass || null,
    page_number: Number(record.pageNumber) || 1,
    chunk_key: chunkKey(record),
    content_fingerprint: fingerprint(text),
    chunk_text: text,
    source_type: "drawing",
    extraction_method: record.extractionMethod || "pdfjs-text-layer",
    observations,
    identifiers: record.identifiers || [],
    cross_sheet_refs: record.references || record.crossSheetRefs || [],
    region: regions[0] || null,
    metadata: {
      regions,
      provesRequirementSatisfied: false,
      chunkIndex: Number.isInteger(record.chunkIndex) ? record.chunkIndex : 0,
      charStart: sourceLocation.charStart,
      charEnd: sourceLocation.charEnd,
      sourceLocation,
      embeddingStatus: record.embeddingStatus || (embedding ? "present" : "missing"),
    },
    embedding,
    superseded: false,
    superseded_at: null,
  };
}

function rowToRecord(row) {
  const metadata = row.metadata || {};
  return {
    projectId: row.project_id,
    documentId: row.document_id,
    sheetId: row.sheet_id,
    fileName: row.file_name,
    sheetNumber: row.sheet_number,
    title: row.sheet_title,
    discipline: row.discipline,
    revision: row.revision,
    contentClass: row.content_class,
    pageNumber: row.page_number,
    text: row.chunk_text,
    observations: row.observations || [],
    regions: metadata.regions || (row.region ? [row.region] : []),
    identifiers: row.identifiers || [],
    references: row.cross_sheet_refs || [],
    extractionMethod: row.extraction_method,
    embedding: parseEmbedding(row.embedding),
    embeddingStatus: metadata.embeddingStatus || (row.embedding ? "present" : "missing"),
    chunkIndex: Number.isInteger(metadata.chunkIndex) ? metadata.chunkIndex : 0,
    charStart: metadata.charStart,
    charEnd: metadata.charEnd,
    sourceLocation: metadata.sourceLocation || null,
  };
}

function sameSheet(a, b) {
  return a.project_id === b.project_id
    && a.document_id === b.document_id
    && a.file_name === b.file_name
    && a.page_number === b.page_number
    && (a.sheet_id || null) === (b.sheet_id || null);
}

function createMemoryBackend() {
  /** @type {Map<string, Record<string, unknown>>} */
  const rows = new Map();
  return {
    rows,
    upsert(row) {
      const key = `${row.project_id}:${row.chunk_key}`;
      const prev = rows.get(key);
      const next = {
        ...prev,
        ...row,
        id: prev?.id || crypto.randomUUID(),
        updated_at: new Date().toISOString(),
        superseded: false,
        superseded_at: null,
      };
      rows.set(key, next);
      if (row.revision) {
        for (const existing of rows.values()) {
          if (existing === next || existing.superseded) continue;
          if (!sameSheet(existing, next)) continue;
          if (existing.chunk_key === next.chunk_key) continue;
          if (existing.revision === next.revision) continue;
          existing.superseded = true;
          existing.superseded_at = new Date().toISOString();
        }
      }
      return next;
    },
    listActive(projectId) {
      return [...rows.values()].filter((row) => row.project_id === projectId && !row.superseded);
    },
  };
}

function retireMemoryRows(backend, written) {
  const keysBySheet = new Map();
  const documentByDrawing = new Map();
  for (const row of written) {
    const identity = sheetIdentity(row);
    if (!keysBySheet.has(identity)) keysBySheet.set(identity, new Set());
    keysBySheet.get(identity).add(row.chunk_key);
    const drawing = drawingIdentity(row);
    if (drawing && row.document_id) documentByDrawing.set(drawing, row.document_id);
  }
  const now = new Date().toISOString();
  for (const existing of backend.rows.values()) {
    if (existing.superseded) continue;
    const keys = keysBySheet.get(sheetIdentity(existing));
    if (keys && !keys.has(existing.chunk_key)) {
      existing.superseded = true;
      existing.superseded_at = now;
      continue;
    }
    const replacing = documentByDrawing.get(drawingIdentity(existing));
    if (replacing && existing.document_id && existing.document_id !== replacing) {
      existing.superseded = true;
      existing.superseded_at = now;
    }
  }
}

function createMemoryDrawingStore(backend = createMemoryBackend(), options = {}) {
  return {
    kind: "memory",
    available: true,
    backend,
    rowToRecord,
    async upsertRecords(records) {
      const fresh = expandRecords(records);
      const existing = new Map();
      for (const row of backend.rows.values()) {
        if (!row.superseded) existing.set(`${row.project_id}:${row.chunk_key}`, row);
      }
      const reuse = reuseStoredEmbeddings(fresh, existing);
      const expanded = await applyEmbeddings(reuse.records, options.embedTexts);
      const written = expanded.map((record) => backend.upsert(recordToRow(record)));
      retireMemoryRows(backend, written);
      return {
        persisted: true,
        count: written.length,
        reusedEmbeddings: reuse.reused,
        liveSupabase: false,
        embeddingStatus: summarizeEmbeddings(expanded),
      };
    },
    async listActive(projectId) {
      return latestDocumentPerDrawing(backend.listActive(projectId));
    },
  };
}

function missingTable(error) {
  const message = `${error?.message || ""} ${error?.code || ""} ${error?.details || ""}`;
  return /does not exist|schema cache|42P01|PGRST205|PGRST204|Could not find the table/i.test(message);
}

function persistenceRequested() {
  return String(process.env.CODE_ANALYZER_DRAWING_RAG_PERSIST || "").trim() === "1";
}

function reportPersistenceFailure(logger, result) {
  const log = logger || console.error;
  log("[code-analyzer-worker] drawing RAG persistence failed", {
    reason: result.reason || "write_failed",
    code: result.code || null,
    message: result.message ? String(result.message).slice(0, 300) : null,
  });
}

async function retireSupabaseRows(supabase, rows) {
  const groups = new Map();
  for (const row of rows) {
    const identity = sheetIdentity(row);
    if (!groups.has(identity)) groups.set(identity, []);
    groups.get(identity).push(row);
  }
  for (const group of groups.values()) {
    const sample = group[0];
    const keys = new Set(group.map((row) => row.chunk_key));
    let query = supabase
      .from(TABLE)
      .select("chunk_key")
      .eq("project_id", sample.project_id)
      .eq("page_number", sample.page_number)
      .eq("superseded", false);
    query = sample.document_id ? query.eq("document_id", sample.document_id) : query.is("document_id", null);
    query = sample.sheet_id ? query.eq("sheet_id", sample.sheet_id) : query.is("sheet_id", null);
    if (sample.file_name) query = query.eq("file_name", sample.file_name);
    const listed = await query;
    const data = listed?.data;
    if (listed?.error || !Array.isArray(data)) continue;
    for (const existing of data) {
      if (!existing?.chunk_key || keys.has(existing.chunk_key)) continue;
      await supabase
        .from(TABLE)
        .update({ superseded: true, superseded_at: new Date().toISOString() })
        .eq("project_id", sample.project_id)
        .eq("chunk_key", existing.chunk_key);
    }
  }
  await retireReplacedDocuments(supabase, rows);
}

/** A newer document for the same drawing retires the older document's active chunks. */
async function retireReplacedDocuments(supabase, rows) {
  const seen = new Set();
  for (const row of rows) {
    if (!row.document_id) continue;
    const identity = drawingIdentity(row);
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    try {
      let query = supabase
        .from(TABLE)
        .update({ superseded: true, superseded_at: new Date().toISOString() })
        .eq("project_id", row.project_id)
        .eq("superseded", false)
        .neq("document_id", row.document_id);
      query = row.sheet_number
        ? query.eq("sheet_number", row.sheet_number)
        : query.eq("file_name", row.file_name).eq("page_number", row.page_number || 1);
      await query;
    } catch {
      // Retirement failure leaves older chunks active; reads still keep the newest document.
    }
  }
}

function createSupabaseDrawingStore(supabase, options = {}) {
  const logger = options.logger;
  const state = { lastFailure: null };
  let available;
  let probeFailure = null;
  async function probe() {
    if (available !== undefined) return available;
    try {
      const { error } = await supabase.from(TABLE).select("id").limit(0);
      if (!error) {
        available = true;
        return true;
      }
      available = false;
      probeFailure = missingTable(error)
        ? { reason: "table_unavailable", code: error.code || null, message: error.message || null }
        : { reason: "probe_failed", code: error.code || null, message: error.message || null };
    } catch (err) {
      available = false;
      probeFailure = { reason: "probe_failed", code: err?.code || null, message: err instanceof Error ? err.message : String(err) };
    }
    state.lastFailure = probeFailure;
    return available;
  }
  function failed(result) {
    const outcome = { persisted: false, liveSupabase: false, reported: true, ...result };
    reportPersistenceFailure(logger, outcome);
    return outcome;
  }
  return {
    kind: "supabase",
    get lastFailure() {
      return state.lastFailure;
    },
    rowToRecord,
    async probe() {
      return probe();
    },
    async upsertRecords(records) {
      if (!(await probe())) return failed(probeFailure || { reason: "table_unavailable" });
      const fresh = expandRecords(records);
      const existing = new Map();
      const keysByProject = new Map();
      for (const record of fresh) {
        const row = recordToRow(record);
        if (!keysByProject.has(row.project_id)) keysByProject.set(row.project_id, []);
        keysByProject.get(row.project_id).push(row.chunk_key);
      }
      for (const [projectId, keys] of keysByProject) {
        try {
          const listed = await supabase
            .from(TABLE)
            .select("chunk_key, content_fingerprint, embedding")
            .eq("project_id", projectId)
            .eq("superseded", false)
            .in("chunk_key", keys);
          if (listed?.error || !Array.isArray(listed?.data)) continue;
          for (const row of listed.data) existing.set(`${projectId}:${row.chunk_key}`, row);
        } catch {
          // Reuse is an optimization. A failed lookup embeds the chunks again.
        }
      }
      const reuse = reuseStoredEmbeddings(fresh, existing);
      const expanded = await applyEmbeddings(reuse.records, options.embedTexts);
      const rows = expanded.map(recordToRow);
      if (!rows.length) return { persisted: false, reason: "empty", embeddingStatus: summarizeEmbeddings(expanded) };
      const { error } = await supabase.from(TABLE).upsert(rows, { onConflict: "project_id,chunk_key" });
      if (error) {
        if (missingTable(error)) return failed({ reason: "table_unavailable", code: error.code || null, message: error.message || null });
        return failed({ reason: "write_failed", code: error.code || null, message: error.message || null });
      }
      await retireSupabaseRows(supabase, rows);
      return {
        persisted: true,
        count: rows.length,
        reusedEmbeddings: reuse.reused,
        liveSupabase: true,
        embeddingStatus: summarizeEmbeddings(expanded),
      };
    },
    async listActive(projectId) {
      if (!(await probe())) return [];
      const { data, error } = await supabase
        .from(TABLE)
        .select("*")
        .eq("project_id", projectId)
        .eq("superseded", false);
      if (error) {
        if (missingTable(error)) return [];
        reportPersistenceFailure(logger, { reason: "read_failed", code: error.code || null, message: error.message || null });
        throw error;
      }
      return latestDocumentPerDrawing(data || []);
    },
  };
}

/**
 * Production writes stay off unless the operator sets the flag AND the table exists.
 * A missing table does not fail the review.
 * @param {{ from: Function }} supabase
 */
function createGuardedDrawingStore(supabase, options = {}) {
  if (!persistenceRequested()) {
    return {
      kind: "disabled",
      available: false,
      rowToRecord,
      async upsertRecords() {
        return { persisted: false, reason: "disabled", liveSupabase: false };
      },
      async listActive() {
        return [];
      },
    };
  }
  return createSupabaseDrawingStore(supabase, options);
}

module.exports = {
  createMemoryBackend,
  createMemoryDrawingStore,
  createSupabaseDrawingStore,
  createGuardedDrawingStore,
  persistenceRequested,
  recordToRow,
  rowToRecord,
  chunkKey,
};
