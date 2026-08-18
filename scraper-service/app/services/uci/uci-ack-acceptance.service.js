"use strict";

/**
 * Stage 5 acknowledgment acceptance — complete Stage 5 only when criteria met:
 * receipt + ticket/account + ack date + real named PM/coordinator.
 * Placeholder PM values never satisfy completion. Does not start Stage 6.
 */

const { recordSystemTransition, recordUserTransition } = require("./uci-transitions.service.js");
const { startAcknowledgmentSla, stopAcknowledgmentSla } = require("./uci-ack-sla.service.js");
const { canEnterStage6 } = require("./uci-stage5-entry.service.js");
const { LOW_CONFIDENCE_THRESHOLD } = require("./uci-communication-categories.js");
const { emitUciEvent } = require("./uci-events.service.js");

/** Values that must never satisfy the PM/coordinator assignment gate. */
const PM_PLACEHOLDER_PATTERNS = Object.freeze([
  /^pending(\s+utility)?(\s+contact)?$/i,
  /^tbd$/i,
  /^n\/?a$/i,
  /^unknown$/i,
  /^none$/i,
  /^null$/i,
  /^-+$/,
  /^not\s+(yet\s+)?assigned$/i,
  /^awaiting(\s+assignment)?$/i,
]);

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isRealUtilityPm(value) {
  const s = String(value ?? "").trim();
  if (!s) return false;
  if (PM_PLACEHOLDER_PATTERNS.some((re) => re.test(s))) return false;
  return true;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeUtilityPm(value) {
  const s = String(value ?? "").trim();
  if (!isRealUtilityPm(s)) return null;
  return s;
}

/**
 * @param {Record<string, unknown>} meta
 */
function isFlaggedForReview(meta) {
  return meta?.flagged_for_review === true || meta?.blocks_auto_lifecycle === true;
}

/**
 * Resolve fields for Stage 5 completion.
 * PM/coordinator must come from **current** acknowledgment evidence or reviewer
 * extracted fields — never from stale coordination-level `utility_project_manager`
 * / `utility_contact_name` left behind by a prior completed acknowledgment.
 *
 * @param {Record<string, unknown>} extracted
 * @param {Record<string, unknown>} record
 * @param {Record<string, unknown> | null} application
 */
function resolveCompletionFields(extracted, record, application) {
  const ticket =
    (extracted.utility_ticket_number && String(extracted.utility_ticket_number).trim()) ||
    (application?.utility_ticket_number && String(application.utility_ticket_number).trim()) ||
    null;
  const account =
    (extracted.utility_account_number && String(extracted.utility_account_number).trim()) ||
    (record.utility_account_number && String(record.utility_account_number).trim()) ||
    null;
  // Current-evidence PM only (classifier / reviewer on this communication).
  const pm = normalizeUtilityPm(extracted.utility_project_manager);
  const nextAction =
    (extracted.next_required_action && String(extracted.next_required_action).trim()) ||
    (record.next_required_action && String(record.next_required_action).trim()) ||
    "Monitor for class of service / design review";
  const ackDate =
    (extracted.acknowledgment_date && String(extracted.acknowledgment_date).trim()) ||
    null;

  return { ticket, account, pm, nextAction, ackDate };
}

/**
 * Shared Stage 5 completion eligibility (auto + human confirm).
 * @param {object} params
 */
function evaluateAutoAckEligibility(params) {
  const {
    classification,
    confidence,
    matched,
    flagged,
    extracted,
    record,
    application,
    skipConfidenceCheck = false,
  } = params;

  if (flagged) {
    return { eligible: false, reason: "flagged_for_review" };
  }
  if (!matched) {
    return { eligible: false, reason: "unmatched" };
  }
  if (classification !== "acknowledgment") {
    return { eligible: false, reason: "not_acknowledgment" };
  }
  if (!skipConfidenceCheck) {
    const conf = Number(confidence);
    if (!Number.isFinite(conf) || conf < LOW_CONFIDENCE_THRESHOLD) {
      return { eligible: false, reason: "low_confidence" };
    }
  }

  const fields = resolveCompletionFields(extracted || {}, record || {}, application || null);
  const resolvedAckDate =
    fields.ackDate ||
    (params.messageTimestamp != null ? String(params.messageTimestamp) : null) ||
    null;

  const resolved = {
    ...fields,
    ackDate: resolvedAckDate,
    pm: fields.pm,
    nextAction: fields.nextAction,
  };

  if (!resolved.ticket && !resolved.account) {
    return { eligible: false, reason: "missing_ticket_or_account", fields: resolved };
  }
  if (!resolved.ackDate) {
    return { eligible: false, reason: "missing_acknowledgment_date", fields: resolved };
  }
  if (!isRealUtilityPm(resolved.pm)) {
    return { eligible: false, reason: "missing_utility_pm", fields: resolved };
  }

  return {
    eligible: true,
    reason: null,
    fields: resolved,
  };
}

/**
 * Persist acknowledgment evidence without completing Stage 5 or stopping SLA.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function persistPartialAcknowledgmentEvidence(supabase, params) {
  const {
    coordinationRecordId,
    communicationId = null,
    fields = {},
    reason = "partial_acknowledgment_evidence",
    source = "system",
  } = params;

  const { data: record, error } = await supabase
    .from("coordination_records")
    .select("*")
    .eq("id", coordinationRecordId)
    .maybeSingle();

  if (error || !record) {
    return { persisted: false, reason: error?.message || "record_not_found" };
  }

  // Never overwrite a completed Stage 5
  if (
    Number(record.current_stage) === 5 &&
    String(record.current_stage_state) === "COMPLETED" &&
    record.acknowledgment_received_at
  ) {
    return { persisted: false, reason: "already_completed", coordination_record: record };
  }

  const prevMeta =
    record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
      ? /** @type {Record<string, unknown>} */ (record.metadata)
      : {};
  const priorEvidence =
    prevMeta.stage_5_acknowledgment_evidence &&
    typeof prevMeta.stage_5_acknowledgment_evidence === "object"
      ? /** @type {Record<string, unknown>} */ (prevMeta.stage_5_acknowledgment_evidence)
      : {};

  const patch = {
    metadata: {
      ...prevMeta,
      stage_5_acknowledgment_evidence: {
        ...priorEvidence,
        updated_at: new Date().toISOString(),
        communication_id: communicationId,
        utility_ticket_number: fields.ticket ?? priorEvidence.utility_ticket_number ?? null,
        utility_account_number: fields.account ?? priorEvidence.utility_account_number ?? null,
        utility_project_manager: fields.pm ?? priorEvidence.utility_project_manager ?? null,
        acknowledgment_date: fields.ackDate ?? priorEvidence.acknowledgment_date ?? null,
        next_required_action: fields.nextAction ?? priorEvidence.next_required_action ?? null,
        incomplete_reason: reason,
        source,
        stage_remains: "AWAITING_UTILITY",
        sla_stopped: false,
      },
    },
  };

  // Capture ticket/account when known without marking acknowledgment complete
  if (fields.account) {
    patch.utility_account_number = fields.account;
  }
  if (fields.nextAction) {
    patch.next_required_action = fields.nextAction;
  }

  const { data: updated, error: upErr } = await supabase
    .from("coordination_records")
    .update(patch)
    .eq("id", coordinationRecordId)
    .select("*")
    .single();

  if (upErr) {
    return { persisted: false, reason: upErr.message || "evidence_update_failed" };
  }

  if (fields.ticket) {
    await supabase
      .from("coordination_applications")
      .update({ utility_ticket_number: fields.ticket })
      .eq("coordination_record_id", coordinationRecordId)
      .is("utility_ticket_number", null);
  }

  emitUciEvent(
    "uci.stage5.acknowledgment.evidence_persisted",
    {
      coordination_record_id: coordinationRecordId,
      communication_id: communicationId,
      incomplete_reason: reason,
      stage_state: "AWAITING_UTILITY",
    },
    { supabase },
  );

  return {
    persisted: true,
    coordination_record: updated,
    incomplete_reason: reason,
    stage_state: "AWAITING_UTILITY",
    sla_stopped: false,
  };
}

