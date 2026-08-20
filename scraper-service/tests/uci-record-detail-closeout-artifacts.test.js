"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  getCoordinationRecordDetailById,
} = require("../app/services/uci/uci-records.service.js");

function detailSupabase(recordRow) {
  return {
    from(table) {
      if (table !== "coordination_records") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({ data: recordRow, error: null }),
              };
            },
          };
        },
      };
    },
  };
}

describe("coordination record detail closeout metadata", () => {
  it("preserves closeout_artifacts from the metadata column on detail fetch", async () => {
    const capturedAt = "2026-09-02T12:00:00.000Z";
    const row = {
      id: "coord-1",
      project_id: "proj-1",
      current_stage: 10,
      metadata: {
        closeout_artifacts: {
          utility_confirmation: {
            kind: "utility_confirmation",
            source: "operator",
            captured_at: capturedAt,
            label: "Recorded in workspace",
          },
          final_meter_reading: {
            kind: "final_meter_reading",
            source: "operator",
            captured_at: "2026-09-03T08:00:00.000Z",
          },
        },
        uci_closeout_package: { generated_at: "2026-09-04T10:00:00.000Z" },
      },
      uci_provider_mapping: { provider_slug: "pepco" },
    };

    const record = await getCoordinationRecordDetailById(detailSupabase(row), "coord-1");
    assert.ok(record);
    assert.equal(record.metadata.closeout_artifacts.utility_confirmation.captured_at, capturedAt);
    assert.ok(record.metadata.closeout_artifacts.final_meter_reading);
    assert.ok(record.metadata.uci_closeout_package);
    assert.deepEqual(record.metadata.uci_provider_mapping, { provider_slug: "pepco" });
    assert.equal(record.uci_provider_mapping, undefined);
  });
});
