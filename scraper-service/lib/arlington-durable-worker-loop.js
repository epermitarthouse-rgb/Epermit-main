"use strict";

const crypto = require("crypto");
const {
  claimJobViaRpc,
  TERMINAL_STATUSES,
} = require("./arlington-job-store.js");
const { executeArlingtonWorkerCycle } = require("./arlington-worker-executor.js");

/** Poll interval for eligible Arlington scrape_jobs (ms). */
const ARLINGTON_WORKER_POLL_INTERVAL_MS = Number(
  process.env.ARLINGTON_WORKER_POLL_MS || 5000,
);

const WORKER_ENABLED = process.env.ARLINGTON_DURABLE_WORKER_ENABLED !== "false";

function newWorkerId() {
  return `arlington-worker-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
}

/**
 * Start the durable Arlington worker polling loop (survives HTTP disconnect; restart-safe).
 * @param {object} deps
 */
function startArlingtonDurableWorkerLoop(deps) {
  if (!WORKER_ENABLED) {
    console.log(
      "[dev-worker][Arlington] background durable worker disabled (ARLINGTON_DURABLE_WORKER_ENABLED=false)",
    );
    return { stop: () => {}, workerId: null };
  }

  const workerId = newWorkerId();
  let stopped = false;
  let inFlight = false;

  console.log(
    `[dev-worker][Arlington] background durable worker starting workerId=${workerId} intervalMs=${ARLINGTON_WORKER_POLL_INTERVAL_MS}`,
  );

  const tick = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const job = await claimJobViaRpc(
        deps.supabase,
        workerId,
        deps.leaseTtlSeconds || 180,
      );
      if (!job?.id) return;
      if (TERMINAL_STATUSES.has(`${job.status || ""}`.toLowerCase())) return;

      console.log(
        `[Arlington][Worker] claimed job=${job.id} phase=${job.phase} status=${job.status}`,
      );

      const cycleResult = await executeArlingtonWorkerCycle({
        supabase: deps.supabase,
        job,
        workerId,
        sessions: deps.sessions,
        rearmSessionIdleTimeout: deps.rearmSessionIdleTimeout,
        cleanupSession: deps.cleanupSession,
        hashPortalData: deps.hashPortalData,
        uploadToSupabaseStorage: deps.uploadToSupabaseStorage,
        sanitizeStorageKey: deps.sanitizeStorageKey,
      });
      if (cycleResult?.outcome === "cancelled") {
        console.log(`[Arlington][Worker] stopped cancelled job=${job.id}`);
      }
    } catch (err) {
      console.warn(
        `[Arlington][Worker] poll tick error: ${err?.message || err}`,
      );
    } finally {
      inFlight = false;
    }
  };

  void tick();
  const interval = setInterval(() => {
    void tick();
  }, ARLINGTON_WORKER_POLL_INTERVAL_MS);

  return {
    workerId,
    stop() {
      stopped = true;
      clearInterval(interval);
      console.log(
        `[dev-worker][Arlington] background durable worker stopped (dev stack shutdown) workerId=${workerId}`,
      );
    },
  };
}

module.exports = {
  startArlingtonDurableWorkerLoop,
  ARLINGTON_WORKER_POLL_INTERVAL_MS,
  WORKER_ENABLED,
};
