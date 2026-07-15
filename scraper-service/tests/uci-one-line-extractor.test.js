"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  extractOneLineFindingsFromText,
  normalizeOneLinePhase,
  isValidAmperageMatch,
  buildConciseEvidence,
} = require("../app/services/uci/uci-one-line-extractor.service.js");

const E601_STYLE_TEXT = `
NEW PANELBOARD "MDP" 800A, 120/208V, 3-PH 65,000 AIC, NEMA-1
M CT CABINET AND METER PER UTILITY COMPANY SPECIFICATIONS.
800A, 3-POLE, NEMA-1 FUSED DISCONNECT
PAD-MOUNTED TRANSFORMER REFER TO MDP SCHEDULE
NEW PANEL "A" 200A MLO 120/208V,3Ø,4W
PANEL "B" 200A MLO 120/208V,3Ø,4W
PANEL "C" 400A MLO 120/208V,3Ø,4W
`;

const SERVICE_ENTRANCE_TEXT = `
INCOMING SERVICE ENTRANCE 800 A AT 120/208 V THREE PHASE
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

  it("classifies MDP 800 A as main distribution panel rating, not service entrance", () => {
    const candidates = extractOneLineFindingsFromText(E601_STYLE_TEXT, 1, source);
    const mdp = candidates.find(
      (c) => c.field_key === "main_distribution_panel_rating" && c.entity_name === "MDP",
    );
    assert.ok(mdp);
    assert.equal(mdp.normalized_value, 800);
    assert.equal(mdp.entity_type, "main_distribution_panel");
    assert.ok(!candidates.some((c) => c.field_key === "service_amperage" && c.normalized_value === 800));
    assert.ok(!candidates.some((c) => c.field_key === "service_entrance_amperage"));
  });

  it("classifies explicit service entrance amperage separately from panel ratings", () => {
    const candidates = extractOneLineFindingsFromText(SERVICE_ENTRANCE_TEXT, 1, source);
    const service = candidates.find((c) => c.field_key === "service_entrance_amperage");
    assert.ok(service);
    assert.equal(service.normalized_value, 800);
    assert.equal(service.entity_type, "project_service");
  });

  it("keeps Panel A and Panel B as separate panel entities", () => {
    const candidates = extractOneLineFindingsFromText(E601_STYLE_TEXT, 1, source);
    const panelA = candidates.find(
      (c) => c.field_key === "panel_rating" && c.entity_name === "A",
    );
    const panelB = candidates.find(
      (c) => c.field_key === "panel_rating" && c.entity_name === "B",
    );
    assert.ok(panelA);
    assert.ok(panelB);
    assert.equal(panelA.normalized_value, 200);
    assert.equal(panelB.normalized_value, 200);
  });

  it("rejects 0 A and 65,000 AIC as service amperage", () => {
    const aicText = `NEW PANELBOARD "MDP" 800A, 120/208V, 3-PH 65,000 AIC, NEMA-1 M CT CABINET AND METER`;
    const candidates = extractOneLineFindingsFromText(aicText, 1, source);
    assert.ok(!candidates.some((c) => c.unit === "A" && c.normalized_value === 0));
    assert.ok(!candidates.some((c) => c.normalized_value === 65000));
    const rejected = isValidAmperageMatch("65,000 AIC at MDP", 0, "zero_or_invalid_amperage");
    assert.equal(rejected.valid, false);
  });

  it("rejects #3/0 conductor size as amperage", () => {
    const check = isValidAmperageMatch('W/ (4)#3/0, (1)#3G CU', 3, null);
    assert.equal(check.valid, false);
  });

  it("extracts CT cabinet and meter presence separately without inferred meter count", () => {
    const candidates = extractOneLineFindingsFromText(E601_STYLE_TEXT, 1, source);
    assert.ok(candidates.some((c) => c.field_key === "ct_cabinet_present"));
    assert.ok(candidates.some((c) => c.field_key === "meter_present"));
    assert.ok(!candidates.some((c) => c.field_key === "meter_count"));
  });

  it("produces concise evidence excerpts with entity and value", () => {
    const idx = E601_STYLE_TEXT.indexOf('NEW PANELBOARD "MDP"');
    const excerpt = buildConciseEvidence(E601_STYLE_TEXT, idx, 30);
    assert.match(excerpt, /MDP/i);
    assert.match(excerpt, /800A/i);
    assert.ok(excerpt.length <= 160);
  });

  it("normalizes 3-phase tokens", () => {
    assert.equal(normalizeOneLinePhase("3-PH"), "3");
    assert.equal(normalizeOneLinePhase("3Ø"), "3");
  });

  it("collapses identical evidence duplicates", () => {
    const dupText = `NEW PANELBOARD "MDP" 800A, 120/208V, 3-PH\nNEW PANELBOARD "MDP" 800A, 120/208V, 3-PH`;
    const candidates = extractOneLineFindingsFromText(dupText, 1, source);
    const mdpRatings = candidates.filter(
      (c) => c.field_key === "main_distribution_panel_rating" && c.entity_name === "MDP",
    );
    assert.equal(mdpRatings.length, 1);
  });
});
