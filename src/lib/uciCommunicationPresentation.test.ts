import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildInboxConversationCardModel,
  getCommunicationActionPlan,
  getNeedsAttentionReasons,
  groupInboxItemsByThread,
  partitionOperatorInboxFeed,
} from "./uciCommunicationPresentation";
import type { CoordinationCommunication, CoordinationRecord } from "../types/uci";

function comm(
  overrides: Partial<CoordinationCommunication> & { id: string },
): CoordinationCommunication {
  return {
    coordination_record_id: "rec-1",
    project_id: "proj-1",
    direction: "inbound",
    channel: "email",
    classification: "acknowledgment",
    classification_confidence: 0.9,
    raw_subject: "Application received",
    raw_body: "We have received your application.",
    raw_attachments: null,
    parsed_summary: "Utility acknowledged the Highland Springs application.",
    parsed_action_items: [],
    thread_id: null,
    needs_human_attention: false,
    reviewed_by: null,
    reviewed_at: null,
    agent_processed_metadata: {},
    created_at: "2026-08-20T12:00:00.000Z",
    message_timestamp: "2026-08-20T12:00:00.000Z",
    ...overrides,
  };
}

const record = {
  id: "rec-1",
  project_id: "proj-1",
  current_stage: 5,
  current_stage_state: "IN_PROGRESS",
} as CoordinationRecord;

describe("inbox conversation grouping", () => {
  it("groups two messages with the same Graph thread_id as one conversation", () => {
    const items = [
      {
        record,
        message: comm({
          id: "m1",
          thread_id: "conv-highland",
          message_timestamp: "2026-08-20T12:00:00.000Z",
        }),
      },
      {
        record,
        message: comm({
          id: "m2",
          thread_id: "conv-highland",
          raw_subject: "Re: Application received",
          message_timestamp: "2026-08-20T13:00:00.000Z",
        }),
      },
      {
        record,
        message: comm({ id: "m3", thread_id: "conv-other", raw_subject: "COS issued" }),
      },
    ];
    const groups = groupInboxItemsByThread(items);
    assert.equal(groups.length, 2);
    const threaded = groups.find((group) => group.threadId === "conv-highland");
    assert.equal(threaded?.messages.length, 2);
    assert.equal(threaded?.latest.id, "m2");
  });

  it("falls back to normalized subject on the same record when thread_id is missing", () => {
    const items = [
      { record, message: comm({ id: "a", raw_subject: "Application received" }) },
      { record, message: comm({ id: "b", raw_subject: "Re: Application received" }) },
    ];
    const groups = groupInboxItemsByThread(items);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.grouping, "subject");
    assert.equal(groups[0]?.messages.length, 2);
  });

  it("renders one conversation card with message count only when >1", () => {
    const groups = groupInboxItemsByThread([
      { record, message: comm({ id: "a", thread_id: "t1" }) },
      { record, message: comm({ id: "b", thread_id: "t1", raw_subject: "Re: Application received" }) },
    ]);
    const model = buildInboxConversationCardModel(groups[0]!, {
      projectName: "McDonald's Highland Springs",
      providerName: "Dominion Energy Virginia",
      record,
    });
    assert.equal(model.showMessageCount, true);
    assert.equal(model.messageCount, 2);
    assert.equal(model.projectName, "McDonald's Highland Springs");
    assert.match(model.summary || "", /Highland Springs/i);
    assert.doesNotMatch(model.subject, /rec-1|comm-/);
  });
});

describe("needs attention reasons", () => {
  it("does not use the generic Needs human review label", () => {
    const reasons = getNeedsAttentionReasons(
      comm({
        id: "low",
        classification: "status_update" as never,
        classification_confidence: 0.4,
        needs_human_attention: true,
      }),
      record,
    );
    assert.ok(reasons.length > 0);
    assert.equal(reasons.includes("Needs human review"), false);
  });

  it("names COS capacity, missing PM, unmatched, and CIAC hold", () => {
    assert.ok(
      getNeedsAttentionReasons(
        comm({
          id: "cos",
          classification: "class_of_service",
          needs_human_attention: true,
          agent_processed_metadata: {
            stage_6_cos: { review_status: "needs_attention" },
          },
        }),
        record,
      ).includes("Service capacity differs from submitted load"),
    );
    assert.ok(
      getNeedsAttentionReasons(
        comm({
          id: "pm",
          classification: "acknowledgment",
          needs_human_attention: true,
          agent_processed_metadata: { stage_5_incomplete: { reason: "missing_utility_pm" } },
        }),
        record,
      ).includes("Utility project manager/coordinator not assigned"),
    );
    assert.ok(
      getNeedsAttentionReasons(
        comm({
          id: "unmatched",
          needs_human_attention: true,
          agent_processed_metadata: { match: { matched: false } },
        }),
        record,
      ).includes("Unable to match coordination record"),
    );
    assert.ok(
      getNeedsAttentionReasons(
        comm({
          id: "ciac",
          classification: "ciac_invoice",
          needs_human_attention: true,
          agent_processed_metadata: { ciac: { variance_pct: 25 } },
        }),
        record,
      ).some((reason) => /CIAC variance exceeds 20%/.test(reason)),
    );
  });

  it("keeps resolved synthetic UAT in audit history, not primary inbox", () => {
    const { primary, auditHistory } = partitionOperatorInboxFeed([
      {
        record,
        message: comm({
          id: "uat",
          raw_subject: "[UCI SYNTHETIC TEST] ack",
          needs_human_attention: false,
          reviewed_at: "2026-08-19T12:00:00.000Z",
          agent_processed_metadata: { uat: true, human_confirmed: true },
        }),
      },
    ]);
    assert.equal(primary.length, 0);
    assert.equal(auditHistory.length, 1);
  });
});

