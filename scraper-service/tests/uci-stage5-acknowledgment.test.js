"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  UCI_COMMUNICATION_CATEGORIES,
  LOW_CONFIDENCE_THRESHOLD,
  classifyCommunicationText,
  isValidCategory,
} = require("../app/services/uci/uci-communication-categories.js");
const {
  classifyWithLlmOrKeyword,
  normalizeLlmResult,
  getLlmClassifierConfig,
} = require("../app/services/uci/uci-llm-classifier.service.js");
const {
  classifyWithClaudeOrKeyword,
  normalizeClaudeResult,
} = require("../app/services/uci/uci-claude-classifier.service.js");
const {
  buildClassificationPatch,
  classifyCoordinationCommunications,
  reclassifyCommunication,
} = require("../app/services/uci/uci-communication-classifier.service.js");
const {
  addBusinessDays,
  slaMultiplierElapsed,
  startAcknowledgmentSla,
  stopAcknowledgmentSla,
  evaluateAcknowledgmentSla,
} = require("../app/services/uci/uci-ack-sla.service.js");
const {
  evaluateAutoAckEligibility,
  completeStage5Acknowledgment,
  maybeAutoCompleteFromCommunication,
  isRealUtilityPm,
} = require("../app/services/uci/uci-ack-acceptance.service.js");
const { scoreMatch, matchInboundToCoordination } = require("../app/services/uci/uci-communication-matcher.service.js");
const { canEnterStage6 } = require("../app/services/uci/uci-stage5-entry.service.js");
const {
  flagCommunicationForReview,
  confirmCommunicationReview,
} = require("../app/services/uci/uci-communication-review.service.js");
const { ingestInboundEmailMessage } = require("../app/services/uci/uci-graph-inbound.service.js");

describe("Stage 5 confidence threshold", () => {
  it("uses 0.75 everywhere for low confidence", () => {
    assert.equal(LOW_CONFIDENCE_THRESHOLD, 0.75);
  });

  it("marks escalation_or_problem keyword (0.74) as needs attention", () => {
    const result = classifyCommunicationText("Problem", "urgent escalation required");
    assert.equal(result.classification, "escalation_or_problem");
    assert.ok(result.classification_confidence < 0.75);
    assert.equal(result.needs_human_attention, true);
  });
});

describe("Stage 5 categories + keyword fallback", () => {
  it("exposes all 11 categories", () => {
    assert.equal(UCI_COMMUNICATION_CATEGORIES.length, 11);
    assert.ok(isValidCategory("acknowledgment"));
  });

  it("classifies acknowledgment with ticket extraction", () => {
    const result = classifyCommunicationText(
      "Application received",
      "We acknowledged your application. Ticket: WO-998877 assigned.",
    );
    assert.equal(result.classification, "acknowledgment");
    assert.ok(result.classification_confidence >= 0.75);
    assert.ok(result.extracted_fields.utility_ticket_number);
  });
});

describe("Stage 5 LLM classifier with keyword fallback", () => {
  it("falls back to keyword when no LLM provider configured", async () => {
    const result = await classifyWithLlmOrKeyword({
      subject: "Contract Sent",
      body: "payment due",
      env: {},
    });
    assert.equal(result.classification, "ciac_invoice");
    assert.ok(
      result.classifier_method === "keyword" || result.classifier_method === "keyword_fallback",
    );
  });

  it("selects OpenAI as primary when Anthropic key missing", () => {
    const config = getLlmClassifierConfig({
      OPENAI_API_KEY: "sk-test",
    });
    assert.equal(config.provider, "openai");
    assert.equal(config.enabled, true);
  });

  it("keeps Anthropic primary when Claude is configured", () => {
    const config = getLlmClassifierConfig({
      OPENAI_API_KEY: "sk-test",
      ANTHROPIC_API_KEY: "ant-test",
      UCI_CLAUDE_CLASSIFIER_ENABLED: "true",
    });
    assert.equal(config.provider, "anthropic");
  });

  it("uses OpenAI JSON when chat completion succeeds", async () => {
    const result = await classifyWithLlmOrKeyword({
      subject: "Hello",
      body: "opaque text",
      env: {
        OPENAI_API_KEY: "sk-test",
        UCI_LLM_CLASSIFIER_PROVIDER: "openai",
      },
      deps: {
        openaiCreateFn: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  classification: "acknowledgment",
                  confidence: 0.91,
                  summary: "Utility acknowledged the filing.",
                  action_items: [],
                  needs_human_attention: false,
                  extracted_fields: {
                    utility_ticket_number: "T-1",
                    utility_project_manager: "Alex PM",
                    next_required_action: "Monitor COS",
                  },
                }),
              },
            },
          ],
        }),
      },
    });
    assert.equal(result.classification, "acknowledgment");
    assert.equal(result.classifier_method, "llm");
    assert.equal(result.llm_provider, "openai");
    assert.equal(result.classification_confidence, 0.91);
  });

  it("falls back and flags attention on OpenAI failure", async () => {
    const result = await classifyWithLlmOrKeyword({
      subject: "Update",
      body: "routine notice",
      env: { OPENAI_API_KEY: "sk-test", UCI_LLM_CLASSIFIER_PROVIDER: "openai" },
      deps: {
        openaiCreateFn: async () => {
          throw new Error("provider down");
        },
      },
    });
    assert.equal(result.needs_human_attention, true);
    assert.equal(result.classifier_method, "keyword_fallback");
    assert.equal(result.llm_provider, "openai");
  });

  it("uses Anthropic JSON when fetch succeeds (compat path)", async () => {
    const result = await classifyWithClaudeOrKeyword({
      subject: "Hello",
      body: "opaque text",
      env: {
        ANTHROPIC_API_KEY: "test-key",
        UCI_CLAUDE_CLASSIFIER_ENABLED: "true",
        UCI_LLM_CLASSIFIER_PROVIDER: "anthropic",
      },
      deps: {
        fetchFn: async () => ({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    classification: "acknowledgment",
                    confidence: 0.91,
                    summary: "Utility acknowledged the filing.",
                    action_items: [],
                    needs_human_attention: false,
                    extracted_fields: {
                      utility_ticket_number: "T-1",
                      utility_project_manager: "Alex PM",
                      next_required_action: "Monitor COS",
                    },
                  }),
                },
              ],
            }),
        }),
      },
    });
    assert.equal(result.classification, "acknowledgment");
    assert.equal(result.classifier_method, "llm");
    assert.equal(result.llm_provider, "anthropic");
    assert.equal(result.classification_confidence, 0.91);
  });

  it("falls back and flags attention on Anthropic HTTP failure", async () => {
    const result = await classifyWithLlmOrKeyword({
      subject: "Update",
      body: "routine notice",
      env: {
        ANTHROPIC_API_KEY: "test-key",
        UCI_CLAUDE_CLASSIFIER_ENABLED: "true",
        UCI_LLM_CLASSIFIER_PROVIDER: "anthropic",
      },
      deps: {
        fetchFn: async () => ({
          ok: false,
          status: 500,
          text: async () => "boom",
        }),
      },
    });
    assert.equal(result.needs_human_attention, true);
    assert.equal(result.classifier_method, "keyword_fallback");
  });

  it("normalizeLlmResult rejects invalid categories", () => {
    const keyword = classifyCommunicationText("x", "y");
    const normalized = normalizeLlmResult(
      { classification: "not_real", confidence: 0.9 },
      keyword,
      { provider: "openai", model: "gpt-4o" },
    );
    assert.equal(normalized.classification, "unclassified");
  });

  it("normalizeClaudeResult rejects invalid categories (compat)", () => {
    const keyword = classifyCommunicationText("x", "y");
    const normalized = normalizeClaudeResult({ classification: "not_real", confidence: 0.9 }, keyword);
    assert.equal(normalized.classification, "unclassified");
  });
});

