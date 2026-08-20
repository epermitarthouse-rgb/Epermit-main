"use strict";

/**
 * P50 / P90 recomputation — called from every coordination record write.
 * remaining_days = baseline(utility_type, ownership_type, current_stage→10)
 *   + current_stage_elapsed_business_days
 * P50 = today + remaining_days
 * P90 = today + remaining_days * 1.4
 * P50 slip >7 days vs predicted_p50_previous → P2
 */

const { addBusinessDays } = require("./uci-ack-sla.service.js");
const { emitUciEvent } = require("./uci-events.service.js");
const {
  FALLBACK_BASELINE_DAYS,
  P50_SLIP_ALERT_DAYS,
  P90_MULTIPLIER,
  UCI_LIFECYCLE_EVENTS,
} = require("./uci-lifecycle-constants.js");

/**
 * @param {Date} from
 * @param {Date} to
 */
function businessDaysBetween(from, to) {
  const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  if (end.getTime() <= start.getTime()) return 0;
  let days = 0;
  const cursor = new Date(start.getTime());
  while (cursor.getTime() < end.getTime()) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) days += 1;
  }
  return days;
}

/**
 * Calendar-day difference (signed) between two date-only values.
 * @param {string | Date} later
 * @param {string | Date} earlier
 */
function calendarDaysAfter(later, earlier) {
  const a = new Date(later);
  const b = new Date(earlier);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  const aUtc = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const bUtc = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.round((aUtc - bUtc) / 86400000);
}

