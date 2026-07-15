"use strict";

const crypto = require("crypto");
const { getCoordinationRecordById } = require("./uci-records.service.js");
const { extractPepcoPortalFiles,
  validatePepcoStoragePathForRecord,
  isPepcoPortalFileAccessible,
  parseCoordinationMetadata,
} = require("./uci-package-document-bridge.service.js");
const { UCI_DOCUMENTS_STORAGE_BUCKET } = require("./uci-document-storage.service.js");
const { downloadFromSupabaseStorage } = require("../../../shared/supabase-storage-upload.js");
const {
  extractPdfPages,
  extractCandidatesFromPdfText,
  extractCandidatesFromTables,
  extractCandidatesFromStructuredApplication,
  getStructuredApplicationFromRecord,
} = require("./uci-load-candidate.service.js");
const {
  extractPdfPagesWithAnalysis,
  processDocumentPagesFromAnalysis,
  classifyPdfPage,
} = require("./uci-pdf-page-analysis.service.js");
const { fallbackProviderStatus, getDocumentFallbackConfig } = require("./uci-document-fallback-config.service.js");
const { buildRoleClassificationHaystack } = require("./uci-document-classification.service.js");
const {
  detectOneLineDiagramText,
  extractOneLineFindingsFromText,
} = require("./uci-one-line-extractor.service.js");
const {
  detectComcheckReportText,
  extractComcheckFindingsFromText,
} = require("./uci-comcheck-parser.service.js");

const DOCUMENT_PROCESSING_SCHEMA_VERSION = "row-doc-v1";
const STALE_DOCUMENT_PROCESSING_SCHEMA_VERSIONS = new Set([]);
const PROJECT_DOCUMENTS_BUCKET = "project-documents";
const PROJECT_DOCUMENTS_SELECT =
  "id, project_id, document_type, file_name, file_path, file_type, created_at";

const METADATA_KEY = "uci_document_processing";

/** @type {readonly string[]} */
const UCI_DOCUMENT_ROLES = [
  "utility_application",
  "service_configuration",
  "one_line_diagram",
  "panel_schedule",
  "load_calculation",
  "equipment_schedule",
  "equipment_cut_sheet",
  "site_plan",
  "civil_plan",
  "electrical_plan",
  "electrical_specification",
  "COMcheck",
  "authorization",
  "correspondence",
  "submission_receipt",
  "confirmation",
  "cost_or_invoice",
  "equipment_evidence",
  "meter_or_service_evidence",
  "closeout_document",
  "supporting_document",
  "historical_or_superseded",
];

/** @type {Array<{ role: string, confidence: "high" | "medium" | "low", test: RegExp }>} */
const ROLE_CLASSIFICATION_RULES = [
  { role: "panel_schedule", confidence: "high", test: /\bPANEL[\s-]*SCHEDULES?\b/i },
  { role: "one_line_diagram", confidence: "high", test: /\b(ONE[\s-]*LINE|SINGLE[\s-]*LINE)\b/i },
  { role: "load_calculation", confidence: "high", test: /\bLOAD[\s-]*CALC/i },
  { role: "equipment_schedule", confidence: "high", test: /\bEQUIPMENT[\s-]*(UTILITY[\s-]*)?SCHEDULE\b/i },
  { role: "equipment_cut_sheet", confidence: "high", test: /\b(CUT[\s-]*SHEET|CUTSHEET)\b/i },
  { role: "site_plan", confidence: "high", test: /\bSITE[\s-]*PLAN\b/i },
  { role: "civil_plan", confidence: "high", test: /\bCIVIL[\s-]*PLAN\b/i },
  { role: "electrical_plan", confidence: "high", test: /\b(ELECTRICAL|POWER)[\s-]*PLAN\b/i },
  { role: "electrical_specification", confidence: "high", test: /\bELECTRICAL[\s-]*SPEC/i },
  { role: "COMcheck", confidence: "high", test: /\bCOM[\s-]*CHECK\b/i },
  { role: "authorization", confidence: "high", test: /\b(LETTER[\s-]*OF[\s-]*AUTHORIZATION|AUTHORIZATION[\s-]*LETTER|\bLOA\b)/i },
  { role: "utility_application", confidence: "medium", test: /\bSERVICE[\s-]*APPLICATION\b/i },
  { role: "service_configuration", confidence: "medium", test: /\bSERVICE[\s-]*(CONFIG|SIZE|AMPS|VOLTAGE)\b/i },
  { role: "submission_receipt", confidence: "medium", test: /\b(SUBMISSION|RECEIPT)\b/i },
  { role: "confirmation", confidence: "medium", test: /\b(CONFIRMATION|CONFIRMED)\b/i },
  { role: "cost_or_invoice", confidence: "medium", test: /\b(INVOICE|COST|BILLING)\b/i },
  { role: "meter_or_service_evidence", confidence: "medium", test: /\b(METER|SERVICE[\s-]*ENTR)/i },
  { role: "equipment_evidence", confidence: "medium", test: /\bEQUIPMENT\b/i },
  { role: "closeout_document", confidence: "medium", test: /\bCLOSE[\s-]*OUT\b/i },
  { role: "correspondence", confidence: "low", test: /\b(EMAIL|MESSAGE|CORRESPONDENCE)\b/i },
  { role: "historical_or_superseded", confidence: "low", test: /\b(SUPERSEDED|REVISION|HISTORICAL)\b/i },
];

/** @type {Record<string, string[]>} */
const ROLE_TO_UCI_STAGES = {
  utility_application: ["agent_2_load_profile", "agent_3_application_package"],
  service_configuration: ["agent_2_load_profile", "agent_3_application_package"],
  one_line_diagram: ["agent_2_load_profile", "agent_3_application_package"],
  panel_schedule: ["agent_2_load_profile", "portfolio_audit"],
  load_calculation: ["agent_2_load_profile"],
  equipment_schedule: ["agent_2_load_profile", "equipment_workflow"],
  equipment_cut_sheet: ["agent_3_application_package", "equipment_workflow"],
  site_plan: ["agent_3_application_package"],
  civil_plan: ["agent_3_application_package"],
  electrical_plan: ["agent_2_load_profile", "agent_3_application_package"],
  electrical_specification: ["agent_2_load_profile", "agent_3_application_package"],
  COMcheck: ["agent_3_application_package"],
  authorization: ["agent_3_application_package", "agent_4_submission"],
  correspondence: ["agent_4_submission", "portfolio_audit"],
  submission_receipt: ["agent_4_submission"],
  confirmation: ["agent_4_submission"],
  cost_or_invoice: ["cost_workflow"],
  equipment_evidence: ["equipment_workflow"],
  meter_or_service_evidence: ["meter_workflow", "agent_2_load_profile"],
  closeout_document: ["closeout_workflow"],
  supporting_document: ["portfolio_audit", "agent_3_application_package"],
  historical_or_superseded: ["portfolio_audit"],
};

/** Agent 2 load-related field keys. */
const AGENT_2_FIELD_KEYS = new Set([
  "connected_load_kw",
  "connected_load_kva",
  "demand_load_kw",
  "demand_load_kva",
  "panel_connected_load_kw",
  "panel_connected_load_kva",
  "panel_demand_load_kw",
  "panel_demand_load_kva",
  "service_amperage",
  "service_voltage",
  "requested_voltage",
  "phase",
  "wire_configuration",
  "meter_count",
  "service_configuration",
  "central_ac_count",
  "central_heat_count",
]);

/** Agent 2 engineering categories beyond explicit field keys. */
const AGENT_2_CATEGORIES = new Set([
  "connected_load",
  "demand_load",
  "panel_load",
  "service_amperage",
  "service_voltage",
  "phase",
  "wire_configuration",
  "meter_count",
  "service_configuration",
  "equipment_load",
  "load_category",
  "thermal_capacity",
  "gas_load",
  "equipment_evidence",
  "compliance_evidence",
]);

