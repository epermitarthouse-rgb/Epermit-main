"use strict";

/**
 * Agent 5 classifier orchestration — LLM classifier + keyword fallback, Needs Attention,
 * reclassify, and high-confidence acknowledgment downstream trigger.
 * Provider/model are audit-only; operator UI must not surface provider wording.
 */

const {
  UCI_COMMUNICATION_CATEGORIES,
  CLASSIFIER_VERSION,
  LOW_CONFIDENCE_THRESHOLD,
  isValidCategory,
} = require("./uci-communication-categories.js");
const { classifyWithLlmOrKeyword } = require("./uci-llm-classifier.service.js");
const { emitUciEvent } = require("./uci-events.service.js");
const { getCommunicationById } = require("./uci-communications.service.js");
const {
  maybeAutoCompleteFromCommunication,
  isFlaggedForReview,
} = require("./uci-ack-acceptance.service.js");

/**
 * @param {Record<string, unknown>} row
 */
function isHumanReclassified(row) {
  const meta =
    row.agent_processed_metadata &&
    typeof row.agent_processed_metadata === "object" &&
    !Array.isArray(row.agent_processed_metadata)
      ? /** @type {Record<string, unknown>} */ (row.agent_processed_metadata)
      : {};
  return meta.human_reclassified === true || meta.human_confirmed === true;
}

/**
 * @param {Record<string, unknown>} row
 * @param {Record<string, unknown>} [deps]
 */
async function buildClassificationPatch(row, deps = {}) {
  const result = await classifyWithLlmOrKeyword({
    subject: row.raw_subject != null ? String(row.raw_subject) : null,
    body: row.raw_body != null ? String(row.raw_body) : null,
    deps,
    env: deps.env || process.env,
  });

  const existingMeta =
    row.agent_processed_metadata &&
    typeof row.agent_processed_metadata === "object" &&
    !Array.isArray(row.agent_processed_metadata)
      ? /** @type {Record<string, unknown>} */ (row.agent_processed_metadata)
      : {};

  const flagged = isFlaggedForReview(existingMeta);
  const unmatched = existingMeta.match?.matched === false || existingMeta.unmatched === true;

  const needsHumanAttention =
    flagged ||
    unmatched ||
    row.needs_human_attention === true ||
    result.needs_human_attention === true ||
    result.classification === "unclassified" ||
    Number(result.classification_confidence) < LOW_CONFIDENCE_THRESHOLD;

  return {
    classification: result.classification,
    classification_confidence: result.classification_confidence,
    parsed_summary: result.parsed_summary,
    parsed_action_items: result.parsed_action_items,
    needs_human_attention: needsHumanAttention,
    agent_processed_metadata: {
      ...existingMeta,
      extracted_fields: result.extracted_fields ?? existingMeta.extracted_fields ?? null,
      agent_5_classification: {
        version: CLASSIFIER_VERSION,
        method: result.classifier_method,
        provider: result.llm_provider ?? null,
        model: result.llm_model ?? null,
        classified_at: new Date().toISOString(),
        matched_keyword: result.matched_keyword ?? null,
        llm_rationale: result.llm_rationale ?? null,
        llm_error: result.llm_error ?? null,
        llm_skipped: result.llm_skipped ?? false,
        confidence: result.classification_confidence,
        fallback: result.classifier_method === "keyword" || result.classifier_method === "keyword_fallback",
      },
    },
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 * @param {string} params.coordinationRecordId
 * @param {string} params.projectId
 * @param {Record<string, unknown>} [params.deps]
 */
async function classifyCoordinationCommunications(supabase, params) {
  const { coordinationRecordId, projectId, deps = {} } = params;

  const { data, error } = await supabase
    .from("coordination_communications")
    .select("*")
    .eq("coordination_record_id", coordinationRecordId)
    .eq("project_id", projectId)
    .order("message_timestamp", { ascending: false, nullsFirst: false });

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to load communications"), {
      cause: error,
      statusCode: 500,
      code: "COMMUNICATIONS_FETCH_FAILED",
    });
  }

  const rows = Array.isArray(data) ? data : [];
  /** @type {Array<Record<string, unknown>>} */
  const classified = [];
  /** @type {Array<Record<string, unknown>>} */
  const lifecycleResults = [];
  let skipped = 0;

  for (const row of rows) {
    if (isHumanReclassified(row)) {
      skipped += 1;
      continue;
    }
    if (row.classification && row.classification !== "unclassified") {
      skipped += 1;
      continue;
    }

    const patch = await buildClassificationPatch(row, deps);
    const { data: updated, error: upErr } = await supabase
      .from("coordination_communications")
      .update(patch)
      .eq("id", row.id)
      .select("*")
      .single();

    if (upErr) {
      throw Object.assign(new Error(upErr.message || "Failed to classify communication"), {
        cause: upErr,
        statusCode: 500,
        code: "CLASSIFICATION_UPDATE_FAILED",
      });
    }
    classified.push(updated);
    emitUciEvent(
      "uci.communication.classified",
      {
        communication_id: updated.id,
        coordination_record_id: coordinationRecordId,
        project_id: projectId,
        classification: patch.classification,
        confidence: patch.classification_confidence,
        method: patch.agent_processed_metadata?.agent_5_classification?.method,
      },
      { supabase },
    );

    // Downstream trigger — never on low confidence / flagged / unmatched
    const auto = await maybeAutoCompleteFromCommunication(supabase, {
      communication: updated,
    });
    lifecycleResults.push({ communication_id: updated.id, ...auto });
  }

  return {
    coordination_record_id: coordinationRecordId,
    project_id: projectId,
    classified_count: classified.length,
    skipped_count: skipped,
    communications: classified,
    lifecycle_results: lifecycleResults,
    classifier_version: CLASSIFIER_VERSION,
    confidence_threshold: LOW_CONFIDENCE_THRESHOLD,
  };
}