/**
 * Complete Stage 5 and stop SLA. Idempotent if already completed with ack date.
 * Refuses completion without a real named PM/coordinator.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function completeStage5Acknowledgment(supabase, params) {
  const {
    coordinationRecordId,
    userId = null,
    source = "system",
    communicationId = null,
    fields,
    reason = "Utility acknowledgment confirmed",
  } = params;

  if (!isRealUtilityPm(fields?.pm)) {
    const err = new Error(
      "Stage 5 completion requires a real utility PM/coordinator assignment (placeholders are not allowed)",
    );
    err.statusCode = 409;
    err.code = "MISSING_UTILITY_PM";
    throw err;
  }
  if (!fields?.ticket && !fields?.account) {
    const err = new Error("Stage 5 completion requires a utility ticket or account number");
    err.statusCode = 409;
    err.code = "MISSING_TICKET_OR_ACCOUNT";
    throw err;
  }
  if (!fields?.ackDate) {
    const err = new Error("Stage 5 completion requires an acknowledgment date");
    err.statusCode = 409;
    err.code = "MISSING_ACKNOWLEDGMENT_DATE";
    throw err;
  }

  const { data: record, error } = await supabase
    .from("coordination_records")
    .select("*")
    .eq("id", coordinationRecordId)
    .maybeSingle();

  if (error || !record) {
    const err = new Error(error?.message || "Coordination record not found");
    err.statusCode = error ? 500 : 404;
    err.code = error ? "COORDINATION_FETCH_FAILED" : "NOT_FOUND";
    throw err;
  }

  if (
    Number(record.current_stage) === 5 &&
    String(record.current_stage_state) === "COMPLETED" &&
    record.acknowledgment_received_at
  ) {
    return {
      completed: false,
      already_completed: true,
      coordination_record: record,
      stage_6_started: false,
      can_enter_stage_6: canEnterStage6(record),
    };
  }

  if (Number(record.current_stage) !== 5) {
    const err = new Error("Stage 5 acknowledgment complete requires current_stage=5");
    err.statusCode = 409;
    err.code = "STAGE_5_NOT_ACTIVE";
    throw err;
  }

  const ackAt = fields.ackDate;
  const prevMeta =
    record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
      ? /** @type {Record<string, unknown>} */ (record.metadata)
      : {};

  const { data: updatedFields, error: fieldErr } = await supabase
    .from("coordination_records")
    .update({
      acknowledgment_received_at: ackAt,
      utility_account_number: fields.account || record.utility_account_number,
      utility_project_manager: fields.pm,
      utility_contact_name: fields.pm || record.utility_contact_name,
      next_required_action: fields.nextAction || record.next_required_action,
      metadata: {
        ...prevMeta,
        stage_5_acknowledgment: {
          completed_at: new Date().toISOString(),
          communication_id: communicationId,
          utility_ticket_number: fields.ticket,
          utility_project_manager: fields.pm,
          acknowledgment_date: ackAt,
          next_required_action: fields.nextAction,
          source,
        },
        // Clear pending evidence once fully completed
        stage_5_acknowledgment_evidence: {
          ...(prevMeta.stage_5_acknowledgment_evidence &&
          typeof prevMeta.stage_5_acknowledgment_evidence === "object"
            ? prevMeta.stage_5_acknowledgment_evidence
            : {}),
          resolved_at: new Date().toISOString(),
          resolved: true,
        },
      },
    })
    .eq("id", coordinationRecordId)
    .select("*")
    .single();

  if (fieldErr) {
    throw Object.assign(new Error(fieldErr.message || "Failed to store acknowledgment fields"), {
      cause: fieldErr,
      statusCode: 500,
      code: "ACK_FIELDS_UPDATE_FAILED",
    });
  }

  if (fields.ticket) {
    await supabase
      .from("coordination_applications")
      .update({ utility_ticket_number: fields.ticket })
      .eq("coordination_record_id", coordinationRecordId)
      .is("utility_ticket_number", null);
  }

  const transitionFn = source === "user" && userId ? recordUserTransition : recordSystemTransition;
  const transitionParams =
    source === "user" && userId
      ? {
          coordinationRecordId,
          userId,
          toStage: 5,
          toState: "COMPLETED",
          reason,
          metadata: {
            communication_id: communicationId,
            stage_6_started: false,
            acknowledgment: fields,
          },
        }
      : {
          coordinationRecordId,
          toStage: 5,
          toState: "COMPLETED",
          reason,
          triggeredByType: "system",
          triggeredById: communicationId,
          metadata: {
            communication_id: communicationId,
            stage_6_started: false,
            acknowledgment: fields,
          },
        };

  const { record: completedRecord, transition } = await transitionFn(supabase, transitionParams);

  await stopAcknowledgmentSla(supabase, {
    coordinationRecordId,
    reason: "Valid Stage 5 acknowledgment completed",
  });

  const { data: finalRecord } = await supabase
    .from("coordination_records")
    .select("*")
    .eq("id", coordinationRecordId)
    .maybeSingle();

  emitUciEvent(
    "uci.stage5.acknowledgment.completed",
    {
      coordination_record_id: coordinationRecordId,
      project_id: record.project_id,
      communication_id: communicationId,
      source,
      stage_6_started: false,
      can_enter_stage_6: canEnterStage6(finalRecord || completedRecord),
    },
    { supabase },
  );

  return {
    completed: true,
    already_completed: false,
    coordination_record: finalRecord || completedRecord || updatedFields,
    transition,
    stage_6_started: false,
    can_enter_stage_6: canEnterStage6(finalRecord || completedRecord),
  };
}

