import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildUciStageHistory } from "./uciStageHistory";
import type { UciRecordDetailResponse } from "@/types/uci";

const recordId = "record-1";

function detail(overrides: { record?: object } & Record<string, unknown> = {}): UciRecordDetailResponse {
  const { record: recordOverrides, ...rest } = overrides;
  return {
    record: {
      id: recordId,
      project_id: "project-1",
      current_stage: 9,
      current_stage_state: "COMPLETED",
      utility_type: "electric",
      utility_provider_id: "provider-1",
      metadata: {},
      ...(recordOverrides as object),
    },
    transitions: [],
    applications: [],
    costs: [],
    equipment: [],
    milestones: [],
    communications_recent: [],
    ...rest,
  } as UciRecordDetailResponse;
}

describe("UCI stage history", () => {
  it("keeps saved progress distinct and does not rewrite the record", () => {
    const source = detail();
    const before = source.record.current_stage;
    const model = buildUciStageHistory({ detail: source, providerName: "Dominion Energy Virginia" });
    assert.equal(source.record.current_stage, before);
    assert.equal(model.savedStage, 9);
    assert.equal(model.stages[0]?.position, "completed");
    assert.equal(model.stages[8]?.position, "completed");
    assert.equal(model.stages[9]?.position, "not_reached");
    assert.equal(model.stages[8]?.completionMessage, "Completion recorded. Supporting details are not available.");
  });

  it("shows submission evidence only from saved submission fields", () => {
    const empty = buildUciStageHistory({
      detail: detail({
        record: { current_stage: 4, current_stage_state: "COMPLETED", metadata: {} },
      }),
    });
    assert.equal(empty.stages[3]?.workPerformed.length, 0);
    assert.match(empty.stages[3]?.completionMessage || "", /Supporting details are not available/);

    const submitted = buildUciStageHistory({
      detail: detail({
        record: {
          current_stage: 4,
          current_stage_state: "COMPLETED",
          application_submitted_at: "2026-04-02T15:00:00.000Z",
          metadata: {},
        },
        applications: [
          {
            id: "app-1",
            coordination_record_id: recordId,
            project_id: "project-1",
            submitted_at: "2026-04-02T15:00:00.000Z",
            submission_method: "email",
            utility_ticket_number: "DOM-100",
            record_source: "portal_sync",
            draft_status: "submitted",
          },
        ],
      }),
    });
    assert.match(submitted.stages[3]?.workPerformed.join(" ") || "", /2026-04-02/);
    assert.match(submitted.stages[3]?.workPerformed.join(" ") || "", /DOM-100/);
    assert.match(submitted.stages[3]?.workPerformed.join(" ") || "", /email/);
  });

  it("associates documents and communications only by explicit record and stage", () => {
    const model = buildUciStageHistory({
      detail: detail({
        milestones: [
          { id: "m-9", coordination_record_id: recordId, project_id: "project-1", parent_stage: 9, milestone_type: "meter_set", status: "completed" },
          { id: "m-other", coordination_record_id: "other-record", project_id: "project-1", parent_stage: 9, milestone_type: "wrong", status: "completed" },
          { id: "m-null", coordination_record_id: recordId, project_id: "project-1", parent_stage: null, milestone_type: "unscoped", status: "pending" },
        ],
      }),
      documents: [
        {
          id: "doc-2",
          project_document_id: "pd-2",
          coordination_record_id: recordId,
          detected_role: "load_letter",
          manual_role: null,
          effective_role: "load_letter",
          role_confidence: "high",
          classification_review: "auto_accepted",
          provenance: "manual_upload",
          signature_status: null,
          stage_consumers: [2],
          provider_slot_keys: [],
          project_document: {
            id: "pd-2",
            project_id: "project-1",
            document_type: "load_letter",
            file_name: "01_Synthetic_Load_Letter.pdf",
            file_path: "projects/project-1/load.pdf",
            file_type: "application/pdf",
            created_at: "2026-03-01T00:00:00.000Z",
          },
        },
        {
          id: "doc-other",
          project_document_id: "pd-x",
          coordination_record_id: "other-record",
          detected_role: "load_letter",
          manual_role: null,
          effective_role: "load_letter",
          role_confidence: "high",
          classification_review: "auto_accepted",
          provenance: "manual_upload",
          signature_status: null,
          stage_consumers: [2],
          provider_slot_keys: [],
          project_document: null,
        },
      ],
      communications: [
        {
          id: "ack",
          coordination_record_id: recordId,
          project_id: "project-1",
          direction: "inbound",
          classification: "acknowledgment",
          raw_subject: "Application received",
          parsed_action_items: [],
          raw_attachments: [],
          needs_human_attention: false,
          agent_processed_metadata: {},
          created_at: "2026-04-03T00:00:00.000Z",
        },
        {
          id: "loose",
          coordination_record_id: recordId,
          project_id: "project-1",
          direction: "inbound",
          classification: "unclassified",
          raw_subject: "Unscoped mailbox item",
          parsed_action_items: [],
          raw_attachments: [],
          needs_human_attention: false,
          agent_processed_metadata: {},
          created_at: "2026-04-04T00:00:00.000Z",
        },
        {
          id: "synthetic",
          coordination_record_id: recordId,
          project_id: "project-1",
          direction: "inbound",
          classification: "acknowledgment",
          raw_subject: "[UCI SYNTHETIC TEST] acknowledgment",
          parsed_action_items: [],
          raw_attachments: [],
          needs_human_attention: false,
          agent_processed_metadata: {},
          created_at: "2026-04-05T00:00:00.000Z",
        },
        {
          id: "foreign",
          coordination_record_id: "other-record",
          project_id: "project-1",
          direction: "inbound",
          classification: "acknowledgment",
          raw_subject: "Different utility record",
          parsed_action_items: [],
          raw_attachments: [],
          needs_human_attention: false,
          agent_processed_metadata: {},
          created_at: "2026-04-06T00:00:00.000Z",
        },
      ] as UciRecordDetailResponse["communications_recent"],
    });

    assert.equal(model.stages[1]?.documents.length, 1);
    assert.equal(model.stages[1]?.documents[0]?.testRecord, true);
    assert.equal(model.stages[1]?.documents[0]?.downloadPath, "projects/project-1/load.pdf");
    assert.equal(model.stages[0]?.documents.length, 0);
    assert.equal(model.stages[4]?.communications.length, 2);
    assert.equal(model.stages[4]?.communications.some((item) => item.testRecord), true);
    assert.equal(model.stages[4]?.communications.some((item) => item.summary.includes("Different")), false);
    assert.equal(model.stages[8]?.milestones.length, 1);
    assert.equal(model.stages[8]?.milestones[0]?.label, "meter set");
  });

  it("uses the saved transition reason and does not invent one", () => {
    const missing = buildUciStageHistory({ detail: detail() });
    assert.equal(missing.stages[2]?.transitionReason, "Not recorded.");
    assert.equal(missing.stages[2]?.transitionTrigger, "Not recorded");

    const recorded = buildUciStageHistory({
      detail: detail({
        transitions: [
          {
            id: "t1",
            coordination_record_id: recordId,
            project_id: "project-1",
            from_stage: 3,
            to_stage: 4,
            from_state: "COMPLETED",
            to_state: "IN_PROGRESS",
            triggered_by_type: "human",
            reason: "Package review completed",
            metadata: {},
            created_at: "2026-04-01T12:00:00.000Z",
          },
        ],
      }),
    });
    assert.equal(recorded.stages[2]?.transitionReason, "Package review completed");
    assert.equal(recorded.stages[2]?.transitionTrigger, "Person");
    assert.equal(recorded.stages[2]?.transitionDate, "2026-04-01T12:00:00.000Z");
    assert.equal(recorded.stages[3]?.startedAt, "2026-04-01T12:00:00.000Z");
    assert.equal(recorded.stages[2]?.relatedTransitions.length, 1);
  });

  it("uses an in-place completion when the record never moved to the next stage", () => {
    const model = buildUciStageHistory({
      detail: detail({
        record: { current_stage: 9, current_stage_state: "COMPLETED", metadata: {} },
        transitions: [
          {
            id: "t9",
            coordination_record_id: recordId,
            project_id: "project-1",
            from_stage: 9,
            to_stage: 9,
            from_state: "IN_PROGRESS",
            to_state: "COMPLETED",
            triggered_by_type: "user",
            reason: "Operator marked Stage 9 complete after meter-set predicates",
            metadata: {},
            created_at: "2026-08-21T06:08:18.384482+00:00",
          },
        ],
      }),
    });
    assert.equal(
      model.stages[8]?.transitionReason,
      "Operator marked Stage 9 complete after meter-set predicates",
    );
    assert.equal(model.stages[9]?.position, "not_reached");
  });

  it("keeps the closeout package and equipment check-in messages on their stages", () => {
    const model = buildUciStageHistory({
      detail: detail({
        record: { current_stage: 9, current_stage_state: "COMPLETED", closeout_package_doc_id: "doc", metadata: {} },
      }),
      documents: [
        {
          id: "closeout",
          project_document_id: "pd-closeout",
          coordination_record_id: recordId,
          detected_role: "uci_closeout_package",
          manual_role: null,
          effective_role: "uci_closeout_package",
          role_confidence: "high",
          classification_review: "auto_accepted",
          provenance: "uci_generated",
          signature_status: null,
          stage_consumers: [],
          provider_slot_keys: [],
          project_document: {
            id: "pd-closeout",
            project_id: "project-1",
            document_type: "uci_closeout_package",
            file_name: "uci-closeout.pdf",
            file_path: "projects/project-1/closeout.pdf",
            file_type: "application/pdf",
            created_at: "2026-08-21T00:00:00.000Z",
          },
        },
      ],
      communications: [
        {
          id: "checkin",
          coordination_record_id: recordId,
          project_id: "project-1",
          direction: "outbound",
          classification: "uci.equipment_eta_checkin.v1",
          raw_subject: "Equipment delivery check-in",
          parsed_action_items: [],
          raw_attachments: [],
          needs_human_attention: false,
          agent_processed_metadata: {},
          created_at: "2026-08-20T00:00:00.000Z",
        },
      ] as UciRecordDetailResponse["communications_recent"],
    });
    assert.equal(model.stages[9]?.documents.length, 1);
    assert.match(model.stages[9]?.workPerformed.join(" ") || "", /closeout package/i);
    assert.equal(model.stages[7]?.communications.length, 1);
    assert.equal(model.stages[4]?.communications.length, 0);
  });
});

describe("UCI stage history navigation source", () => {
  const dashboard = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../pages/UciDashboard.tsx"),
    "utf8",
  );
  const panel = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../components/uci/UciStageHistoryPanel.tsx"),
    "utf8",
  );

  it("opens the full record workspace directly and stores the stage in the URL", () => {
    assert.match(dashboard, /navigate\(`\/uci\/records\/\$\{encodeURIComponent\(record\.id\)\}\?stage=1`\)/);
    assert.match(dashboard, /next\.set\("stage", String\(nextStage\)\)/);
    assert.match(dashboard, /<UciStageHistoryPanel/);
    assert.doesNotMatch(
      dashboard.slice(dashboard.indexOf("const openRecordOrStage1Setup"), dashboard.indexOf("const uciCompletedRecordCount")),
      /openDetail\(/,
    );
  });

  it("does not import workflow mutations into the stage history panel", () => {
    assert.doesNotMatch(panel, /transitionCoordination|submitApplication|sendEmail|analyzeCoordination|method:\s*"POST"/);
    assert.match(panel, /listCoordinationCommunications/);
    assert.match(panel, /getCoordinationDocumentRegistry/);
    assert.match(panel, /onSelectStage\(stage\.stage \+ 1\)/);
  });
});
