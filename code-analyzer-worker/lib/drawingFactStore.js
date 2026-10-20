"use strict";

const crypto = require("crypto");
const fs = require("fs");
const {
  EXTRACTOR_VERSION,
  SCHEMA_VERSION,
  validateDrawingDocument,
  reviewDocument,
} = require("../../scraper-service/app/services/compliance/rag/drawingStructureV2.js");

const EXTRACTIONS = "code_analyzer_sheet_extractions";
const FACTS = "code_analyzer_drawing_facts";

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    fs.createReadStream(filePath)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")));
  });
}

function missingTable(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  return code === "PGRST205" || code === "42P01" || /schema cache|does not exist|could not find the table/i.test(message);
}

const TEXT_BYTES = 4000;
const PROPERTIES_BYTES = 24000;
const BBOX_BYTES = 2000;
const FACT_BATCH = 40;
const ZERO_COUNTS = {
  element_count: 0,
  dimension_count: 0,
  note_count: 0,
  schedule_count: 0,
  schedule_row_count: 0,
  calculation_count: 0,
  reference_count: 0,
  relationship_count: 0,
  evidence_count: 0,
};
const RASTER_KEY = /imagebase64|data:image|raster/i;

function octetLength(value) {
  return Buffer.byteLength(String(value ?? ""), "utf8");
}

function cleanString(value, maxBytes) {
  const text = String(value ?? "").replace(/\u0000/g, "");
  if (!text) return null;
  if (octetLength(text) <= maxBytes) return text;
  let end = Math.min(text.length, maxBytes);
  while (end > 0 && octetLength(text.slice(0, end)) > maxBytes) end -= 1;
  return text.slice(0, end) || null;
}

function stripRaster(value, depth = 0) {
  if (depth > 8) return null;
  if (Array.isArray(value)) {
    return value.slice(0, 40).map((item) => stripRaster(item, depth + 1)).filter((item) => item != null);
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (RASTER_KEY.test(key)) continue;
      const next = stripRaster(child, depth + 1);
      if (next != null) out[key] = next;
    }
    return out;
  }
  if (typeof value === "string") {
    if (RASTER_KEY.test(value)) return null;
    return value.replace(/\u0000/g, "");
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  return null;
}

function fitProperties(value) {
  let current = stripRaster(value) || {};
  const size = () => octetLength(JSON.stringify(current));
  if (size() <= PROPERTIES_BYTES) return current;
  if (current && typeof current === "object" && !Array.isArray(current)) {
    for (const key of ["cells", "geometry", "headers", "location", "association_basis", "evidence_ids"]) {
      if (current[key] == null) continue;
      current = { ...current, storage_limitation: "properties_trimmed_to_fit" };
      delete current[key];
      if (size() <= PROPERTIES_BYTES) return current;
    }
    if (current.governing || current.operands || current.method) {
      return {
        method: current.method || null,
        governing: current.governing || null,
        operands: current.operands || null,
        role: current.role || null,
        property: current.property || null,
        context_text: current.context_text || null,
        related_element_ids: current.related_element_ids || null,
        related_calculation_ids: current.related_calculation_ids || null,
        storage_limitation: "properties_trimmed_to_fit",
      };
    }
  }
  return { storage_limitation: "properties_exceeded_storage_limit" };
}

function fitBbox(value) {
  if (!value || typeof value !== "object") return null;
  const compact = ["x", "y", "width", "height"].reduce((box, key) => {
    const number = Number(value[key]);
    if (Number.isFinite(number)) box[key] = number;
    return box;
  }, {});
  const chosen = Object.keys(compact).length ? compact : stripRaster(value);
  if (!chosen || octetLength(JSON.stringify(chosen)) > BBOX_BYTES) return null;
  return chosen;
}

