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
const { resolveTrustedEmailFromCommunication } = require("./uci-utility-contact-resolve.util.js");
const { emitUciEvent } = require("./uci-events.service.js");

async function withPredictionRecompute(supabase, record) {
  const { afterCoordinationRecordWrite } = require("./uci-record-write.service.js");
  return afterCoordinationRecordWrite(supabase, record);
}

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
 * @param {Record<string, unknown>} meta
 */
function extractCommunicationFields(meta) {
  const base =
    meta?.extracted_fields && typeof meta.extracted_fields === "object"
      ? /** @type {Record<string, unknown>} */ (meta.extracted_fields)
      : {};
  const review =
    meta?.review_decision && typeof meta.review_decision === "object"
      ? /** @type {Record<string, unknown>} */ (meta.review_decision)
      : {};
  const merged = asRecord(review.merged_extracted_fields);
  const reviewer = asRecord(review.reviewer_extracted_fields);
  return { ...base, ...reviewer, ...merged };
}

/**
 * @param {unknown} value
 */
function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

/**
 * Graph thread ids share a mailbox conversation prefix before the final segment.
 * @param {unknown} threadId
 */
function normalizeGraphThreadRoot(threadId) {
  const s = String(threadId ?? "").trim();
  if (!s) return null;
  const idx = s.lastIndexOf("AQA");
  if (idx > 0) return s.slice(0, idx);
  return s;
}

/**
 * PM and related fields from later inbound messages on the same coordination record.
 * Prefers same Graph thread root; falls back to any later inbound on the record.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function loadCoordinationSupplementalFields(supabase, params) {
  const {
    coordinationRecordId,
    anchorCommunicationId = null,
    anchorTimestamp = null,
    threadId = null,
  } = params;

  const anchorMs = anchorTimestamp ? new Date(String(anchorTimestamp)).getTime() : 0;
  const threadRoot = normalizeGraphThreadRoot(threadId);

  const { data: rows, error } = await supabase
    .from("coordination_communications")
    .select(
      "id, message_timestamp, thread_id, classification, direction, needs_human_attention, agent_processed_metadata",
    )
    .eq("coordination_record_id", coordinationRecordId)
    .order("message_timestamp", { ascending: true });

  if (error || !Array.isArray(rows)) {
    return {};
  }

  /** @type {Record<string, unknown>} */
  const supplemental = {};

  for (const row of rows) {
    if (String(row.direction || "inbound").toLowerCase() === "outbound") continue;
    if (anchorCommunicationId && String(row.id) === String(anchorCommunicationId)) continue;
    const meta = asRecord(row.agent_processed_metadata);
    if (meta.rejected_irrelevant === true) continue;

    const rowMs = row.message_timestamp ? new Date(String(row.message_timestamp)).getTime() : 0;
    const sameThread =
      threadRoot != null &&
      normalizeGraphThreadRoot(row.thread_id) != null &&
      normalizeGraphThreadRoot(row.thread_id) === threadRoot;
    const isLater = !anchorMs || !Number.isFinite(rowMs) || rowMs >= anchorMs - 60_000;
    if (!sameThread && anchorMs && Number.isFinite(rowMs) && rowMs < anchorMs - 60_000) {
      continue;
    }
    if (!sameThread && !isLater) continue;

    const extracted = extractCommunicationFields(meta);
    if (!supplemental.utility_project_manager && isRealUtilityPm(extracted.utility_project_manager)) {
      supplemental.utility_project_manager = normalizeUtilityPm(extracted.utility_project_manager);
      supplemental.pm_source_communication_id = row.id;
      supplemental.pm_source_classification = row.classification ?? null;
      supplemental.pm_same_thread = sameThread;
    }
    if (
      !supplemental.utility_ticket_number &&
      extracted.utility_ticket_number &&
      String(extracted.utility_ticket_number).trim()
    ) {
      supplemental.utility_ticket_number = String(extracted.utility_ticket_number).trim();
    }
    if (
      !supplemental.utility_account_number &&
      extracted.utility_account_number &&
      String(extracted.utility_account_number).trim()
    ) {
      supplemental.utility_account_number = String(extracted.utility_account_number).trim();
    }
  }

  return supplemental;
}

