"use strict";

const crypto = require("crypto");
const { getCoordinationRecordById } = require("./uci-records.service.js");
const {
  findAgentDraftApplication,
  reconcileLoadProfileReadiness,
} = require("./uci-load-profile.service.js");
const {
  getDocumentProcessingState,
  filterFindingsForUciStage,
  DOCUMENT_PROCESSING_SCHEMA_VERSION,
} = require("./uci-document-processing.service.js");
const {
  EXTRACTABLE_FIELD_KEYS,
  PROJECT_LEVEL_LOAD_FIELDS,
  buildCandidateRecord,
  canCandidateSatisfyPackage,
  mergeCandidates,
  assignConflictGroups,
  linkSupersededCandidates,
  deduplicateLoadCandidates,
  getVerifiedValuesMap,
  isConnectedLoadDataSatisfied,
  semanticDedupKey,
  fieldKeyMatchesUnit,
} = require("./uci-load-candidate.service.js");

const BRIDGE_SCHEMA_VERSION = "row-bridge-v2";
const STALE_BRIDGE_SCHEMA_VERSIONS = new Set(["row-bridge-v1"]);

const AGENT_2_STAGE = "agent_2_load_profile";

const NON_BRIDGE_CATEGORIES = new Set([
  "submission_confirmation",
  "submission_reference",
  "package_document_evidence",
  "site_plan_information",
  "authorization_information",
]);
const EXPECTED_SKIP_REASONS = new Set([
  "unchanged_finding_reused",
  "duplicate_evidence_reused",
  "duplicate_finding_in_batch",
  "unsupported_field_key",
  "not_agent_2_stage",
  "non_agent_2_category",
  "specification_reference_review_only",
  "non_electric_thermal_load",
  "stale_or_rejected_finding",
  "out_of_coordination_scope",
]);

const THERMAL_EVIDENCE_PATTERN = /\b(BTU\s*\/?\s*H?|BTUH|CFM|TONS?\s+OF\s+COOL|THERMAL)\b/i;
const ELECTRICAL_UNIT_PATTERN = /\b(kW|kVA|AMP|AMPS|VOLTS?|V\b)/i;

/**
 * @param {string} findingId
 * @returns {string}
 */
function buildBridgeCandidateId(findingId) {
  const digest = crypto
    .createHash("sha256")
    .update(`${BRIDGE_SCHEMA_VERSION}|${String(findingId)}`)
    .digest("hex")
    .slice(0, 24);
  return `load_candidate:bridge:${digest}`;
}

/**
 * @param {Record<string, unknown>} finding
 */
function isNonElectricThermalLoadFinding(finding) {
  const fieldKey = String(finding.field_key ?? "");
  if (!PROJECT_LEVEL_LOAD_FIELDS.has(fieldKey) && !fieldKey.startsWith("panel_")) {
    return false;
  }
  const unit = String(finding.unit ?? "");
  const evidence = String(finding.evidence_text ?? "");
  const combined = `${unit} ${evidence}`;
  if (!THERMAL_EVIDENCE_PATTERN.test(combined)) return false;
  return !ELECTRICAL_UNIT_PATTERN.test(combined);
}

/**
 * @param {Record<string, unknown>} finding
 * @param {string} externalApplicationId
 * @param {Record<string, unknown>} record
 * @returns {string | null}
 */
