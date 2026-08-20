"use strict";

/**
 * Stage 6 Agent 6 — Class of Service / Design Review analyst (full product).
 * Parses utility COS/design evidence, compares to verified LP + application package,
 * persists durable coordination_cos_design_records, never treats ADVISORY as issued.
 */

const { getCoordinationRecordById } = require("./uci-records.service.js");
const { recordSystemTransition } = require("./uci-transitions.service.js");
const { emitUciEvent } = require("./uci-events.service.js");
const {
  COS_ANALYSIS_VERSION,
  COS_TRIGGER_CLASSIFICATIONS,
  LOW_CONFIDENCE_THRESHOLD,
} = require("./uci-cos-constants.js");
const { parseCosDesignDocuments } = require("./uci-cos-document-parser.service.js");
const { extractCosDesignFields } = require("./uci-cos-extract.service.js");
const { loadCosComparisonBaseline } = require("./uci-cos-baseline.service.js");
const { buildCosDiscrepancyReport } = require("./uci-cos-discrepancy.service.js");
const { seedAcceptedFields } = require("./uci-cos-accepted-values.service.js");
const {
  extractPerDocumentFields,
  mergeDocumentExtractions,
  buildCosReviewSummary,
  annotateComparisonRowsWithConflicts,
} = require("./uci-cos-multi-doc.service.js");
const { canEnterStage6, enterStage6, canEnterStage7 } = require("./uci-stage6-entry.service.js");
const { upsertCostRecord } = require("./uci-costs.service.js");
const {
  resolveCommunicationAttachmentBuffers,
  resolveProjectDocumentBuffers,
} = require("./uci-graph-attachment-persist.service.js");
const { isFlaggedForReview } = require("./uci-ack-acceptance.service.js");

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} coordinationRecordId
 * @param {string} projectId
 */
async function loadTriggerCommunications(supabase, coordinationRecordId, projectId) {
  const { data, error } = await supabase
    .from("coordination_communications")
    .select("*")
    .eq("coordination_record_id", coordinationRecordId)
    .eq("project_id", projectId)
    .in("classification", [...COS_TRIGGER_CLASSIFICATIONS])
    .order("message_timestamp", { ascending: false, nullsFirst: false });

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to load COS communications"), {
      cause: error,
      statusCode: 500,
      code: "COS_COMMS_FETCH_FAILED",
    });
  }
  return Array.isArray(data) ? data : [];
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} coordinationRecordId
 */
async function getCurrentCosDesignRecord(supabase, coordinationRecordId) {
  const { data, error } = await supabase
    .from("coordination_cos_design_records")
    .select("*")
    .eq("coordination_record_id", coordinationRecordId)
    .eq("is_current", true)
    .maybeSingle();
  if (error) {
    throw Object.assign(new Error(error.message || "Failed to load COS design record"), {
      cause: error,
      statusCode: 500,
      code: "COS_RECORD_FETCH_FAILED",
    });
  }
  return data;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function supersedeCurrentCosRecord(supabase, params) {
  const { coordinationRecordId, projectId } = params;
  const current = await getCurrentCosDesignRecord(supabase, coordinationRecordId);
  if (!current) return null;

  const { data: updated, error } = await supabase
    .from("coordination_cos_design_records")
    .update({
      is_current: false,
      review_status: "superseded",
    })
    .eq("id", current.id)
    .eq("project_id", projectId)
    .select("*")
    .single();

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to supersede COS record"), {
      cause: error,
      statusCode: 500,
      code: "COS_SUPERSEDE_FAILED",
    });
  }
  return updated;
}

