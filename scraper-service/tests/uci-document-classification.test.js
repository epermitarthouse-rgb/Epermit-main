"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyDocumentType,
  isConstructionScheduleDocument,
} = require("../app/services/uci/uci-document-classification.service.js");
const { classifyDocumentUtilityScope } = require("../app/services/uci/uci-coordination-document-links.service.js");

const SYNTHETIC_GAS_FILES = [
  ["01_GAS_LOAD_PROFILE.pdf", "load_profile"],
  ["02_GAS_EQUIPMENT_UTILITY_SCHEDULE.pdf", "equipment_schedule"],
  ["03_GAS_PIPING_AND_SERVICE_PLAN.pdf", "service_plan"],
  ["04_GAS_METER_REGULATOR_SHEET.pdf", "meter_regulator"],
  ["05_Synthetic_Gas_Appliance_Cut_Sheets.pdf", "cut_sheet"],
  ["06_GAS_CONSTRUCTION_SERVICE_SCHEDULE.pdf", "construction_schedule"],
];

describe("uci-document-classification", () => {
  it("classifies gas document types independently of utility scope", () => {
    for (const [fileName, expectedType] of SYNTHETIC_GAS_FILES) {
      assert.equal(classifyDocumentType({ file_name: fileName }), expectedType);
    }
  });

  it("classifies six synthetic gas filenames even when stored type is load_profile", () => {
    const sharedHeader = "GAS LOAD PROFILE SUMMARY";
    for (const [fileName, expectedType] of SYNTHETIC_GAS_FILES) {
      assert.equal(
        classifyDocumentType({
          file_name: fileName,
          document_type: "load_profile",
          text: sharedHeader,
        }),
        expectedType,
        fileName,
      );
    }
  });

  it("classifies synthetic gas utility scope from filename despite stored load_profile", () => {
    for (const [fileName, expectedType] of SYNTHETIC_GAS_FILES) {
      const scope = classifyDocumentUtilityScope({
        file_name: fileName,
        document_type: "load_profile",
      });
      assert.equal(scope.documentType, expectedType, fileName);
    }
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