describe("communication action plan", () => {
  it("shows Confirmed (not Confirm) for human-confirmed ack awaiting thread PM", () => {
    const plan = getCommunicationActionPlan(
      comm({
        id: "ack-confirmed",
        needs_human_attention: true,
        reviewed_at: "2026-08-21T00:34:37.238Z",
        agent_processed_metadata: {
          human_confirmed: true,
          stage_5_incomplete: { reason: "missing_utility_pm" },
          review_decision: { action: "confirm" },
        },
      }),
      record,
    );
    assert.equal(plan.showConfirm, false);
    assert.equal(plan.showConfirmed, true);
    assert.equal(plan.needsAttention, false);
  });

  it("shows Confirm for design review while Stage 5 is open", () => {
    const plan = getCommunicationActionPlan(
      comm({
        id: "design",
        classification: "design_review_response",
        classification_confidence: 0.95,
        agent_processed_metadata: {
          extracted_fields: {
            utility_project_manager: "Alex Morgan",
            utility_ticket_number: "DOM-DEMO-451554",
          },
        },
      }),
      { ...record, current_stage_state: "AWAITING_UTILITY" } as CoordinationRecord,
    );
    assert.equal(plan.showConfirm, true);
    assert.equal(plan.needsAttention, true);
  });

  it("shows Confirmed (not Confirm) for human-confirmed design review", () => {
    const plan = getCommunicationActionPlan(
      comm({
        id: "design-confirmed",
        classification: "design_review_response",
        classification_confidence: 0.95,
        needs_human_attention: true,
        reviewed_at: "2026-08-21T00:34:37.238Z",
        agent_processed_metadata: {
          human_confirmed: true,
          review_decision: { action: "confirm" },
          extracted_fields: {
            utility_project_manager: "Alex Morgan",
          },
        },
      }),
      { ...record, current_stage_state: "AWAITING_UTILITY" } as CoordinationRecord,
    );
    assert.equal(plan.showConfirm, false);
    assert.equal(plan.showConfirmed, true);
    assert.equal(plan.needsAttention, false);
  });

  it("clears ack attention when PM arrives from supplemental thread message", () => {
    const ack = comm({
      id: "727e3cad-e267-4b85-94e4-6e37f340ee66",
      classification: "acknowledgment",
      needs_human_attention: true,
      reviewed_at: "2026-08-21T00:34:37.238Z",
      thread_id: "conv-portsmouth",
      agent_processed_metadata: {
        human_confirmed: true,
        stage_5_incomplete: { reason: "missing_utility_pm" },
        review_decision: { action: "confirm" },
      },
    });
    const designReview = comm({
      id: "2f2b3ffe-9b8b-457b-b329-0d374ce769c9",
      classification: "design_review_response",
      thread_id: "conv-portsmouth",
      message_timestamp: "2026-08-21T01:00:00.000Z",
      agent_processed_metadata: {
        extracted_fields: {
          utility_project_manager: "Alex Morgan",
        },
      },
    });
    const siblings = [ack, designReview];
    const reasons = getNeedsAttentionReasons(ack, record, siblings);
    assert.equal(reasons.includes("Utility project manager/coordinator not assigned"), false);
    const plan = getCommunicationActionPlan(ack, record, { allCommunications: siblings });
    assert.equal(plan.showConfirm, false);
    assert.equal(plan.showConfirmed, true);
    assert.equal(plan.needsAttention, false);
  });

  it("does not flag confirmed design review when only stale needs_human_attention remains", () => {
    const reasons = getNeedsAttentionReasons(
      comm({
        id: "design-stale-flag",
        classification: "design_review_response",
        classification_confidence: 0.95,
        needs_human_attention: true,
        reviewed_at: "2026-08-21T00:34:37.238Z",
        agent_processed_metadata: {
          human_confirmed: true,
          review_decision: { action: "confirm" },
        },
      }),
      record,
    );
    assert.equal(reasons.includes("Service capacity differs from submitted load"), false);
  });
});