function sanitizeFactRow(row) {
  if (!row?.fact_key) return null;
  const properties = fitProperties(row.properties);
  if (RASTER_KEY.test(JSON.stringify(properties || {}))) return null;
  const factKey = cleanString(row.fact_key, 500);
  if (!factKey) return null;
  return {
    ...row,
    fact_key: factKey,
    parent_fact_key: row.parent_fact_key ? cleanString(row.parent_fact_key, 500) : null,
    text: cleanString(row.text, TEXT_BYTES),
    value_text: cleanString(row.value_text, TEXT_BYTES),
    original_text: cleanString(row.original_text, TEXT_BYTES),
    value_numeric: typeof row.value_numeric === "number" && Number.isFinite(row.value_numeric) ? row.value_numeric : null,
    confidence: typeof row.confidence === "number" && Number.isFinite(row.confidence) ? row.confidence : null,
    bbox: fitBbox(row.bbox),
    properties,
    related_fact_keys: Array.isArray(row.related_fact_keys)
      ? row.related_fact_keys.map((key) => cleanString(key, 200)).filter(Boolean).slice(0, 40)
      : [],
    related_sheet_refs: Array.isArray(row.related_sheet_refs)
      ? row.related_sheet_refs.map((key) => cleanString(key, 80)).filter(Boolean).slice(0, 20)
      : [],
  };
}

function dedupeFactRows(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const clean = sanitizeFactRow(row);
    if (!clean?.fact_key || seen.has(clean.fact_key)) continue;
    seen.add(clean.fact_key);
    out.push(clean);
  }
  return out;
}

function countsFromRows(rows) {
  const tally = {
    element: 0,
    dimension: 0,
    note: 0,
    schedule: 0,
    schedule_row: 0,
    calculation: 0,
    reference: 0,
    relationship: 0,
    evidence: 0,
  };
  for (const row of rows) {
    if (tally[row.kind] != null) tally[row.kind] += 1;
  }
  return {
    element_count: tally.element,
    dimension_count: tally.dimension,
    note_count: tally.note,
    schedule_count: tally.schedule,
    schedule_row_count: tally.schedule_row,
    calculation_count: tally.calculation,
    reference_count: tally.reference,
    relationship_count: tally.relationship,
    evidence_count: tally.evidence,
  };
}

function headerFactTotal(header) {
  return Object.keys(ZERO_COUNTS).reduce((sum, key) => sum + Number(header?.[key] || 0), 0);
}

function factsCoverHeader(header, facts) {
  const tally = {};
  for (const fact of facts || []) tally[fact.kind] = (tally[fact.kind] || 0) + 1;
  const expected = {
    element: header.element_count,
    dimension: header.dimension_count,
    note: header.note_count,
    schedule: header.schedule_count,
    schedule_row: header.schedule_row_count,
    calculation: header.calculation_count,
    reference: header.reference_count,
    relationship: header.relationship_count,
    evidence: header.evidence_count,
  };
  return Object.entries(expected).every(([kind, count]) => (tally[kind] || 0) >= Number(count || 0));
}

async function loadFactRows(supabase, extractionId) {
  const pageSize = 1000;
  const all = [];
  for (let from = 0; ; from += pageSize) {
    const result = await supabase
      .from(FACTS)
      .select("*")
      .eq("extraction_id", extractionId)
      .eq("superseded", false)
      .range(from, from + pageSize - 1);
    if (result.error) return result;
    const batch = result.data || [];
    all.push(...batch);
    if (batch.length < pageSize) break;
  }
  return { data: all, error: null };
}

async function countFactRows(supabase, extractionId) {
  return supabase
    .from(FACTS)
    .select("id", { count: "exact", head: true })
    .eq("extraction_id", extractionId)
    .eq("superseded", false);
}

