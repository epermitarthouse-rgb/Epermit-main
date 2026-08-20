import { describe, expect, it } from "vitest";
import type { CoordinationCommunication } from "@/types/uci";
import {
  buildCommunicationCardModel,
  buildCommunicationReviewTimeline,
  buildInboxAuditHistoryModel,
  buildStage5CommunicationsBanner,
  formatCommunicationSubjectForDisplay,
  getCommunicationActionPlan,
  getNeedsAttentionReasons,
  groupInboxItemsByThread,
  isCommunicationActionableForInbox,
  isSyntheticUatCommunication,
  partitionOperatorInboxFeed,
  sanitizeOperatorCommunicationText,
  shouldDemoteSyntheticToInboxHistory,
} from "./uciCommunicationPresentation";

function baseComm(overrides: Partial<CoordinationCommunication> = {}): CoordinationCommunication {
  return {
    id: "c1",
    coordination_record_id: "r1",
    project_id: "p1",
    direction: "inbound",
    channel: "email",
    classification: "acknowledgment",
    classification_confidence: 0.95,
    raw_subject: "Ack for s5uat-1787087372337-full",
    raw_body: "Thanks",
    raw_attachments: [],
    parsed_summary: null,
    parsed_action_items: [],
    thread_id: null,
    needs_human_attention: false,
    reviewed_by: null,
    reviewed_at: null,
    agent_processed_metadata: {
      extracted_fields: {
        utility_ticket_number: "UAT-HS-S5-87372337",
        utility_project_manager: "Jordan Hale",
        acknowledgment_date: "2026-08-19",
        next_required_action: "Monitor for class of service / design review",
      },
      stage_5_auto_completed: true,
    },
    message_timestamp: "2026-08-19T12:00:00.000Z",
    created_at: "2026-08-19T12:00:00.000Z",
    ...overrides,
  };
}

