"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeEmail,
  isTrustedUtilityContactEmail,
  resolveUtilityContact,
  deriveUtilityContactBlocker,
  resolveUtilityContactFromCommunications,
  reconcileUtilityContactEmail,
} = require("../app/services/uci/uci-utility-contact.service.js");
const {
  requestMeterSet,
  meterSetStatus,
} = require("../app/services/uci/uci-meter-set-choreographer.service.js");
const { createTrackBMockSupabase, stage6CompletedRecord } = require("./helpers/uci-track-b-mock.js");

describe("uci-utility-contact resolver", () => {
  it("reports missing_utility_pm when PM name is absent", () => {
    const contact = resolveUtilityContact({ utility_contact_email: "pm@dominionenergy.com" });
    const blocker = deriveUtilityContactBlocker(contact);
    assert.equal(blocker.reason, "missing_utility_pm");
    assert.equal(contact.completeForOutbound, false);
  });

  it("reports missing_utility_contact_email when PM exists but email is missing", () => {
    const contact = resolveUtilityContact({
      utility_project_manager: "Alex Morgan",
      utility_contact_name: "Alex Morgan",
    });
    const blocker = deriveUtilityContactBlocker(contact);
    assert.equal(blocker.reason, "missing_utility_contact_email");
    assert.equal(blocker.message, "Utility contact email required for outbound meter-set request");
    assert.equal(contact.name, "Alex Morgan");
    assert.equal(contact.email, null);
    assert.equal(contact.completeForOutbound, false);
  });

  it("resolves both name and email from coordination record columns", () => {
    const contact = resolveUtilityContact({
      utility_project_manager: "Alex Morgan",
      utility_contact_name: "Alex Morgan",
      utility_contact_email: "alex.morgan@dominionenergy.com",
    });
    assert.equal(contact.completeForOutbound, true);
    assert.equal(deriveUtilityContactBlocker(contact).reason, null);
  });

  it("recovers email from inbound communication sender on real utility domain", () => {
    const contact = resolveUtilityContact(
      {
        utility_project_manager: "Alex Morgan",
      },
      {
        communications: [
          {
            id: "c1",
            direction: "inbound",
            sender: "alex.morgan@dominionenergy.com",
            raw_body: "Acknowledgment received.",
            agent_processed_metadata: {
              extracted_fields: { utility_project_manager: "Alex Morgan" },
            },
          },
        ],
      },
    );
    assert.equal(contact.email, "alex.morgan@dominionenergy.com");
    assert.equal(contact.emailSource, "communication_sender");
    assert.equal(contact.completeForOutbound, true);
  });

  it("does not fabricate email from PM name alone", () => {
    const contact = resolveUtilityContact({
      utility_project_manager: "Alex Morgan",
      utility_contact_name: "Alex Morgan",
    });
    assert.equal(contact.email, null);
    assert.equal(resolveUtilityContactFromCommunications([]).email, null);
  });

  it("rejects synthetic demo sender epermitarthouse@gmail.com", () => {
    assert.equal(isTrustedUtilityContactEmail("epermitarthouse@gmail.com"), false);
    const contact = resolveUtilityContact(
      { utility_project_manager: "Alex Morgan" },
      {
        communications: [
          {
            id: "demo",
            direction: "inbound",
            sender: "epermitarthouse@gmail.com",
            raw_body: "[UCI SYNTHETIC DEMO] ack",
            agent_processed_metadata: {},
          },
        ],
      },
    );
    assert.equal(contact.email, null);
    assert.equal(contact.blockerReason, "missing_utility_contact_email");
  });

  it("Stage 9 requestMeterSet gate uses normalized resolver semantics", async () => {
    const tables = {
      coordination_records: [
        stage6CompletedRecord({
          current_stage: 9,
          current_stage_state: "IN_PROGRESS",
          inspection_release_received_at: "2026-08-20T00:00:00.000Z",
          utility_project_manager: "Alex Morgan",
          utility_contact_name: "Alex Morgan",
        }),
      ],
      coordination_communications: [],
      projects: [{ id: "proj-1", name: "Portsmouth" }],
    };
    const supabase = createTrackBMockSupabase(tables);
    const blocked = await requestMeterSet(supabase, { coordinationRecordId: "coord-1" });
    assert.equal(blocked.started, false);
    assert.equal(blocked.reason, "missing_utility_contact_email");
    assert.equal(blocked.utility_contact.name, "Alex Morgan");
  });

  it("meterSetStatus exposes utility contact blocker separately from PM presence", () => {
    const status = meterSetStatus(
      {
        current_stage: 9,
        inspection_release_received_at: "2026-08-20T00:00:00.000Z",
        utility_project_manager: "Alex Morgan",
      },
      [],
      { communications: [] },
    );
    assert.equal(status.utility_contact_blocker, "missing_utility_contact_email");
    assert.deepEqual(status.actions, ["add_utility_pm"]);
  });
});

describe("uci-utility-contact reconciliation", () => {
  it("dry-run proposes trusted email from inbound sender", async () => {
    const tables = {
      coordination_records: [
        {
          id: "coord-1",
          utility_project_manager: "Alex Morgan",
          utility_contact_name: "Alex Morgan",
          utility_contact_email: null,
        },
      ],
      coordination_communications: [
        {
          id: "c1",
          coordination_record_id: "coord-1",
          direction: "inbound",
          sender: "alex.morgan@dominionenergy.com",
          raw_body: "Thanks",
          agent_processed_metadata: {},
          message_timestamp: "2026-08-19T00:00:00.000Z",
        },
      ],
    };
    const supabase = createTrackBMockSupabase(tables);
    const result = await reconcileUtilityContactEmail(supabase, {
      coordinationRecordId: "coord-1",
      dryRun: true,
    });
    assert.equal(result.updated, true);
    assert.equal(result.dry_run, true);
    assert.equal(result.persisted.utility_contact_email, "alex.morgan@dominionenergy.com");
  });
});

describe("uci-utility-contact email normalization", () => {
  it("normalizes angle-bracket senders", () => {
    assert.equal(normalizeEmail("Alex Morgan <alex.morgan@dominionenergy.com>"), "alex.morgan@dominionenergy.com");
  });
});
