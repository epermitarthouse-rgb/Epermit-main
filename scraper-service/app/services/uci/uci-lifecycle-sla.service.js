"use strict";

/**
 * Stage 7–10 SLA ticker — pattern from uci-cos-sla.service.js.
 * CIAC 14-business-day unpaid invoice while AWAITING_UTILITY.
 */

const { evaluateCiacSla } = require("./uci-cost-tracker.service.js");

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {{ limit?: number, now?: Date }} [opts]
 */
async function sweepLifecycleSlas(supabase, opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
  const now = opts.now || new Date();
  const { data, error } = await supabase
    .from("coordination_records")
    .select("id")
    .eq("current_stage", 7)
    .eq("current_stage_state", "AWAITING_UTILITY")
    .limit(limit);

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to list lifecycle SLAs"), {
      statusCode: 500,
      code: "LIFECYCLE_SLA_SWEEP_FAILED",
    });
  }

  const rows = Array.isArray(data) ? data : [];
  /** @type {Array<Record<string, unknown>>} */
  const results = [];
  for (const row of rows) {
    results.push(await evaluateCiacSla(supabase, String(row.id), now));
  }
  return { evaluated: results.length, results };
}

module.exports = {
  sweepLifecycleSlas,
};