function factRows(extractionId, projectId, sheetId, doc) {
  const page = doc.page || 1;
  const rows = [];
  const push = (kind, fact, parentFactKey = null) => {
    const methods = fact.extraction_methods || fact.extractionMethods || [];
    rows.push({
      project_id: projectId,
      extraction_id: extractionId,
      sheet_id: sheetId,
      fact_key: fact.id,
      parent_fact_key: parentFactKey,
      kind,
      element_type: kind === "relationship" ? null : fact.type || fact.element_type || null,
      tag: fact.tag || null,
      text: String(fact.text || fact.statement || fact.original_text || "").slice(0, 1000) || null,
      value_text: fact.value_text || fact.original_text || null,
      value_numeric: typeof fact.value_numeric === "number" ? fact.value_numeric : null,
      unit: fact.unit || fact.governing?.unit || null,
      original_text: String(fact.original_content || fact.original_text || fact.text || "").slice(0, 1000) || null,
      binding_status: fact.binding_status || "read",
      observation_status: fact.observation_status || (fact.directly_observed ? "observed" : null),
      association_status: fact.association_status || fact.status || null,
      confidence: typeof fact.confidence === "number" ? fact.confidence : null,
      inferred: Boolean(fact.inferred || fact.association_status === "inferred"),
      extraction_method: methods[0] || null,
      source_fingerprint: doc.source_fingerprint,
      page_number: fact.page || page,
      bbox: fact.bbox || fact.location?.text_anchor_bbox || fact.location?.bbox || null,
      related_fact_keys: [
        ...(fact.evidence_ids || []),
        ...(fact.related_element_ids || []),
        ...(fact.from_id ? [fact.from_id] : []),
        ...(fact.to_id ? [fact.to_id] : []),
      ],
      related_sheet_refs: fact.related_sheet_refs || (fact.sheet_number ? [fact.sheet_number] : []),
      properties: {
        ...(fact.properties || {}),
        ...(fact.source_ref ? { source_ref: fact.source_ref } : {}),
        ...(fact.location ? { location: fact.location } : {}),
        ...(fact.discipline ? { discipline: fact.discipline } : {}),
        ...(fact.extraction_status ? { extraction_status: fact.extraction_status } : {}),
        ...(fact.ambiguity ? { ambiguity: fact.ambiguity } : {}),
        ...(fact.role ? { role: fact.role, property: fact.property } : {}),
        ...(fact.context_text ? { context_text: String(fact.context_text).slice(0, 500) } : {}),
        ...(fact.related_element_ids ? { related_element_ids: fact.related_element_ids } : {}),
        ...(fact.related_calculation_ids?.length ? { related_calculation_ids: fact.related_calculation_ids } : {}),
        ...(fact.source_label ? { source_label: String(fact.source_label).slice(0, 160) } : {}),
        ...(fact.evidence_ids ? { evidence_ids: fact.evidence_ids } : {}),
        ...(fact.geometry ? { geometry: fact.geometry } : {}),
        ...(fact.association_basis ? { association_basis: fact.association_basis } : {}),
        ...(fact.headers ? { headers: fact.headers, status: fact.status, limitation: fact.limitation } : {}),
        ...(fact.cells ? { cells: fact.cells, row_index: fact.row_index, tag: fact.tag, status: fact.status } : {}),
        ...(kind === "relationship"
          ? {
              from_id: fact.from_id,
              to_id: fact.to_id,
              relationship_type: fact.type,
              basis: fact.basis,
              independently_verified: fact.independently_verified === true,
            }
          : {}),
        ...(kind === "evidence"
          ? {
              source_type: fact.source_type,
              extraction_methods: fact.extraction_methods,
              status: fact.status,
              directly_observed: fact.directly_observed === true,
            }
          : {}),
        ...(fact.governing ? { governing: fact.governing, method: fact.method, operands: fact.operands } : {}),
        ...(fact.work_status ? { work_status: fact.work_status } : {}),
        ...(fact.low_confidence ? { low_confidence: true } : {}),
        ...(fact.limitation ? { limitation: fact.limitation } : {}),
      },
    });
  };
  for (const fact of doc.elements) push("element", fact);
  for (const fact of doc.dimensions) push("dimension", fact);
  for (const fact of doc.notes) push("note", fact);
  for (const fact of doc.schedules) {
    push("schedule", { ...fact, rows: undefined });
    for (const row of fact.rows || []) push("schedule_row", row, fact.id);
  }
  for (const fact of doc.calculations) push("calculation", fact);
  for (const fact of doc.drawing_references) push("reference", fact);
  for (const fact of doc.relationships || []) push("relationship", fact);
  for (const fact of doc.evidence || []) push("evidence", fact);
  return rows;
}

