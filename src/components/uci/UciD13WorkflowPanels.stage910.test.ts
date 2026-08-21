import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { CoordinationCommunication, CoordinationMilestone, CoordinationRecord } from "@/types/uci";
import {
  deriveCloseoutPdfInfo,
  deriveMeterSetCloseoutActionState,
  formatCloseoutEvidenceSourceLabel,
  getCloseoutArtifactEvidence,
  hasCloseoutArtifactOnRecord,
  hasMeterSetRequestSent,
  meterSetCrewCompleted,
  meterSetNoShowRecorded,
  resolveCloseoutArtifactEvidence,
  resolveMeterSetScheduledAt,
  resolveSiteReadinessConfirmedAt,
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
    assert.doesNotMatch(panelSource, /artifacts\[key\] \? "on file"/);
  });

  it("shows explicit Stage 10 evidence clarity instead of vague Record received", () => {
    assert.match(panelSource, /Found \/ Confirmed/);
    assert.match(panelSource, /Not found in prior UCI records — manual confirmation required/);
    assert.match(panelSource, /Confirm from UCI record/);
    assert.match(panelSource, /Confirm manually/);
    assert.match(panelSource, /CloseoutArtifactEvidenceRow/);
    assert.match(panelSource, /resolveCloseoutArtifactEvidence/);
    assert.doesNotMatch(panelSource, /pendingLabel="Record received"/);
  });

  it("opens closeout PDF through the authenticated UCI API", () => {
    assert.match(panelSource, /View closeout PDF/);
    assert.match(panelSource, /onOpenCloseoutPdf/);
    assert.match(panelSource, /closeoutPdfFileName/);
    assert.match(dashboardSource, /onOpenCloseoutPdf=\{\(\) => void handleOpenCloseoutPdf\(\)\}/);
    assert.match(dashboardSource, /openCloseoutPdf/);
    assert.doesNotMatch(dashboardSource, /createSignedUrl\(filePath/);
  });

  it("requires explicit Begin pre-energization before meter-set mutations", () => {
    assert.match(panelSource, /Begin pre-energization coordination/);
    assert.match(panelSource, /onStartStage9/);
    assert.match(panelSource, /needsStage9Entry/);
    assert.match(panelSource, /disabled=\{!stage9Active\}/);
    assert.match(dashboardSource, /enterCoordinationStage9/);
    assert.match(dashboardSource, /onStartStage9/);
  });

  it("blocks closeout actions until Stage 9 completes", () => {
    assert.match(panelSource, /closeoutUnlocked/);
    assert.match(panelSource, /disabled=\{!closeoutUnlocked\}/);
    assert.match(panelSource, /Finish meter-set coordination first/);
  });

  it("visually separates Utility PM contact from Site contact with distinct styling", () => {
    assert.match(panelSource, /UTILITY_PM_CONTACT_SECTION_ID/);
    assert.match(panelSource, /border-2 border-teal\/40 bg-teal\/5/);
    assert.match(panelSource, /Site contact/);
    assert.match(panelSource, /border border-border\/80 bg-muted\/25/);
    assert.match(panelSource, /outbound meter-set request email to the utility project manager/);
    assert.match(panelSource, /On-site construction contact for meter-set coordination/);
  });

  it("highlights Utility PM email and links blocker message to the contact section", () => {
    assert.match(panelSource, /shouldHighlightUtilityPmEmailField/);
    assert.match(panelSource, /missing_utility_contact_email/);
    assert.match(panelSource, /focusUtilityPmContactSection/);
    assert.match(panelSource, /border-amber-500\/70 ring-2 ring-amber-500\/35/);
    assert.match(panelSource, /Utility PM contact saved/);
    assert.match(panelSource, /Save utility PM contact/);
    assert.match(dashboardSource, /Utility PM contact saved/);
  });

  it("renders distinct Utility PM and Site contact email fields with persisted record values", () => {
    assert.match(panelSource, /id="utility-pm-email"/);
    assert.match(panelSource, /data-utility-pm-email-input="true"/);
    assert.match(panelSource, /Utility PM email/);
    assert.match(panelSource, /id="site-contact-email"/);
    assert.match(panelSource, /Site contact email/);
    assert.match(panelSource, /persistedUtilityEmail/);
    assert.match(panelSource, /record\?\.utility_contact_email/);
    assert.match(panelSource, /persistedSiteEmail/);
    assert.match(panelSource, /record\?\.site_contact_email/);
    assert.match(panelSource, /Saved on record:/);
    assert.match(panelSource, /Site contact saved/);
    assert.match(dashboardSource, /updateCoordinationUtilityContact/);
    assert.match(dashboardSource, /updateCoordinationSiteContact/);
    assert.match(dashboardSource, /Site contact saved/);
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
          file_name: "uci-closeout-abc123.pdf",
          storage_path: "uci/unconfigured/proj-1/coord-1/uci/closeout-rec-1/uci-closeout-abc123.pdf",
        },
      },
    } as CoordinationRecord;

    const info = deriveCloseoutPdfInfo(record, "uci-closeout-rec-1.pdf");
    assert.equal(info.documentId, "doc-closeout-1");
    assert.equal(info.generatedAt, "2026-09-04T10:00:00.000Z");
    assert.equal(info.fileName, "uci-closeout-rec-1.pdf");
    assert.equal(info.isArchived, true);

    const metadataOnly = deriveCloseoutPdfInfo({
      ...record,
      closeout_package_doc_id: "doc-closeout-1",
    });
    assert.equal(metadataOnly.fileName, "uci-closeout-abc123.pdf");

    const state = deriveMeterSetCloseoutActionState({
      record,
      closeoutPdfFileName: "uci-closeout-rec-1.pdf",
    });
    assert.equal(state.closeoutPdfGenerated, true);
    assert.equal(state.closeoutPdfDocumentId, "doc-closeout-1");
    assert.equal(state.closeoutPdfFileName, "uci-closeout-rec-1.pdf");
  });

  it("resolves Stage 9 scheduled/readiness from metadata when columns are absent", () => {
    const record = {
      ...baseRecord,
      metadata: {
        uci_meter_set: { scheduled_date: "2026-09-12" },
        site_readiness: { confirmed_at: "2026-09-11T10:00:00.000Z" },
      },
    } as CoordinationRecord;
    const milestones = [
      { milestone_type: "meter_set", status: "scheduled", target_date: "2026-09-12" },
    ] as CoordinationMilestone[];

    assert.ok(resolveMeterSetScheduledAt(record, milestones));
    assert.ok(resolveSiteReadinessConfirmedAt(record));
    const state = deriveMeterSetCloseoutActionState({ record, milestones });
    assert.equal(state.meterSetScheduled, true);
    assert.equal(state.siteReadinessConfirmed, true);
  });
});