/** Agent 3 package-related field keys / categories. */
const AGENT_3_CATEGORIES = new Set([
  "project_address",
  "package_document_evidence",
  "site_plan_information",
  "authorization_information",
  "verified_load_snapshot",
  "provider_application_facts",
]);

/** Document roles where zero native findings should surface a quality warning. */
const HIGH_VALUE_FINDINGS_ROLES = new Set([
  "one_line_diagram",
  "panel_schedule",
  "COMcheck",
  "equipment_schedule",
  "load_calculation",
]);

/** Agent 4 submission-related categories. */
const AGENT_4_CATEGORIES = new Set([
  "submission_confirmation",
  "submission_reference",
  "package_document_evidence",
]);

const FIELD_KEY_TO_CATEGORY = {
  connected_load_kw: "connected_load",
  connected_load_kva: "connected_load",
  demand_load_kw: "demand_load",
  demand_load_kva: "demand_load",
  panel_connected_load_kw: "panel_load",
  panel_connected_load_kva: "panel_load",
  panel_demand_load_kw: "panel_load",
  panel_demand_load_kva: "panel_load",
  service_amperage: "service_amperage",
  service_voltage: "service_voltage",
  requested_voltage: "service_voltage",
  phase: "phase",
  wire_configuration: "wire_configuration",
  meter_count: "meter_count",
  service_configuration: "service_configuration",
  central_ac_count: "equipment_load",
  central_heat_count: "equipment_load",
  lighting_interior_total_watts: "load_category",
  lighting_exterior_total_watts: "load_category",
  lighting_fixture_row: "load_category",
  hvac_heating_capacity_kbtuh: "gas_load",
  hvac_cooling_capacity_kbtuh: "thermal_capacity",
  hvac_equipment_identifier: "equipment_evidence",
  comcheck_energy_code: "compliance_evidence",
  comcheck_project_title: "compliance_evidence",
  comcheck_project_location: "compliance_evidence",
  comcheck_climate_zone: "compliance_evidence",
  comcheck_project_type: "compliance_evidence",
  comcheck_report_date: "compliance_evidence",
  comcheck_building_area: "compliance_evidence",
  comcheck_compliance_status: "compliance_evidence",
  package_document_present: "package_document_evidence",
};

const FIELD_KEY_LABELS = {
  service_voltage: "Service voltage",
  requested_voltage: "Requested voltage",
  service_amperage: "Service amperage",
  phase: "Phase",
  wire_configuration: "Wire configuration",
  meter_count: "Meter count",
  service_configuration: "Service configuration",
  connected_load_kw: "Connected load",
  connected_load_kva: "Connected load",
  demand_load_kw: "Demand load",
  demand_load_kva: "Demand load",
  panel_connected_load_kw: "Panel connected load",
  panel_connected_load_kva: "Panel connected load",
  panel_demand_load_kw: "Panel demand load",
  panel_demand_load_kva: "Panel demand load",
  central_ac_count: "Central AC count",
  central_heat_count: "Central heat count",
  lighting_interior_total_watts: "Interior lighting total",
  lighting_exterior_total_watts: "Exterior lighting total",
  lighting_fixture_row: "Lighting fixture",
  hvac_heating_capacity_kbtuh: "Heating capacity",
  hvac_cooling_capacity_kbtuh: "Cooling thermal capacity",
  hvac_equipment_identifier: "HVAC equipment",
  comcheck_energy_code: "Energy code",
  comcheck_project_title: "Project title",
  comcheck_project_location: "Project location",
  comcheck_climate_zone: "Climate zone",
  comcheck_project_type: "Project type",
  comcheck_report_date: "Report date",
  comcheck_building_area: "Building area",
  comcheck_compliance_status: "Compliance status",
  package_document_present: "Package document",
};

const LOW_TEXT_THRESHOLD = 50;

/**
 * @param {unknown} err
 * @returns {string}
 */
function safeProcessingErrorMessage(err) {
  if (!err) return "Unknown processing error";
  if (typeof err === "string") return err.slice(0, 500);
  if (err instanceof Error) return String(err.message || "Processing error").slice(0, 500);
  if (typeof err === "object" && err !== null && "message" in err) {
    return String(/** @type {{ message?: unknown }} */ (err).message).slice(0, 500);
  }
  return "Processing error";
}

/**
 * @param {object} params
 */
function buildProcessingFailure(params) {
  return {
    document_name: params.document_name ?? null,
    source_type: params.source_type != null ? String(params.source_type) : undefined,
    stage: String(params.stage ?? "unknown"),
    code: String(params.code ?? "PROCESSING_FAILED"),
    message: String(params.message ?? "Document processing failed"),
  };
}

/**
 * @param {Record<string, unknown>} record
 * @param {string} externalApplicationId
 */
function externalApplicationExistsInRecord(record, externalApplicationId) {
  return getStructuredApplicationFromRecord(record, externalApplicationId) != null;
}

/**
 * @param {Array<Record<string, unknown>>} documents
 */
function summarizeDocumentProcessingCounts(documents) {
  const docs = Array.isArray(documents) ? documents : [];
  /** @type {Record<string, number>} */
  const counts = {
    complete: 0,
    partial: 0,
    failed: 0,
    duplicate: 0,
    unsupported: 0,
    pending: 0,
    processing: 0,
  };
  for (const doc of docs) {
    const status = String(doc.processing_status ?? "");
    if (Object.prototype.hasOwnProperty.call(counts, status)) {
      counts[status] += 1;
    }
  }
  return counts;
}

/**
 * @param {object} params
 */
function buildDocumentProcessingRunResponse(params) {
  const counts = summarizeDocumentProcessingCounts(params.documents);
  const runStatus = String(params.run_status ?? "pending");
  return {
    status: runStatus,
    coordination_record_id: String(params.coordination_record_id ?? ""),
    external_application_id: String(params.external_application_id ?? ""),
    run_status: runStatus,
    documents_discovered: Number(params.documents_discovered ?? params.documents.length ?? 0),
    documents_registered: Number(params.documents_registered ?? params.documents.length ?? 0),
    documents_complete: counts.complete,
    documents_partial: counts.partial,
    documents_failed: counts.failed,
    coverage: params.coverage,
    documents: params.documents,
    findings_count: Number(params.findings_count ?? 0),
    findings_by_stage_counts: params.findings_by_stage_counts,
    failed_documents: params.failed_documents,
    completion_blockers: params.completion_blockers,
  };
}

/**
 * @param {Record<string, unknown>} record
 * @returns {string}
 */
function resolveProviderSlug(record) {
  const meta = parseCoordinationMetadata(record.metadata);
  const mapping = meta.uci_provider_mapping;
  if (mapping && typeof mapping === "object" && !Array.isArray(mapping)) {
    const slug = /** @type {{ provider_slug?: unknown }} */ (mapping).provider_slug;
    if (slug) return String(slug).trim().toLowerCase();
  }
  return "unknown";
}

/**
 * @param {Record<string, unknown>} doc
 * @returns {string}
 */
function buildStableDocumentId(doc) {
  const parts = [
    String(doc.provider_slug ?? "unknown"),
    String(doc.external_application_id ?? ""),
    String(doc.source_document_id ?? doc.content_hash ?? ""),
    String(doc.file_name ?? doc.source_document_name ?? ""),
  ];
  return `uci_doc:${crypto.createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 24)}`;
}

/**
 * @param {{ fileName?: string, portalDocumentName?: string, portalDocumentType?: string, documentType?: string }} input
 * @returns {Array<{ role: string, confidence: string }>}
 */
