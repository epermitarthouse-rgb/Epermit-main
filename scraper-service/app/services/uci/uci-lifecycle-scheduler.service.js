"use strict";

/**
 * In-process Track B scheduler (default ON, Graph poller pattern).
 * - Equipment check-in: daily 06:00 UTC + 15-min due catch-up
 * - Meter 48h checklist: every 15 min
 * - Lifecycle SLA: every 15 min
 * - QB retry: every 5 min
 * P50/P90 is NOT a cron — it runs on every record write.
 */

const crypto = require("crypto");
const { runDueEquipmentCheckIns } = require("./uci-equipment-tracker.service.js");
const { sweep48hChecklists } = require("./uci-meter-set-choreographer.service.js");
const { sweepLifecycleSlas } = require("./uci-lifecycle-sla.service.js");
const { retryPendingUciInvoices } = require("./uci-qb-passthrough.service.js");

const SCHEDULER_ENABLED = process.env.UCI_LIFECYCLE_SCHEDULER_ENABLED !== "false";
const CATCHUP_MS = Number(process.env.UCI_LIFECYCLE_CATCHUP_MS || 15 * 60 * 1000);
const QB_RETRY_MS = Number(process.env.UCI_QB_RETRY_MS || 5 * 60 * 1000);
const DAILY_HOUR_UTC = Number(process.env.UCI_EQUIPMENT_CHECKIN_HOUR_UTC || 6);

function newSchedulerId() {
  return `uci-lifecycle-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
}

function isDailyEquipmentWindow(now, lastDailyAt) {
  if (now.getUTCHours() !== DAILY_HOUR_UTC) return false;
  if (!lastDailyAt) return true;
  return lastDailyAt.getUTCDate() !== now.getUTCDate() || lastDailyAt.getUTCMonth() !== now.getUTCMonth();
}

/**
 * One scheduler cycle. `now` is injectable for tests.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} [opts]
 */
async function runLifecycleSchedulerCycle(supabase, opts = {}) {
  const now = opts.now || new Date();
  const runDaily = opts.forceDaily === true || isDailyEquipmentWindow(now, opts.lastDailyAt);
  const runCatchup = opts.forceCatchup !== false;
  const runMeter = opts.forceMeter !== false;
  const runSla = opts.forceSla !== false;
  const runQb = opts.forceQb !== false;

  /** @type {Record<string, unknown>} */
  const results = { at: now.toISOString(), daily: null, catchup: null, meter_48h: null, sla: null, qb: null };

  if (runDaily || runCatchup) {
    const equipment = await runDueEquipmentCheckIns(supabase, {
      now,
      limit: opts.limit,
      deps: opts.deps || {},
    });
    if (runDaily) results.daily = equipment;
    results.catchup = equipment;
  }
  if (runMeter) {
    results.meter_48h = await sweep48hChecklists(supabase, { now, deps: opts.deps || {} });
  }
  if (runSla) {
    results.sla = await sweepLifecycleSlas(supabase, { now, limit: opts.limit });
  }
  if (runQb) {
    results.qb = await retryPendingUciInvoices(supabase, {
      limit: opts.limit,
      createInvoiceFn: opts.deps?.createInvoiceFn,
      queryFn: opts.deps?.queryFn,
    });
  }
  return results;
}

/**
 * HTTP ops-only sweep — not the happy path.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} [opts]
 */
async function runOpsLifecycleSweep(supabase, opts = {}) {
  return runLifecycleSchedulerCycle(supabase, { ...opts, forceDaily: true, forceCatchup: true });
}

/**
 * @param {{ supabase: import("@supabase/supabase-js").SupabaseClient }} deps
 */
function startUciLifecycleScheduler(deps) {
  if (!SCHEDULER_ENABLED) {
    console.log("[dev-worker][UCI][Lifecycle] scheduler disabled (UCI_LIFECYCLE_SCHEDULER_ENABLED=false)");
    return { stop() {}, schedulerId: null, enabled: false };
  }

  const schedulerId = newSchedulerId();
  let stopped = false;
  let inFlight = false;
  /** @type {Date | null} */
  let lastDailyAt = null;

  console.log(`[dev-worker][UCI][Lifecycle] scheduler starting schedulerId=${schedulerId}`);

  const tick = async (kind) => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const now = new Date();
      const forceDaily = kind === "daily" || isDailyEquipmentWindow(now, lastDailyAt);
      await runLifecycleSchedulerCycle(deps.supabase, {
        now,
        forceDaily,
        forceCatchup: kind !== "qb",
        forceMeter: kind !== "qb",
        forceSla: kind !== "qb",
        forceQb: kind === "qb" || kind === "catchup",
      });
      if (forceDaily) lastDailyAt = now;
    } catch (err) {
      console.warn(`[UCI][Lifecycle] cycle error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      inFlight = false;
    }
  };

  const initial = setTimeout(() => {
    void tick("catchup");
  }, 8_000);
  const catchup = setInterval(() => {
    void tick("catchup");
  }, Math.max(60_000, CATCHUP_MS));
  const qb = setInterval(() => {
    void tick("qb");
  }, Math.max(60_000, QB_RETRY_MS));

  return {
    schedulerId,
    enabled: true,
    stop() {
      stopped = true;
      clearTimeout(initial);
      clearInterval(catchup);
      clearInterval(qb);
      console.log(`[dev-worker][UCI][Lifecycle] scheduler stopped schedulerId=${schedulerId}`);
    },
  };
}

module.exports = {
  SCHEDULER_ENABLED,
  runLifecycleSchedulerCycle,
  runOpsLifecycleSweep,
  startUciLifecycleScheduler,
  isDailyEquipmentWindow,
};
