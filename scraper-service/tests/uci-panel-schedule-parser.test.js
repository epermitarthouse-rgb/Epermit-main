"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  extractPanelScheduleFindingsFromText,
} = require("../app/services/uci/uci-panel-schedule-parser.service.js");

const PANEL_SCHEDULE_TEXT = `
200A GROUND BAR SUPPLY FROM: MDP SURFACE, NEMA 1 LOCATION: BOH NEW 65/10KAIC SERIES RATED
200A MLO A PANELBOARD 208/120 Wye, 3PH, 4W
800A MLO MDP PANELBOARD 208/120 Wye, 3PH, 4W
400A MLO C PANELBOARD 208/120 Wye, 3PH, 4W
`;

const source = {
  source_type: "pepco_portal_document",
  source_document_name: "E602_PANEL_SCHEDULES.pdf",
  source_content_hash: "hash-panel",
  external_application_id: "app-a",
};

describe("uci-panel-schedule-parser", () => {
  it("extracts MDP and branch panel ratings as separate entities", () => {
    const findings = extractPanelScheduleFindingsFromText(PANEL_SCHEDULE_TEXT, 1, source);
    const mdp = findings.find(
      (f) => f.field_key === "main_distribution_panel_rating" && f.entity_name === "MDP",
    );
    const panelA = findings.find(
      (f) => f.field_key === "panel_rating" && f.entity_name === "A",
    );
    const panelC = findings.find(
      (f) => f.field_key === "panel_rating" && f.entity_name === "C",
    );
    assert.ok(mdp);
    assert.equal(mdp.normalized_value, 800);
    assert.ok(panelA);
    assert.equal(panelA.normalized_value, 200);
    assert.ok(panelC);
    assert.equal(panelC.normalized_value, 400);
    assert.ok(!findings.some((f) => f.entity_name === "BOARD"));
  });

  it("does not emit legacy service_amperage field keys", () => {
    const findings = extractPanelScheduleFindingsFromText(PANEL_SCHEDULE_TEXT, 1, source);
    assert.ok(!findings.some((f) => f.field_key === "service_amperage"));
  });
});
