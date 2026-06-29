"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeArlingtonPermitNumber,
  normalizeArlingtonRequestedScope,
  buildArlingtonScopeKey,
} = require("../lib/arlington-scope-normalize.js");
const {
  enqueueOrGetArlingtonScrapeJob,
  NO_PROGRESS_CLAIM_THRESHOLD,
  evaluateNoProgressGuard,
} = require("../lib/arlington-job-store.js");
const orchestration = require("../lib/arlington-orchestration.js");

const ACTIVE = ["queued", "running", "resuming", "rate_limited", "partial", "waiting_user"];
const TERMINAL = [
  "completed",
  "completed_with_warnings",
  "partial_external_blocker",
  "failed",
  "failed_unrecoverable",
  "cancelled",
];

function createEnqueueStore() {
  const rows = new Map();
  let insertMutex = false;

  function findActive(identity) {
    for (const row of rows.values()) {
      if (
        row.project_id === identity.projectId &&
        row.normalized_permit_number === identity.permit &&
        row.normalized_scope_key === identity.scopeKey &&
        ACTIVE.includes(row.status) &&
        !row.completed_at
      ) {
        return row;
      }
    }
    return null;
  }

  async function rpc(name, args) {
    if (name !== "enqueue_or_get_arlington_scrape_job") {
      throw new Error(`unknown rpc ${name}`);
    }
    while (insertMutex) await new Promise((r) => setTimeout(r, 1));
    insertMutex = true;
    try {
      await new Promise((r) => setTimeout(r, Math.random() * 4));
      const identity = {
        projectId: args.p_project_id,
        permit: args.p_normalized_permit_number,
        scopeKey: args.p_normalized_scope_key,
      };
      const existing = findActive(identity);
      if (existing) {
        return {
          data: [{ job: { ...existing }, reused_existing: true }],
          error: null,
        };
      }
      const id = `job-${rows.size + 1}`;
      const row = {
        id,
        project_id: args.p_project_id,
        user_id: args.p_user_id,
        credential_id: args.p_credential_id,
        jurisdiction: "Arlington County",
        permit_number: args.p_permit_number,
        normalized_permit_number: args.p_normalized_permit_number,
        normalized_scope_key: args.p_normalized_scope_key,
        requested_scope: args.p_requested_scope,
        status: "queued",
        phase: "record_info",
        checkpoint_version: 0,
        completed_at: null,
        created_at: new Date().toISOString(),
        metadata: args.p_metadata || {},
      };
      const collision = findActive(identity);
      if (collision) {
        return {
          data: [{ job: { ...collision }, reused_existing: true }],
          error: null,
        };
      }
      rows.set(id, row);
      return {
        data: [{ job: { ...row }, reused_existing: false }],
        error: null,
      };
    } finally {
      insertMutex = false;
    }
  }

  return {
    rpc,
    rows,
    insertJob(row) {
      rows.set(row.id, row);
    },
  };
}

describe("Arlington scope identity", () => {
  it("normalizes permit numbers with trim + uppercase", () => {
    assert.equal(normalizeArlingtonPermitNumber(" cnew24-00737-ra2 "), "CNEW24-00737-RA2");
  });

  it("scope key is order-independent for tabs", () => {
    const a = buildArlingtonScopeKey({
      tabs: ["plan_review", "info", "attachments"],
      planReviewScope: "all",
    });
    const b = buildArlingtonScopeKey({
      tabs: ["attachments", "info", "plan_review"],
      planReviewScope: "all",
    });
    assert.equal(a, b);
  });

  it("different non-overlapping scopes produce different keys", () => {
    const all = buildArlingtonScopeKey({ tabs: ["info", "attachments", "plan_review"] });
    const prOnly = buildArlingtonScopeKey({ tabs: ["plan_review"], planReviewScope: "planSet" });
    assert.notEqual(all, prOnly);
  });
});