function toDateOnly(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function fallbackBaseline(stage) {
  const key = Number(stage);
  if (FALLBACK_BASELINE_DAYS[key] != null) return FALLBACK_BASELINE_DAYS[key];
  return FALLBACK_BASELINE_DAYS[1];
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {Record<string, unknown>} record
 */
async function loadBaselineBusinessDays(supabase, record) {
  const stage = Number(record.current_stage);
  const utilityType = String(record.utility_type || "electric").toLowerCase();
  let ownershipType = "unknown";
  if (record.utility_provider_id && supabase) {
    const { data: provider } = await supabase
      .from("utility_providers")
      .select("ownership_type, utility_type")
      .eq("id", record.utility_provider_id)
      .maybeSingle();
    if (provider?.ownership_type) ownershipType = String(provider.ownership_type).toLowerCase();
  }
  if (record.ownership_type) ownershipType = String(record.ownership_type).toLowerCase();

  const codeFallback = {
    days: fallbackBaseline(stage),
    source: "code_fallback",
    sample_size: 0,
    reason: {
      kind: "code_fallback",
      note: "In-code default remaining-days table. Not historical provider duration data.",
      masquerades_as_historical: false,
      utility_type: utilityType,
      ownership_type: ownershipType,
      from_stage: stage,
    },
  };

  if (!supabase) return codeFallback;

  try {
    const { data } = await supabase
      .from("utility_stage_duration_baselines")
      .select("p50_business_days, source")
      .eq("utility_type", utilityType)
      .eq("ownership_type", ownershipType)
      .eq("from_stage", stage)
      .maybeSingle();

    const days = Number(data?.p50_business_days);
    const rowSource = String(data?.source || "").trim();
    if (Number.isFinite(days) && days >= 0 && data) {
      const source =
        rowSource === "historical"
          ? "historical"
          : rowSource === "operator_override"
            ? "operator_override"
            : "seed_fallback";
      return {
        days,
        source,
        sample_size: source === "historical" ? 1 : 0,
        reason: {
          kind: source,
          note:
            source === "historical"
              ? "Looked up from historical utility-type / ownership-type durations."
              : source === "operator_override"
                ? "Operator-overridden baseline. Not historical provider duration data."
                : "Seeded fallback baseline. Not historical provider duration data.",
          table: "utility_stage_duration_baselines",
          table_source: rowSource || "seed_fallback",
          masquerades_as_historical: false,
          utility_type: utilityType,
          ownership_type: ownershipType,
          from_stage: stage,
        },
      };
    }
  } catch {
    // Seeded fallbacks keep Stage 1–6 writes working when the baseline table is absent.
  }

  return codeFallback;
}

function stageEnteredAt(record, now) {
  if (record.current_stage_entered_at) return new Date(String(record.current_stage_entered_at));
  const meta =
    record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
      ? /** @type {Record<string, unknown>} */ (record.metadata)
      : {};
  if (meta.current_stage_entered_at) return new Date(String(meta.current_stage_entered_at));
  if (record.updated_at) return new Date(String(record.updated_at));
  return now;
}

/**
 * Pure formula used by tests and persist path.
 *
 * @param {{
 *   today?: Date,
 *   baselineBusinessDays: number,
 *   stageElapsedBusinessDays: number,
 * }} params
 */
function computePredictedDates(params) {
  const today = params.today || new Date();
  const remaining = Math.max(
    0,
    Number(params.baselineBusinessDays || 0) + Number(params.stageElapsedBusinessDays || 0),
  );
  const p50 = addBusinessDays(today, remaining);
  const p90Days = Math.ceil(remaining * P90_MULTIPLIER);
  const p90 = addBusinessDays(today, p90Days);
  return {
    remaining_days: remaining,
    p90_days: p90Days,
    predicted_p50_date: toDateOnly(p50),
    predicted_p90_date: toDateOnly(p90),
    typical_label: "Typical (P50)",
    conservative_label: "Conservative (P90)",
  };
}

/**
 * Recompute and persist P50/P90 on the coordination record.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 * @param {Record<string, unknown>} params.record
 * @param {Date} [params.now]
 * @param {boolean} [params.persist]
 */
async function recomputePredictedDates(supabase, params) {
  const record = params.record;
  const now = params.now || new Date();
  const persist = params.persist !== false;
  if (!record?.id) {
    return { computed: false, reason: "no_record" };
  }

  try {
  const baseline = await loadBaselineBusinessDays(supabase, record);
  const baselineDays = typeof baseline === "object" ? Number(baseline.days) : Number(baseline);
  const baselineSource = typeof baseline === "object" ? String(baseline.source) : "code_fallback";
  const baselineReason = typeof baseline === "object" ? baseline.reason : { kind: "code_fallback" };
  const sampleSize = typeof baseline === "object" ? Number(baseline.sample_size || 0) : 0;
  const enteredAt = stageEnteredAt(record, now);
  const elapsed = businessDaysBetween(enteredAt, now);
  const computed = computePredictedDates({
    today: now,
    baselineBusinessDays: baselineDays,
    stageElapsedBusinessDays: elapsed,
  });

  const previousP50 = record.predicted_p50_date ? String(record.predicted_p50_date).slice(0, 10) : null;
  const slipDays =
    previousP50 && computed.predicted_p50_date
      ? calendarDaysAfter(computed.predicted_p50_date, previousP50)
      : 0;
  const p50Slipped = slipDays > P50_SLIP_ALERT_DAYS;

  const patch = {
    predicted_p50_date: computed.predicted_p50_date,
    predicted_p90_date: computed.predicted_p90_date,
    predicted_p50_previous: previousP50,
    predicted_p50_computed_at: now.toISOString(),
    prediction_baseline_source: baselineSource,
    prediction_sample_size: sampleSize,
    prediction_reason: {
      ...baselineReason,
      remaining_days: computed.remaining_days,
      stage_elapsed_business_days: elapsed,
      p90_multiplier: P90_MULTIPLIER,
      masquerades_as_historical: false,
    },
  };

  /** @type {Record<string, unknown>} */
  let updated = { ...record, ...patch };
  if (persist && supabase) {
    const { data, error } = await supabase
      .from("coordination_records")
      .update(patch)
      .eq("id", String(record.id))
      .select("*")
      .single();
    if (error) {
      throw Object.assign(new Error(error.message || "Failed to persist predicted dates"), {
        cause: error,
        code: "PREDICTION_PERSIST_FAILED",
      });
    }
    if (data) updated = data;
  }

  emitUciEvent(
    UCI_LIFECYCLE_EVENTS.PREDICTION_RECOMPUTED,
    {
      coordination_record_id: record.id,
      project_id: record.project_id,
      predicted_p50_date: computed.predicted_p50_date,
      predicted_p90_date: computed.predicted_p90_date,
      remaining_days: computed.remaining_days,
      baseline_business_days: baselineDays,
      baseline_source: baselineSource,
      stage_elapsed_business_days: elapsed,
    },
    { supabase },
  );

  if (p50Slipped) {
    emitUciEvent(
      UCI_LIFECYCLE_EVENTS.PREDICTION_P50_SLIP,
      {
        coordination_record_id: record.id,
        project_id: record.project_id,
        previous_p50: previousP50,
        predicted_p50_date: computed.predicted_p50_date,
        slip_days: slipDays,
        severity: "P2",
      },
      { supabase },
    );
    try {
      const { raiseUciAlert } = require("./uci-alerts.service.js");
      await raiseUciAlert(supabase, {
        record: updated,
        severity: "P2",
        code: "PREDICTION_P50_SLIP",
        message: `Typical (P50) date slipped ${slipDays} days`,
      });
    } catch {
      // Alerts are best-effort
    }
  }

  return {
    computed: true,
    record: updated,
    ...computed,
    baseline_business_days: baselineDays,
    baseline_source: baselineSource,
    prediction_reason: patch.prediction_reason,
    stage_elapsed_business_days: elapsed,
    previous_p50: previousP50,
    p50_slip_days: slipDays,
    p50_slipped: p50Slipped,
  };
  } catch {
    return { computed: false, reason: "prediction_failed", record };
  }
}

module.exports = {
  businessDaysBetween,
  calendarDaysAfter,
  computePredictedDates,
  recomputePredictedDates,
  loadBaselineBusinessDays,
  fallbackBaseline,
};
