import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalMeasureKey,
  measuresAreCanonicallyEquivalent,
} from "./canonicalMeasure.ts";
import {
  excerptsContradict,
  evidencePolarity,
  isAddendumEvidenceSource,
  isRevisionEvidenceSource,
  mergeFindingsFromSheets,
  synthesizeMeasureEvidence,
  validateOneRowPerMeasure,
  type MergeableEvidenceFinding,
} from "./mergeEvidence.ts";
import { normalizeProposedMeasures, splitMeasureDescription } from "./extractForm.ts";
import type { EvidenceFinding } from "./model.ts";

const COMBINED_MEASURE_WITH_BOILERPLATE =
  "In lieu of providing a second means of egress stairs, the following life safety measures are proposed: Provide a two-hour fire rated enclosed stairway serving all occupied levels, provide a fully automatic sprinkler system throughout the building, provide a fully monitored fire alarm and emergency notification system, maintain an occupant load below 49 people per floor. Incorporated DOB recommendations from June 9, 2026 PDRM include a standpipe, maintain a common path of travel distance of less than 75'-0\", provide permanent signage identifying and limiting the maximum occupant load of the rooftop amenity area.";

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

function notFoundOnSheet(
  measureId: string,
  measure: string,
  fileName: string,
  pageNumber: number,
): EvidenceFinding {
  return finding({
    id: `${fileName}-${pageNumber}`,
    measureId,
    measure,
    status: "not_found",
    source: { fileName, pageNumber },
    note: "No evidence for this measure on this sheet.",
  });
}