function classifyDocumentRoles(input) {
  const combined = buildRoleClassificationHaystack(input);

  /** @type {Array<{ role: string, confidence: string }>} */
  const roles = [];
  const seen = new Set();

  for (const rule of ROLE_CLASSIFICATION_RULES) {
    if (rule.test.test(combined) && !seen.has(rule.role)) {
      roles.push({ role: rule.role, confidence: rule.confidence });
      seen.add(rule.role);
    }
  }

  if (roles.length === 0) {
    roles.push({ role: "supporting_document", confidence: "low" });
  }

  return roles;
}

/**
 * @param {Array<{ role: string }>} roles
 * @returns {string[]}
 */
function mapRolesToUciStages(roles) {
  const stages = new Set();
  for (const { role } of roles) {
    const mapped = ROLE_TO_UCI_STAGES[role];
    if (mapped) mapped.forEach((s) => stages.add(s));
  }
  return [...stages];
}

/**
 * @param {string} fieldKey
 * @returns {string}
 */
function fieldKeyToCategory(fieldKey) {
  return FIELD_KEY_TO_CATEGORY[fieldKey] ?? "supporting_evidence";
}

/**
 * @param {Record<string, unknown>} record
 * @param {object} params
 */
function discoverAllUciDocuments(record, params) {
  const externalApplicationId = String(params.externalApplicationId || "").trim();
  if (!externalApplicationId) {
    const err = new Error("external_application_id is required");
    err.statusCode = 400;
    err.code = "EXTERNAL_APPLICATION_REQUIRED";
    throw err;
  }

  const projectId = String(record.project_id ?? "");
  const coordinationRecordId = String(record.id ?? "");
  const tenantId = record.tenant_id != null ? String(record.tenant_id) : null;
  const providerId = record.utility_provider_id != null ? String(record.utility_provider_id) : null;
  const providerSlug = resolveProviderSlug(record);
  const accessContext = { projectId, coordinationRecordId, tenantId };

  const pepcoFiles = extractPepcoPortalFiles(record, { externalApplicationId }).filter((file) =>
    isPepcoPortalFileAccessible(file, accessContext),
  );

  /** @type {Array<Record<string, unknown>>} */
  const documents = [];

  for (const file of pepcoFiles) {
    const extApp = String(file.external_application_id ?? "");
    if (extApp && extApp !== externalApplicationId) continue;

    const fileName = String(file.fileName ?? file.documentName ?? "").trim();
    const storagePath = String(file.storagePath ?? "");
    documents.push({
      source_type: "pepco_portal_document",
      provider_slug: providerSlug,
      provider_id: providerId,
      external_application_id: externalApplicationId,
      source_document_id: file.idempotencyKey != null ? String(file.idempotencyKey) : null,
      source_document_name: fileName,
      file_name: fileName,
      portal_document_name: file.pepco_document_name != null ? String(file.pepco_document_name) : fileName,
      portal_document_type: file.pepco_document_type != null ? String(file.pepco_document_type) : null,
      portal_document_status: file.documentStatus != null ? String(file.documentStatus) : null,
      storage_bucket: file.storageBucket != null ? String(file.storageBucket) : UCI_DOCUMENTS_STORAGE_BUCKET,
      storage_path: storagePath,
      content_hash: file.contentHash != null ? String(file.contentHash) : "",
      mime_type: file.contentType != null ? String(file.contentType) : "application/pdf",
      file_size: typeof file.fileSize === "number" ? file.fileSize : null,
      project_id: projectId,
      coordination_record_id: coordinationRecordId,
      tenant_id: tenantId,
      last_source_update_at: file.downloadedAt != null ? String(file.downloadedAt) : null,
    });
  }

  const projectDocs = Array.isArray(params.projectDocuments) ? params.projectDocuments : [];
  for (const doc of projectDocs) {
    if (!doc || typeof doc !== "object") continue;
    if (String(doc.project_id ?? projectId) !== projectId) continue;
    const fileName = doc.file_name != null ? String(doc.file_name) : "";
    const filePath = doc.file_path != null ? String(doc.file_path) : "";
    if (!fileName || !filePath) continue;

    documents.push({
      source_type: "project_document",
      provider_slug: providerSlug,
      provider_id: providerId,
      external_application_id: externalApplicationId,
      source_document_id: String(doc.id),
      source_document_name: fileName,
      file_name: fileName,
      portal_document_name: null,
      portal_document_type: doc.document_type != null ? String(doc.document_type) : null,
      portal_document_status: null,
      storage_bucket: PROJECT_DOCUMENTS_BUCKET,
      storage_path: filePath,
      content_hash: doc.content_hash != null ? String(doc.content_hash) : `project_doc:${doc.id}`,
      mime_type: doc.file_type != null ? String(doc.file_type) : null,
      file_size: null,
      project_id: projectId,
      coordination_record_id: coordinationRecordId,
      tenant_id: tenantId,
      last_source_update_at: doc.created_at != null ? String(doc.created_at) : null,
    });
  }

  return {
    documents,
    external_application_id: externalApplicationId,
    project_id: projectId,
    coordination_record_id: coordinationRecordId,
    tenant_id: tenantId,
    provider_slug: providerSlug,
    provider_id: providerId,
  };
}

/**
 * @param {Record<string, unknown>} doc
 * @param {object} [opts]
 */
function buildManifestEntry(doc, opts = {}) {
  const roles = classifyDocumentRoles({
    fileName: String(doc.file_name ?? doc.source_document_name ?? ""),
    portalDocumentName: doc.portal_document_name != null ? String(doc.portal_document_name) : null,
    portalDocumentType: doc.portal_document_type != null ? String(doc.portal_document_type) : null,
    documentType: doc.portal_document_type != null ? String(doc.portal_document_type) : null,
  });
  const documentId = opts.document_id ?? buildStableDocumentId(doc);

  return {
    document_id: documentId,
    source_type: String(doc.source_type ?? "unknown"),
    provider_slug: String(doc.provider_slug ?? "unknown"),
    provider_id: doc.provider_id != null ? String(doc.provider_id) : null,
    external_application_id: String(doc.external_application_id ?? ""),
    tenant_id: doc.tenant_id != null ? String(doc.tenant_id) : null,
    project_id: String(doc.project_id ?? ""),
    coordination_record_id: String(doc.coordination_record_id ?? ""),
    original_filename: String(doc.file_name ?? doc.source_document_name ?? "unknown"),
    portal_document_name: doc.portal_document_name != null ? String(doc.portal_document_name) : null,
    portal_document_type: doc.portal_document_type != null ? String(doc.portal_document_type) : null,
    portal_document_status: doc.portal_document_status != null ? String(doc.portal_document_status) : null,
    storage_bucket: String(doc.storage_bucket ?? UCI_DOCUMENTS_STORAGE_BUCKET),
    storage_path: String(doc.storage_path ?? ""),
    content_hash: String(doc.content_hash ?? ""),
    mime_type: doc.mime_type != null ? String(doc.mime_type) : null,
    file_size: typeof doc.file_size === "number" ? doc.file_size : null,
    page_count: opts.page_count ?? null,
    document_roles: roles.map((r) => r.role),
    role_confidence: roles.map((r) => r.confidence),
    uci_stages: mapRolesToUciStages(roles),
    processing_status: opts.processing_status ?? "pending",
    pages_processed: opts.pages_processed ?? 0,
    extraction_methods_used: opts.extraction_methods_used ?? [],
    findings_count: opts.findings_count ?? 0,
    failed_pages: opts.failed_pages ?? [],
    failure_reason: opts.failure_reason ?? null,
    duplicate_of: opts.duplicate_of ?? null,
    schema_version: DOCUMENT_PROCESSING_SCHEMA_VERSION,
    processed_at: opts.processed_at ?? null,
    last_source_update_at: doc.last_source_update_at != null ? String(doc.last_source_update_at) : null,
    page_coverage: opts.page_coverage ?? null,
    page_records: opts.page_records ?? null,
    findings_extraction_status: opts.findings_extraction_status ?? null,
    findings_quality_warnings: opts.findings_quality_warnings ?? [],
  };
}