/**
 * Attempt auto-complete from a classified communication. Safe no-op when ineligible.
 * PM-less high-confidence acks persist evidence, stay AWAITING_UTILITY, Needs Attention, SLA active.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function maybeAutoCompleteFromCommunication(supabase, params) {
  const { communication } = params;
  if (!communication) {
    return { attempted: false, completed: false, reason: "missing_communication" };
  }

  const meta =
    communication.agent_processed_metadata &&
    typeof communication.agent_processed_metadata === "object" &&
    !Array.isArray(communication.agent_processed_metadata)
      ? /** @type {Record<string, unknown>} */ (communication.agent_processed_metadata)
      : {};

  if (isFlaggedForReview(meta)) {
    return { attempted: true, completed: false, reason: "flagged_for_review" };
  }

  if (!communication.coordination_record_id) {
    return { attempted: true, completed: false, reason: "unmatched" };
  }

  const { data: record } = await supabase
    .from("coordination_records")
    .select("*")
    .eq("id", String(communication.coordination_record_id))
    .maybeSingle();

  if (!record) {
    return { attempted: true, completed: false, reason: "record_not_found" };
  }

  const { data: application } = await supabase
    .from("coordination_applications")
    .select("id, utility_ticket_number")
    .eq("coordination_record_id", String(communication.coordination_record_id))
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const extracted =
    meta.extracted_fields && typeof meta.extracted_fields === "object"
      ? /** @type {Record<string, unknown>} */ (meta.extracted_fields)
      : {};

  const eligibility = evaluateAutoAckEligibility({
    classification: communication.classification,
    confidence: communication.classification_confidence,
    matched: true,
    flagged: false,
    extracted,
    record,
    application,
    messageTimestamp: communication.message_timestamp,
  });

  if (!eligibility.eligible) {
    /** @type {Record<string, unknown> | null} */
    let evidence = null;
    const shouldPersistEvidence =
      communication.classification === "acknowledgment" &&
      (eligibility.reason === "missing_utility_pm" ||
        eligibility.reason === "missing_ticket_or_account" ||
        eligibility.reason === "missing_acknowledgment_date");

    if (shouldPersistEvidence) {
      evidence = await persistPartialAcknowledgmentEvidence(supabase, {
        coordinationRecordId: String(communication.coordination_record_id),
        communicationId: String(communication.id),
        fields: eligibility.fields || {},
        reason: eligibility.reason,
        source: "system",
      });

      // Route to Needs Attention; do not stop SLA
      await supabase
        .from("coordination_communications")
        .update({
          needs_human_attention: true,
          agent_processed_metadata: {
            ...meta,
            extracted_fields: extracted,
            stage_5_incomplete: {
              reason: eligibility.reason,
              at: new Date().toISOString(),
              fields: eligibility.fields || null,
            },
          },
        })
        .eq("id", String(communication.id));
    }

    return {
      attempted: true,
      completed: false,
      reason: eligibility.reason,
      fields: eligibility.fields,
      evidence,
      stage_state: "AWAITING_UTILITY",
      sla_stopped: false,
    };
  }

  const result = await completeStage5Acknowledgment(supabase, {
    coordinationRecordId: String(communication.coordination_record_id),
    source: "system",
    communicationId: String(communication.id),
    fields: eligibility.fields,
    reason: "High-confidence matched acknowledgment auto-completed Stage 5",
  });

  return {
    attempted: true,
    completed: result.completed,
    already_completed: result.already_completed,
    reason: result.completed ? "completed" : "already_completed",
    result,
  };
}

