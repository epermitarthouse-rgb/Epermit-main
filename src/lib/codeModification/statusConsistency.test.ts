import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mergeFindingsFromSheets,
  synthesizeMeasureEvidence,
  validateSynthesisInvariants,
} from "./mergeEvidence.ts";
import { validateModelStatusAgainstEvidence } from "./rawObservationNormalization.ts";
import type { EvidenceFinding } from "./model.ts";

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

describe("statusConsistency A–G", () => {
  it("A. no evidence, model VERIFIED → NOT_FOUND", () => {
    const measure = "Incorporate agency recommendations from June 9, 2026 review meeting";
    const synthesized = synthesizeMeasureEvidence({
      id: "pdrm",
      measureId: "measure-pdrm",
      measure,
      status: "verified",
      observations: [
        {
          status: "verified",
          source: { fileName: "G-001.pdf", pageNumber: 1 },
          note: "DOB recommendations from the review meeting are not mentioned or shown.",
        },
      ],
    });

    assert.equal(synthesized.status, "not_found");
    assert.equal(validateSynthesisInvariants(synthesized).length, 0);
  });

  it("B. 2/3 components, no contradiction → PARTIAL not CONFLICTING", () => {
    const measure = "Provide a two-hour fire rated enclosed stairway serving all occupied levels";
    const synthesized = synthesizeMeasureEvidence({
      id: "stair",
      measureId: "measure-stair",
      measure,
      status: "conflicting",
      observations: [
        {
          status: "verified",
          source: {
            fileName: "G-001.pdf",
            pageNumber: 1,
            excerpt: "2-hour fire rated stair enclosure noted.",
          },
        },
        {
          status: "verified",
          source: {
            fileName: "A-101.pdf",
            pageNumber: 1,
            excerpt: "Drawing does not establish serving all occupied levels.",
          },
        },
      ],
    });

    assert.equal(synthesized.status, "partially_supported");
    assert.notEqual(synthesized.status, "conflicting");
    assert.equal(validateSynthesisInvariants(synthesized).length, 0);
  });

  it("C. all components supported → VERIFIED", () => {
    const measure = "Provide a two-hour fire rated enclosed stairway serving all occupied levels";
    const synthesized = synthesizeMeasureEvidence({
      id: "stair",
      measureId: "measure-stair",
      measure,
      status: "partially_supported",
      observations: [
        {
          status: "verified",
          source: {
            fileName: "G-001.pdf",
            pageNumber: 1,
            excerpt: "2-hour fire rated enclosed stairway noted.",
          },
        },
        {
          status: "verified",
          source: {
            fileName: "A-101.pdf",
            pageNumber: 1,
            excerpt: "Stair shown serving all occupied levels.",
          },
        },
      ],
    });

    assert.equal(synthesized.status, "verified");
    assert.equal(validateSynthesisInvariants(synthesized).length, 0);
  });

  it("D. support + unrelated not shown → VERIFIED", () => {
    const measure = "Provide a fully automatic sprinkler system throughout the building";
    const synthesized = synthesizeMeasureEvidence({
      id: "sprinkler",
      measureId: "measure-sprinkler",
      measure,
      status: "verified",
      observations: [
        {
          status: "verified",
          source: {
            fileName: "FA-101.pdf",
            pageNumber: 2,
            excerpt: "Automatic sprinkler system noted.",
          },
        },
        {
          status: "not_found",
          source: { fileName: "Unrelated.pdf", pageNumber: 1 },
          note: "Sprinkler system not shown on this sheet.",
        },
      ],
    });

    assert.equal(synthesized.status, "verified");
    assert.equal(validateSynthesisInvariants(synthesized).length, 0);
  });

  it("E. explicit incompatible facts → CONFLICTING", () => {
    const measure = "Maintain an occupant load below 49 people per floor";
    const merged = mergeFindingsFromSheets(
      [
        finding({
          id: "base",
          measureId: "measure-occupant",
          measure,
          status: "verified",
          source: {
            fileName: "Base_Set.pdf",
            pageNumber: 3,
            excerpt: "Occupant load 48 per floor.",
          },
        }),
      ],
      [
        finding({
          id: "conflict",
          measureId: "measure-occupant",
          measure,
          status: "verified",
          source: {
            fileName: "Evidence_Conflict.pdf",
            pageNumber: 1,
            excerpt: "Occupant load schedule shows 60 occupants.",
          },
        }),
      ],
    );

    assert.equal(merged[0]?.status, "conflicting");
    assert.equal(validateSynthesisInvariants(merged[0]!).length, 0);
  });

  it("F. model CONFLICTING, no normalized contradiction → not CONFLICTING", () => {
    const measure = "Provide a fully automatic sprinkler system throughout the building";
    const merged = mergeFindingsFromSheets(
      [
        finding({
          id: "support",
          measureId: "measure-sprinkler",
          measure,
          status: "verified",
          source: {
            fileName: "FA-101.pdf",
            pageNumber: 2,
            excerpt: "Automatic sprinkler throughout building.",
          },
        }),
      ],
      [
        finding({
          id: "absence",
          measureId: "measure-sprinkler",
          measure,
          status: "conflicting",
          source: {
            fileName: "A-101.pdf",
            pageNumber: 1,
            excerpt: "Sprinkler not shown on this floor plan.",
          },
        }),
      ],
    );

    assert.notEqual(merged[0]?.status, "conflicting");
    assert.equal(merged[0]?.status, "verified");
    assert.equal(validateSynthesisInvariants(merged[0]!).length, 0);
  });

  it("G. model VERIFIED, absence-only evidence → not VERIFIED", () => {
    const status = validateModelStatusAgainstEvidence({
      status: "verified",
      note: "Agency recommendations are not mentioned or shown.",
    });
    assert.equal(status, "not_found");

    const synthesized = synthesizeMeasureEvidence({
      id: "pdrm",
      measureId: "measure-pdrm",
      measure: "Incorporate agency recommendations from review meeting",
      status: "verified",
      observations: [{ status: "verified", note: "Recommendations not mentioned or shown." }],
    });
    assert.notEqual(synthesized.status, "verified");
    assert.equal(synthesized.status, "not_found");
  });

  it("H. staff-guidance 3-hour stair without drawing proof → not VERIFIED", () => {
    const measure = "Provide a 3-hour fire rated enclosed stairway serving all occupied levels";
    const synthesized = synthesizeMeasureEvidence({
      id: "stair-3h",
      measureId: "measure-stair-3h",
      measure,
      status: "verified",
      observations: [
        {
          status: "verified",
          source: { fileName: "A-101.pdf", pageNumber: 1 },
          note: "Staff guidance asked to verify 3-hour stair rating; no fire rating annotation visible on plan.",
        },
      ],
    });

    assert.notEqual(synthesized.status, "verified");
    if (synthesized.source?.excerpt) {
      assert.doesNotMatch(synthesized.source.excerpt, /staff guidance|analysis instructions/i);
    }
    assert.equal(validateSynthesisInvariants(synthesized).length, 0);
  });
});
