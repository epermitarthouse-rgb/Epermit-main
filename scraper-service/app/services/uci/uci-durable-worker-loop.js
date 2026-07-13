"use strict";

const crypto = require("crypto");
const {
  claimUciPortalSyncJobViaRpc,
  TERMINAL_STATUSES,
  isUciDurableJobsEnabled,
} = require("./uci-portal-sync-job-store.js");
const { executeUciPortalSyncWorkerCycle } = require("./uci-durable-worker-executor.js");

const UCI_WORKER_POLL_INTERVAL_MS = Number(process.env.UCI_WORKER_POLL_MS || 5000);
const WORKER_ENABLED = process.env.UCI_DURABLE_WORKER_ENABLED !== "false";

function newUciWorkerId() {
  return `uci-worker-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
}

/**
 * @param {object} deps
 * @param {import("@supabase/supabase-js").SupabaseClient} deps.supabase
 * @param {number} [deps.leaseTtlSeconds]
 */
function startUciDurableWorkerLoop(deps) {
  if (!isUciDurableJobsEnabled() || !WORKER_ENABLED) {
    console.log(
      "[dev-worker][UCI] background durable worker disabled (UCI_DURABLE_JOBS_ENABLED=false or UCI_DURABLE_WORKER_ENABLED=false)",
    );
    return { stop: () => {}, workerId: null };
  }

  const workerId = newUciWorkerId();
  let stopped = false;
  let inFlight = false;

  console.log(
    `[dev-worker][UCI] background durable worker starting workerId=${workerId} intervalMs=${UCI_WORKER_POLL_INTERVAL_MS}`,
  );

  const tick = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const job = await claimUciPortalSyncJobViaRpc(
        deps.supabase,
        workerId,
        deps.leaseTtlSeconds || 180,
      );
      if (!job?.id) return;
      if (TERMINAL_STATUSES.has(`${job.status || ""}`.toLowerCase())) return;

      console.log(
        `[UCI][Worker] claimed job=${job.id} phase=${job.phase} status=${job.status}`,
      );

      const cycleResult = await executeUciPortalSyncWorkerCycle({
        supabase: deps.supabase,
        job,
        workerId,
        leaseTtlSeconds: deps.leaseTtlSeconds || 180,
      });
      if (cycleResult?.outcome === "cancelled") {
        console.log(`[UCI][Worker] stopped cancelled job=${job.id}`);
      }
    } catch (err) {
      console.warn(`[UCI][Worker] poll tick error: ${err?.message || err}`);
    } finally {
      inFlight = false;
    }
  };

  void tick();
  const interval = setInterval(() => {
    void tick();
  }, UCI_WORKER_POLL_INTERVAL_MS);

  return {
    workerId,
    stop() {
      stopped = true;
      clearInterval(interval);
      console.log(
        `[dev-worker][UCI] background durable worker stopped workerId=${workerId}`,
      );
    },
  };
}

module.exports = {
  startUciDurableWorkerLoop,
  UCI_WORKER_POLL_INTERVAL_MS,
  WORKER_ENABLED,
};