describe("mergeEvidence synthesis hardening A–L", () => {
  it("A. measure identity collapses Include standpipe / Include a standpipe", () => {
    const merged = mergeFindingsFromSheets(
      [
        finding({
          id: "a",
          measureId: "measure-a",
          measure: "Include standpipe",
          status: "verified",
          source: { fileName: "Base_Set.pdf", pageNumber: 1, excerpt: "Deferred to supplement." },
        }),
      ],
      [
        finding({
          id: "b",
          measureId: "measure-b",
          measure: "Include a standpipe",
          status: "verified",
          source: {
            fileName: "Supplement_01.pdf",
            pageNumber: 1,
            excerpt: "Requirement included per supplement.",
          },
        }),
      ],
    );

    assert.equal(merged.length, 1);
    assert.equal(validateOneRowPerMeasure(merged), true);
  });

  it("B. negative dedupe keeps sprinkler and fire alarm separate", () => {
    const merged = mergeFindingsFromSheets(
      [
        finding({
          id: "sprinkler",
          measureId: "measure-1",
          measure: "Provide a fully automatic sprinkler system throughout the building",
          status: "verified",
          source: { fileName: "M-001.pdf", pageNumber: 1, excerpt: "Sprinkler noted." },
        }),
      ],
      [
        finding({
          id: "alarm",
          measureId: "measure-2",
          measure: "Provide a fully monitored fire alarm and emergency notification system",
          status: "verified",
          source: { fileName: "M-002.pdf", pageNumber: 1, excerpt: "Alarm noted." },
        }),
      ],
    );

    assert.equal(merged.length, 2);
    assert.notEqual(canonicalMeasureKey(merged[0]!), canonicalMeasureKey(merged[1]!));
  });

  it("C. numeric occupant load conflict → CONFLICTING", () => {
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

    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.status, "conflicting");
  });

  it("D. door width 36 in vs 32 in → CONFLICTING", () => {
    const measure = "Maintain minimum door width of 36 inches";
    const merged = mergeFindingsFromSheets(
      [
        finding({
          id: "a",
          measureId: "measure-door",
          measure,
          status: "verified",
          source: { fileName: "A-001.pdf", pageNumber: 1, excerpt: "Door width 36 in noted." },
        }),
      ],
      [
        finding({
          id: "b",
          measureId: "measure-door",
          measure,
          status: "verified",
          source: { fileName: "A-002.pdf", pageNumber: 2, excerpt: "Door width 32 in at corridor." },
        }),
      ],
    );

    assert.equal(merged[0]?.status, "conflicting");
  });

  it("E. compatible common-path values under limit → VERIFIED", () => {
    const measure = "Maintain a common path of travel distance of less than 75'-0\"";
    const merged = mergeFindingsFromSheets(
      [
        finding({
          id: "a",
          measureId: "measure-path",
          measure,
          status: "verified",
          source: { fileName: "G-001.pdf", pageNumber: 1, excerpt: "Common path of travel 72'-4\"." },
        }),
      ],
      [
        finding({
          id: "b",
          measureId: "measure-path",
          measure,
          status: "verified",
          source: { fileName: "A-102.pdf", pageNumber: 2, excerpt: "Common path of travel 71'-0\"." },
        }),
      ],
    );

    assert.equal(merged[0]?.status, "verified");
  });

  it("F. supporting evidence wins over unrelated not-found sheets", () => {
    const synthesized = synthesizeMeasureEvidence({
      id: "stair",
      measureId: "measure-stair",
      measure: "Provide a two-hour fire rated enclosed stairway serving all occupied levels",
      status: "verified",
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
          source: { fileName: "Unrelated_Supplement.pdf", pageNumber: 1 },
          note: "No evidence for this measure on this sheet.",
        },
      ],
    });

    assert.equal(synthesized.status, "verified");
    assert.doesNotMatch(synthesized.note ?? "", /No evidence for this measure/i);
  });

  it("G. no relevant evidence → NOT_FOUND with null source and standard note", () => {
    const merged = mergeFindingsFromSheets(
      [
        finding({
          id: "seed",
          measureId: "measure-pdrm",
          measure: "Incorporate agency recommendations from June 9, 2026 review meeting",
          status: "not_found",
          note: "No drawing evidence was reviewed for this measure.",
        }),
      ],
      [
        notFoundOnSheet(
          "measure-pdrm",
          "Incorporate agency recommendations from June 9, 2026 review meeting",
          "G-001.pdf",
          1,
        ),
        notFoundOnSheet(
          "measure-pdrm",
          "Incorporate agency recommendations from June 9, 2026 review meeting",
          "A-101.pdf",
          1,
        ),
      ],
    );

    assert.equal(merged[0]?.status, "not_found");
    assert.equal(merged[0]?.source, null);
    assert.equal(
      merged[0]?.note,
      "No relevant evidence was found in the reviewed drawing set.",
    );
  });

  it("H. base deferral + present revision reconciles to VERIFIED", () => {
    const measure = "Include a standpipe";
    const merged = mergeFindingsFromSheets(
      [
        finding({
          id: "base",
          measureId: "measure-standpipe",
          measure,
          status: "verified",
          source: {
            fileName: "Base_Set.pdf",
            pageNumber: 4,
            excerpt: "Requirement not included on base; see Supplement_01 addendum.",
          },
        }),
      ],
      [
        finding({
          id: "revision",
          measureId: "measure-standpipe",
          measure,
          status: "verified",
          source: {
            fileName: "Supplement_01.pdf",
            pageNumber: 1,
            excerpt: "Requirement included per addendum.",
          },
        }),
      ],
    );

    assert.equal(merged[0]?.status, "verified");
    assert.match(merged[0]?.note ?? "", /Base_Set\.pdf p\.4/i);
    assert.match(merged[0]?.note ?? "", /Supplement_01\.pdf p\.1/i);
  });

  it("I. referenced revision absent does not falsely verify via polarity conflict", () => {
    const measure = "Include a standpipe";
    const merged = mergeFindingsFromSheets(
      [
        finding({
          id: "base",
          measureId: "measure-standpipe",
          measure,
          status: "verified",
          source: {
            fileName: "Base_Set.pdf",
            pageNumber: 4,
            excerpt: "Requirement not included on base; see Supplement_99 addendum.",
          },
        }),
      ],
      [
        finding({
          id: "other",
          measureId: "measure-standpipe",
          measure,
          status: "verified",
          source: {
            fileName: "A-101.pdf",
            pageNumber: 1,
            excerpt: "Requirement is included on this sheet.",
          },
        }),
      ],
    );

    assert.equal(merged[0]?.status, "conflicting");
  });

  it("J. shuffled merge order yields identical synthesis", () => {
    const measure = "Provide a fully automatic sprinkler system throughout the building";
    const sheets = [
      finding({
        id: "1",
        measureId: "measure-sprinkler",
        measure,
        status: "verified",
        source: { fileName: "FA-101.pdf", pageNumber: 2, excerpt: "Sprinkler noted." },
      }),
      finding({
        id: "2",
        measureId: "measure-sprinkler",
        measure,
        status: "not_found",
        source: { fileName: "A-101.pdf", pageNumber: 1 },
        note: "No evidence for this measure on this sheet.",
      }),
      finding({
        id: "3",
        measureId: "measure-sprinkler",
        measure,
        status: "verified",
        source: { fileName: "FP-101.pdf", pageNumber: 3, excerpt: "Riser shown." },
      }),
    ];

    const forward = sheets.reduce<EvidenceFinding[]>(
      (acc, sheetFinding) => mergeFindingsFromSheets(acc, [sheetFinding]),
      [],
    );
    const reverse = [...sheets]
      .reverse()
      .reduce<EvidenceFinding[]>(
        (acc, sheetFinding) => mergeFindingsFromSheets(acc, [sheetFinding]),
        [],
      );

    assert.deepEqual(forward[0]?.status, reverse[0]?.status);
    assert.deepEqual(forward[0]?.source?.fileName, reverse[0]?.source?.fileName);
    assert.deepEqual(forward[0]?.note, reverse[0]?.note);
  });

  it("K. renamed filenames preserve synthesis when reference metadata is sufficient", () => {
    const measure = "Include a standpipe";
    const canonical = mergeFindingsFromSheets(
      [
        finding({
          id: "base",
          measureId: "measure-standpipe",
          measure,
          status: "verified",
          source: {
            fileName: "Base_Set.pdf",
            pageNumber: 4,
            excerpt: "Requirement not included on base; see Supplement_01 addendum.",
          },
        }),
      ],
      [
        finding({
          id: "supplement",
          measureId: "measure-standpipe",
          measure,
          status: "verified",
          source: {
            fileName: "Supplement_01.pdf",
            pageNumber: 1,
            excerpt: "Requirement included per addendum.",
          },
        }),
      ],
    );

    const renamed = mergeFindingsFromSheets(
      [
        finding({
          id: "base",
          measureId: "measure-standpipe",
          measure,
          status: "verified",
          source: {
            fileName: "Drawing_A.pdf",
            pageNumber: 4,
            excerpt: "Requirement not included on base; see Supplement_01 addendum.",
          },
        }),
      ],
      [
        finding({
          id: "supplement",
          measureId: "measure-standpipe",
          measure,
          status: "verified",
          source: {
            fileName: "Drawing_B_Addendum.pdf",
            pageNumber: 1,
            excerpt: "Requirement included per addendum.",
          },
        }),
      ],
    );

    assert.equal(canonical[0]?.status, renamed[0]?.status);
    assert.equal(canonical[0]?.status, "verified");
  });

  it("L. 50 observations dedupe to one final row with deterministic semantics", () => {
    const measure = "Provide a fully automatic sprinkler system throughout the building";
    const observations = Array.from({ length: 50 }, (_, index) => ({
      status: "verified" as const,
      source: {
        fileName: `Sheet-${index % 5}.pdf`,
        pageNumber: (index % 3) + 1,
        excerpt: index % 2 === 0 ? "Sprinkler system noted." : "Automatic sprinkler shown.",
      },
      note: index % 4 === 0 ? "Sprinkler system noted." : null,
    }));

    const synthesized = synthesizeMeasureEvidence({
      id: "sprinkler",
      measureId: "measure-sprinkler",
      measure,
      status: "verified",
      observations,
    });

    assert.equal(synthesized.status, "verified");
    assert.equal(validateOneRowPerMeasure([synthesized]), true);
    assert.doesNotMatch(synthesized.note ?? "", /Sheet-0\.pdf.*Sheet-0\.pdf/);
  });
});

