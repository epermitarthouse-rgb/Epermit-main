import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  NOT_FOUND_NOTE,
  classifyObservationPassage,
  computeDeterministicEvidenceStatus,
  enforceSynthesisConsistency,
  isPerSheetScopedAbsence,
  partitionObservationsByClassification,
  shouldTreatAsConflict,
  validateFinalConsistency,
} from "./evidenceClassification.ts";
import {
  consolidateFinalMeasureResults,
  enforceFinalPersistenceInvariants,
  mergeFindingsFromSheets,
  synthesizeMeasureEvidence,
  validateOneRowPerMeasure,
  validateSynthesisInvariants,
} from "./mergeEvidence.ts";
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

describe("evidenceClassification", () => {
  const stairMeasure = "Provide a two-hour fire rated enclosed stairway serving all occupied levels";
  const sprinklerMeasure = "Provide a fully automatic sprinkler system throughout the building";
  const pdrmMeasure = "Incorporate agency recommendations from June 9, 2026 review meeting";
  const standpipeMeasure = "Include a standpipe";
  const commonPathMeasure = "Maintain a common path of travel distance of less than 75'-0\"";
  const occupantMeasure = "Maintain an occupant load below 49 people per floor";

  it("support + silent unrelated sheet → VERIFIED or PARTIAL", () => {
    const status = computeDeterministicEvidenceStatus({
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
          status: "not_found",
          source: { fileName: "Unrelated_Feature.pdf", pageNumber: 1 },
          note: "No evidence for this measure on this sheet.",
        },
      ],
      measureText: stairMeasure,
      shouldConflict: false,
    });
    assert.ok(status === "verified" || status === "partially_supported");
    assert.notEqual(status, "conflicting");
    assert.notEqual(status, "not_found");
  });

  it("no evidence → MISSING_UNVERIFIED (not_found)", () => {
    const synthesized = synthesizeMeasureEvidence({
      id: "pdrm",
      measureId: "measure-pdrm",
      measure: pdrmMeasure,
      status: "not_found",
      observations: [
        {
          status: "not_found",
          source: { fileName: "G-001.pdf", pageNumber: 1 },
          note: "No evidence for this measure on this sheet.",
        },
      ],
    });
    assert.equal(synthesized.status, "not_found");
    assert.equal(synthesized.source, null);
    assert.equal(synthesized.note, NOT_FOUND_NOTE);
  });

  it("VERIFIED impossible with absence-only note", () => {
    const corrected = enforceSynthesisConsistency({
      id: "pdrm",
      measureId: "measure-pdrm",
      measure: pdrmMeasure,
      status: "verified",
      source: { fileName: "G-001.pdf", pageNumber: 1 },
      note: "Agency recommendations are not mentioned or shown.",
      observations: [
        {
          status: "verified",
          source: {
            fileName: "G-001.pdf",
            pageNumber: 1,
            excerpt: "Recommendations are not mentioned or shown.",
          },
        },
      ],
    });
    assert.equal(corrected.status, "not_found");
    assert.equal(corrected.source, null);
    assert.equal(validateFinalConsistency(corrected).length, 0);
  });

  it("48 vs 60 occupant load → CONFLICTING", () => {
    const merged = mergeFindingsFromSheets(
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
      ],
      [
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
    );
    assert.equal(merged[0]?.status, "conflicting");
  });

  it("base deferral + addendum supply → VERIFIED", () => {
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
    assert.equal(merged[0]?.status, "verified");
  });

  it("unresolved contradictions → CONFLICTING", () => {
    const conflict = shouldTreatAsConflict({
      observations: [
        {
          status: "verified",
          source: {
            fileName: "A.pdf",
            pageNumber: 1,
            excerpt: "Feature is included on base sheet.",
          },
        },
        {
          status: "verified",
          source: {
            fileName: "B.pdf",
            pageNumber: 1,
            excerpt: "Feature not included on base sheet.",
          },
        },
      ],
      measureText: "Include feature X",
      revisionResolution: false,
    });
    assert.equal(conflict, true);
  });

  it("common path one sheet + omission on other → VERIFIED", () => {
    const merged = mergeFindingsFromSheets(
      [
        finding({
          id: "g001",
          measureId: "measure-path",
          measure: commonPathMeasure,
          status: "verified",
          source: {
            fileName: "G-001.pdf",
            pageNumber: 1,
            excerpt: "Common path of travel 72'-4\".",
          },
        }),
      ],
      [
        finding({
          id: "other",
          measureId: "measure-path",
          measure: commonPathMeasure,
          status: "conflicting",
          source: {
            fileName: "Other.pdf",
            pageNumber: 1,
            excerpt: "Common path not shown on this sheet.",
          },
        }),
      ],
    );
    assert.equal(merged[0]?.status, "verified");
    assert.doesNotMatch(merged[0]?.note ?? "", /not shown/i);
  });

  it("irrelevant passage cannot be primary citation", () => {
    const { supports, notRelevant } = partitionObservationsByClassification(
      [
        {
          status: "verified",
          source: {
            fileName: "Feature_Sheet.pdf",
            pageNumber: 1,
            excerpt: "Class I building feature noted on riser diagram.",
          },
        },
      ],
      pdrmMeasure,
    );
    assert.equal(supports.length, 0);
    assert.equal(notRelevant.length, 1);
    assert.equal(
      classifyObservationPassage(
        {
          status: "verified",
          source: {
            fileName: "Feature_Sheet.pdf",
            pageNumber: 1,
            excerpt: "Class I building feature noted on riser diagram.",
          },
        },
        pdrmMeasure,
      ),
      "NOT_RELEVANT",
    );
  });

  it("every not_found measure belongs in missing section grouping", () => {
    const evidence: EvidenceFinding[] = [
      finding({
        id: "a",
        measureId: "measure-a",
        measure: pdrmMeasure,
        status: "not_found",
      }),
      finding({
        id: "b",
        measureId: "measure-b",
        measure: sprinklerMeasure,
        status: "verified",
        source: { fileName: "FA-101.pdf", pageNumber: 1 },
      }),
    ];
    const missing = evidence.filter((row) => row.status === "not_found");
    assert.equal(missing.length, 1);
    assert.equal(missing[0]?.measureId, "measure-a");
  });

  it("every conflicting measure belongs in conflicts section grouping", () => {
    const merged = mergeFindingsFromSheets(
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
      ],
      [
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
    );
    const conflicts = merged.filter((row) => row.status === "conflicting");
    assert.equal(conflicts.length, 1);
    assert.equal(validateSynthesisInvariants(conflicts[0]!).length, 0);
  });

  it("silence on unrelated sheet classifies as NOT_RELEVANT not CONTRADICTS", () => {
    assert.equal(
      classifyObservationPassage(
        {
          status: "conflicting",
          source: {
            fileName: "Unrelated.pdf",
            pageNumber: 1,
            excerpt: "Standpipe not shown on this riser diagram.",
          },
        },
        stairMeasure,
      ),
      "NOT_RELEVANT",
    );
  });

  it("extraction uncertainty is NOT_RELEVANT not CONTRADICTS", () => {
    assert.equal(
      classifyObservationPassage(
        {
          status: "conflicting",
          source: {
            fileName: "A-101.pdf",
            pageNumber: 1,
            excerpt: "Cannot determine serving all occupied levels from this sheet.",
          },
        },
        stairMeasure,
      ),
      "NOT_RELEVANT",
    );
  });

  it("per-sheet absence on unrelated discipline plan is NOT_RELEVANT", () => {
    const text = "Two-hour stair enclosure not shown on sprinkler plan.";
    assert.equal(isPerSheetScopedAbsence(text), true);
    assert.equal(
      classifyObservationPassage(
        { status: "verified", source: { fileName: "FP-101.pdf", pageNumber: 3, excerpt: text } },
        stairMeasure,
      ),
      "NOT_RELEVANT",
    );
    const merged = mergeFindingsFromSheets(
      [
        finding({
          id: "support",
          measureId: "measure-stair",
          measure: stairMeasure,
          status: "verified",
          source: {
            fileName: "G-001.pdf",
            pageNumber: 1,
            excerpt: "2-hour fire rated stair enclosure noted.",
          },
        }),
      ],
      [
        finding({
          id: "fp101",
          measureId: "measure-stair",
          measure: stairMeasure,
          status: "verified",
          source: { fileName: "FP-101.pdf", pageNumber: 3, excerpt: text },
        }),
      ],
    );
    assert.notEqual(merged[0]?.status, "conflicting");
    assert.equal(validateFinalConsistency(merged[0]!).length, 0);
  });
});

