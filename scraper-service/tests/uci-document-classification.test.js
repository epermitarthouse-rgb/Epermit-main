"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyDocumentType,
  isConstructionScheduleDocument,
} = require("../app/services/uci/uci-document-classification.service.js");
const { classifyDocumentUtilityScope } = require("../app/services/uci/uci-coordination-document-links.service.js");

describe("uci-document-classification", () => {
  it("classifies gas document types independently of utility scope", () => {
    assert.equal(
      classifyDocumentType({ file_name: "01_GAS_LOAD_PROFILE.pdf" }),
      "load_profile",
    );
    assert.equal(
      classifyDocumentType({ file_name: "EQUIPMENT_UTILITY_SCHEDULE.pdf" }),
      "equipment_schedule",
    );
    assert.equal(
      classifyDocumentType({ file_name: "PIPING_AND_SERVICE_PLAN.pdf" }),
      "service_plan",
    );
    assert.equal(
      classifyDocumentType({ file_name: "METER_REGULATOR_SHEET.pdf" }),
      "meter_regulator",
    );
    assert.equal(classifyDocumentType({ file_name: "APPLIANCE_CUT_SHEETS.pdf" }), "cut_sheet");
    assert.equal(
      classifyDocumentType({ file_name: "CONSTRUCTION_SERVICE_SCHEDULE.pdf" }),
      "construction_schedule",
    );
  });

  it("keeps utility type separate from classified document type", () => {
    const scope = classifyDocumentUtilityScope({
      file_name: "GAS_LOAD_PROFILE.pdf",
      document_type: "other",
    });
    assert.equal(scope.utilityType, "gas");
    assert.equal(scope.documentType, "load_profile");
  });

  it("detects construction schedule documents", () => {
    assert.equal(
      isConstructionScheduleDocument({ file_name: "CONSTRUCTION SERVICE SCHEDULE.pdf" }),
      true,
    );
  });
});
