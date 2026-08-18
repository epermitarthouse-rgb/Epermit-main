"use strict";

/**
 * Stage 5 human review controls — flag, rematch, reject, confirm, edit extracted fields.
 */

const { isValidCategory, UCI_COMMUNICATION_CATEGORIES } = require("./uci-communication-categories.js");
const {
  completeStage5Acknowledgment,
  resolveCompletionFields,
  isFlaggedForReview,
} = require("./uci-ack-acceptance.service.js");
const { matchInboundToCoordination } = require("./uci-communication-matcher.service.js");
const { emitUciEvent } = require("./uci-events.service.js");
const { getCommunicationById } = require("./uci-communications.service.js");

/**
 * @param {Record<string, unknown>} row
 */
function metaOf(row) {
  return row.agent_processed_metadata &&
    typeof row.agent_processed_metadata === "object" &&
    !Array.isArray(row.agent_processed_metadata)
    ? /** @type {Record<string, unknown>} */ (row.agent_processed_metadata)
    : {};
}

/**
 * Flag any inbound (including high-confidence) for human review.
 * Blocks auto lifecycle; preserves original classification/confidence/match/extracted/rationale.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function flagCommunicationForReview(supabase, params) {
  const { communicationId, userId, note } = params;
  const row = await getCommunicationById(supabase, communicationId);
  if (!row) {
    const err = new Error("Communication not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const existing = metaOf(row);
  const flaggedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("coordination_communications")
    .update({
      needs_human_attention: true,
      agent_processed_metadata: {
        ...existing,
        flagged_for_review: true,
        blocks_auto_lifecycle: true,
        flag_for_review: {
          flagged_at: flaggedAt,
          flagged_by: userId,
          note: note != null ? String(note).trim() || null : null,
          preserved_classification: row.classification ?? null,
          preserved_confidence: row.classification_confidence ?? null,
          preserved_extracted_fields: existing.extracted_fields ?? null,
          preserved_rationale: existing.agent_5_classification?.claude_rationale ?? existing.claude_rationale ?? null,
          preserved_match: existing.match ?? null,
        },
      },
    })
    .eq("id", communicationId)
    .select("*")
    .single();

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to flag communication"), {
      cause: error,
      statusCode: 500,
      code: "FLAG_REVIEW_FAILED",
    });
  }

  emitUciEvent(
    "uci.communication.flagged_for_review",
    {
      communication_id: communicationId,
      coordination_record_id: row.coordination_record_id,
      project_id: row.project_id,
      flagged_by: userId,
    },
    { supabase },
  );

  return { communication: data, flagged: true };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function rejectCommunicationAsIrrelevant(supabase, params) {
  const { communicationId, userId, note } = params;
  const row = await getCommunicationById(supabase, communicationId);
  if (!row) {
    const err = new Error("Communication not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const existing = metaOf(row);
  const reviewedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("coordination_communications")
    .update({
      needs_human_attention: false,
      reviewed_by: userId,
      reviewed_at: reviewedAt,
      agent_processed_metadata: {
        ...existing,
        flagged_for_review: false,
        blocks_auto_lifecycle: true,
        rejected_irrelevant: true,
        review_decision: {
          action: "reject_irrelevant",
          reviewed_by: userId,
          reviewed_at: reviewedAt,
          note: note != null ? String(note).trim() || null : null,
          previous_classification: row.classification ?? null,
          previous_confidence: row.classification_confidence ?? null,
        },
      },
    })
    .eq("id", communicationId)
    .select("*")
    .single();

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to reject communication"), {
      cause: error,
      statusCode: 500,
      code: "REJECT_FAILED",
    });
  }

  emitUciEvent(
    "uci.communication.rejected_irrelevant",
    {
      communication_id: communicationId,
      coordination_record_id: row.coordination_record_id,
      project_id: row.project_id,
    },
    { supabase },
  );

  return { communication: data };
}

/**
 * Rematch / rethread to a coordination record (or re-run matcher).
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function rematchCommunication(supabase, params) {
  const { communicationId, userId, coordinationRecordId, note } = params;
  const row = await getCommunicationById(supabase, communicationId);
  if (!row) {
    const err = new Error("Communication not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  let targetId = coordinationRecordId ? String(coordinationRecordId).trim() : "";
  /** @type {Record<string, unknown> | null} */
  let matchResult = null;

  if (!targetId) {
    matchResult = await matchInboundToCoordination(
      supabase,
      {
        raw_subject: row.raw_subject,
        raw_body: row.raw_body,
        sender: row.sender,
        thread_id: row.thread_id,
        provider_slug: row.provider_slug,
      },
      { projectId: String(row.project_id) },
    );
    if (!matchResult.matched || !matchResult.coordination_record_id) {
      const err = new Error("No confident rematch found — specify coordination_record_id");
      err.statusCode = 409;
      err.code = "REMATCH_AMBIGUOUS";
      err.details = matchResult;
      throw err;
    }
    targetId = String(matchResult.coordination_record_id);
  }

  const { data: target } = await supabase
    .from("coordination_records")
    .select("id, project_id")
    .eq("id", targetId)
    .maybeSingle();

  if (!target) {
    const err = new Error("Target coordination record not found");
    err.statusCode = 404;
    err.code = "TARGET_NOT_FOUND";
    throw err;
  }

  const existing = metaOf(row);
  const reviewedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("coordination_communications")
    .update({
      coordination_record_id: targetId,
      project_id: String(target.project_id),
      needs_human_attention: true,
      reviewed_by: userId,
      reviewed_at: reviewedAt,
      agent_processed_metadata: {
        ...existing,
        match: {
          matched: true,
          method: coordinationRecordId ? "manual_rethread" : "matcher_rethread",
          coordination_record_id: targetId,
          prior_coordination_record_id: row.coordination_record_id,
          match_result: matchResult,
          rematched_by: userId,
          rematched_at: reviewedAt,
          note: note != null ? String(note).trim() || null : null,
        },
      },
    })
    .eq("id", communicationId)
    .select("*")
    .single();

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to rematch communication"), {
      cause: error,
      statusCode: 500,
      code: "REMATCH_FAILED",
    });
  }

  emitUciEvent(
    "uci.communication.rematched",
    {
      communication_id: communicationId,
      coordination_record_id: targetId,
      project_id: target.project_id,
      prior_coordination_record_id: row.coordination_record_id,
    },
    { supabase },
  );

  return { communication: data, match: matchResult };
}

