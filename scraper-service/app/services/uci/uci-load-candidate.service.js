"use strict";

const crypto = require("crypto");
const path = require("path");
const { getCoordinationRecordById } = require("./uci-records.service.js");
const {
  findAgentDraftApplication,
  LOAD_PROFILE_IDEMPOTENCY_KEY,
  reconcileLoadProfileReadiness,
} = require("./uci-load-profile.service.js");
const {
  extractPepcoPortalFiles,
  validatePepcoStoragePathForRecord,
  isPepcoPortalFileAccessible,
  parseCoordinationMetadata,
} = require("./uci-package-document-bridge.service.js");
const { UCI_DOCUMENTS_STORAGE_BUCKET } = require("./uci-document-storage.service.js");
const { downloadFromSupabaseStorage } = require("../../../shared/supabase-storage-upload.js");

const LOAD_EXTRACTION_SCHEMA_VERSION = "row6-v4";

/** Prior schema versions whose unapproved candidates should be marked stale on re-extraction. */
const STALE_EXTRACTION_SCHEMA_VERSIONS = new Set(["row6-v1", "row6-v2", "row6-v3"]);
const PROJECT_DOCUMENTS_BUCKET = "project-documents";

const PROJECT_DOCUMENTS_SELECT =
  "id, project_id, document_type, file_name, file_path, file_type, description, created_at";

/**
 * @param {object} params
 */
class LoadCandidateExtractionError extends Error {
  constructor(params) {
    const message = String(params.message ?? "Load candidate extraction failed");
    super(message);
    this.name = "LoadCandidateExtractionError";
    this.code = "LOAD_CANDIDATE_EXTRACTION_FAILED";
    this.stage = String(params.stage ?? "unknown");
    this.document_name = params.documentName != null ? String(params.documentName) : null;
    this.statusCode =
      typeof params.statusCode === "number" && params.statusCode >= 400 && params.statusCode <= 599
        ? params.statusCode
        : 500;
  }
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function safeExtractionErrorMessage(err) {
  const message = err instanceof Error ? err.message : String(err ?? "unknown error");
  return message
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[email]")
    .slice(0, 500);
}

/**
 * @param {unknown} err
 * @param {object} params
 */
function toLoadCandidateExtractionError(err, params) {
  if (err instanceof LoadCandidateExtractionError) return err;
  return new LoadCandidateExtractionError({
    stage: params.stage,
    documentName: params.documentName ?? null,
    message: safeExtractionErrorMessage(err),
    statusCode: params.statusCode,
  });
}

/** Field keys that may satisfy package connected_load_data after human approval. */
const CONNECTED_LOAD_SATISFACTION_KEYS = new Set([
  "connected_load_kw",
  "connected_load_kva",
  "demand_load_kw",
  "demand_load_kva",
  "connected_equipment_or_load_data",
]);

/** Project-level load fields (never panel-prefixed). */
const PROJECT_LEVEL_LOAD_FIELDS = new Set([
  "connected_load_kw",
  "connected_load_kva",
  "demand_load_kw",
  "demand_load_kva",
]);

const EXTRACTABLE_FIELD_KEYS = new Set([
  ...PROJECT_LEVEL_LOAD_FIELDS,
  "panel_connected_load_kw",
  "panel_connected_load_kva",
  "panel_demand_load_kw",
  "panel_demand_load_kva",
  "connected_equipment_or_load_data",
  "central_ac_count",
  "central_heat_count",
  "service_amperage",
  "service_entrance_amperage",
  "requested_service_amperage",
  "existing_service_amperage",
  "requested_voltage",
  "service_voltage",
  "phase",
  "meter_count",
  "service_configuration",
  "wire_configuration",
  "main_distribution_panel_rating",
  "panel_rating",
  "disconnect_rating",
  "meter_present",
  "ct_cabinet_present",
  "transformer_present",
  "equipment_schedule_voltage",
  "equipment_schedule_phase",
  "equipment_schedule_amperage",
  "equipment_schedule_watts",
  "equipment_schedule_kva",
  "lighting_interior_total_watts",
  "lighting_exterior_total_watts",
  "construction_start_date",
  "construction_completion_date",
  "requested_in_service_date",
]);

const PHASE_EQUIPMENT_REJECT_PATTERNS = [
  /\bmotor(?:s)?\b/i,
  /\bstarter(?:s)?\b/i,
  /\breceptacle(?:s)?\b/i,
  /\bbranch\s+circuit(?:s)?\b/i,
  /\bequipment\s+option(?:s)?\b/i,
  /\bgeneral\s+specification(?:s)?\b/i,
  /\bspecification\s+clause(?:s)?\b/i,
];

const PHASE_SERVICE_ACCEPT_PATTERNS = [
  /\belectrical\s+service\b/i,
  /\bincoming\s+service\b/i,
  /\bservice\s+voltage\b/i,
  /\bmain\s+service\b/i,
  /\butility\s+service\b/i,
  /\bswitchboard\b/i,
  /\bservice\s+entrance\b/i,
  /\bone[\s-]?line\b/i,
  /\bsingle[\s-]?line\b/i,
  /\bservice\s+phase\b/i,
];

const PROJECT_TOTAL_EVIDENCE_PATTERNS = [
  /\bproject\s+connected\s+load\b/i,
  /\bproject\s+demand\s+load\b/i,
  /\btotal\s+building\s+load\b/i,
  /\bbuilding\s+demand\b/i,
  /\bbuilding\s+total\b/i,
  /\btotal\s+service\s+load\b/i,
  /\bmain\s+service\s+demand\b/i,
  /\btotal\s+service\b/i,
  /\bmain\s+service\s+total\b/i,
  /\butility\s+service\s+total\b/i,
  /\bincoming\s+service\b/i,
  /\bservice\s+entrance\s+total\b/i,
  /\boverall\s+connected\s+load\b/i,
  /\boverall\s+load\b/i,
  /\btotal\s+project\s+load\b/i,
  /\bproject\s+total\b/i,
  /\bwhole[\s-]?building\s+load\b/i,
  /\bsite\s+total\b/i,
  /\bswitchboard\s+total\b/i,
  /\bmain\s+switchboard\s+total\b/i,
  /\bmain\s+service\b/i,
  /\butility\s+service\b/i,
  /\bservice\s+entrance\b/i,
];

const STRUCTURED_EQUIPMENT_LOAD_MAP = {
  centralAC: { field_key: "central_ac_count", label: "Central AC" },
  centralHeat: { field_key: "central_heat_count", label: "Central heat" },
};

/** Filename / metadata signals for load-bearing documents (ranking only). */
const LOAD_DOCUMENT_RANK_RULES = [
  { score: 100, pattern: /\bPANEL[\s-]*SCHEDULES?\b/i, reason: "panel schedule" },
  { score: 95, pattern: /\bLOAD[\s-]*CALC(?:ULATION)?\b/i, reason: "load calculation" },
  { score: 90, pattern: /\b(ONE[\s-]*LINE|SINGLE[\s-]*LINE)\b/i, reason: "one-line diagram" },
  {
    score: 85,
    pattern: /\bEQUIPMENT[\s-]*UTILITY[\s-]*SCHEDULE\b/i,
    reason: "equipment utility schedule",
  },
  { score: 80, pattern: /\bELECTRICAL[\s-]*SPEC(?:IFICATION)?S?\b/i, reason: "electrical specifications" },
  { score: 75, pattern: /\bSERVICE[\s-]*APPLICATION\b/i, reason: "service application" },
  { score: 70, pattern: /\bCOM[\s-]*CHECK\b/i, reason: "COMcheck" },
  { score: 60, pattern: /\bELECTRICAL[\s-]*PLAN\b/i, reason: "electrical plan" },
];

const PDF_TEXT_FIELD_PATTERNS = [
  {
    field_key: "connected_load_kw",
    regex: /\b(?:connected)\s+load[:\s]*(\d+(?:\.\d+)?)\s*(KW|KILOWATTS?)\b/gi,
    unitGroup: 2,
    valueGroup: 1,
    loadKind: "connected",
  },
  {
    field_key: "connected_load_kva",
    regex: /\b(?:connected)\s+load[:\s]*(\d+(?:\.\d+)?)\s*(KVA)\b/gi,
    unitGroup: 2,
    valueGroup: 1,
    loadKind: "connected",
  },
  {
    field_key: "demand_load_kw",
    regex: /\bdemand(?:\s+load)?[:\s]*(\d+(?:\.\d+)?)\s*(KW|KILOWATTS?)\b/gi,
    unitGroup: 2,
    valueGroup: 1,
    loadKind: "demand",
  },
  {
    field_key: "demand_load_kva",
    regex: /\bdemand(?:\s+load)?[:\s]*(\d+(?:\.\d+)?)\s*(KVA)\b/gi,
    unitGroup: 2,
    valueGroup: 1,
    loadKind: "demand",
  },
  {
    field_key: "requested_service_amperage",
    regex: /\brequested\s+service\s+amperage[:\s]*(\d+(?:\.\d+)?)\s*(A|AMP(?:ERE)?S?)\b/gi,
    unitGroup: 2,
    valueGroup: 1,
  },
  {
    field_key: "service_amperage",
    regex: /\b(?:service|main)\s*(?:size|amp(?:erage)?)?[:\s]*(\d+(?:\.\d+)?)\s*(A|AMP(?:ERE)?S?)\b/gi,
    unitGroup: 2,
    valueGroup: 1,
  },
  {
    field_key: "requested_voltage",
    regex: /\b(?:requested\s+|service\s+)voltage[:\s]*(\d{2,4}(?:\s*\/\s*\d{2,4})?)\s*(V|VOLTS?)\b/gi,
    unitGroup: 2,
    valueGroup: 1,
    valueType: "voltage",
  },
  {
    field_key: "meter_count",
    regex: /\b(?:meter\s+count[:\s]*(\d+)|(\d+)\s*meters?)\b/gi,
    unitGroup: 0,
    valueGroup: 1,
    fallbackValueGroup: 2,
  },
  {
    field_key: "wire_configuration",
    regex: /\bwire\s+configuration[:\s]*(\d+)\s*(wire)\b/gi,
    unitGroup: 2,
    valueGroup: 1,
  },
  {
    field_key: "construction_start_date",
    regex: /\bgroundbreak(?:ing)?(?:\s+date)?[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})\b/gi,
    unitGroup: 0,
    valueGroup: 1,
    valueType: "date",
  },
  {
    field_key: "construction_completion_date",
    regex: /\bconstruction\s+completion(?:\s+date|\s+target)?[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})\b/gi,
    unitGroup: 0,
    valueGroup: 1,
    valueType: "date",
  },
  {
    field_key: "requested_in_service_date",
    regex: /\brequested(?:\s+utility)?\s+in[\s-]*service(?:\s+(?:date|target))?[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})\b/gi,
    unitGroup: 0,
    valueGroup: 1,
    valueType: "date",
  },
];

/**
 * @param {string} text
 */
function normalizeSearchText(text) {
  return String(text ?? "")
    .trim()
    .toUpperCase()
    .replace(/[_]+/g, " ");
}

/**
 * @param {{ fileName?: string | null, documentType?: string | null, pepcoDocumentType?: string | null }} doc
 * @returns {{ score: number, reasons: string[] }}
 */
function rankLoadSourceDocument(doc) {
  const combined = normalizeSearchText(
    [doc.fileName, doc.documentType, doc.pepcoDocumentType].filter(Boolean).join(" "),
  );
  if (!combined) return { score: 0, reasons: [] };

  let score = 0;
  /** @type {string[]} */
  const reasons = [];
  for (const rule of LOAD_DOCUMENT_RANK_RULES) {
    if (rule.pattern.test(combined)) {
      score = Math.max(score, rule.score);
      reasons.push(rule.reason);
    }
  }
  if (/\.PDF$/i.test(String(doc.fileName ?? ""))) {
    score += 5;
  }
  return { score, reasons };
}

/**
 * @param {object} input
 */