describe("mergeEvidence regression A–G", () => {
  it("A. sheet1 supports sprinkler, sheets 2-5 omit → VERIFIED", () => {
    const measure = "Provide a fully automatic sprinkler system throughout the building";
    let merged = mergeFindingsFromSheets(
      [
        finding({
          id: "g001",
          measureId: "measure-sprinkler",
          measure,
          status: "verified",
          source: {
            fileName: "G-001.pdf",
            sheetLabel: "G-001",
            pageNumber: 1,
            excerpt: "NFPA 13 automatic sprinkler noted.",
          },
        }),
      ],
      [
        finding({
          id: "fp101",
          measureId: "measure-sprinkler",
          measure,
          status: "verified",
          source: {
            fileName: "FP-101.pdf",
            pageNumber: 3,
            excerpt: "Wet-pipe sprinkler throughout.",
          },
        }),
      ],
    );
    for (const sheet of ["A-101", "A-102", "A-103", "FA-101"]) {
      merged = mergeFindingsFromSheets(merged, [
        notFoundOnSheet("measure-sprinkler", measure, `${sheet}.pdf`, 1),
      ]);
    }

    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.status, "verified");
    assert.match(merged[0]?.source?.fileName ?? "", /G-001|FP-101/);
    assert.doesNotMatch(merged[0]?.note ?? "", /No evidence for this measure/i);
  });

  it("B. sheet1 48 occupant, sheet2 60 → CONFLICTING", () => {
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
          id: "a103",
          measureId: "measure-occupant",
          measure,
          status: "conflicting",
          source: {
            fileName: "A-103.pdf",
            pageNumber: 2,
            excerpt: "Occupant load schedule shows 60 occupants.",
          },
        }),
      ],
    );

    assert.equal(merged[0]?.status, "conflicting");
    assert.match(merged[0]?.note ?? "", /48/i);
    assert.match(merged[0]?.note ?? "", /60/i);
  });

  it("C. two supporting common-path distances → VERIFIED", () => {
    const measure = "Maintain a common path of travel distance of less than 75'-0\"";
    const merged = mergeFindingsFromSheets(
      [
        finding({
          id: "g001",
          measureId: "measure-common-path",
          measure,
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
          id: "a102",
          measureId: "measure-common-path",
          measure,
          status: "verified",
          source: {
            fileName: "A-102.pdf",
            pageNumber: 2,
            excerpt: "Common path of travel 71'-0\".",
          },
        }),
      ],
    );

    assert.equal(merged[0]?.status, "verified");
  });

  it("D. no PDRM evidence → NOT FOUND without arbitrary citation", () => {
    const measure = "Incorporate DOB recommendations from June 9, 2026 PDRM";
    const merged = mergeFindingsFromSheets(
      [
        finding({
          id: "seed",
          measureId: "measure-pdrm",
          measure,
          status: "not_found",
          note: "No drawing evidence was reviewed for this measure.",
        }),
      ],
      [
        notFoundOnSheet("measure-pdrm", measure, "G-001.pdf", 1),
        notFoundOnSheet("measure-pdrm", measure, "A-101.pdf", 1),
      ],
    );

    assert.equal(merged[0]?.status, "not_found");
    assert.equal(merged[0]?.source, null);
    assert.equal(
      merged[0]?.note,
      "No relevant evidence was found in the reviewed drawing set.",
    );
  });

  it("E. base deferral + addendum provision → VERIFIED with both preserved", () => {
    const measure = "Include a standpipe";
    const merged = mergeFindingsFromSheets(
      [
        finding({
          id: "base",
          measureId: "measure-standpipe",
          measure,
          status: "verified",
          source: {
            fileName: "FP-101.pdf",
            sheetLabel: "FP-101",
            pageNumber: 4,
            excerpt: "Standpipe is not included on this base mock set.",
          },
        }),
      ],
      [
        finding({
          id: "addendum",
          measureId: "measure-standpipe",
          measure,
          status: "verified",
          source: {
            fileName: "Revision_Feature_Sheet.pdf",
            sheetLabel: "Revision Feature Sheet",
            pageNumber: 1,
            excerpt: "Class I standpipe included per addendum.",
          },
        }),
        notFoundOnSheet("measure-standpipe", measure, "A-101.pdf", 1),
      ],
    );

    assert.equal(merged[0]?.status, "verified");
    assert.match(merged[0]?.note ?? "", /FP-101 p\.4/i);
    assert.match(merged[0]?.note ?? "", /Revision Feature Sheet p\.1|Revision_Feature_Sheet\.pdf p\.1/i);
  });

  it("F. duplicate identical observations → one canonical", () => {
    const duplicateObservation = {
      status: "verified" as const,
      source: {
        fileName: "Addendum_Standpipe.pdf",
        pageNumber: 1,
        excerpt: "Class I standpipe included.",
      },
      note: "Addendum confirms standpipe.",
    };

    const synthesized = synthesizeMeasureEvidence({
      id: "fp102",
      measureId: "measure-standpipe",
      measure: "Include a standpipe",
      status: "verified",
      observations: [
        duplicateObservation,
        duplicateObservation,
        duplicateObservation,
        {
          status: "verified",
          source: {
            fileName: "FP-101.pdf",
            pageNumber: 4,
            excerpt: "Standpipe deferred to addendum.",
          },
          note: "Base sheet references addendum.",
        },
      ],
    });

    const addendumOccurrences =
      (synthesized.note ?? "").match(/Addendum_Standpipe\.pdf p\.1/g) ?? [];
    assert.equal(addendumOccurrences.length, 1);
    assert.match(synthesized.note ?? "", /FP-101\.pdf p\.4/i);
  });

  it("G. strong relevant evidence wins over unrelated not-found sheets", () => {
    const synthesized = synthesizeMeasureEvidence({
      id: "stair",
      measureId: "measure-stair",
      measure: "Provide a two-hour fire rated enclosed stairway serving all occupied levels",
      status: "verified",
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
          source: { fileName: "Addendum_Standpipe.pdf", pageNumber: 1 },
          note: "No evidence for this measure on this sheet.",
        },
      ],
    });

    assert.equal(synthesized.status, "verified");
    assert.match(synthesized.source?.fileName ?? "", /G-001/);
    assert.doesNotMatch(synthesized.note ?? "", /No evidence for this measure/i);
  });
});

