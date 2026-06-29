"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  evaluateArlingtonJobCompletion,
  computeVerifyFingerprint,
  mapEvaluationToLegacyVerification,
} = require("../lib/arlington-completion-evaluator.js");
const orchestration = require("../lib/arlington-orchestration.js");

function cofo26PortalData() {
  return {
    checkpointVersion: 27,
    arlingtonSectionStates: {
      attachments: "downloading",
      planReview: "downloading",
      recordInfo: "complete",
    },
    tabs: {
      info: {
        fields: [{ label: "Record Number", value: "COFO26-00417" }],
      },
      attachments: {
        sectionState: "downloading",
        tables: [
          {
            rows: [
              {
                downloadStatus: "uploaded",
                publicUrl: "https://example.com/att.pdf",
                storagePath: "drawings/x/att.pdf",
              },
            ],
          },
        ],
      },
      planReview: {
        tabs: {
          projectInformation: {
            extractionStatus: "ok",
            fields: [
              { label: "Project ID", value: "COFO26-00417" },
              { label: "Plan Review Project Name", value: "4300 WILSON BLVD 220" },
            ],
          },
          plansAndDocuments: {
            sections: {
              planSetDocuments: {
                documents: [
                  {
                    name: "A.1 Floor Plan 1",
                    downloadStatus: "uploaded",
                    publicUrl: "https://example.com/a1.pdf",
                    storagePath: "drawings/x/a1.pdf",
                  },
                ],
              },
            },
          },
          reviewResultsAndMarkups: { documents: [] },
          approvedDocuments: { documents: [] },
        },
      },
    },
  };
}

