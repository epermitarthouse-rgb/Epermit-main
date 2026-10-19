"use strict";

const crypto = require("crypto");

const TABLE = "code_analyzer_drawing_chunks";

function fingerprint(text) {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex").slice(0, 32);
}

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function chunkKey(record) {
  return [
    record.documentId || record.document_id || "none",
    record.sheetId || record.sheet_id || record.fileName || record.file_name || "sheet",
    record.pageNumber || record.page_number || 1,
    record.revision || "unspecified",
  ].join(":");
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
  const embedding = Array.isArray(record.embedding) && record.embedding.length === 1536 ? record.embedding : null;
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
    metadata: { regions, provesRequirementSatisfied: false },
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
    embedding: row.embedding || null,
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

function createMemoryDrawingStore(backend = createMemoryBackend()) {
  return {
    kind: "memory",
    available: true,
    backend,
    rowToRecord,
    async upsertRecords(records) {
      const written = [];
      for (const record of records || []) {
        if (!record?.projectId) continue;
        written.push(backend.upsert(recordToRow(record)));
      }
      return { persisted: true, count: written.length, liveSupabase: false };
    },
    async listActive(projectId) {
      return backend.listActive(projectId);
    },
  };
}

function missingTable(error) {
  const message = `${error?.message || ""} ${error?.code || ""} ${error?.details || ""}`;
  return /does not exist|schema cache|42P01|PGRST205|PGRST204|Could not find the table/i.test(message);
}

function createSupabaseDrawingStore(supabase) {
  let available;
  async function probe() {
    if (available !== undefined) return available;
    try {
      const { error } = await supabase.from(TABLE).select("id").limit(0);
      available = !error || !missingTable(error) ? !error : false;
      if (error && !missingTable(error)) available = false;
    } catch {
      available = false;
    }
    return available;
  }
  return {
    kind: "supabase",
    rowToRecord,
    async probe() {
      return probe();
    },
    async upsertRecords(records) {
      if (!(await probe())) return { persisted: false, reason: "table_unavailable", liveSupabase: false };
      const rows = (records || []).filter((record) => record?.projectId).map(recordToRow);
      if (!rows.length) return { persisted: false, reason: "empty" };
      const { error } = await supabase.from(TABLE).upsert(rows, { onConflict: "project_id,chunk_key" });
      if (error) {
        if (missingTable(error)) return { persisted: false, reason: "table_unavailable", liveSupabase: false };
        throw error;
      }
      for (const row of rows) {
        if (!row.revision) continue;
        let query = supabase
          .from(TABLE)
          .update({ superseded: true, superseded_at: new Date().toISOString() })
          .eq("project_id", row.project_id)
          .eq("page_number", row.page_number)
          .eq("superseded", false)
          .neq("chunk_key", row.chunk_key);
        query = row.document_id ? query.eq("document_id", row.document_id) : query.is("document_id", null);
        query = row.sheet_id ? query.eq("sheet_id", row.sheet_id) : query.is("sheet_id", null);
        if (row.file_name) query = query.eq("file_name", row.file_name);
        await query;
      }
      return { persisted: true, count: rows.length, liveSupabase: true };
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
        throw error;
      }
      return data || [];
    },
  };
}

/**
 * Production writes stay off unless the operator sets the flag AND the table exists.
 * A missing table does not fail the review.
 * @param {{ from: Function }} supabase
 */
function createGuardedDrawingStore(supabase) {
  if (process.env.CODE_ANALYZER_DRAWING_RAG_PERSIST !== "1") {
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
  return createSupabaseDrawingStore(supabase);
}

module.exports = {
  createMemoryBackend,
  createMemoryDrawingStore,
  createSupabaseDrawingStore,
  createGuardedDrawingStore,
  recordToRow,
  rowToRecord,
  chunkKey,
};