describe("mergeEvidence helpers", () => {
  it("detects revision/addendum filenames", () => {
    assert.equal(isAddendumEvidenceSource({ fileName: "Addendum_Standpipe.pdf" }), true);
    assert.equal(isRevisionEvidenceSource({ fileName: "ASI-03.pdf" }), true);
    assert.equal(isAddendumEvidenceSource({ fileName: "FP-101.pdf" }), false);
  });

  it("detects contradictory excerpts via inclusion polarity", () => {
    assert.equal(
      excerptsContradict("Feature not included on base sheet.", "Feature is included on base sheet."),
      true,
    );
    assert.equal(
      excerptsContradict("Sprinkler riser shown.", "Sprinkler coverage noted on FP-101."),
      false,
    );
  });

  it("classifies evidence polarity without measure-specific keywords", () => {
    assert.equal(evidencePolarity("Class I standpipe included per addendum."), "positive");
    assert.equal(evidencePolarity("Sprinkler system not shown on this sheet."), "negative");
    assert.equal(evidencePolarity("General notes reference NFPA 13."), "neutral");
  });

  it("canonical equivalence is conservative", () => {
    assert.equal(measuresAreCanonicallyEquivalent("Include standpipe", "Include a standpipe"), true);
    assert.equal(
      measuresAreCanonicallyEquivalent("Provide sprinkler system", "Provide fire alarm system"),
      false,
    );
  });
});

