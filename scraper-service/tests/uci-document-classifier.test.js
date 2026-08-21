"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyDocumentRole,
  inferSignatureStatus,
} = require("../app/services/uci/uci-document-classifier.service.js");

describe("uci-document-classifier", () => {
  it("classifies Portsmouth-style filenames with high confidence", () => {
    const cases = [
      ["01_ELECTRIC_LOAD_LETTER.pdf", "load_letter"],
      ["02_SINGLE_LINE_DIAGRAM.pdf", "single_line_diagram"],
      ["03_EQUIPMENT_SCHEDULE.pdf", "equipment_schedule"],
      ["04_CONSTRUCTION_SCHEDULE.pdf", "construction_schedule"],
      ["05_EQUIPMENT_CUT_SHEET.pdf", "equipment_cut_sheet"],
      ["06_SITE_PLAN.pdf", "site_plan"],
      ["07_LETTER_OF_AUTHORIZATION_UNSIGNED.pdf", "letter_of_authorization"],
    ];
    for (const [fileName, expectedRole] of cases) {
      const result = classifyDocumentRole({
        file_name: fileName,
        document_type: "other",
      });
      assert.equal(result.detected_role, expectedRole, fileName);
      assert.notEqual(result.role_confidence, "low", fileName);
    }
  });

  it("respects stored non-other document_type", () => {
    const result = classifyDocumentRole({
      file_name: "worksheet.pdf",
      document_type: "load_calculation_worksheet",
    });
    assert.equal(result.detected_role, "load_calculation_worksheet");
    assert.equal(result.role_confidence, "high");
  });

  it("uses hint role for stage uploads", () => {
    const result = classifyDocumentRole(
      { file_name: "upload.pdf", document_type: "other" },
      { hintRole: "site_plan", provenance: "stage_upload" },
    );
    assert.equal(result.detected_role, "site_plan");
    assert.equal(result.classification_review, "auto_accepted");
  });

  it("infers LOA signature status from filename", () => {
    assert.equal(
      inferSignatureStatus("letter_of_authorization", {
        file_name: "LOA_UNSIGNED.pdf",
      }),
      "unsigned",
    );
    assert.equal(
      inferSignatureStatus("letter_of_authorization", {
        file_name: "LOA_SIGNED.pdf",
      }),
      "signed",
    );
    assert.equal(
      inferSignatureStatus("site_plan", { file_name: "SITE_PLAN.pdf" }),
      null,
    );
  });

  it("marks unknown documents as needs_classification", () => {
    const result = classifyDocumentRole({
      file_name: "misc-notes.pdf",
      document_type: "other",
    });
    assert.equal(result.detected_role, "other");
    assert.equal(result.classification_review, "needs_classification");
  });
});