describe("enqueue_or_get_arlington_scrape_job (simulated)", () => {
  it("sequential duplicate enqueue returns same job", async () => {
    const store = createEnqueueStore();
    const supabase = { rpc: store.rpc.bind(store) };
    const fields = {
      projectId: "p1",
      permitNumber: "CNEW24-00737-RA2",
      requestedScope: normalizeArlingtonRequestedScope({ tabs: ["info", "attachments", "plan_review"] }),
    };
    const first = await enqueueOrGetArlingtonScrapeJob(supabase, fields);
    const second = await enqueueOrGetArlingtonScrapeJob(supabase, fields);
    assert.equal(first.jobId, second.jobId);
    assert.equal(first.reusedExisting, false);
    assert.equal(second.reusedExisting, true);
    assert.equal(store.rows.size, 1);
  });

  it("concurrent enqueue creates exactly one row and same job id", async () => {
    const store = createEnqueueStore();
    const supabase = { rpc: store.rpc.bind(store) };
    const fields = {
      projectId: "p1",
      permitNumber: "BP-1",
      requestedScope: normalizeArlingtonRequestedScope({ tabs: ["attachments"] }),
    };
    const [a, b] = await Promise.all([
      enqueueOrGetArlingtonScrapeJob(supabase, fields),
      enqueueOrGetArlingtonScrapeJob(supabase, fields),
    ]);
    assert.equal(a.jobId, b.jobId);
    assert.equal(store.rows.size, 1);
    assert.equal(Number(a.reusedExisting) + Number(b.reusedExisting), 1);
  });

  it("different project IDs create separate jobs", async () => {
    const store = createEnqueueStore();
    const supabase = { rpc: store.rpc.bind(store) };
    const scope = normalizeArlingtonRequestedScope({ tabs: ["attachments"] });
    const a = await enqueueOrGetArlingtonScrapeJob(supabase, {
      projectId: "p1",
      permitNumber: "BP-1",
      requestedScope: scope,
    });
    const b = await enqueueOrGetArlingtonScrapeJob(supabase, {
      projectId: "p2",
      permitNumber: "BP-1",
      requestedScope: scope,
    });
    assert.notEqual(a.jobId, b.jobId);
    assert.equal(store.rows.size, 2);
  });

  it("different permit numbers create separate jobs", async () => {
    const store = createEnqueueStore();
    const supabase = { rpc: store.rpc.bind(store) };
    const scope = normalizeArlingtonRequestedScope({ tabs: ["attachments"] });
    const a = await enqueueOrGetArlingtonScrapeJob(supabase, {
      projectId: "p1",
      permitNumber: "BP-1",
      requestedScope: scope,
    });
    const b = await enqueueOrGetArlingtonScrapeJob(supabase, {
      projectId: "p1",
      permitNumber: "BP-2",
      requestedScope: scope,
    });
    assert.notEqual(a.jobId, b.jobId);
  });

  it("terminal old job allows a new job", async () => {
    const store = createEnqueueStore();
    store.insertJob({
      id: "old",
      project_id: "p1",
      normalized_permit_number: "BP-1",
      normalized_scope_key: buildArlingtonScopeKey({ tabs: ["attachments"] }),
      status: "completed",
      completed_at: new Date().toISOString(),
      created_at: new Date(Date.now() - 10000).toISOString(),
    });
    const supabase = { rpc: store.rpc.bind(store) };
    const created = await enqueueOrGetArlingtonScrapeJob(supabase, {
      projectId: "p1",
      permitNumber: "BP-1",
      requestedScope: normalizeArlingtonRequestedScope({ tabs: ["attachments"] }),
    });
    assert.equal(created.reusedExisting, false);
    assert.notEqual(created.jobId, "old");
  });

  it("active rate_limited job is reused", async () => {
    const store = createEnqueueStore();
    const scopeKey = buildArlingtonScopeKey({ tabs: ["attachments"] });
    store.insertJob({
      id: "rl",
      project_id: "p1",
      normalized_permit_number: "BP-1",
      normalized_scope_key: scopeKey,
      status: "rate_limited",
      completed_at: null,
      phase: "attachments",
      created_at: new Date().toISOString(),
    });
    const supabase = { rpc: store.rpc.bind(store) };
    const result = await enqueueOrGetArlingtonScrapeJob(supabase, {
      projectId: "p1",
      permitNumber: "BP-1",
      requestedScope: normalizeArlingtonRequestedScope({ tabs: ["attachments"] }),
    });
    assert.equal(result.jobId, "rl");
    assert.equal(result.reusedExisting, true);
    assert.equal(store.rows.size, 1);
  });
});