describe("Stage 5 SLA engine", () => {
  it("adds business days skipping weekends", () => {
    // Friday + 1 business day => Monday
    const friday = new Date(Date.UTC(2026, 7, 14)); // 2026-08-14
    const due = addBusinessDays(friday, 1);
    assert.equal(due.getUTCDay(), 1);
  });

  it("detects 2x multiplier", () => {
    const started = new Date("2026-01-01T00:00:00Z");
    const due = new Date("2026-01-06T00:00:00Z");
    const now = new Date("2026-01-11T00:00:00Z");
    assert.ok(slaMultiplierElapsed(started, due, now) >= 2);
  });

  it("starts and stops SLA on mock record", async () => {
    const tables = {
      coordination_records: [
        {
          id: "coord-1",
          project_id: "proj-1",
          utility_provider_id: null,
          metadata: {},
          ack_sla_started_at: null,
          ack_sla_due_at: null,
          ack_sla_stopped_at: null,
        },
      ],
      utility_providers: [],
    };
    const supabase = createTableMock(tables);
    const started = await startAcknowledgmentSla(supabase, { coordinationRecordId: "coord-1" });
    assert.equal(started.started, true);
    assert.ok(tables.coordination_records[0].ack_sla_started_at);
    const stopped = await stopAcknowledgmentSla(supabase, { coordinationRecordId: "coord-1" });
    assert.equal(stopped.stopped, true);
    assert.ok(tables.coordination_records[0].ack_sla_stopped_at);
  });

  it("escalates at 2x SLA", async () => {
    const startedAt = new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString();
    const dueAt = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString();
    const tables = {
      coordination_records: [
        {
          id: "coord-1",
          project_id: "proj-1",
          current_stage: 5,
          current_stage_state: "AWAITING_UTILITY",
          ack_sla_started_at: startedAt,
          ack_sla_due_at: dueAt,
          ack_sla_stopped_at: null,
          ack_sla_escalated_at: null,
          metadata: {},
        },
      ],
    };
    const supabase = createTableMock(tables);
    const result = await evaluateAcknowledgmentSla(supabase, "coord-1");
    assert.equal(result.double_sla, true);
    assert.ok(tables.coordination_records[0].ack_sla_escalated_at);
    assert.equal(tables.coordination_records[0].current_stage_state, "ESCALATED");
  });
});

describe("Stage 5 matching", () => {
  it("scores ticket and thread matches", () => {
    const { score, reasons } = scoreMatch(
      {
        raw_subject: "RE: Ticket WO-12345",
        raw_body: "update",
        sender: "pm@pepco.com",
        thread_id: "conv-1",
        provider_slug: "pepco",
      },
      {
        utility_ticket_number: "WO-12345",
        utility_contact_email: "pm@pepco.com",
        thread_id: "conv-1",
        provider_slug: "pepco",
      },
    );
    assert.ok(score >= 25);
    assert.ok(reasons.includes("ticket_number"));
    assert.ok(reasons.includes("thread_id"));
  });

  it("returns unmatched when no candidates score", async () => {
    const tables = {
      coordination_records: [
        {
          id: "coord-1",
          project_id: "proj-1",
          utility_provider_id: null,
          utility_account_number: null,
          utility_contact_email: null,
          metadata: {},
          updated_at: new Date().toISOString(),
        },
      ],
      coordination_applications: [],
      utility_providers: [],
      coordination_communications: [],
    };
    const result = await matchInboundToCoordination(
      createTableMock(tables),
      { raw_subject: "Hello", raw_body: "no identifiers", sender: "x@y.com" },
      { projectId: "proj-1" },
    );
    assert.equal(result.matched, false);
    assert.equal(result.unmatched, true);
  });
});

