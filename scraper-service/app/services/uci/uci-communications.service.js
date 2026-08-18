"use strict";

const { sanitizeApplicationRowsForApi } = require("./uci-sync-utils.js");

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
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} coordinationRecordId
 * @param {string} projectId
 * @param {{ limit?: number, offset?: number }} [pagination]
 * @returns {Promise<{ communications: Array<Record<string, unknown>>, total: number, limit: number, offset: number }>}
 */
async function listCommunicationsByCoordination(
  supabase,
  coordinationRecordId,
  projectId,
  pagination = {},
) {
  const limit = Math.min(Math.max(Number(pagination.limit) || 25, 1), 100);
  const offset = Math.max(Number(pagination.offset) || 0, 0);

  const { count, error: countErr } = await supabase
    .from("coordination_communications")
    .select("id", { count: "exact", head: true })
    .eq("coordination_record_id", coordinationRecordId)
    .eq("project_id", projectId);

  if (countErr) {
    throw Object.assign(new Error(countErr.message || "Failed to count communications"), {
      cause: countErr,
      statusCode: 500,
      code: "COMMUNICATIONS_COUNT_FAILED",
    });
  }

  const { data, error } = await supabase
    .from("coordination_communications")
    .select("*")
    .eq("coordination_record_id", coordinationRecordId)
    .eq("project_id", projectId)
    .order("message_timestamp", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to load communications"), {
      cause: error,
      statusCode: 500,
      code: "COMMUNICATIONS_FETCH_FAILED",
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
 * @param {string} coordinationRecordId
 * @param {string} projectId
 * @param {{ limit?: number, offset?: number }} [pagination]
 * @returns {Promise<{ milestones: Array<Record<string, unknown>>, total: number, limit: number, offset: number }>}
 */
async function listMilestonesByCoordination(
  supabase,
  coordinationRecordId,
  projectId,
  pagination = {},
) {
  const limit = Math.min(Math.max(Number(pagination.limit) || 25, 1), 100);
  const offset = Math.max(Number(pagination.offset) || 0, 0);

  const { count, error: countErr } = await supabase
    .from("coordination_milestones")
    .select("id", { count: "exact", head: true })
    .eq("coordination_record_id", coordinationRecordId)
    .eq("project_id", projectId);

  if (countErr) {
    throw Object.assign(new Error(countErr.message || "Failed to count milestones"), {
      cause: countErr,
      statusCode: 500,
      code: "MILESTONES_COUNT_FAILED",
    });
  }

  const { data, error } = await supabase
    .from("coordination_milestones")
    .select("*")
    .eq("coordination_record_id", coordinationRecordId)
    .eq("project_id", projectId)
    .order("occurred_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to load milestones"), {
      cause: error,
      statusCode: 500,
      code: "MILESTONES_FETCH_FAILED",
    });
  }

  return {
    milestones: Array.isArray(data) ? data : [],
    total: count ?? 0,
    limit,
    offset,
  };
}

module.exports = {
  getCommunicationById,
  listCommunicationsByCoordination,
  listMilestonesByCoordination,
  sanitizeApplicationRowsForApi,
};