function skipReasonForFinding(finding, externalApplicationId, record) {
  if (!finding || typeof finding !== "object") return "malformed_finding";

  const status = String(finding.verification_status ?? "raw");
  if (status === "stale" || status === "rejected") return "stale_or_rejected_finding";

  const stages = Array.isArray(finding.uci_stages) ? finding.uci_stages : [];
  if (!stages.includes(AGENT_2_STAGE)) return "not_agent_2_stage";

  const findingExt = finding.external_application_id != null ? String(finding.external_application_id) : "";
  if (findingExt && findingExt !== externalApplicationId) return "cross_application_finding";

  const fieldKey = String(finding.field_key ?? "").trim();
  if (!fieldKey) return "malformed_finding";
  if (!EXTRACTABLE_FIELD_KEYS.has(fieldKey)) return "unsupported_field_key";

  const category = String(finding.category ?? "");
  if (NON_BRIDGE_CATEGORIES.has(category)) return "non_agent_2_category";

  const entityType = String(finding.entity_type ?? "");
  if (entityType === "specification_reference") return "specification_reference_review_only";

  if (isNonElectricThermalLoadFinding(finding)) return "non_electric_thermal_load";

  const unit = finding.unit != null ? String(finding.unit).trim() : "";
  if (
    (fieldKey.endsWith("_kw") ||
      fieldKey.endsWith("_kva") ||
      fieldKey === "service_amperage" ||
      fieldKey === "service_entrance_amperage" ||
      fieldKey === "requested_service_amperage" ||
      fieldKey === "service_voltage" ||
      fieldKey === "requested_voltage") &&
    !unit
  ) {
    return "missing_unit";
  }

  if (unit && (fieldKey.endsWith("_kw") || fieldKey.endsWith("_kva") || fieldKey === "service_amperage" || fieldKey === "service_entrance_amperage")) {
    if (!fieldKeyMatchesUnit(fieldKey, unit)) return "field_unit_mismatch";
  }

  const roles = Array.isArray(finding.document_role) ? finding.document_role : [];
  if (
    roles.includes("electrical_specification") &&
    !EXTRACTABLE_FIELD_KEYS.has(fieldKey) &&
    !["service_voltage", "service_amperage", "service_entrance_amperage", "requested_service_amperage", "phase", "meter_count", "wire_configuration", "service_configuration"].includes(
      fieldKey,
    )
  ) {
    return "specification_reference_review_only";
  }

  if (String(record.project_id ?? "") && finding.project_id != null) {
    if (String(finding.project_id) !== String(record.project_id)) return "cross_project_finding";
  }

  return null;
}

/**
 * @param {Record<string, unknown>} finding
 * @param {object} ctx
 */
function findingToCandidate(finding, ctx) {
  const fieldKey = String(finding.field_key ?? "");
  const entityType = String(finding.entity_type ?? "project_service") || "project_service";
  const entityName = finding.entity_name != null ? String(finding.entity_name) : null;
  const document = ctx.document && typeof ctx.document === "object" ? ctx.document : null;

  let isProjectTotal = true;
  let panelIdentifierMissing = false;
  let genericSpecRef = false;

  if (entityType === "electrical_panel") {
    isProjectTotal = false;
    panelIdentifierMissing = !entityName;
  } else if (entityType === "equipment") {
    isProjectTotal = false;
  } else if (entityType === "specification_reference") {
    genericSpecRef = true;
    isProjectTotal = false;
  } else if (entityType === "unclassified_load_total") {
    isProjectTotal = false;
  } else if (fieldKey.startsWith("panel_")) {
    isProjectTotal = false;
    panelIdentifierMissing = !entityName;
  } else if (PROJECT_LEVEL_LOAD_FIELDS.has(fieldKey)) {
    isProjectTotal = finding.is_project_total !== false && entityType === "project_service";
  }

  const findingId = String(finding.finding_id ?? "");
  const candidateId = buildBridgeCandidateId(findingId);

  const record = buildCandidateRecord({
    field_key: fieldKey,
    raw_value: String(finding.raw_value ?? ""),
    normalized_value: finding.normalized_value ?? null,
    unit: finding.unit != null ? String(finding.unit) : null,
    source_type: "uci_document_finding",
    source_document_name: String(finding.source_document_name ?? document?.original_filename ?? "unknown"),
    source_document_id: document?.source_document_id != null ? String(document.source_document_id) : finding.document_id != null ? String(finding.document_id) : null,
    source_storage_path: "",
    source_content_hash: String(finding.source_content_hash ?? ""),
    page_number: finding.page_number != null ? Number(finding.page_number) : null,
    evidence_text: String(finding.evidence_text ?? ""),
    extraction_method: String(finding.extraction_method ?? "pdf_text"),
    confidence: finding.confidence != null ? Number(finding.confidence) : null,
    external_application_id: ctx.externalApplicationId,
    entity_type: entityType,
    entity_name: entityName,
    is_project_total: isProjectTotal,
    generic_specification_reference: genericSpecRef,
    panel_identifier_missing: panelIdentifierMissing,
  });

  record.candidate_id = candidateId;
  record.finding_id = findingId;
  record.finding_schema_version = String(finding.schema_version ?? DOCUMENT_PROCESSING_SCHEMA_VERSION);
  record.bridge_schema_version = BRIDGE_SCHEMA_VERSION;
  record.document_role = Array.isArray(finding.document_role) ? finding.document_role.map(String) : [];
  record.package_eligible = canCandidateSatisfyPackage(record);
  record.extraction_schema_version = BRIDGE_SCHEMA_VERSION;

  return record;
}

