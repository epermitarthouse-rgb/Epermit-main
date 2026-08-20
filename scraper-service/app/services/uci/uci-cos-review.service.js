"use strict";

/**
 * Human review actions for Stage 6 COS / Design Review.
 * Approve, accept material deviation, request revision, flag, reject, supersede.
 * Accepted values are editable; utility-issued extraction stays immutable.
 */

const { getCoordinationRecordById } = require("./uci-records.service.js");
const { recordUserTransition, recordSystemTransition } = require("./uci-transitions.service.js");
const { stopCosSla } = require("./uci-cos-sla.service.js");
const { getCurrentCosDesignRecord } = require("./uci-cos-analyst.service.js");
const { canEnterStage7 } = require("./uci-stage6-entry.service.js");
const { emitUciEvent } = require("./uci-events.service.js");
const {
  buildAcceptedFieldUpdate,
  buildApprovedSnapshot,
  buildOverrideSummary,
  seedAcceptedFields,
  applyAcceptedToComparisonRows,
} = require("./uci-cos-accepted-values.service.js");
const {
  applyComparisonInclusionToggles,
  filterIncludedComparisonRows,
  recomputeCosReviewFromComparisonRows,
} = require("./uci-cos-comparison-inclusion.service.js");

async function recomputePredictionsForRecordId(supabase, coordinationRecordId) {
  const { loadCoordinationRecord, afterCoordinationRecordWrite } = require("./uci-record-write.service.js");
  const refreshed = await loadCoordinationRecord(supabase, coordinationRecordId);
  return afterCoordinationRecordWrite(supabase, refreshed);
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} cosId
 * @param {string} projectId
 */