describe("generic synthesis defect guards A–D", () => {
  it("A. three supportive 2-hour stair observations stay VERIFIED without numeric conflict", () => {
    const measure = "Provide a two-hour fire rated enclosed stairway serving all occupied levels";
    const synthesized = synthesizeMeasureEvidence({
      id: "stair",
      measureId: "measure-stair",
      measure,
      status: "verified",
      observations: [
        {
          status: "verified",
          source: {
            fileName: "General_Notes.pdf",
            pageNumber: 1,
            excerpt: "2-HOUR fire rating at stair enclosure.",
          },
        },
        {
          status: "verified",
          source: {
            fileName: "Plan_A.pdf",
            pageNumber: 1,
            excerpt: "1-hour corridor partitions; stair shaft 2-hour rated.",
          },
        },
        {
          status: "verified",
          source: {
            fileName: "Plan_B.pdf",
            pageNumber: 2,
            excerpt: "Egress path to enclosed 2-hour stair.",
          },
        },
      ],
    });

    assert.equal(synthesized.status, "verified");
  });

  it("B. base deferral + present revision provides Feature X → VERIFIED", () => {
    const measure = "Include feature X";
    const merged = mergeFindingsFromSheets(
      [
        finding({
          id: "base",
          measureId: "measure-feature-x",
          measure,
          status: "verified",
          source: {
            fileName: "Base_Set.pdf",
            pageNumber: 2,
            excerpt: "Feature X is not included on this base drawing set.",
          },
        }),
      ],
      [
        finding({
          id: "revision",
          measureId: "measure-feature-x",
          measure,
          status: "verified",
          source: {
            fileName: "Revision_R2_Detail.pdf",
            pageNumber: 1,
            excerpt: "Feature X is included per revision R2.",
          },
        }),
      ],
    );

    assert.equal(merged[0]?.status, "verified");
  });

  it("C. base deferral to absent revision R2 does not falsely verify unrelated support", () => {
    const measure = "Include feature X";
    const merged = mergeFindingsFromSheets(
      [
        finding({
          id: "base",
          measureId: "measure-feature-x",
          measure,
          status: "verified",
          source: {
            fileName: "Base_Set.pdf",
            pageNumber: 2,
            excerpt: "Feature X not included on base; see Revision R2 addendum.",
          },
        }),
      ],
      [
        finding({
          id: "other",
          measureId: "measure-feature-x",
          measure,
          status: "verified",
          source: {
            fileName: "Unrelated_Sheet.pdf",
            pageNumber: 1,
            excerpt: "Feature X is included on this sheet.",
          },
        }),
      ],
    );

    assert.equal(merged[0]?.status, "conflicting");
  });

  it("D. one support plus unrelated empty sheets stays VERIFIED", () => {
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
            fileName: "M-001.pdf",
            pageNumber: 1,
            excerpt: "Automatic sprinkler system noted.",
          },
        },
        ...Array.from({ length: 5 }, (_, index) => ({
          status: "not_found" as const,
          source: { fileName: `Empty_Sheet_${index + 1}.pdf`, pageNumber: 1 },
          note: "No evidence for this measure on this sheet.",
        })),
      ],
    });

    assert.equal(synthesized.status, "verified");
    assert.doesNotMatch(synthesized.note ?? "", /No evidence for this measure/i);
  });
});