/**
 * Classify a single communication (used by inbound pipeline).
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function classifySingleCommunication(supabase, params) {
  const { communicationId, deps = {}, force = false } = params;
  const row = await getCommunicationById(supabase, communicationId);
  if (!row) {
    const err = new Error("Communication not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  if (!force && isHumanReclassified(row)) {
    return { communication: row, skipped: true, reason: "human_reclassified" };
  }

  const patch = await buildClassificationPatch(row, deps);
  const { data: updated, error } = await supabase
    .from("coordination_communications")
    .update(patch)
    .eq("id", communicationId)
    .select("*")
    .single();

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to classify communication"), {
      cause: error,
      statusCode: 500,
      code: "CLASSIFICATION_UPDATE_FAILED",
    });
  }

  emitUciEvent(
    "uci.communication.classified",
    {
      communication_id: updated.id,
      coordination_record_id: updated.coordination_record_id,
      project_id: updated.project_id,
      classification: patch.classification,
      confidence: patch.classification_confidence,
    },
    { supabase },
  );

  const lifecycle = await maybeAutoCompleteFromCommunication(supabase, {
    communication: updated,
  });

  return { communication: updated, skipped: false, lifecycle };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function listNeedsAttentionCommunications(supabase, params) {
  const { projectId, coordinationRecordId, limit: rawLimit, offset: rawOffset } = params;
  const limit = Math.min(Math.max(Number(rawLimit) || 25, 1), 100);
  const offset = Math.max(Number(rawOffset) || 0, 0);

  let query = supabase
    .from("coordination_communications")
    .select("*", { count: "exact" })
    .eq("project_id", projectId)
    .or(
      `needs_human_attention.eq.true,classification.is.null,classification.eq.unclassified,classification_confidence.lt.${LOW_CONFIDENCE_THRESHOLD}`,
    )
    .order("message_timestamp", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (coordinationRecordId) {
    query = query.eq("coordination_record_id", coordinationRecordId);
  }

  const { data, error, count } = await query;

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to load needs-attention queue"), {
      cause: error,
      statusCode: 500,
      code: "NEEDS_ATTENTION_FETCH_FAILED",
    });
  }

  // Also surface unmatched inbound for the project
  const { data: unmatched } = await supabase
    .from("uci_unmatched_inbound_messages")
    .select("*")
    .eq("project_id", projectId)
    .eq("match_status", "unmatched")
    .order("created_at", { ascending: false })
    .limit(limit);

  return {
    communications: Array.isArray(data) ? data : [],
    unmatched_inbound: Array.isArray(unmatched) ? unmatched : [],
    total: count ?? 0,
    limit,
    offset,
    confidence_threshold: LOW_CONFIDENCE_THRESHOLD,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function reclassifyCommunication(supabase, params) {
  const { communicationId, userId, review } = params;
  const classification = String(review.classification ?? "").trim().toLowerCase();

  if (!isValidCategory(classification)) {
    const err = new Error(
      `Invalid classification — must be one of: ${UCI_COMMUNICATION_CATEGORIES.join(", ")}`,
    );
    err.statusCode = 400;
    err.code = "INVALID_CLASSIFICATION";
    throw err;
  }

  const row = await getCommunicationById(supabase, communicationId);
  if (!row) {
    const err = new Error("Communication not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const reviewedAt = new Date().toISOString();
  const notes = review.notes != null ? String(review.notes).trim() : "";

  const existingMeta =
    row.agent_processed_metadata &&
    typeof row.agent_processed_metadata === "object" &&
    !Array.isArray(row.agent_processed_metadata)
      ? /** @type {Record<string, unknown>} */ (row.agent_processed_metadata)
      : {};

  const needsHumanAttention =
    classification === "unclassified" || classification === "escalation_or_problem";

  const { data, error } = await supabase
    .from("coordination_communications")
    .update({
      classification,
      classification_confidence: 1,
      needs_human_attention: needsHumanAttention,
      reviewed_by: userId,
      reviewed_at: reviewedAt,
      parsed_summary: notes || `Human reclassified to ${classification}`,
      agent_processed_metadata: {
        ...existingMeta,
        human_reclassified: true,
        flagged_for_review: needsHumanAttention ? existingMeta.flagged_for_review : false,
        blocks_auto_lifecycle: false,
        reclassification: {
          classification,
          notes: notes || null,
          reviewed_by_user_id: userId,
          reviewed_at: reviewedAt,
          previous_classification: row.classification ?? null,
          previous_confidence: row.classification_confidence ?? null,
          machine_classification: existingMeta.agent_5_classification ?? null,
        },
      },
    })
    .eq("id", communicationId)
    .select("*")
    .single();

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to reclassify communication"), {
      cause: error,
      statusCode: 500,
      code: "RECLASSIFY_FAILED",
    });
  }

  emitUciEvent(
    "uci.communication.reclassified",
    {
      communication_id: communicationId,
      coordination_record_id: row.coordination_record_id,
      project_id: row.project_id,
      classification,
      previous_classification: row.classification ?? null,
    },
    { supabase },
  );

  /** @type {Record<string, unknown> | null} */
  let lifecycle = null;
  if (classification === "acknowledgment" && !needsHumanAttention) {
    lifecycle = await maybeAutoCompleteFromCommunication(supabase, {
      communication: {
        ...data,
        classification_confidence: 1,
        agent_processed_metadata: {
          ...data.agent_processed_metadata,
          blocks_auto_lifecycle: false,
          flagged_for_review: false,
        },
      },
    });
  }

  return {
    communication: data,
    classification,
    reviewed_at: reviewedAt,
    reviewed_by: userId,
    lifecycle,
  };
}

module.exports = {
  getCommunicationById,
  isHumanReclassified,
  buildClassificationPatch,
  classifyCoordinationCommunications,
  classifySingleCommunication,
  listNeedsAttentionCommunications,
  reclassifyCommunication,
  LOW_CONFIDENCE_THRESHOLD,
};