async function loadCosRecord(supabase, cosId, projectId) {
  const { data, error } = await supabase
    .from("coordination_cos_design_records")
    .select("*")
    .eq("id", cosId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) {
    throw Object.assign(new Error(error.message || "Failed to load COS design record"), {
      cause: error,
      statusCode: 500,
      code: "COS_RECORD_FETCH_FAILED",
    });
  }
  if (!data) {
    const err = new Error("COS design record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  return data;
}

/**
 * Ensure accepted_fields / comparison accepted layer present (legacy rows).
 * @param {object} cos
 */
function ensureAcceptedLayer(cos) {
  const comparisonRows = Array.isArray(cos.comparison_rows) ? cos.comparison_rows : [];
  const acceptedFields =
    cos.accepted_fields &&
    typeof cos.accepted_fields === "object" &&
    !Array.isArray(cos.accepted_fields) &&
    Object.keys(cos.accepted_fields).length > 0
      ? cos.accepted_fields
      : seedAcceptedFields(comparisonRows);
  return {
    ...cos,
    accepted_fields: acceptedFields,
    comparison_rows: applyAcceptedToComparisonRows(comparisonRows, acceptedFields),
    field_overrides: Array.isArray(cos.field_overrides) ? cos.field_overrides : [],
    review_version: Number(cos.review_version || 1),
  };
}

/**
 * Update operator accepted values without mutating utility-issued extraction.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function updateCosAcceptedFields(supabase, params) {
  const {
    coordinationRecordId,
    userId,
    cosDesignRecordId = null,
    updates = [],
    resetFields = [],
  } = params;

  const record = await getCoordinationRecordById(supabase, coordinationRecordId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  if (Number(record.current_stage) !== 6) {
    const err = new Error("Stage 6 must be active to edit accepted COS values");
    err.statusCode = 409;
    err.code = "STAGE_6_NOT_ACTIVE";
    throw err;
  }

  const projectId = String(record.project_id);
  let cos =
    (cosDesignRecordId
      ? await loadCosRecord(supabase, cosDesignRecordId, projectId)
      : await getCurrentCosDesignRecord(supabase, coordinationRecordId)) || null;

  if (!cos || !cos.is_current) {
    const err = new Error("No current COS / design record to edit");
    err.statusCode = 409;
    err.code = "COS_RECORD_REQUIRED";
    throw err;
  }

  if (String(cos.review_status) === "approved") {
    const err = new Error(
      "Approved COS snapshot is frozen — upload a revised COS for a new version",
    );
    err.statusCode = 409;
    err.code = "COS_ALREADY_APPROVED";
    throw err;
  }

  if (String(cos.evidence_status) === "ADVISORY") {
    const err = new Error("Cannot edit accepted values on advisory/predicted COS");
    err.statusCode = 409;
    err.code = "ADVISORY_NOT_EDITABLE";
    throw err;
  }

  cos = ensureAcceptedLayer(cos);

  /** @type {Array<{ field: string, accepted_value: unknown, reason?: string | null }>} */
  const normalizedUpdates = [];
  for (const u of Array.isArray(updates) ? updates : []) {
    if (!u || typeof u !== "object") continue;
    normalizedUpdates.push({
      field: String(/** @type {any} */ (u).field || ""),
      accepted_value: /** @type {any} */ (u).accepted_value,
      reason: /** @type {any} */ (u).reason != null ? String(/** @type {any} */ (u).reason) : null,
    });
  }
  for (const field of Array.isArray(resetFields) ? resetFields : []) {
    const key = String(field || "").trim();
    if (!key) continue;
    normalizedUpdates.push({
      field: key,
      accepted_value: null,
      reason: "Reset to utility-issued",
    });
  }

  if (normalizedUpdates.length === 0) {
    const err = new Error("No accepted-field updates provided");
    err.statusCode = 400;
    err.code = "NO_UPDATES";
    throw err;
  }

  const resetSet = new Set(
    (Array.isArray(resetFields) ? resetFields : [])
      .map((f) => String(f || "").trim())
      .filter(Boolean),
  );
  const setUpdates = normalizedUpdates.filter((u) => !resetSet.has(u.field));
  const resetUpdates = normalizedUpdates.filter((u) => resetSet.has(u.field));

  let working = { ...cos };
  /** @type {Array<Record<string, unknown>>} */
  let allNewOverrides = [];

  if (setUpdates.length) {
    const built = buildAcceptedFieldUpdate(working, setUpdates, { userId, reset: false });
    working = {
      ...working,
      accepted_fields: built.accepted_fields,
      field_overrides: built.field_overrides,
      comparison_rows: built.comparison_rows,
      review_version: built.review_version,
    };
    allNewOverrides = allNewOverrides.concat(built.new_overrides);
  }
  if (resetUpdates.length) {
    const built = buildAcceptedFieldUpdate(working, resetUpdates, { userId, reset: true });
    working = {
      ...working,
      accepted_fields: built.accepted_fields,
      field_overrides: built.field_overrides,
      comparison_rows: built.comparison_rows,
      review_version: built.review_version,
    };
    allNewOverrides = allNewOverrides.concat(built.new_overrides);
  }

  // Never touch extracted_fields — utility source stays immutable
  const { data: updatedCos, error } = await supabase
    .from("coordination_cos_design_records")
    .update({
      accepted_fields: working.accepted_fields,
      field_overrides: working.field_overrides,
      comparison_rows: working.comparison_rows,
      review_version: working.review_version,
    })
    .eq("id", cos.id)
    .select("*")
    .single();

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to update accepted COS fields"), {
      cause: error,
      statusCode: 500,
      code: "COS_ACCEPTED_UPDATE_FAILED",
    });
  }

  const prevMeta =
    record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
      ? /** @type {Record<string, unknown>} */ (record.metadata)
      : {};
  const priorAnalysis =
    prevMeta.uci_cos_analysis && typeof prevMeta.uci_cos_analysis === "object"
      ? /** @type {Record<string, unknown>} */ (prevMeta.uci_cos_analysis)
      : {};

  await supabase
    .from("coordination_records")
    .update({
      metadata: {
        ...prevMeta,
        uci_cos_analysis: {
          ...priorAnalysis,
          comparison_rows: working.comparison_rows,
          accepted_fields: working.accepted_fields,
          review_version: working.review_version,
          override_summary: buildOverrideSummary(working),
          cos_design_record_id: cos.id,
        },
      },
    })
    .eq("id", coordinationRecordId);

  await recomputePredictionsForRecordId(supabase, coordinationRecordId);

  emitUciEvent(
    "uci.stage6.accepted_fields_updated",
    {
      coordination_record_id: coordinationRecordId,
      project_id: projectId,
      cos_design_record_id: cos.id,
      review_version: working.review_version,
      override_count: allNewOverrides.length,
    },
    { supabase },
  );

  return {
    ok: true,
    cos_design_record: updatedCos,
    new_overrides: allNewOverrides,
    override_summary: buildOverrideSummary(updatedCos || working),
    extracted_fields_unchanged: true,
  };
}