function buildCandidateRecord(input) {
  const {
    field_key,
    raw_value,
    normalized_value = null,
    unit = null,
    source_type,
    source_document_name,
    source_document_id = null,
    source_storage_path = "",
    source_content_hash = "",
    page_number = null,
    evidence_text = "",
    extraction_method,
    confidence = null,
    conflict_group = null,
    external_application_id = "",
    entity_type = "project_service",
    entity_name = null,
    is_project_total = true,
    schedule_heading = null,
    generic_specification_reference = false,
    nested_object_unnormalized = false,
    panel_identifier_missing = false,
    replaces_candidate_id = null,
    superseded_by_candidate_id = null,
    field_label = null,
    fact_type = null,
    category = null,
    review_blocked_reason = null,
    requires_human_review = true,
    aggregation_role = null,
    utility_type = null,
    energy_domain = null,
    capacity_type = null,
    evidence_fingerprint = null,
    contributing_methods = null,
    equipment_description = null,
    fixture_scope = null,
    fixture_control = null,
    equipment_quantity = null,
    equipment_zone = null,
    heating_fuel = null,
    debug_rejected_amperage_matches = null,
  } = input;

  const fieldKey = String(field_key);
  const unitStr = unit != null ? String(unit) : null;
  const fieldUnitMismatch =
    unitStr != null &&
    (fieldKey.endsWith("_kw") || fieldKey.endsWith("_kva")) &&
    !fieldKeyMatchesUnit(fieldKey, unitStr);

  const candidateId = buildCandidateId({
    field_key: fieldKey,
    source_content_hash,
    external_application_id,
    extraction_method,
    page_number,
    raw_value,
    entity_name,
  });

  const scalarNormalized =
    normalized_value != null &&
    typeof normalized_value === "object" &&
    !Array.isArray(normalized_value)
      ? null
      : normalized_value;

  const ambiguous =
    scalarNormalized == null ||
    nested_object_unnormalized ||
    fieldUnitMismatch ||
    (unitStr == null &&
      fieldKey !== "connected_equipment_or_load_data" &&
      fieldKey !== "phase" &&
      fieldKey !== "service_configuration" &&
      !fieldKey.endsWith("_date") &&
      !fieldKey.endsWith("_count"));

  const record = {
    candidate_id: candidateId,
    field_key: fieldKey,
    raw_value: String(raw_value),
    normalized_value: scalarNormalized,
    unit: unitStr,
    status: "candidate",
    source_type,
    source_document_name: String(source_document_name),
    source_document_id,
    source_storage_path: String(source_storage_path),
    source_content_hash: String(source_content_hash),
    page_number,
    evidence_text: String(evidence_text).slice(0, 2000),
    extraction_method,
    confidence,
    conflict_group,
    external_application_id: external_application_id ? String(external_application_id) : null,
    extraction_schema_version: LOAD_EXTRACTION_SCHEMA_VERSION,
    entity_type: String(entity_type),
    entity_name: entity_name != null ? String(entity_name) : null,
    is_project_total: Boolean(is_project_total),
    schedule_heading: schedule_heading != null ? String(schedule_heading) : null,
    generic_specification_reference: Boolean(generic_specification_reference),
    nested_object_unnormalized: Boolean(nested_object_unnormalized),
    field_unit_mismatch: fieldUnitMismatch,
    ambiguous,
    panel_identifier_missing: Boolean(panel_identifier_missing),
    replaces_candidate_id: replaces_candidate_id != null ? String(replaces_candidate_id) : null,
    superseded_by_candidate_id:
      superseded_by_candidate_id != null ? String(superseded_by_candidate_id) : null,
    field_label: field_label != null ? String(field_label) : null,
    fact_type: fact_type != null ? String(fact_type) : null,
    category: category != null ? String(category) : null,
    review_blocked_reason:
      review_blocked_reason != null ? String(review_blocked_reason) : null,
    requires_human_review: Boolean(requires_human_review),
    can_satisfy_package: false,
    approval_blocked_reason: null,
    aggregation_role: aggregation_role != null ? String(aggregation_role) : null,
    utility_type: utility_type != null ? String(utility_type) : null,
    energy_domain: energy_domain != null ? String(energy_domain) : null,
    capacity_type: capacity_type != null ? String(capacity_type) : null,
    evidence_fingerprint: evidence_fingerprint != null ? String(evidence_fingerprint) : null,
    contributing_methods: Array.isArray(contributing_methods) ? contributing_methods : null,
    equipment_description: equipment_description != null ? String(equipment_description) : null,
    fixture_scope: fixture_scope != null ? String(fixture_scope) : null,
    fixture_control: fixture_control != null ? String(fixture_control) : null,
    equipment_quantity: equipment_quantity != null ? Number(equipment_quantity) : null,
    equipment_zone: equipment_zone != null ? String(equipment_zone) : null,
    heating_fuel: heating_fuel != null ? String(heating_fuel) : null,
    debug_rejected_amperage_matches: debug_rejected_amperage_matches,
    created_at: new Date().toISOString(),
  };

  record.can_satisfy_package = canCandidateSatisfyPackage(record);
  record.approval_blocked_reason = approvalBlockedReason(record);
  return record;
}

/**
 * @param {object} params
 */
function buildCandidateId(params) {
  const payload = [
    params.external_application_id || "",
    params.source_content_hash || "",
    LOAD_EXTRACTION_SCHEMA_VERSION,
    params.field_key || "",
    params.extraction_method || "",
    params.page_number != null ? String(params.page_number) : "",
    params.entity_name || "",
    params.raw_value || "",
  ].join("|");
  const digest = crypto.createHash("sha256").update(payload).digest("hex").slice(0, 24);
  return `load_candidate:${digest}`;
}

/**
 * @param {string} unitRaw
 */
function normalizeUnit(unitRaw) {
  const u = String(unitRaw ?? "").trim().toUpperCase();
  if (!u) return null;
  if (/^KILOWATTS?$/.test(u) || u === "KW") return "kW";
  if (u === "KVA") return "kVA";
  if (/^AMP(?:ERE)?S?$/.test(u) || u === "A") return "A";
  if (/^VOLTS?$/.test(u) || u === "V") return "V";
  if (u === "WIRE") return "wire";
  return u;
}

/**
 * @param {string} phaseRaw
 */
function normalizePhase(phaseRaw) {
  const p = String(phaseRaw ?? "").trim().toLowerCase().replace(/[\s-]+/g, " ");
  if (/single|1 phase/.test(p)) return "single_phase";
  if (/three|3 phase/.test(p)) return "three_phase";
  return null;
}

/**
 * @param {"connected" | "demand"} loadKind
 * @param {string | null} unit
 * @param {boolean} panelScoped
 */
function resolveLoadFieldKey(loadKind, unit, panelScoped = false) {
  const u = normalizeUnit(unit);
  let base = null;
  if (loadKind === "demand") {
    if (u === "kVA") base = "demand_load_kva";
    else if (u === "kW") base = "demand_load_kw";
  } else if (loadKind === "connected") {
    if (u === "kVA") base = "connected_load_kva";
    else if (u === "kW") base = "connected_load_kw";
  }
  if (!base) return null;
  return panelScoped ? `panel_${base}` : base;
}

/**
 * @param {string} fieldKey
 * @param {string | null} unit
 */
function fieldKeyMatchesUnit(fieldKey, unit) {
  const u = normalizeUnit(unit);
  if (!u) return false;
  if (fieldKey.endsWith("_kw")) return u === "kW";
  if (fieldKey.endsWith("_kva")) return u === "kVA";
  if (fieldKey === "service_amperage" || fieldKey === "service_entrance_amperage") return u === "A";
  if (fieldKey === "requested_voltage" || fieldKey === "service_voltage") return u === "V";
  if (fieldKey === "phase") return u === "phase";
  if (fieldKey.endsWith("_count")) return u === "count";
  return true;
}

/**
 * @param {string} evidence
 */
function isProjectTotalEvidence(evidence) {
  return PROJECT_TOTAL_EVIDENCE_PATTERNS.some((pattern) => pattern.test(evidence));
}

/**
 * @param {string} text
 * @param {number} matchIndex
 * @param {string} [evidence]
 */
function isPanelScheduleEvidence(text, matchIndex, evidence) {
  const ev = String(evidence ?? "");
  if (/\bTOTAL\s+(?:DEMAND|CONNECTED)\s+LOAD\b/i.test(ev)) return true;
  const window = String(text ?? "").slice(Math.max(0, matchIndex - 500), matchIndex + 200);
  if (/\bPANEL\s+SCHEDULE\b/i.test(window)) return true;
  if (/\b(?:MSB|MDP|MDB|SWBD|SWITCHBOARD)\b/i.test(window)) return true;
  if (/\bPANEL\s+[A-Z0-9]/i.test(window)) return true;
  return false;
}

/**
 * @param {string} fieldKey
 */
function loadFieldMeaning(fieldKey) {
  const key = String(fieldKey ?? "");
  if (key.includes("demand") && key.includes("kva")) return "demand_kva";
  if (key.includes("demand") && key.includes("kw")) return "demand_kw";
  if (key.includes("connected") && key.includes("kva")) return "connected_kva";
  if (key.includes("connected") && key.includes("kw")) return "connected_kw";
  return key;
}

/**
 * @param {string} evidence
 */
