"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  extractGasDocumentFindingsFromText,
  extractGasConstructionScheduleDates,
} = require("../app/services/uci/uci-gas-document-parser.service.js");
const { extractCandidatesFromKnownDocumentText } = require("../app/services/uci/uci-load-candidate.service.js");

const SOURCE = {
  source_type: "project_document",
  source_document_name: "GAS_LOAD_PROFILE.pdf",
  source_document_id: "gas-load-profile",
  source_storage_path: "project/gas-load-profile.pdf",
  source_content_hash: "hash-gas-load-profile",
  external_application_id: null,
};

describe("uci-gas-document-parser", () => {
  it("extracts gas load profile engineering fields", () => {
    const text = [
      "GAS LOAD PROFILE",
      "Connected Load 600,000 BTUH",
      "Requested Load 500,000 BTUH",
      "Delivery Pressure 7 in w.c.",
      "Meter Count 1",
      "Requested Service Line 1-1/2",
      "Gas Regulator Required",
      "Meter Location North service yard",
    ].join("\n");

    const findings = extractGasDocumentFindingsFromText(text, 1, SOURCE);
    const byField = new Map(findings.map((finding) => [finding.field_key, finding]));

    assert.equal(byField.get("connected_load_btuh")?.normalized_value, 600000);
    assert.equal(byField.get("requested_load_btuh")?.normalized_value, 500000);
    assert.equal(byField.get("pressure_requirements")?.normalized_value, "7 in w.c.");
    assert.equal(byField.get("meter_count")?.normalized_value, 1);
    assert.equal(byField.get("requested_service_line")?.normalized_value, "1-1/2");
    assert.equal(byField.get("gas_regulator")?.normalized_value, "Required");
    assert.match(String(byField.get("meter_location")?.normalized_value), /North service yard/i);
  });

  it("extracts construction dates only from construction schedules", () => {
    const text = [
      "CONSTRUCTION SERVICE SCHEDULE",
      "Groundbreak 02/22/2027",
      "Completion 12/01/2027",
      "Connected Load 999,999 BTUH",
    ].join("\n");

    const findings = extractGasDocumentFindingsFromText(text, 1, {
      ...SOURCE,
      source_document_name: "CONSTRUCTION SERVICE SCHEDULE.pdf",
    });
    const byField = new Map(findings.map((finding) => [finding.field_key, finding]));

    assert.equal(byField.get("construction_start_date")?.normalized_value, "02/22/2027");
    assert.equal(byField.get("construction_completion_date")?.normalized_value, "12/01/2027");
    assert.ok(!byField.has("connected_load_btuh"));
  });

  it("routes gas documents through extractCandidatesFromKnownDocumentText", () => {
    const candidates = extractCandidatesFromKnownDocumentText(
      "Connected Load 600,000 BTUH\nRequested Load 500,000 BTUH\nDelivery Pressure 7 in w.c.",
      1,
      SOURCE,
    );
    assert.ok(candidates.some((candidate) => candidate.field_key === "connected_load_btuh"));
    assert.ok(candidates.some((candidate) => candidate.field_key === "requested_load_btuh"));
  });
});