/**
 * @param {Record<string, unknown>} prior
 * @param {Record<string, unknown>} finding
 */
function findingUnchangedForBridge(prior, finding) {
  return (
    String(prior.finding_schema_version ?? "") === String(finding.schema_version ?? "") &&
    String(prior.bridge_schema_version ?? "") === BRIDGE_SCHEMA_VERSION &&
    String(prior.source_content_hash ?? "") === String(finding.source_content_hash ?? "") &&
    String(prior.normalized_value ?? "") === String(finding.normalized_value ?? "") &&
    String(prior.raw_value ?? "") === String(finding.raw_value ?? "") &&
    String(prior.unit ?? "") === String(finding.unit ?? "")
  );
}

/**
 * @param {Array<Record<string, unknown>>} existing
 * @param {Record<string, unknown>} candidate
 */
function findReusableCandidateByEvidence(existing, candidate) {
  const key = semanticDedupKey(candidate);
  return (
    existing.find(
      (c) =>
        c.status !== "stale" &&
        c.status !== "rejected" &&
        semanticDedupKey(c) === key &&
        String(c.field_key ?? "") === String(candidate.field_key ?? "") &&
        String(c.entity_type ?? "") === String(candidate.entity_type ?? "") &&
        String(c.entity_name ?? "") === String(candidate.entity_name ?? "") &&
        (c.is_project_total === false) === (candidate.is_project_total === false),
    ) ?? null
  );
}

/**
 * @param {Array<Record<string, unknown>>} candidates
 * @param {Set<string>} activeFindingIds
 * @param {Map<string, Record<string, unknown>>} findingById
 * @param {boolean} refresh
 */
function markStaleBridgeCandidates(
  candidates,
  activeFindingIds,
  findingById,
  refresh,
  targetDocumentIds = null,
) {
  let superseded = 0;
  for (const c of candidates) {
    if (c.source_type !== "uci_document_finding") continue;
    if (c.status === "approved" || c.status === "rejected") continue;

    const findingId = String(c.finding_id ?? "");
    const finding = findingById.get(findingId);
    if (
      targetDocumentIds instanceof Set &&
      !targetDocumentIds.has(String(finding?.document_id ?? c.source_document_id ?? ""))
    ) {
      continue;
    }

    const version = String(c.bridge_schema_version ?? "");
    if (version && STALE_BRIDGE_SCHEMA_VERSIONS.has(version)) {
      c.status = "stale";
      c.stale_reason = "bridge_schema_version_changed";
      c.can_satisfy_package = false;
      superseded += 1;
      continue;
    }

    if (!findingId) continue;
    if (!finding || !activeFindingIds.has(findingId)) {
      c.status = "stale";
      c.stale_reason = "finding_removed_or_superseded";
      c.can_satisfy_package = false;
      superseded += 1;
      continue;
    }

    if (refresh || !findingUnchangedForBridge(c, finding)) {
      if (c.status === "candidate") {
        c.status = "stale";
        c.stale_reason = "finding_content_changed";
        c.can_satisfy_package = false;
        superseded += 1;
      }
    }
  }
  return superseded;
}

/**
 * Keep superseded bridge rows addressable when the active row reuses the finding-based id.
 * @param {Array<Record<string, unknown>>} candidates
 */