describe("Stage 5 ack acceptance + lifecycle safety", () => {
  it("blocks auto-complete when flagged or low confidence", () => {
    const low = evaluateAutoAckEligibility({
      classification: "acknowledgment",
      confidence: 0.7,
      matched: true,
      flagged: false,
      extracted: {
        utility_ticket_number: "T1",
        utility_project_manager: "Jordan",
      },
      record: {},
      application: {},
      messageTimestamp: new Date().toISOString(),
    });
    assert.equal(low.eligible, false);
    assert.equal(low.reason, "low_confidence");

    const flagged = evaluateAutoAckEligibility({
      classification: "acknowledgment",
      confidence: 0.9,
      matched: true,
      flagged: true,
      extracted: {
        utility_ticket_number: "T1",
        utility_project_manager: "Jordan",
      },
      record: {},
      application: {},
      messageTimestamp: new Date().toISOString(),
    });
    assert.equal(flagged.eligible, false);
    assert.equal(flagged.reason, "flagged_for_review");
  });

  it("allows high-confidence matched acknowledgment with ticket + real PM", () => {
    const ok = evaluateAutoAckEligibility({
      classification: "acknowledgment",
      confidence: 0.9,
      matched: true,
      flagged: false,
      extracted: {
        utility_ticket_number: "T-99",
        utility_project_manager: "Jordan",
        next_required_action: "Monitor COS",
      },
      record: { current_stage: 5 },
      application: {},
      messageTimestamp: "2026-08-19T00:00:00Z",
    });
    assert.equal(ok.eligible, true);
    assert.equal(ok.fields.pm, "Jordan");
  });

  it("rejects missing PM and placeholder PM for completion", () => {
    assert.equal(isRealUtilityPm("Pending utility contact"), false);
    assert.equal(isRealUtilityPm("TBD"), false);
    assert.equal(isRealUtilityPm("Jordan Lee"), true);

    const noPm = evaluateAutoAckEligibility({
      classification: "acknowledgment",
      confidence: 0.95,
      matched: true,
      flagged: false,
      extracted: { utility_ticket_number: "T-1" },
      record: {},
      application: {},
      messageTimestamp: "2026-08-19T00:00:00Z",
    });
    assert.equal(noPm.eligible, false);
    assert.equal(noPm.reason, "missing_utility_pm");

    const placeholder = evaluateAutoAckEligibility({
      classification: "acknowledgment",
      confidence: 0.95,
      matched: true,
      flagged: false,
      extracted: {
        utility_ticket_number: "T-1",
        utility_project_manager: "Pending utility contact",
      },
      record: {},
      application: {},
      messageTimestamp: "2026-08-19T00:00:00Z",
    });
    assert.equal(placeholder.eligible, false);
    assert.equal(placeholder.reason, "missing_utility_pm");
  });

  it("does not treat stale utility_contact_name / utility_project_manager as current PM", () => {
    const stale = evaluateAutoAckEligibility({
      classification: "acknowledgment",
      confidence: 0.95,
      matched: true,
      flagged: false,
      extracted: {
        utility_ticket_number: "T-STALE",
        // No PM on current acknowledgment evidence
      },
      record: {
        current_stage: 5,
        current_stage_state: "AWAITING_UTILITY",
        utility_project_manager: "Jordan Hale",
        utility_contact_name: "Jordan Hale",
        utility_account_number: "ACCT-OLD",
      },
      application: {},
      messageTimestamp: "2026-08-19T12:00:00Z",
    });
    assert.equal(stale.eligible, false);
    assert.equal(stale.reason, "missing_utility_pm");
    assert.equal(stale.fields.pm, null);
  });

  it("reopen archives prior PM/contact and blocks stale completion until current PM provided", async () => {
    const { reopenStage5Acknowledgment, maybeAutoCompleteFromCommunication } = require("../app/services/uci/uci-ack-acceptance.service.js");
    const tables = {
      coordination_records: [
        {
          id: "coord-1",
          project_id: "proj-1",
          current_stage: 5,
          current_stage_state: "COMPLETED",
          acknowledgment_received_at: "2026-08-18T21:10:14Z",
          utility_project_manager: "Jordan Hale",
          utility_contact_name: "Jordan Hale",
          utility_account_number: "ACCT-HS-451497",
          next_required_action: "Monitor COS",
          metadata: {
            stage_5_acknowledgment: {
              utility_project_manager: "Jordan Hale",
              utility_ticket_number: "T-FULL",
              source: "system",
            },
          },
          ack_sla_started_at: "2026-08-18T21:10:10Z",
          ack_sla_due_at: "2026-08-25T21:10:10Z",
          ack_sla_stopped_at: "2026-08-18T21:10:40Z",
        },
      ],
      coordination_stage_transitions: [],
      coordination_applications: [{ id: "app-1", coordination_record_id: "coord-1", utility_ticket_number: "T-FULL" }],
      coordination_communications: [
        {
          id: "comm-nopm",
          coordination_record_id: "coord-1",
          project_id: "proj-1",
          classification: "acknowledgment",
          classification_confidence: 0.95,
          message_timestamp: "2026-08-19T12:00:00Z",
          needs_human_attention: false,
          agent_processed_metadata: {
            extracted_fields: {
              utility_ticket_number: "T-NOPM",
              // intentionally no PM
            },
          },
        },
      ],
      utility_providers: [],
    };
    const supabase = createTableMock(tables);

    const reopened = await reopenStage5Acknowledgment(supabase, {
      coordinationRecordId: "coord-1",
      userId: "user-1",
      reason: "UAT reopen after completed acknowledgment",
      source: "user",
    });
    assert.equal(reopened.reopened, true);
    assert.equal(tables.coordination_records[0].current_stage_state, "AWAITING_UTILITY");
    assert.equal(tables.coordination_records[0].acknowledgment_received_at, null);
    assert.equal(tables.coordination_records[0].utility_project_manager, null);
    assert.equal(tables.coordination_records[0].utility_contact_name, null);
    assert.equal(tables.coordination_records[0].ack_sla_stopped_at, null);
    assert.ok(tables.coordination_records[0].ack_sla_started_at);
    const hist = tables.coordination_records[0].metadata.stage_5_acknowledgment_history;
    assert.ok(Array.isArray(hist) && hist.length >= 1);
    assert.equal(hist[0].utility_project_manager, "Jordan Hale");
    assert.equal(hist[0].utility_contact_name, "Jordan Hale");

    const auto = await maybeAutoCompleteFromCommunication(supabase, {
      communication: tables.coordination_communications[0],
    });
    assert.equal(auto.completed, false);
    assert.equal(auto.reason, "missing_utility_pm");
    assert.equal(tables.coordination_records[0].current_stage_state, "AWAITING_UTILITY");
    assert.equal(tables.coordination_records[0].ack_sla_stopped_at, null);
    assert.equal(tables.coordination_communications[0].needs_human_attention, true);

    // Reviewer supplies current PM → completes
    const { confirmCommunicationReview } = require("../app/services/uci/uci-communication-review.service.js");
    const confirmed = await confirmCommunicationReview(supabase, {
      communicationId: "comm-nopm",
      userId: "user-1",
      classification: "acknowledgment",
      extractedFields: {
        utility_ticket_number: "T-NOPM",
        utility_project_manager: "Casey Brooks",
        acknowledgment_date: "2026-08-19",
      },
      note: "Reviewer assigned current PM",
    });
    assert.equal(confirmed.lifecycle?.reconciled ?? confirmed.lifecycle?.completed, true);
    assert.equal(tables.coordination_records[0].current_stage, 6);
    assert.equal(tables.coordination_records[0].current_stage_state, "IN_PROGRESS");
    assert.ok(tables.coordination_records[0].acknowledgment_received_at);
    assert.equal(tables.coordination_records[0].utility_project_manager, "Casey Brooks");
    assert.ok(tables.coordination_records[0].ack_sla_stopped_at);
    const originalPm =
      tables.coordination_communications[0].agent_processed_metadata.review_decision
        .original_extracted_fields.utility_project_manager;
    assert.equal(originalPm == null, true);
    assert.equal(
      tables.coordination_communications[0].agent_processed_metadata.review_decision
        .reviewer_extracted_fields.utility_project_manager,
      "Casey Brooks",
    );
  });

  it("PM-less high-confidence ack stays AWAITING_UTILITY with Needs Attention; SLA stays active", async () => {
    const slaStarted = new Date().toISOString();
    const tables = {
      coordination_records: [
        {
          id: "coord-1",
          project_id: "proj-1",
          current_stage: 5,
          current_stage_state: "AWAITING_UTILITY",
          acknowledgment_received_at: null,
          metadata: {},
          ack_sla_started_at: slaStarted,
          ack_sla_due_at: new Date(Date.now() + 86400000).toISOString(),
          ack_sla_stopped_at: null,
        },
      ],
      coordination_applications: [{ id: "app-1", coordination_record_id: "coord-1", utility_ticket_number: null }],
      coordination_communications: [
        {
          id: "comm-1",
          coordination_record_id: "coord-1",
          project_id: "proj-1",
          classification: "acknowledgment",
          classification_confidence: 0.92,
          message_timestamp: "2026-08-19T12:00:00Z",
          needs_human_attention: false,
          agent_processed_metadata: {
            extracted_fields: { utility_ticket_number: "T-88" },
          },
        },
      ],
      coordination_stage_transitions: [],
    };
    const result = await maybeAutoCompleteFromCommunication(createTableMock(tables), {
      communication: tables.coordination_communications[0],
    });
    assert.equal(result.completed, false);
    assert.equal(result.reason, "missing_utility_pm");
    assert.equal(tables.coordination_records[0].current_stage_state, "AWAITING_UTILITY");
    assert.equal(tables.coordination_records[0].acknowledgment_received_at, null);
    assert.equal(tables.coordination_records[0].ack_sla_stopped_at, null);
    assert.ok(tables.coordination_records[0].metadata.stage_5_acknowledgment_evidence);
    assert.equal(tables.coordination_communications[0].needs_human_attention, true);
  });

  it("ack + ticket + date + real PM completes Stage 5 and stops SLA", async () => {
    const tables = {
      coordination_records: [
        {
          id: "coord-1",
          project_id: "proj-1",
          current_stage: 5,
          current_stage_state: "AWAITING_UTILITY",
          acknowledgment_received_at: null,
          metadata: {},
          ack_sla_started_at: new Date().toISOString(),
          ack_sla_due_at: new Date(Date.now() + 86400000).toISOString(),
          ack_sla_stopped_at: null,
        },
      ],
      coordination_stage_transitions: [],
      coordination_applications: [{ id: "app-1", coordination_record_id: "coord-1", utility_ticket_number: null }],
    };
    const supabase = createTableMock(tables);
    const result = await completeStage5Acknowledgment(supabase, {
      coordinationRecordId: "coord-1",
      source: "system",
      communicationId: "comm-1",
      fields: {
        ticket: "T-1",
        account: null,
        pm: "Alex",
        nextAction: "Monitor COS",
        ackDate: "2026-08-19T12:00:00Z",
      },
    });
    assert.equal(result.completed, true);
    assert.equal(result.stage_6_started, false);
    assert.equal(tables.coordination_records[0].current_stage, 5);
    assert.equal(tables.coordination_records[0].current_stage_state, "COMPLETED");
    assert.ok(tables.coordination_records[0].acknowledgment_received_at);
    assert.ok(tables.coordination_records[0].ack_sla_stopped_at);
    assert.equal(tables.coordination_records[0].utility_project_manager, "Alex");
    assert.equal(canEnterStage6(tables.coordination_records[0]), true);
  });

  it("completeStage5Acknowledgment rejects placeholder PM", async () => {
    const tables = {
      coordination_records: [
        {
          id: "coord-1",
          project_id: "proj-1",
          current_stage: 5,
          current_stage_state: "AWAITING_UTILITY",
          acknowledgment_received_at: null,
          metadata: {},
          ack_sla_started_at: new Date().toISOString(),
          ack_sla_stopped_at: null,
        },
      ],
      coordination_stage_transitions: [],
      coordination_applications: [],
    };
    await assert.rejects(
      () =>
        completeStage5Acknowledgment(createTableMock(tables), {
          coordinationRecordId: "coord-1",
          fields: {
            ticket: "T-1",
            account: null,
            pm: "Pending utility contact",
            nextAction: "x",
            ackDate: "2026-08-19T00:00:00Z",
          },
        }),
      (err) => err && err.code === "MISSING_UTILITY_PM",
    );
    assert.equal(tables.coordination_records[0].current_stage_state, "AWAITING_UTILITY");
    assert.equal(tables.coordination_records[0].ack_sla_stopped_at, null);
  });

  it("reviewer adding real PM completes Stage 5; incomplete confirm stays awaiting", async () => {
    const tables = {
      coordination_records: [
        {
          id: "coord-1",
          project_id: "proj-1",
          current_stage: 5,
          current_stage_state: "AWAITING_UTILITY",
          acknowledgment_received_at: null,
          metadata: {},
          ack_sla_started_at: new Date().toISOString(),
          ack_sla_due_at: new Date(Date.now() + 86400000).toISOString(),
          ack_sla_stopped_at: null,
        },
      ],
      coordination_applications: [{ id: "app-1", coordination_record_id: "coord-1", utility_ticket_number: null }],
      coordination_communications: [
        {
          id: "comm-1",
          coordination_record_id: "coord-1",
          project_id: "proj-1",
          classification: "acknowledgment",
          classification_confidence: 0.9,
          message_timestamp: "2026-08-19T10:00:00Z",
          needs_human_attention: true,
          agent_processed_metadata: {
            extracted_fields: { utility_ticket_number: "T-77" },
          },
        },
      ],
      coordination_stage_transitions: [],
    };
    const supabase = createTableMock(tables);

    const incomplete = await confirmCommunicationReview(supabase, {
      communicationId: "comm-1",
      userId: "user-1",
      classification: "acknowledgment",
      extractedFields: {},
      note: "Confirmed receipt but PM still missing",
    });
    assert.equal(incomplete.lifecycle?.completed, false);
    assert.equal(incomplete.lifecycle?.reason, "missing_utility_pm");
    assert.equal(tables.coordination_records[0].current_stage_state, "AWAITING_UTILITY");
    assert.equal(tables.coordination_records[0].ack_sla_stopped_at, null);
    assert.equal(tables.coordination_communications[0].needs_human_attention, true);
    assert.ok(
      tables.coordination_communications[0].agent_processed_metadata.review_decision
        .original_extracted_fields,
    );

    const complete = await confirmCommunicationReview(supabase, {
      communicationId: "comm-1",
      userId: "user-1",
      classification: "acknowledgment",
      extractedFields: { utility_project_manager: "Sam Rivera" },
      note: "PM assigned by reviewer",
    });
    assert.equal(complete.lifecycle?.reconciled ?? complete.lifecycle?.completed, true);
    assert.equal(tables.coordination_records[0].current_stage, 6);
    assert.equal(tables.coordination_records[0].current_stage_state, "IN_PROGRESS");
    assert.ok(tables.coordination_records[0].acknowledgment_received_at);
    assert.equal(tables.coordination_records[0].utility_project_manager, "Sam Rivera");
    assert.ok(tables.coordination_records[0].ack_sla_stopped_at);
    assert.equal(
      tables.coordination_communications[0].agent_processed_metadata.review_decision
        .reviewer_extracted_fields.utility_project_manager,
      "Sam Rivera",
    );
  });

  it("flagged item with complete data does not auto-complete", async () => {
    const tables = {
      coordination_records: [
        {
          id: "coord-1",
          project_id: "proj-1",
          current_stage: 5,
          current_stage_state: "AWAITING_UTILITY",
          acknowledgment_received_at: null,
          metadata: {},
          ack_sla_started_at: new Date().toISOString(),
          ack_sla_stopped_at: null,
        },
      ],
      coordination_applications: [],
      coordination_communications: [
        {
          id: "comm-1",
          coordination_record_id: "coord-1",
          project_id: "proj-1",
          classification: "acknowledgment",
          classification_confidence: 0.97,
          message_timestamp: "2026-08-19T12:00:00Z",
          needs_human_attention: true,
          agent_processed_metadata: {
            flagged_for_review: true,
            blocks_auto_lifecycle: true,
            extracted_fields: {
              utility_ticket_number: "T-1",
              utility_project_manager: "Alex",
            },
          },
        },
      ],
      coordination_stage_transitions: [],
    };
    const result = await maybeAutoCompleteFromCommunication(createTableMock(tables), {
      communication: tables.coordination_communications[0],
    });
    assert.equal(result.completed, false);
    assert.equal(result.reason, "flagged_for_review");
    assert.equal(tables.coordination_records[0].current_stage_state, "AWAITING_UTILITY");
    assert.equal(tables.coordination_records[0].ack_sla_stopped_at, null);
  });

  it("supplemental PM from later design review completes Stage 5 via reconcile", async () => {
    const {
      reconcileStage5FromCoordinationEvidence,
      loadCoordinationSupplementalFields,
    } = require("../app/services/uci/uci-ack-acceptance.service.js");
    const tables = {
      coordination_records: [
        {
          id: "coord-1",
          project_id: "proj-1",
          current_stage: 5,
          current_stage_state: "AWAITING_UTILITY",
          acknowledgment_received_at: null,
          metadata: {},
          ack_sla_started_at: new Date().toISOString(),
          ack_sla_due_at: new Date(Date.now() + 86400000).toISOString(),
          ack_sla_stopped_at: null,
        },
      ],
      coordination_applications: [
        { id: "app-1", coordination_record_id: "coord-1", utility_ticket_number: null },
      ],
      coordination_communications: [
        {
          id: "comm-ack",
          coordination_record_id: "coord-1",
          project_id: "proj-1",
          direction: "inbound",
          classification: "acknowledgment",
          classification_confidence: 1,
          message_timestamp: "2026-08-20T20:56:40+00:00",
          thread_id: "thread-root-AQA-ack",
          needs_human_attention: true,
          agent_processed_metadata: {
            human_confirmed: true,
            extracted_fields: { utility_ticket_number: "DOM-DEMO-451554" },
            review_decision: { action: "confirm" },
          },
        },
        {
          id: "comm-design",
          coordination_record_id: "coord-1",
          project_id: "proj-1",
          direction: "inbound",
          classification: "design_review_response",
          classification_confidence: 0.95,
          message_timestamp: "2026-08-21T01:00:00+00:00",
          thread_id: "thread-root-AQA-design",
          needs_human_attention: false,
          agent_processed_metadata: {
            extracted_fields: {
              utility_ticket_number: "DOM-DEMO-451554",
              utility_project_manager: "Alex Morgan",
            },
          },
        },
      ],
      coordination_stage_transitions: [],
    };
    const supabase = createTableMock(tables);
    const supplemental = await loadCoordinationSupplementalFields(supabase, {
      coordinationRecordId: "coord-1",
      anchorCommunicationId: "comm-ack",
      anchorTimestamp: "2026-08-20T20:56:40+00:00",
      threadId: "thread-root-AQA-ack",
    });
    assert.equal(supplemental.utility_project_manager, "Alex Morgan");
    assert.equal(supplemental.pm_source_communication_id, "comm-design");

    const result = await reconcileStage5FromCoordinationEvidence(supabase, {
      coordinationRecordId: "coord-1",
      triggerCommunicationId: "comm-design",
      userId: "user-1",
      source: "user",
      advanceStage6: false,
    });
    assert.equal(result.reconciled, true);
    assert.equal(result.completed, true);
    assert.equal(tables.coordination_records[0].current_stage_state, "COMPLETED");
    assert.equal(tables.coordination_records[0].utility_project_manager, "Alex Morgan");
    assert.ok(tables.coordination_records[0].ack_sla_stopped_at);
    assert.equal(tables.coordination_communications[0].needs_human_attention, false);
  });

  it("confirm design_review_response reconciles Stage 5 when ack already confirmed", async () => {
    const tables = {
      coordination_records: [
        {
          id: "coord-1",
          project_id: "proj-1",
          current_stage: 5,
          current_stage_state: "AWAITING_UTILITY",
          acknowledgment_received_at: null,
          metadata: {},
          ack_sla_started_at: new Date().toISOString(),
          ack_sla_due_at: new Date(Date.now() + 86400000).toISOString(),
          ack_sla_stopped_at: null,
        },
      ],
      coordination_applications: [
        { id: "app-1", coordination_record_id: "coord-1", utility_ticket_number: null },
      ],
      coordination_communications: [
        {
          id: "comm-ack",
          coordination_record_id: "coord-1",
          project_id: "proj-1",
          direction: "inbound",
          classification: "acknowledgment",
          classification_confidence: 1,
          message_timestamp: "2026-08-20T20:56:40+00:00",
          thread_id: "thread-a",
          needs_human_attention: true,
          agent_processed_metadata: {
            human_confirmed: true,
            extracted_fields: { utility_ticket_number: "DOM-DEMO-451554" },
            review_decision: { action: "confirm" },
          },
        },
        {
          id: "comm-design",
          coordination_record_id: "coord-1",
          project_id: "proj-1",
          direction: "inbound",
          classification: "design_review_response",
          classification_confidence: 0.95,
          message_timestamp: "2026-08-21T01:00:00+00:00",
          thread_id: "thread-b",
          needs_human_attention: false,
          agent_processed_metadata: {
            extracted_fields: {
              utility_ticket_number: "DOM-DEMO-451554",
              utility_project_manager: "Alex Morgan",
            },
          },
        },
      ],
      coordination_stage_transitions: [],
    };
    const supabase = createTableMock(tables);
    const confirmed = await confirmCommunicationReview(supabase, {
      communicationId: "comm-design",
      userId: "user-1",
      classification: "design_review_response",
      note: "Accept design review",
    });
    assert.equal(confirmed.lifecycle?.reconciled, true);
    assert.equal(tables.coordination_records[0].current_stage, 6);
    assert.equal(tables.coordination_records[0].current_stage_state, "IN_PROGRESS");
    assert.ok(tables.coordination_records[0].acknowledgment_received_at);
    assert.equal(tables.coordination_records[0].utility_project_manager, "Alex Morgan");
  });

  it("refuses duplicate Stage 5 complete", async () => {
    const tables = {
      coordination_records: [
        {
          id: "coord-1",
          project_id: "proj-1",
          current_stage: 5,
          current_stage_state: "COMPLETED",
          acknowledgment_received_at: "2026-08-01T00:00:00Z",
          metadata: {},
        },
      ],
      coordination_stage_transitions: [],
      coordination_applications: [],
    };
    const result = await completeStage5Acknowledgment(createTableMock(tables), {
      coordinationRecordId: "coord-1",
      fields: {
        ticket: "T-1",
        account: null,
        pm: "A",
        nextAction: "x",
        ackDate: "2026-08-19T00:00:00Z",
      },
    });
    assert.equal(result.already_completed, true);
    assert.equal(result.completed, false);
  });
});

