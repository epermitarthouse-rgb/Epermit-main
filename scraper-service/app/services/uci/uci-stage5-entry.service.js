"use strict";

/**
 * Stage 4 → Stage 5 entry from the live transmission path (reconciled send)
 * and shared lifecycle handoff used by legacy confirmed submit.
 *
 * Does NOT start Stage 6.
 */

const {
  advanceLifecycleAfterConfirmedSubmission,
} = require("./uci-application-submit.service.js");
const { startAcknowledgmentSla } = require("./uci-ack-sla.service.js");
const { emitUciEvent } = require("./uci-events.service.js");
const { getApplicationById } = require("./uci-application-builder.service.js");

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 * @param {string} params.coordinationRecordId
 * @param {string} params.userId
 * @param {string} params.submissionMethod
 * @param {string} [params.reasonSuffix]
 * @param {boolean} [params.startSla=true]
 */
async function enterStage5AwaitingUtility(supabase, params) {
  const {
    coordinationRecordId,
    userId,
    submissionMethod,
    reasonSuffix,
    startSla = true,
  } = params;

  const { data: current } = await supabase
    .from("coordination_records")
    .select("id, current_stage, current_stage_state, acknowledgment_received_at")
    .eq("id", coordinationRecordId)
    .maybeSingle();

  if (
    current &&
    Number(current.current_stage) === 5 &&
    current.current_stage_state === "AWAITING_UTILITY"
  ) {
    const sla = startSla
      ? await startAcknowledgmentSla(supabase, {
          coordinationRecordId,
          reason: "Stage 5 already AWAITING_UTILITY — ensure SLA active",
        })
      : { started: false, already_active: true };

    return {
      already_in_stage_5: true,
      coordination_record: current,
      transitions: [],
      sla,
      stage_6_started: false,
    };
  }

  if (
    current &&
    Number(current.current_stage) === 5 &&
    current.current_stage_state === "COMPLETED" &&
    current.acknowledgment_received_at
  ) {
    const err = new Error("Stage 5 already completed — refusing duplicate entry");
    err.statusCode = 409;
    err.code = "STAGE_5_ALREADY_COMPLETED";
    throw err;
  }

  const lifecycle = await advanceLifecycleAfterConfirmedSubmission(supabase, {
    coordinationRecordId,
    userId,
    submissionMethod,
    reasonSuffix,
  });

  const sla = startSla
    ? await startAcknowledgmentSla(supabase, {
        coordinationRecordId,
        reason: "Awaiting utility acknowledgment after confirmed submission",
      })
    : { started: false };

  emitUciEvent(
    "uci.stage5.entered",
    {
      coordination_record_id: coordinationRecordId,
      project_id: lifecycle.coordination_record?.project_id,
      submission_method: submissionMethod,
      stage_6_started: false,
    },
    { supabase },
  );

  return {
    already_in_stage_5: false,
    coordination_record: sla.coordination_record || lifecycle.coordination_record,
    transitions: lifecycle.transitions,
    sla,
    stage_6_started: false,
  };
}

/**
 * After a live Graph transmission is successfully sent, reconcile into Stage 5.
 * Requires transmission attempt status === "sent". Does not call Graph again.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 * @param {string} params.applicationId
 * @param {string} params.userId
 * @param {string} [params.transmissionId]
 * @param {string} [params.preparationId]
 * @param {string} [params.utilityTicketNumber]
 */
