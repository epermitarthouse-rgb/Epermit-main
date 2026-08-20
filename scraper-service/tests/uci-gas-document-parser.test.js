"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  extractGasDocumentFindingsFromText,
  extractGasConstructionScheduleDates,
  normalizeGasPressureValue,
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
    assert.equal(byField.get("pressure_requirements")?.normalized_value, "7 in. w.c.");
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

  it("normalizes leading-zero gas pressure without duplicating units", () => {
    assert.equal(normalizeGasPressureValue("0007"), "7 in. w.c.");
    assert.equal(normalizeGasPressureValue("0007 in. w.c."), "7 in. w.c.");
    assert.equal(normalizeGasPressureValue("0007 in w.c."), "7 in. w.c.");

    const findings = extractGasDocumentFindingsFromText(
      "Delivery Pressure 0007 in. w.c.",
      1,
      SOURCE,
    );
    const pressure = findings.find((finding) => finding.field_key === "pressure_requirements");
    assert.equal(pressure?.normalized_value, "7 in. w.c.");
    assert.equal(pressure?.unit, "in. w.c.");
  });

  it("extracts gas fields from shared-header synthetic document text", () => {
    const sharedHeader = "GAS LOAD PROFILE\nProject Reference LP-100\n";
    const loadProfile = extractGasDocumentFindingsFromText(
      [
        sharedHeader,
        "Connected Load 600,000 BTU/h",
        "Requested Load 500,000 BTU/h",
        "Delivery Pressure 0007 in. w.c.",
        "Meter Count 1",
        "Requested Service Line 1-1/2 in.",
        "Gas Regulator Required",
        "Meter Location North service yard",
      ].join("\n"),
      1,
      { ...SOURCE, source_document_name: "01_GAS_LOAD_PROFILE.pdf" },
    );
    const servicePlan = extractGasDocumentFindingsFromText(
      [
        sharedHeader,
        "Requested Service Line 1-1/2 in.",
        "Gas Regulator Required",
        "Meter Location North service yard",
      ].join("\n"),
      1,
      { ...SOURCE, source_document_name: "03_GAS_PIPING_AND_SERVICE_PLAN.pdf" },
    );
    const schedule = extractGasDocumentFindingsFromText(
      [
        sharedHeader,
        "Construction Start Date 2027-02-22",
        "Construction Completion Date 2027-12-01",
        "Requested In-Service Date 2027-11-15",
        "Connected Load 999,999 BTUH",
      ].join("\n"),
      1,
      { ...SOURCE, source_document_name: "06_GAS_CONSTRUCTION_SERVICE_SCHEDULE.pdf" },
    );

    const loadByField = new Map(loadProfile.map((finding) => [finding.field_key, finding]));
    assert.equal(loadByField.get("connected_load_btuh")?.normalized_value, 600000);
    assert.equal(loadByField.get("requested_load_btuh")?.normalized_value, 500000);
    assert.equal(loadByField.get("pressure_requirements")?.normalized_value, "7 in. w.c.");
    assert.equal(loadByField.get("meter_count")?.normalized_value, 1);

    const serviceByField = new Map(servicePlan.map((finding) => [finding.field_key, finding]));
    assert.equal(serviceByField.get("requested_service_line")?.normalized_value, "1-1/2");
    assert.equal(serviceByField.get("gas_regulator")?.normalized_value, "Required");
    assert.match(String(serviceByField.get("meter_location")?.normalized_value), /North service yard/i);

    const scheduleByField = new Map(schedule.map((finding) => [finding.field_key, finding]));
    assert.equal(scheduleByField.get("construction_start_date")?.normalized_value, "2027-02-22");
    assert.equal(scheduleByField.get("construction_completion_date")?.normalized_value, "2027-12-01");
    assert.equal(scheduleByField.get("requested_in_service_date")?.normalized_value, "2027-11-15");
    assert.ok(!scheduleByField.has("connected_load_btuh"));
  });

  it("extracts meter quantity from production-like regulator sheet text", () => {
    const findings = extractGasDocumentFindingsFromText(
      "ynthetic requested value Meter quantity 1 Meter capacity 650 CFH nominal",
      1,
      {
        ...SOURCE,
        source_document_name: "04_Synthetic_Gas_Meter_Regulator_Data_Sheet.pdf",
      },
    );
    const meter = findings.find((finding) => finding.field_key === "meter_count");
    assert.equal(meter?.normalized_value, 1);
  });

  it("extracts all six synthetic gas doc field sets from UAT snippets", () => {
    const loadProfile = extractGasDocumentFindingsFromText(
      [
        "GAS LOAD PROFILE",
        "Synthetic requested value Connected load 600,000 BTU/H",
        "Synthetic requested value Design load 500,000 BTU/H",
        "Synthetic requested value Delivery pressure 7 in. w.c.",
      ].join("\n"),
      1,
      { ...SOURCE, source_document_name: "01_Synthetic_Gas_Load_Profile.pdf" },
    );
    const equipment = extractGasDocumentFindingsFromText(
      "Synthetic requested value Delivery pressure 0007 in w.c.",
      1,
      { ...SOURCE, source_document_name: "02_Synthetic_Gas_Equipment_Schedule.pdf" },
    );
    const servicePlan = extractGasDocumentFindingsFromText(
      [
        "Synthetic requested value Service line 1-1/2 in.",
        "Synthetic requested value Gas regulator Required",
        "Synthetic requested value Meter location North service yard",
      ].join("\n"),
      1,
      { ...SOURCE, source_document_name: "03_Synthetic_Gas_Piping_and_Service_Plan.pdf" },
    );
    const construction = extractGasDocumentFindingsFromText(
      [
        "GAS LOAD PROFILE",
        "Synthetic requested value Groundbreak 02/22/2027",
        "Synthetic requested value Completion 12/01/2027",
        "Connected Load 999,999 BTUH",
      ].join("\n"),
      1,
      { ...SOURCE, source_document_name: "06_Synthetic_Gas_Construction_Service_Schedule.pdf" },
    );

    assert.ok(loadProfile.some((finding) => finding.field_key === "connected_load_btuh"));
    assert.ok(loadProfile.some((finding) => finding.field_key === "requested_load_btuh"));
    assert.equal(
      equipment.find((finding) => finding.field_key === "pressure_requirements")?.normalized_value,
      "7 in. w.c.",
    );
    assert.equal(
      servicePlan.find((finding) => finding.field_key === "requested_service_line")?.normalized_value,
      "1-1/2",
    );
    assert.equal(
      servicePlan.find((finding) => finding.field_key === "gas_regulator")?.normalized_value,
      "Required",
    );
    assert.match(
      String(servicePlan.find((finding) => finding.field_key === "meter_location")?.normalized_value),
      /North service yard/i,
    );
    assert.equal(
      construction.find((finding) => finding.field_key === "construction_start_date")?.normalized_value,
      "02/22/2027",
    );
    assert.ok(!construction.some((finding) => finding.field_key === "connected_load_btuh"));
  });
});