/**
 * Toggle comparison-row inclusion without mutating utility-issued extraction.
 * Excluded rows stay visible but do not count toward Stage 6 blockers.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function updateCosComparisonInclusion(supabase, params) {
  const {
    coordinationRecordId,
    userId,
    cosDesignRecordId = null,
    toggles = [],
    confirmCoreExclusion = false,
  } = params;

  const record = await getCoordinationRecordById(supabase, coordinationRecordId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  if (Number(record.current_stage) !== 6) {
    const err = new Error("Stage 6 must be active to edit COS comparison inclusion");
    err.statusCode = 409;
    err.code = "STAGE_6_NOT_ACTIVE";
    throw err;
  }

  const projectId = String(record.project_id);
  let cos =
    (cosDesignRecordId
      ? await loadCosRecord(supabase, cosDesignRecordId, projectId)
      : await getCurrentCosDesignRecord(supabase, coordinationRecordId)) || null;

  if (!cos || !cos.is_current) {
    const err = new Error("No current COS / design record to edit");
    err.statusCode = 409;
    err.code = "COS_RECORD_REQUIRED";
    throw err;
  }

  if (String(cos.review_status) === "approved") {
    const err = new Error(
      "Approved COS snapshot is frozen — upload a revised COS for a new version",
    );
    err.statusCode = 409;
    err.code = "COS_ALREADY_APPROVED";
    throw err;
  }

  if (String(cos.evidence_status) === "ADVISORY") {
    const err = new Error("Cannot edit comparison inclusion on advisory/predicted COS");
    err.statusCode = 409;
    err.code = "ADVISORY_NOT_EDITABLE";
    throw err;
  }

  cos = ensureAcceptedLayer(cos);

  const normalizedToggles = (Array.isArray(toggles) ? toggles : [])
    .filter((t) => t && typeof t === "object")
    .map((t) => ({
      field: String(/** @type {any} */ (t).field || ""),
      included_in_comparison: /** @type {any} */ (t).included_in_comparison !== false,
    }))
    .filter((t) => t.field);

  if (normalizedToggles.length === 0) {
    const err = new Error("No comparison inclusion toggles provided");
    err.statusCode = 400;
    err.code = "NO_INCLUSION_TOGGLES";
    throw err;
  }

  const comparisonRows = applyComparisonInclusionToggles(cos, normalizedToggles, {
    confirmCoreExclusion: confirmCoreExclusion === true,
  });

  const priorReport =
    cos.discrepancy_report && typeof cos.discrepancy_report === "object"
      ? /** @type {Record<string, unknown>} */ (cos.discrepancy_report)
      : {};
  const priorDiscrepancies = Array.isArray(priorReport.discrepancies)
    ? priorReport.discrepancies
    : [];
  const structuralDiscrepancies = priorDiscrepancies.filter((d) => {
    if (!d || typeof d !== "object") return false;
    const field = d.field != null ? String(d.field) : null;
    return !field;
  });
  const documentConflicts = Array.isArray(priorReport.document_conflicts)
    ? priorReport.document_conflicts
    : [];

  const recomputed = recomputeCosReviewFromComparisonRows({
    comparisonRows,
    structuralDiscrepancies,
    revisionRequired: priorReport.revision_required === true,
    documentCount: Number(
      (priorReport.review_summary &&
      typeof priorReport.review_summary === "object" &&
      !Array.isArray(priorReport.review_summary) &&
      /** @type {any} */ (priorReport.review_summary).document_count) ||
        0,
    ),
    documentConflicts,
  });

  const reviewVersion = Number(cos.review_version || 1) + 1;
  const sourceExtractionBefore = JSON.stringify(cos.extracted_fields || {});

  const discrepancyReportPayload = {
    ...priorReport,
    discrepancies: recomputed.discrepancies,
    material_discrepancy_count: recomputed.material_discrepancy_count,
    requires_human_review: recomputed.requires_human_review,
    clean_match: recomputed.clean_match,
    review_summary: recomputed.review_summary,
    analysis_status: recomputed.analysis_status,
  };

  const { data: updatedCos, error } = await supabase
    .from("coordination_cos_design_records")
    .update({
      comparison_rows: recomputed.comparison_rows,
      review_status: recomputed.review_status,
      evidence_status: recomputed.evidence_status,
      needs_human_attention: recomputed.needs_human_attention,
      attention_reasons: recomputed.attention_reasons,
      discrepancy_report: discrepancyReportPayload,
      review_version: reviewVersion,
    })
    .eq("id", cos.id)
    .select("*")
    .single();

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to update comparison inclusion"), {
      cause: error,
      statusCode: 500,
      code: "COS_INCLUSION_UPDATE_FAILED",
    });
  }

  if (JSON.stringify(updatedCos?.extracted_fields || {}) !== sourceExtractionBefore) {
    const err = new Error("Inclusion update mutated utility-issued extraction — aborted");
    err.statusCode = 500;
    err.code = "SOURCE_MUTATION_DETECTED";
    throw err;
  }

  const prevMeta =
    record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
      ? /** @type {Record<string, unknown>} */ (record.metadata)
      : {};
  const priorAnalysis =
    prevMeta.uci_cos_analysis && typeof prevMeta.uci_cos_analysis === "object"
      ? /** @type {Record<string, unknown>} */ (prevMeta.uci_cos_analysis)
      : {};

  await supabase
    .from("coordination_records")
    .update({
      metadata: {
        ...prevMeta,
        uci_cos_analysis: {
          ...priorAnalysis,
          comparison_rows: recomputed.comparison_rows,
          review_status: recomputed.review_status,
          evidence_status: recomputed.evidence_status,
          review_version: reviewVersion,
          review_summary: recomputed.review_summary,
          cos_design_record_id: cos.id,
        },
      },
    })
    .eq("id", coordinationRecordId);

  await recomputePredictionsForRecordId(supabase, coordinationRecordId);

  emitUciEvent(
    "uci.stage6.comparison_inclusion_updated",
    {
      coordination_record_id: coordinationRecordId,
      project_id: projectId,
      cos_design_record_id: cos.id,
      review_version: reviewVersion,
      toggles: normalizedToggles,
    },
    { supabase },
  );

  let coordinationRecord = record;
  let autoCompleteResult = null;
  if (
    recomputed.clean_match === true &&
    recomputed.review_status === "ready_for_approval" &&
    recomputed.evidence_status === "UTILITY_ISSUED"
  ) {
    autoCompleteResult = await autoCompleteCleanCosMatch(supabase, {
      coordinationRecordId,
      cosDesignRecordId: cos.id,
      reason: "Clean included COS comparison — Stage 6 auto-completed",
    });
    if (autoCompleteResult?.coordination_record) {
      coordinationRecord = autoCompleteResult.coordination_record;
    }
  }

  return {
    ok: true,
    cos_design_record: autoCompleteResult?.cos_design_record || updatedCos,
    coordination_record: coordinationRecord,
    can_enter_stage_7: canEnterStage7(coordinationRecord),
    auto_completed: autoCompleteResult?.auto_completed === true,
    auto_complete: autoCompleteResult,
    review_state: recomputed,
    extracted_fields_unchanged: true,
  };
}

