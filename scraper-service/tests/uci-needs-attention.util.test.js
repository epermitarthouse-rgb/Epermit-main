"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  isActionableNeedsAttentionCommunication,
  isOutboundTransmission,
  isOwnOutboundPackageEcho,
  filterStaleStage7AttentionCodes,
  listRecordNeedsAttention,
} = require("../app/services/uci/uci-needs-attention.util.js");
const { BLOCKED_REASON_CODES } = require("../app/services/uci/uci-lifecycle-constants.js");

describe("uci-needs-attention.util", () => {
  it("drops stale client approval attention when every cost is approved", () => {
    const filtered = filterStaleStage7AttentionCodes(
      [BLOCKED_REASON_CODES.COST_APPROVAL_PENDING, BLOCKED_REASON_CODES.COST_QB_FAILED],
      [{ id: "c1", client_approval_status: "approved" }],
    );
    assert.deepEqual(filtered, [BLOCKED_REASON_CODES.COST_QB_FAILED]);

    const record = {
      id: "coord-1",
      project_id: "proj-1",
      current_stage: 7,
      current_stage_state: "IN_PROGRESS",
      metadata: {
        uci_alerts: [
          {
            code: BLOCKED_REASON_CODES.COST_APPROVAL_PENDING,
            resolved_at: null,
          },
        ],
      },
    };
    const items = listRecordNeedsAttention(record, {
      costs: [
        {
          id: "c1",
          actual_amount: 1150,
          client_approval_status: "approved",
          paid_at: "2026-08-10T00:00:00.000Z",
          client_billed_at: "2026-08-11T00:00:00.000Z",
          qb_sync_status: "failed",
        },
      ],
    });
    assert.ok(!items.some((item) => item.code === BLOCKED_REASON_CODES.COST_APPROVAL_PENDING));
    assert.ok(items.some((item) => item.code === BLOCKED_REASON_CODES.COST_QB_FAILED));
  });

  it("excludes Stage 4 outbound package transmissions (null classification)", () => {
    const row = {
      direction: "outbound",
      classification: null,
      needs_human_attention: false,
      raw_subject: "Utility Coordination Application Package — Highland Springs",
      agent_processed_metadata: {
        source: "stage4_live_transmit",
        stage5_handoff: true,
      },
    };
    assert.equal(isOwnOutboundPackageEcho(row), true);
    assert.equal(isOutboundTransmission(row), true);
    assert.equal(isActionableNeedsAttentionCommunication(row), false);
  });

  it("excludes PEPCO outbound unclassified portal messages", () => {
    const row = {
      direction: "outbound",
      classification: null,
      needs_human_attention: true,
      raw_subject: "Submitted",
      sender: "Portal user",
      recipient: "PEPCO",
      agent_processed_metadata: { source: "portal_sync", provider_slug: "pepco" },
    };
    assert.equal(isActionableNeedsAttentionCommunication(row), false);
  });

  it("includes unclassified inbound utility communications", () => {
    const row = {
      direction: "inbound",
      classification: null,
      needs_human_attention: false,
      raw_subject: "Your application update",
    };
    assert.equal(isActionableNeedsAttentionCommunication(row), true);
  });

  it("includes low-confidence inbound classification", () => {
    const row = {
      direction: "inbound",
      classification: "status_update",
      classification_confidence: 0.4,
      needs_human_attention: false,
    };
    assert.equal(isActionableNeedsAttentionCommunication(row), true);
  });

  it("excludes rejected and completed acknowledgments", () => {
    assert.equal(
      isActionableNeedsAttentionCommunication({
        direction: "inbound",
        classification: "unclassified",
        needs_human_attention: true,
        agent_processed_metadata: { rejected_irrelevant: true },
      }),
      false,
    );
    assert.equal(
      isActionableNeedsAttentionCommunication({
        direction: "inbound",
        classification: "acknowledgment",
        needs_human_attention: true,
        agent_processed_metadata: { stage_5_auto_completed: true },
      }),
      false,
    );
  });

  it("excludes confirmed/resolved review items", () => {
    assert.equal(
      isActionableNeedsAttentionCommunication({
        direction: "inbound",
        classification: "acknowledgment",
        needs_human_attention: false,
        reviewed_at: "2026-08-19T12:00:00.000Z",
        agent_processed_metadata: {
          human_confirmed: true,
          review_decision: { action: "confirm" },
        },
      }),
      false,
    );
  });

  it("includes flagged-for-review and missing acknowledgment data", () => {
    assert.equal(
      isActionableNeedsAttentionCommunication({
        direction: "inbound",
        classification: "acknowledgment",
        classification_confidence: 0.95,
        needs_human_attention: false,
        agent_processed_metadata: { flagged_for_review: true },
      }),
      true,
    );
    assert.equal(
      isActionableNeedsAttentionCommunication({
        direction: "inbound",
        classification: "acknowledgment",
        classification_confidence: 0.95,
        needs_human_attention: true,
        agent_processed_metadata: {
          stage_5_incomplete: { reason: "missing_utility_pm" },
        },
      }),
      true,
    );
  });

  it("excludes inert synthetic unclassified test artifacts from Needs Attention", () => {
    assert.equal(
      isActionableNeedsAttentionCommunication({
        direction: "inbound",
        classification: "unclassified",
        classification_confidence: 0.6,
        needs_human_attention: true,
        raw_subject: "Synthetic test -Highland Springs LC 451497",
        raw_body: "test\r\n",
      }),
      false,
    );
    assert.equal(
      isActionableNeedsAttentionCommunication({
        direction: "inbound",
        classification: "unclassified",
        classification_confidence: 0.6,
        needs_human_attention: true,
        raw_subject:
          "[TEST] Utility Coordination Application Package — McDonald's Highland Springs, VA - LC 451497",
        raw_body: "Please find attached the utility coordination application package.",
      }),
      false,
    );
    // Proper Stage 6 COS synthetic with open attention remains actionable.
    assert.equal(
      isActionableNeedsAttentionCommunication({
        direction: "inbound",
        classification: "class_of_service",
        classification_confidence: 0.95,
        needs_human_attention: true,
        raw_subject:
          "[SYNTHETIC TEST] Class of Service — Highland Springs matching COS (auto-poller UAT)",
        raw_body: "SYNTHETIC TEST — NOT A REAL DOMINION / UTILITY DOCUMENT",
        agent_processed_metadata: {
          stage_6_cos: { review_status: "ready_for_approval" },
        },
      }),
      true,
    );
    assert.equal(
      isActionableNeedsAttentionCommunication({
        direction: "inbound",
        classification: "class_of_service",
        classification_confidence: 0.95,
        needs_human_attention: true,
        agent_processed_metadata: {
          stage_6_auto_completed: true,
          stage_6_cos: { auto_completed: true, review_status: "approved" },
        },
      }),
      false,
    );
  });
});