async function reconcileLiveTransmissionIntoStage5(supabase, params) {
  const { applicationId, userId, transmissionId, preparationId, utilityTicketNumber } = params;

  const application = await getApplicationById(supabase, applicationId);
  if (!application) {
    const err = new Error("Application not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const coordinationRecordId = String(application.coordination_record_id || "");
  const projectId = String(application.project_id || "");
  if (!coordinationRecordId || !projectId) {
    const err = new Error("Application missing coordination/project linkage");
    err.statusCode = 409;
    err.code = "APPLICATION_LINKAGE_MISSING";
    throw err;
  }

  /** @type {Record<string, unknown> | null} */
  let attempt = null;

  if (transmissionId) {
    const { data, error } = await supabase
      .from("submission_transmission_attempts")
      .select("*")
      .eq("id", transmissionId)
      .eq("application_id", applicationId)
      .maybeSingle();
    if (!error && data) attempt = data;
  }

  if (!attempt && preparationId) {
    const { data, error } = await supabase
      .from("submission_transmission_attempts")
      .select("*")
      .eq("preparation_id", preparationId)
      .eq("application_id", applicationId)
      .eq("status", "sent")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!error && data) attempt = data;
  }

  // JSONB mirror fallback when remote table not applied
  if (!attempt) {
    const meta =
      application.agent_draft_metadata &&
      typeof application.agent_draft_metadata === "object" &&
      !Array.isArray(application.agent_draft_metadata)
        ? /** @type {Record<string, unknown>} */ (application.agent_draft_metadata)
        : {};
    const mirror = meta.submission_transmission_attempt;
    if (mirror && typeof mirror === "object" && !Array.isArray(mirror)) {
      const m = /** @type {Record<string, unknown>} */ (mirror);
      if (String(m.status) === "sent") attempt = m;
    }
  }

  if (!attempt || String(attempt.status) !== "sent") {
    const err = new Error(
      "Live transmission must be status=sent before Stage 5 reconciliation",
    );
    err.statusCode = 409;
    err.code = "TRANSMISSION_NOT_RECONCILED";
    throw err;
  }

  const submittedAt = new Date().toISOString();
  const ticket =
    utilityTicketNumber != null && String(utilityTicketNumber).trim()
      ? String(utilityTicketNumber).trim()
      : application.utility_ticket_number
        ? String(application.utility_ticket_number)
        : null;

  const existingMeta =
    application.agent_draft_metadata &&
    typeof application.agent_draft_metadata === "object" &&
    !Array.isArray(application.agent_draft_metadata)
      ? /** @type {Record<string, unknown>} */ (application.agent_draft_metadata)
      : {};

  if (!application.submitted_at) {
    const { error: appErr } = await supabase
      .from("coordination_applications")
      .update({
        submitted_at: submittedAt,
        submitted_by: userId,
        submission_method: "email",
        utility_ticket_number: ticket,
        agent_draft_metadata: {
          ...existingMeta,
          stage5_reconcile: {
            reconciled_at: submittedAt,
            transmission_id: attempt.id ?? transmissionId ?? null,
            graph_message_id: attempt.graph_message_id ?? null,
            stage_5_advanced: true,
          },
        },
      })
      .eq("id", applicationId);
    if (appErr) {
      throw Object.assign(new Error(appErr.message || "Failed to mark application submitted"), {
        cause: appErr,
        statusCode: 500,
        code: "SUBMIT_MARK_FAILED",
      });
    }
  }

  // Outbound communication audit row (idempotent on graph message / attempt id)
  const outboundKey = `outbound:transmit:${String(attempt.id || attempt.graph_message_id || preparationId || "unknown")}`;
  const { data: existingOutbound } = await supabase
    .from("coordination_communications")
    .select("id")
    .eq("coordination_record_id", coordinationRecordId)
    .eq("idempotency_key", outboundKey)
    .maybeSingle();

  if (!existingOutbound) {
    await supabase.from("coordination_communications").insert({
      coordination_record_id: coordinationRecordId,
      project_id: projectId,
      provider_slug: application.provider_slug ?? null,
      direction: "outbound",
      channel: "email",
      classification: null,
      classification_confidence: null,
      raw_subject: attempt.subject ?? null,
      raw_body: null,
      raw_attachments: [],
      sender: attempt.from ?? null,
      recipient: Array.isArray(attempt.to) ? attempt.to.join(", ") : attempt.to ?? null,
      external_message_id: attempt.graph_message_id ? String(attempt.graph_message_id) : null,
      thread_id: attempt.conversation_id ? String(attempt.conversation_id) : null,
      idempotency_key: outboundKey,
      message_timestamp: attempt.completed_at ?? submittedAt,
      needs_human_attention: false,
      agent_processed_metadata: {
        source: "stage4_live_transmit",
        transmission_id: attempt.id ?? null,
        stage5_handoff: true,
      },
    });
  }

  const entry = await enterStage5AwaitingUtility(supabase, {
    coordinationRecordId,
    userId,
    submissionMethod: "email",
    reasonSuffix: "live Graph transmission reconciled",
    startSla: true,
  });

  if (attempt.id) {
    await supabase
      .from("submission_transmission_attempts")
      .update({
        external_side_effects: {
          ...(attempt.external_side_effects && typeof attempt.external_side_effects === "object"
            ? attempt.external_side_effects
            : {}),
          lifecycle_advanced: true,
          stage_5_advanced: true,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", String(attempt.id))
      .eq("application_id", applicationId);
  }

  emitUciEvent(
    "uci.stage5.live_transmission_reconciled",
    {
      coordination_record_id: coordinationRecordId,
      project_id: projectId,
      application_id: applicationId,
      transmission_id: attempt.id ?? null,
      stage_6_started: false,
    },
    { supabase },
  );

  return {
    ok: true,
    application_id: applicationId,
    transmission_id: attempt.id ?? null,
    submitted_at: application.submitted_at || submittedAt,
    ...entry,
  };
}

/**
 * Guard: Stage 6 must not start from Stage 5 entry alone.
 * @param {Record<string, unknown> | null | undefined} record
 */
function assertStage6NotStartedFromStage5Entry(record) {
  if (!record) return true;
  const stage = Number(record.current_stage);
  if (stage >= 6) {
    const err = new Error("Stage 6 must not start from Stage 5 entry alone");
    err.statusCode = 409;
    err.code = "STAGE_6_PREMATURE";
    throw err;
  }
  return true;
}

/**
 * @param {Record<string, unknown>} record
 */
function canEnterStage6(record) {
  return (
    Number(record.current_stage) === 5 &&
    String(record.current_stage_state) === "COMPLETED" &&
    Boolean(record.acknowledgment_received_at)
  );
}

module.exports = {
  enterStage5AwaitingUtility,
  reconcileLiveTransmissionIntoStage5,
  assertStage6NotStartedFromStage5Entry,
  canEnterStage6,
};