/**
 * Agent 6 clean-match auto-complete (A6.10): no discrepancies + high-confidence
 * utility-issued evidence → Stage 6 COMPLETED without manual Approve COS.
 * Operator may still Flag / Reopen / Correct afterward.
 * Does not mutate immutable utility-issued extracted_fields.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function autoCompleteCleanCosMatch(supabase, params) {
  const {
    coordinationRecordId,
    cosDesignRecordId,
    communicationId = null,
    reason = "Clean high-confidence COS match — Stage 6 auto-completed",
  } = params;

  const record = await getCoordinationRecordById(supabase, coordinationRecordId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  if (Number(record.current_stage) !== 6) {
    return {
      auto_completed: false,
      reason: "stage_6_not_active",
      coordination_record: record,
      can_enter_stage_7: canEnterStage7(record),
    };
  }
  if (
    String(record.current_stage_state) === "COMPLETED" &&
    record.class_of_service_issued_at
  ) {
    return {
      auto_completed: false,
      already_completed: true,
      coordination_record: record,
      can_enter_stage_7: canEnterStage7(record),
    };
  }

  const projectId = String(record.project_id);
  let cos =
    (cosDesignRecordId
      ? await loadCosRecord(supabase, cosDesignRecordId, projectId)
      : await getCurrentCosDesignRecord(supabase, coordinationRecordId)) || null;

  if (!cos || String(cos.evidence_status) !== "UTILITY_ISSUED") {
    return {
      auto_completed: false,
      reason: "not_utility_issued_clean_match",
      coordination_record: record,
      can_enter_stage_7: false,
    };
  }
  if (String(cos.review_status) === "approved") {
    return {
      auto_completed: false,
      already_approved: true,
      cos_design_record: cos,
      coordination_record: record,
      can_enter_stage_7: canEnterStage7(record),
    };
  }
  if (String(cos.review_status) !== "ready_for_approval") {
    return {
      auto_completed: false,
      reason: "not_ready_for_auto_complete",
      cos_design_record: cos,
      coordination_record: record,
      can_enter_stage_7: false,
    };
  }

  const discrepancyReport =
    cos.discrepancy_report && typeof cos.discrepancy_report === "object"
      ? cos.discrepancy_report
      : {};
  const discrepancies = Array.isArray(discrepancyReport.discrepancies)
    ? discrepancyReport.discrepancies
    : [];
  if (
    discrepancies.length > 0 ||
    discrepancyReport.requires_human_review === true ||
    discrepancyReport.clean_match === false
  ) {
    return {
      auto_completed: false,
      reason: "discrepancies_or_human_review_required",
      cos_design_record: cos,
      coordination_record: record,
      can_enter_stage_7: false,
    };
  }
  // Prefer explicit clean_match from analyst; otherwise ready_for_approval + empty discrepancies
  if (
    discrepancyReport.clean_match !== true &&
    !(discrepancyReport.requires_human_review === false && discrepancies.length === 0)
  ) {
    return {
      auto_completed: false,
      reason: "not_marked_clean_match",
      cos_design_record: cos,
      coordination_record: record,
      can_enter_stage_7: false,
    };
  }

  cos = ensureAcceptedLayer(cos);
  const issuedAt = cos.utility_evidence_issued_at || new Date().toISOString();
  const approvedAt = new Date().toISOString();
  const sourceExtractionBefore = JSON.stringify(cos.extracted_fields || {});

  const approvedSnapshot = buildApprovedSnapshot(cos, {
    userId: null,
    approvedAt,
    notes: reason,
    acceptMaterialDeviation: false,
  });
  approvedSnapshot.auto_completed = true;
  approvedSnapshot.frozen_by = "system:agent_6";

  const { data: updatedCos, error: cosErr } = await supabase
    .from("coordination_cos_design_records")
    .update({
      review_status: "approved",
      needs_human_attention: false,
      attention_reasons: [],
      approved_at: approvedAt,
      approved_by: null,
      approval_notes: reason,
      accepted_fields: approvedSnapshot.accepted_fields,
      comparison_rows: approvedSnapshot.comparison_rows,
      field_overrides: approvedSnapshot.field_overrides,
      approved_snapshot: approvedSnapshot,
      evidence_status: "UTILITY_ISSUED",
      agent_metadata: {
        ...(cos.agent_metadata && typeof cos.agent_metadata === "object" && !Array.isArray(cos.agent_metadata)
          ? cos.agent_metadata
          : {}),
        auto_completed: true,
        auto_completed_at: approvedAt,
        auto_complete_reason: reason,
      },
      discrepancy_report: {
        ...discrepancyReport,
        source_communication_id:
          discrepancyReport.source_communication_id ||
          cos.source_communication_id ||
          communicationId ||
          null,
        auto_completed: true,
        requires_human_review: false,
      },
    })
    .eq("id", cos.id)
    .select("*")
    .single();

  if (cosErr) {
    throw Object.assign(new Error(cosErr.message || "Failed to auto-complete COS record"), {
      cause: cosErr,
      statusCode: 500,
      code: "COS_AUTO_COMPLETE_FAILED",
    });
  }

  if (JSON.stringify(updatedCos?.extracted_fields || {}) !== sourceExtractionBefore) {
    const err = new Error("Auto-complete mutated utility-issued extraction — aborted integrity check");
    err.statusCode = 500;
    err.code = "SOURCE_MUTATION_DETECTED";
    throw err;
  }

  const prevMeta =
    record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
      ? /** @type {Record<string, unknown>} */ (record.metadata)
      : {};

  await supabase
    .from("coordination_records")
    .update({
      class_of_service_issued_at: issuedAt,
      metadata: {
        ...prevMeta,
        uci_cos_analysis: {
          ...(prevMeta.uci_cos_analysis && typeof prevMeta.uci_cos_analysis === "object"
            ? prevMeta.uci_cos_analysis
            : {}),
          review_status: "approved",
          auto_completed: true,
          approved_at: approvedAt,
          approved_by: null,
          cos_design_record_id: cos.id,
          class_of_service_issued_at: issuedAt,
          review_version: approvedSnapshot.review_version,
          approved_snapshot_version: approvedSnapshot.snapshot_version,
          comparison_rows: approvedSnapshot.comparison_rows,
          accepted_fields: approvedSnapshot.accepted_fields,
          requires_human_review: false,
        },
      },
    })
    .eq("id", coordinationRecordId);

  const { record: completed, transition } = await recordSystemTransition(supabase, {
    coordinationRecordId,
    toStage: 6,
    toState: "COMPLETED",
    reason,
    triggeredByType: "system",
    triggeredById: communicationId || cos.source_communication_id || null,
    metadata: {
      action: "auto_complete_clean_cos_match",
      agent: "agent_6_cos_analyst",
      cos_design_record_id: cos.id,
      class_of_service_issued_at: issuedAt,
      source_communication_id: communicationId || cos.source_communication_id || null,
      review_version: approvedSnapshot.review_version,
      approved_snapshot_version: approvedSnapshot.snapshot_version,
    },
  });

  await stopCosSla(supabase, {
    coordinationRecordId,
    reason: "Stage 6 clean COS match auto-completed",
  });

  const finalRecord = await getCoordinationRecordById(supabase, coordinationRecordId);

  emitUciEvent(
    "uci.stage6.cos_auto_completed",
    {
      coordination_record_id: coordinationRecordId,
      project_id: projectId,
      cos_design_record_id: cos.id,
      class_of_service_issued_at: issuedAt,
      source_communication_id: communicationId || cos.source_communication_id || null,
      can_enter_stage_7: canEnterStage7(finalRecord || completed),
    },
    { supabase },
  );

  return {
    auto_completed: true,
    cos_design_record: updatedCos,
    approved_snapshot: approvedSnapshot,
    coordination_record: finalRecord || completed,
    transition,
    class_of_service_issued_at: issuedAt,
    can_enter_stage_7: canEnterStage7(finalRecord || completed),
  };
}

