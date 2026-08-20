"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { buildCloseoutPdf } = require("../app/services/uci/uci-closeout-pdf.service.js");
const {
  missingCloseoutArtifacts,
  maybeMarkProjectComplete,
  attachCloseoutArtifact,
  resolveCloseoutPdfStoragePath,
  generateAndArchiveCloseout,
} = require("../app/services/uci/uci-energization-closeout.service.js");
const {
  stage9CompletedForCloseout,
  canGenerateCloseoutPdf,
} = require("../app/services/uci/uci-lifecycle-guards.service.js");
const { createTrackBMockSupabase } = require("./helpers/uci-track-b-mock.js");

describe("Track B Agent 12 closeout", () => {
  it("hard-blocks without the three artifacts", () => {
    const missing = missingCloseoutArtifacts(
      {
        energization_actual_date: "2026-09-01",
        metadata: {},
      },
      [{ id: "c1" }],
    );
    assert.ok(missing.includes("utility_confirmation"));
    assert.ok(missing.includes("final_meter_reading"));
    assert.ok(missing.includes("commissioning_signoff"));
  });

  it("builds a professional closeout PDF without serialized JSON", async () => {
    const pdf = await buildCloseoutPdf({
      project: { name: "Site A" },
      provider: { name: "Demo Utility" },
      record: {
        id: "coord-1",
        project_id: "proj-1",
        current_stage: 10,
        current_stage_state: "IN_PROGRESS",
        utility_type: "electric",
        energization_actual_date: "2026-09-01",
        predicted_p50_date: "2026-08-15",
      },
      transitions: [
        {
          created_at: "2026-08-01T12:00:00.000Z",
          from_stage: 8,
          from_state: "COMPLETED",
          to_stage: 9,
          to_state: "BLOCKED",
          reason: "Operator started Stage 9",
        },
      ],
      communications: [
        {
          raw_subject: "Energized",
          direction: "inbound",
          classification: "energization_confirmation",
          created_at: "2026-09-01T10:00:00.000Z",
        },
      ],
      costs: [
        {
          cost_type: "CIAC",
          estimated_amount: 1000,
          actual_amount: 1100,
          paid_at: "2026-08-10",
          client_billed_at: "2026-08-11",
        },
      ],
      energization: {
        actual_date: "2026-09-01",
        utility_confirmation: { label: "Utility letter" },
      },
    });
    assert.deepEqual(pdf.sections, [
      "project_summary",
      "stage_transitions",
      "communications",
      "costs_with_paid_receipts",
      "energization_confirmation",
      "appendix_transition_audit",
    ]);
    assert.ok(pdf.buffer.slice(0, 4).toString() === "%PDF");
    assert.ok(pdf.hash.length === 64);
    assert.ok(pdf.buffer.length > 500);
    const { PDFDocument } = require("pdf-lib");
    const parsed = await PDFDocument.load(pdf.buffer);
    assert.ok(parsed.getPageCount() >= 1);
  });

  it("blocks closeout PDF generation while Stage 9 is incomplete", async () => {
    const tables = {
      coordination_records: [
        {
          id: "coord-1",
          project_id: "proj-1",
          current_stage: 8,
          current_stage_state: "COMPLETED",
          energization_actual_date: "2026-09-01",
          metadata: {
            closeout_artifacts: {
              utility_confirmation: { label: "letter" },
              final_meter_reading: { label: "meter" },
              commissioning_signoff: { label: "signoff" },
            },
          },
        },
      ],
      coordination_costs: [{ id: "c1", paid_at: "2026-08-10" }],
      coordination_stage_transitions: [],
      coordination_communications: [],
      projects: [{ id: "proj-1", name: "Site A", user_id: "user-1" }],
      project_documents: [],
    };
    const supabase = createTrackBMockSupabase(tables);
    assert.equal(stage9CompletedForCloseout(tables.coordination_records[0]), false);
    assert.equal(canGenerateCloseoutPdf(tables.coordination_records[0]), false);
    await assert.rejects(
      () =>
        generateAndArchiveCloseout(supabase, {
          coordinationRecordId: "coord-1",
          userId: "user-1",
        }),
      /Stage 9 is completed/,
    );
  });

  it("attachCloseoutArtifact is idempotent when evidence already exists", async () => {
    const tables = {
      coordination_records: [
        {
          id: "coord-1",
          project_id: "proj-1",
          metadata: {
            closeout_artifacts: {
              utility_confirmation: {
                kind: "utility_confirmation",
                captured_at: "2026-09-01T00:00:00.000Z",
              },
            },
          },
        },
      ],
    };
    const supabase = createTrackBMockSupabase(tables);
    const first = await attachCloseoutArtifact(supabase, {
      coordinationRecordId: "coord-1",
      kind: "utility_confirmation",
      label: "repeat click",
    });
    assert.equal(first.idempotent, true);
    assert.equal(
      first.record.metadata.closeout_artifacts.utility_confirmation.captured_at,
      "2026-09-01T00:00:00.000Z",
    );
  });

  it("prefers project document storage path and falls back to metadata canonical path", () => {
    const record = {
      metadata: {
        uci_closeout_package: {
          storage_path: "uci/unconfigured/proj-1/coord-1/uci/closeout-coord-1/uci-closeout-abc.pdf",
        },
      },
    };
    assert.equal(
      resolveCloseoutPdfStoragePath(record, {
        file_path: "uci/unconfigured/proj-1/coord-1/uci/closeout-coord-1/stored.pdf",
      }),
      "uci/unconfigured/proj-1/coord-1/uci/closeout-coord-1/stored.pdf",
    );
    assert.equal(
      resolveCloseoutPdfStoragePath(record, null),
      "uci/unconfigured/proj-1/coord-1/uci/closeout-coord-1/uci-closeout-abc.pdf",
    );
  });

  it("project rollup is 1 of 2 until both records complete", async () => {
    const tables = {
      coordination_records: [
        { id: "a", project_id: "proj-1", current_stage: 10, current_stage_state: "COMPLETED" },
        { id: "b", project_id: "proj-1", current_stage: 9, current_stage_state: "IN_PROGRESS" },
      ],
      projects: [{ id: "proj-1" }],
    };
    const supabase = createTrackBMockSupabase(tables);
    const one = await maybeMarkProjectComplete(supabase, "proj-1");
    assert.equal(one.complete, false);
    assert.equal(one.banner, "1 of 2 utilities closed");
    tables.coordination_records[1].current_stage = 10;
    tables.coordination_records[1].current_stage_state = "COMPLETED";
    const two = await maybeMarkProjectComplete(supabase, "proj-1");
    assert.equal(two.complete, true);
    assert.equal(two.banner, "2 of 2 utilities closed");
    assert.ok(tables.projects[0].utility_coordination_completed_at);
  });
});
