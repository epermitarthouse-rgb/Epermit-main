"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  isUciDurableJobsEnabled,
  isTransientPortalSyncError,
  computeRetryAfterIso,
  UCI_PORTAL_SYNC_JOB_TYPE,
} = require("../app/services/uci/uci-portal-sync-job-store.js");
const {
  runPortalSyncWithMode,
  mapJobToSyncRunResponse,
} = require("../app/services/uci/uci-portal-sync-job.service.js");
const { executeUciPortalSyncWorkerCycle } = require("../app/services/uci/uci-durable-worker-executor.js");

/**
 * @param {Record<string, Array<Record<string, unknown>>>} tables
 */
function createUciJobMockSupabase(tables) {
  const rpcHandlers = /** @type {Record<string, Function>} */ ({});

  return {
    rpc(name, args) {
      if (rpcHandlers[name]) return rpcHandlers[name](args);
      return Promise.resolve({ data: null, error: new Error(`rpc not mocked: ${name}`) });
    },
    from(table) {
      const store = tables[table] || (tables[table] = []);
      const filters = [];
      const state = { mode: "select", patch: null };

      const api = {
        select() {
          return api;
        },
        eq(column, value) {
          filters.push({ column, value });
          return api;
        },
        or() {
          return api;
        },
        is(column, value) {
          filters.push({ column, value, op: "is" });
          return api;
        },
        not(column, op, value) {
          filters.push({ column, op, value, kind: "not" });
          return api;
        },
        order() {
          return api;
        },
        limit(n) {
          state.limit = n;
          return api;
        },
        maybeSingle() {
          const row = store.find((r) =>
            filters.every((f) => String(r[f.column]) === String(f.value)),
          );
          return Promise.resolve({ data: row ?? null, error: null });
        },
        single() {
          return api.maybeSingle();
        },
        update(patch) {
          state.mode = "update";
          state.patch = patch;
          return api;
        },
        then(resolve, reject) {
          if (state.mode === "update") {
            const row = store.find((r) =>
              filters.every((f) => String(r[f.column]) === String(f.value)),
            );
            if (row && state.patch) Object.assign(row, state.patch);
            return Promise.resolve({ error: null }).then(resolve, reject);
          }
          let rows = store.filter((r) =>
            filters.every((f) => String(r[f.column]) === String(f.value)),
          );
          if (state.limit) rows = rows.slice(0, state.limit);
          return Promise.resolve({ data: rows, error: null, count: rows.length }).then(
            resolve,
            reject,
          );
        },
      };
      return api;
    },
    __mockRpc(name, handler) {
      rpcHandlers[name] = handler;
    },
  };
}

describe("UCI D1D durable jobs feature flag", () => {
  /** @type {string | undefined} */
  let prev;

  beforeEach(() => {
    prev = process.env.UCI_DURABLE_JOBS_ENABLED;
    delete process.env.UCI_DURABLE_JOBS_ENABLED;
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.UCI_DURABLE_JOBS_ENABLED;
    else process.env.UCI_DURABLE_JOBS_ENABLED = prev;
  });

  it("defaults durable jobs to disabled", () => {
    assert.equal(isUciDurableJobsEnabled(), false);
  });

  it("enables durable jobs only when env is true", () => {
    process.env.UCI_DURABLE_JOBS_ENABLED = "true";
    assert.equal(isUciDurableJobsEnabled(), true);
  });
});

describe("UCI D1D portal sync mode selection", () => {
  /** @type {string | undefined} */
  let prev;

  beforeEach(() => {
    prev = process.env.UCI_DURABLE_JOBS_ENABLED;
    delete process.env.UCI_DURABLE_JOBS_ENABLED;
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.UCI_DURABLE_JOBS_ENABLED;
    else process.env.UCI_DURABLE_JOBS_ENABLED = prev;
  });

  it("uses synchronous runPortalSync when flag is off", async () => {
    const tables = {
      coordination_records: [
        {
          id: "coord-1",
          project_id: "proj-1",
          current_stage: 3,
          metadata: {
            pepco_application_detail_discovery: {
              applications: [{ applicationUuid: "uuid-1", currentStatus: "In Design" }],
            },
          },
          utility_providers: { slug: "pepco" },
        },
      ],
      coordination_applications: [],
      coordination_communications: [],
      coordination_milestones: [],
    };
    const supabase = createUciJobMockSupabase(tables);

    const result = await runPortalSyncWithMode(supabase, {
      projectId: "proj-1",
      userId: "user-1",
      coordinationRecordId: "coord-1",
      providerSlug: "pepco",
    });

    assert.equal(result.mode, "sync");
    assert.ok(result.summary);
  });
});

describe("UCI D1D worker executor", () => {
  it("marks missing coordination_record_id as failed_unrecoverable", async () => {
    const tables = { scrape_jobs: [] };
    const supabase = createUciJobMockSupabase(tables);
    supabase.__mockRpc("release_uci_portal_sync_job_lease", async () => ({
      id: "job-1",
      status: "failed_unrecoverable",
    }));

    const outcome = await executeUciPortalSyncWorkerCycle({
      supabase,
      job: { id: "job-1", project_id: "proj-1", attempt_count: 0 },
      workerId: "worker-1",
    });

    assert.equal(outcome.outcome, "failed");
  });

  it("schedules retry for transient sync errors", async () => {
    const err = new Error("network timeout while syncing");
    const assertTransient = isTransientPortalSyncError(err);
    assert.equal(assertTransient, true);
    const retryAt = computeRetryAfterIso(2);
    assert.ok(Date.parse(retryAt) > Date.now());
  });

  it("does not treat missing portal snapshot as transient", () => {
    const err = Object.assign(new Error("No usable portal application snapshot found."), {
      code: "NO_PORTAL_SNAPSHOT",
      statusCode: 422,
    });
    assert.equal(isTransientPortalSyncError(err), false);
  });
});

describe("UCI D1D migration contract", () => {
  it("defines enqueue, claim, heartbeat, release, and cancel RPCs", () => {
    const sql = fs.readFileSync(
      path.join(
        __dirname,
        "../../supabase/migrations/20260714120000_uci_durable_portal_sync_jobs.sql",
      ),
      "utf8",
    );
    assert.match(sql, /enqueue_or_get_uci_portal_sync_job/);
    assert.match(sql, /claim_uci_portal_sync_job/);
    assert.match(sql, /heartbeat_uci_portal_sync_job_lease/);
    assert.match(sql, /release_uci_portal_sync_job_lease/);
    assert.match(sql, /cancel_uci_portal_sync_job/);
    assert.match(sql, /job_type/);
    assert.match(sql, /coordination_record_id/);
    assert.match(sql, /idx_scrape_jobs_uci_active_sync/);
  });
});

describe("UCI D1D job response mapping", () => {
  it("maps scrape_jobs row into sync run payload", () => {
    const mapped = mapJobToSyncRunResponse({
      id: "job-1",
      job_type: UCI_PORTAL_SYNC_JOB_TYPE,
      coordination_record_id: "coord-1",
      project_id: "proj-1",
      status: "queued",
      phase: "portal_sync",
      current_stage: "queued",
      current_user_message: "Portal sync queued",
      progress_current: 0,
      progress_total: 5,
      metadata: { provider_slug: "pepco", uci: { job_kind: "uci_portal_sync" } },
      created_at: "2026-07-14T00:00:00.000Z",
    });
    assert.equal(mapped.jobType, UCI_PORTAL_SYNC_JOB_TYPE);
    assert.equal(mapped.providerSlug, "pepco");
    assert.equal(mapped.status, "queued");
  });
});
