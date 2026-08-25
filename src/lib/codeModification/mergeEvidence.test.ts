import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  excerptsContradict,
  evidencePolarity,
  isAddendumEvidenceSource,
  mergeFindingsFromSheets,
  synthesizeMeasureEvidence,
  type MergeableEvidenceFinding,
} from "./mergeEvidence.ts";
import type { EvidenceFinding } from "./model.ts";

const STANDPIPE_MEASURE_ID = "measure-standpipe";
const STANDPIPE_MEASURE = "Include a standpipe";
const OCCUPANT_MEASURE_ID = "measure-occupant";
const OCCUPANT_MEASURE = "Maintain an occupant load below 49 people per floor";
const SPRINKLER_MEASURE_ID = "measure-sprinkler";
const SPRINKLER_MEASURE =
  "Provide a fully automatic sprinkler system throughout the building";
const COMMON_PATH_MEASURE_ID = "measure-common-path";
const COMMON_PATH_MEASURE =
  "Maintain a common path of travel distance of less than 75'-0\"";
const PDRM_MEASURE_ID = "measure-pdrm";
const PDRM_MEASURE = "Incorporate DOB recommendations from June 9, 2026 PDRM";
const STAIR_MEASURE_ID = "measure-stair";
const STAIR_MEASURE =
  "Provide a two-hour fire rated enclosed stairway serving all occupied levels";
const SIGNAGE_MEASURE_ID = "measure-signage";
const SIGNAGE_MEASURE =
  "Provide permanent signage identifying and limiting the maximum occupant load of the rooftop amenity area";

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

