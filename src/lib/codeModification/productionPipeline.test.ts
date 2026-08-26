import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  finalizeCodeModificationEvidence,
  mergeFindingsFromSheets,
  mergeMeasureEvidence,
  synthesizeMeasureEvidence,
  validateOneRowPerMeasure,
} from "./mergeEvidence.ts";
import { NOT_FOUND_NOTE } from "./evidenceClassification.ts";
import type { AllowedEvidenceRef, EvidenceFinding } from "./model.ts";

function finding(partial: Partial<EvidenceFinding> & Pick<EvidenceFinding, "id">): EvidenceFinding {
  return {
    measureId: null,
    measure: "Unnamed measure",
    status: "not_found",
    source: null,
    note: null,
    ...partial,
  };
}

function runProductionPipeline(
  rawSheetFindings: Parameters<typeof mergeMeasureEvidence>[1],
  allowed: AllowedEvidenceRef[],
  baseFindings: Parameters<typeof mergeMeasureEvidence>[0] = [],
) {
  const merged = mergeMeasureEvidence(baseFindings, rawSheetFindings, { deferSynthesis: true });
  const synthesized = merged.map((row) => synthesizeMeasureEvidence(row));
  return finalizeCodeModificationEvidence(synthesized, allowed);
}

describe("productionPipeline", () => {
  const stairMeasure =
    "Provide a two-hour fire rated enclosed stairway serving all occupied levels";
  const pdrmMeasure = "Incorporate DOB recommendations from June 9, 2026 PDRM";
  const sprinklerMeasure = "Provide a fully automatic sprinkler system throughout the building";
  const occupantMeasure = "Maintain an occupant load below 49 people per floor";
  const standpipeMeasure = "Include a standpipe";
  const commonPathMeasure = 'Maintain a common path of travel distance of less than 75\'-0"';

  const allowed: AllowedEvidenceRef[] = [
    { sheetId: "g1", pageNumber: 1, fileName: "G-001.pdf", sheetLabel: "G-001" },
    { sheetId: "a103", pageNumber: 1, fileName: "A-103.pdf", sheetLabel: "A-103" },
    { sheetId: "fp101", pageNumber: 3, fileName: "FP-101.pdf", sheetLabel: "FP-101" },
    { sheetId: "fa101", pageNumber: 2, fileName: "FA-101.pdf", sheetLabel: "FA-101" },
    { sheetId: "base", pageNumber: 3, fileName: "Base_Set.pdf", sheetLabel: "Base" },
    { sheetId: "conflict", pageNumber: 1, fileName: "Evidence_Conflict.pdf" },
  ];

  it("A. support + sheet-scoped silence → not conflicting", () => {
    const result = runProductionPipeline(
      [
        finding({
          id: "g",
          measureId: "measure-stair",
          measure: stairMeasure,
          status: "verified",
          source: {
            fileName: "G-001.pdf",
            pageNumber: 1,
            excerpt: "2-hour fire rated stair enclosure noted.",
          },
        }),
        finding({
          id: "silence",
          measureId: "measure-stair",
          measure: stairMeasure,
          status: "conflicting",
          source: {
            fileName: "A-103.pdf",
            pageNumber: 1,
            excerpt: "No information about two-hour stair enclosure on this sheet.",
          },
        }),
      ],
      allowed,
    );
    assert.equal(result.length, 1);
    assert.notEqual(result[0]?.status, "conflicting");
    assert.ok(result[0]?.status === "verified" || result[0]?.status === "partially_supported");
    assert.equal(validateOneRowPerMeasure(result), true);
  });

  it("B. absence-only model verified → NOT_FOUND", () => {
    const result = runProductionPipeline(
      [
        finding({
          id: "pdrm",
          measureId: "measure-pdrm",
          measure: pdrmMeasure,
          status: "verified",
          source: {
            fileName: "G-001.pdf",
            pageNumber: 1,
            excerpt: "No information about DOB recommendations from the review meeting.",
          },
        }),
      ],
      allowed,
    );
    assert.equal(result[0]?.status, "not_found");
    assert.equal(result[0]?.source, null);
    assert.equal(result[0]?.note, NOT_FOUND_NOTE);
  });

  it("C. per-sheet not shown on unrelated plan → not conflicting", () => {
    const result = runProductionPipeline(
      [
        finding({
          id: "support",
          measureId: "measure-sprinkler",
          measure: sprinklerMeasure,
          status: "verified",
          source: {
            fileName: "FA-101.pdf",
            pageNumber: 2,
            excerpt: "Automatic sprinkler throughout building.",
          },
        }),
        finding({
          id: "absence",
          measureId: "measure-sprinkler",
          measure: sprinklerMeasure,
          status: "conflicting",
          source: {
            fileName: "A-103.pdf",
            pageNumber: 1,
            excerpt: "Sprinkler not shown on this floor plan.",
          },
        }),
      ],
      allowed,
    );
    assert.equal(result[0]?.status, "verified");
  });

  it("D. genuine numeric contradiction → CONFLICTING", () => {
    const result = runProductionPipeline(
      [
        finding({
          id: "base",
          measureId: "measure-occupant",
          measure: occupantMeasure,
          status: "verified",
          source: {
            fileName: "Base_Set.pdf",
            pageNumber: 3,
            excerpt: "Occupant load 48 per floor.",
          },
        }),
        finding({
          id: "conflict",
          measureId: "measure-occupant",
          measure: occupantMeasure,
          status: "verified",
          source: {
            fileName: "Evidence_Conflict.pdf",
            pageNumber: 1,
            excerpt: "Occupant load schedule shows 60 occupants.",
          },
        }),
      ],
      allowed,
    );
    assert.equal(result[0]?.status, "conflicting");
  });

  it("E. base deferral + addendum supply → VERIFIED", () => {
    const merged = mergeFindingsFromSheets(
      [
        finding({
          id: "base",
          measureId: "measure-standpipe",
          measure: standpipeMeasure,
          status: "verified",
          source: {
            fileName: "Base_Set.pdf",
            pageNumber: 4,
            excerpt: "Standpipe not included on base; see Supplement_01 addendum.",
          },
        }),
      ],
      [
        finding({
          id: "addendum",
          measureId: "measure-standpipe",
          measure: standpipeMeasure,
          status: "verified",
          source: {
            fileName: "Supplement_01.pdf",
            pageNumber: 1,
            excerpt: "Standpipe included per addendum.",
          },
        }),
      ],
    );
    const result = finalizeCodeModificationEvidence(merged, [
      { sheetId: "base", pageNumber: 4, fileName: "Base_Set.pdf" },
      { sheetId: "supp", pageNumber: 1, fileName: "Supplement_01.pdf" },
    ]);
    assert.equal(result[0]?.status, "verified");
  });

  it("F. ungrounded verified citation → NOT_FOUND after grounding", () => {
    const result = runProductionPipeline(
      [
        finding({
          id: "sprinkler",
          measureId: "measure-sprinkler",
          measure: sprinklerMeasure,
          status: "verified",
          source: {
            fileName: "Unknown_Sheet.pdf",
            pageNumber: 9,
            excerpt: "Automatic sprinkler noted.",
          },
        }),
      ],
      allowed,
    );
    assert.equal(result[0]?.status, "not_found");
    assert.equal(result[0]?.source, null);
  });

  it("G. incomplete coverage on second sheet → partial not conflicting", () => {
    const result = runProductionPipeline(
      [
        finding({
          id: "g",
          measureId: "measure-stair",
          measure: stairMeasure,
          status: "verified",
          source: {
            fileName: "G-001.pdf",
            pageNumber: 1,
            excerpt: "2-hour fire rated enclosed stairway noted.",
          },
        }),
        finding({
          id: "a101",
          measureId: "measure-stair",
          measure: stairMeasure,
          status: "conflicting",
          source: {
            fileName: "A-103.pdf",
            pageNumber: 1,
            excerpt: "Drawing does not establish serving all occupied levels.",
          },
        }),
      ],
      allowed,
    );
    assert.equal(result[0]?.status, "partially_supported");
  });

  it("H. common path support + per-sheet omission → VERIFIED", () => {
    const result = runProductionPipeline(
      [
        finding({
          id: "g001",
          measureId: "measure-path",
          measure: commonPathMeasure,
          status: "verified",
          source: {
            fileName: "G-001.pdf",
            pageNumber: 1,
            excerpt: 'Common path of travel 72\'-4".',
          },
        }),
        finding({
          id: "other",
          measureId: "measure-path",
          measure: commonPathMeasure,
          status: "conflicting",
          source: {
            fileName: "A-103.pdf",
            pageNumber: 1,
            excerpt: "Common path not shown on this sheet.",
          },
        }),
      ],
      allowed,
    );
    assert.equal(result[0]?.status, "verified");
    assert.doesNotMatch(result[0]?.note ?? "", /not shown/i);
  });
});
