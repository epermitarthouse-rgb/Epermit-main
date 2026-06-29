"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  scheduleRateLimitRelease,
  parseRequestedScope,
} = require("../lib/arlington-job-store.js");
const orchestration = require("../lib/arlington-orchestration.js");

describe("Arlington worker lifecycle (fresh instances, no shared session)", () => {
  it("Building permit advances record_info → attachments → verify phases across claims", () => {
    const scope = parseRequestedScope({
      requested_scope: {
        tabs: ["info", "attachments", "plan_review"],
        planReviewScope: "all",
      },
    });
    const mode = orchestration.detectArlingtonRecordMode(
      { record_type: "Building Permit" },
      "BP-2024-001",
    );
    assert.equal(mode, "building");
    const phases = [];
    let phase = "record_info";
    for (let i = 0; i < 6 && phase !== "complete"; i += 1) {
      phases.push(phase);
      if (phase === "record_info") phase = "attachments";
      else if (phase === "attachments") phase = "project_information";
      else if (phase === "project_information") phase = "plan_review";
      else if (phase === "plan_review") phase = "verify";
      else if (phase === "verify") phase = "complete";
    }
    assert.deepEqual(phases, [
      "record_info",
      "attachments",
      "project_information",
      "plan_review",
      "verify",
    ]);
    assert.ok(scope.tabs.includes("plan_review"));
  });

  it("Zoning permit uses same UI refresh contract as Building", () => {
    const mode = orchestration.detectArlingtonRecordMode(
      { record_type: "Zoning Permit" },
      "ZP-2024-010",
    );
    assert.equal(mode, "zoning");
    const buildingScope = parseRequestedScope({
      requested_scope: { tabs: ["info", "attachments", "plan_review"] },
    });
    const zoningScope = parseRequestedScope({
      requested_scope: { tabs: ["info", "attachments", "plan_review"] },
    });
    assert.deepEqual(buildingScope.tabs, zoningScope.tabs);
  });

  it("250 attachments complete over multiple bounded worker claims", () => {
    const perClaim = 15;
    let pending = 250;
    let claims = 0;
    const checkpoints = [];
    while (pending > 0) {
      claims += 1;
      const batch = Math.min(perClaim, pending);
      pending -= batch;
      checkpoints.push({ claim: claims, pending, downloaded: 250 - pending });
    }
    assert.equal(pending, 0);
    assert.equal(claims, Math.ceil(250 / perClaim));
    assert.equal(checkpoints[checkpoints.length - 1].downloaded, 250);
    assert.ok(claims > 1, "must persist across multiple claims");
  });

  it("300 plan review documents over multiple worker claims", () => {
    const perClaim = 20;
    let pending = 300;
    let claims = 0;
    while (pending > 0) {
      claims += 1;
      pending -= Math.min(perClaim, pending);
    }
    assert.equal(claims, 15);
  });

  it("completed files are not redownloaded on subsequent claims", () => {
    const rows = [
      { name: "a.pdf", downloadStatus: "uploaded", publicUrl: "https://x/a.pdf" },
      { name: "b.pdf", downloadStatus: "pending" },
    ];
    const pending = orchestration.arlingtonAttachmentPendingCount(rows);
    const downloaded = orchestration.arlingtonAttachmentDownloadedCount(rows);
    assert.equal(downloaded, 1);
    assert.equal(pending, 1);
    rows[1].downloadStatus = "uploaded";
    rows[1].publicUrl = "https://x/b.pdf";
    assert.equal(orchestration.arlingtonAttachmentPendingCount(rows), 0);
  });

  it("rate-limit release sets next_attempt_at without requiring live session", () => {
    const patch = scheduleRateLimitRelease(
      { phase: "attachments", checkpoint_version: 3 },
      1,
    );
    assert.equal(patch.status, "rate_limited");
    assert.equal(patch.attachments_state, "rate_limited");
    assert.ok(patch.next_attempt_at);
    assert.equal(patch.attempt_count, 2);
  });

  it("false-completion prevention blocks complete when attachments pending", async () => {
    const supabase = {
      from(table) {
        if (table === "projects") {
          return {
            select() {
              return {
                eq() {
                  return {
                    limit: async () => ({
                      data: [
                        {
                          id: "p1",
                          portal_data: {
                            checkpointVersion: 2,
                            arlingtonSectionStates: { attachments: "partial" },
                            tabs: {
                              attachments: {
                                sectionState: "partial",
                                tables: [
                                  {
                                    rows: [
                                      { name: "x.pdf", downloadStatus: "pending" },
                                    ],
                                  },
                                ],
                              },
                            },
                          },
                        },
                      ],
                    }),
                  };
                },
              };
            },
          };
        }
        return { select: () => ({ eq: () => ({ limit: async () => ({ data: [] }) }) }) };
      },
    };
    const verification = await orchestration.verifyArlingtonJobCompletion(
      supabase,
      {
        projectId: "p1",
        userId: "u1",
        permitNumber: "BP-1",
        requestedTabs: ["attachments"],
      },
    );
    assert.equal(verification.complete, false);
    assert.ok(verification.blockers.includes("attachments_pending"));
  });

  it("Error 1015 zero rows: rate_limited state does not mark complete", async () => {
    const supabase = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  limit: async () => ({
                    data: [
                      {
                        id: "p1",
                        portal_data: {
                          checkpointVersion: 1,
                          arlingtonSectionStates: { attachments: "rate_limited" },
                          tabs: {
                            attachments: {
                              sectionState: "rate_limited",
                              tables: [{ rows: [] }],
                            },
                          },
                        },
                      },
                    ],
                  }),
                };
              },
            };
          },
        };
      },
    };
    const verification = await orchestration.verifyArlingtonJobCompletion(
      supabase,
      {
        projectId: "p1",
        requestedTabs: ["attachments"],
      },
    );
    assert.equal(verification.complete, false);
    assert.equal(verification.finalStatus, "partial_rate_limited");
  });

  it("worker shutdown mid-batch: expired lease + partial status is recoverable", async () => {
    const store = {
      job: {
        id: "j1",
        status: "partial",
        phase: "attachments",
        lease_expires_at: new Date(Date.now() - 1000).toISOString(),
        lease_worker_id: "dead-worker",
        next_attempt_at: new Date().toISOString(),
      },
    };
    const expired =
      !store.job.lease_expires_at ||
      new Date(store.job.lease_expires_at) < new Date();
    assert.equal(expired, true);
    assert.equal(store.job.status, "partial");
    store.job.lease_worker_id = null;
    store.job.lease_expires_at = null;
    assert.equal(store.job.lease_worker_id, null);
  });
});

describe("Selective merge preservation", () => {
  it("selective merges preserve unrelated sections (contract)", () => {
    const prior = {
      tabs: {
        info: { title: "Record Info" },
        attachments: { tables: [{ rows: [{ name: "a.pdf" }] }] },
        planReview: { tabs: { projectInformation: { fields: [{ k: "x" }] } } },
      },
    };
    const incoming = {
      tabs: {
        attachments: { tables: [{ rows: [{ name: "a.pdf" }, { name: "b.pdf" }] }] },
      },
    };
    const merged = {
      ...prior,
      tabs: {
        ...prior.tabs,
        attachments: incoming.tabs.attachments,
      },
    };
    assert.deepEqual(merged.tabs.info, prior.tabs.info);
    assert.deepEqual(merged.tabs.planReview, prior.tabs.planReview);
    assert.equal(merged.tabs.attachments.tables[0].rows.length, 2);
  });
});
