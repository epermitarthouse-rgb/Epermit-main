import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { CoordinationCommunication, CoordinationMilestone, CoordinationRecord } from "@/types/uci";
import {
  deriveCloseoutPdfInfo,
  deriveMeterSetCloseoutActionState,
  getCloseoutArtifactEvidence,
  hasCloseoutArtifactOnRecord,
  hasMeterSetRequestSent,
  meterSetCrewCompleted,
  meterSetNoShowRecorded,
} from "./UciD13WorkflowPanels.tsx";

const __dirname = dirname(fileURLToPath(import.meta.url));
const panelSource = readFileSync(join(__dirname, "UciD13WorkflowPanels.tsx"), "utf8");
const dashboardSource = readFileSync(
  join(__dirname, "..", "..", "pages", "UciDashboard.tsx"),
  "utf8",
);

describe("MeterSetCloseoutPanel Stage 9/10 action-state feedback", () => {
  it("renders completed action labels with check icons for Stage 9 and 10", () => {
    assert.match(panelSource, /Requested ✓/);
    assert.match(panelSource, /Date confirmed ✓/);
    assert.match(panelSource, /Site ready ✓/);
    assert.match(panelSource, /Crew completed ✓/);
    assert.match(panelSource, /No-show recorded ✓/);
    assert.match(panelSource, /Received ✓/);
    assert.match(panelSource, /Energized ✓/);
    assert.match(panelSource, /PDF generated ✓/);
    assert.match(panelSource, /WorkflowCompletedActionButton/);
    assert.match(panelSource, /CheckCircle2/);
  });

  it("passes milestones and communications into the energization tab panel", () => {
    assert.match(dashboardSource, /milestones=\{detail\.milestones \?\? \[\]\}/);
    assert.match(dashboardSource, /communications=\{detail\.communications_recent \?\? \[\]\}/);
  });

  it("uses backend-aligned closeout artifact detection instead of raw metadata truthiness", () => {
    assert.match(panelSource, /hasCloseoutArtifactOnRecord/);
    assert.match(panelSource, /utility_confirmation_doc_id/);
    assert.match(panelSource, /Received ✓/);
    assert.doesNotMatch(panelSource, /artifacts\[key\] \? "on file"/);
  });

  it("exposes a visible closeout PDF open action beside archived status", () => {
    assert.match(panelSource, /View closeout PDF/);
    assert.match(panelSource, /onOpenCloseoutPdf/);
    assert.match(panelSource, /closeoutPdfFileName/);
    assert.match(dashboardSource, /onOpenCloseoutPdf=\{\(\) => void handleOpenCloseoutPdf\(\)\}/);
    assert.match(dashboardSource, /closeout_package_doc_id/);
    assert.match(dashboardSource, /project_documents/);
    assert.match(dashboardSource, /createSignedUrl/);
  });
});

describe("deriveMeterSetCloseoutActionState", () => {
  const baseRecord = {
    id: "rec-1",
    metadata: {},
  } as CoordinationRecord;

  it("detects meter-set request from outbound communication idempotency key", () => {
    const communications = [
      {
        id: "c1",
        direction: "outbound",
        classification: "uci.meter_set_request.v1",
        agent_processed_metadata: { idempotency_key: "meter_set_request:rec-1" },
      } as CoordinationCommunication,
    ];
    assert.equal(hasMeterSetRequestSent("rec-1", communications), true);
    assert.equal(
      deriveMeterSetCloseoutActionState({ record: baseRecord, communications }).meterSetRequested,
      true,
    );
  });

  it("marks crew completed from meter_set milestone and no-show only when last_outcome is no_show", () => {
    const milestones = [
      { milestone_type: "meter_set", status: "completed", actual_date: "2026-09-01" },
    ] as CoordinationMilestone[];
    assert.equal(meterSetCrewCompleted(milestones), true);

    const noShowRecord = {
      ...baseRecord,
      metadata: { uci_meter_set: { no_show: true, last_outcome: "no_show" } },
    } as CoordinationRecord;
    assert.equal(meterSetNoShowRecorded(noShowRecord), true);
    assert.equal(
      meterSetNoShowRecorded({
        ...noShowRecord,
        metadata: { uci_meter_set: { no_show: true, last_outcome: "completed" } },
      } as CoordinationRecord),
      false,
    );
  });

  it("aligns closeout artifact rows with backend guard keys", () => {
    const record = {
      ...baseRecord,
      metadata: {
        closeout_artifacts: {
          utility_confirmation: { captured_at: "2026-09-02T12:00:00.000Z" },
          final_meter_reading_doc_id: "meter-doc",
        },
      },
    } as CoordinationRecord;

    assert.equal(hasCloseoutArtifactOnRecord(record, "utility_confirmation"), true);
    assert.equal(hasCloseoutArtifactOnRecord(record, "final_meter_reading"), true);
    assert.equal(hasCloseoutArtifactOnRecord(record, "commissioning_signoff"), false);
    assert.equal(
      getCloseoutArtifactEvidence(record, "utility_confirmation")?.captured_at,
      "2026-09-02T12:00:00.000Z",
    );

    const state = deriveMeterSetCloseoutActionState({ record });
    assert.equal(state.artifacts.utility_confirmation, true);
    assert.equal(state.artifacts.final_meter_reading, true);
    assert.equal(state.artifacts.commissioning_signoff, false);
  });

  it("derives closeout PDF document id and archived filename from record metadata", () => {
    const record = {
      ...baseRecord,
      closeout_package_doc_id: "doc-closeout-1",
      metadata: {
        uci_closeout_package: {
          document_id: "doc-closeout-1",
          generated_at: "2026-09-04T10:00:00.000Z",
        },
      },
    } as CoordinationRecord;

    const info = deriveCloseoutPdfInfo(record, "uci-closeout-rec-1.pdf");
    assert.equal(info.documentId, "doc-closeout-1");
    assert.equal(info.generatedAt, "2026-09-04T10:00:00.000Z");
    assert.equal(info.fileName, "uci-closeout-rec-1.pdf");
    assert.equal(info.isArchived, true);

    const state = deriveMeterSetCloseoutActionState({
      record,
      closeoutPdfFileName: "uci-closeout-rec-1.pdf",
    });
    assert.equal(state.closeoutPdfGenerated, true);
    assert.equal(state.closeoutPdfDocumentId, "doc-closeout-1");
    assert.equal(state.closeoutPdfFileName, "uci-closeout-rec-1.pdf");
  });
});