/**
 * Persist CIAC implication cost with idempotency (does not build Stage 7 product).
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function maybeCreateCiacImplicationCost(supabase, params) {
  const { coordinationRecordId, projectId, cosRecordId, extractedFields } = params;
  const ciac = extractedFields?.ciac_estimate;
  const amount =
    ciac && typeof ciac === "object" && ciac.value != null ? Number(ciac.value) : null;
  if (!(Number.isFinite(amount) && amount > 0)) {
    return { created: false, reason: "no_ciac_estimate" };
  }

  const idempotencyKey = `cos_ciac:${cosRecordId}`;
  const { data: existing } = await supabase
    .from("coordination_costs")
    .select("*")
    .eq("coordination_record_id", coordinationRecordId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existing?.id) {
    return { created: false, reason: "already_exists", cost: existing };
  }

  const result = await upsertCostRecord(supabase, {
    coordinationRecordId,
    projectId,
    cost: {
      cost_type: "CIAC",
      estimated_amount: amount,
      estimated_at: new Date().toISOString(),
      estimated_source: "cos_seed",
      notes: `Auto-created from COS/design evidence ${cosRecordId}`,
      cos_design_record_id: cosRecordId,
      idempotency_key: idempotencyKey,
      invoice_received_doc_ref: `cos_design:${cosRecordId}`,
    },
  });

  // Best-effort attach cos_design_record_id / idempotency if columns exist
  if (result.cost?.id) {
    await supabase
      .from("coordination_costs")
      .update({
        cos_design_record_id: cosRecordId,
        idempotency_key: idempotencyKey,
      })
      .eq("id", result.cost.id);
  }

  return { created: result.created, cost: result.cost, reason: "ciac_from_cos" };
}

/**
 * Apply Stage 6 state from discrepancy outcome (never silent-accept material deviations).
 * Clean high-confidence matches are auto-completed separately (A6.10).
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function applyStage6StateFromAnalysis(supabase, params) {
  const { record, report, reason } = params;
  if (Number(record.current_stage) !== 6) return { transitioned: false, record };
  // Auto-complete path owns COMPLETED transition
  if (report.clean_match === true && report.requires_human_review === false) {
    return { transitioned: false, record, deferred_to_auto_complete: true };
  }

  let toState = "IN_PROGRESS";
  if (report.has_material_discrepancy || report.requires_human_review || report.revision_required) {
    toState = "IN_PROGRESS";
  } else if (report.review_status === "ready_for_approval") toState = "IN_PROGRESS";

  if (String(record.current_stage_state) === toState) {
    return { transitioned: false, record };
  }

  const { record: updated } = await recordSystemTransition(supabase, {
    coordinationRecordId: String(record.id),
    toStage: 6,
    toState,
    reason,
    triggeredByType: "system",
    triggeredById: null,
    metadata: {
      action: "stage_6_state_from_analysis",
      agent: "agent_6_cos_analyst",
      analysis_status: report.analysis_status,
      material_discrepancy: report.has_material_discrepancy,
      revision_required: report.revision_required,
    },
  });

  return { transitioned: true, record: updated };
}

/**
 * Clean / high-confidence utility-issued match eligible for Stage 6 auto-complete.
 * @param {object} params
 */
function isCleanHighConfidenceAutoCompletable(params) {
  const {
    report,
    evidenceStatus,
    parseMeta,
    extraction,
    advisoryOnly,
    communication = null,
  } = params;

  if (advisoryOnly === true) return false;
  if (String(evidenceStatus) !== "UTILITY_ISSUED") return false;
  if (report?.clean_match !== true) return false;
  if (report?.requires_human_review !== false) return false;
  if (report?.has_material_discrepancy || report?.revision_required) return false;
  if (Array.isArray(report?.discrepancies) && report.discrepancies.length > 0) return false;
  if (parseMeta?.uncertain === true) return false;
  if (extraction?.uncertain === true) return false;
  const extractionConfidence = Number(extraction?.extraction_confidence);
  if (Number.isFinite(extractionConfidence) && extractionConfidence < LOW_CONFIDENCE_THRESHOLD) {
    return false;
  }
  if (communication) {
    const conf = Number(communication.classification_confidence);
    if (Number.isFinite(conf) && conf < LOW_CONFIDENCE_THRESHOLD) return false;
    const meta =
      communication.agent_processed_metadata &&
      typeof communication.agent_processed_metadata === "object" &&
      !Array.isArray(communication.agent_processed_metadata)
        ? /** @type {Record<string, unknown>} */ (communication.agent_processed_metadata)
        : {};
    if (isFlaggedForReview(meta)) return false;
  }
  const rows = Array.isArray(report?.comparison_rows) ? report.comparison_rows : [];
  if (!rows.some((r) => r.result === "match")) return false;
  return true;
}