describe("Arlington completion evaluator", () => {
  const requestedScope = {
    tabs: ["attachments", "info", "plan_review"],
    planReviewScope: "all",
  };

  it("COFO26-shaped fixture with stale downloading states is complete", () => {
    const evaluation = evaluateArlingtonJobCompletion(
      { requested_scope: requestedScope, phase: "verify" },
      cofo26PortalData(),
      requestedScope,
    );
    assert.equal(evaluation.complete, true, evaluation.reason);
    assert.equal(evaluation.terminalStatus, "completed");
    assert.equal(evaluation.counts.attachmentsPending, 0);
    assert.equal(evaluation.counts.planReviewPending, 0);
    assert.equal(evaluation.sectionOutcomes.attachments, "completed");
    assert.equal(evaluation.sectionOutcomes.plan_set, "completed");
    assert.equal(evaluation.sectionOutcomes.project_information, "completed");
  });

  it("fully scraped job in phase=verify maps to legacy complete", () => {
    const evaluation = evaluateArlingtonJobCompletion(
      { requested_scope: requestedScope },
      cofo26PortalData(),
      requestedScope,
    );
    const legacy = mapEvaluationToLegacyVerification(evaluation);
    assert.equal(legacy.complete, true);
    assert.equal(legacy.finalStatus, "complete");
  });

  it("valid empty plan review subsection does not block completion", () => {
    const pd = cofo26PortalData();
    const evaluation = evaluateArlingtonJobCompletion(
      { requested_scope: requestedScope },
      pd,
      requestedScope,
    );
    assert.equal(evaluation.sections.review_results.outcome, "completed_empty");
    assert.equal(evaluation.complete, true);
  });

  it("metadata-only approved documents allow completion with warnings path", () => {
    const pd = cofo26PortalData();
    pd.tabs.planReview.tabs.approvedDocuments = {
      documents: [{ name: "Stamp", downloadStatus: "metadata_only" }],
    };
    const evaluation = evaluateArlingtonJobCompletion(
      { requested_scope: requestedScope },
      pd,
      requestedScope,
    );
    assert.equal(evaluation.sections.approved_documents.outcome, "metadata_only");
    assert.equal(evaluation.complete, true);
    assert.ok(evaluation.warnings.includes("plan_review_metadata_only"));
  });

  it("non-requested sections do not block completion", () => {
    const evaluation = evaluateArlingtonJobCompletion(
      { requested_scope: { tabs: ["attachments"] } },
      cofo26PortalData(),
      { tabs: ["attachments"] },
    );
    assert.equal(evaluation.sections.plan_set.outcome, "not_requested");
    assert.equal(evaluation.complete, true);
  });

  it("stale pending metadata with zero retryable counts is complete", () => {
    const pd = cofo26PortalData();
    pd.arlingtonSectionStates.attachments = "partial";
    pd.tabs.attachments.sectionState = "partial";
    const evaluation = evaluateArlingtonJobCompletion(
      { requested_scope: requestedScope },
      pd,
      requestedScope,
    );
    assert.equal(evaluation.complete, true);
  });

  it("retryable attachment pending schedules retry phase attachments", () => {
    const pd = cofo26PortalData();
    pd.tabs.attachments.tables[0].rows.push({
      name: "pending.pdf",
      downloadStatus: "pending",
    });
    const evaluation = evaluateArlingtonJobCompletion(
      { requested_scope: requestedScope },
      pd,
      requestedScope,
    );
    assert.equal(evaluation.complete, false);
    assert.equal(evaluation.retryableWorkRemaining, true);
    assert.equal(evaluation.retryPhase, "attachments");
    const legacy = mapEvaluationToLegacyVerification(evaluation);
    assert.equal(legacy.hasRetryableWork, true);
  });

  it("rate-limited attachments are not complete", () => {
    const pd = cofo26PortalData();
    pd.arlingtonSectionStates.attachments = "rate_limited";
    pd.tabs.attachments.sectionState = "rate_limited";
    const evaluation = evaluateArlingtonJobCompletion(
      { requested_scope: { tabs: ["attachments"] } },
      pd,
      { tabs: ["attachments"] },
    );
    assert.equal(evaluation.complete, false);
    assert.equal(evaluation.sections.attachments.outcome, "rate_limited");
  });

  it("verify fingerprint is stable and excludes timestamps", () => {
    const evaluation = evaluateArlingtonJobCompletion(
      { requested_scope: requestedScope },
      cofo26PortalData(),
      requestedScope,
    );
    const a = computeVerifyFingerprint(evaluation);
    const b = computeVerifyFingerprint(evaluation);
    assert.equal(a, b);
    assert.ok(!a.includes("202"));
  });

  it("verify via orchestration wrapper returns complete for COFO26 fixture", async () => {
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
                          id: "983d62dc-fad6-4fcb-ad0d-bbdba71f7776",
                          portal_data: cofo26PortalData(),
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
    const verification = await orchestration.verifyArlingtonJobCompletion(supabase, {
      projectId: "983d62dc-fad6-4fcb-ad0d-bbdba71f7776",
      requestedTabs: ["attachments", "info", "plan_review"],
      requestedScope,
      job: {
        id: "b974c62e-ca3f-4b88-9090-7b5054d997d0",
        phase: "verify",
        requested_scope: requestedScope,
      },
    });
    assert.equal(verification.complete, true);
  });

  it("bounded phase verify skips portal when verifyPersistedOnly", () => {
    const accela = require("../accela-scraper.js");
    const src = require("fs").readFileSync(
      require("path").join(__dirname, "..", "accela-scraper.js"),
      "utf8",
    );
    assert.match(src, /if \(phase === "verify"\)/);
    assert.match(src, /verifyPersistedOnly = true/);
    assert.match(src, /if \(phase === "verify"\)[\s\S]*?return result;/);
  });

  it("finalize never leaves verify phase on incomplete retry (contract)", () => {
    const store = require("fs").readFileSync(
      require("path").join(__dirname, "..", "lib/arlington-job-store.js"),
      "utf8",
    );
    assert.match(store, /phase: retryPhase/);
    assert.match(store, /VERIFY_RETRY_DELAY_MS/);
    assert.doesNotMatch(store, /phase: job\.phase[\s\S]*next_attempt_at: new Date\(\)\.toISOString\(\)/);
  });
});