function preserveStaleBridgeCandidateIds(candidates) {
  for (const c of candidates) {
    if (c.status !== "stale" || c.source_type !== "uci_document_finding") continue;
    const findingId = String(c.finding_id ?? "");
    if (!findingId) continue;
    const baseId = buildBridgeCandidateId(findingId);
    if (String(c.candidate_id) !== baseId) continue;
    const suffix = crypto
      .createHash("sha256")
      .update(
        `${String(c.source_content_hash ?? "")}|${String(c.normalized_value ?? "")}|${String(c.raw_value ?? "")}`,
      )
      .digest("hex")
      .slice(0, 8);
    c.candidate_id = `${baseId}:superseded:${suffix}`;
    c.superseded_finding_revision = true;
  }
}

/**
 * Once canonical document findings exist, retire unapproved candidates from
 * the older parallel extractor for those same documents. Approved rows and
 * candidates outside this application/document set remain untouched.
 *
 * @param {Array<Record<string, unknown>>} candidates
 * @param {Record<string, unknown>} processingState
 * @param {string} externalApplicationId
 */
function markSupersededDirectCandidates(
  candidates,
  processingState,
  externalApplicationId,
  targetDocumentIds = null,
) {
  const processedNames = new Set(
    (Array.isArray(processingState.documents) ? processingState.documents : [])
      .filter(
        (doc) =>
          !(targetDocumentIds instanceof Set) ||
          targetDocumentIds.has(String(doc?.document_id ?? "")),
      )
      .map((doc) => String(doc?.original_filename ?? ""))
      .filter(Boolean),
  );
  let superseded = 0;
  for (const candidate of candidates) {
    if (candidate.status !== "candidate") continue;
    if (candidate.source_type === "uci_document_finding") continue;
    if (
      candidate.external_application_id &&
      String(candidate.external_application_id) !== externalApplicationId
    ) {
      continue;
    }
    if (!processedNames.has(String(candidate.source_document_name ?? ""))) continue;
    candidate.status = "stale";
    candidate.stale_reason = "superseded_by_document_findings_bridge";
    candidate.can_satisfy_package = false;
    superseded += 1;
  }
  return superseded;
}

/**
 * Remove only evidence requirements that the active extraction explicitly
 * satisfies. Panel totals never clear the project/service load requirement.
 *
 * @param {Record<string, unknown>} summary
 * @param {Array<Record<string, unknown>>} candidates
 * @param {Record<string, unknown>} processingState
 */