function normalizeEvidenceFingerprint(evidence) {
  return String(evidence ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/**
 * @param {object} params
 */
function classifyLoadTotalCandidate(params) {
  const {
    text,
    matchIndex,
    evidence,
    loadKind,
    unit,
    panelName: explicitPanelName = null,
    scheduleHeading: explicitScheduleHeading = null,
  } = params;

  const unitNorm = normalizeUnit(unit);
  const fieldKeyPanel = resolveLoadFieldKey(loadKind, unitNorm, true);
  const fieldKeyProject = resolveLoadFieldKey(loadKind, unitNorm, false);
  const ctx = extractPanelContextFromText(text, matchIndex);
  const panelName = explicitPanelName ?? ctx.panelName;
  const scheduleHeading = explicitScheduleHeading ?? ctx.scheduleHeading;
  const inPanelSchedule = isPanelScheduleEvidence(text, matchIndex, evidence);
  const hasProjectEvidence = isProjectTotalEvidence(evidence);

  if (
    hasProjectEvidence &&
    inPanelSchedule &&
    /\b(building|project|overall|whole[\s-]?building|total\s+service|main\s+service|utility\s+service|service\s+entrance)\b/i.test(
      evidence,
    )
  ) {
    return {
      field_key: fieldKeyProject,
      entity_type: "project_service",
      entity_name: null,
      is_project_total: true,
      panel_identifier_missing: false,
      schedule_heading: scheduleHeading,
    };
  }

  if (hasProjectEvidence && !inPanelSchedule) {
    return {
      field_key: fieldKeyProject,
      entity_type: "project_service",
      entity_name: null,
      is_project_total: true,
      panel_identifier_missing: false,
      schedule_heading: scheduleHeading,
    };
  }

  if (panelName) {
    return {
      field_key: fieldKeyPanel,
      entity_type: "electrical_panel",
      entity_name: panelName,
      is_project_total: false,
      panel_identifier_missing: false,
      schedule_heading: scheduleHeading,
    };
  }

  if (inPanelSchedule || scheduleHeading) {
    return {
      field_key: fieldKeyPanel,
      entity_type: "electrical_panel",
      entity_name: null,
      is_project_total: false,
      panel_identifier_missing: true,
      schedule_heading: scheduleHeading,
    };
  }

  return {
    field_key: fieldKeyPanel,
    entity_type: "unclassified_load_total",
    entity_name: null,
    is_project_total: false,
    panel_identifier_missing: false,
    schedule_heading: scheduleHeading,
  };
}

/**
 * @param {Record<string, unknown>} candidate
 */
function classificationPriority(candidate) {
  const entityType = String(candidate.entity_type ?? "");
  if (entityType === "project_service" && candidate.is_project_total === true) return 50;
  if (entityType === "electrical_panel" && candidate.entity_name) return 40;
  if (entityType === "electrical_panel" && candidate.panel_identifier_missing) return 30;
  if (entityType === "electrical_panel") return 35;
  if (entityType === "unclassified_load_total") return 20;
  if (entityType === "project_service" && candidate.is_project_total === false) return 10;
  return 0;
}

/**
 * Prefer preserved approvals, then active canonical findings, over stale
 * parallel-extractor rows that share the same semantic evidence.
 *
 * @param {Record<string, unknown>} candidate
 */
function candidateDedupPriority(candidate) {
  const status = String(candidate.status ?? "candidate");
  const statusPriority =
    status === "approved" ? 300 : status === "candidate" ? 200 : status === "rejected" ? 50 : 0;
  const canonicalPriority = candidate.source_type === "uci_document_finding" ? 10 : 0;
  return statusPriority + canonicalPriority + classificationPriority(candidate);
}

/**
 * @param {Record<string, unknown>} candidate
 */
function semanticDedupKey(candidate) {
  const meaning = loadFieldMeaning(String(candidate.field_key ?? ""));
  if (meaning.startsWith("demand_") || meaning.startsWith("connected_")) {
    return [
      candidate.source_content_hash,
      candidate.source_document_name,
      candidate.page_number ?? "",
      candidate.normalized_value ?? "",
      candidate.unit ?? "",
      normalizeEvidenceFingerprint(String(candidate.evidence_text ?? "")),
      meaning,
    ].join("|");
  }
  return [
    candidate.source_content_hash,
    candidate.source_document_name,
    candidate.page_number ?? "",
    candidate.field_key ?? "",
    candidate.normalized_value ?? "",
    candidate.unit ?? "",
    normalizeEvidenceFingerprint(String(candidate.evidence_text ?? "")),
    candidate.entity_type ?? "",
    candidate.entity_name ?? "",
  ].join("|");
}

/**
 * @param {Array<Record<string, unknown>>} candidates
 */
function deduplicateLoadCandidates(candidates) {
  /** @type {Map<string, Record<string, unknown>>} */
  const best = new Map();
  for (const candidate of candidates) {
    const key = semanticDedupKey(candidate);
    const prev = best.get(key);
    if (!prev || candidateDedupPriority(candidate) > candidateDedupPriority(prev)) {
      best.set(key, candidate);
    }
  }
  return [...best.values()];
}

/**
 * @param {Array<Record<string, unknown>>} candidates
 */
function linkSupersededCandidates(candidates) {
  const active = candidates.filter(
    (c) =>
      c.status === "candidate" &&
      String(c.extraction_schema_version ?? "") === LOAD_EXTRACTION_SCHEMA_VERSION,
  );
  for (const candidate of candidates) {
    if (candidate.status !== "stale") continue;
    const replacement = active.find(
      (c) =>
        c.source_content_hash === candidate.source_content_hash &&
        c.page_number === candidate.page_number &&
        String(c.normalized_value) === String(candidate.normalized_value) &&
        c.unit === candidate.unit &&
        loadFieldMeaning(String(c.field_key ?? "")) ===
          loadFieldMeaning(String(candidate.field_key ?? "")) &&
        (c.entity_type !== candidate.entity_type ||
          String(c.entity_name ?? "") !== String(candidate.entity_name ?? "")),
    );
    if (replacement) {
      candidate.superseded_by_candidate_id = replacement.candidate_id;
      if (!replacement.replaces_candidate_id) {
        replacement.replaces_candidate_id = candidate.candidate_id;
      }
    }
  }
  return candidates;
}

/**
 * @param {string} evidence
 */
function isServicePhaseEvidence(evidence) {
  const text = String(evidence ?? "");
  if (PHASE_EQUIPMENT_REJECT_PATTERNS.some((pattern) => pattern.test(text))) {
    return false;
  }
  return PHASE_SERVICE_ACCEPT_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * @param {string} text
 * @param {number} matchIndex
 * @returns {{ panelName: string | null, scheduleHeading: string | null }}
 */
function extractPanelContextFromText(text, matchIndex) {
  const window = String(text ?? "").slice(Math.max(0, matchIndex - 400), matchIndex);
  const lines = window.split(/\r?\n/).filter(Boolean);
  let scheduleHeading = null;
  let panelName = null;

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!scheduleHeading && /\bPANEL\s+SCHEDULE\b/i.test(line)) {
      scheduleHeading = line.slice(0, 120);
    }
    const panelMatch =
      line.match(/\bPANEL\s+([A-Z0-9][A-Z0-9\s\-/.]{0,40})/i) ||
      line.match(/\b(MSB|MDP|MDB|SWBD|SWITCHBOARD)\s*[-:]?\s*([A-Z0-9][A-Z0-9\-/.]{0,20})?/i);
    if (panelMatch) {
      panelName = panelMatch[2]
        ? `${panelMatch[1]} ${panelMatch[2]}`.trim()
        : String(panelMatch[1] ?? panelMatch[0]).trim();
      break;
    }
  }

  return { panelName, scheduleHeading };
}

/**
 * @param {Record<string, unknown>} candidate
 */
function canCandidateSatisfyPackage(candidate) {
  const fieldKey = String(candidate.field_key ?? "");
  if (!CONNECTED_LOAD_SATISFACTION_KEYS.has(fieldKey)) return false;
  if (fieldKey.startsWith("panel_")) return false;
  if (candidate.entity_type === "unclassified_load_total") return false;
  if (candidate.panel_identifier_missing === true) return false;
  if (candidate.entity_type !== "project_service") return false;
  if (candidate.is_project_total === false) return false;
  if (candidate.ambiguous === true) return false;
  if (candidate.status === "stale") return false;
  if (!fieldKeyMatchesUnit(fieldKey, candidate.unit != null ? String(candidate.unit) : null)) {
    return false;
  }
  if (!isProjectTotalEvidence(String(candidate.evidence_text ?? ""))) return false;
  return candidate.normalized_value != null && candidate.normalized_value !== "";
}

/**
 * @param {Record<string, unknown>} candidate
 * @returns {string | null}
 */
function approvalBlockedReason(candidate) {
  if (candidate.status === "stale") return "Candidate is stale — re-extract before approving";
  if (candidate.ambiguous === true) return "Value or unit is ambiguous";
  if (candidate.field_unit_mismatch === true) return "Field key does not match extracted unit";
  if (candidate.nested_object_unnormalized === true) {
    return "Structured value was not normalized into a scalar field";
  }
  if (candidate.generic_specification_reference === true) {
    return "Evidence appears to be a generic specification reference, not service configuration";
  }
  if (candidate.entity_type === "unclassified_load_total") {
    return "Load total cannot be classified as panel or project/service";
  }
  if (candidate.panel_identifier_missing === true) {
    return "Panel identifier missing for panel-level total";
  }
  const fieldKey = String(candidate.field_key ?? "");
  if (fieldKey.startsWith("panel_")) {
    return "Panel-level totals cannot satisfy package connected load requirement";
  }
  if (
    PROJECT_LEVEL_LOAD_FIELDS.has(fieldKey) &&
    candidate.entity_type === "project_service" &&
    candidate.is_project_total === false
  ) {
    return "Evidence does not indicate a project/service total";
  }
  if (
    PROJECT_LEVEL_LOAD_FIELDS.has(fieldKey) &&
    candidate.entity_type !== "project_service"
  ) {
    return "Not classified as a project/service total";
  }
  if (!canCandidateSatisfyPackage(candidate) && CONNECTED_LOAD_SATISFACTION_KEYS.has(fieldKey)) {
    return "Does not meet package connected-load evidence requirements";
  }
  return null;
}

/**
 * @param {Record<string, unknown>} app
 * @param {string} externalApplicationId
 * @returns {Array<Record<string, unknown>>}
 */
function extractCandidatesFromStructuredApplication(app, externalApplicationId) {
  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  if (!app || typeof app !== "object") return out;

  const projectDetails =
    app.projectDetails && typeof app.projectDetails === "object" && !Array.isArray(app.projectDetails)
      ? /** @type {{ applicationDetails?: unknown }} */ (app.projectDetails)
      : null;
  const applicationDetails =
    projectDetails &&
    projectDetails.applicationDetails &&
    typeof projectDetails.applicationDetails === "object" &&
    !Array.isArray(projectDetails.applicationDetails)
      ? /** @type {Record<string, unknown>} */ (projectDetails.applicationDetails)
      : null;

  if (!applicationDetails) return out;

  const electricLoads = applicationDetails.electricServiceLoads;
  if (electricLoads && typeof electricLoads === "object" && !Array.isArray(electricLoads)) {
    for (const [key, raw] of Object.entries(/** @type {Record<string, unknown>} */ (electricLoads))) {
      if (raw == null || raw === "") continue;
      const mapping = STRUCTURED_EQUIPMENT_LOAD_MAP[key];
      if (mapping) {
        const n = Number(raw);
        if (!Number.isFinite(n) || n <= 0) continue;
        out.push(
          buildCandidateRecord({
            field_key: mapping.field_key,
            field_label: mapping.label,
            raw_value: String(raw),
            normalized_value: n,
            unit: "count",
            entity_type: "equipment",
            entity_name: mapping.label,
            fact_type: "equipment_fact",
            is_project_total: false,
            source_type: "provider_application",
            source_document_name: "provider_application_metadata",
            source_document_id: externalApplicationId,
            source_storage_path: "",
            source_content_hash: `structured:${externalApplicationId}:${key}`,
            page_number: null,
            evidence_text: `${mapping.label}: ${n}`,
            extraction_method: "structured_application",
            confidence: 0.9,
            external_application_id: externalApplicationId,
          }),
        );
        continue;
      }

      if (typeof raw === "object" && raw !== null) {
        const row = /** @type {Record<string, unknown>} */ (raw);
        const loadType = row.loadType ?? row.type ?? row.name ?? key;
        const value = row.value ?? row.load ?? row.kw ?? row.kva;
        const unitRaw = row.unit ?? row.kw != null ? "kW" : row.kva != null ? "kVA" : null;
        if (loadType == null || value == null || value === "" || unitRaw == null) continue;
        const unit = normalizeUnit(String(unitRaw));
        const fieldKey = resolveLoadFieldKey(
          /\bdemand\b/i.test(String(loadType)) ? "demand" : "connected",
          unit,
          false,
        );
        if (!fieldKey) continue;
        const n = Number(String(value).replace(/[^\d.]/g, ""));
        if (!Number.isFinite(n)) continue;
        out.push(
          buildCandidateRecord({
            field_key: fieldKey,
            raw_value: String(value),
            normalized_value: n,
            unit,
            entity_type: "equipment",
            entity_name: String(loadType),
            is_project_total: false,
            source_type: "provider_application",
            source_document_name: "provider_application_metadata",
            source_document_id: externalApplicationId,
            source_storage_path: "",
            source_content_hash: `structured:${externalApplicationId}:${key}`,
            page_number: null,
            evidence_text: `${key}: ${loadType} = ${value} ${unit}`,
            extraction_method: "structured_application",
            confidence: 0.85,
            external_application_id: externalApplicationId,
          }),
        );
      }
    }
  }

  const scalarMappings = [
    { key: "serviceVoltage", field_key: "service_voltage", unit: "V" },
    { key: "requestedVoltage", field_key: "requested_voltage", unit: "V" },
    { key: "requestedServiceAmperage", field_key: "requested_service_amperage", unit: "A" },
    { key: "phase", field_key: "phase", unit: null },
    { key: "meterCount", field_key: "meter_count", unit: "count" },
    { key: "serviceAmperage", field_key: "service_amperage", unit: "A" },
    { key: "serviceConfiguration", field_key: "service_configuration", unit: null },
    { key: "wireConfiguration", field_key: "wire_configuration", unit: null },
  ];

  for (const mapping of scalarMappings) {
    const raw = applicationDetails[mapping.key];
    if (raw == null || String(raw).trim() === "") continue;
    const rawStr = String(raw).trim();
    let normalized = null;
    let unit = mapping.unit;
    if (mapping.field_key === "phase") {
      normalized = normalizePhase(rawStr);
      unit = normalized ? "phase" : null;
    } else if (mapping.field_key === "meter_count") {
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) continue;
      normalized = n;
    } else if (mapping.unit === "A" || mapping.unit === "V") {
      const slashVoltage = mapping.unit === "V" && rawStr.match(/\b(\d{2,3}\/\d{2,3})\b/);
      if (slashVoltage) {
        normalized = slashVoltage[1];
      } else {
        const numberMatch = rawStr.match(/\d+(?:\.\d+)?/);
        normalized = numberMatch ? Number(numberMatch[0]) : null;
      }
    } else {
      normalized = rawStr;
    }

    out.push(
      buildCandidateRecord({
        field_key: mapping.field_key,
        raw_value: rawStr,
        normalized_value: normalized,
        unit,
        entity_type: "project_service",
        entity_name: null,
        is_project_total: true,
        source_type: "provider_application",
        source_document_name: "provider_application_metadata",
        source_document_id: externalApplicationId,
        source_storage_path: "",
        source_content_hash: `structured:${externalApplicationId}:${mapping.key}`,
        page_number: null,
        evidence_text: `${mapping.key}: ${rawStr}`,
        extraction_method: "structured_application",
        confidence: 0.85,
        external_application_id: externalApplicationId,
      }),
    );
  }

  return out;
}

