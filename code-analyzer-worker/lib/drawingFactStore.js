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

function counts(doc) {
  return {
    element_count: doc.elements.length,
    dimension_count: doc.dimensions.length,
    note_count: doc.notes.length,
    schedule_count: doc.schedules.length,
    schedule_row_count: doc.schedules.reduce((sum, schedule) => sum + (schedule.rows || []).length, 0),
    calculation_count: doc.calculations.length,
    reference_count: doc.drawing_references.length,
    relationship_count: (doc.relationships || []).length,
    evidence_count: (doc.evidence || []).length,
  };
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
        ...(fact.related_element_ids ? { related_element_ids: fact.related_element_ids } : {}),
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
      related_sheet_refs: fact.related_sheet_refs || [],
      properties: fact.kind === "element" ? (fact.properties || {}) : {},
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
  const facts = await supabase
    .from(FACTS)
    .select("*")
    .eq("extraction_id", data.id)
    .eq("superseded", false)
    .limit(1000);
  if (facts.error) {
    if (missingTable(facts.error)) return { persisted: false, reason: "not_migrated" };
    throw facts.error;
  }
  const document = documentFrom(data, facts.data || []);
  const validation = validateDrawingDocument(document);
  const coverage = data.coverage || {};
  const completeAndValid =
    data.status === "completed" &&
    validation.ok &&
    (data.unreadable_regions || []).length === 0 &&
    Number(coverage.pages_completed || 0) >= Number(coverage.pages_total || 1) &&
    ["recognized", "no_graphic_text"].includes(String(coverage.graphical_status || ""));
  return {
    persisted: true,
    reused: completeAndValid,
    resume: !completeAndValid,
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
    retry_count: document.extraction.retry_count || 0,
    retry_limit: document.extraction.retry_limit || 3,
    retry_status: document.extraction.retry_status || null,
    last_attempt_at: document.extraction.last_attempt_at || new Date().toISOString(),
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
  loadSheetExtraction,
  markSheetExtractionStarted,
  saveCrossSheetRelationships,
  saveSheetExtraction,
};
