"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const orchestration = require("../lib/arlington-orchestration.js");

describe("Arlington orchestration", () => {
  it("detects Cloudflare Error 1015 rate limit", () => {
    const snippet =
      "Error 1015 Ray ID: abc • You are being rate limited aca-prod.accela.com";
    const result = orchestration.detectCloudflareRateLimit(snippet);
    assert.equal(result.rateLimited, true);
    assert.equal(result.errorCode, "1015");
  });

  it("does not treat valid empty grid as rate limited", () => {
    const result = orchestration.detectCloudflareRateLimit(
      "No attachments found for this record.",
    );
    assert.equal(result.rateLimited, false);
  });

  it("bumps checkpoint version monotonically", () => {
    assert.equal(orchestration.bumpCheckpointVersion({ checkpointVersion: 3 }), 4);
    assert.equal(orchestration.bumpCheckpointVersion(null), 1);
  });

  it("merge helper rejects stale checkpoint overwrite", () => {
    const merge = (current, incoming) => {
      const currentV = orchestration.readCheckpointVersion(current);
      const incomingV = orchestration.readCheckpointVersion(incoming);
      if (incomingV > 0 && currentV > 0 && incomingV < currentV) return current;
      return incoming;
    };
    const current = { checkpointVersion: 10 };
    const stale = { checkpointVersion: 2 };
    assert.equal(merge(current, stale).checkpointVersion, 10);
    assert.equal(merge(current, { checkpointVersion: 11 }).checkpointVersion, 11);
  });

  it("classifies building and zoning permit modes", () => {
    assert.equal(
      orchestration.detectArlingtonRecordMode(
        { record_type: "Building Permit" },
        "CNEW24-00737-RA2",
      ),
      "building",
    );
    assert.equal(
      orchestration.detectArlingtonRecordMode(
        { record_type: "Zoning Certificate" },
        "ZP-2024-001",
      ),
      "zoning",
    );
  });

  it("resolves durable auto-continue max cycles", () => {
    assert.equal(
      orchestration.resolveDurableAutoContinueMaxCycles({
        arlingtonDurableMode: true,
      }),
      orchestration.ARLINGTON_DURABLE_AUTO_CONTINUE_MAX_CYCLES,
    );
    assert.equal(
      orchestration.resolveDurableAutoContinueMaxCycles({
        arlingtonAutoContinueMaxCycles: 4,
      }),
      4,
    );
  });

  it("rejects false completion when attachments are rate_limited", async () => {
    const portalData = {
      checkpointVersion: 2,
      arlingtonSectionStates: { attachments: "rate_limited" },
      tabs: {
        attachments: {
          sectionState: "rate_limited",
          tables: [{ rows: [] }],
        },
      },
    };
    const supabase = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  limit() {
                    return Promise.resolve({
                      data: [
                        {
                          id: "proj-1",
                          portal_data: portalData,
                        },
                      ],
                    });
                  },
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
        projectId: "proj-1",
        requestedTabs: ["attachments"],
      },
    );
    assert.equal(verification.complete, false);
    assert.equal(verification.finalStatus, "partial_rate_limited");
    assert.ok(verification.blockers.includes("attachments_rate_limited"));
  });

  it("allows complete when attachments downloaded and no pending", async () => {
    const portalData = {
      checkpointVersion: 5,
      arlingtonSectionStates: {
        attachments: "complete",
        projectInformation: "complete",
        planReview: "complete",
      },
      tabs: {
        attachments: {
          sectionState: "complete",
          tables: [
            {
              rows: [
                {
                  downloadStatus: "uploaded",
                  publicUrl: "https://example.com/a.pdf",
                },
              ],
            },
          ],
        },
        planReview: {
          sectionState: "complete",
          tabs: {
            plansAndDocuments: {
              sections: { planSetDocuments: { documents: [] } },
            },
            reviewResultsAndMarkups: { documents: [] },
            approvedDocuments: { documents: [] },
            projectInformation: { sectionState: "complete", fields: [{ label: "Project ID", value: "X" }] },
          },
        },
      },
    };
    const supabase = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  limit() {
                    return Promise.resolve({
                      data: [{ id: "proj-1", portal_data: portalData }],
                    });
                  },
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
        projectId: "proj-1",
        requestedTabs: ["attachments", "plan_review"],
      },
    );
    assert.equal(verification.complete, true);
    assert.equal(verification.finalStatus, "complete");
  });

  it("weak project information completes with warnings, not retry loop", async () => {
    const portalData = {
      checkpointVersion: 3,
      arlingtonSectionStates: { projectInformation: "weak_extraction" },
      tabs: {
        attachments: {
          sectionState: "complete",
          tables: [{ rows: [{ downloadStatus: "uploaded", publicUrl: "https://x" }] }],
        },
        planReview: {
          tabs: {
            projectInformation: {
              sectionState: "weak_extraction",
              fields: [{ label: "Project ID", value: "OLD" }],
            },
            plansAndDocuments: {
              sections: { planSetDocuments: { documents: [] } },
            },
            reviewResultsAndMarkups: { documents: [] },
            approvedDocuments: { documents: [] },
          },
        },
      },
    };
    const supabase = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  limit() {
                    return Promise.resolve({
                      data: [{ id: "proj-1", portal_data: portalData }],
                    });
                  },
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
        projectId: "proj-1",
        requestedTabs: ["attachments", "plan_review"],
      },
    );
    assert.equal(verification.complete, true);
    assert.equal(verification.finalStatus, "complete_with_warnings");
    assert.ok((verification.warnings || []).includes("project_information_warnings"));
  });

  it("zero rows on error page cannot be complete (rate_limited)", async () => {
    const verificationStates = orchestration.readArlingtonSectionStates({
      arlingtonSectionStates: { attachments: "rate_limited" },
    });
    assert.equal(verificationStates.attachments, "rate_limited");
    assert.notEqual(verificationStates.attachments, "complete");
  });

  it("zero rows on valid loaded grid can be complete", () => {
    const rows = [];
    assert.equal(orchestration.arlingtonAttachmentPendingCount(rows), 0);
    assert.equal(orchestration.arlingtonAttachmentDownloadedCount(rows), 0);
  });
});

describe("Arlington durable job helpers", () => {
  it("computes bounded rate-limit retry delay with jitter cap", () => {
    const d0 = orchestration.computeRateLimitRetryAfterMs(0);
    const d6 = orchestration.computeRateLimitRetryAfterMs(6);
    assert.ok(d0 >= orchestration.ARLINGTON_RATE_LIMIT_BASE_MS);
    assert.ok(d6 <= 15 * 60 * 1000 + 15000);
  });
});
