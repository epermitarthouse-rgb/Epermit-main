"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  extractEquipmentScheduleFindingsFromText,
  assessEquipmentScheduleLayout,
} = require("../app/services/uci/uci-equipment-schedule-parser.service.js");

const EQUIPMENT_SCHEDULE_TEXT = `
EQUIPMENT UTILITY SCHEDULE TAG DESCRIPTION MANUFACTURER MODEL VOLTS PHASE AMPS CYCLE WATTS
101 DOUBLE BATCH OVEN, ELECTRIC, VENTLESS TURBOCHEF HHD-9500-801 208 V 1 40 A 60 Hz 8320 W
102 WATER BATH WINCO ESVC-28D 120 V 1 15 A 60 Hz 1800 W
101T DOUBLE BATCH OVEN, ELECTRIC, VENTLESS, 3-PHASE TURBOCHEF HHD-9500-934-DL 208 V 3 23 A 60 Hz 8320 W
`;

const GARBLED_TEXT = `EQUIPMENT UTILITY SCHEDULE some unstructured notes without recoverable rows`;

const source = {
  source_type: "pepco_portal_document",
  source_document_name: "A109_EQUIPMENT_UTILITY_SCHEDULE.pdf",
  source_content_hash: "hash-equip",
  external_application_id: "app-a",
};

describe("uci-equipment-schedule-parser", () => {
  it("extracts equipment schedule rows when native table text is structurally available", () => {
    const { findings, layout } = extractEquipmentScheduleFindingsFromText(
      EQUIPMENT_SCHEDULE_TEXT,
      1,
      source,
    );
    assert.equal(layout.parseable, true);
    const tag101 = findings.filter((f) => f.entity_name === "101");
    assert.ok(tag101.length >= 4);
    const watts = findings.find(
      (f) => f.field_key === "equipment_schedule_watts" && f.entity_name === "101",
    );
    assert.ok(watts);
    assert.equal(watts.normalized_value, 8320);
    assert.equal(watts.utility_type, "electric");
    assert.equal(watts.aggregation_role, "detail_component");
  });

  it("marks layout unrecoverable when equipment rows cannot be parsed", () => {
    const layout = assessEquipmentScheduleLayout(GARBLED_TEXT);
    assert.equal(layout.parseable, false);
    const { findings } = extractEquipmentScheduleFindingsFromText(GARBLED_TEXT, 1, source);
    assert.equal(findings.length, 0);
  });
});