describe("Stage 5 flag for review", () => {
  it("flags high-confidence message and blocks auto lifecycle metadata", async () => {
    const tables = {
      coordination_communications: [
        {
          id: "comm-1",
          project_id: "proj-1",
          coordination_record_id: "coord-1",
          classification: "acknowledgment",
          classification_confidence: 0.95,
          needs_human_attention: false,
          agent_processed_metadata: {
            extracted_fields: { utility_ticket_number: "T-1" },
          },
        },
      ],
    };
    const result = await flagCommunicationForReview(createTableMock(tables), {
      communicationId: "comm-1",
      userId: "user-1",
      note: "Looks suspicious",
    });
    assert.equal(result.flagged, true);
    assert.equal(tables.coordination_communications[0].needs_human_attention, true);
    assert.equal(
      tables.coordination_communications[0].agent_processed_metadata.blocks_auto_lifecycle,
      true,
    );
    assert.equal(
      tables.coordination_communications[0].agent_processed_metadata.flag_for_review
        .preserved_confidence,
      0.95,
    );
  });
});

describe("Stage 5 classify + reclassify integration", () => {
  it("classifies unclassified portal rows", async () => {
    const tables = {
      coordination_communications: [
        {
          id: "comm-1",
          coordination_record_id: "coord-1",
          project_id: "proj-1",
          classification: null,
          raw_subject: "Contract Sent",
          raw_body: "payment due",
          needs_human_attention: true,
          agent_processed_metadata: {},
          message_timestamp: new Date().toISOString(),
        },
      ],
      coordination_records: [
        {
          id: "coord-1",
          project_id: "proj-1",
          current_stage: 5,
          current_stage_state: "AWAITING_UTILITY",
          metadata: {},
        },
      ],
      coordination_applications: [],
      coordination_stage_transitions: [],
    };

    const result = await classifyCoordinationCommunications(createTableMock(tables), {
      coordinationRecordId: "coord-1",
      projectId: "proj-1",
      deps: { env: {} },
    });
    assert.equal(result.classified_count, 1);
    assert.equal(tables.coordination_communications[0].classification, "ciac_invoice");
    assert.equal(result.confidence_threshold, 0.75);
  });

  it("reclassifies with audit of previous machine classification", async () => {
    const tables = {
      coordination_communications: [
        {
          id: "comm-1",
          coordination_record_id: "coord-1",
          project_id: "proj-1",
          classification: "unclassified",
          classification_confidence: 0.35,
          agent_processed_metadata: {
            agent_5_classification: { method: "keyword", version: "x" },
          },
        },
      ],
      coordination_records: [
        {
          id: "coord-1",
          project_id: "proj-1",
          current_stage: 5,
          current_stage_state: "AWAITING_UTILITY",
          metadata: {},
        },
      ],
      coordination_applications: [],
      coordination_stage_transitions: [],
    };
    const result = await reclassifyCommunication(createTableMock(tables), {
      communicationId: "comm-1",
      userId: "user-1",
      review: { classification: "request_for_information", notes: "RFI confirmed" },
    });
    assert.equal(result.classification, "request_for_information");
    assert.equal(
      tables.coordination_communications[0].agent_processed_metadata.reclassification
        .previous_classification,
      "unclassified",
    );
  });

  it("buildClassificationPatch is async and preserves portal attention", async () => {
    const patch = await buildClassificationPatch({
      raw_subject: "Update",
      raw_body: "hello",
      needs_human_attention: true,
      agent_processed_metadata: { source: "portal_sync" },
    });
    assert.equal(patch.needs_human_attention, true);
    assert.ok(patch.agent_processed_metadata.agent_5_classification);
  });
});