/**
 * Confirm acknowledgment (or confirm classification) and apply lifecycle when appropriate.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function confirmCommunicationReview(supabase, params) {
  const {
    communicationId,
    userId,
    classification,
    extractedFields = {},
    note,
    applyLifecycle = true,
  } = params;

  const row = await getCommunicationById(supabase, communicationId);
  if (!row) {
    const err = new Error("Communication not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const nextClass = classification
    ? String(classification).trim().toLowerCase()
    : String(row.classification || "").trim().toLowerCase();

  if (classification && !isValidCategory(nextClass)) {
    const err = new Error(
      `Invalid classification — must be one of: ${UCI_COMMUNICATION_CATEGORIES.join(", ")}`,
    );
    err.statusCode = 400;
    err.code = "INVALID_CLASSIFICATION";
    throw err;
  }

  const existing = metaOf(row);
  const priorExtracted =
    existing.extracted_fields && typeof existing.extracted_fields === "object"
      ? /** @type {Record<string, unknown>} */ (existing.extracted_fields)
      : {};
  const mergedExtracted = { ...priorExtracted, ...extractedFields };
  const reviewedAt = new Date().toISOString();

  const { data: updated, error } = await supabase
    .from("coordination_communications")
    .update({
      classification: nextClass || row.classification,
      classification_confidence: 1,
      needs_human_attention: nextClass === "unclassified" || nextClass === "escalation_or_problem",
      reviewed_by: userId,
      reviewed_at: reviewedAt,
      parsed_summary: note || row.parsed_summary || `Human confirmed ${nextClass}`,
      agent_processed_metadata: {
        ...existing,
        flagged_for_review: false,
        blocks_auto_lifecycle: false,
        human_confirmed: true,
        extracted_fields: mergedExtracted,
        review_decision: {
          action: "confirm",
          reviewed_by: userId,
          reviewed_at: reviewedAt,
          note: note != null ? String(note).trim() || null : null,
          previous_classification: row.classification ?? null,
          previous_confidence: row.classification_confidence ?? null,
          machine_classification: existing.agent_5_classification ?? null,
        },
      },
    })
    .eq("id", communicationId)
    .select("*")
    .single();

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to confirm communication"), {
      cause: error,
      statusCode: 500,
      code: "CONFIRM_FAILED",
    });
  }

  /** @type {Record<string, unknown> | null} */
  let lifecycle = null;

  if (applyLifecycle && nextClass === "acknowledgment" && updated.coordination_record_id) {
    const { data: record } = await supabase
      .from("coordination_records")
      .select("*")
      .eq("id", String(updated.coordination_record_id))
      .maybeSingle();
    const { data: application } = await supabase
      .from("coordination_applications")
      .select("id, utility_ticket_number")
      .eq("coordination_record_id", String(updated.coordination_record_id))
      .limit(1)
      .maybeSingle();

    const fields = resolveCompletionFields(mergedExtracted, record || {}, application);
    fields.ackDate =
      fields.ackDate ||
      (updated.message_timestamp ? String(updated.message_timestamp) : new Date().toISOString());
    if (!fields.pm) fields.pm = "Pending utility contact";
    if (!fields.nextAction) fields.nextAction = "Monitor for class of service / design review";

    // Human confirm may complete even without ticket if reviewer provided note — still prefer ticket
    if (!fields.ticket && !fields.account && extractedFields.utility_ticket_number) {
      fields.ticket = String(extractedFields.utility_ticket_number);
    }

    lifecycle = await completeStage5Acknowledgment(supabase, {
      coordinationRecordId: String(updated.coordination_record_id),
      userId,
      source: "user",
      communicationId,
      fields: {
        ticket: fields.ticket,
        account: fields.account,
        pm: fields.pm,
        nextAction: fields.nextAction,
        ackDate: fields.ackDate,
      },
      reason: note || "Human confirmed acknowledgment",
    });
  }

  emitUciEvent(
    "uci.communication.confirmed",
    {
      communication_id: communicationId,
      coordination_record_id: updated.coordination_record_id,
      project_id: updated.project_id,
      classification: nextClass,
      lifecycle_applied: Boolean(lifecycle?.completed),
    },
    { supabase },
  );

  return { communication: updated, lifecycle };
}