/**
 * Resolve fields for Stage 5 completion.
 * PM/coordinator must come from **current** acknowledgment evidence, reviewer
 * extracted fields, or supplemental thread/coordination evidence — never from stale
 * coordination-level `utility_project_manager` / `utility_contact_name`.
 *
 * @param {Record<string, unknown>} extracted
 * @param {Record<string, unknown>} record
 * @param {Record<string, unknown> | null} application
 * @param {Record<string, unknown>} [supplementalExtracted]
 */
function resolveCompletionFields(extracted, record, application, supplementalExtracted = {}) {
  const ticket =
    (extracted.utility_ticket_number && String(extracted.utility_ticket_number).trim()) ||
    (supplementalExtracted.utility_ticket_number &&
      String(supplementalExtracted.utility_ticket_number).trim()) ||
    (application?.utility_ticket_number && String(application.utility_ticket_number).trim()) ||
    null;
  const account =
    (extracted.utility_account_number && String(extracted.utility_account_number).trim()) ||
    (supplementalExtracted.utility_account_number &&
      String(supplementalExtracted.utility_account_number).trim()) ||
    (record.utility_account_number && String(record.utility_account_number).trim()) ||
    null;
  const pm =
    normalizeUtilityPm(extracted.utility_project_manager) ||
    normalizeUtilityPm(supplementalExtracted.utility_project_manager);
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
    supplementalExtracted = {},
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

  const fields = resolveCompletionFields(
    extracted || {},
    record || {},
    application || null,
    supplementalExtracted || {},
  );
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

  const withPredictions = await withPredictionRecompute(supabase, updated);

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
    coordination_record: withPredictions,
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
    const stage6 = await advanceToStage6AfterStage5Complete(supabase, {
      coordinationRecordId,
      communicationId,
      userId,
    });
    return {
      completed: false,
      already_completed: true,
      coordination_record: record,
      stage_6_started: Boolean(stage6?.entered),
      stage_6: stage6,
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

  let trustedContactEmail = null;
  if (communicationId) {
    const { data: ackComm } = await supabase
      .from("coordination_communications")
      .select("id, direction, sender, raw_body, agent_processed_metadata")
      .eq("id", communicationId)
      .maybeSingle();
    trustedContactEmail = resolveTrustedEmailFromCommunication(ackComm);
  }

  const stage5Meta = {
    completed_at: new Date().toISOString(),
    communication_id: communicationId,
    utility_ticket_number: fields.ticket,
    utility_project_manager: fields.pm,
    acknowledgment_date: ackAt,
    next_required_action: fields.nextAction,
    source,
  };
  if (trustedContactEmail) {
    stage5Meta.utility_contact_email = trustedContactEmail;
  }

  const recordUpdate = {
    acknowledgment_received_at: ackAt,
    utility_account_number: fields.account || record.utility_account_number,
    utility_project_manager: fields.pm,
    utility_contact_name: fields.pm || record.utility_contact_name,
    next_required_action: fields.nextAction || record.next_required_action,
    metadata: {
      ...prevMeta,
      stage_5_acknowledgment: stage5Meta,
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
  };
  if (trustedContactEmail && !record.utility_contact_email) {
    recordUpdate.utility_contact_email = trustedContactEmail;
  }

  const { data: updatedFields, error: fieldErr } = await supabase
    .from("coordination_records")
    .update(recordUpdate)
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

  const stage6 = await advanceToStage6AfterStage5Complete(supabase, {
    coordinationRecordId,
    communicationId,
    userId,
  });

  const resolvedRecord = stage6?.coordination_record || finalRecord || completedRecord || updatedFields;

  emitUciEvent(
    "uci.stage5.acknowledgment.completed",
    {
      coordination_record_id: coordinationRecordId,
      project_id: record.project_id,
      communication_id: communicationId,
      source,
      stage_6_started: Boolean(stage6?.entered),
      can_enter_stage_6: canEnterStage6(resolvedRecord),
    },
    { supabase },
  );

  return {
    completed: true,
    already_completed: false,
    coordination_record: resolvedRecord,
    transition,
    stage_6_started: Boolean(stage6?.entered),
    stage_6: stage6,
    can_enter_stage_6: canEnterStage6(resolvedRecord),
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

  const supplemental = await loadCoordinationSupplementalFields(supabase, {
    coordinationRecordId: String(communication.coordination_record_id),
    anchorCommunicationId: String(communication.id),
    anchorTimestamp: communication.message_timestamp,
    threadId: communication.thread_id,
  });

  const eligibility = evaluateAutoAckEligibility({
    classification: communication.classification,
    confidence: communication.classification_confidence,
    matched: true,
    flagged: false,
    extracted,
    supplementalExtracted: supplemental,
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

/**
 * Clear Needs Attention on communications resolved by Stage 5 completion.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string[]} communicationIds
 */
async function clearStage5ResolvedCommunications(supabase, communicationIds) {
  const ids = [...new Set(communicationIds.map((id) => String(id || "").trim()).filter(Boolean))];
  for (const id of ids) {
    const { data: row } = await supabase
      .from("coordination_communications")
      .select("agent_processed_metadata")
      .eq("id", id)
      .maybeSingle();
    if (!row) continue;
    const existing = asRecord(row.agent_processed_metadata);
    await supabase
      .from("coordination_communications")
      .update({
        needs_human_attention: false,
        agent_processed_metadata: {
          ...existing,
          stage_5_incomplete: null,
          stage_5_resolved: {
            at: new Date().toISOString(),
            via: "stage_5_reconcile",
          },
        },
      })
      .eq("id", id);
  }
}

/**
 * Enter Stage 6 IN_PROGRESS after Stage 5 completion when eligible.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function advanceToStage6AfterStage5Complete(supabase, params) {
  const {
    coordinationRecordId,
    communicationId = null,
    userId = null,
    reason = "Stage 5 acknowledgment completed — Class of Service / Design Review",
  } = params;

  const { enterStage6 } = require("./uci-stage6-entry.service.js");
  try {
    return await enterStage6(supabase, {
      coordinationRecordId,
      reason,
      triggeredByType: userId ? "user" : "system",
      triggeredById: communicationId,
      initialState: "IN_PROGRESS",
      metadata: {
        stage_5_completion_communication_id: communicationId,
      },
    });
  } catch (err) {
    if (err && /** @type {{ code?: string }} */ (err).code === "STAGE_6_NOT_ELIGIBLE") {
      return { entered: false, reason: "stage_6_not_eligible", error: err.message };
    }
    throw err;
  }
}

/**
 * Reconcile Stage 5 completion using acknowledgment anchor + supplemental thread evidence.
 * Idempotent when Stage 5 already completed; still attempts Stage 6 entry when eligible.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function reconcileStage5FromCoordinationEvidence(supabase, params) {
  const {
    coordinationRecordId,
    triggerCommunicationId = null,
    userId = null,
    source = "system",
    advanceStage6 = true,
  } = params;

  const { data: record, error } = await supabase
    .from("coordination_records")
    .select("*")
    .eq("id", coordinationRecordId)
    .maybeSingle();

  if (error || !record) {
    return { reconciled: false, reason: error?.message || "record_not_found" };
  }

  if (Number(record.current_stage) !== 5) {
    return { reconciled: false, reason: "stage_5_not_active", coordination_record: record };
  }

  if (
    String(record.current_stage_state) === "COMPLETED" &&
    record.acknowledgment_received_at
  ) {
    const stage6 = advanceStage6
      ? await advanceToStage6AfterStage5Complete(supabase, {
          coordinationRecordId,
          communicationId: triggerCommunicationId,
          userId,
        })
      : null;
    return {
      reconciled: false,
      already_completed: true,
      completed: false,
      coordination_record: record,
      stage_6: stage6,
      can_enter_stage_6: canEnterStage6(record),
    };
  }

  const { data: comms } = await supabase
    .from("coordination_communications")
    .select("*")
    .eq("coordination_record_id", coordinationRecordId)
    .order("message_timestamp", { ascending: false });

  /** @type {Record<string, unknown> | null} */
  let anchor = null;
  for (const row of Array.isArray(comms) ? comms : []) {
    if (String(row.direction || "inbound").toLowerCase() === "outbound") continue;
    const meta = asRecord(row.agent_processed_metadata);
    if (String(row.classification) === "acknowledgment" && meta.human_confirmed === true) {
      anchor = row;
      break;
    }
  }
  if (!anchor) {
    for (const row of Array.isArray(comms) ? comms : []) {
      if (String(row.classification) === "acknowledgment") {
        anchor = row;
        break;
      }
    }
  }
  if (!anchor) {
    return { reconciled: false, reason: "no_acknowledgment_anchor", coordination_record: record };
  }

  const anchorMeta = asRecord(anchor.agent_processed_metadata);
  const anchorExtracted = extractCommunicationFields(anchorMeta);
  const supplemental = await loadCoordinationSupplementalFields(supabase, {
    coordinationRecordId,
    anchorCommunicationId: String(anchor.id),
    anchorTimestamp: anchor.message_timestamp,
    threadId: anchor.thread_id,
  });

  const { data: application } = await supabase
    .from("coordination_applications")
    .select("id, utility_ticket_number")
    .eq("coordination_record_id", coordinationRecordId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const eligibility = evaluateAutoAckEligibility({
    classification: "acknowledgment",
    confidence: anchor.classification_confidence,
    matched: true,
    flagged: isFlaggedForReview(anchorMeta),
    extracted: anchorExtracted,
    supplementalExtracted: supplemental,
    record,
    application,
    messageTimestamp: anchor.message_timestamp,
    skipConfidenceCheck: anchorMeta.human_confirmed === true,
  });

  if (!eligibility.eligible) {
    return {
      reconciled: false,
      reason: eligibility.reason,
      fields: eligibility.fields,
      supplemental,
      coordination_record: record,
      anchor_communication_id: anchor.id,
    };
  }

  const completion = await completeStage5Acknowledgment(supabase, {
    coordinationRecordId,
    userId,
    source: userId ? "user" : source,
    communicationId: String(anchor.id),
    fields: eligibility.fields,
    reason: triggerCommunicationId
      ? "Stage 5 reconciled after supplemental thread evidence"
      : "Stage 5 reconciled from coordination thread evidence",
  });

  const resolvedIds = [
    String(anchor.id),
    triggerCommunicationId ? String(triggerCommunicationId) : null,
    supplemental.pm_source_communication_id
      ? String(supplemental.pm_source_communication_id)
      : null,
  ].filter(Boolean);

  await clearStage5ResolvedCommunications(supabase, resolvedIds);

  const stage6 =
    advanceStage6 && (completion.completed || completion.already_completed)
      ? await advanceToStage6AfterStage5Complete(supabase, {
          coordinationRecordId,
          communicationId: triggerCommunicationId || String(anchor.id),
          userId,
        })
      : null;

  emitUciEvent(
    "uci.stage5.reconciled",
    {
      coordination_record_id: coordinationRecordId,
      anchor_communication_id: anchor.id,
      trigger_communication_id: triggerCommunicationId,
      pm_source_communication_id: supplemental.pm_source_communication_id ?? null,
      stage_6_entered: Boolean(stage6?.entered || stage6?.already_in_stage_6),
    },
    { supabase },
  );

  return {
    reconciled: true,
    completed: completion.completed,
    already_completed: completion.already_completed,
    coordination_record: completion.coordination_record,
    fields: eligibility.fields,
    supplemental,
    anchor_communication_id: anchor.id,
    stage_6: stage6,
    can_enter_stage_6: canEnterStage6(completion.coordination_record),
  };
}

module.exports = {
  isFlaggedForReview,
  isRealUtilityPm,
  normalizeUtilityPm,
  extractCommunicationFields,
  normalizeGraphThreadRoot,
  loadCoordinationSupplementalFields,
  resolveCompletionFields,
  evaluateAutoAckEligibility,
  persistPartialAcknowledgmentEvidence,
  completeStage5Acknowledgment,
  maybeAutoCompleteFromCommunication,
  reopenStage5Acknowledgment,
  clearStage5ResolvedCommunications,
  advanceToStage6AfterStage5Complete,
  reconcileStage5FromCoordinationEvidence,
  PM_PLACEHOLDER_PATTERNS,
};