function reconcileMissingInputs(summary, candidates, processingState) {
  const missing = new Set(
    Array.isArray(summary.missing_inputs) ? summary.missing_inputs.map(String) : [],
  );
  const active = candidates.filter(
    (candidate) => candidate.status !== "stale" && candidate.status !== "rejected",
  );
  const activeFields = new Set(active.map((candidate) => String(candidate.field_key ?? "")));

  if (Array.isArray(processingState.documents) && processingState.documents.length > 0) {
    missing.delete("uploaded_specifications_or_plans");
  }
  if (activeFields.has("phase")) missing.delete("phase");
  if (activeFields.has("requested_voltage")) {
    missing.delete("requested_voltage");
  }
  if (
    activeFields.has("wire_configuration") ||
    activeFields.has("service_configuration")
  ) {
    missing.delete("service_configuration");
  }
  if (activeFields.has("meter_count")) missing.delete("meter_count");

  const hasEquipmentSchedule = active.some(
    (candidate) =>
      String(candidate.entity_type ?? "") === "equipment" ||
      String(candidate.field_key ?? "").startsWith("equipment_schedule_"),
  );
  if (hasEquipmentSchedule) {
    missing.delete("equipment_schedule");
    missing.delete("connected_equipment_or_load_data");
  }

  const hasExplicitProjectLoad = active.some(
    (candidate) =>
      PROJECT_LEVEL_LOAD_FIELDS.has(String(candidate.field_key ?? "")) &&
      candidate.entity_type === "project_service" &&
      candidate.is_project_total === true,
  );
  if (hasExplicitProjectLoad) {
    missing.delete("connected_equipment_or_load_data");
  }

  return [...missing];
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function importDocumentFindingsToLoadProfile(supabase, params) {
  const {
    coordinationRecordId,
    userId,
    externalApplicationId,
    refresh = false,
    documentIds = null,
  } = params;

  const extAppId = String(externalApplicationId || "").trim();

  const record = await getCoordinationRecordById(supabase, coordinationRecordId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const projectId = String(record.project_id ?? "");
  const tenantId = record.tenant_id != null ? String(record.tenant_id) : null;
  const targetDocumentIds = new Set(
    (Array.isArray(documentIds) ? documentIds : []).map(String).filter(Boolean),
  );

  const processingState = getDocumentProcessingState(record.metadata, extAppId, coordinationRecordId);
  if (!processingState) {
    return {
      status: "partial",
      findings_considered: 0,
      findings_imported: 0,
      findings_skipped: 0,
      candidates_created: 0,
      candidates_reused: 0,
      candidates_superseded: 0,
      skipped_reasons: ["no_document_processing_run"],
      failed_findings: [],
      connected_load_satisfied: false,
    };
  }

  const { resolveScopedProjectDocuments, classifyDocumentUtilityScope, isBlockedCrossUtilityAutoInclude } = require("./uci-coordination-document-links.service.js");
  const scoped = await resolveScopedProjectDocuments(supabase, {
    record,
    userId,
  });
  const includedProjectIds = scoped.includedIds;

  const { resolveLoadExtractionScope } = require("./uci-load-extraction-scope.service.js");
  const extractionScope = resolveLoadExtractionScope({
    externalApplicationId: extAppId,
    coordinationRecordId,
  });
  const stateScopeKey = String(
    processingState.extraction_scope_key ??
      processingState.external_application_id ??
      "",
  ).trim();
  if (stateScopeKey && stateScopeKey !== extractionScope.scopeKey) {
    const err = new Error("Document processing state scope mismatch");
    err.statusCode = 400;
    err.code = "SCOPE_MISMATCH";
    throw err;
  }
  if (String(processingState.project_id ?? "") !== projectId) {
    const err = new Error("Document processing project scope mismatch");
    err.statusCode = 400;
    err.code = "CROSS_PROJECT_REJECTED";
    throw err;
  }
  if (
    tenantId &&
    processingState.tenant_id != null &&
    String(processingState.tenant_id) !== tenantId
  ) {
    const err = new Error("Document processing tenant scope mismatch");
    err.statusCode = 400;
    err.code = "CROSS_TENANT_REJECTED";
    throw err;
  }

  const draft = await findAgentDraftApplication(supabase, coordinationRecordId, projectId);
  if (!draft) {
    const err = new Error("Load profile draft is required before importing document findings");
    err.statusCode = 400;
    err.code = "LOAD_PROFILE_REQUIRED";
    throw err;
  }

  const allFindings = Array.isArray(processingState.findings_by_stage?.agent_2_load_profile)
    ? processingState.findings_by_stage.agent_2_load_profile
    : filterFindingsForUciStage(
        Array.isArray(processingState.findings) ? processingState.findings : [],
        AGENT_2_STAGE,
      );

  /** @type {Map<string, Record<string, unknown>>} */
  const docById = new Map();
  for (const doc of Array.isArray(processingState.documents) ? processingState.documents : []) {
    if (doc && doc.document_id) docById.set(String(doc.document_id), doc);
  }

  /** @type {Map<string, Record<string, unknown>>} */
  const findingById = new Map();
  for (const f of allFindings) {
    if (f && f.finding_id) findingById.set(String(f.finding_id), f);
  }

  const existingSummary =
    draft.load_summary && typeof draft.load_summary === "object" && !Array.isArray(draft.load_summary)
      ? /** @type {Record<string, unknown>} */ (draft.load_summary)
      : {};

  const existingCandidates = Array.isArray(existingSummary.candidate_values)
    ? [...existingSummary.candidate_values]
    : [];

  const existingExtraction =
    existingSummary.load_extraction &&
    typeof existingSummary.load_extraction === "object" &&
    !Array.isArray(existingSummary.load_extraction)
      ? /** @type {Record<string, unknown>} */ (existingSummary.load_extraction)
      : {};

  /** @type {Set<string>} */
  const skippedReasonCounts = new Map();
  /** @type {Array<{ finding_id: string | null, message: string }>} */
  const failedFindings = [];
  /** @type {Array<Record<string, unknown>>} */
  const incomingCandidates = [];
  /** @type {Set<string>} */
  const activeFindingIds = new Set();

  let findingsConsidered = 0;
  let findingsImported = 0;
  let findingsSkipped = 0;
  let candidatesCreated = 0;
  let candidatesReused = 0;

  const bumpSkip = (reason) => {
    findingsSkipped += 1;
    skippedReasonCounts.set(reason, (skippedReasonCounts.get(reason) ?? 0) + 1);
  };

  for (const finding of allFindings) {
    if (
      targetDocumentIds.size > 0 &&
      !targetDocumentIds.has(String(finding?.document_id ?? "")) &&
      !targetDocumentIds.has(String(finding?.source_document_id ?? ""))
    ) {
      continue;
    }
    const processingDoc = docById.get(String(finding.document_id ?? ""));
    const sourceType = String(processingDoc?.source_type || finding.source_type || "");
    const projectDocId = String(
      processingDoc?.source_document_id ||
        finding.source_document_id ||
        finding.project_document_id ||
        "",
    );
    const isPortalSource =
      sourceType === "pepco_portal_document" || sourceType === "provider_application";
    const processingScopedIds = new Set(
      (Array.isArray(processingState.documents) ? processingState.documents : [])
        .map((doc) => String(doc.source_document_id || doc.document_id || ""))
        .filter(Boolean),
    );
    const unlinkedIds = new Set(
      scoped.links
        .filter((row) => row.unlinked_at)
        .map((row) => String(row.project_document_id)),
    );
    const blockedCrossUtility = isBlockedCrossUtilityAutoInclude(
      classifyDocumentUtilityScope({
        file_name: finding.source_document_name || processingDoc?.original_filename,
      }),
      record.utility_type,
    );
    const explicitlyIncluded = projectDocId && includedProjectIds.has(projectDocId);
    const explicitlyUnlinked = projectDocId && unlinkedIds.has(projectDocId);
    if (explicitlyUnlinked || (blockedCrossUtility && !explicitlyIncluded && !isPortalSource)) {
      bumpSkip("out_of_coordination_scope");
      findingsConsidered += 1;
      continue;
    }
    if (
      !isPortalSource &&
      projectDocId &&
      includedProjectIds.size > 0 &&
      !includedProjectIds.has(projectDocId)
    ) {
      bumpSkip("out_of_coordination_scope");
      findingsConsidered += 1;
      continue;
    }
    if (
      !isPortalSource &&
      includedProjectIds.size === 0 &&
      projectDocId &&
      !processingScopedIds.has(projectDocId) &&
      !processingScopedIds.has(String(finding.document_id ?? ""))
    ) {
      bumpSkip("out_of_coordination_scope");
      findingsConsidered += 1;
      continue;
    }
    findingsConsidered += 1;
    try {
      const skip = skipReasonForFinding(finding, extAppId, record);
      if (skip) {
        bumpSkip(skip);
        continue;
      }

      const findingId = String(finding.finding_id ?? "");
      if (!findingId) {
        bumpSkip("malformed_finding");
        failedFindings.push({ finding_id: null, message: "finding_id missing" });
        continue;
      }

      activeFindingIds.add(findingId);

      const priorBridge = existingCandidates.find(
        (c) =>
          c.source_type === "uci_document_finding" && String(c.finding_id ?? "") === findingId,
      );

      if (
        priorBridge &&
        priorBridge.status !== "stale" &&
        priorBridge.status !== "rejected" &&
        !refresh &&
        findingUnchangedForBridge(priorBridge, finding)
      ) {
        candidatesReused += 1;
        bumpSkip("unchanged_finding_reused");
        continue;
      }

      const candidate = findingToCandidate(finding, {
        externalApplicationId: extAppId,
        document: docById.get(String(finding.document_id ?? "")) ?? null,
      });

      const reusable = findReusableCandidateByEvidence(existingCandidates, candidate);
      if (reusable && String(reusable.candidate_id) !== String(candidate.candidate_id)) {
        candidatesReused += 1;
        bumpSkip("duplicate_evidence_reused");
        continue;
      }

      const duplicateIncoming = incomingCandidates.find(
        (c) => String(c.finding_id) === findingId || semanticDedupKey(c) === semanticDedupKey(candidate),
      );
      if (duplicateIncoming) {
        candidatesReused += 1;
        bumpSkip("duplicate_finding_in_batch");
        continue;
      }

      incomingCandidates.push(candidate);
      findingsImported += 1;
      candidatesCreated += 1;
    } catch (err) {
      failedFindings.push({
        finding_id: finding?.finding_id != null ? String(finding.finding_id) : null,
        message: err instanceof Error ? err.message.slice(0, 300) : "conversion_failed",
      });
      bumpSkip("conversion_failed");
    }
  }

  let workingCandidates = [...existingCandidates];
  let candidatesSuperseded = markStaleBridgeCandidates(
    workingCandidates,
    activeFindingIds,
    findingById,
    refresh,
    targetDocumentIds.size > 0 ? targetDocumentIds : null,
  );
  candidatesSuperseded += markSupersededDirectCandidates(
    workingCandidates,
    processingState,
    extAppId,
    targetDocumentIds.size > 0 ? targetDocumentIds : null,
  );
  preserveStaleBridgeCandidateIds(workingCandidates);

  workingCandidates = mergeCandidates(workingCandidates, incomingCandidates, false);
  workingCandidates = deduplicateLoadCandidates(workingCandidates);
  workingCandidates = assignConflictGroups(workingCandidates);
  workingCandidates = linkSupersededCandidates(workingCandidates);

  const verifiedValues = getVerifiedValuesMap(existingSummary);

  const bridgeMeta = {
    bridge_schema_version: BRIDGE_SCHEMA_VERSION,
    last_imported_at: new Date().toISOString(),
    last_imported_by: userId,
    external_application_id: extAppId,
    findings_considered: findingsConsidered,
    findings_imported: findingsImported,
    findings_skipped: findingsSkipped,
    candidates_created: candidatesCreated,
    candidates_reused: candidatesReused,
    candidates_superseded: candidatesSuperseded,
    skipped_reason_counts: Object.fromEntries(skippedReasonCounts),
    status:
      failedFindings.length > 0 ||
      [...skippedReasonCounts.keys()].some((reason) => !EXPECTED_SKIP_REASONS.has(reason))
        ? "partial"
        : "complete",
    failed_findings: failedFindings,
  };

  const nextSummary = reconcileLoadProfileReadiness({
    ...existingSummary,
    candidate_values: workingCandidates,
    verified_values: verifiedValues,
    missing_inputs: reconcileMissingInputs(
      existingSummary,
      workingCandidates,
      processingState,
    ),
    load_extraction: {
      ...existingExtraction,
      document_findings_bridge: bridgeMeta,
    },
  });

  const { data, error } = await supabase
    .from("coordination_applications")
    .update({ load_summary: nextSummary })
    .eq("id", draft.id)
    .select("*")
    .single();

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to import document findings"), {
      statusCode: 500,
      code: "DOCUMENT_FINDINGS_IMPORT_FAILED",
    });
  }

  const skippedReasons = [...skippedReasonCounts.entries()].map(
    ([reason, count]) => `${reason}:${count}`,
  );

  return {
    status: bridgeMeta.status,
    findings_considered: findingsConsidered,
    findings_imported: findingsImported,
    findings_skipped: findingsSkipped,
    candidates_created: candidatesCreated,
    candidates_reused: candidatesReused,
    candidates_superseded: candidatesSuperseded,
    skipped_reasons: skippedReasons,
    failed_findings: failedFindings,
    connected_load_satisfied: isConnectedLoadDataSatisfied(nextSummary),
    application: data,
  };
}

module.exports = {
  BRIDGE_SCHEMA_VERSION,
  STALE_BRIDGE_SCHEMA_VERSIONS,
  buildBridgeCandidateId,
  skipReasonForFinding,
  findingToCandidate,
  findingUnchangedForBridge,
  findReusableCandidateByEvidence,
  markStaleBridgeCandidates,
  preserveStaleBridgeCandidateIds,
  markSupersededDirectCandidates,
  reconcileMissingInputs,
  importDocumentFindingsToLoadProfile,
};