const ELEMENT_META_KEYS = new Set([
  "source_ref", "location", "discipline", "extraction_status", "ambiguity", "role", "property",
  "related_element_ids", "related_calculation_ids", "evidence_ids", "geometry", "association_basis",
  "work_status", "low_confidence", "limitation", "context_text", "source_label", "headers", "status",
  "cells", "row_index", "from_id", "to_id", "relationship_type", "basis", "independently_verified",
  "source_type", "extraction_methods", "directly_observed", "governing", "method", "operands",
]);

function elementProperties(stored) {
  const properties = {};
  for (const [key, value] of Object.entries(stored || {})) {
    if (!ELEMENT_META_KEYS.has(key)) properties[key] = value;
  }
  return properties;
}

function documentFrom(header, facts) {
  const grouped = {
    element: [],
    dimension: [],
    note: [],
    schedule: [],
    schedule_row: [],
    calculation: [],
    reference: [],
    relationship: [],
    evidence: [],
  };
  for (const fact of facts || []) {
    const item = {
      ...(fact.properties || {}),
      id: fact.fact_key,
      type: fact.kind === "relationship" ? fact.properties?.relationship_type : fact.element_type,
      element_type: fact.element_type,
      tag: fact.tag || fact.properties?.tag || null,
      text: fact.text,
      original_content: fact.original_text,
      original_text: fact.original_text,
      value_text: fact.value_text,
      value_numeric: fact.value_numeric == null ? null : Number(fact.value_numeric),
      unit: fact.unit,
      binding_status: fact.binding_status,
      observation_status: fact.observation_status,
      association_status: fact.association_status,
      confidence: fact.confidence == null ? null : Number(fact.confidence),
      inferred: fact.inferred,
      page: fact.page_number,
      bbox: fact.bbox,
      related_element_ids: fact.properties?.related_element_ids || [],
      related_calculation_ids: fact.properties?.related_calculation_ids || [],
      related_sheet_refs: fact.related_sheet_refs || [],
      role: fact.properties?.role || null,
      property: fact.properties?.property || null,
      context_text: fact.properties?.context_text || null,
      association_basis: fact.properties?.association_basis || null,
      geometry: fact.properties?.geometry || null,
      source_label: fact.properties?.source_label || null,
      properties: fact.kind === "element" ? elementProperties(fact.properties) : {},
      location: fact.properties?.location || null,
      work_status: fact.properties?.work_status || null,
      low_confidence: Boolean(fact.properties?.low_confidence),
      statement: fact.kind === "calculation" ? fact.text : undefined,
      method: fact.properties?.method || null,
      operands: fact.properties?.operands || null,
      governing: fact.properties?.governing || null,
      sheet_number: fact.kind === "reference" ? (fact.related_sheet_refs || [])[0] || null : undefined,
      parent_fact_key: fact.parent_fact_key,
      evidence_ids: fact.properties?.evidence_ids || [],
      from_id: fact.properties?.from_id,
      to_id: fact.properties?.to_id,
      basis: fact.properties?.basis,
      independently_verified: fact.properties?.independently_verified === true,
    };
    (grouped[fact.kind] || []).push(item);
  }
  const schedules = grouped.schedule.map((schedule) => ({
    ...schedule,
    headers: schedule.headers || [],
    rows: grouped.schedule_row.filter((row) => row.parent_fact_key === schedule.id),
  }));
  return {
    schema_version: header.schema_version,
    extractor_version: header.extractor_version,
    file_id: header.document_id,
    sheet_id: header.sheet_id,
    sheet_number: header.sheet_number,
    file_name: header.file_name,
    revision: header.revision,
    source_fingerprint: header.source_fingerprint,
    extraction: {
      status: header.status,
      methods: header.methods || [],
      coverage: header.coverage || {},
      unreadable_regions: header.unreadable_regions || [],
      limitations: header.limitations || [],
      retry_count: header.retry_count || 0,
      retry_limit: header.retry_limit || 3,
      retry_status: header.retry_status || null,
      last_attempt_at: header.last_attempt_at || header.extracted_at,
    },
    elements: grouped.element,
    dimensions: grouped.dimension,
    notes: grouped.note,
    schedules,
    calculations: grouped.calculation,
    drawing_references: grouped.reference,
    relationships: grouped.relationship,
    evidence: grouped.evidence,
  };
}