describe("Stage 5 matcher — synthetic demo ack", () => {
  it("matches [UCI SYNTHETIC DEMO] ack body to outbound LC subject", () => {
    const inbound = {
      raw_subject: "[UCI SYNTHETIC DEMO]",
      raw_body:
        "Dominion Energy has received the utility coordination application package for McDonald's Portsmouth, VA - LC 451554.\nApplication reference: DOM-DEMO-451554\nStatus: Received and under review.",
      sender: "epermitarthouse@gmail.com",
      provider_slug: "dominion",
    };
    const candidate = {
      provider_slug: "dominion",
      outbound_subject:
        "Utility Coordination Application Package — McDonald's Portsmouth, VA - LC 451554",
    };
    const { score, reasons } = scoreMatch(inbound, candidate);
    assert.ok(score >= 25, `expected score >= 25, got ${score}`);
    assert.ok(reasons.includes("lc_outbound_subject"));
    assert.ok(reasons.includes("outbound_location_in_body"));
    assert.ok(reasons.includes("dom_demo_ref"));
  });
});

describe("Stage 5 Graph inbound unmatched path", () => {
  it("stores unmatched inbound without inventing a coordination link", async () => {
    const tables = {
      coordination_records: [],
      coordination_applications: [],
      utility_providers: [],
      coordination_communications: [],
      uci_unmatched_inbound_messages: [],
    };
    const result = await ingestInboundEmailMessage(createTableMock(tables), {
      normalized: {
        external_message_id: "m1",
        internet_message_id: "<m1@x>",
        conversation_id: "c1",
        thread_id: "c1",
        raw_subject: "Hello",
        raw_body: "no match keys",
        sender: "utility@example.com",
        recipient: null,
        message_timestamp: new Date().toISOString(),
        raw_attachments: [],
        idempotency_key: "graph:m1",
      },
      projectId: "proj-1",
      deps: { env: {} },
    });
    assert.equal(result.status, "unmatched");
    assert.equal(tables.uci_unmatched_inbound_messages.length, 1);
    assert.equal(tables.coordination_communications.length, 0);
  });
});