describe("end-of-pipeline invariants", () => {
  const stairMeasure = "Provide a two-hour fire rated enclosed stairway serving all occupied levels";
  const pdrmMeasure = "Incorporate DOB recommendations from June 9, 2026 PDRM";

  it("1. support + unrelated discipline no-evidence-on-sheet → not conflicting", () => {
    const result = enforceFinalPersistenceInvariants([
      {
        id: "stair",
        measureId: "measure-stair",
        measure: stairMeasure,
        status: "conflicting",
        source: { fileName: "G-001.pdf", pageNumber: 1, excerpt: "2-hour stair noted." },
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
            status: "conflicting",
            source: {
              fileName: "FP-101.pdf",
              pageNumber: 3,
              excerpt: "No evidence of two-hour stair enclosure on sprinkler plan.",
            },
          },
        ],
      },
    ]);
    assert.equal(result.length, 1);
    assert.notEqual(result[0]?.status, "conflicting");
  });

  it("2. support + incomplete coverage → partial/verified not conflicting", () => {
    const result = enforceFinalPersistenceInvariants([
      {
        id: "stair",
        measureId: "measure-stair",
        measure: stairMeasure,
        status: "conflicting",
        source: { fileName: "G-001.pdf", pageNumber: 1 },
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
            status: "conflicting",
            source: {
              fileName: "A-101.pdf",
              pageNumber: 1,
              excerpt: "Drawing does not establish serving all occupied levels.",
            },
          },
        ],
      },
    ]);
    assert.equal(result[0]?.status, "partially_supported");
  });

  it("3. two candidate statuses for one measure → one final row", () => {
    const result = consolidateFinalMeasureResults([
      {
        id: "p1",
        measureId: "measure-pdrm",
        measure: pdrmMeasure,
        status: "requires_professional_dob_review",
        source: { fileName: "G-001.pdf", pageNumber: 1, excerpt: "PDRM unclear." },
        note: "Review needed.",
        observations: [
          {
            status: "requires_professional_dob_review",
            source: { fileName: "G-001.pdf", pageNumber: 1, excerpt: "PDRM unclear." },
          },
          {
            status: "not_found",
            note: "No drawing evidence was reviewed for this measure.",
          },
        ],
      },
      {
        id: "p2",
        measureId: "measure-pdrm",
        measure: pdrmMeasure,
        status: "not_found",
        source: null,
        note: "No drawing evidence was reviewed for this measure.",
        observations: [
          {
            status: "not_found",
            note: "No drawing evidence was reviewed for this measure.",
          },
        ],
      },
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0]?.status, "not_found");
    assert.equal(result[0]?.source, null);
  });

  it("4. no evidence + pro-review candidate → NOT_FOUND", () => {
    const result = enforceFinalPersistenceInvariants([
      {
        id: "pdrm",
        measureId: "measure-pdrm",
        measure: pdrmMeasure,
        status: "requires_professional_dob_review",
        source: {
          fileName: "G-001.pdf",
          pageNumber: 1,
          excerpt: "DOB recommendations from the review meeting are not mentioned or shown.",
        },
        observations: [
          {
            status: "requires_professional_dob_review",
            source: {
              fileName: "G-001.pdf",
              pageNumber: 1,
              excerpt: "DOB recommendations from the review meeting are not mentioned or shown.",
            },
          },
        ],
      },
    ]);
    assert.equal(result[0]?.status, "not_found");
    assert.equal(result[0]?.source, null);
  });

  it("5. irrelevant absence → not citation/note", () => {
    const result = enforceFinalPersistenceInvariants([
      {
        id: "pdrm",
        measureId: "measure-pdrm",
        measure: pdrmMeasure,
        status: "verified",
        source: {
          fileName: "FP-102.pdf",
          pageNumber: 1,
          excerpt: "Class I standpipe noted on riser diagram.",
        },
        observations: [
          {
            status: "verified",
            source: {
              fileName: "FP-102.pdf",
              pageNumber: 1,
              excerpt: "Class I standpipe noted on riser diagram.",
            },
          },
        ],
      },
    ]);
    assert.equal(result[0]?.status, "not_found");
    assert.equal(result[0]?.source, null);
    assert.doesNotMatch(result[0]?.note ?? "", /standpipe/i);
  });

  it("6. genuine contradiction → CONFLICTING", () => {
    const occupantMeasure = "Maintain an occupant load below 49 people per floor";
    const result = enforceFinalPersistenceInvariants([
      {
        id: "occ",
        measureId: "measure-occupant",
        measure: occupantMeasure,
        status: "verified",
        observations: [
          {
            status: "verified",
            source: {
              fileName: "Base_Set.pdf",
              pageNumber: 3,
              excerpt: "Occupant load 48 per floor.",
            },
          },
          {
            status: "verified",
            source: {
              fileName: "Evidence_Conflict.pdf",
              pageNumber: 1,
              excerpt: "Occupant load schedule shows 60 occupants.",
            },
          },
        ],
      },
    ]);
    assert.equal(result[0]?.status, "conflicting");
  });

  it("7. enforce downgrades invalid CONFLICTING instead of logging only", () => {
    const corrected = enforceSynthesisConsistency({
      id: "stair",
      measureId: "measure-stair",
      measure: stairMeasure,
      status: "conflicting",
      source: { fileName: "G-001.pdf", pageNumber: 1 },
      note: "Conflicting evidence across submitted drawing sheets.",
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
          status: "conflicting",
          source: {
            fileName: "FP-101.pdf",
            pageNumber: 3,
            excerpt: "No evidence of two-hour stair enclosure on sprinkler plan.",
          },
        },
      ],
    });
    assert.notEqual(corrected.status, "conflicting");
    assert.equal(validateFinalConsistency(corrected).length, 0);
  });
});

describe("evidenceClassification persisted == synthesized", () => {
  it("synthesized finding passes final consistency validator", () => {
    const synthesized = synthesizeMeasureEvidence({
      id: "sprinkler",
      measureId: "measure-sprinkler",
      measure: "Provide a fully automatic sprinkler system throughout the building",
      status: "verified",
      observations: [
        {
          status: "verified",
          source: {
            fileName: "FA-101.pdf",
            pageNumber: 2,
            excerpt: "Automatic sprinkler throughout building.",
          },
        },
        {
          status: "not_found",
          source: { fileName: "A-101.pdf", pageNumber: 1 },
          note: "No evidence for this measure on this sheet.",
        },
      ],
    });
    assert.equal(validateSynthesisInvariants(synthesized).length, 0);
    assert.equal(enforceSynthesisConsistency(synthesized).status, synthesized.status);
  });
});