/**
 * Extract only explicitly labeled service facts from a rendered utility
 * application. Blank meter/load rows intentionally produce no candidate.
 *
 * @param {string} text
 * @param {number} pageNumber
 * @param {Record<string, unknown>} source
 */
function extractUtilityApplicationCandidatesFromText(text, pageNumber, source) {
  const pageText = String(text ?? "");
  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  const push = (
    fieldKey,
    rawValue,
    normalizedValue,
    unit,
    evidence,
    confidence = 0.9,
  ) => {
    out.push(
      buildCandidateRecord({
        field_key: fieldKey,
        raw_value: String(rawValue),
        normalized_value: normalizedValue,
        unit,
        entity_type: "project_service",
        entity_name: null,
        is_project_total: true,
        source_type: source.source_type,
        source_document_name: source.source_document_name,
        source_document_id: source.source_document_id,
        source_storage_path: source.source_storage_path,
        source_content_hash: source.source_content_hash,
        page_number: pageNumber,
        evidence_text: String(evidence).replace(/\s+/g, " ").trim(),
        extraction_method: "utility_application_text",
        confidence,
        external_application_id: source.external_application_id,
      }),
    );
  };

  const currentDetails = pageText.match(/\bService\s+Size\s+A\s+(\d{2,4})\s*AMPS?\b/i);
  if (currentDetails) {
    push(
      "existing_service_amperage",
      currentDetails[1],
      Number(currentDetails[1]),
      "A",
      currentDetails[0],
      0.95,
    );
  }

  const customerRequest = pageText.match(
    /\bcurrent\s+service\s+is\s+(\d{2,4})\s*A\b[\s\S]{0,80}?\b(?:we\s+need|request(?:ed|ing)?)\s+(\d{2,4})\s*A\b/i,
  );
  if (customerRequest) {
    if (!currentDetails) {
      push(
        "existing_service_amperage",
        customerRequest[1],
        Number(customerRequest[1]),
        "A",
        customerRequest[0],
      );
    }
    push(
      "requested_service_amperage",
      customerRequest[2],
      Number(customerRequest[2]),
      "A",
      customerRequest[0],
    );
  }

  const voltage = pageText.match(
    /\bService\s+Voltage\s+(\d{2,3}\/\d{2,3})\s*V\b(?:[^\n]*)/i,
  );
  if (voltage) {
    push("service_voltage", voltage[1], voltage[1], "V", voltage[0]);
    const wires = voltage[0].match(/\b(\d+)[\s-]*wire\b/i);
    if (wires) {
      push("wire_configuration", wires[0], wires[1], "wire", voltage[0]);
    }
    const phase = voltage[0].match(/\b(\d+)[\s-]*phase\b/i);
    if (phase) {
      push("phase", phase[0], phase[1], "phase", voltage[0]);
    }
  }

  for (const rawLine of pageText.split(/\r?\n/)) {
    const meter = rawLine.match(
      /^\s*(?:Quantity\s+Of\s+)?(?:Electric\s+)?Meters?\s+(?:Requested\s+)?[:\-]?\s*(\d+)\s*$/i,
    );
    if (meter && Number(meter[1]) > 0) {
      push("meter_count", meter[1], Number(meter[1]), "count", rawLine);
    }
  }

  return deduplicateLoadCandidates(out);
}

/**
 * Route native text through the deterministic parser for known document
 * families. Imports are intentionally lazy because those parsers reuse
 * buildCandidateRecord from this module.
 *
 * @param {string} text
 * @param {number} pageNumber
 * @param {Record<string, unknown>} source
 */
function extractCandidatesFromKnownDocumentText(text, pageNumber, source) {
  const pageText = String(text ?? "");
  const name = String(source.source_document_name ?? "").replace(/[_-]+/g, " ");

  if (
    /\bService\s+Installation\s*&\s*Upgrades\s+Application\b/i.test(pageText) ||
    /\bApplication\b/i.test(name) ||
    (/\bCurrent\s+Service\s+Details\b/i.test(pageText) && /\bService\s+Voltage\b/i.test(pageText))
  ) {
    return extractUtilityApplicationCandidatesFromText(pageText, pageNumber, source);
  }

  const panelParser = require("./uci-panel-schedule-parser.service.js");
  if (/\bPANEL\s+SCHEDULES?\b/i.test(name) || panelParser.detectPanelScheduleText(pageText)) {
    return panelParser.extractPanelScheduleFindingsFromText(pageText, pageNumber, source);
  }

  const oneLineParser = require("./uci-one-line-extractor.service.js");
  if (/\b(?:ONE|SINGLE)\s+LINE\b/i.test(name) || oneLineParser.detectOneLineDiagramText(pageText)) {
    return oneLineParser.extractOneLineFindingsFromText(pageText, pageNumber, source);
  }

  const comcheckParser = require("./uci-comcheck-parser.service.js");
  if (/\bCOM\s*CHECK\b/i.test(name) || comcheckParser.detectComcheckReportText(pageText)) {
    return comcheckParser.extractComcheckFindingsFromText(pageText, pageNumber, source);
  }

  const equipmentParser = require("./uci-equipment-schedule-parser.service.js");
  if (
    /\bEQUIPMENT\s+(?:UTILITY\s+)?SCHEDULE\b/i.test(name) ||
    equipmentParser.detectEquipmentScheduleText(pageText)
  ) {
    return equipmentParser.extractEquipmentScheduleFindingsFromText(
      pageText,
      pageNumber,
      source,
    ).findings;
  }

  if (
    /\bE00[12]\b/i.test(name) ||
    /\bELECTRICAL\s+SPECIFICATIONS?\b/i.test(name) ||
    /\b(?:ELECTRICAL|POWER)\s+PLAN\b/i.test(name)
  ) {
    return [];
  }

  const textCandidates = extractCandidatesFromPdfText(pageText, pageNumber, source);
  return textCandidates.length
    ? textCandidates
    : extractCandidatesFromTables(pageText, pageNumber, source);
}

/**
 * @param {string} text
 * @param {number} pageNumber
 * @param {object} source
 * @returns {Array<Record<string, unknown>>}
 */
function extractPanelLoadCandidatesFromPdfText(text, pageNumber, source) {
  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  const pageText = String(text ?? "");
  const panelLoadRegex =
    /\bTOTAL\s+(?:DEMAND|CONNECTED)\s+LOAD\b[:\s]*(\d+(?:\.\d+)?)\s*(KW|KVA|KILOWATTS?)\b/gi;
  let match;
  while ((match = panelLoadRegex.exec(pageText)) !== null) {
    const rawValue = match[1];
    const unit = normalizeUnit(match[2]);
    const loadKind = /CONNECTED/i.test(match[0]) ? "connected" : "demand";
    const start = Math.max(0, match.index - 120);
    const end = Math.min(pageText.length, match.index + String(match[0]).length + 120);
    const evidence = pageText.slice(start, end).replace(/\s+/g, " ").trim();
    const classified = classifyLoadTotalCandidate({
      text: pageText,
      matchIndex: match.index,
      evidence,
      loadKind,
      unit,
    });
    if (!classified.field_key) continue;
    const n = Number(String(rawValue).replace(/[^\d.]/g, ""));
    const normalized = Number.isFinite(n) ? n : null;

    out.push(
      buildCandidateRecord({
        field_key: classified.field_key,
        raw_value: String(rawValue),
        normalized_value: normalized,
        unit,
        entity_type: classified.entity_type,
        entity_name: classified.entity_name,
        is_project_total: classified.is_project_total,
        panel_identifier_missing: classified.panel_identifier_missing,
        schedule_heading: classified.schedule_heading,
        source_type: source.source_type,
        source_document_name: source.source_document_name,
        source_document_id: source.source_document_id,
        source_storage_path: source.source_storage_path,
        source_content_hash: source.source_content_hash,
        page_number: pageNumber,
        evidence_text: evidence,
        extraction_method: "pdf_text",
        confidence: normalized != null && unit != null ? 0.75 : null,
        external_application_id: source.external_application_id,
      }),
    );
  }
  return out;
}

/**
 * @param {string} text
 * @param {number} pageNumber
 * @param {object} source
 * @returns {Array<Record<string, unknown>>}
 */
function extractServicePhaseCandidatesFromPdfText(text, pageNumber, source) {
  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  const pageText = String(text ?? "");
  const phaseRegex = /\b(single[\s-]?phase|three[\s-]?phase|1[\s-]?phase|3[\s-]?phase)\b/gi;
  let match;
  while ((match = phaseRegex.exec(pageText)) !== null) {
    const start = Math.max(0, match.index - 120);
    const end = Math.min(pageText.length, match.index + String(match[0]).length + 120);
    const evidence = pageText.slice(start, end).replace(/\s+/g, " ").trim();
    if (!isServicePhaseEvidence(evidence)) {
      out.push(
        buildCandidateRecord({
          field_key: "phase",
          raw_value: String(match[1]),
          normalized_value: null,
          unit: null,
          entity_type: "specification_reference",
          entity_name: null,
          is_project_total: false,
          generic_specification_reference: true,
          source_type: source.source_type,
          source_document_name: source.source_document_name,
          source_document_id: source.source_document_id,
          source_storage_path: source.source_storage_path,
          source_content_hash: source.source_content_hash,
          page_number: pageNumber,
          evidence_text: evidence,
          extraction_method: "pdf_text",
          confidence: null,
          external_application_id: source.external_application_id,
        }),
      );
      continue;
    }

    const normalized = normalizePhase(String(match[1]));
    out.push(
      buildCandidateRecord({
        field_key: "phase",
        raw_value: String(match[1]),
        normalized_value: normalized,
        unit: normalized ? "phase" : null,
        entity_type: "project_service",
        entity_name: null,
        is_project_total: true,
        source_type: source.source_type,
        source_document_name: source.source_document_name,
        source_document_id: source.source_document_id,
        source_storage_path: source.source_storage_path,
        source_content_hash: source.source_content_hash,
        page_number: pageNumber,
        evidence_text: evidence,
        extraction_method: "pdf_text",
        confidence: normalized ? 0.8 : null,
        external_application_id: source.external_application_id,
      }),
    );
  }
  return out;
}

/**
 * @param {string} text
 * @param {number} pageNumber
 * @param {object} source
 * @returns {Array<Record<string, unknown>>}
 */
