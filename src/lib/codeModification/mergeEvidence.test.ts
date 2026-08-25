import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  excerptsContradict,
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

describe("mergeEvidence standpipe multi-sheet synthesis", () => {
  it("A. base absent + addendum present → both sources appear in synthesis", () => {
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
            excerpt: "Standpipe not included on base fire protection plan.",
          },
          note: "Base drawing notes standpipe is not included.",
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
            excerpt: "Standpipe is included per addendum.",
          },
          note: "Addendum sheet shows standpipe included.",
        }),
      ],
    );

    assert.equal(merged.length, 1);
    const standpipe = merged[0]!;
    assert.equal(standpipe.status, "conflicting");
    assert.match(standpipe.note ?? "", /FP-101 p\.4/i);
    assert.match(standpipe.note ?? "", /Addendum Standpipe p\.1|Addendum_Standpipe\.pdf p\.1/i);
    assert.match(standpipe.note ?? "", /not included/i);
    assert.match(standpipe.note ?? "", /included/i);
  });

  it("B. no precedence → conflicting cites both sources", () => {
    const merged = mergeFindingsFromSheets(
      [],
      [
        finding({
          id: "base",
          measureId: STANDPIPE_MEASURE_ID,
          measure: STANDPIPE_MEASURE,
          status: "verified",
          source: {
            fileName: "1513_P_St_MOCK_Permit_Drawings_Base.pdf",
            pageNumber: 4,
            excerpt: "Standpipe not included.",
          },
        }),
        finding({
          id: "addendum",
          measureId: STANDPIPE_MEASURE_ID,
          measure: STANDPIPE_MEASURE,
          status: "verified",
          source: {
            fileName: "Addendum_Standpipe.pdf",
            pageNumber: 1,
            excerpt: "Standpipe included per PDRM addendum.",
          },
        }),
      ],
    );

    assert.equal(merged[0]?.status, "conflicting");
    assert.match(merged[0]?.note ?? "", /1513_P_St_MOCK_Permit_Drawings_Base\.pdf p\.4/i);
    assert.match(merged[0]?.note ?? "", /Addendum_Standpipe\.pdf p\.1/i);
  });

  it("C. addendum precedence applies for aligned supporting evidence", () => {
    const synthesized = synthesizeMeasureEvidence({
      id: "sprinkler",
      measureId: SPRINKLER_MEASURE_ID,
      measure: SPRINKLER_MEASURE,
      status: "verified",
      observations: [
        {
          status: "verified",
          source: {
            fileName: "FA-101.pdf",
            pageNumber: 2,
            excerpt: "Sprinkler riser shown.",
          },
          note: "FA-101 shows sprinkler layout.",
        },
        {
          status: "verified",
          source: {
            fileName: "Addendum_Standpipe.pdf",
            pageNumber: 1,
            excerpt: "Sprinkler and standpipe coordination shown.",
          },
          note: "Addendum confirms sprinkler coverage.",
        },
      ],
    });

    assert.equal(synthesized.status, "verified");
    assert.match(synthesized.source?.fileName ?? "", /Addendum_Standpipe/i);
    assert.match(synthesized.note ?? "", /FA-101\.pdf p\.2/i);
  });
});

describe("mergeEvidence occupant conflict regression", () => {
  it("D. occupant conflict from dedicated conflict PDF is preserved", () => {
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
  it("E. sprinkler evidence from FA-101 and FP-101 is combined, not discarded", () => {
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

  it("detects contradictory standpipe excerpts", () => {
    assert.equal(
      excerptsContradict("Standpipe not included on FP-101.", "Standpipe is included per addendum."),
      true,
    );
    assert.equal(
      excerptsContradict("Sprinkler riser shown.", "Sprinkler coverage noted on FP-101."),
      false,
    );
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
        source: { fileName: "FP-101.pdf", pageNumber: 4, excerpt: "Standpipe not included." },
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

    assert.equal(accumulated[0]?.status, "conflicting");
  });
});