/**
 * Reopen Stage 5 to AWAITING_UTILITY after a prior COMPLETED acknowledgment.
 * Archives prior PM/contact/ack fields into metadata history (non-destructive),
 * clears operational completion fields so stale contact cannot satisfy the next gate,
 * and restarts acknowledgment SLA.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function reopenStage5Acknowledgment(supabase, params) {
  const {
    coordinationRecordId,
    userId = null,
    reason = "Stage 5 acknowledgment reopened for further utility confirmation",
    source = "user",
  } = params;

  const { data: record, error } = await supabase
    .from("coordination_records")
    .select("*")
    .eq("id", coordinationRecordId)
    .maybeSingle();

  if (error || !record) {
    const err = new Error(error?.message || "Coordination record not found");
    err.statusCode = error ? 500 : 404;
    err.code = error ? "COORDINATION_FETCH_FAILED" : "NOT_FOUND";
    throw err;
  }

  if (Number(record.current_stage) !== 5) {
    const err = new Error("Stage 5 reopen requires current_stage=5");
    err.statusCode = 409;
    err.code = "STAGE_5_NOT_ACTIVE";
    throw err;
  }

  const prevMeta =
    record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
      ? /** @type {Record<string, unknown>} */ (record.metadata)
      : {};
  const history = Array.isArray(prevMeta.stage_5_acknowledgment_history)
    ? [...prevMeta.stage_5_acknowledgment_history]
    : [];

  const archived = {
    archived_at: new Date().toISOString(),
    reopened_by: userId,
    reopen_reason: reason,
    source,
    acknowledgment_received_at: record.acknowledgment_received_at ?? null,
    utility_project_manager: record.utility_project_manager ?? null,
    utility_contact_name: record.utility_contact_name ?? null,
    utility_account_number: record.utility_account_number ?? null,
    next_required_action: record.next_required_action ?? null,
    stage_5_acknowledgment: prevMeta.stage_5_acknowledgment ?? null,
    stage_5_acknowledgment_evidence: prevMeta.stage_5_acknowledgment_evidence ?? null,
    prior_stage_state: record.current_stage_state ?? null,
  };
  history.unshift(archived);

  const { data: cleared, error: clearErr } = await supabase
    .from("coordination_records")
    .update({
      acknowledgment_received_at: null,
      // Clear operational PM/contact so reopen cannot inherit stale completion evidence.
      // Historical values remain in stage_5_acknowledgment_history.
      utility_project_manager: null,
      utility_contact_name: null,
      // Leave ack_sla_stopped_at set until startAcknowledgmentSla restarts the timer.
      metadata: {
        ...prevMeta,
        stage_5_acknowledgment_history: history.slice(0, 25),
        stage_5_acknowledgment: null,
        stage_5_reopen: {
          at: archived.archived_at,
          reason,
          source,
          reopened_by: userId,
        },
      },
    })
    .eq("id", coordinationRecordId)
    .select("*")
    .single();

  if (clearErr) {
    throw Object.assign(new Error(clearErr.message || "Failed to archive Stage 5 acknowledgment"), {
      cause: clearErr,
      statusCode: 500,
      code: "STAGE_5_REOPEN_ARCHIVE_FAILED",
    });
  }

  const transitionFn = source === "user" && userId ? recordUserTransition : recordSystemTransition;
  const transitionParams =
    source === "user" && userId
      ? {
          coordinationRecordId,
          userId,
          toStage: 5,
          toState: "AWAITING_UTILITY",
          reason,
          metadata: {
            stage_5_reopen: true,
            archived_acknowledgment: {
              acknowledgment_received_at: archived.acknowledgment_received_at,
              utility_project_manager: archived.utility_project_manager,
              utility_contact_name: archived.utility_contact_name,
            },
          },
        }
      : {
          coordinationRecordId,
          toStage: 5,
          toState: "AWAITING_UTILITY",
          reason,
          triggeredByType: "system",
          triggeredById: null,
          metadata: {
            stage_5_reopen: true,
            archived_acknowledgment: {
              acknowledgment_received_at: archived.acknowledgment_received_at,
              utility_project_manager: archived.utility_project_manager,
              utility_contact_name: archived.utility_contact_name,
            },
          },
        };

  const { record: awaitingRecord, transition } = await transitionFn(supabase, transitionParams);

  const sla = await startAcknowledgmentSla(supabase, {
    coordinationRecordId,
    reason: `Stage 5 reopened — ${reason}`,
  });

  emitUciEvent(
    "uci.stage5.acknowledgment.reopened",
    {
      coordination_record_id: coordinationRecordId,
      project_id: record.project_id,
      source,
      archived_pm: archived.utility_project_manager,
      archived_contact_name: archived.utility_contact_name,
    },
    { supabase },
  );

  const { data: finalRecord } = await supabase
    .from("coordination_records")
    .select("*")
    .eq("id", coordinationRecordId)
    .maybeSingle();

  return {
    reopened: true,
    coordination_record: finalRecord || sla.coordination_record || awaitingRecord || cleared,
    transition,
    sla,
    archived,
    history_length: history.length,
  };
}

module.exports = {
  isFlaggedForReview,
  isRealUtilityPm,
  normalizeUtilityPm,
  resolveCompletionFields,
  evaluateAutoAckEligibility,
  persistPartialAcknowledgmentEvidence,
  completeStage5Acknowledgment,
  maybeAutoCompleteFromCommunication,
  reopenStage5Acknowledgment,
  PM_PLACEHOLDER_PATTERNS,
};