/**
 * @param {Array<{ pageNumber: number, text: string }>} pages
 * @param {object} opts
 */
function processDocumentPages(pages, opts = {}) {
  const normalized = pages.map((p) => ({
    pageNumber: p.pageNumber,
    text: String(p.text ?? ""),
    analysis:
      p.analysis ??
      classifyPdfPage({
        page_number: p.pageNumber,
        native_text: String(p.text ?? ""),
        native_text_length: String(p.text ?? "").trim().length,
      }),
  }));
  return processDocumentPagesFromAnalysis(normalized, opts);
}

/**
 * @param {Record<string, unknown>} candidate
 * @param {string[]} documentRoles
 */
function resolveFindingUciStages(candidate, documentRoles) {
  const fieldKey = String(candidate.field_key ?? "");
  const category =
    candidate.category != null
      ? String(candidate.category)
      : fieldKeyToCategory(fieldKey);
  /** @type {Set<string>} */
  const stages = new Set();

  if (fieldKey === "package_document_present" || category === "package_document_evidence") {
    stages.add("agent_3_application_package");
    return [...stages];
  }

  if (AGENT_2_FIELD_KEYS.has(fieldKey) || AGENT_2_CATEGORIES.has(category)) {
    stages.add("agent_2_load_profile");
  }
  if (AGENT_3_CATEGORIES.has(category)) {
    stages.add("agent_3_application_package");
  }
  if (AGENT_4_CATEGORIES.has(category)) {
    stages.add("agent_4_submission");
  }

  if (stages.size === 0 && candidate.generic_specification_reference) {
    return [];
  }

  return [...stages];
}

/**
 * @param {Record<string, unknown>} candidate
 * @param {string} documentId
 * @param {string[]} documentRoles
 */
function candidateRecordToFinding(candidate, documentId, documentRoles) {
  const fieldKey = String(candidate.field_key ?? "");
  const category =
    candidate.category != null
      ? String(candidate.category)
      : fieldKeyToCategory(fieldKey);
  const stages = resolveFindingUciStages(candidate, documentRoles);
  const fieldLabel =
    candidate.field_label != null
      ? String(candidate.field_label)
      : FIELD_KEY_LABELS[fieldKey] ?? fieldKey.replace(/_/g, " ");

  const findingKey = [
    documentId,
    fieldKey,
    candidate.entity_name,
    candidate.page_number,
    candidate.raw_value,
    candidate.source_content_hash,
  ].join("|");

  return {
    finding_id: `finding:${crypto.createHash("sha256").update(findingKey).digest("hex").slice(0, 16)}`,
    document_id: documentId,
    document_role: documentRoles,
    uci_stages: stages,
    field_key: fieldKey,
    field_label: fieldLabel,
    category,
    fact_type: candidate.fact_type != null ? String(candidate.fact_type) : null,
    raw_value: String(candidate.raw_value ?? ""),
    normalized_value: candidate.normalized_value ?? null,
    unit: candidate.unit != null ? String(candidate.unit) : null,
    entity_type: candidate.entity_type != null ? String(candidate.entity_type) : "",
    entity_name: candidate.entity_name != null ? String(candidate.entity_name) : null,
    page_number: candidate.page_number != null ? Number(candidate.page_number) : null,
    evidence_text: String(candidate.evidence_text ?? "").slice(0, 2000),
    bounding_region: null,
    extraction_method: String(candidate.extraction_method ?? "pdf_text"),
    confidence: candidate.confidence != null ? Number(candidate.confidence) : null,
    verification_status: "raw",
    source_content_hash: String(candidate.source_content_hash ?? ""),
    schema_version: DOCUMENT_PROCESSING_SCHEMA_VERSION,
    requires_human_review:
      candidate.requires_human_review != null ? Boolean(candidate.requires_human_review) : true,
    review_blocked_reason:
      candidate.review_blocked_reason != null ? String(candidate.review_blocked_reason) : null,
    source_document_name: String(candidate.source_document_name ?? ""),
    external_application_id:
      candidate.external_application_id != null ? String(candidate.external_application_id) : null,
  };
}

/**
 * @param {string[]} documentRoles
 * @param {object} source
 * @param {string} documentId
 */
function buildPackageDocumentPresenceFinding(documentRoles, source, documentId) {
  const packageRoles = documentRoles.filter((r) =>
    ["one_line_diagram", "panel_schedule", "COMcheck", "equipment_schedule", "load_calculation", "site_plan", "authorization"].includes(
      r,
    ),
  );
  if (!packageRoles.length) return null;

  const roleLabel = packageRoles.map((r) => r.replace(/_/g, " ")).join(", ");
  return candidateRecordToFinding(
    {
      field_key: "package_document_present",
      field_label: "Package document present",
      category: "package_document_evidence",
      raw_value: source.source_document_name,
      normalized_value: source.source_document_name,
      unit: null,
      entity_type: "package_document",
      entity_name: source.source_document_name,
      fact_type: "package_document_evidence",
      page_number: null,
      evidence_text: `${roleLabel} document available: ${source.source_document_name}`,
      extraction_method: "document_manifest",
      confidence: 0.95,
      requires_human_review: false,
      source_type: source.source_type,
      source_document_name: source.source_document_name,
      source_content_hash: source.source_content_hash,
      external_application_id: source.external_application_id,
    },
    documentId,
    documentRoles,
  );
}

/**
 * @param {Array<{ pageNumber: number, text: string, analysis?: Record<string, unknown> }>} pages
 * @param {string[]} documentRoles
 * @param {Array<Record<string, unknown>>} findings
 */
function evaluateDocumentFindingsExtraction(pages, documentRoles, findings) {
  const hasNativeText = pages.some((p) => String(p.text ?? "").trim().length > 0);
  const highValue = documentRoles.some((r) => HIGH_VALUE_FINDINGS_ROLES.has(r));
  const engineeringFindings = findings.filter(
    (f) => f.field_key !== "package_document_present",
  );

  if (engineeringFindings.length > 0) {
    return { status: "findings_created", warnings: [] };
  }

  const visionPending = pages.some(
    (p) =>
      p.analysis &&
      ["vision_required", "ocr_required"].includes(String(p.analysis.status ?? "")),
  );

  if (visionPending && highValue) {
    return {
      status: "vision_required_for_structured_findings",
      warnings: [
        "Native text is insufficient for structured engineering findings on this document type.",
      ],
    };
  }

  if (hasNativeText && highValue) {
    return {
      status: "no_supported_findings",
      warnings: [
        `Document classified as ${documentRoles.join(", ")} but no evidence-backed engineering findings were extracted from native text.`,
      ],
    };
  }

  if (hasNativeText) {
    return { status: "no_supported_findings", warnings: [] };
  }

  return { status: "no_supported_findings", warnings: [] };
}

/**
 * @param {Array<Record<string, unknown>>} findings
 */
