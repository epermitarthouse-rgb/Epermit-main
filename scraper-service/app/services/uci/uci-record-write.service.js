"use strict";

/**
 * Single write path for Stage 7–10 coordination_records column mutations.
 * (1) writes columns (2) recomputes P50/P90 (3) emits events.
 */

const { emitUciEvent } = require("./uci-events.service.js");
const { recomputePredictedDates } = require("./uci-prediction.service.js");

function asMeta(record) {
  if (record?.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)) {
    return /** @type {Record<string, unknown>} */ (record.metadata);
  }
  return {};
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} coordinationRecordId
 */
async function loadCoordinationRecord(supabase, coordinationRecordId) {
  const { data, error } = await supabase
    .from("coordination_records")
    .select("*")
    .eq("id", coordinationRecordId)
    .maybeSingle();
  if (error) {
    throw Object.assign(new Error(error.message || "Failed to load coordination record"), {
      cause: error,
      statusCode: 500,
      code: "COORDINATION_FETCH_FAILED",
    });
  }
  if (!data) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  return data;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 * @param {string} params.coordinationRecordId
 * @param {Record<string, unknown>} params.fields
 * @param {string} [params.eventName]
 * @param {Record<string, unknown>} [params.eventPayload]
 * @param {Record<string, unknown>} [params.metadataPatch]
 * @param {boolean} [params.skipPrediction]
 */
async function updateCoordinationRecordFields(supabase, params) {
  const {
    coordinationRecordId,
    fields,
    eventName = null,
    eventPayload = {},
    metadataPatch = null,
    skipPrediction = false,
  } = params;

  const current = await loadCoordinationRecord(supabase, coordinationRecordId);
  const projectId = String(current.project_id);
  /** @type {Record<string, unknown>} */
  const patch = { ...fields };
  if (metadataPatch && typeof metadataPatch === "object") {
    patch.metadata = { ...asMeta(current), ...metadataPatch };
  }

  const { data: updated, error } = await supabase
    .from("coordination_records")
    .update(patch)
    .eq("id", coordinationRecordId)
    .eq("project_id", projectId)
    .select("*")
    .single();

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to update coordination record"), {
      cause: error,
      statusCode: 500,
      code: "COORDINATION_UPDATE_FAILED",
    });
  }

  let record = updated;
  if (!skipPrediction) {
    try {
      const predicted = await recomputePredictedDates(supabase, { record: updated });
      if (predicted.record) record = predicted.record;
    } catch {
      record = updated;
    }
  }

  if (eventName) {
    emitUciEvent(
      eventName,
      {
        coordination_record_id: coordinationRecordId,
        project_id: projectId,
        ...eventPayload,
      },
      { supabase },
    );
  }

  return { record, previous: current };
}

/**
 * Recompute P50/P90 after any coordination_records mutation.
 * Safe no-op when record is missing; never throws to callers.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {Record<string, unknown> | null | undefined} record
 * @returns {Promise<Record<string, unknown> | null | undefined>}
 */
async function afterCoordinationRecordWrite(supabase, record) {
  if (!record?.id) return record;
  try {
    const predicted = await recomputePredictedDates(supabase, { record });
    if (predicted.computed && predicted.record) return predicted.record;
    return record;
  } catch {
    return record;
  }
}

/**
 * Backfill P50/P90 when a record was written before prediction hooks existed.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {Record<string, unknown> | null | undefined} record
 * @returns {Promise<Record<string, unknown> | null | undefined>}
 */
async function ensureCoordinationRecordPredictions(supabase, record) {
  if (!record?.id || record.predicted_p50_date) return record;
  return afterCoordinationRecordWrite(supabase, record);
}

module.exports = {
  loadCoordinationRecord,
  updateCoordinationRecordFields,
  afterCoordinationRecordWrite,
  ensureCoordinationRecordPredictions,
};