/**
 * Full Stage 6 COS / design analysis pipeline.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function runCosDesignAnalysis(supabase, params) {
  const {
    coordinationRecordId,
    userId = null,
    communicationId = null,
    triggeredBy = "manual",
    attachments = [],
    projectDocumentIds = [],
    deps = {},
    advisoryOnly = false,
  } = params;

  let record = await getCoordinationRecordById(supabase, coordinationRecordId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const projectId = String(record.project_id);

  // Enter Stage 6 when eligible (manual analyze path)
  if (Number(record.current_stage) !== 6 && canEnterStage6(record)) {
    const entry = await enterStage6(supabase, {
      coordinationRecordId,
      reason: "COS / design analysis started",
      triggeredById: userId || null,
      triggeredByType: userId ? "user" : "system",
    });
    record = entry.coordination_record || record;
  }

  // Manual upload/select-existing always creates a new version (revised COS must not overwrite).
  if (
    (Array.isArray(projectDocumentIds) && projectDocumentIds.length > 0) ||
    triggeredBy === "manual_upload" ||
    triggeredBy === "select_existing"
  ) {
    deps.forceNewVersion = true;
  }

  const communications = await loadTriggerCommunications(supabase, coordinationRecordId, projectId);
  const primary =
    (communicationId && communications.find((c) => String(c.id) === String(communicationId))) ||
    communications[0] ||
    null;

  /** @type {Array<Record<string, unknown>>} */
  const structural = [];

  const baseline = await loadCosComparisonBaseline(supabase, {
    coordinationRecordId,
    projectId,
  });

  if (!baseline.load_profile_present) {
    structural.push({
      code: "LOAD_PROFILE_MISSING",
      severity: "high",
      message: "No verified Load Profile draft to compare against COS/design",
    });
  }
  if (!baseline.application_package_present) {
    structural.push({
      code: "APPLICATION_PACKAGE_MISSING",
      severity: "medium",
      message: "No Application Builder package found for baseline comparison",
    });
  }
  if (!baseline.has_verified_or_calculated) {
    structural.push({
      code: "NO_VERIFIED_BASELINE_VALUES",
      severity: "high",
      message: "No verified/calculated baseline engineering values for comparison",
    });
  }

  // Prefer explicit buffers (Graph ingest), else project_document_ids, else linked comm docs, else body.
  let resolvedAttachments = Array.isArray(attachments) ? [...attachments] : [];
  if (
    resolvedAttachments.length === 0 &&
    Array.isArray(projectDocumentIds) &&
    projectDocumentIds.length
  ) {
    try {
      resolvedAttachments = await resolveProjectDocumentBuffers(supabase, {
        projectId,
        projectDocumentIds,
      });
    } catch {
      resolvedAttachments = [];
    }
  }
  if (resolvedAttachments.length === 0 && primary) {
    try {
      resolvedAttachments = await resolveCommunicationAttachmentBuffers(supabase, primary);
    } catch {
      resolvedAttachments = [];
    }
  }
  if (
    resolvedAttachments.length === 0 &&
    Array.isArray(deps.stage6Attachments) &&
    deps.stage6Attachments.length
  ) {
    resolvedAttachments = deps.stage6Attachments;
  }

  if (!primary && resolvedAttachments.length === 0) {
    structural.push({
      code: "COS_COMMUNICATION_MISSING",
      severity: "medium",
      message: "No classified class_of_service or design_review_response communication",
    });
  }

  let parseResult = {
    text: "",
    document_refs: [],
    parse_meta: { uncertain: true, char_count: 0 },
  };

  if (primary || resolvedAttachments.length) {
    parseResult = await parseCosDesignDocuments({
      communication: primary || {
        id: null,
        raw_subject: "COS/design document evidence",
        raw_body: "",
        raw_attachments: [],
      },
      attachments: resolvedAttachments,
      deps,
    });
  }

  const extraction = extractCosDesignFields(parseResult.text, {
    utilityType: String(record.utility_type || "electric"),
  });

  // Independent per-document extraction + conflict merge (never silent pick)
  const perDocExtractions = extractPerDocumentFields(parseResult.per_document || [], {
    utilityType: String(record.utility_type || "electric"),
  });
  const mergedDocs = mergeDocumentExtractions(perDocExtractions);
  // Prefer merged multi-doc fields when we have document evidence; fall back to combined text extraction
  const mergedFields =
    mergedDocs.document_count > 0
      ? { ...extraction.fields, ...mergedDocs.fields }
      : extraction.fields;

  if (parseResult.parse_meta?.uncertain || extraction.uncertain) {
    structural.push({
      code: "PARSE_OR_EXTRACTION_UNCERTAIN",
      severity: "high",
      message: "COS/design parse or field extraction is uncertain — human review required",
    });
  }

  for (const conflict of mergedDocs.conflicts || []) {
    structural.push({
      code: conflict.code,
      field: conflict.field,
      severity: conflict.severity || "high",
      material: conflict.material === true,
      message: conflict.message,
      candidates: conflict.candidates,
    });
  }

  const report = buildCosDiscrepancyReport({
    baselineFields: baseline.baseline_fields,
    extractedFields: mergedFields,
  });

  report.comparison_rows = annotateComparisonRowsWithConflicts(
    report.comparison_rows,
    mergedFields,
    mergedDocs.conflicts || [],
  );

  // Seed accepted from utility-issued (null when conflict — operator must choose)
  report.comparison_rows = report.comparison_rows.map((row) => {
    if (row.utility_conflict === true) {
      return { ...row, accepted: null, operator_override: false };
    }
    return row;
  });

  report.discrepancies = [...structural, ...report.discrepancies];
  if (
    structural.some((d) => d.severity === "high") ||
    report.has_material_discrepancy ||
    (mergedDocs.conflicts || []).length > 0
  ) {
    report.has_material_discrepancy = true;
    report.analysis_status = report.revision_required ? "revision_required" : "needs_attention";
    report.review_status = report.revision_required ? "revision_required" : "needs_attention";
    if (report.has_material_discrepancy && report.evidence_status !== "ADVISORY") {
      report.evidence_status = "DISCREPANCY";
    }
  }

  // Recompute clean-match after structural / conflict merges (A6.10)
  report.clean_match =
    report.revision_required !== true &&
    report.has_material_discrepancy !== true &&
    report.review_status === "ready_for_approval" &&
    Array.isArray(report.discrepancies) &&
    report.discrepancies.length === 0 &&
    Array.isArray(report.comparison_rows) &&
    report.comparison_rows.length > 0;
  report.requires_human_review = !report.clean_match;

  // Provenance: advisory predictions never become UTILITY_ISSUED.
  // Uploaded/selected project documents count as utility evidence (not advisory).
  const hasDocumentEvidence = resolvedAttachments.length > 0;
  let evidenceStatus = advisoryOnly ? "ADVISORY" : report.evidence_status;
  if (advisoryOnly) {
    evidenceStatus = "ADVISORY";
  } else if (!primary && !hasDocumentEvidence) {
    evidenceStatus = "ADVISORY";
  } else if (report.has_material_discrepancy || report.revision_required) {
    evidenceStatus = "DISCREPANCY";
  } else {
    evidenceStatus = "UTILITY_ISSUED";
  }

  const eligibleAutoComplete = isCleanHighConfidenceAutoCompletable({
    report,
    evidenceStatus,
    parseMeta: parseResult.parse_meta,
    extraction,
    advisoryOnly,
    communication: primary,
  });
  // Advisory / non-utility evidence cannot auto-complete
  if (evidenceStatus !== "UTILITY_ISSUED") {
    report.clean_match = false;
    report.requires_human_review = true;
  } else if (!eligibleAutoComplete && report.clean_match) {
    // Parse/OCR/extraction uncertainty or flagged review blocks auto-complete
    report.clean_match = false;
    report.requires_human_review = true;
    report.analysis_status = "needs_attention";
    report.review_status = "needs_attention";
    if (!report.discrepancies.some((d) => d.code === "PARSE_OR_EXTRACTION_UNCERTAIN")) {
      report.discrepancies.push({
        code: "AUTO_COMPLETE_GATED",
        severity: "high",
        message:
          "Clean field match was gated (low confidence, OCR/uncertain parse, or flagged review) — human review required",
      });
    }
  }

  const attentionReasons = report.discrepancies.map((d) => d.code || d.message).filter(Boolean);
  const needsAttention =
    !eligibleAutoComplete &&
    (evidenceStatus !== "UTILITY_ISSUED" ||
      report.review_status !== "ready_for_approval" ||
      report.requires_human_review === true);

  const prior = await getCurrentCosDesignRecord(supabase, coordinationRecordId);

  // Duplicate poll / re-classify: same communication + same attachment hashes → no new version
  const attachmentFingerprint = (resolvedAttachments || [])
    .map((a) => String(a.content_hash || a.project_document_id || a.name || ""))
    .filter(Boolean)
    .sort()
    .join("|");
  const priorFp =
    prior?.agent_metadata &&
    typeof prior.agent_metadata === "object" &&
    !Array.isArray(prior.agent_metadata)
      ? String(/** @type {any} */ (prior.agent_metadata).attachment_fingerprint || "")
      : "";
  if (
    deps.forceNewVersion !== true &&
    prior &&
    primary?.id &&
    String(prior.source_communication_id) === String(primary.id) &&
    (!attachmentFingerprint || priorFp === attachmentFingerprint)
  ) {
    return {
      skipped: true,
      reason: "duplicate_source_communication",
      cos_design_record: prior,
      coordination_record: record,
      evidence_status: prior.evidence_status,
      review_status: prior.review_status,
      can_enter_stage_7: canEnterStage7(record),
    };
  }

  const nextVersion = prior ? Number(prior.version || 1) + 1 : 1;
  if (prior) {
    await supersedeCurrentCosRecord(supabase, { coordinationRecordId, projectId });
  }

  const issuedAtCandidate =
    mergedFields.utility_evidence_issued_at &&
    typeof mergedFields.utility_evidence_issued_at === "object"
      ? /** @type {any} */ (mergedFields.utility_evidence_issued_at).value
      : primary?.message_timestamp || null;

  // Predictions / advisory never write issued timestamps
  const utilityEvidenceIssuedAt =
    evidenceStatus === "ADVISORY"
      ? null
      : issuedAtCandidate
        ? new Date(String(issuedAtCandidate)).toISOString()
        : primary
          ? new Date().toISOString()
          : null;

  const reviewSummary = buildCosReviewSummary({
    documentCount: Math.max(
      mergedDocs.document_count || 0,
      Number(parseResult.parse_meta?.document_count) || 0,
      resolvedAttachments.length || 0,
    ),
    comparisonRows: report.comparison_rows,
    discrepancies: report.discrepancies,
    conflicts: mergedDocs.conflicts || [],
    reviewStatus: eligibleAutoComplete ? "approved" : report.review_status,
    evidenceStatus,
    autoCompleted: eligibleAutoComplete,
  });

  const discrepancyReportPayload = {
    version: COS_ANALYSIS_VERSION,
    analysis_status: report.analysis_status,
    discrepancies: report.discrepancies,
    material_discrepancy_count: report.material_discrepancy_count,
    revision_required: report.revision_required,
    requires_human_review: report.requires_human_review !== false,
    clean_match: report.clean_match === true,
    // Linked to triggering communication (not only coordination metadata)
    source_communication_id: primary?.id ?? null,
    linked_to_communication: Boolean(primary?.id),
    document_conflicts: mergedDocs.conflicts || [],
    review_summary: reviewSummary,
  };

  const cosRow = {
    coordination_record_id: coordinationRecordId,
    project_id: projectId,
    version: nextVersion,
    is_current: true,
    superseded_by: null,
    evidence_status: evidenceStatus,
    review_status: report.review_status,
    source_communication_id: primary?.id ?? null,
    document_refs: parseResult.document_refs,
    source_text_excerpt: String(parseResult.text || "").slice(0, 4000),
    parse_meta: {
      ...parseResult.parse_meta,
      multi_document: {
        document_count: mergedDocs.document_count,
        conflict_count: (mergedDocs.conflicts || []).length,
        documents: mergedDocs.documents,
      },
    },
    // Immutable utility-issued merge (conflicts store candidates, value null)
    extracted_fields: mergedFields,
    baseline_fields: baseline.baseline_fields,
    discrepancy_report: discrepancyReportPayload,
    comparison_rows: report.comparison_rows,
    // Fresh utility evidence: accepted defaults to utility-issued; do not copy prior overrides
    accepted_fields: seedAcceptedFields(report.comparison_rows),
    field_overrides: [],
    approved_snapshot: null,
    review_version: 1,
    utility_evidence_issued_at: utilityEvidenceIssuedAt,
    needs_human_attention: needsAttention,
    attention_reasons: attentionReasons,
    agent_metadata: {
      version: COS_ANALYSIS_VERSION,
      triggered_by: triggeredBy,
      generated_by_user_id: userId,
      generated_at: new Date().toISOString(),
      extraction_confidence: extraction.extraction_confidence,
      baseline,
      advisory_only: advisoryOnly === true,
      attachment_fingerprint: attachmentFingerprint || null,
      review_summary: reviewSummary,
      field_sources: mergedDocs.field_sources || {},
      clean_match: report.clean_match === true,
      eligible_auto_complete: eligibleAutoComplete,
      // Prior approved/history remains on superseded row (prior.id); never silent overwrite
      prior_cos_design_record_id: prior?.id || null,
      prior_approved_snapshot_preserved: Boolean(prior?.approved_snapshot),
    },
  };

  const { data: cosRecord, error: insertErr } = await supabase
    .from("coordination_cos_design_records")
    .insert(cosRow)
    .select("*")
    .single();

  if (insertErr) {
    throw Object.assign(new Error(insertErr.message || "Failed to store COS design record"), {
      cause: insertErr,
      statusCode: 500,
      code: "COS_RECORD_INSERT_FAILED",
    });
  }

  if (prior?.id && cosRecord?.id) {
    await supabase
      .from("coordination_cos_design_records")
      .update({ superseded_by: cosRecord.id })
      .eq("id", prior.id);
  }

  const ciac = await maybeCreateCiacImplicationCost(supabase, {
    coordinationRecordId,
    projectId,
    cosRecordId: cosRecord.id,
    extractedFields: mergedFields,
  });

  const { maybeSeedEquipmentFromCos } = require("./uci-equipment-tracker.service.js");
  const equipmentSeed = await maybeSeedEquipmentFromCos(supabase, {
    coordinationRecordId,
    projectId,
    extractedFields: mergedFields,
  });

  let autoCompleteResult = null;
  if (eligibleAutoComplete) {
    // Dynamic require avoids circular dependency with uci-cos-review.service.js
    const { autoCompleteCleanCosMatch } = require("./uci-cos-review.service.js");
    autoCompleteResult = await autoCompleteCleanCosMatch(supabase, {
      coordinationRecordId,
      cosDesignRecordId: cosRecord.id,
      communicationId: primary?.id ? String(primary.id) : null,
      reason: "Clean high-confidence COS match — Stage 6 auto-completed (Agent 6 A6.10)",
    });
    if (autoCompleteResult?.coordination_record) {
      record = autoCompleteResult.coordination_record;
    }
    if (autoCompleteResult?.cos_design_record) {
      Object.assign(cosRecord, autoCompleteResult.cos_design_record);
    }
  } else {
    const stateResult = await applyStage6StateFromAnalysis(supabase, {
      record,
      report,
      reason: `COS analysis ${report.analysis_status}`,
    });
    record = stateResult.record || record;
  }

  // Mirror summary into metadata for backward-compatible UI
  const existingMetadata =
    record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
      ? /** @type {Record<string, unknown>} */ (record.metadata)
      : {};

  const analysisMirror = {
    version: COS_ANALYSIS_VERSION,
    analysis_status: report.analysis_status,
    evidence_status: evidenceStatus,
    review_status:
      autoCompleteResult?.auto_completed === true ? "approved" : report.review_status,
    auto_completed: autoCompleteResult?.auto_completed === true,
    cos_design_record_id: cosRecord.id,
    discrepancies: report.discrepancies,
    comparison_rows: report.comparison_rows,
    accepted_fields: cosRecord.accepted_fields || cosRow.accepted_fields,
    review_summary: reviewSummary,
    review_version: cosRecord.review_version || 1,
    trigger_communication_count: communications.length,
    source_communication_id: primary?.id ?? null,
    load_profile_present: baseline.load_profile_present,
    application_package_present: baseline.application_package_present,
    generated_at: new Date().toISOString(),
    generated_by_user_id: userId,
    requires_human_review: report.requires_human_review !== false,
    clean_match: report.clean_match === true,
    notes: [
      "Stage 6 full analyst — utility-issued evidence separated from advisory predictions",
      "Multi-document conflicts are surfaced for operator choice; never silently resolved",
      eligibleAutoComplete
        ? "Clean high-confidence match auto-completes Stage 6 (no manual Approve COS)"
        : "Discrepancies remain IN_PROGRESS until human resolution",
    ],
  };

  const { data: updatedRecord, error: metaErr } = await supabase
    .from("coordination_records")
    .update({
      metadata: {
        ...existingMetadata,
        uci_cos_analysis: {
          ...(existingMetadata.uci_cos_analysis &&
          typeof existingMetadata.uci_cos_analysis === "object"
            ? existingMetadata.uci_cos_analysis
            : {}),
          ...analysisMirror,
        },
      },
    })
    .eq("id", coordinationRecordId)
    .eq("project_id", projectId)
    .select("*")
    .single();

  if (metaErr) {
    throw Object.assign(new Error(metaErr.message || "Failed to store COS analysis mirror"), {
      cause: metaErr,
      statusCode: 500,
      code: "COS_UPDATE_FAILED",
    });
  }
  const { afterCoordinationRecordWrite } = require("./uci-record-write.service.js");
  record = await afterCoordinationRecordWrite(supabase, updatedRecord || record);

  // Always link discrepancy_report to the triggering communication (A6.9)
  if (primary?.id) {
    const prevMeta =
      primary.agent_processed_metadata &&
      typeof primary.agent_processed_metadata === "object" &&
      !Array.isArray(primary.agent_processed_metadata)
        ? /** @type {Record<string, unknown>} */ (primary.agent_processed_metadata)
        : {};
    const stage6Link = {
      cos_design_record_id: cosRecord.id,
      evidence_status: evidenceStatus,
      review_status:
        autoCompleteResult?.auto_completed === true ? "approved" : report.review_status,
      attention_reasons: attentionReasons,
      auto_completed: autoCompleteResult?.auto_completed === true,
      clean_match: report.clean_match === true,
      // Full discrepancy report linked on the communication (not only coordination metadata)
      discrepancy_report: {
        ...discrepancyReportPayload,
        auto_completed: autoCompleteResult?.auto_completed === true,
      },
      at: new Date().toISOString(),
    };
    await supabase
      .from("coordination_communications")
      .update({
        needs_human_attention: needsAttention && autoCompleteResult?.auto_completed !== true,
        agent_processed_metadata: {
          ...prevMeta,
          stage_6_cos: stage6Link,
          stage_6_auto_completed: autoCompleteResult?.auto_completed === true,
          ...(autoCompleteResult?.auto_completed === true
            ? {
                stage_6_completion: {
                  completed: true,
                  auto_completed: true,
                  at: new Date().toISOString(),
                  cos_design_record_id: cosRecord.id,
                  class_of_service_issued_at:
                    autoCompleteResult.class_of_service_issued_at || utilityEvidenceIssuedAt,
                },
              }
            : {}),
        },
      })
      .eq("id", String(primary.id));
  }

  emitUciEvent(
    "uci.stage6.cos_analyzed",
    {
      coordination_record_id: coordinationRecordId,
      project_id: projectId,
      cos_design_record_id: cosRecord.id,
      evidence_status: evidenceStatus,
      review_status:
        autoCompleteResult?.auto_completed === true ? "approved" : report.review_status,
      material_discrepancy: report.has_material_discrepancy,
      auto_completed: autoCompleteResult?.auto_completed === true,
      source_communication_id: primary?.id ?? null,
    },
    { supabase },
  );

  const finalRecord = await getCoordinationRecordById(supabase, coordinationRecordId);

  return {
    coordination_record_id: coordinationRecordId,
    project_id: projectId,
    cos_design_record: cosRecord,
    analysis: analysisMirror,
    comparison_rows: report.comparison_rows,
    discrepancies: report.discrepancies,
    review_summary: reviewSummary,
    ciac_implication: ciac,
    equipment_seed: equipmentSeed,
    auto_completed: autoCompleteResult?.auto_completed === true,
    auto_complete: autoCompleteResult,
    class_of_service_issued_at:
      autoCompleteResult?.class_of_service_issued_at ||
      (finalRecord || updatedRecord)?.class_of_service_issued_at ||
      null,
    coordination_record: finalRecord || updatedRecord,
    can_enter_stage_6: canEnterStage6(finalRecord || updatedRecord),
    can_enter_stage_7: canEnterStage7(finalRecord || updatedRecord),
    stage_unchanged:
      Number(record.current_stage) === Number((finalRecord || updatedRecord).current_stage),
  };
}

/** Backward-compatible alias used by existing routes/tests */
async function runCosDiscrepancyAnalysis(supabase, params) {
  return runCosDesignAnalysis(supabase, params);
}

module.exports = {
  COS_ANALYSIS_VERSION,
  COS_TRIGGER_CLASSIFICATIONS,
  runCosDesignAnalysis,
  runCosDiscrepancyAnalysis,
  getCurrentCosDesignRecord,
  maybeCreateCiacImplicationCost,
  isCleanHighConfidenceAutoCompletable,
  applyStage6StateFromAnalysis,
};