/**
 * Add a reviewer note without changing classification.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function addCommunicationReviewNote(supabase, params) {
  const { communicationId, userId, note } = params;
  const text = String(note || "").trim();
  if (!text) {
    const err = new Error("note is required");
    err.statusCode = 400;
    err.code = "NOTE_REQUIRED";
    throw err;
  }

  const row = await getCommunicationById(supabase, communicationId);
  if (!row) {
    const err = new Error("Communication not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const existing = metaOf(row);
  const notes = Array.isArray(existing.review_notes) ? [...existing.review_notes] : [];
  const entry = {
    note: text,
    by: userId,
    at: new Date().toISOString(),
  };
  notes.unshift(entry);

  const { data, error } = await supabase
    .from("coordination_communications")
    .update({
      agent_processed_metadata: {
        ...existing,
        review_notes: notes.slice(0, 50),
      },
    })
    .eq("id", communicationId)
    .select("*")
    .single();

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to add note"), {
      cause: error,
      statusCode: 500,
      code: "NOTE_FAILED",
    });
  }

  return { communication: data, note: entry };
}

module.exports = {
  flagCommunicationForReview,
  rejectCommunicationAsIrrelevant,
  rematchCommunication,
  confirmCommunicationReview,
  addCommunicationReviewNote,
  isFlaggedForReview,
};