function extractCandidatesFromPdfText(text, pageNumber, source) {
  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  const pageText = String(text ?? "");
  if (!pageText.trim()) return out;

  out.push(...extractPanelLoadCandidatesFromPdfText(pageText, pageNumber, source));
  out.push(...extractServicePhaseCandidatesFromPdfText(pageText, pageNumber, source));

  for (const pattern of PDF_TEXT_FIELD_PATTERNS) {
    if (!EXTRACTABLE_FIELD_KEYS.has(pattern.field_key)) continue;
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match;
    while ((match = regex.exec(pageText)) !== null) {
      if (
        pattern.field_key === "service_amperage" &&
        /\brequested\s+$/i.test(pageText.slice(Math.max(0, match.index - 20), match.index))
      ) {
        continue;
      }
      if (
        pattern.loadKind &&
        /\bTOTAL\s+(?:DEMAND|CONNECTED)\s+LOAD\b/i.test(String(match[0] ?? ""))
      ) {
        continue;
      }

      const rawValue =
        match[pattern.valueGroup] ??
        (pattern.fallbackValueGroup ? match[pattern.fallbackValueGroup] : "") ??
        "";
      let unit = null;
      let normalized = null;
      let fieldKey = pattern.field_key;
      let entityType = "project_service";
      let entityName = null;
      let isProjectTotal = true;
      let panelIdentifierMissing = false;
      let scheduleHeading = null;

      if (pattern.valueType === "date") {
        const parts = String(rawValue).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        normalized = parts
          ? `${parts[3]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`
          : null;
      } else if (pattern.valueType === "voltage" && String(rawValue).includes("/")) {
        unit = normalizeUnit(match[pattern.unitGroup]);
        normalized = String(rawValue).replace(/\s+/g, "");
      } else if (pattern.unitGroup > 0) {
        unit = normalizeUnit(match[pattern.unitGroup]);
        const n = Number(String(rawValue).replace(/[^\d.]/g, ""));
        normalized = unit && Number.isFinite(n) ? n : null;
        if (pattern.loadKind) {
          const start = Math.max(0, match.index - 80);
          const end = Math.min(pageText.length, match.index + String(match[0]).length + 80);
          const evidence = pageText.slice(start, end).replace(/\s+/g, " ").trim();
          if (/\bTOTAL\s+(?:DEMAND|CONNECTED)\s+LOAD\b/i.test(evidence)) continue;

          const classified = classifyLoadTotalCandidate({
            text: pageText,
            matchIndex: match.index,
            evidence,
            loadKind: pattern.loadKind,
            unit,
          });
          if (!classified.field_key) continue;
          fieldKey = classified.field_key;
          entityType = classified.entity_type;
          entityName = classified.entity_name;
          isProjectTotal = classified.is_project_total;
          panelIdentifierMissing = classified.panel_identifier_missing;
          scheduleHeading = classified.schedule_heading;

          const startEvidence = Math.max(0, match.index - 40);
          const endEvidence = Math.min(pageText.length, match.index + String(match[0]).length + 40);
          const evidenceText = pageText.slice(startEvidence, endEvidence).replace(/\s+/g, " ").trim();

          out.push(
            buildCandidateRecord({
              field_key: fieldKey,
              raw_value: String(rawValue),
              normalized_value: normalized,
              unit,
              entity_type: entityType,
              entity_name: entityName,
              is_project_total: isProjectTotal,
              panel_identifier_missing: panelIdentifierMissing,
              schedule_heading: scheduleHeading,
              source_type: source.source_type,
              source_document_name: source.source_document_name,
              source_document_id: source.source_document_id,
              source_storage_path: source.source_storage_path,
              source_content_hash: source.source_content_hash,
              page_number: pageNumber,
              evidence_text: evidenceText,
              extraction_method: source.extraction_method ?? "pdf_text",
              confidence: normalized != null && unit != null ? 0.7 : null,
              external_application_id: source.external_application_id,
            }),
          );
          continue;
        }
      } else {
        const n = Number(String(rawValue).replace(/[^\d.]/g, ""));
        normalized = Number.isFinite(n) ? n : null;
        unit = pattern.field_key === "meter_count" ? "count" : null;
      }

      const start = Math.max(0, match.index - 40);
      const end = Math.min(pageText.length, match.index + String(match[0]).length + 40);
      const evidence = pageText.slice(start, end).replace(/\s+/g, " ").trim();

      out.push(
        buildCandidateRecord({
          field_key: fieldKey,
          raw_value: String(rawValue),
          normalized_value: normalized,
          unit,
          entity_type: entityType,
          entity_name: entityName,
          is_project_total: isProjectTotal,
          panel_identifier_missing: panelIdentifierMissing,
          schedule_heading: scheduleHeading,
          source_type: source.source_type,
          source_document_name: source.source_document_name,
          source_document_id: source.source_document_id,
          source_storage_path: source.source_storage_path,
          source_content_hash: source.source_content_hash,
          page_number: pageNumber,
          evidence_text: evidence,
          extraction_method: source.extraction_method ?? "pdf_text",
          confidence: normalized != null && unit != null ? 0.7 : null,
          external_application_id: source.external_application_id,
        }),
      );
    }
  }

  return deduplicateLoadCandidates(out);
}

/**
 * @param {string} text
 * @param {number} pageNumber
 * @param {object} source
 * @returns {Array<Record<string, unknown>>}
 */
function extractCandidatesFromTables(text, pageNumber, source) {
  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  const lines = String(text ?? "").split(/\r?\n/);
  for (const line of lines) {
    if (!/connected|demand|amperage|voltage|phase|meter/i.test(line)) continue;
    if (!/[\t|,:]/.test(line)) continue;

    const tableMatch = line.match(
      /\b(connected\s+load|demand\s+load|service\s+amperage|voltage|phase|meters?)\b[\s\t|,:]+(\d+(?:\.\d+)?)\s*([A-Za-z]+)?/i,
    );
    if (!tableMatch) continue;

    const label = tableMatch[1].toLowerCase();
    const rawValue = tableMatch[2];
    const unitRaw = tableMatch[3] ?? "";
    const unit = normalizeUnit(unitRaw);
    const evidence = line.trim().slice(0, 500);
    let field_key = null;
    let loadKind = null;
    if (label.includes("connected")) {
      loadKind = "connected";
    } else if (label.includes("demand")) {
      loadKind = "demand";
    } else if (label.includes("amperage")) field_key = "service_amperage";
    else if (label.includes("voltage")) field_key = "requested_voltage";
    else if (label.includes("phase")) field_key = "phase";
    else if (label.includes("meter")) field_key = "meter_count";

    let entityType = "project_service";
    let entityName = null;
    let isProjectTotal = isProjectTotalEvidence(evidence);
    let panelIdentifierMissing = false;
    let scheduleHeading = null;

    if (loadKind) {
      const classified = classifyLoadTotalCandidate({
        text: line,
        matchIndex: 0,
        evidence,
        loadKind,
        unit,
      });
      field_key = classified.field_key;
      entityType = classified.entity_type;
      entityName = classified.entity_name;
      isProjectTotal = classified.is_project_total;
      panelIdentifierMissing = classified.panel_identifier_missing;
      scheduleHeading = classified.schedule_heading;
    } else {
      field_key =
        field_key ||
        (loadKind ? resolveLoadFieldKey(loadKind, unit, false) : null);
    }

    if (!field_key || !EXTRACTABLE_FIELD_KEYS.has(field_key)) continue;

    let normalized = null;
    if (field_key === "phase") {
      if (!isServicePhaseEvidence(line)) continue;
      normalized = normalizePhase(rawValue);
      if (!normalized) continue;
    } else {
      const n = Number(rawValue);
      normalized = Number.isFinite(n) ? n : null;
      if (!unit && field_key === "meter_count") continue;
      if ((field_key.endsWith("_kw") || field_key.endsWith("_kva")) && !unit) continue;
    }

    out.push(
      buildCandidateRecord({
        field_key,
        raw_value: rawValue,
        normalized_value: normalized,
        unit: field_key === "phase" ? "phase" : unit,
        entity_type: entityType,
        entity_name: entityName,
        is_project_total: isProjectTotal,
        panel_identifier_missing: panelIdentifierMissing,
        schedule_heading: scheduleHeading,
        source_type: source.source_type,
        source_document_name: source.source_document_name,
        source_document_id: source.source_document_id,
        source_storage_path: source.source_storage_path,
        source_content_hash: source.source_content_hash,
        page_number: pageNumber,
        evidence_text: evidence,
        extraction_method: "table",
        confidence: normalized != null && unit != null ? 0.65 : null,
        external_application_id: source.external_application_id,
      }),
    );
  }
  return deduplicateLoadCandidates(out);
}

/**
 * @param {Buffer} buffer
 * @param {{ parsePdf?: (buf: Buffer) => Promise<{ text: string }> }} [deps]
 */
async function extractPdfPages(buffer, deps = {}) {
  const parsePdf =
    deps.parsePdf ||
    (async (buf) => {
      const pdfParseModule = require("pdf-parse");
      const pdfParseFn =
        typeof pdfParseModule === "function"
          ? pdfParseModule
          : typeof pdfParseModule?.default === "function"
            ? pdfParseModule.default
            : null;
      if (!pdfParseFn) {
        throw new Error("pdf-parse module did not export a parser function");
      }
      const result = await pdfParseFn(buf);
      return { text: result.text || "" };
    });

  const { text } = await parsePdf(buffer);
  const pages = String(text).split("\f");
  if (pages.length <= 1 && text) {
    return [{ pageNumber: 1, text }];
  }
  return pages.map((pageText, idx) => ({ pageNumber: idx + 1, text: pageText }));
}

/**
 * @param {Record<string, unknown>} record
 * @param {object} params
 */
function discoverLoadSourceDocuments(record, params) {
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
  const accessContext = { projectId, coordinationRecordId, tenantId };

  const pepcoFiles = extractPepcoPortalFiles(record, {
    externalApplicationId,
  }).filter((file) => isPepcoPortalFileAccessible(file, accessContext));

  /** @type {Array<Record<string, unknown>>} */
  const documents = [];

  for (const file of pepcoFiles) {
    const fileName = String(file.fileName ?? file.documentName ?? "").trim();
    const storagePath = String(file.storagePath ?? "");
    const externalAppId = String(file.external_application_id ?? "");
    if (externalAppId && externalAppId !== externalApplicationId) continue;

    documents.push({
      source_type: "pepco_portal_document",
      source_document_id: file.idempotencyKey != null ? String(file.idempotencyKey) : null,
      source_document_name: fileName,
      file_name: fileName,
      document_type: file.pepco_document_type != null ? String(file.pepco_document_type) : null,
      pepco_document_type: file.pepco_document_type != null ? String(file.pepco_document_type) : null,
      storage_bucket:
        file.storageBucket != null ? String(file.storageBucket) : UCI_DOCUMENTS_STORAGE_BUCKET,
      storage_path: storagePath,
      content_hash: file.contentHash != null ? String(file.contentHash) : "",
      external_application_id: externalAppId,
      project_id: projectId,
      coordination_record_id: coordinationRecordId,
      tenant_id: tenantId,
    });
  }

  return {
    documents,
    external_application_id: externalApplicationId,
    project_id: projectId,
    coordination_record_id: coordinationRecordId,
    tenant_id: tenantId,
  };
}

/**
 * @param {Array<Record<string, unknown>>} projectDocuments
 * @param {string} projectId
 */
function discoverProjectDocumentSources(projectDocuments, projectId) {
  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  for (const doc of projectDocuments) {
    if (!doc || typeof doc !== "object") continue;
    if (String(doc.project_id ?? projectId) !== String(projectId)) continue;
    const fileName = doc.file_name != null ? String(doc.file_name) : "";
    const filePath = doc.file_path != null ? String(doc.file_path) : "";
    if (!fileName || !filePath) continue;
    const rank = rankLoadSourceDocument({
      fileName,
      documentType: doc.document_type != null ? String(doc.document_type) : null,
    });
    if (rank.score <= 0) continue;
    if (!/\.pdf$/i.test(fileName)) continue;

    const isManualUpload = /\bagent\s*2\s+manual\s+upload\b/i.test(
      String(doc.description ?? ""),
    );
    out.push({
      source_type: isManualUpload ? "manual_upload" : "project_document",
      source_document_id: String(doc.id),
      source_document_name: fileName,
      file_name: fileName,
      document_type: doc.document_type != null ? String(doc.document_type) : null,
      storage_bucket: PROJECT_DOCUMENTS_BUCKET,
      storage_path: filePath,
      content_hash: doc.content_hash != null ? String(doc.content_hash) : `project_doc:${doc.id}`,
      project_id: projectId,
      rank,
    });
  }
  return out;
}

/**
 * @param {Array<Record<string, unknown>>} documents
 */
function rankAndSortLoadDocuments(documents) {
  return [...documents]
    .map((doc) => {
      const rank = rankLoadSourceDocument({
        fileName: doc.file_name ?? doc.source_document_name,
        documentType: doc.document_type,
        pepcoDocumentType: doc.pepco_document_type,
      });
      return { ...doc, rank };
    })
    .filter((doc) => doc.rank.score > 0)
    .sort((a, b) => b.rank.score - a.rank.score);
}

/**
 * @param {Record<string, unknown>} verifiedEntry
 */
function isVerifiedEntryComplete(verifiedEntry) {
  if (!verifiedEntry || typeof verifiedEntry !== "object") return false;
  const value = verifiedEntry.value;
  if (value == null || value === "") return false;
  const fieldKey = String(verifiedEntry.field_key ?? "");
  if (CONNECTED_LOAD_SATISFACTION_KEYS.has(fieldKey)) {
    if (fieldKey === "connected_equipment_or_load_data") {
      return typeof value === "object" && value !== null && Object.keys(value).length > 0;
    }
    return verifiedEntry.unit != null && verifiedEntry.unit !== "";
  }
  return false;
}