describe("uciCommunicationPresentation", () => {
  it("hides UAT internal ids and nopm/PM-less shorthand", () => {
    expect(sanitizeOperatorCommunicationText("PM-less ack nopm s5uat-123 s5neg-x")).toBe(
      "Utility contact not assigned ack",
    );
    expect(formatCommunicationSubjectForDisplay("Ack s5uat-1787087372337-full")).toBe("Ack");
  });

  it("builds structured ack summary for completed acknowledgments", () => {
    const model = buildCommunicationCardModel(baseComm(), {
      providerName: "Dominion Energy Virginia",
      record: {
        id: "r1",
        project_id: "p1",
        user_id: null,
        tenant_id: null,
        utility_provider_id: "u1",
        utility_type: "electric",
        scope_description: "",
        current_stage: 5,
        current_stage_state: "COMPLETED",
        utility_account_number: null,
        utility_contact_name: "Jordan Hale",
        utility_contact_email: null,
        utility_contact_phone: null,
        application_submitted_at: null,
        acknowledgment_received_at: "2026-08-19T12:00:00.000Z",
        class_of_service_issued_at: null,
        energization_target_date: null,
        energization_actual_date: null,
        predicted_p50_date: null,
        predicted_p90_date: null,
        agent_monitored: true,
        last_error: null,
        metadata: {},
        created_at: "2026-08-19T12:00:00.000Z",
        updated_at: "2026-08-19T12:00:00.000Z",
      },
    });
    expect(model.title).toBe("Dominion Energy Virginia — Acknowledgment");
    expect(model.subtitle).toMatch(/95% confidence/);
    expect(model.subtitle).toMatch(/Stage 5 completed/);
    expect(model.detailLine).toMatch(/Ticket UAT-HS-S5-87372337/);
    expect(model.detailLine).toMatch(/PM Jordan Hale/);
    expect(model.nextLine).toMatch(/Monitor for class of service/);
    expect(model.actions.showConfirm).toBe(false);
    expect(model.actions.showViewHistory).toBe(true);
  });

  it("uses operator language for missing utility PM", () => {
    const comm = baseComm({
      needs_human_attention: true,
      classification_confidence: 0.95,
      agent_processed_metadata: {
        extracted_fields: { utility_ticket_number: "T-1" },
        stage_5_incomplete: { reason: "missing_utility_pm" },
      },
    });
    expect(getNeedsAttentionReasons(comm)).toContain(
      "Utility project manager/coordinator not assigned",
    );
    const model = buildCommunicationCardModel(comm, { providerName: "Dominion Energy Virginia" });
    expect(model.title).toBe(
      "Dominion Energy Virginia — Acknowledgment — Utility contact not assigned",
    );
    expect(model.subtitle).toMatch(/Why this needs attention/);
    expect(model.subtitle).toMatch(/Utility project manager\/coordinator not assigned/);
    expect(model.actions.showConfirm).toBe(true);
    expect(model.actions.showReject).toBe(true);
  });

  it("excludes outbound package transmissions from needs-attention", () => {
    const outbound = baseComm({
      direction: "outbound",
      classification: null,
      needs_human_attention: false,
      raw_subject: "Utility Coordination Application Package — Highland Springs",
      agent_processed_metadata: {
        source: "stage4_live_transmit",
        stage5_handoff: true,
      },
    });
    expect(getNeedsAttentionReasons(outbound)).toEqual([]);
    expect(getCommunicationActionPlan(outbound).needsAttention).toBe(false);
    const model = buildCommunicationCardModel(outbound, { providerName: "Dominion Energy Virginia" });
    expect(model.title).toMatch(/Outbound transmission/);
    expect(model.subtitle).toMatch(/not operator attention/);
    expect(model.actions.needsAttention).toBe(false);
  });

  it("excludes PEPCO outbound unclassified from needs-attention", () => {
    const pepcoOutbound = baseComm({
      direction: "outbound",
      classification: null,
      needs_human_attention: true,
      raw_subject: "Submitted",
      sender: "Portal user",
      recipient: "PEPCO",
      agent_processed_metadata: { source: "portal_sync", provider_slug: "pepco" },
    });
    expect(getCommunicationActionPlan(pepcoOutbound).needsAttention).toBe(false);
    expect(getNeedsAttentionReasons(pepcoOutbound)).toEqual([]);
  });

  it("hides Confirm for rejected communications", () => {
    const plan = getCommunicationActionPlan(
      baseComm({
        needs_human_attention: false,
        agent_processed_metadata: {
          rejected_irrelevant: true,
          review_decision: { action: "reject_irrelevant", reviewed_by: "op-1" },
        },
        reviewed_by: "op-1",
        reviewed_at: "2026-08-19T13:00:00.000Z",
      }),
    );
    expect(plan.showConfirm).toBe(false);
    expect(plan.rejected).toBe(true);
  });

  it("builds operator review timeline without internal ids", () => {
    const comm = baseComm({
      reviewed_by: "operator@example.com",
      reviewed_at: "2026-08-19T13:30:00.000Z",
      agent_processed_metadata: {
        extracted_fields: {
          utility_ticket_number: "UAT-HS-S5-87372337",
          utility_project_manager: "Jordan Hale",
          acknowledgment_date: "2026-08-19",
        },
        stage_5_auto_completed: true,
        stage_5_completion: { completed: true, completed_at: "2026-08-19T13:30:00.000Z", sla_stopped: true },
        match: { matched: true, matched_at: "2026-08-19T12:05:00.000Z" },
        review_decision: { action: "confirm", reviewed_by: "operator@example.com" },
        human_confirmed: true,
      },
    });
    const timeline = buildCommunicationReviewTimeline(comm, {
      id: "r1",
      project_id: "p1",
      user_id: null,
      tenant_id: null,
      utility_provider_id: "u1",
      utility_type: "electric",
      scope_description: "",
      current_stage: 5,
      current_stage_state: "COMPLETED",
      utility_account_number: null,
      utility_contact_name: "Jordan Hale",
      utility_contact_email: null,
      utility_contact_phone: null,
      application_submitted_at: null,
      acknowledgment_received_at: "2026-08-19T12:00:00.000Z",
      class_of_service_issued_at: null,
      energization_target_date: null,
      energization_actual_date: null,
      predicted_p50_date: null,
      predicted_p90_date: null,
      agent_monitored: true,
      last_error: null,
      metadata: {},
      created_at: "2026-08-19T12:00:00.000Z",
      updated_at: "2026-08-19T12:00:00.000Z",
    });
    expect(timeline.some((event) => event.label === "Message received")).toBe(true);
    expect(timeline.some((event) => event.label === "Classified as acknowledgment")).toBe(true);
    expect(timeline.some((event) => event.label === "Stage 5 completed")).toBe(true);
    expect(JSON.stringify(timeline)).not.toMatch(/s5uat-/);
  });

  it("builds Stage 5 communications banner copy", () => {
    const baseRecord = {
      id: "r1",
      project_id: "p1",
      user_id: null,
      tenant_id: null,
      utility_provider_id: "u1",
      utility_type: "electric",
      scope_description: "",
      current_stage: 5,
      current_stage_state: "AWAITING_UTILITY",
      utility_account_number: null,
      utility_contact_name: null,
      utility_contact_email: null,
      utility_contact_phone: null,
      application_submitted_at: null,
      acknowledgment_received_at: null,
      class_of_service_issued_at: null,
      energization_target_date: null,
      energization_actual_date: null,
      predicted_p50_date: null,
      predicted_p90_date: null,
      agent_monitored: true,
      last_error: null,
      metadata: {},
      created_at: "2026-08-19T12:00:00.000Z",
      updated_at: "2026-08-19T12:00:00.000Z",
    } as const;

    const awaiting = buildStage5CommunicationsBanner(baseRecord);
    expect(awaiting?.title).toMatch(/Awaiting utility acknowledgment/);

    const completed = buildStage5CommunicationsBanner(
      {
        ...baseRecord,
        current_stage_state: "COMPLETED",
        acknowledgment_received_at: "2026-08-19T12:00:00.000Z",
      },
      [],
    );
    expect(completed?.title).toMatch(/Completed — acknowledged Aug 19, 2026/);
  });

  it("detects synthetic UAT and demotes resolved items from primary Inbox", () => {
    const resolvedSynthetic = baseComm({
      raw_subject:
        "[UCI SYNTHETIC TEST] Dominion acknowledgment — Highland Springs (s5uat-1787087372337-full)",
      raw_body: "SYNTHETIC / TEST ONLY — NOT a real Dominion Energy acknowledgment.",
      needs_human_attention: false,
      agent_processed_metadata: {
        extracted_fields: {
          utility_ticket_number: "UAT-HS-S5-87372337",
          utility_project_manager: "Jordan Hale",
        },
        stage_5_auto_completed: true,
        uat: true,
      },
    });
    const actionableSynthetic = baseComm({
      id: "c2",
      raw_subject: "[UCI SYNTHETIC TEST] Ack WITHOUT PM — Highland Springs (s5neg-1-nopm)",
      raw_body: "SYNTHETIC / TEST ONLY — No utility project manager named.",
      needs_human_attention: true,
      classification_confidence: 0.95,
      agent_processed_metadata: {
        extracted_fields: { utility_ticket_number: "UAT-HS-S5-NEG-1" },
        stage_5_incomplete: { reason: "missing_utility_pm" },
      },
    });
    const production = baseComm({
      id: "c3",
      raw_subject: "RE: Application received — WO-12345",
      raw_body: "We acknowledge receipt.",
      thread_id: "thread-a",
      needs_human_attention: false,
      agent_processed_metadata: {
        extracted_fields: {
          utility_ticket_number: "WO-12345",
          utility_project_manager: "Alex Rivera",
        },
        stage_5_auto_completed: true,
      },
    });

    expect(isSyntheticUatCommunication(resolvedSynthetic)).toBe(true);
    expect(isSyntheticUatCommunication(actionableSynthetic)).toBe(true);
    expect(isSyntheticUatCommunication(production)).toBe(false);
    expect(shouldDemoteSyntheticToInboxHistory(resolvedSynthetic)).toBe(true);
    expect(isCommunicationActionableForInbox(actionableSynthetic)).toBe(true);
    expect(shouldDemoteSyntheticToInboxHistory(actionableSynthetic)).toBe(false);

    const record = { id: "r1" } as never;
    const { primary, auditHistory } = partitionOperatorInboxFeed([
      { record, message: resolvedSynthetic },
      { record, message: actionableSynthetic },
      { record, message: production },
    ]);
    expect(auditHistory.map((item) => item.message.id)).toEqual(["c1"]);
    expect(primary.map((item) => item.message.id).sort()).toEqual(["c2", "c3"]);

    const productionSibling = baseComm({
      id: "c4",
      raw_subject: "RE: Application received — follow-up",
      raw_body: "Additional note",
      thread_id: "thread-a",
      message_timestamp: "2026-08-19T13:00:00.000Z",
      agent_processed_metadata: { extracted_fields: { utility_ticket_number: "WO-12345" } },
    });
    const threads = groupInboxItemsByThread([
      { record, message: production },
      { record, message: productionSibling },
      { record, message: actionableSynthetic },
    ]);
    expect(threads).toHaveLength(2);
    const threaded = threads.find((group) => group.threadId === "thread-a");
    expect(threaded?.messages).toHaveLength(2);
    expect(threaded?.latest.id).toBe("c4");

    const audit = buildInboxAuditHistoryModel(resolvedSynthetic);
    expect(audit.ticketOrReference).toBe("UAT-HS-S5-87372337");
    expect(audit.testStatus).toMatch(/synthetic UAT/i);
    expect(audit.detailLine).toMatch(/Received/);
    expect(audit.detailLine).toMatch(/UAT-HS-S5-87372337/);
  });

  it("demotes inert unclassified synthetic test artifacts to Inbox audit history", () => {
    const crudeCosSelfTest = baseComm({
      id: "u1",
      classification: "unclassified",
      classification_confidence: 0.6,
      needs_human_attention: true,
      raw_subject: "Synthetic test -Highland Springs LC 451497",
      raw_body: "test\r\n",
      agent_processed_metadata: {},
    });
    const packageEcho = baseComm({
      id: "u2",
      classification: "unclassified",
      classification_confidence: 0.6,
      needs_human_attention: true,
      raw_subject:
        "[TEST] Utility Coordination Application Package — McDonald's Highland Springs, VA - LC 451497",
      raw_body: "Please find attached the utility coordination application package.",
      agent_processed_metadata: {},
    });
    const matchingCos = baseComm({
      id: "u3",
      classification: "class_of_service",
      classification_confidence: 0.95,
      needs_human_attention: false,
      raw_subject:
        "[SYNTHETIC TEST] Class of Service — matching COS (auto-poller UAT)",
      raw_body: "SYNTHETIC TEST — NOT A REAL DOMINION / UTILITY DOCUMENT",
      agent_processed_metadata: {
        stage_6_auto_completed: true,
        stage_6_cos: {
          review_status: "approved",
          auto_completed: true,
          discrepancy_report: { source_communication_id: "u3", clean_match: true },
        },
      },
    });

    expect(isSyntheticUatCommunication(crudeCosSelfTest)).toBe(true);
    expect(isSyntheticUatCommunication(packageEcho)).toBe(true);
    expect(isSyntheticUatCommunication(matchingCos)).toBe(true);
    expect(shouldDemoteSyntheticToInboxHistory(crudeCosSelfTest)).toBe(true);
    expect(shouldDemoteSyntheticToInboxHistory(packageEcho)).toBe(true);
    // Clean-match auto-completed Stage 6 COS is resolved — demote synthetic to audit history.
    expect(isCommunicationActionableForInbox(matchingCos)).toBe(false);
    expect(shouldDemoteSyntheticToInboxHistory(matchingCos)).toBe(true);
    expect(getNeedsAttentionReasons(crudeCosSelfTest)).toEqual([]);
    expect(getCommunicationActionPlan(crudeCosSelfTest).needsAttention).toBe(false);

    const record = { id: "r1" } as never;
    const { primary, auditHistory } = partitionOperatorInboxFeed([
      { record, message: crudeCosSelfTest },
      { record, message: packageEcho },
      { record, message: matchingCos },
    ]);
    expect(auditHistory.map((item) => item.message.id).sort()).toEqual(["u1", "u2", "u3"]);
    expect(primary.map((item) => item.message.id)).toEqual([]);
  });
});
