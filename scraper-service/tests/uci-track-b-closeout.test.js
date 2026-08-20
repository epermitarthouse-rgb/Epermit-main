"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { buildCloseoutPdf } = require("../app/services/uci/uci-closeout-pdf.service.js");
const {
  missingCloseoutArtifacts,
  maybeMarkProjectComplete,
} = require("../app/services/uci/uci-energization-closeout.service.js");
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

  it("builds a five-section PDF", async () => {
    const pdf = await buildCloseoutPdf({
      project: { name: "Site A" },
      record: { id: "coord-1", project_id: "proj-1", current_stage: 10 },
      transitions: [{ created_at: "2026-08-01", from_stage: 6, to_stage: 7, to_state: "IN_PROGRESS" }],
      communications: [{ raw_subject: "Energized", direction: "inbound", classification: "energization_confirmation" }],
      costs: [{ cost_type: "CIAC", estimated_amount: 1000, actual_amount: 1000, paid_at: "2026-08-10" }],
      energization: { actual_date: "2026-09-01" },
    });
    assert.deepEqual(pdf.sections, [
      "project_summary",
      "stage_transitions",
      "communications",
      "costs_with_paid_receipts",
      "energization_confirmation",
    ]);
    assert.ok(pdf.buffer.slice(0, 4).toString() === "%PDF");
    assert.ok(pdf.hash.length === 64);
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