describe("Stage 5 Stage 6 handoff guard", () => {
  it("canEnterStage6 only after Stage 5 completed with ack date", () => {
    assert.equal(
      canEnterStage6({
        current_stage: 5,
        current_stage_state: "AWAITING_UTILITY",
        acknowledgment_received_at: null,
      }),
      false,
    );
    assert.equal(
      canEnterStage6({
        current_stage: 5,
        current_stage_state: "COMPLETED",
        acknowledgment_received_at: "2026-08-19T00:00:00Z",
      }),
      true,
    );
  });
});

/**
 * Minimal supabase table mock for Stage 5 unit tests.
 * @param {Record<string, Array<Record<string, unknown>>>} tables
 */
function createTableMock(tables) {
  return {
    from(table) {
      const store = tables[table] || (tables[table] = []);
      /** @type {Array<{ column: string, value: unknown, op?: string }>} */
      const filters = [];
      const state = {
        mode: "select",
        updatePatch: null,
        insertRow: null,
        limit: null,
        ascending: true,
      };

      const applyFilters = () =>
        store.filter((r) =>
          filters.every((f) => {
            if (f.op === "not_null") return r[f.column] != null;
            if (f.op === "is_null") return r[f.column] == null;
            if (f.op === "in") return /** @type {unknown[]} */ (f.value).map(String).includes(String(r[f.column]));
            return String(r[f.column] ?? "") === String(f.value ?? "");
          }),
        );

      const api = {
        select() {
          return api;
        },
        insert(row) {
          state.mode = "insert";
          state.insertRow = Array.isArray(row) ? row[0] : row;
          return api;
        },
        update(patch) {
          state.mode = "update";
          state.updatePatch = patch;
          return api;
        },
        eq(column, value) {
          filters.push({ column, value });
          return api;
        },
        in(column, values) {
          filters.push({ column, value: values, op: "in" });
          return api;
        },
        not(column, op) {
          if (op === "is") filters.push({ column, value: null, op: "not_null" });
          return api;
        },
        is(column, value) {
          if (value === null) filters.push({ column, value: null, op: "is_null" });
          return api;
        },
        or() {
          return api;
        },
        order() {
          return api;
        },
        range() {
          return api;
        },
        limit(n) {
          state.limit = n;
          return api;
        },
        maybeSingle() {
          let rows = applyFilters();
          if (state.mode === "update" && state.updatePatch) {
            for (const row of rows) Object.assign(row, state.updatePatch);
          }
          if (state.mode === "insert" && state.insertRow) {
            const row = { id: state.insertRow.id || `id-${store.length + 1}`, ...state.insertRow };
            store.push(row);
            return Promise.resolve({ data: row, error: null });
          }
          return Promise.resolve({ data: rows[0] ?? null, error: null });
        },
        single() {
          return api.maybeSingle().then((r) => {
            if (!r.data) return { data: null, error: { message: "not found" } };
            return r;
          });
        },
        then(resolve, reject) {
          let rows = applyFilters();
          if (state.mode === "update" && state.updatePatch) {
            for (const row of rows) Object.assign(row, state.updatePatch);
          }
          if (state.mode === "insert" && state.insertRow) {
            const row = { id: state.insertRow.id || `id-${store.length + 1}`, ...state.insertRow };
            store.push(row);
            rows = [row];
          }
          if (state.limit != null) rows = rows.slice(0, state.limit);
          return Promise.resolve({ data: rows, error: null, count: rows.length }).then(
            resolve,
            reject,
          );
        },
      };
      return api;
    },
  };
}