describe("metadata_only terminal verification", () => {
  const metadataOnlyPortal = {
    checkpointVersion: 5,
    arlingtonSectionStates: {
      attachments: "complete",
      projectInformation: "complete",
      planReview: "complete",
    },
    tabs: {
      attachments: {
        sectionState: "complete",
        tables: [{ rows: [{ downloadStatus: "uploaded", publicUrl: "https://x/a.pdf" }] }],
      },
      planReview: {
        sectionState: "complete",
        tabs: {
          plansAndDocuments: {
            sections: {
              planSetDocuments: {
                documents: [{ name: "meta.pdf", downloadStatus: "metadata_only" }],
              },
            },
          },
          reviewResultsAndMarkups: { documents: [] },
          approvedDocuments: {
            documents: [
              { name: "a.pdf", downloadStatus: "metadata_only" },
              { name: "b.pdf", downloadStatus: "metadata_only" },
            ],
          },
          projectInformation: {
            sectionState: "complete",
            fields: [{ label: "Project ID", value: "X" }],
          },
        },
      },
    },
  };

  const mixedPortal = JSON.parse(JSON.stringify(metadataOnlyPortal));
  mixedPortal.tabs.planReview.tabs.approvedDocuments.documents.push({
    name: "retry.pdf",
    downloadStatus: "pending",
  });

  function mockSupabase(portalData) {
    return {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  limit: async () => ({ data: [{ id: "p1", portal_data: portalData }] }),
                };
              },
            };
          },
        };
      },
    };
  }

  it("metadata_only-only pending becomes terminal partial without retryable work", async () => {
    const verification = await orchestration.verifyArlingtonJobCompletion(
      mockSupabase(metadataOnlyPortal),
      { projectId: "p1", requestedTabs: ["attachments", "plan_review"] },
    );
    assert.equal(verification.hasRetryableWork, false);
    assert.equal(verification.terminalPartial, true);
    assert.ok(verification.blockers.includes("plan_review_metadata_only"));
    assert.equal(verification.counts.planReviewMetadataOnly, 3);
    assert.equal(verification.counts.planReviewPending, 0);
  });

  it("mixed retryable + metadata_only keeps retryable work", async () => {
    const verification = await orchestration.verifyArlingtonJobCompletion(
      mockSupabase(mixedPortal),
      { projectId: "p1", requestedTabs: ["plan_review"] },
    );
    assert.equal(verification.hasRetryableWork, true);
    assert.ok(verification.blockers.includes("plan_review_pending"));
    assert.equal(verification.counts.planReviewPending, 1);
    assert.equal(verification.counts.planReviewMetadataOnly, 3);
  });

  it("analyzePlanReviewPendingDocuments excludes metadata_only from retryable", () => {
    const analysis = orchestration.analyzePlanReviewPendingDocuments(
      metadataOnlyPortal.tabs.planReview,
    );
    assert.equal(analysis.retryable.total, 0);
    assert.equal(analysis.metadataOnly.total, 3);
  });
});