/**
 * @param {Record<string, unknown> | null | undefined} loadSummary
 */
function getVerifiedValuesMap(loadSummary) {
  if (
    !loadSummary ||
    typeof loadSummary !== "object" ||
    Array.isArray(loadSummary) ||
    !loadSummary.verified_values ||
    typeof loadSummary.verified_values !== "object" ||
    Array.isArray(loadSummary.verified_values)
  ) {
    return {};
  }
  return /** @type {Record<string, unknown>} */ (loadSummary.verified_values);
}

/**
 * @param {Record<string, unknown> | null | undefined} loadSummary
 */
function getVerifiedValuesForPackage(loadSummary) {
  const verified = getVerifiedValuesMap(loadSummary);
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, entry] of Object.entries(verified)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const rec = /** @type {Record<string, unknown>} */ (entry);
    if (rec.value == null || rec.value === "") continue;
    out[key] = rec.value;
  }
  return out;
}

/**
 * @param {Record<string, unknown> | null | undefined} loadSummary
 */
function isConnectedLoadDataSatisfied(loadSummary) {
  const verified = getVerifiedValuesMap(loadSummary);
  for (const key of CONNECTED_LOAD_SATISFACTION_KEYS) {
    const entry = verified[key];
    if (isVerifiedEntryComplete({ .../** @type {Record<string, unknown>} */ (entry), field_key: key })) {
      return true;
    }
  }
  return false;
}

/**
 * @param {Array<Record<string, unknown>>} candidates
 */
function assignConflictGroups(candidates) {
  /** @type {Map<string, Array<Record<string, unknown>>>} */
  const byScope = new Map();
  for (const candidate of candidates) {
    if (candidate?.status === "candidate") candidate.conflict_group = null;
  }
  for (const c of candidates) {
    if (!c || c.status !== "candidate") continue;
    const scopeKey = [
      String(c.field_key ?? ""),
      String(c.entity_type ?? "project_service"),
      String(c.entity_name ?? ""),
      c.is_project_total === false ? "0" : "1",
    ].join("|");
    if (!byScope.has(scopeKey)) byScope.set(scopeKey, []);
    byScope.get(scopeKey).push(c);
  }

  for (const [, group] of byScope) {
    if (group.length < 2) continue;
    const normalized = new Set(
      group.map((c) => JSON.stringify({ v: c.normalized_value, u: c.unit })),
    );
    if (normalized.size <= 1) continue;
    const conflictGroup = `conflict:${group[0].field_key}:${crypto.randomBytes(6).toString("hex")}`;
    for (const c of group) {
      c.conflict_group = conflictGroup;
      c.requires_human_review = true;
      c.approval_blocked_reason = approvalBlockedReason(c);
    }
  }

  for (const c of candidates) {
    if (c && c.status === "candidate") {
      c.can_satisfy_package = canCandidateSatisfyPackage(c);
      c.approval_blocked_reason = approvalBlockedReason(c);
    }
  }
  return candidates;
}

/**
 * @param {Array<Record<string, unknown>>} existing
 * @param {Array<Record<string, unknown>>} incoming
 * @param {boolean} refresh
 */
function mergeCandidates(existing, incoming, refresh) {
  const existingList = Array.isArray(existing) ? existing : [];
  const approvedOrRejected = new Set(
    existingList
      .filter((c) => c.status === "approved" || c.status === "rejected")
      .map((c) => String(c.candidate_id)),
  );

  /** @type {Map<string, Record<string, unknown>>} */
  const map = new Map();
  for (const c of existingList) {
    map.set(String(c.candidate_id), c);
  }

  for (const c of incoming) {
    const id = String(c.candidate_id);
    if (approvedOrRejected.has(id) && !refresh) continue;
    const prev = map.get(id);
    if (prev && prev.status === "approved" && !refresh) continue;
    map.set(id, { ...prev, ...c, status: prev?.status === "approved" ? "approved" : "candidate" });
  }

  return assignConflictGroups([...map.values()]);
}

/**
 * @param {Array<Record<string, unknown>>} candidates
 * @param {Record<string, string>} hashByPath
 */
function markStaleCandidates(candidates, hashByPath) {
  for (const c of candidates) {
    if (c.status === "approved") continue;

    const version = String(c.extraction_schema_version ?? "");
    if (version && STALE_EXTRACTION_SCHEMA_VERSIONS.has(version)) {
      c.status = "stale";
      c.requires_human_review = true;
      c.stale_reason = "extraction_schema_version_changed";
      c.can_satisfy_package = false;
      c.approval_blocked_reason = approvalBlockedReason(c);
      continue;
    }

    const pathKey = String(c.source_storage_path ?? "");
    if (!pathKey) continue;
    const currentHash = hashByPath[pathKey];
    if (!currentHash) continue;
    if (c.source_content_hash && currentHash !== c.source_content_hash) {
      c.status = "stale";
      c.requires_human_review = true;
      c.stale_reason = "source_content_changed";
      c.can_satisfy_package = false;
      c.approval_blocked_reason = approvalBlockedReason(c);
    }
  }
  return candidates;
}

/**
 * @param {Record<string, unknown>} record
 * @param {string} externalApplicationId
 */
