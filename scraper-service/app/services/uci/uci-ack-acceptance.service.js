"use strict";

/**
 * Stage 5 acknowledgment acceptance — complete Stage 5 when criteria met.
 * Never auto-advances on low confidence, unmatched, flagged-for-review, or classifier failure.
 * Does not start Stage 6.
 */

const { recordSystemTransition, recordUserTransition } = require("./uci-transitions.service.js");
const { stopAcknowledgmentSla } = require("./uci-ack-sla.service.js");
const { canEnterStage6 } = require("./uci-stage5-entry.service.js");
const { LOW_CONFIDENCE_THRESHOLD } = require("./uci-communication-categories.js");
const { emitUciEvent } = require("./uci-events.service.js");

/**
 * @param {Record<string, unknown>} meta
 */
function isFlaggedForReview(meta) {
  return meta?.flagged_for_review === true || meta?.blocks_auto_lifecycle === true;
}

/**
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
  const pm =
    (extracted.utility_project_manager && String(extracted.utility_project_manager).trim()) ||
    (record.utility_project_manager && String(record.utility_project_manager).trim()) ||
    (record.utility_contact_name && String(record.utility_contact_name).trim()) ||
    null;
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
 * Auto-complete eligibility (high-confidence matched acknowledgment).
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
  const conf = Number(confidence);
  if (!Number.isFinite(conf) || conf < LOW_CONFIDENCE_THRESHOLD) {
    return { eligible: false, reason: "low_confidence" };
  }

  const fields = resolveCompletionFields(extracted || {}, record || {}, application || null);
  if (!fields.ticket && !fields.account) {
    return { eligible: false, reason: "missing_ticket_or_account", fields };
  }
  if (!fields.ackDate && !params.messageTimestamp) {
    return { eligible: false, reason: "missing_acknowledgment_date", fields };
  }

  return {
    eligible: true,
    reason: null,
    fields: {
      ...fields,
      ackDate: fields.ackDate || params.messageTimestamp || new Date().toISOString(),
      pm: fields.pm || "Pending utility contact",
      nextAction: fields.nextAction,
    },
  };
}

/**
 * Complete Stage 5 and stop SLA. Idempotent if already completed with ack date.
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

  const ackAt = fields.ackDate || new Date().toISOString();
  const prevMeta =
    record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
      ? /** @type {Record<string, unknown>} */ (record.metadata)
      : {};

  const { data: updatedFields, error: fieldErr } = await supabase
    .from("coordination_records")
    .update({
      acknowledgment_received_at: ackAt,
      utility_account_number: fields.account || record.utility_account_number,
      utility_project_manager: fields.pm || record.utility_project_manager,
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

  // Mirror ticket onto primary application when present
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

  // Re-read after SLA stop
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
    return { attempted: true, completed: false, reason: eligibility.reason, fields: eligibility.fields };
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

module.exports = {
  isFlaggedForReview,
  resolveCompletionFields,
  evaluateAutoAckEligibility,
  completeStage5Acknowledgment,
  maybeAutoCompleteFromCommunication,
};