describe("mergeEvidence regression A–G", () => {
  it("A. sheet1 supports sprinkler, sheets 2-5 omit → VERIFIED", () => {
    let merged = mergeFindingsFromSheets(
      [
        finding({
          id: "g001",
          measureId: SPRINKLER_MEASURE_ID,
          measure: SPRINKLER_MEASURE,
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
          measureId: SPRINKLER_MEASURE_ID,
          measure: SPRINKLER_MEASURE,
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
        notFoundOnSheet(SPRINKLER_MEASURE_ID, SPRINKLER_MEASURE, `${sheet}.pdf`, 1),
      ]);
    }

    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.status, "verified");
    assert.match(merged[0]?.source?.fileName ?? "", /G-001|FP-101/);
    assert.doesNotMatch(merged[0]?.note ?? "", /No evidence for this measure/i);
  });

  it("B. sheet1 48 occupant, sheet2 60 → CONFLICTING", () => {
    const merged = mergeFindingsFromSheets(
      [
        finding({
          id: "base",
          measureId: OCCUPANT_MEASURE_ID,
          measure: OCCUPANT_MEASURE,
          status: "verified",
          source: {
            fileName: "1513_P_St_MOCK_Permit_Drawings_Base.pdf",
            pageNumber: 3,
            excerpt: "Occupant load 48 per floor.",
          },
        }),
      ],
      [
        finding({
          id: "a103",
          measureId: OCCUPANT_MEASURE_ID,
          measure: OCCUPANT_MEASURE,
          status: "conflicting",
          source: {
            fileName: "A-103.pdf",
            pageNumber: 2,
            excerpt: "Occupant load schedule shows 60 occupants.",
          },
          note: "A-103 occupant load exceeds measure limit.",
        }),
      ],
    );

    assert.equal(merged[0]?.status, "conflicting");
    assert.match(merged[0]?.note ?? "", /48/i);
    assert.match(merged[0]?.note ?? "", /60/i);
  });

  it("C. two supporting common-path distances → VERIFIED", () => {
    const merged = mergeFindingsFromSheets(
      [
        finding({
          id: "g001",
          measureId: COMMON_PATH_MEASURE_ID,
          measure: COMMON_PATH_MEASURE,
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
          measureId: COMMON_PATH_MEASURE_ID,
          measure: COMMON_PATH_MEASURE,
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
    assert.match(merged[0]?.note ?? "", /72'-4"/i);
    assert.match(merged[0]?.note ?? "", /71'-0"/i);
  });

  it("D. no PDRM evidence → NOT FOUND", () => {
    const merged = mergeFindingsFromSheets(
      [
        finding({
          id: "seed",
          measureId: PDRM_MEASURE_ID,
          measure: PDRM_MEASURE,
          status: "not_found",
          note: "No drawing evidence was reviewed for this measure.",
        }),
      ],
      [
        notFoundOnSheet(PDRM_MEASURE_ID, PDRM_MEASURE, "G-001.pdf", 1),
        notFoundOnSheet(PDRM_MEASURE_ID, PDRM_MEASURE, "A-101.pdf", 1),
      ],
    );

    assert.equal(merged[0]?.status, "not_found");
  });

  it("E. base deferral + addendum provision → VERIFIED with both preserved", () => {
    const merged = mergeFindingsFromSheets(
      [
        finding({
          id: "base",
          measureId: STANDPIPE_MEASURE_ID,
          measure: STANDPIPE_MEASURE,
          status: "verified",
          source: {
            fileName: "FP-101.pdf",
            sheetLabel: "FP-101",
            pageNumber: 4,
            excerpt: "Standpipe not included on base; see FP-102 addendum.",
          },
        }),
      ],
      [
        finding({
          id: "addendum",
          measureId: STANDPIPE_MEASURE_ID,
          measure: STANDPIPE_MEASURE,
          status: "verified",
          source: {
            fileName: "Addendum_Standpipe.pdf",
            sheetLabel: "Addendum Standpipe",
            pageNumber: 1,
            excerpt: "Class I standpipe included per addendum.",
          },
        }),
      ],
    );

    assert.equal(merged[0]?.status, "verified");
    assert.match(merged[0]?.note ?? "", /FP-101 p\.4/i);
    assert.match(merged[0]?.note ?? "", /Addendum Standpipe p\.1|Addendum_Standpipe\.pdf p\.1/i);
    assert.match(merged[0]?.source?.fileName ?? "", /Addendum_Standpipe/i);
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
      measureId: STANDPIPE_MEASURE_ID,
      measure: STANDPIPE_MEASURE,
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
      measureId: STAIR_MEASURE_ID,
      measure: STAIR_MEASURE,
      status: "verified",
      observations: [
        {
          status: "verified",
          source: {
            fileName: "G-001.pdf",
            pageNumber: 1,
            excerpt: "2-hour fire rated stair enclosure noted.",
          },
          note: "G-001 shows upgraded stair.",
        },
        {
          status: "verified",
          source: {
            fileName: "A-101.pdf",
            pageNumber: 2,
            excerpt: "Stair enclosure upgraded to 2-hour.",
          },
        },
        {
          status: "not_found",
          source: {
            fileName: "Addendum_Standpipe.pdf",
            pageNumber: 1,
          },
          note: "No stair evidence on standpipe addendum sheet.",
        },
      ],
    });

    assert.equal(synthesized.status, "verified");
    assert.match(synthesized.source?.fileName ?? "", /G-001|A-101/);
    assert.doesNotMatch(synthesized.source?.fileName ?? "", /Addendum_Standpipe/i);
    assert.doesNotMatch(synthesized.note ?? "", /No stair evidence/i);
  });
});

describe("mergeEvidence occupant conflict regression", () => {
  it("conflict PDF wins over base verified finding", () => {
    const merged = mergeFindingsFromSheets(
      [
        finding({
          id: "base",
          measureId: OCCUPANT_MEASURE_ID,
          measure: OCCUPANT_MEASURE,
          status: "verified",
          source: {
            fileName: "1513_P_St_MOCK_Permit_Drawings_Base.pdf",
            pageNumber: 3,
            excerpt: "Occupant load 48 per floor.",
          },
        }),
      ],
      [
        finding({
          id: "conflict",
          measureId: OCCUPANT_MEASURE_ID,
          measure: OCCUPANT_MEASURE,
          status: "conflicting",
          source: {
            fileName: "1513_p_st_mock_conflict_occupant_load.pdf",
            pageNumber: 1,
            excerpt: "Occupant load schedule shows 52 occupants on level 2.",
          },
          note: "Conflict PDF disagrees with base occupant load.",
        }),
      ],
    );

    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.status, "conflicting");
    assert.match(merged[0]?.source?.fileName ?? "", /conflict_occupant_load/i);
    assert.match(merged[0]?.note ?? "", /1513_P_St_MOCK_Permit_Drawings_Base\.pdf p\.3/i);
  });
});

describe("mergeEvidence sprinkler multi-sheet", () => {
  it("FA-101 and FP-101 combine without discard", () => {
    const merged = mergeFindingsFromSheets(
      [
        finding({
          id: "fa",
          measureId: SPRINKLER_MEASURE_ID,
          measure: SPRINKLER_MEASURE,
          status: "verified",
          source: {
            fileName: "FA-101.pdf",
            pageNumber: 2,
            excerpt: "NFPA 13 sprinkler system noted.",
          },
        }),
      ],
      [
        finding({
          id: "fp",
          measureId: SPRINKLER_MEASURE_ID,
          measure: SPRINKLER_MEASURE,
          status: "verified",
          source: {
            fileName: "FP-101.pdf",
            pageNumber: 3,
            excerpt: "Sprinkler riser and standpipe connection shown.",
          },
        }),
      ],
    );

    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.status, "verified");
    assert.match(merged[0]?.note ?? "", /FA-101\.pdf p\.2/i);
    assert.match(merged[0]?.note ?? "", /FP-101\.pdf p\.3/i);
  });
});

describe("mergeEvidence helpers", () => {
  it("detects addendum filenames", () => {
    assert.equal(isAddendumEvidenceSource({ fileName: "Addendum_Standpipe.pdf" }), true);
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

  it("accumulates observations across sequential sheet merges", () => {
    let accumulated: MergeableEvidenceFinding[] = [
      finding({
        id: "seed",
        measureId: STANDPIPE_MEASURE_ID,
        measure: STANDPIPE_MEASURE,
        status: "not_found",
        note: "No drawing evidence was reviewed for this measure.",
      }),
    ];

    accumulated = mergeFindingsFromSheets(accumulated, [
      finding({
        id: "sheet-1",
        measureId: STANDPIPE_MEASURE_ID,
        measure: STANDPIPE_MEASURE,
        status: "verified",
        source: {
          fileName: "FP-101.pdf",
          pageNumber: 4,
          excerpt: "Standpipe not included on base; see addendum.",
        },
      }),
    ]);
    accumulated = mergeFindingsFromSheets(accumulated, [
      finding({
        id: "sheet-2",
        measureId: STANDPIPE_MEASURE_ID,
        measure: STANDPIPE_MEASURE,
        status: "verified",
        source: {
          fileName: "Addendum_Standpipe.pdf",
          pageNumber: 1,
          excerpt: "Standpipe included per addendum.",
        },
      }),
    ]);

    assert.equal(accumulated[0]?.status, "verified");
  });
});

describe("mergeEvidence rooftop signage conflict", () => {
  it("base max 48 vs conflict max 60 → CONFLICTING", () => {
    const merged = mergeFindingsFromSheets(
      [
        finding({
          id: "base",
          measureId: SIGNAGE_MEASURE_ID,
          measure: SIGNAGE_MEASURE,
          status: "verified",
          source: {
            fileName: "1513_P_St_MOCK_Permit_Drawings_Base.pdf",
            pageNumber: 5,
            excerpt: "Rooftop amenity max occupant load signage: 48.",
          },
        }),
      ],
      [
        finding({
          id: "conflict",
          measureId: SIGNAGE_MEASURE_ID,
          measure: SIGNAGE_MEASURE,
          status: "conflicting",
          source: {
            fileName: "1513_p_st_mock_conflict_signage.pdf",
            pageNumber: 1,
            excerpt: "Rooftop amenity max occupant load signage: 60.",
          },
        }),
      ],
    );

    assert.equal(merged[0]?.status, "conflicting");
  });
});
