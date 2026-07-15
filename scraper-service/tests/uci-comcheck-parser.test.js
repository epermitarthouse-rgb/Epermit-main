"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { extractComcheckFindingsFromText } = require("../app/services/uci/uci-comcheck-parser.service.js");

const LIGHTING_PAGE = `
Report Title: Sample Retail Project Report Date: Apr 10, 2026, 02:09 PM 3 of 9
2021 IECC Sample Retail Project Springfield, Illinois 4a Alteration
Total Proposed Watts: 1623.5
Interior Lighting PASSES
F2: F2: LED: Manual Control
`;

const HVAC_PAGE = `
Mechanical Systems List Quantity Component Description HVAC Systems
1 DOAS-1 (Single Zone): Heating: 1 each - Duct Furnace (Gas Heat), Gas, Capacity = 190 kBtu/h
Cooling: 1 each - DX DOAS w/ Heat Recovery, Capacity = 156 kBtu/h
1 DOAS-2 (Single Zone): Heating: 1 each - Duct Furnace (Gas Heat), Gas, Capacity = 494 kBtu/h
Cooling: 1 each - DX DOAS w/ Heat Recovery, Capacity = 348 kBtu/h
Mechanical Compliance Statement
`;

const EXTERIOR_PAGE = `
Exterior Lighting Compliance Certificate
Total Tradable Proposed Watts: 25
Exterior Lighting PASSES
`;

const INSPECTION_CHECKLIST = `
Footing / Foundation Inspection Complies? Comments/Assumptions C403.13.2
Does Not Comply Not Observable Not Applicable Exception: Requirement does not apply.
`;

const source = {
  source_type: "pepco_portal_document",
  source_document_name: "COMcheck_report.pdf",
  source_content_hash: "hash-comcheck",
  external_application_id: "app-a",
};

describe("uci-comcheck-parser", () => {
  it("extracts interior lighting total watts", () => {
    const findings = extractComcheckFindingsFromText(LIGHTING_PAGE, 3, source);
    const total = findings.find((f) => f.field_key === "lighting_interior_total_watts");
    assert.ok(total);
    assert.equal(total.normalized_value, 1623.5);
    assert.equal(total.unit, "W");
    assert.equal(total.fact_type, "electric_load");
  });

  it("extracts exterior lighting total watts separately", () => {
    const findings = extractComcheckFindingsFromText(EXTERIOR_PAGE, 4, source);
    const total = findings.find((f) => f.field_key === "lighting_exterior_total_watts");
    assert.ok(total);
    assert.equal(total.normalized_value, 25);
  });

  it("extracts HVAC gas heating and thermal cooling per DOAS unit", () => {
    const findings = extractComcheckFindingsFromText(HVAC_PAGE, 2, source);
    const doas1Heat = findings.find(
      (f) => f.field_key === "hvac_heating_capacity_kbtuh" && f.entity_name === "DOAS-1",
    );
    const doas1Cool = findings.find(
      (f) => f.field_key === "hvac_cooling_capacity_kbtuh" && f.entity_name === "DOAS-1",
    );
    assert.ok(doas1Heat);
    assert.equal(doas1Heat.normalized_value, 190);
    assert.equal(doas1Heat.category, "gas_load");
    assert.ok(doas1Cool);
    assert.equal(doas1Cool.normalized_value, 156);
    assert.equal(doas1Cool.category, "thermal_capacity");
    assert.ok(doas1Cool.review_blocked_reason);
  });

  it("extracts COMcheck project metadata", () => {
    const findings = extractComcheckFindingsFromText(LIGHTING_PAGE, 1, source);
    assert.ok(findings.some((f) => f.field_key === "comcheck_energy_code"));
    assert.ok(findings.some((f) => f.field_key === "comcheck_project_title"));
    assert.ok(findings.some((f) => f.field_key === "comcheck_report_date"));
  });

  it("does not create engineering candidates from inspection checklist boilerplate", () => {
    const findings = extractComcheckFindingsFromText(INSPECTION_CHECKLIST, 5, source);
    assert.equal(findings.length, 0);
  });
});