describe("resolveCloseoutArtifactEvidence", () => {
  const baseRecord = { id: "rec-1", metadata: {} } as CoordinationRecord;

  it("marks persisted artifacts as confirmed with source details", () => {
    const record = {
      ...baseRecord,
      metadata: {
        closeout_artifacts: {
          utility_confirmation: {
            kind: "utility_confirmation",
            source: "communication",
            communication_id: "comm-energize-1",
            captured_at: "2026-09-02T12:00:00.000Z",
            label: "Service energized",
          },
        },
      },
    } as CoordinationRecord;

    const resolution = resolveCloseoutArtifactEvidence({
      record,
      key: "utility_confirmation",
    });
    assert.equal(resolution.status, "confirmed");
    assert.equal(resolution.sourceType, "communication");
    assert.equal(resolution.sourceId, "comm-energize-1");
    assert.equal(
      formatCloseoutEvidenceSourceLabel(resolution),
      "communication · Service energized",
    );
  });

  it("shows manual confirmation metadata after operator confirmation", () => {
    const record = {
      ...baseRecord,
      metadata: {
        closeout_artifacts: {
          commissioning_signoff: {
            kind: "commissioning_signoff",
            source: "operator",
            captured_at: "2026-09-05T09:00:00.000Z",
            label: "Signed by commissioning agent on site",
            confirmed_by: "operator@example.com",
          },
        },
      },
    } as CoordinationRecord;

    const resolution = resolveCloseoutArtifactEvidence({
      record,
      key: "commissioning_signoff",
    });
    assert.equal(resolution.status, "confirmed");
    assert.equal(resolution.sourceType, "existing_record");
    assert.equal(resolution.confirmedBy, "operator@example.com");
    assert.equal(resolution.note, "Signed by commissioning agent on site");
  });

  it("detects inherited utility confirmation from energization communication", () => {
    const communications = [
      {
        id: "comm-1",
        direction: "inbound",
        classification: "energization_confirmation",
        raw_subject: "Service energized",
        created_at: "2026-09-02T12:00:00.000Z",
      } as CoordinationCommunication,
    ];

    const resolution = resolveCloseoutArtifactEvidence({
      record: baseRecord,
      key: "utility_confirmation",
      communications,
    });
    assert.equal(resolution.status, "inherited");
    assert.equal(resolution.sourceType, "communication");
    assert.equal(resolution.sourceName, "Service energized");
    assert.equal(resolution.sourceId, "comm-1");
  });

  it("detects inherited final meter reading from Stage 9 milestone", () => {
    const milestones = [
      {
        id: "ms-1",
        milestone_type: "meter_set",
        status: "completed",
        actual_date: "2026-09-01",
      } as CoordinationMilestone,
    ];

    const resolution = resolveCloseoutArtifactEvidence({
      record: baseRecord,
      key: "final_meter_reading",
      milestones,
    });
    assert.equal(resolution.status, "inherited");
    assert.equal(resolution.sourceType, "stage_9_milestone");
    assert.equal(resolution.sourceName, "Meter set completed");
    assert.equal(resolution.sourceId, "ms-1");
  });

  it("returns missing when no internal evidence exists", () => {
    const resolution = resolveCloseoutArtifactEvidence({
      record: baseRecord,
      key: "commissioning_signoff",
      communications: [],
      milestones: [],
    });
    assert.equal(resolution.status, "missing");
    assert.equal(resolution.sourceType, null);
  });
});