async function loadSheetExtraction(supabase, { projectId, sheetId, sourceFingerprint }) {
  if (!supabase || !projectId || !sheetId || !sourceFingerprint) return null;
  const { data, error } = await supabase
    .from(EXTRACTIONS)
    .select("*")
    .eq("project_id", projectId)
    .eq("sheet_id", sheetId)
    .eq("source_fingerprint", sourceFingerprint)
    .eq("extractor_version", EXTRACTOR_VERSION)
    .eq("superseded", false)
    .maybeSingle();
  if (error) {
    if (missingTable(error)) return { persisted: false, reason: "not_migrated" };
    throw error;
  }
  if (!data || !["completed", "partial", "extracting", "failed"].includes(data.status)) return null;
  const facts = await loadFactRows(supabase, data.id);
  if (facts.error) {
    if (missingTable(facts.error)) return { persisted: false, reason: "not_migrated" };
    throw facts.error;
  }
  const document = documentFrom(data, facts.data || []);
  const validation = validateDrawingDocument(document);
  const coverage = data.coverage || {};
  const factsMissing = data.status === "completed"
    && headerFactTotal(data) > 0
    && !factsCoverHeader(data, facts.data || []);
  const completeAndValid =
    data.status === "completed" &&
    !factsMissing &&
    validation.ok &&
    (data.unreadable_regions || []).length === 0 &&
    Number(coverage.pages_completed || 0) >= Number(coverage.pages_total || 1) &&
    ["recognized", "no_graphic_text"].includes(String(coverage.graphical_status || ""));
  return {
    persisted: true,
    reused: completeAndValid,
    resume: !completeAndValid && !factsMissing,
    factsMissing,
    retryAllowed: !completeAndValid && Number(data.retry_count || 0) < Number(data.retry_limit || 3),
    validation,
    extractionId: data.id,
    document,
  };
}

async function markSheetExtractionStarted(
  supabase,
  { projectId, documentId, sheetId, fileName, sheetNumber, revision, sourceFingerprint, retryCount = 0, retryLimit = 3 },
) {
  if (!supabase || !projectId || !sheetId || !sourceFingerprint) return { persisted: false, reason: "missing_identity" };
  const row = {
    project_id: projectId,
    document_id: documentId || null,
    sheet_id: sheetId,
    file_name: fileName || null,
    sheet_number: sheetNumber || null,
    revision: revision || null,
    source_fingerprint: sourceFingerprint,
    schema_version: SCHEMA_VERSION,
    extractor_version: EXTRACTOR_VERSION,
    status: "extracting",
    retry_count: retryCount,
    retry_limit: retryLimit,
    retry_status: retryCount >= retryLimit ? "exhausted" : "retryable",
    last_attempt_at: new Date().toISOString(),
    superseded: false,
  };
  const result = await supabase
    .from(EXTRACTIONS)
    .upsert(row, { onConflict: "project_id,sheet_id,source_fingerprint,extractor_version" });
  if (result.error) {
    if (missingTable(result.error)) return { persisted: false, reason: "not_migrated" };
    return { persisted: false, reason: "write_failed", message: result.error.message };
  }
  return { persisted: true, status: "extracting" };
}

