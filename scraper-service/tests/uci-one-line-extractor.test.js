"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  extractOneLineFindingsFromText,
  normalizeOneLinePhase,
} = require("../app/services/uci/uci-one-line-extractor.service.js");

const E601_STYLE_TEXT = `
NEW PANELBOARD "MDP" 800A, 120/208V, 3-PH 65,000 AIC, NEMA-1
M CT CABINET AND METER PER UTILITY COMPANY SPECIFICATIONS.
800A, 3-POLE, NEMA-1 FUSED DISCONNECT
PAD-MOUNTED TRANSFORMER REFER TO MDP SCHEDULE
NEW PANEL "A" 200A MLO 120/208V,3Ø,4W
`;

const source = {
  source_type: "pepco_portal_document",
  source_document_name: "E601_ELECTRICAL_ONE_LINE_DIAGRAMS.pdf",
  source_content_hash: "hash-oneline",
  external_application_id: "app-a",
};

describe("uci-one-line-extractor", () => {
  it("extracts service voltage as slash notation without numeric collapse", () => {
    const candidates = extractOneLineFindingsFromText(E601_STYLE_TEXT, 1, source);
    const voltages = candidates.filter((c) => c.field_key === "service_voltage");
    assert.ok(voltages.length >= 1);
    assert.ok(voltages.some((c) => String(c.raw_value) === "120/208"));
    assert.ok(voltages.every((c) => String(c.normalized_value) !== "120208"));
  });

  it("extracts phase and wire configuration separately", () => {
    const candidates = extractOneLineFindingsFromText(E601_STYLE_TEXT, 1, source);
    const phases = candidates.filter((c) => c.field_key === "phase");
    assert.ok(phases.some((c) => c.normalized_value === "3"));
    const wires = candidates.filter((c) => c.field_key === "wire_configuration");
    assert.ok(wires.some((c) => String(c.raw_value).includes("4")));
  });

  it("extracts MDP panel rating and meter/CT cabinet evidence", () => {
    const candidates = extractOneLineFindingsFromText(E601_STYLE_TEXT, 1, source);
    assert.ok(
      candidates.some(
        (c) => c.field_key === "service_amperage" && c.entity_name === "MDP",
      ),
    );
    assert.ok(
      candidates.some(
        (c) => c.field_key === "meter_count" && /CT cabinet/i.test(String(c.entity_name)),
      ),
    );
    assert.ok(
      candidates.some(
        (c) => c.field_key === "service_configuration" && /transformer/i.test(String(c.entity_name)),
      ),
    );
  });

  it("normalizes 3-phase tokens", () => {
    assert.equal(normalizeOneLinePhase("3-PH"), "3");
    assert.equal(normalizeOneLinePhase("3Ø"), "3");
  });
});
