"use strict";

const crypto = require("crypto");
const fs = require("fs");
const {
  EXTRACTOR_VERSION,
  SCHEMA_VERSION,
  validateDrawingDocument,
  reviewDocument,
} = require("../../scraper-service/app/services/compliance/rag/drawingStructure.js");

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

function counts(doc) {
  return {
    element_count: doc.elements.length,
    dimension_count: doc.dimensions.length,
    note_count: doc.notes.length,
    schedule_count: doc.schedules.length,
    calculation_count: doc.calculations.length,
    reference_count: doc.drawing_references.length,
  };
}

function factRows(extractionId, projectId, sheetId, doc) {
  const page = doc.page || 1;
  const rows = [];
  const push = (kind, fact) => {
    rows.push({
      project_id: projectId,
      extraction_id: extractionId,
      sheet_id: sheetId,
      fact_key: fact.id,
      kind,
      element_type: fact.type || fact.element_type || null,
      text: String(fact.text || fact.statement || fact.original_text || "").slice(0, 1000) || null,
      value_text: fact.value_text || fact.original_text || null,
      value_numeric: typeof fact.value_numeric === "number" ? fact.value_numeric : null,
      unit: fact.unit || fact.governing?.unit || null,
      original_text: String(fact.original_text || fact.text || "").slice(0, 1000) || null,
      binding_status: fact.binding_status || "read",
      confidence: typeof fact.confidence === "number" ? fact.confidence : null,
      inferred: Boolean(fact.inferred),
      page_number: fact.page || page,
      bbox: fact.bbox || fact.location?.bbox || null,
      related_fact_keys: fact.evidence_ids || fact.related_element_ids || [],
      related_sheet_refs: fact.related_sheet_refs || (fact.sheet_number ? [fact.sheet_number] : []),
      properties: {
        ...(fact.properties || {}),
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
  for (const fact of doc.schedules) push("schedule", fact);
  for (const fact of doc.calculations) push("calculation", fact);
  for (const fact of doc.drawing_references) push("reference", fact);
  return rows;
}

function documentFrom(header, facts) {
  const grouped = { element: [], dimension: [], note: [], schedule: [], calculation: [], reference: [] };
  for (const fact of facts || []) {
    const item = {
      id: fact.fact_key,
      type: fact.element_type,
      element_type: fact.element_type,
      text: fact.text,
      original_text: fact.original_text,
      value_text: fact.value_text,
      value_numeric: fact.value_numeric == null ? null : Number(fact.value_numeric),
      unit: fact.unit,
      binding_status: fact.binding_status,
      confidence: fact.confidence == null ? null : Number(fact.confidence),
      inferred: fact.inferred,
      page: fact.page_number,
      bbox: fact.bbox,
      related_element_ids: fact.kind === "dimension" ? fact.related_fact_keys || [] : [],
      related_sheet_refs: fact.related_sheet_refs || [],
      properties: fact.kind === "element" ? (fact.properties || {}) : {},
      work_status: fact.properties?.work_status || null,
      low_confidence: Boolean(fact.properties?.low_confidence),
      statement: fact.kind === "calculation" ? fact.text : undefined,
      method: fact.properties?.method || null,
      operands: fact.properties?.operands || null,
      governing: fact.properties?.governing || null,
      sheet_number: fact.kind === "reference" ? (fact.related_sheet_refs || [])[0] || null : undefined,
    };
    (grouped[fact.kind] || []).push(item);
  }
  return reviewDocument({
    schema_version: header.schema_version,
    extractor_version: header.extractor_version,
    sheet_number: header.sheet_number,
    file_name: header.file_name,
    source_fingerprint: header.source_fingerprint,
    extraction: {
      status: header.status,
      methods: header.methods || [],
      coverage: header.coverage || {},
      unreadable_regions: header.unreadable_regions || [],
      limitations: header.limitations || [],
    },
    elements: grouped.element,
    dimensions: grouped.dimension,
    notes: grouped.note,
    schedules: grouped.schedule,
    calculations: grouped.calculation,
    drawing_references: grouped.reference,
  });
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
  if (!data || (data.status !== "completed" && data.status !== "partial")) return null;
  const facts = await supabase
    .from(FACTS)
    .select("*")
    .eq("extraction_id", data.id)
    .eq("superseded", false)
    .limit(400);
  if (facts.error) {
    if (missingTable(facts.error)) return { persisted: false, reason: "not_migrated" };
    throw facts.error;
  }
  return {
    persisted: true,
    reused: true,
    extractionId: data.id,
    document: documentFrom(data, facts.data || []),
  };
}

async function saveSheetExtraction(supabase, { projectId, documentId, sheetId, document }) {
  if (!supabase || !projectId || !sheetId || !document) {
    return { persisted: false, reason: "missing_identity", document: reviewDocument(document) };
  }
  const validation = validateDrawingDocument(document);
  const status = validation.ok ? document.extraction.status : "failed";
  const header = {
    project_id: projectId,
    document_id: documentId || document.file_id || null,
    sheet_id: sheetId,
    file_name: document.file_name,
    sheet_number: document.sheet_number,
    revision: document.revision,
    source_fingerprint: document.source_fingerprint,
    schema_version: SCHEMA_VERSION,
    extractor_version: EXTRACTOR_VERSION,
    status,
    methods: document.extraction.methods || [],
    coverage: document.extraction.coverage || {},
    unreadable_regions: document.extraction.unreadable_regions || [],
    limitations: [
      ...(document.extraction.limitations || []),
      ...validation.errors.map((error) => `validation:${error}`),
    ],
    ...counts(document),
    extracted_at: new Date().toISOString(),
    superseded: false,
  };
  const written = await supabase
    .from(EXTRACTIONS)
    .upsert(header, { onConflict: "project_id,sheet_id,source_fingerprint,extractor_version" })
    .select("id")
    .maybeSingle();
  if (written.error) {
    if (missingTable(written.error)) return { persisted: false, reason: "not_migrated", document: reviewDocument(document) };
    return { persisted: false, reason: "write_failed", message: written.error.message, document: reviewDocument(document) };
  }
  const extractionId = written.data?.id;
  if (!extractionId || status === "failed") {
    return { persisted: Boolean(extractionId), reason: status === "failed" ? "invalid" : "write_failed", document: reviewDocument({ ...document, extraction: { ...document.extraction, status } }) };
  }
  await supabase.from(FACTS).delete().eq("extraction_id", extractionId);
  const rows = factRows(extractionId, projectId, sheetId, document);
  for (let index = 0; index < rows.length; index += 100) {
    const batch = await supabase.from(FACTS).insert(rows.slice(index, index + 100));
    if (batch.error && !missingTable(batch.error)) {
      return { persisted: false, reason: "write_failed", message: batch.error.message, document: reviewDocument(document) };
    }
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

module.exports = {
  hashFile,
  loadSheetExtraction,
  saveSheetExtraction,
};