describe("no-progress guard", () => {
  function mockSupabaseForGuard() {
    return {
      from() {
        return {
          update() {
            return {
              eq() {
                return {
                  neq() {
                    return {
                      is: async () => ({ error: null }),
                    };
                  },
                };
              },
            };
          },
        };
      },
    };
  }

  it("terminates immediately for metadata_only-only pending", async () => {
    const supabase = mockSupabaseForGuard();
    const job = {
      id: "j1",
      phase: "plan_review",
      checkpoint_version: 3,
      metadata: { arlington: {} },
    };
    const phaseResult = {
      phase: "plan_review",
      terminalMetadataOnly: true,
      downloadedThisRun: 0,
      pendingByReason: { metadata_only: 3 },
    };
    const verification = {
      blockers: ["plan_review_metadata_only"],
      counts: { planReviewPending: 0, planReviewMetadataOnly: 3, attachmentsPending: 0 },
      hasRetryableWork: false,
    };
    const guard = await evaluateNoProgressGuard(supabase, job, phaseResult, verification);
    assert.equal(guard.terminal, true);
    assert.equal(guard.reason, "plan_review_metadata_only");
  });

  it("requires NO_PROGRESS_CLAIM_THRESHOLD consecutive claims for generic stall", async () => {
    const supabase = mockSupabaseForGuard();
    const fingerprintPayload = {
      phase: "attachments",
      checkpointVersion: 2,
      attachmentsState: "partial",
      projectInfoState: "not_started",
      planReviewState: "not_started",
      attachmentsPending: 4,
      planReviewRetryablePending: 0,
      planReviewMetadataOnly: 0,
      downloadedThisRun: 0,
      pendingReasons: { pending_not_attempted: 4 },
    };
    const fp = orchestration.computeArlingtonProgressFingerprint(fingerprintPayload);
    const job = {
      id: "j2",
      phase: "attachments",
      checkpoint_version: 2,
      attachments_state: "partial",
      metadata: { arlington: { noProgressFingerprint: fp, noProgressClaimCount: 1 } },
    };
    const guard = await evaluateNoProgressGuard(
      supabase,
      job,
      {
        phase: "attachments",
        checkpoint_version: 2,
        attachments_state: "partial",
        project_info_state: "not_started",
        plan_review_state: "not_started",
        downloadedThisRun: 0,
        pendingByReason: { pending_not_attempted: 4 },
      },
      { counts: { attachmentsPending: 4, planReviewPending: 0, planReviewMetadataOnly: 0 } },
    );
    assert.equal(guard.terminal, false);
    assert.equal(guard.consecutive, 2);
    assert.equal(NO_PROGRESS_CLAIM_THRESHOLD, 3);
  });
});

describe("cancelled duplicate claim exclusion (contract)", () => {
  it("migration resolves duplicates before creating unique index", () => {
    const fs = require("fs");
    const path = require("path");
    const sql = fs.readFileSync(
      path.join(__dirname, "..", "..", "supabase/migrations/20260630200000_arlington_enqueue_dedup.sql"),
      "utf8",
    );
    const idxPos = sql.indexOf("CREATE UNIQUE INDEX idx_scrape_jobs_arlington_active_identity");
    const dupPos = sql.indexOf("duplicate_active_job");
    const dropIdxPos = sql.indexOf("DROP INDEX IF EXISTS public.idx_scrape_jobs_arlington_active_identity");
    assert.ok(dupPos > 0, "duplicate cleanup must be present");
    assert.ok(dropIdxPos > 0 && dropIdxPos < idxPos, "must drop index before recreate");
    assert.ok(dupPos < idxPos, "duplicate cleanup must precede unique index");
    assert.match(sql, /partial_external_blocker/);
    assert.doesNotMatch(
      sql.slice(idxPos, idxPos + 400),
      /partial_external_blocker/,
      "partial_external_blocker must not be in active unique-index predicate",
    );
  });

  it("migration claim RPC skips duplicate_active_job terminal reason", () => {
    const fs = require("fs");
    const path = require("path");
    const sql = fs.readFileSync(
      path.join(__dirname, "..", "..", "supabase/migrations/20260630200000_arlington_enqueue_dedup.sql"),
      "utf8",
    );
    assert.match(sql, /duplicate_active_job/);
    assert.match(sql, /enqueue_or_get_arlington_scrape_job/);
    assert.match(sql, /idx_scrape_jobs_arlington_active_identity/);
  });

  it("cancelled jobs are not active statuses", () => {
    assert.ok(!ACTIVE.includes("cancelled"));
    assert.ok(!ACTIVE.includes("completed_with_warnings"));
    assert.ok(!ACTIVE.includes("partial_external_blocker"));
    assert.ok(TERMINAL.includes("cancelled"));
    assert.ok(TERMINAL.includes("completed_with_warnings"));
    assert.ok(TERMINAL.includes("partial_external_blocker"));
  });
});
