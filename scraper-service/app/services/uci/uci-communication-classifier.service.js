"use strict";

const {
  UCI_COMMUNICATION_CATEGORIES,
  CLASSIFIER_VERSION,
  isValidCategory,
  classifyCommunicationText,
} = require("./uci-communication-categories.js");
const { emitUciEvent } = require("./uci-events.service.js");

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} communicationId
 */
async function getCommunicationById(supabase, communicationId) {
  const { data, error } = await supabase
    .from("coordination_communications")
    .select("*")
    .eq("id", communicationId)
    .maybeSingle();

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to load communication"), {
      cause: error,
      statusCode: 500,
      code: "COMMUNICATION_FETCH_FAILED",
    });
  }

  return data ?? null;
}

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
  return meta.human_reclassified === true;
}

/**
 * @param {Record<string, unknown>} row
 * @returns {import("./uci-communication-categories.js").classifyCommunicationText extends (...args: never) => infer R ? R : never}
 */
function buildClassificationPatch(row) {
  const result = classifyCommunicationText(
    row.raw_subject != null ? String(row.raw_subject) : null,
    row.raw_body != null ? String(row.raw_body) : null,
  );

  const existingMeta =
    row.agent_processed_metadata &&
    typeof row.agent_processed_metadata === "object" &&
    !Array.isArray(row.agent_processed_metadata)
      ? /** @type {Record<string, unknown>} */ (row.agent_processed_metadata)
      : {};

  return {
    classification: result.classification,
    classification_confidence: result.classification_confidence,
    parsed_summary: result.parsed_summary,
    parsed_action_items: result.parsed_action_items,
    needs_human_attention:
      row.needs_human_attention === true || result.needs_human_attention === true,
    agent_processed_metadata: {
      ...existingMeta,
      agent_5_classification: {
        version: CLASSIFIER_VERSION,
        method: result.classifier_method,
        classified_at: new Date().toISOString(),
        matched_keyword: result.matched_keyword ?? null,
      },
    },
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 * @param {string} params.coordinationRecordId
 * @param {string} params.projectId
 */
async function classifyCoordinationCommunications(supabase, params) {
  const { coordinationRecordId, projectId } = params;

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

    const patch = buildClassificationPatch(row);
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
    emitUciEvent("uci.communication.classified", {
      communication_id: updated.id,
      coordination_record_id: coordinationRecordId,
      classification: patch.classification,
    });
  }

  return {
    coordination_record_id: coordinationRecordId,
    project_id: projectId,
    classified_count: classified.length,
    skipped_count: skipped,
    communications: classified,
    classifier_version: CLASSIFIER_VERSION,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 * @param {string} params.projectId
 * @param {string} [params.coordinationRecordId]
 * @param {number} [params.limit]
 * @param {number} [params.offset]
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
      "needs_human_attention.eq.true,classification.is.null,classification.eq.unclassified,classification_confidence.lt.0.7",
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

  return {
    communications: Array.isArray(data) ? data : [],
    total: count ?? 0,
    limit,
    offset,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 * @param {string} params.communicationId
 * @param {string} params.userId
 * @param {{ classification: string, notes?: string }} params.review
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
        reclassification: {
          classification,
          notes: notes || null,
          reviewed_by_user_id: userId,
          reviewed_at: reviewedAt,
          previous_classification: row.classification ?? null,
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

  emitUciEvent("uci.communication.reclassified", {
    communication_id: communicationId,
    classification,
  });

  return {
    communication: data,
    classification,
    reviewed_at: reviewedAt,
    reviewed_by: userId,
  };
}

module.exports = {
  getCommunicationById,
  isHumanReclassified,
  buildClassificationPatch,
  classifyCoordinationCommunications,
  listNeedsAttentionCommunications,
  reclassifyCommunication,
};