async function saveSheetExtraction(supabase, { projectId, documentId, sheetId, document }) {
  if (!supabase || !projectId || !sheetId || !document) {
    return { persisted: false, reason: "missing_identity", document: reviewDocument(document) };
  }
  const validation = validateDrawingDocument(document);
  const finalStatus = validation.ok ? document.extraction.status : "failed";
  const limitations = [
    ...(document.extraction.limitations || []),
    ...validation.errors.map((error) => `validation:${error}`),
  ];
  const identity = {
    project_id: projectId,
    document_id: documentId || document.file_id || null,
    sheet_id: sheetId,
    file_name: document.file_name,
    sheet_number: document.sheet_number,
    revision: document.revision,
    source_fingerprint: document.source_fingerprint,
    schema_version: SCHEMA_VERSION,
    extractor_version: EXTRACTOR_VERSION,
    methods: document.extraction.methods || [],
    coverage: document.extraction.coverage || {},
    unreadable_regions: document.extraction.unreadable_regions || [],
    retry_count: document.extraction.retry_count || 0,
    retry_limit: document.extraction.retry_limit || 3,
    retry_status: document.extraction.retry_status || null,
    last_attempt_at: document.extraction.last_attempt_at || new Date().toISOString(),
    extracted_at: new Date().toISOString(),
    superseded: false,
  };
  const writeToken = crypto.randomUUID();
  identity.coverage = { ...(identity.coverage || {}), write_token: writeToken };
  const stillOwnsWrite = async () => {
    const current = await supabase.from(EXTRACTIONS).select("coverage").eq("id", extractionId).maybeSingle();
    if (current.error) return { ok: false, error: current.error };
    return { ok: current.data?.coverage?.write_token === writeToken, error: null };
  };
  const prior = await supabase
    .from(EXTRACTIONS)
    .select("id, status, element_count, dimension_count, note_count, schedule_count, schedule_row_count, calculation_count, reference_count, relationship_count, evidence_count")
    .eq("project_id", projectId)
    .eq("sheet_id", sheetId)
    .eq("source_fingerprint", document.source_fingerprint)
    .eq("extractor_version", EXTRACTOR_VERSION)
    .maybeSingle();
  if (!prior.error && prior.data?.status === "completed" && headerFactTotal(prior.data) > 0) {
    const priorFacts = await loadFactRows(supabase, prior.data.id);
    if (!priorFacts.error && factsCoverHeader(prior.data, priorFacts.data || [])) {
      return { persisted: true, reused: true, extractionId: prior.data.id, document: reviewDocument(document) };
    }
  }
  const written = await supabase
    .from(EXTRACTIONS)
    .upsert({
      ...identity,
      status: "extracting",
      limitations,
      ...ZERO_COUNTS,
    }, { onConflict: "project_id,sheet_id,source_fingerprint,extractor_version" })
    .select("id")
    .maybeSingle();
  if (written.error) {
    if (missingTable(written.error)) return { persisted: false, reason: "not_migrated", document: reviewDocument(document) };
    return { persisted: false, reason: "write_failed", message: written.error.message, document: reviewDocument(document) };
  }
  const extractionId = written.data?.id;
  if (!extractionId) {
    return { persisted: false, reason: "write_failed", document: reviewDocument(document) };
  }
  const fail = async (message) => {
    const owner = await stillOwnsWrite();
    if (owner.error) {
      return { persisted: false, reason: "write_failed", message: owner.error.message, extractionId, document: reviewDocument(document) };
    }
    if (!owner.ok) {
      return { persisted: false, reason: "concurrent_write", extractionId, document: reviewDocument(document) };
    }
    await supabase
      .from(EXTRACTIONS)
      .update({
        status: "failed",
        ...ZERO_COUNTS,
        limitations: [...limitations, `fact_write_failed:${String(message || "facts were not stored").slice(0, 300)}`],
        updated_at: new Date().toISOString(),
      })
      .eq("id", extractionId)
      .filter("coverage->>write_token", "eq", writeToken)
      .in("status", ["extracting", "failed"]);
    return {
      persisted: false,
      reason: finalStatus === "failed" ? "invalid" : "write_failed",
      message,
      extractionId,
      document: reviewDocument({ ...document, extraction: { ...document.extraction, status: "failed" } }),
    };
  };
  if (finalStatus === "failed") return fail(validation.errors[0] || "invalid drawing document");
  const rows = dedupeFactRows(factRows(extractionId, projectId, sheetId, document));
  for (let index = 0; index < rows.length; index += FACT_BATCH) {
    const batch = await supabase
      .from(FACTS)
      .upsert(rows.slice(index, index + FACT_BATCH), { onConflict: "extraction_id,fact_key" });
    if (batch.error) {
      if (missingTable(batch.error)) return { persisted: false, reason: "not_migrated", extractionId, document: reviewDocument(document) };
      return fail(batch.error.message);
    }
  }
  const owner = await stillOwnsWrite();
  if (owner.error) return fail(owner.error.message);
  if (!owner.ok) {
    return { persisted: false, reason: "concurrent_write", extractionId, document: reviewDocument(document) };
  }
  const existing = await loadFactRows(supabase, extractionId);
  if (existing.error) {
    if (missingTable(existing.error)) return { persisted: false, reason: "not_migrated", extractionId, document: reviewDocument(document) };
    return fail(existing.error.message);
  }
  const keep = new Set(rows.map((row) => row.fact_key));
  const stale = (existing.data || []).map((row) => row.fact_key).filter((key) => key && !keep.has(key));
  for (let index = 0; index < stale.length; index += 100) {
    const deleted = await supabase
      .from(FACTS)
      .delete()
      .eq("extraction_id", extractionId)
      .in("fact_key", stale.slice(index, index + 100));
    if (deleted.error && !missingTable(deleted.error)) return fail(deleted.error.message);
  }
  const stored = await countFactRows(supabase, extractionId);
  if (stored.error) {
    if (missingTable(stored.error)) return { persisted: false, reason: "not_migrated", extractionId, document: reviewDocument(document) };
    return fail(stored.error.message);
  }
  if (Number(stored.count || 0) < rows.length) {
    return fail(`stored ${stored.count || 0} of ${rows.length} drawing facts`);
  }
  const storedCounts = countsFromRows(rows);
  const committed = await supabase
    .from(EXTRACTIONS)
    .update({
      ...identity,
      status: finalStatus,
      limitations,
      ...storedCounts,
      updated_at: new Date().toISOString(),
    })
    .eq("id", extractionId)
    .filter("coverage->>write_token", "eq", writeToken)
    .select("id")
    .maybeSingle();
  if (committed.error) return fail(committed.error.message);
  if (!committed.data?.id) {
    return { persisted: false, reason: "concurrent_write", extractionId, document: reviewDocument(document) };
  }
  await supabase
    .from(EXTRACTIONS)
    .update({ superseded: true, updated_at: new Date().toISOString() })
    .eq("project_id", projectId)
    .eq("sheet_id", sheetId)
    .neq("source_fingerprint", document.source_fingerprint)
    .eq("superseded", false);
  await supabase
    .from(FACTS)
    .update({ superseded: true })
    .eq("project_id", projectId)
    .eq("sheet_id", sheetId)
    .neq("extraction_id", extractionId)
    .eq("superseded", false);
  return { persisted: true, reused: false, extractionId, document: reviewDocument(document) };
}