describe("1513 regression fixture synthesis", () => {
  const measures = normalizeProposedMeasures([
    {
      id: "measure-1",
      description: COMBINED_MEASURE_WITH_BOILERPLATE,
      sourcePageNumber: 2,
    },
  ]);

  function measureByPattern(pattern: RegExp) {
    const match = measures.find((measure) => pattern.test(measure.description));
    assert.ok(match, `Expected measure matching ${pattern}`);
    return match;
  }

  function mergeSheetFindings(findings: EvidenceFinding[]): EvidenceFinding[] {
    return findings.reduce<EvidenceFinding[]>(
      (acc, sheetFinding) => mergeFindingsFromSheets(acc, [sheetFinding]),
      measures.map((measure, index) =>
        finding({
          id: `seed-${index + 1}`,
          measureId: measure.id,
          measure: measure.description,
          status: "not_found",
          note: "No drawing evidence was reviewed for this measure.",
        }),
      ),
    );
  }

  it("produces exactly 8 canonical measures from extraction", () => {
    assert.equal(measures.length, 8);
  });

  it("derives expected statuses from synthesis logic without hardcoded outputs", () => {
    const stair = measureByPattern(/two-hour fire rated enclosed stairway/i);
    const sprinkler = measureByPattern(/sprinkler system/i);
    const alarm = measureByPattern(/fire alarm/i);
    const occupant = measureByPattern(/occupant load below 49/i);
    const pdrm = measureByPattern(/PDRM/i);
    const standpipe = measureByPattern(/standpipe/i);
    const commonPath = measureByPattern(/common path of travel/i);
    const signage = measureByPattern(/permanent signage/i);

    const merged = mergeSheetFindings([
      finding({
        id: "stair-1",
        measureId: stair.id,
        measure: stair.description,
        status: "verified",
        source: { fileName: "Base_Set.pdf", pageNumber: 1, excerpt: "2-hour stair noted." },
      }),
      finding({
        id: "sprinkler-1",
        measureId: sprinkler.id,
        measure: sprinkler.description,
        status: "verified",
        source: { fileName: "FA-101.pdf", pageNumber: 2, excerpt: "Sprinkler throughout." },
      }),
      finding({
        id: "alarm-1",
        measureId: alarm.id,
        measure: alarm.description,
        status: "verified",
        source: { fileName: "FA-101.pdf", pageNumber: 3, excerpt: "Fire alarm noted." },
      }),
      finding({
        id: "occupant-base",
        measureId: occupant.id,
        measure: occupant.description,
        status: "verified",
        source: { fileName: "Base_Set.pdf", pageNumber: 3, excerpt: "Occupant load 48 per floor." },
      }),
      finding({
        id: "occupant-conflict",
        measureId: occupant.id,
        measure: occupant.description,
        status: "verified",
        source: {
          fileName: "Evidence_Conflict.pdf",
          pageNumber: 1,
          excerpt: "Occupant load schedule shows 60 occupants.",
        },
      }),
      finding({
        id: "standpipe-base",
        measureId: standpipe.id,
        measure: "Include standpipe",
        status: "verified",
        source: {
          fileName: "Base_Set.pdf",
          pageNumber: 4,
          excerpt: "Standpipe not included on base; see Supplement_01 addendum.",
        },
      }),
      finding({
        id: "standpipe-addendum",
        measureId: standpipe.id,
        measure: "Include a standpipe",
        status: "verified",
        source: {
          fileName: "Supplement_01.pdf",
          pageNumber: 1,
          excerpt: "Standpipe included per addendum.",
        },
      }),
      finding({
        id: "path-1",
        measureId: commonPath.id,
        measure: commonPath.description,
        status: "verified",
        source: { fileName: "G-001.pdf", pageNumber: 1, excerpt: "Common path of travel 72'-4\"." },
      }),
      finding({
        id: "path-2",
        measureId: commonPath.id,
        measure: commonPath.description,
        status: "verified",
        source: { fileName: "A-102.pdf", pageNumber: 2, excerpt: "Common path of travel 71'-0\"." },
      }),
      finding({
        id: "signage-base",
        measureId: signage.id,
        measure: signage.description,
        status: "verified",
        source: {
          fileName: "Base_Set.pdf",
          pageNumber: 5,
          excerpt: "Rooftop amenity max occupant load signage: 48.",
        },
      }),
      finding({
        id: "signage-conflict",
        measureId: signage.id,
        measure: signage.description,
        status: "verified",
        source: {
          fileName: "Evidence_Conflict_Signage.pdf",
          pageNumber: 1,
          excerpt: "Rooftop amenity max occupant load signage: 60.",
        },
      }),
      ...measures.flatMap((measure) => [
        notFoundOnSheet(measure.id, measure.description, "A-101.pdf", 1),
        notFoundOnSheet(measure.id, measure.description, "A-102.pdf", 1),
      ]),
    ]);

    assert.equal(merged.length, 8);
    assert.equal(validateOneRowPerMeasure(merged), true);

    const byId = new Map(merged.map((row) => [row.measureId, row]));
    assert.equal(byId.get(stair.id)?.status, "verified");
    assert.equal(byId.get(sprinkler.id)?.status, "verified");
    assert.equal(byId.get(alarm.id)?.status, "verified");
    assert.equal(byId.get(occupant.id)?.status, "conflicting");
    assert.equal(byId.get(pdrm.id)?.status, "not_found");
    assert.equal(byId.get(pdrm.id)?.source, null);
    assert.equal(byId.get(standpipe.id)?.status, "verified");
    assert.equal(byId.get(commonPath.id)?.status, "verified");
    assert.equal(byId.get(signage.id)?.status, "conflicting");
  });
});

describe("splitMeasureDescription embedded include clauses", () => {
  it("splits standpipe from an incorporate / review-meeting clause", () => {
    const split = splitMeasureDescription(
      "Incorporate DOB recommendations from June 9, 2026 PDRM include a standpipe",
    );
    assert.equal(split.length, 2);
    assert.match(split[0] ?? "", /Incorporate DOB recommendations/i);
    assert.match(split[1] ?? "", /standpipe/i);
  });
});