/**
 * Complete Stage 6 when requirements satisfied.
 * Sets class_of_service_issued_at from utility evidence only (never advisory).
 * Freezes reviewed/accepted snapshot; does not mutate extracted_fields.
 * Manual path retained for discrepancy resolution / operator override acceptance.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function approveCosDesign(supabase, params) {
  const {
    coordinationRecordId,
    userId,
    cosDesignRecordId = null,
    notes = null,
    acceptMaterialDeviation = false,
    acceptedDeviations = [],
  } = params;

  const record = await getCoordinationRecordById(supabase, coordinationRecordId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  if (Number(record.current_stage) !== 6) {
    const err = new Error("Stage 6 must be active to approve COS");
    err.statusCode = 409;
    err.code = "STAGE_6_NOT_ACTIVE";
    throw err;
  }

  const projectId = String(record.project_id);
  let cos =
    (cosDesignRecordId
      ? await loadCosRecord(supabase, cosDesignRecordId, projectId)
      : await getCurrentCosDesignRecord(supabase, coordinationRecordId)) || null;

  if (!cos) {
    const err = new Error("No current COS / design record to approve");
    err.statusCode = 409;
    err.code = "COS_RECORD_REQUIRED";
    throw err;
  }

  if (String(cos.evidence_status) === "ADVISORY") {
    const err = new Error(
      "Cannot approve advisory/predicted COS as utility-issued — wait for utility evidence",
    );
    err.statusCode = 409;
    err.code = "ADVISORY_NOT_APPROVABLE";
    throw err;
  }

  cos = ensureAcceptedLayer(cos);

  // Document conflicts require an operator-chosen accepted value before approve
  const includedRows = filterIncludedComparisonRows(
    Array.isArray(cos.comparison_rows) ? cos.comparison_rows : [],
  );
  const unresolvedConflicts = includedRows.filter(
    (r) =>
      (r.utility_conflict === true || r.result === "document_conflict") &&
      (r.accepted == null || r.accepted === ""),
  );
  if (unresolvedConflicts.length > 0) {
    const err = new Error(
      `Resolve document conflicts by choosing Accepted values first: ${unresolvedConflicts
        .map((r) => r.label || r.field)
        .join(", ")}`,
    );
    err.statusCode = 409;
    err.code = "DOCUMENT_CONFLICT_UNRESOLVED";
    throw err;
  }

  const hasMaterial =
    (Array.isArray(cos.discrepancy_report?.discrepancies) &&
      cos.discrepancy_report.discrepancies.some(
        (d) =>
          d &&
          (d.severity === "high" || d.material === true) &&
          (d.field == null ||
            includedRows.some((r) => String(r.field) === String(d.field))),
      )) ||
    includedRows.some(
      (r) =>
        r.material === true &&
        r.result &&
        r.result !== "match" &&
        r.result !== "insufficient_data",
    );

  if (hasMaterial && !acceptMaterialDeviation) {
    const err = new Error(
      "Material discrepancies require explicit acceptance with reason before approval",
    );
    err.statusCode = 409;
    err.code = "MATERIAL_DEVIATION_REQUIRES_ACCEPTANCE";
    throw err;
  }

  if (hasMaterial && acceptMaterialDeviation) {
    const reasonText = String(notes || "").trim();
    if (!reasonText) {
      const err = new Error("Acceptance of material deviation requires a reason");
      err.statusCode = 400;
      err.code = "DEVIATION_REASON_REQUIRED";
      throw err;
    }
  }

  const issuedAt = cos.utility_evidence_issued_at || new Date().toISOString();
  const approvedAt = new Date().toISOString();
  const sourceExtractionBefore = JSON.stringify(cos.extracted_fields || {});

  const approvedSnapshot = buildApprovedSnapshot(cos, {
    userId,
    approvedAt,
    notes,
    acceptMaterialDeviation,
  });

  const { data: updatedCos, error: cosErr } = await supabase
    .from("coordination_cos_design_records")
    .update({
      review_status: "approved",
      needs_human_attention: false,
      approved_at: approvedAt,
      approved_by: userId,
      approval_notes: notes,
      accepted_fields: approvedSnapshot.accepted_fields,
      comparison_rows: approvedSnapshot.comparison_rows,
      field_overrides: approvedSnapshot.field_overrides,
      approved_snapshot: approvedSnapshot,
      accepted_deviations: acceptMaterialDeviation
        ? [
            ...(Array.isArray(cos.accepted_deviations) ? cos.accepted_deviations : []),
            ...acceptedDeviations,
            {
              at: approvedAt,
              by: userId,
              reason: notes,
            },
          ]
        : cos.accepted_deviations || [],
      evidence_status:
        hasMaterial && acceptMaterialDeviation ? "DISCREPANCY" : "UTILITY_ISSUED",
    })
    .eq("id", cos.id)
    .select("*")
    .single();

  if (cosErr) {
    throw Object.assign(new Error(cosErr.message || "Failed to approve COS record"), {
      cause: cosErr,
      statusCode: 500,
      code: "COS_APPROVE_FAILED",
    });
  }

  if (JSON.stringify(updatedCos?.extracted_fields || {}) !== sourceExtractionBefore) {
    const err = new Error("Approve mutated utility-issued extraction — aborted integrity check");
    err.statusCode = 500;
    err.code = "SOURCE_MUTATION_DETECTED";
    throw err;
  }

  const prevMeta =
    record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
      ? /** @type {Record<string, unknown>} */ (record.metadata)
      : {};

  await supabase
    .from("coordination_records")
    .update({
      class_of_service_issued_at: issuedAt,
      metadata: {
        ...prevMeta,
        uci_cos_analysis: {
          ...(prevMeta.uci_cos_analysis && typeof prevMeta.uci_cos_analysis === "object"
            ? prevMeta.uci_cos_analysis
            : {}),
          review_status: "approved",
          approved_at: approvedAt,
          approved_by: userId,
          cos_design_record_id: cos.id,
          review_version: approvedSnapshot.review_version,
          override_summary: approvedSnapshot.override_summary,
          approved_snapshot_version: approvedSnapshot.snapshot_version,
          comparison_rows: approvedSnapshot.comparison_rows,
          accepted_fields: approvedSnapshot.accepted_fields,
        },
      },
    })
    .eq("id", coordinationRecordId);

  const { record: completed, transition } = await recordUserTransition(supabase, {
    coordinationRecordId,
    userId,
    toStage: 6,
    toState: "COMPLETED",
    reason: notes || "COS / design review approved",
    metadata: {
      action: "approve_cos_design",
      cos_design_record_id: cos.id,
      class_of_service_issued_at: issuedAt,
      accepted_material_deviation: acceptMaterialDeviation === true,
      review_version: approvedSnapshot.review_version,
      override_count: Array.isArray(approvedSnapshot.override_summary)
        ? approvedSnapshot.override_summary.length
        : 0,
      approved_snapshot_version: approvedSnapshot.snapshot_version,
    },
  });

  await stopCosSla(supabase, {
    coordinationRecordId,
    reason: "Stage 6 COS approved",
  });

  const finalRecord = await getCoordinationRecordById(supabase, coordinationRecordId);

  emitUciEvent(
    "uci.stage6.cos_approved",
    {
      coordination_record_id: coordinationRecordId,
      project_id: projectId,
      cos_design_record_id: cos.id,
      class_of_service_issued_at: issuedAt,
      can_enter_stage_7: canEnterStage7(finalRecord),
      review_version: approvedSnapshot.review_version,
      override_count: Array.isArray(approvedSnapshot.override_summary)
        ? approvedSnapshot.override_summary.length
        : 0,
    },
    { supabase },
  );

  return {
    ok: true,
    cos_design_record: updatedCos,
    approved_snapshot: approvedSnapshot,
    override_summary: approvedSnapshot.override_summary,
    coordination_record: finalRecord || completed,
    transition,
    class_of_service_issued_at: issuedAt,
    can_enter_stage_7: canEnterStage7(finalRecord || completed),
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function requestCosRevision(supabase, params) {
  const { coordinationRecordId, userId, notes, requiredDocuments = [] } = params;
  const record = await getCoordinationRecordById(supabase, coordinationRecordId);
  if (!record || Number(record.current_stage) !== 6) {
    const err = new Error("Stage 6 must be active to request revision");
    err.statusCode = 409;
    err.code = "STAGE_6_NOT_ACTIVE";
    throw err;
  }

  const cos = await getCurrentCosDesignRecord(supabase, coordinationRecordId);
  if (!cos) {
    const err = new Error("No current COS record");
    err.statusCode = 409;
    err.code = "COS_RECORD_REQUIRED";
    throw err;
  }

  const revision = {
    at: new Date().toISOString(),
    by: userId,
    notes: String(notes || "").trim() || "Revision requested",
    required_documents: requiredDocuments,
  };

  const { data: updatedCos } = await supabase
    .from("coordination_cos_design_records")
    .update({
      review_status: "revision_required",
      needs_human_attention: true,
      attention_reasons: ["REVISION_REQUESTED", ...(cos.attention_reasons || [])],
      revision_request: revision,
      evidence_status: "DISCREPANCY",
    })
    .eq("id", cos.id)
    .select("*")
    .single();

  const { record: updated } = await recordUserTransition(supabase, {
    coordinationRecordId,
    userId,
    toStage: 6,
    toState: "BLOCKED",
    reason: revision.notes,
    metadata: { action: "cos_revision_requested", cos_design_record_id: cos.id },
  });

  return { ok: true, cos_design_record: updatedCos, coordination_record: updated };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function rejectCosDocument(supabase, params) {
  const { coordinationRecordId, userId, reason } = params;
  const reasonText = String(reason || "").trim();
  if (!reasonText) {
    const err = new Error("Rejection reason is required");
    err.statusCode = 400;
    err.code = "REJECTION_REASON_REQUIRED";
    throw err;
  }

  const record = await getCoordinationRecordById(supabase, coordinationRecordId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const cos = await getCurrentCosDesignRecord(supabase, coordinationRecordId);
  if (!cos) {
    const err = new Error("No current COS record");
    err.statusCode = 409;
    err.code = "COS_RECORD_REQUIRED";
    throw err;
  }

  const rejectedAt = new Date().toISOString();
  const { data: updatedCos } = await supabase
    .from("coordination_cos_design_records")
    .update({
      review_status: "rejected",
      needs_human_attention: true,
      rejected_at: rejectedAt,
      rejected_by: userId,
      rejection_reason: reasonText,
      is_current: false,
    })
    .eq("id", cos.id)
    .select("*")
    .single();

  await recordUserTransition(supabase, {
    coordinationRecordId,
    userId,
    toStage: 6,
    toState: "AWAITING_UTILITY",
    reason: `Rejected wrong COS/design document: ${reasonText}`,
    metadata: { action: "cos_document_rejected", cos_design_record_id: cos.id },
  });

  return { ok: true, cos_design_record: updatedCos };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function flagCosForReview(supabase, params) {
  const { coordinationRecordId, userId, reason = "Flagged for engineering review" } = params;
  const cos = await getCurrentCosDesignRecord(supabase, coordinationRecordId);
  if (!cos) {
    const err = new Error("No current COS record");
    err.statusCode = 409;
    err.code = "COS_RECORD_REQUIRED";
    throw err;
  }

  const { data: updatedCos } = await supabase
    .from("coordination_cos_design_records")
    .update({
      needs_human_attention: true,
      review_status: "needs_attention",
      attention_reasons: [
        "FLAGGED",
        ...(Array.isArray(cos.attention_reasons) ? cos.attention_reasons : []),
      ],
      agent_metadata: {
        ...(cos.agent_metadata && typeof cos.agent_metadata === "object" ? cos.agent_metadata : {}),
        flagged: {
          at: new Date().toISOString(),
          by: userId,
          reason,
        },
      },
    })
    .eq("id", cos.id)
    .select("*")
    .single();

  return { ok: true, cos_design_record: updatedCos };
}

/**
 * List COS design records for a coordination (current + history).
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} coordinationRecordId
 * @param {string} projectId
 */
async function listCosDesignRecords(supabase, coordinationRecordId, projectId) {
  const { data, error } = await supabase
    .from("coordination_cos_design_records")
    .select("*")
    .eq("coordination_record_id", coordinationRecordId)
    .eq("project_id", projectId)
    .order("version", { ascending: false });

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to list COS records"), {
      cause: error,
      statusCode: 500,
      code: "COS_LIST_FAILED",
    });
  }
  return Array.isArray(data) ? data : [];
}

module.exports = {
  approveCosDesign,
  autoCompleteCleanCosMatch,
  updateCosAcceptedFields,
  updateCosComparisonInclusion,
  requestCosRevision,
  rejectCosDocument,
  flagCosForReview,
  listCosDesignRecords,
  loadCosRecord,
  ensureAcceptedLayer,
  buildOverrideSummary,
};