async function saveCrossSheetRelationships(
  supabase,
  { projectId, sheetId, extractionId, sourceFingerprint, relationships },
) {
  if (!supabase || !projectId || !sheetId || !extractionId || !relationships?.length) {
    return { persisted: false, reason: "no_relationships" };
  }
  const rows = relationships.map((relationship) => ({
    project_id: projectId,
    extraction_id: extractionId,
    sheet_id: sheetId,
    fact_key: relationship.relationship_id,
    kind: "relationship",
    text: String(relationship.text || "").slice(0, 1000) || null,
    original_text: String(relationship.text || "").slice(0, 1000) || null,
    binding_status: "read",
    observation_status: "observed",
    association_status: relationship.status,
    inferred: relationship.status === "inferred",
    extraction_method: "cross-sheet-reconcile",
    source_fingerprint: sourceFingerprint,
    related_fact_keys: relationship.supporting_fact_keys || [],
    related_sheet_refs: [],
    properties: {
      relationship_type: "cross_sheet_support",
      related_sheet_id: relationship.sheet_id,
      element_type: relationship.element_type,
      tag: relationship.tag,
      basis: relationship.basis,
      independently_verified: relationship.independently_verified === true,
    },
  }));
  const result = await supabase
    .from(FACTS)
    .upsert(rows, { onConflict: "extraction_id,fact_key" });
  if (result.error) {
    if (missingTable(result.error)) return { persisted: false, reason: "not_migrated" };
    return { persisted: false, reason: "write_failed", message: result.error.message };
  }
  return { persisted: true, count: rows.length };
}

module.exports = {
  hashFile,
  documentFrom,
  factRows,
  loadSheetExtraction,
  markSheetExtractionStarted,
  saveCrossSheetRelationships,
  saveSheetExtraction,
};