function getStructuredApplicationFromRecord(record, externalApplicationId) {
  const metadata = parseCoordinationMetadata(record.metadata);
  const discovery = metadata.pepco_application_detail_discovery;
  if (!discovery || typeof discovery !== "object" || Array.isArray(discovery)) return null;
  const applications = Array.isArray(/** @type {{ applications?: unknown }} */ (discovery).applications)
    ? /** @type {Array<Record<string, unknown>>} */ (/** @type {{ applications: unknown[] }} */ (discovery).applications)
    : [];
  return (
    applications.find((app) => {
      const id = String(
        app.applicationUuid ?? app.external_application_id ?? app.externalApplicationId ?? "",
      ).trim();
      return id === externalApplicationId;
    }) ?? null
  );
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function runLoadCandidateExtraction(supabase, params) {
  const { coordinationRecordId, userId, externalApplicationId, refresh = false, deps = {} } = params;
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
  const discovery = discoverLoadSourceDocuments(record, { externalApplicationId: extAppId });

  /** @type {Array<Record<string, unknown>>} */
  const failedDocuments = [];
  /** @type {Array<Record<string, unknown>>} */
  let projectDocs = [];

  const { data: projectDocsData, error: projectDocsErr } = await supabase
    .from("project_documents")
    .select(PROJECT_DOCUMENTS_SELECT)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (projectDocsErr) {
    failedDocuments.push({
      document_name: null,
      source_type: "project_documents",
      stage: "project_documents_fetch",
      message: safeExtractionErrorMessage(projectDocsErr),
    });
  } else {
    projectDocs = Array.isArray(projectDocsData) ? projectDocsData : [];
  }

  const projectSources = discoverProjectDocumentSources(projectDocs, projectId);
  const { resolveScopedProjectDocuments } = require("./uci-coordination-document-links.service.js");
  const scoped = await resolveScopedProjectDocuments(supabase, {
    record,
    userId,
    projectDocuments: projectDocs,
  });
  const includedIds = scoped.includedIds;
  const scopedProjectSources = projectSources.filter((doc) =>
    includedIds.has(String(doc.source_document_id ?? "")),
  );
  const rankedDocs = rankAndSortLoadDocuments([...discovery.documents, ...scopedProjectSources]);

  const structuredApp = getStructuredApplicationFromRecord(record, extAppId);
  /** @type {Array<Record<string, unknown>>} */
  let extracted = [];
  let structuredExtracted = 0;
  if (structuredApp) {
    try {
      const structuredCandidates = extractCandidatesFromStructuredApplication(structuredApp, extAppId);
      structuredExtracted = structuredCandidates.length;
      extracted = extracted.concat(structuredCandidates);
    } catch (err) {
      failedDocuments.push({
        document_name: "provider_application_metadata",
        source_type: "provider_application",
        stage: "structured_application",
        message: safeExtractionErrorMessage(err),
      });
    }
  }

  const downloadFn = deps.downloadFromSupabaseStorage || downloadFromSupabaseStorage;
  const extractPdfPagesFn = deps.extractPdfPages || extractPdfPages;
  /** @type {Record<string, string>} */
  const hashByPath = {};
  const maxDocs = deps.maxDocuments ?? 10;
  const docsToProcess = rankedDocs.slice(0, maxDocs);

  let validStoragePaths = 0;
  let downloadedCount = 0;
  let parsedCount = 0;
  let documentFailureCount = 0;

  for (const doc of docsToProcess) {
    const docName = String(doc.source_document_name ?? doc.file_name ?? "unknown");
    const sourceType = String(doc.source_type ?? "unknown");
    const storagePath = String(doc.storage_path ?? "");
    const storageBucket = String(doc.storage_bucket ?? UCI_DOCUMENTS_STORAGE_BUCKET);

    try {
      if (!storagePath) {
        documentFailureCount += 1;
        failedDocuments.push({
          document_name: docName,
          source_type: sourceType,
          stage: "storage_path_validation",
          message: "Document has no storage path",
        });
        continue;
      }

      if (doc.source_type === "pepco_portal_document") {
        const ok = validatePepcoStoragePathForRecord(storagePath, {
          projectId,
          coordinationRecordId: coordinationRecordIdStr,
          tenantId: record.tenant_id != null ? String(record.tenant_id) : null,
        });
        if (!ok) {
          documentFailureCount += 1;
          failedDocuments.push({
            document_name: docName,
            source_type: sourceType,
            stage: "storage_path_validation",
            message: "Storage path failed namespace validation",
          });
          continue;
        }
        if (String(doc.external_application_id ?? "") !== extAppId) {
          documentFailureCount += 1;
          failedDocuments.push({
            document_name: docName,
            source_type: sourceType,
            stage: "storage_path_validation",
            message: "Document is scoped to a different external application",
          });
          continue;
        }
      }

      validStoragePaths += 1;
      const contentHash = String(doc.content_hash ?? "");
      hashByPath[storagePath] = contentHash;

      let download;
      try {
        download = await downloadFn({
          supabase,
          bucket: storageBucket,
          storagePath,
        });
      } catch (err) {
        documentFailureCount += 1;
        failedDocuments.push({
          document_name: docName,
          source_type: sourceType,
          stage: "storage_download",
          message: safeExtractionErrorMessage(err),
        });
        continue;
      }

      if (!download.ok || !download.data) {
        documentFailureCount += 1;
        failedDocuments.push({
          document_name: docName,
          source_type: sourceType,
          stage: "storage_download",
          message: safeExtractionErrorMessage(download.errorMessage || "storage_download_failed"),
        });
        continue;
      }

      downloadedCount += 1;

      let buffer;
      try {
        buffer = Buffer.from(await download.data.arrayBuffer());
      } catch (err) {
        documentFailureCount += 1;
        failedDocuments.push({
          document_name: docName,
          source_type: sourceType,
          stage: "buffer_conversion",
          message: safeExtractionErrorMessage(err),
        });
        continue;
      }

      const header = buffer.slice(0, 4).toString();
      const isPdf =
        /\.pdf$/i.test(String(doc.file_name ?? "")) || header === "%PDF";
      if (!isPdf) {
        documentFailureCount += 1;
        failedDocuments.push({
          document_name: docName,
          source_type: sourceType,
          stage: "pdf_text",
          message: "Document is not a PDF",
        });
        continue;
      }

      const source = {
        source_type: doc.source_type,
        source_document_name: docName,
        source_document_id: doc.source_document_id ?? null,
        source_storage_path: storagePath,
        source_content_hash: contentHash,
        external_application_id: extAppId,
      };

      let pages;
      try {
        pages = await extractPdfPagesFn(buffer, deps);
        parsedCount += 1;
      } catch (err) {
        documentFailureCount += 1;
        failedDocuments.push({
          document_name: docName,
          source_type: sourceType,
          stage: "pdf_parse",
          message: safeExtractionErrorMessage(err),
        });
        continue;
      }

      for (const page of pages) {
        try {
          extracted = extracted.concat(
            extractCandidatesFromKnownDocumentText(
              page.text,
              page.pageNumber,
              source,
            ),
          );
        } catch (err) {
          documentFailureCount += 1;
          failedDocuments.push({
            document_name: docName,
            source_type: sourceType,
            stage: "pdf_text",
            message: safeExtractionErrorMessage(err),
          });
        }
      }
    } catch (err) {
      documentFailureCount += 1;
      failedDocuments.push({
        document_name: docName,
        source_type: sourceType,
        stage: "document_processing",
        message: safeExtractionErrorMessage(err),
      });
    }
  }

  const hasProcessableOutput = structuredExtracted > 0 || extracted.length > 0;
  const attemptedDocumentSources = docsToProcess.length;
  const allDocumentSourcesFailed =
    attemptedDocumentSources > 0 &&
    documentFailureCount >= attemptedDocumentSources &&
    structuredExtracted === 0;

  if (!hasProcessableOutput && rankedDocs.length === 0 && !structuredApp) {
    throw new LoadCandidateExtractionError({
      stage: "document_discovery",
      message: "No load-bearing documents discovered for the selected external application",
      statusCode: 422,
    });
  }

  if (!hasProcessableOutput && allDocumentSourcesFailed) {
    throw new LoadCandidateExtractionError({
      stage: failedDocuments[0]?.stage != null ? String(failedDocuments[0].stage) : "document_processing",
      documentName:
        failedDocuments[0]?.document_name != null ? String(failedDocuments[0].document_name) : null,
      message: "All selected document sources failed during extraction",
      statusCode: 422,
    });
  }

  let draft;
  try {
    draft = await findAgentDraftApplication(supabase, coordinationRecordId, projectId);
  } catch (err) {
    throw toLoadCandidateExtractionError(err, { stage: "load_profile_draft_lookup", statusCode: 500 });
  }

  if (!draft) {
    const err = new Error("Load profile draft is required before extracting connected load candidates");
    err.statusCode = 400;
    err.code = "LOAD_PROFILE_REQUIRED";
    throw err;
  }

  const existingSummary =
    draft.load_summary && typeof draft.load_summary === "object" && !Array.isArray(draft.load_summary)
      ? /** @type {Record<string, unknown>} */ (draft.load_summary)
      : {};

  const existingCandidates = Array.isArray(existingSummary.candidate_values)
    ? existingSummary.candidate_values
    : [];
  const existingExtraction =
    existingSummary.load_extraction &&
    typeof existingSummary.load_extraction === "object" &&
    !Array.isArray(existingSummary.load_extraction)
      ? /** @type {Record<string, unknown>} */ (existingSummary.load_extraction)
      : {};

  const skippedIds = new Set();
  if (!refresh) {
    for (const c of extracted) {
      const id = String(c.candidate_id);
      const prev = existingCandidates.find((x) => String(x.candidate_id) === id);
      if (
        prev &&
        prev.source_content_hash === c.source_content_hash &&
        prev.extraction_schema_version === LOAD_EXTRACTION_SCHEMA_VERSION
      ) {
        skippedIds.add(id);
      }
    }
    extracted = extracted.filter((c) => !skippedIds.has(String(c.candidate_id)));
  }

  extracted = deduplicateLoadCandidates(extracted);

  let mergedCandidates = mergeCandidates(existingCandidates, extracted, refresh);
  mergedCandidates = markStaleCandidates(mergedCandidates, hashByPath);
  mergedCandidates = linkSupersededCandidates(mergedCandidates);

  const verifiedValues = getVerifiedValuesMap(existingSummary);
  const extractionStatus =
    failedDocuments.length === 0 ? "complete" : hasProcessableOutput ? "partial" : "partial";

  const loadExtraction = {
    ...existingExtraction,
    schema_version: LOAD_EXTRACTION_SCHEMA_VERSION,
    external_application_id: extAppId,
    last_extracted_at: new Date().toISOString(),
    last_extracted_by: userId,
    extraction_status: extractionStatus,
    documents_discovered: rankedDocs.length,
    documents_selected: docsToProcess.length,
    documents_valid_storage_paths: validStoragePaths,
    documents_downloaded: downloadedCount,
    documents_parsed: parsedCount,
    documents_failed: documentFailureCount + (projectDocsErr ? 1 : 0),
    structured_candidates_extracted: structuredExtracted,
    candidates_extracted: extracted.length,
    candidates_skipped_unchanged: skippedIds.size,
    failed_documents: failedDocuments,
    source_document_ranking: docsToProcess.map((d) => ({
      file_name: d.file_name ?? d.source_document_name,
      score: d.rank?.score ?? 0,
      reasons: d.rank?.reasons ?? [],
      source_type: d.source_type,
    })),
  };

  const nextSummary = reconcileLoadProfileReadiness({
    ...existingSummary,
    candidate_values: mergedCandidates,
    verified_values: verifiedValues,
    load_extraction: loadExtraction,
    calculated_values:
      existingSummary.calculated_values &&
      typeof existingSummary.calculated_values === "object" &&
      !Array.isArray(existingSummary.calculated_values)
        ? existingSummary.calculated_values
        : {},
  });

  let data;
  try {
    const updateResult = await supabase
      .from("coordination_applications")
      .update({ load_summary: nextSummary })
      .eq("id", draft.id)
      .select("*")
      .single();

    if (updateResult.error) {
      throw updateResult.error;
    }
    data = updateResult.data;
  } catch (err) {
    throw toLoadCandidateExtractionError(err, { stage: "persistence", statusCode: 500 });
  }

  return {
    coordination_record_id: coordinationRecordId,
    project_id: projectId,
    external_application_id: extAppId,
    extraction_status: extractionStatus,
    candidates: mergedCandidates,
    failed_documents: failedDocuments,
    documents_discovered: rankedDocs.length,
    documents_selected: docsToProcess.length,
    documents_valid_storage_paths: validStoragePaths,
    documents_downloaded: downloadedCount,
    documents_parsed: parsedCount,
    documents_failed: documentFailureCount + (projectDocsErr ? 1 : 0),
    candidates_produced: mergedCandidates.filter(
      (c) => c.status !== "rejected" && c.status !== "stale",
    ).length,
    extraction: loadExtraction,
    application: data,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function listLoadCandidates(supabase, params) {
  const { coordinationRecordId, externalApplicationId } = params;
  const record = await getCoordinationRecordById(supabase, coordinationRecordId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const projectId = String(record.project_id);
  const draft = await findAgentDraftApplication(supabase, coordinationRecordId, projectId);
  const summary =
    draft?.load_summary && typeof draft.load_summary === "object" && !Array.isArray(draft.load_summary)
      ? /** @type {Record<string, unknown>} */ (draft.load_summary)
      : {};

  const extAppId = externalApplicationId ? String(externalApplicationId).trim() : "";
  let candidates = Array.isArray(summary.candidate_values) ? summary.candidate_values : [];
  if (extAppId) {
    candidates = candidates.filter(
      (c) => !c.external_application_id || String(c.external_application_id) === extAppId,
    );
  }

  return {
    coordination_record_id: coordinationRecordId,
    external_application_id: extAppId || null,
    candidates,
    verified_values: getVerifiedValuesMap(summary),
    load_extraction: summary.load_extraction ?? null,
    connected_load_satisfied: isConnectedLoadDataSatisfied(summary),
  };
}

function candidatesRepresentSameLogicalFact(a, b) {
  return (
    a.status === "candidate" &&
    b.status === "candidate" &&
    String(a.field_key ?? "") === String(b.field_key ?? "") &&
    String(a.entity_type ?? "project_service") === String(b.entity_type ?? "project_service") &&
    String(a.entity_name ?? "") === String(b.entity_name ?? "") &&
    (a.is_project_total === false) === (b.is_project_total === false) &&
    JSON.stringify(a.normalized_value ?? a.raw_value) ===
      JSON.stringify(b.normalized_value ?? b.raw_value) &&
    String(a.unit ?? "") === String(b.unit ?? "") &&
    !a.conflict_group &&
    !b.conflict_group
  );
}

function appendVerifiedHistory(summary, fieldKey, previousEntry) {
  const history = Array.isArray(summary.verified_values_history)
    ? [...summary.verified_values_history]
    : [];
  if (previousEntry && typeof previousEntry === "object") {
    history.push({
      ...previousEntry,
      field_key: fieldKey,
      superseded_at: new Date().toISOString(),
    });
  }
  return history;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function resolveLoadCandidate(supabase, params) {
  const {
    coordinationRecordId,
    userId,
    candidateId,
    action,
    edited_value,
    edited_unit,
    review_note,
  } = params;

  const allowed = new Set(["approve", "edit_approve", "reject", "keep_unresolved"]);
  const act = String(action ?? "").trim().toLowerCase();
  if (!allowed.has(act)) {
    const err = new Error("Invalid candidate resolution action");
    err.statusCode = 400;
    err.code = "INVALID_ACTION";
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
  const draft = await findAgentDraftApplication(supabase, coordinationRecordId, projectId);
  if (!draft) {
    const err = new Error("Load profile draft not found");
    err.statusCode = 404;
    err.code = "LOAD_PROFILE_NOT_FOUND";
    throw err;
  }

  const summary =
    draft.load_summary && typeof draft.load_summary === "object" && !Array.isArray(draft.load_summary)
      ? /** @type {Record<string, unknown>} */ (draft.load_summary)
      : {};
  const candidates = Array.isArray(summary.candidate_values)
    ? summary.candidate_values.map((item) => ({ ...item }))
    : [];
  const idx = candidates.findIndex((c) => String(c.candidate_id) === String(candidateId));
  if (idx < 0) {
    const err = new Error("Load candidate not found");
    err.statusCode = 404;
    err.code = "CANDIDATE_NOT_FOUND";
    throw err;
  }

  const candidate = { ...candidates[idx] };
  const verified =
    summary.verified_values &&
    typeof summary.verified_values === "object" &&
    !Array.isArray(summary.verified_values)
      ? { .../** @type {Record<string, unknown>} */ (summary.verified_values) }
      : {};

  const existingVerifiedEntry = Object.values(verified).find(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      (String(entry.original_candidate_id ?? "") === String(candidateId) ||
        (Array.isArray(entry.evidence_sources) &&
          entry.evidence_sources.some(
            (source) => String(source?.candidate_id ?? "") === String(candidateId),
          ))),
  );
  const isSameCompletedAction =
    (candidate.status === "approved" &&
      (act === "approve" || act === "edit_approve") &&
      existingVerifiedEntry) ||
    (candidate.status === "rejected" && act === "reject") ||
    (candidate.status === "candidate" &&
      act === "keep_unresolved" &&
      candidate.resolved_at);
  if (isSameCompletedAction) {
    return {
      coordination_record_id: coordinationRecordId,
      candidate,
      verified_values: verified,
      connected_load_satisfied: isConnectedLoadDataSatisfied(summary),
      application: draft,
      idempotent_replay: true,
    };
  }
  if (candidate.status !== "candidate" && !existingVerifiedEntry) {
    // Recover an approved candidate whose verified projection was lost by a
    // previous whole-document write race. Other cross-state transitions must
    // remain explicit and are rejected.
    if (!(candidate.status === "approved" && (act === "approve" || act === "edit_approve"))) {
      const err = new Error(`Candidate is already ${candidate.status}`);
      err.statusCode = 409;
      err.code = "CANDIDATE_ALREADY_RESOLVED";
      throw err;
    }
  } else if (candidate.status !== "candidate") {
    const err = new Error(`Candidate is already ${candidate.status}`);
    err.statusCode = 409;
    err.code = "CANDIDATE_ALREADY_RESOLVED";
    throw err;
  }

  const approvedAt = new Date().toISOString();
  const note = review_note != null ? String(review_note).trim() : null;

  if (act === "reject") {
    candidate.status = "rejected";
    candidate.requires_human_review = false;
    candidate.resolved_at = approvedAt;
    candidate.resolved_by = userId;
    candidates[idx] = candidate;
  } else if (act === "keep_unresolved") {
    candidate.status = "candidate";
    candidate.requires_human_review = true;
    candidate.resolved_at = approvedAt;
    candidate.resolved_by = userId;
    if (note) candidate.review_note = note;
    candidates[idx] = candidate;
  } else if (act === "approve" || act === "edit_approve") {
    const edited = act === "edit_approve";
    let value = candidate.normalized_value;
    let unit = candidate.unit;
    if (edited) {
      if (edited_value == null || edited_value === "") {
        const err = new Error("edited_value is required for edit_approve");
        err.statusCode = 400;
        err.code = "EDITED_VALUE_REQUIRED";
        throw err;
      }
      value =
        typeof edited_value === "number"
          ? edited_value
          : Number.isFinite(Number(edited_value))
            ? Number(edited_value)
            : edited_value;
      unit = edited_unit != null ? normalizeUnit(edited_unit) || String(edited_unit) : unit;
    }

    if (value == null || value === "") {
      const err = new Error("Cannot approve candidate without a verified value");
      err.statusCode = 400;
      err.code = "VALUE_REQUIRED";
      throw err;
    }

    const fieldKey = String(candidate.field_key);
    const blocked = approvalBlockedReason(candidate);
    if (!edited && blocked) {
      const err = new Error(blocked);
      err.statusCode = 400;
      err.code = "APPROVAL_BLOCKED";
      throw err;
    }

    if (
      CONNECTED_LOAD_SATISFACTION_KEYS.has(fieldKey) &&
      fieldKey !== "connected_equipment_or_load_data" &&
      (unit == null || unit === "")
    ) {
      const err = new Error("Cannot approve connected load value without a unit");
      err.statusCode = 400;
      err.code = "UNIT_REQUIRED";
      throw err;
    }

    const agreeingIndexes = edited
      ? [idx]
      : candidates
          .map((item, itemIndex) =>
            candidatesRepresentSameLogicalFact(candidate, item) ? itemIndex : -1,
          )
          .filter((itemIndex) => itemIndex >= 0);
    const evidenceSources = agreeingIndexes.map((itemIndex) => {
      const item = candidates[itemIndex];
      item.status = "approved";
      item.requires_human_review = false;
      item.resolved_at = approvedAt;
      item.resolved_by = userId;
      if (note) item.review_note = note;
      candidates[itemIndex] = item;
      return {
        candidate_id: item.candidate_id,
        source_document_name: item.source_document_name,
        source_document_id: item.source_document_id ?? null,
        page_number: item.page_number ?? null,
        evidence_text: item.evidence_text,
        extraction_method: item.extraction_method,
      };
    });
    candidate.status = "approved";
    candidate.requires_human_review = false;
    candidate.resolved_at = approvedAt;
    candidate.resolved_by = userId;
    candidates[idx] = candidate;

    const verifiedValuesHistory = appendVerifiedHistory(summary, fieldKey, verified[fieldKey]);
    verified[fieldKey] = {
      field_key: fieldKey,
      value,
      unit,
      method: edited ? "user_entered_and_verified" : "source_extracted_and_human_verified",
      approved_by: userId,
      approved_at: approvedAt,
      source_document_name: candidate.source_document_name,
      source_document_id: candidate.source_document_id,
      source_storage_path: candidate.source_storage_path,
      page_number: candidate.page_number,
      evidence_text: candidate.evidence_text,
      extraction_method: candidate.extraction_method,
      edited,
      review_note: note,
      original_candidate_id: candidate.candidate_id,
      source_content_hash: candidate.source_content_hash,
      provenance: "source",
      evidence_sources: evidenceSources,
    };
    summary.verified_values_history = verifiedValuesHistory;
  }

  const nextSummary = reconcileLoadProfileReadiness({
    ...summary,
    candidate_values: assignConflictGroups(candidates),
    verified_values: verified,
  });

  let updateQuery = supabase
    .from("coordination_applications")
    .update({ load_summary: nextSummary })
    .eq("id", draft.id);
  // `load_summary` is a single JSON document. Compare the version read above
  // so simultaneous row approvals cannot silently overwrite each other.
  if (draft.updated_at) {
    updateQuery = updateQuery.eq("updated_at", draft.updated_at);
  }
  const updateResult = await updateQuery.select("*");
  const data = Array.isArray(updateResult.data) ? updateResult.data[0] ?? null : updateResult.data;
  const error = updateResult.error;

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to resolve load candidate"), {
      statusCode: 500,
      code: "LOAD_CANDIDATE_RESOLVE_FAILED",
    });
  }
  if (!data) {
    const attempt = Number(params.concurrencyAttempt ?? 0);
    if (attempt < 4) {
      return resolveLoadCandidate(supabase, {
        ...params,
        concurrencyAttempt: attempt + 1,
      });
    }
    throw Object.assign(
      new Error("Candidate changed while this action was being saved. Refresh and try again."),
      {
        statusCode: 409,
        code: "LOAD_CANDIDATE_WRITE_CONFLICT",
      },
    );
  }

  return {
    coordination_record_id: coordinationRecordId,
    candidate: candidates[idx],
    verified_values: verified,
    connected_load_satisfied: isConnectedLoadDataSatisfied(nextSummary),
    application: data,
  };
}

/**
 * @param {object} params
 */
function validateManualVerifiedPayload(params) {
  const fieldKey = String(params.field_key ?? "").trim();
  if (!fieldKey || !EXTRACTABLE_FIELD_KEYS.has(fieldKey)) {
    const err = new Error("Unsupported or missing field_key");
    err.statusCode = 400;
    err.code = "INVALID_FIELD_KEY";
    throw err;
  }

  const rawValue = params.value;
  if (rawValue == null || rawValue === "") {
    const err = new Error("value is required");
    err.statusCode = 400;
    err.code = "VALUE_REQUIRED";
    throw err;
  }

  let unit =
    params.unit != null && String(params.unit).trim()
      ? normalizeUnit(params.unit) || String(params.unit).trim()
      : null;

  if (
    (fieldKey.endsWith("_kw") ||
      fieldKey.endsWith("_kva") ||
      fieldKey === "service_amperage" ||
      fieldKey === "service_voltage" ||
      fieldKey === "requested_voltage" ||
      fieldKey.endsWith("_count")) &&
    !unit
  ) {
    const err = new Error("unit is required for this engineering field");
    err.statusCode = 400;
    err.code = "UNIT_REQUIRED";
    throw err;
  }

  if (unit && !fieldKeyMatchesUnit(fieldKey, unit)) {
    const err = new Error("Field key does not match unit");
    err.statusCode = 400;
    err.code = "FIELD_UNIT_MISMATCH";
    throw err;
  }

  const reviewNote =
    params.review_note != null && String(params.review_note).trim()
      ? String(params.review_note).trim()
      : "Explicitly confirmed manual verified input";

  const value =
    typeof rawValue === "number"
      ? rawValue
      : Number.isFinite(Number(rawValue))
        ? Number(rawValue)
        : String(rawValue);

  if (fieldKey === "phase") {
    unit = "phase";
  } else if (fieldKey === "meter_count" || fieldKey.endsWith("_count")) {
    unit = unit || "count";
  }

  return { fieldKey, value, unit, reviewNote };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function addManualVerifiedValue(supabase, params) {
  const {
    coordinationRecordId,
    userId,
    field_key,
    value,
    unit,
    source_document_name,
    page_number,
    evidence_text,
    source_reference,
    review_note,
  } = params;

  const { fieldKey, value: normalizedValue, unit: unitStr, reviewNote } =
    validateManualVerifiedPayload({
      field_key,
      value,
      unit,
      evidence_text,
      source_reference,
      review_note,
    });

  const record = await getCoordinationRecordById(supabase, coordinationRecordId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const projectId = String(record.project_id);
  const draft = await findAgentDraftApplication(supabase, coordinationRecordId, projectId);
  if (!draft) {
    const err = new Error("Load profile draft not found");
    err.statusCode = 404;
    err.code = "LOAD_PROFILE_NOT_FOUND";
    throw err;
  }

  const summary =
    draft.load_summary && typeof draft.load_summary === "object" && !Array.isArray(draft.load_summary)
      ? /** @type {Record<string, unknown>} */ (draft.load_summary)
      : {};

  const verified =
    summary.verified_values &&
    typeof summary.verified_values === "object" &&
    !Array.isArray(summary.verified_values)
      ? { .../** @type {Record<string, unknown>} */ (summary.verified_values) }
      : {};

  const approvedAt = new Date().toISOString();
  const manualId = `manual:${crypto.randomBytes(8).toString("hex")}`;
  const evidence =
    evidence_text != null && String(evidence_text).trim()
      ? String(evidence_text).trim()
      : source_reference != null
        ? `Manual entry — ${String(source_reference).trim()}`
        : reviewNote;

  const verifiedValuesHistory = appendVerifiedHistory(summary, fieldKey, verified[fieldKey]);
  verified[fieldKey] = {
    field_key: fieldKey,
    value: normalizedValue,
    unit: unitStr,
    method: "user_entered_and_verified",
    approved_by: userId,
    approved_at: approvedAt,
    source_document_name:
      source_document_name != null ? String(source_document_name) : "manual_engineering_entry",
    source_document_id: null,
    source_storage_path: "",
    page_number: page_number != null ? Number(page_number) : null,
    evidence_text: evidence.slice(0, 2000),
    extraction_method: "structured_application",
    edited: true,
    review_note: reviewNote,
    original_candidate_id: manualId,
    source_content_hash: `manual:${fieldKey}:${approvedAt}`,
    provenance: "manual",
    entered_by: userId,
    entered_at: approvedAt,
    timestamp: approvedAt,
    source_reference:
      source_reference != null && String(source_reference).trim()
        ? String(source_reference).trim()
        : null,
  };

  const nextSummary = reconcileLoadProfileReadiness({
    ...summary,
    verified_values: verified,
    verified_values_history: verifiedValuesHistory,
  });

  const { data, error } = await supabase
    .from("coordination_applications")
    .update({ load_summary: nextSummary })
    .eq("id", draft.id)
    .select("*")
    .single();

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to add manual verified value"), {
      statusCode: 500,
      code: "MANUAL_VERIFIED_VALUE_FAILED",
    });
  }

  return {
    coordination_record_id: coordinationRecordId,
    field_key: fieldKey,
    verified_values: verified,
    connected_load_satisfied: isConnectedLoadDataSatisfied(nextSummary),
    application: data,
  };
}

/**
 * Validate storage path access for load extraction (security).
 *
 * @param {string} storagePath
 * @param {object} ctx
 */
function validateLoadSourceStoragePath(storagePath, ctx) {
  if (ctx.source_type === "pepco_portal_document") {
    return validatePepcoStoragePathForRecord(storagePath, ctx);
  }
  if (ctx.source_type === "project_document" || ctx.source_type === "manual_upload") {
    return Boolean(storagePath && ctx.projectId);
  }
  return false;
}

module.exports = {
  LOAD_EXTRACTION_SCHEMA_VERSION,
  STALE_EXTRACTION_SCHEMA_VERSIONS,
  CONNECTED_LOAD_SATISFACTION_KEYS,
  PROJECT_LEVEL_LOAD_FIELDS,
  EXTRACTABLE_FIELD_KEYS,
  LOAD_DOCUMENT_RANK_RULES,
  resolveLoadFieldKey,
  fieldKeyMatchesUnit,
  isServicePhaseEvidence,
  isProjectTotalEvidence,
  isPanelScheduleEvidence,
  classifyLoadTotalCandidate,
  loadFieldMeaning,
  deduplicateLoadCandidates,
  linkSupersededCandidates,
  classificationPriority,
  candidateDedupPriority,
  semanticDedupKey,
  extractPanelContextFromText,
  canCandidateSatisfyPackage,
  approvalBlockedReason,
  rankLoadSourceDocument,
  rankAndSortLoadDocuments,
  buildCandidateRecord,
  buildCandidateId,
  discoverLoadSourceDocuments,
  discoverProjectDocumentSources,
  extractCandidatesFromStructuredApplication,
  extractUtilityApplicationCandidatesFromText,
  extractCandidatesFromKnownDocumentText,
  extractPanelLoadCandidatesFromPdfText,
  extractServicePhaseCandidatesFromPdfText,
  extractCandidatesFromPdfText,
  extractCandidatesFromTables,
  extractPdfPages,
  getStructuredApplicationFromRecord,
  getVerifiedValuesMap,
  getVerifiedValuesForPackage,
  isConnectedLoadDataSatisfied,
  assignConflictGroups,
  mergeCandidates,
  markStaleCandidates,
  runLoadCandidateExtraction,
  listLoadCandidates,
  resolveLoadCandidate,
  addManualVerifiedValue,
  validateManualVerifiedPayload,
  LoadCandidateExtractionError,
  safeExtractionErrorMessage,
  PROJECT_DOCUMENTS_SELECT,
  toLoadCandidateExtractionError,
};