function deduplicateFindings(findings) {
  const seen = new Set();
  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  for (const f of findings) {
    const key = [
      f.document_id,
      f.field_key,
      f.entity_name,
      f.page_number,
      f.raw_value,
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

/**
 * @param {Array<{ pageNumber: number, text: string, analysis?: Record<string, unknown> }>} pages
 * @param {object} source
 * @param {string} documentId
 * @param {string[]} documentRoles
 */
function extractBroadFindingsFromPages(pages, source, documentId, documentRoles) {
  /** @type {Array<Record<string, unknown>>} */
  const findings = [];
  const isOneLineRole = documentRoles.includes("one_line_diagram");
  const isComcheckRole = documentRoles.includes("COMcheck");

  for (const page of pages) {
    const pageNum = page.pageNumber;
    const text = String(page.text ?? "");
    if (!text.trim()) continue;

    /** @type {Array<Record<string, unknown>>} */
    let candidates = [];

    if (isOneLineRole || detectOneLineDiagramText(text)) {
      candidates.push(...extractOneLineFindingsFromText(text, pageNum, source));
    }
    if (isComcheckRole || detectComcheckReportText(text)) {
      candidates.push(...extractComcheckFindingsFromText(text, pageNum, source));
    }

    candidates.push(...extractCandidatesFromPdfText(text, pageNum, source));
    candidates.push(...extractCandidatesFromTables(text, pageNum, source));

    for (const candidate of candidates) {
      if (candidate.generic_specification_reference && candidate.normalized_value == null) {
        continue;
      }
      findings.push(candidateRecordToFinding(candidate, documentId, documentRoles));
    }
  }

  const presence = buildPackageDocumentPresenceFinding(documentRoles, source, documentId);
  if (presence) findings.push(presence);

  return deduplicateFindings(findings);
}

/**
 * @param {Array<Record<string, unknown>>} findings
 * @param {string} stage
 */
function filterFindingsForUciStage(findings, stage) {
  return findings.filter((f) => {
    const stages = Array.isArray(f.uci_stages) ? f.uci_stages : [];
    return stages.includes(stage);
  });
}

/**
 * @param {Array<Record<string, unknown>>} findings
 * @param {string} contentHash
 */
function markStaleFindings(findings, contentHash) {
  return findings.map((f) => {
    if (
      f.source_content_hash === contentHash &&
      f.verification_status !== "verified" &&
      f.verification_status !== "rejected"
    ) {
      return { ...f, verification_status: "stale" };
    }
    return f;
  });
}

/**
 * @param {Array<Record<string, unknown>>} documents
 * @param {Array<Record<string, unknown>>} findings
 */
function computeCoverageSummary(documents, findings) {
  const statusCounts = {
    complete: 0,
    partial: 0,
    failed: 0,
    duplicate: 0,
    unsupported: 0,
    pending: 0,
    processing: 0,
  };

  let totalPages = 0;
  let processedPages = 0;
  let failedPages = 0;

  for (const doc of documents) {
    const status = String(doc.processing_status ?? "pending");
    if (status in statusCounts) statusCounts[status] += 1;
    else statusCounts.pending += 1;

    const coverage = doc.page_coverage;
    if (coverage && typeof coverage === "object") {
      totalPages += Number(coverage.total_pages ?? 0);
      processedPages += Number(coverage.pages_processed ?? 0);
      failedPages += Number(coverage.failed_pages ?? 0);
    }
  }

  const activeFindings = findings.filter((f) => f.verification_status !== "stale");
  const verifiedFindings = findings.filter((f) => f.verification_status === "verified");

  const agent2Fields = new Set();
  for (const f of activeFindings) {
    if (AGENT_2_FIELD_KEYS.has(String(f.field_key ?? ""))) {
      agent2Fields.add(String(f.field_key));
    }
  }

  const requiredAgent2 = ["connected_load_kw", "connected_load_kva", "service_voltage", "phase"];
  const found = requiredAgent2.filter((k) => agent2Fields.has(k));
  const missing = requiredAgent2.filter((k) => !agent2Fields.has(k));

  return {
    documents_discovered: documents.length,
    documents_registered: documents.length,
    complete: statusCounts.complete,
    partial: statusCounts.partial,
    failed: statusCounts.failed,
    duplicate: statusCounts.duplicate,
    unsupported: statusCounts.unsupported,
    pending: statusCounts.pending,
    processing: statusCounts.processing,
    total_pages: totalPages,
    processed_pages: processedPages,
    failed_pages: failedPages,
    findings_extracted: activeFindings.length,
    findings_pending_review: activeFindings.filter((f) => f.verification_status === "raw").length,
    verified_findings: verifiedFindings.length,
    required_uci_fields_found: found,
    required_uci_fields_missing: missing,
  };
}

/**
 * @param {Record<string, unknown>} state
 */
function evaluateRunCompletion(state) {
  const docs = Array.isArray(state.documents) ? state.documents : [];
  const coverage = state.coverage && typeof state.coverage === "object" ? state.coverage : {};

  /** @type {string[]} */
  const blockers = [];

  if (!state.external_application_id) {
    blockers.push("External application scope is missing");
  }

  const pending = docs.filter((d) =>
    ["pending", "processing"].includes(String(d.processing_status ?? "")),
  );
  if (pending.length > 0) {
    blockers.push(`${pending.length} document(s) still pending or processing`);
  }

  for (const doc of docs) {
    const pc = doc.page_coverage;
    if (!pc || typeof pc !== "object") continue;
    const total = Number(pc.total_pages ?? 0);
    const discovered = Number(pc.pages_discovered ?? 0);
    const accounted =
      Number(pc.pages_processed ?? 0) +
      Number(pc.blank_pages ?? 0) +
      Number(pc.failed_pages ?? 0) +
      Number(pc.pages_sent_to_vision ?? 0) +
      Number(pc.pages_sent_to_ocr ?? 0) +
      Number(pc.fallback_pending ?? 0);
    if (total > 0 && accounted < total) {
      blockers.push(`Document ${doc.original_filename ?? doc.document_id} has unaccounted pages`);
    }
    if (total > 0 && discovered < total) {
      blockers.push(`Document ${doc.original_filename ?? doc.document_id} has undiscovered pages`);
    }
    if (String(doc.processing_status) === "partial") {
      const pending = Number(pc.fallback_pending ?? 0);
      if (pending > 0) {
        blockers.push(
          `Document ${doc.original_filename ?? doc.document_id} has ${pending} page(s) awaiting Vision/OCR fallback`,
        );
      }
    }
    if (String(doc.processing_status) === "failed" && !doc.failure_reason) {
      blockers.push(`Document ${doc.original_filename ?? doc.document_id} failed without reason`);
    }
    const qualityWarnings = Array.isArray(doc.findings_quality_warnings)
      ? doc.findings_quality_warnings
      : [];
    for (const warning of qualityWarnings) {
      blockers.push(
        `Findings quality — ${doc.original_filename ?? doc.document_id}: ${String(warning)}`,
      );
    }
    if (
      String(doc.findings_extraction_status ?? "") === "no_supported_findings" &&
      qualityWarnings.length === 0 &&
      (doc.document_roles ?? []).some((r) => HIGH_VALUE_FINDINGS_ROLES.has(String(r)))
    ) {
      blockers.push(
        `Findings quality — ${doc.original_filename ?? doc.document_id}: no evidence-backed findings extracted`,
      );
    }
  }

  const extApps = new Set(docs.map((d) => String(d.external_application_id ?? "")).filter(Boolean));
  if (extApps.size > 1) {
    blockers.push("Documents from multiple external applications were mixed");
  }

  let runStatus = "complete";
  const hasFailed = docs.some((d) => String(d.processing_status) === "failed");
  const hasPartial = docs.some((d) => String(d.processing_status) === "partial");
  const hasComplete = docs.some((d) => String(d.processing_status) === "complete");

  if (blockers.length > 0) runStatus = "partial";
  if ((hasFailed || hasPartial) && hasComplete) runStatus = "partial";
  else if (hasFailed && !hasComplete && !hasPartial) runStatus = "failed";
  else if (hasPartial && !hasComplete) runStatus = "partial";
  if (Number(coverage.failed ?? 0) > 0 && Number(coverage.complete ?? 0) === 0) {
    runStatus = "failed";
  }

  return { run_status: runStatus, blockers };
}

/**
 * @param {Record<string, unknown>} entry
 */
function sanitizeManifestEntryForApi(entry) {
  if (!entry || typeof entry !== "object") return entry;
  const out = { ...entry };
  delete out.storage_path;
  delete out.storage_bucket;
  return out;
}

/**
 * @param {Record<string, unknown>} state
 */
function sanitizeDocumentProcessingForApi(state) {
  if (!state || typeof state !== "object") return state;
  const out = { ...state };
  if (Array.isArray(out.documents)) {
    out.documents = out.documents.map(sanitizeManifestEntryForApi);
  }
  return out;
}

/**
 * @param {unknown} metadata
 * @param {string} externalApplicationId
 */
function getDocumentProcessingState(metadata, externalApplicationId) {
  const meta = parseCoordinationMetadata(metadata);
  const root = meta[METADATA_KEY];
  if (!root || typeof root !== "object" || Array.isArray(root)) return null;

  const apps = /** @type {{ applications?: unknown }} */ (root).applications;
  if (!apps || typeof apps !== "object" || Array.isArray(apps)) return null;

  const state = /** @type {Record<string, unknown>} */ (apps)[externalApplicationId];
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  return /** @type {Record<string, unknown>} */ (state);
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function persistDocumentProcessingState(supabase, params) {
  const { coordinationRecordId, projectId, externalApplicationId, state } = params;

  const { data: row, error: fetchErr } = await supabase
    .from("coordination_records")
    .select("metadata")
    .eq("id", coordinationRecordId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (fetchErr) {
    throw Object.assign(new Error(fetchErr.message || "Failed to fetch coordination metadata"), {
      statusCode: 500,
    });
  }

  const prev =
    row?.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? /** @type {Record<string, unknown>} */ (row.metadata)
      : {};

  const prevRoot =
    prev[METADATA_KEY] && typeof prev[METADATA_KEY] === "object" && !Array.isArray(prev[METADATA_KEY])
      ? /** @type {Record<string, unknown>} */ (prev[METADATA_KEY])
      : {};

  const prevApps =
    prevRoot.applications && typeof prevRoot.applications === "object" && !Array.isArray(prevRoot.applications)
      ? { .../** @type {Record<string, unknown>} */ (prevRoot.applications) }
      : {};

  prevApps[externalApplicationId] = state;

  const nextMetadata = {
    ...prev,
    [METADATA_KEY]: {
      ...prevRoot,
      schema_version: DOCUMENT_PROCESSING_SCHEMA_VERSION,
      applications: prevApps,
    },
  };

  const { error: upErr } = await supabase
    .from("coordination_records")
    .update({ metadata: nextMetadata })
    .eq("id", coordinationRecordId)
    .eq("project_id", projectId);

  if (upErr) {
    throw Object.assign(new Error(upErr.message || "Failed to persist document processing state"), {
      statusCode: 500,
    });
  }
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function runDocumentProcessing(supabase, params) {
  const {
    coordinationRecordId,
    userId,
    externalApplicationId,
    refresh = false,
    deps = {},
  } = params;
  const extAppId = String(externalApplicationId || "").trim();
  if (!extAppId) {
    const err = new Error("external_application_id is required");
    err.statusCode = 400;
    err.code = "EXTERNAL_APPLICATION_REQUIRED";
    throw err;
  }

  const record = await getCoordinationRecordById(supabase, coordinationRecordId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const projectId = String(record.project_id);
  const coordinationRecordIdStr = String(coordinationRecordId);

  if (!externalApplicationExistsInRecord(record, extAppId)) {
    const err = new Error("The selected utility application could not be resolved.");
    err.statusCode = 404;
    err.code = "APPLICATION_NOT_FOUND";
    throw err;
  }

  /** @type {Array<Record<string, unknown>>} */
  let projectDocs = [];
  const { data: projectDocsData, error: projectDocsErr } = await supabase
    .from("project_documents")
    .select(PROJECT_DOCUMENTS_SELECT)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (projectDocsErr) {
    projectDocs = [];
  } else {
    projectDocs = Array.isArray(projectDocsData) ? projectDocsData : [];
  }

  const discovery = discoverAllUciDocuments(record, {
    externalApplicationId: extAppId,
    projectDocuments: projectDocs,
  });

  if (!Array.isArray(discovery.documents) || discovery.documents.length === 0) {
    const err = new Error("No downloaded documents were found for the selected utility application.");
    err.statusCode = 422;
    err.code = "NO_DOWNLOADED_DOCUMENTS";
    throw err;
  }

  const previousState = getDocumentProcessingState(record.metadata, extAppId);
  const previousDocs = Array.isArray(previousState?.documents) ? previousState.documents : [];
  const previousFindings = Array.isArray(previousState?.findings) ? previousState.findings : [];

  /** @type {Map<string, string>} */
  const hashToDocId = new Map();
  for (const doc of previousDocs) {
    const hash = String(doc.content_hash ?? "");
    const id = String(doc.document_id ?? "");
    if (hash && id && String(doc.processing_status) === "complete") {
      hashToDocId.set(hash, id);
    }
  }

  /** @type {Array<Record<string, unknown>>} */
  const manifestDocuments = [];
  /** @type {Array<Record<string, unknown>>} */
  let allFindings = refresh ? [] : [...previousFindings];
  /** @type {Array<Record<string, unknown>>} */
  const failedDocuments = [];

  const downloadFn = deps.downloadFromSupabaseStorage || downloadFromSupabaseStorage;
  const extractPdfPagesFn = deps.extractPdfPagesWithAnalysis || deps.extractPdfPages || extractPdfPagesWithAnalysis;
  const now = new Date().toISOString();

  const runState = {
    schema_version: DOCUMENT_PROCESSING_SCHEMA_VERSION,
    external_application_id: extAppId,
    provider_slug: discovery.provider_slug,
    provider_id: discovery.provider_id,
    tenant_id: discovery.tenant_id,
    project_id: projectId,
    coordination_record_id: coordinationRecordIdStr,
    run_status: "processing",
    run_started_at: now,
    run_completed_at: null,
    run_by: userId,
    documents: manifestDocuments,
    findings: allFindings,
    findings_by_stage: {
      agent_2_load_profile: [],
      agent_3_application_package: [],
      agent_4_submission: [],
    },
    coverage: {},
    failed_documents: failedDocuments,
  };

  await persistDocumentProcessingState(supabase, {
    coordinationRecordId: coordinationRecordIdStr,
    projectId,
    externalApplicationId: extAppId,
    state: runState,
  });

  const structuredApp = getStructuredApplicationFromRecord(record, extAppId);
  if (structuredApp) {
    try {
      const structuredCandidates = extractCandidatesFromStructuredApplication(structuredApp, extAppId);
      const structuredRoles = ["utility_application", "service_configuration"];
      const structuredDocId = `uci_doc:structured_application_metadata`;
      for (const candidate of structuredCandidates) {
        allFindings.push(candidateRecordToFinding(candidate, structuredDocId, structuredRoles));
      }
      manifestDocuments.push(
        buildManifestEntry(
          {
            source_type: "provider_application",
            provider_slug: discovery.provider_slug,
            external_application_id: extAppId,
            file_name: "provider_application_metadata",
            source_document_name: "provider_application_metadata",
            content_hash: `structured:${extAppId}`,
            project_id: projectId,
            coordination_record_id: coordinationRecordIdStr,
            tenant_id: discovery.tenant_id,
          },
          {
            document_id: structuredDocId,
            processing_status: "complete",
            page_count: 1,
            pages_processed: 1,
            extraction_methods_used: ["structured_application"],
            findings_count: structuredCandidates.length,
            processed_at: now,
            page_coverage: {
              total_pages: 1,
              pages_discovered: 1,
              pages_processed: 1,
              pages_with_text: 1,
              pages_with_tables: 0,
              pages_sent_to_vision: 0,
              pages_sent_to_ocr: 0,
              blank_pages: 0,
              failed_pages: 0,
              skipped_duplicate_pages: 0,
            },
          },
        ),
      );
    } catch (err) {
      failedDocuments.push(
        buildProcessingFailure({
          document_name: "provider_application_metadata",
          source_type: "provider_application",
          stage: "structured_application",
          code: "STRUCTURED_APPLICATION_FAILED",
          message: safeProcessingErrorMessage(err),
        }),
      );
    }
  }

  for (const doc of discovery.documents) {
    const docName = String(doc.source_document_name ?? doc.file_name ?? "unknown");
    const contentHash = String(doc.content_hash ?? "");
    const documentId = buildStableDocumentId(doc);
    const roles = classifyDocumentRoles({
      fileName: docName,
      portalDocumentName: doc.portal_document_name != null ? String(doc.portal_document_name) : null,
      portalDocumentType: doc.portal_document_type != null ? String(doc.portal_document_type) : null,
    }).map((r) => r.role);

    if (!refresh && contentHash && hashToDocId.has(contentHash)) {
      const prior = previousDocs.find((d) => String(d.document_id) === hashToDocId.get(contentHash));
      if (prior && String(prior.schema_version) === DOCUMENT_PROCESSING_SCHEMA_VERSION) {
        manifestDocuments.push({
          ...prior,
          processing_status: "duplicate",
          duplicate_of: hashToDocId.get(contentHash),
          failure_reason: "Exact duplicate content hash",
          processed_at: now,
        });
        continue;
      }
    }

    if (contentHash && refresh) {
      allFindings = markStaleFindings(allFindings, contentHash);
    }

    const storagePath = String(doc.storage_path ?? "");
    const storageBucket = String(doc.storage_bucket ?? UCI_DOCUMENTS_STORAGE_BUCKET);

    if (!storagePath) {
      manifestDocuments.push(
        buildManifestEntry(doc, {
          processing_status: "failed",
          failure_reason: "Storage object missing",
          processed_at: now,
        }),
      );
      failedDocuments.push(
        buildProcessingFailure({
          document_name: docName,
          source_type: String(doc.source_type),
          stage: "storage_validation",
          code: "STORAGE_OBJECT_MISSING",
          message: "The downloaded utility document could not be retrieved.",
        }),
      );
      await persistDocumentProcessingState(supabase, {
        coordinationRecordId: coordinationRecordIdStr,
        projectId,
        externalApplicationId: extAppId,
        state: { ...runState, documents: [...manifestDocuments], findings: allFindings },
      });
      continue;
    }

    if (doc.source_type === "pepco_portal_document") {
      const ok = validatePepcoStoragePathForRecord(storagePath, {
        projectId,
        coordinationRecordId: coordinationRecordIdStr,
        tenantId: record.tenant_id != null ? String(record.tenant_id) : null,
      });
      if (!ok || String(doc.external_application_id ?? "") !== extAppId) {
        manifestDocuments.push(
          buildManifestEntry(doc, {
            processing_status: "failed",
            failure_reason: "Storage namespace validation failed",
            processed_at: now,
          }),
        );
        failedDocuments.push(
          buildProcessingFailure({
            document_name: docName,
            source_type: String(doc.source_type),
            stage: "storage_validation",
            code: "STORAGE_NAMESPACE_INVALID",
            message: "Storage namespace validation failed",
          }),
        );
        await persistDocumentProcessingState(supabase, {
          coordinationRecordId: coordinationRecordIdStr,
          projectId,
          externalApplicationId: extAppId,
          state: { ...runState, documents: [...manifestDocuments], findings: allFindings },
        });
        continue;
      }
    }

    let download;
    try {
      download = await downloadFn({ supabase, bucket: storageBucket, storagePath });
    } catch (err) {
      manifestDocuments.push(
        buildManifestEntry(doc, {
          processing_status: "failed",
          failure_reason: "Storage download failed",
          processed_at: now,
        }),
      );
      failedDocuments.push(
        buildProcessingFailure({
          document_name: docName,
          source_type: String(doc.source_type),
          stage: "storage_download",
          code: "STORAGE_DOWNLOAD_FAILED",
          message: safeProcessingErrorMessage(err),
        }),
      );
      await persistDocumentProcessingState(supabase, {
        coordinationRecordId: coordinationRecordIdStr,
        projectId,
        externalApplicationId: extAppId,
        state: { ...runState, documents: [...manifestDocuments], findings: allFindings },
      });
      continue;
    }

    if (!download.ok || !download.data) {
      manifestDocuments.push(
        buildManifestEntry(doc, {
          processing_status: "failed",
          failure_reason: "Storage object missing",
          processed_at: now,
        }),
      );
      failedDocuments.push(
        buildProcessingFailure({
          document_name: docName,
          source_type: String(doc.source_type),
          stage: "storage_download",
          code: "STORAGE_OBJECT_MISSING",
          message: "The downloaded utility document could not be retrieved.",
        }),
      );
      await persistDocumentProcessingState(supabase, {
        coordinationRecordId: coordinationRecordIdStr,
        projectId,
        externalApplicationId: extAppId,
        state: { ...runState, documents: [...manifestDocuments], findings: allFindings },
      });
      continue;
    }

    let buffer;
    try {
      buffer = Buffer.from(await download.data.arrayBuffer());
    } catch (err) {
      manifestDocuments.push(
        buildManifestEntry(doc, {
          processing_status: "failed",
          failure_reason: "Corrupt file",
          processed_at: now,
        }),
      );
      failedDocuments.push(
        buildProcessingFailure({
          document_name: docName,
          source_type: String(doc.source_type),
          stage: "buffer_conversion",
          code: "CORRUPT_FILE",
          message: safeProcessingErrorMessage(err),
        }),
      );
      await persistDocumentProcessingState(supabase, {
        coordinationRecordId: coordinationRecordIdStr,
        projectId,
        externalApplicationId: extAppId,
        state: { ...runState, documents: [...manifestDocuments], findings: allFindings },
      });
      continue;
    }

    const header = buffer.slice(0, 4).toString();
    const isPdf = /\.pdf$/i.test(String(doc.file_name ?? "")) || header === "%PDF";

    if (!isPdf) {
      manifestDocuments.push(
        buildManifestEntry(doc, {
          processing_status: "unsupported",
          failure_reason: "Unsupported format",
          processed_at: now,
          file_size: buffer.length,
        }),
      );
      await persistDocumentProcessingState(supabase, {
        coordinationRecordId: coordinationRecordIdStr,
        projectId,
        externalApplicationId: extAppId,
        state: { ...runState, documents: [...manifestDocuments], findings: allFindings },
      });
      continue;
    }

    let pages;
    try {
      const analyzed = await extractPdfPagesFn(buffer, deps);
      pages = analyzed.map((p) => ({
        pageNumber: p.pageNumber,
        text: String(p.text ?? ""),
        analysis: p.analysis,
      }));
    } catch (err) {
      manifestDocuments.push(
        buildManifestEntry(doc, {
          processing_status: "failed",
          failure_reason: "Parser failure",
          processed_at: now,
          file_size: buffer.length,
        }),
      );
      failedDocuments.push(
        buildProcessingFailure({
          document_name: docName,
          source_type: String(doc.source_type),
          stage: "pdf_parse",
          code: "PDF_PARSE_FAILED",
          message: safeProcessingErrorMessage(err),
        }),
      );
      await persistDocumentProcessingState(supabase, {
        coordinationRecordId: coordinationRecordIdStr,
        projectId,
        externalApplicationId: extAppId,
        state: { ...runState, documents: [...manifestDocuments], findings: allFindings },
      });
      continue;
    }

    let pageResult;
    let docFindings = [];
    try {
      pageResult = processDocumentPages(pages);
      const source = {
        source_type: doc.source_type,
        source_document_name: docName,
        source_document_id: doc.source_document_id ?? null,
        source_storage_path: storagePath,
        source_content_hash: contentHash,
        external_application_id: extAppId,
      };

      docFindings = extractBroadFindingsFromPages(pages, source, documentId, roles);
      allFindings = allFindings.concat(docFindings);
    } catch (err) {
      manifestDocuments.push(
        buildManifestEntry(doc, {
          processing_status: "failed",
          failure_reason: "Page processing failure",
          processed_at: now,
          file_size: buffer.length,
        }),
      );
      failedDocuments.push(
        buildProcessingFailure({
          document_name: docName,
          source_type: String(doc.source_type),
          stage: "page_processing",
          code: "PAGE_PROCESSING_FAILED",
          message: safeProcessingErrorMessage(err),
        }),
      );
      await persistDocumentProcessingState(supabase, {
        coordinationRecordId: coordinationRecordIdStr,
        projectId,
        externalApplicationId: extAppId,
        state: { ...runState, documents: [...manifestDocuments], findings: allFindings },
      });
      continue;
    }

    const findingsQuality = evaluateDocumentFindingsExtraction(pages, roles, docFindings);

    manifestDocuments.push(
      buildManifestEntry(doc, {
        processing_status: pageResult.processing_status,
        page_count: pages.length,
        pages_processed: pageResult.pages_processed,
        extraction_methods_used: pageResult.extraction_methods_used,
        findings_count: docFindings.length,
        failure_reason: pageResult.failure_reason,
        processed_at: now,
        page_coverage: pageResult.page_coverage,
        page_records: pageResult.page_records,
        file_size: buffer.length,
        findings_extraction_status: findingsQuality.status,
        findings_quality_warnings: findingsQuality.warnings,
      }),
    );

    await persistDocumentProcessingState(supabase, {
      coordinationRecordId: coordinationRecordIdStr,
      projectId,
      externalApplicationId: extAppId,
      state: { ...runState, documents: [...manifestDocuments], findings: allFindings },
    });
  }

  const coverage = computeCoverageSummary(manifestDocuments, allFindings);
  const findingsByStage = {
    agent_2_load_profile: filterFindingsForUciStage(allFindings, "agent_2_load_profile"),
    agent_3_application_package: filterFindingsForUciStage(allFindings, "agent_3_application_package"),
    agent_4_submission: filterFindingsForUciStage(allFindings, "agent_4_submission"),
  };

  const completion = evaluateRunCompletion({
    external_application_id: extAppId,
    documents: manifestDocuments,
    coverage,
  });

  const fallbackConfig = getDocumentFallbackConfig(deps.env);
  const providerStatus = fallbackProviderStatus(fallbackConfig);

  const finalState = {
    ...runState,
    documents: manifestDocuments,
    findings: allFindings,
    findings_by_stage: findingsByStage,
    coverage,
    run_status: completion.run_status,
    run_completed_at: new Date().toISOString(),
    completion_blockers: completion.blockers,
    failed_documents: failedDocuments,
    fallback_provider_status: providerStatus,
    fallback_config: {
      vision_enabled: fallbackConfig.vision_enabled,
      ocr_enabled: fallbackConfig.ocr_enabled,
      vision_max_pages_per_run: fallbackConfig.vision_max_pages_per_run,
      ocr_max_pages_per_run: fallbackConfig.ocr_max_pages_per_run,
    },
  };

  await persistDocumentProcessingState(supabase, {
    coordinationRecordId: coordinationRecordIdStr,
    projectId,
    externalApplicationId: extAppId,
    state: finalState,
  });

  return buildDocumentProcessingRunResponse({
    coordination_record_id: coordinationRecordIdStr,
    external_application_id: extAppId,
    run_status: completion.run_status,
    documents_discovered: discovery.documents.length,
    documents_registered: manifestDocuments.length,
    coverage,
    documents: manifestDocuments.map(sanitizeManifestEntryForApi),
    findings_count: allFindings.length,
    findings_by_stage_counts: {
      agent_2_load_profile: findingsByStage.agent_2_load_profile.length,
      agent_3_application_package: findingsByStage.agent_3_application_package.length,
      agent_4_submission: findingsByStage.agent_4_submission.length,
    },
    failed_documents: failedDocuments,
    completion_blockers: completion.blockers,
  });
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function getDocumentProcessingManifest(supabase, params) {
  const { coordinationRecordId, externalApplicationId, includeFindings = false } = params;
  const extAppId = String(externalApplicationId || "").trim();
  if (!extAppId) {
    const err = new Error("external_application_id is required");
    err.statusCode = 400;
    err.code = "EXTERNAL_APPLICATION_REQUIRED";
    throw err;
  }

  const record = await getCoordinationRecordById(supabase, coordinationRecordId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const state = getDocumentProcessingState(record.metadata, extAppId);
  if (!state) {
    return {
      coordination_record_id: String(coordinationRecordId),
      external_application_id: extAppId,
      run_status: "pending",
      coverage: computeCoverageSummary([], []),
      documents: [],
      findings_count: 0,
    };
  }

  const sanitized = sanitizeDocumentProcessingForApi(state);
  const out = {
    coordination_record_id: String(coordinationRecordId),
    external_application_id: extAppId,
    run_status: sanitized.run_status ?? "pending",
    run_started_at: sanitized.run_started_at ?? null,
    run_completed_at: sanitized.run_completed_at ?? null,
    coverage: sanitized.coverage ?? computeCoverageSummary([], []),
    documents: sanitized.documents ?? [],
    findings_count: Array.isArray(sanitized.findings) ? sanitized.findings.length : 0,
    findings_by_stage_counts: {
      agent_2_load_profile: sanitized.findings_by_stage?.agent_2_load_profile?.length ?? 0,
      agent_3_application_package: sanitized.findings_by_stage?.agent_3_application_package?.length ?? 0,
      agent_4_submission: sanitized.findings_by_stage?.agent_4_submission?.length ?? 0,
    },
    completion_blockers: sanitized.completion_blockers ?? [],
    failed_documents: sanitized.failed_documents ?? [],
    fallback_provider_status:
      sanitized.fallback_provider_status ??
      fallbackProviderStatus(getDocumentFallbackConfig()),
    fallback_processing: sanitized.fallback_processing ?? null,
    fallback_config: sanitized.fallback_config ?? null,
  };

  if (includeFindings) {
    out.findings = sanitized.findings ?? [];
    out.findings_by_stage = sanitized.findings_by_stage ?? {};
  }

  return out;
}

module.exports = {
  DOCUMENT_PROCESSING_SCHEMA_VERSION,
  STALE_DOCUMENT_PROCESSING_SCHEMA_VERSIONS,
  METADATA_KEY,
  UCI_DOCUMENT_ROLES,
  ROLE_TO_UCI_STAGES,
  classifyDocumentRoles,
  mapRolesToUciStages,
  discoverAllUciDocuments,
  buildManifestEntry,
  buildStableDocumentId,
  processDocumentPages,
  classifyPdfPage,
  extractPdfPagesWithAnalysis,
  processDocumentPagesFromAnalysis,
  extractBroadFindingsFromPages,
  candidateRecordToFinding,
  resolveFindingUciStages,
  evaluateDocumentFindingsExtraction,
  filterFindingsForUciStage,
  markStaleFindings,
  computeCoverageSummary,
  evaluateRunCompletion,
  sanitizeDocumentProcessingForApi,
  sanitizeManifestEntryForApi,
  getDocumentProcessingState,
  persistDocumentProcessingState,
  runDocumentProcessing,
  getDocumentProcessingManifest,
  safeProcessingErrorMessage,
  buildProcessingFailure,
  externalApplicationExistsInRecord,
  buildDocumentProcessingRunResponse,
  summarizeDocumentProcessingCounts,
};
