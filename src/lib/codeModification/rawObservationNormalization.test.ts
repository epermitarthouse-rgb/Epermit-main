import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  hasValidatedModelConflict,
  normalizeEvidenceStatus,
  normalizeRawObservation,
  validateModelStatusAgainstEvidence,
} from "./rawObservationNormalization.ts";
import {
  mergeFindingsFromSheets,
  synthesizeMeasureEvidence,
  validateSynthesisInvariants,
} from "./mergeEvidence.ts";
import type { EvidenceFinding } from "./model.ts";

function rawSheetFinding(partial: {
  measureId: string;
  measure: string;
  status: string;
  fileName: string;
  pageNumber: number;
  excerpt?: string | null;
  note?: string | null;
}): EvidenceFinding {
  return {
    id: `${partial.fileName}-${partial.pageNumber}`,
    measureId: partial.measureId,
    measure: partial.measure,
    status: partial.status as EvidenceFinding["status"],
    source: {
      fileName: partial.fileName,
      pageNumber: partial.pageNumber,
      excerpt: partial.excerpt ?? null,
    },
    note: partial.note ?? null,
  };
}

describe("rawObservationNormalization A–O", () => {
  it("A. normalizes model conflicting + supportive excerpt to verified", () => {
    const status = validateModelStatusAgainstEvidence({
      status: "conflicting",
      source: { excerpt: "Two-hour fire rated stair enclosure shown on plan." },
    });
    assert.equal(status, "verified");
  });

  it("B. normalizes model conflicting + absence-only excerpt to not_found", () => {
    const status = validateModelStatusAgainstEvidence({
      status: "conflicting",
      source: { excerpt: "Sprinkler system not shown on this sheet." },
    });
    assert.equal(status, "not_found");
  });

  it("C. normalizes model conflicting + deferral language to partially_supported", () => {
    const status = validateModelStatusAgainstEvidence({
      status: "conflicting",
      source: { excerpt: "Feature not included on base; see addendum." },
    });
    assert.equal(status, "partially_supported");
  });

  it("D. synthesis ignores unvalidated model conflicting when other sheets support", () => {
    const measure = "Provide a fully automatic sprinkler system throughout the building";
    const merged = mergeFindingsFromSheets(
      [
        rawSheetFinding({
          measureId: "measure-sprinkler",
          measure,
          status: "verified",
          fileName: "FA-101.pdf",
          pageNumber: 2,
          excerpt: "Automatic sprinkler throughout building.",
        }),
      ],
      [
        rawSheetFinding({
          measureId: "measure-sprinkler",
          measure,
          status: "conflicting",
          fileName: "A-101.pdf",
          pageNumber: 1,
          excerpt: "Sprinkler not shown on this floor plan.",
        }),
      ],
    );

    assert.equal(merged[0]?.status, "verified");
    assert.equal(validateSynthesisInvariants(merged[0]!).length, 0);
  });

  it("E. keeps model conflicting when explicit contradiction language is present", () => {
    const status = validateModelStatusAgainstEvidence({
      status: "conflicting",
      source: {
        excerpt: "Drawing values conflict with schedule; occupant load inconsistent.",
      },
    });
    assert.equal(status, "conflicting");
    assert.equal(
      hasValidatedModelConflict({
        status,
        source: { excerpt: "Drawing values conflict with schedule; occupant load inconsistent." },
      }),
      true,
    );
  });

  it("F. upgrades model not_found with positive excerpt to verified", () => {
    const status = validateModelStatusAgainstEvidence({
      status: "not_found",
      source: { excerpt: "Standpipe included per supplement." },
    });
    assert.equal(status, "verified");
  });

  it("G. downgrades model verified with absence-only excerpt to not_found", () => {
    const status = validateModelStatusAgainstEvidence({
      status: "verified",
      source: { excerpt: "Feature not shown on this sheet." },
    });
    assert.equal(status, "not_found");
  });

  it("H. downgrades model conflicting with incomplete-evidence language to not_found", () => {
    const status = validateModelStatusAgainstEvidence({
      status: "conflicting",
      source: { excerpt: "Cannot determine sprinkler coverage from this sheet." },
    });
    assert.equal(status, "not_found");
  });

  it("I. base deferral + addendum supply stays verified despite model conflicting on base", () => {
    const measure = "Include a standpipe";
    const merged = mergeFindingsFromSheets(
      [
        rawSheetFinding({
          measureId: "measure-standpipe",
          measure,
          status: "conflicting",
          fileName: "Base_Set.pdf",
          pageNumber: 4,
          excerpt: "Standpipe not included on base; see Supplement_01 addendum.",
        }),
      ],
      [
        rawSheetFinding({
          measureId: "measure-standpipe",
          measure,
          status: "verified",
          fileName: "Supplement_01.pdf",
          pageNumber: 1,
          excerpt: "Standpipe included per addendum.",
        }),
      ],
    );

    assert.equal(merged[0]?.status, "verified");
  });

  it("J. model wrongly labels conflicting on supportive two-hour stair text", () => {
    const measure = "Provide a two-hour fire rated enclosed stairway serving all occupied levels";
    const synthesized = synthesizeMeasureEvidence({
      id: "stair",
      measureId: "measure-stair",
      measure,
      status: "conflicting",
      observations: [
        {
          status: "conflicting",
          source: {
            fileName: "General_Notes.pdf",
            pageNumber: 1,
            excerpt: "2-hour fire rating at stair enclosure.",
          },
        },
        {
          status: "verified",
          source: {
            fileName: "Plan_A.pdf",
            pageNumber: 1,
            excerpt: "Enclosed stair shaft 2-hour rated.",
          },
        },
      ],
    });

    assert.equal(synthesized.status, "partially_supported");
    assert.notEqual(synthesized.status, "conflicting");
  });

  it("K. not_found sheets do not override verified support after normalization", () => {
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
            excerpt: "Sprinkler throughout.",
          },
        },
        {
          status: "not_found",
          source: { fileName: "A-101.pdf", pageNumber: 1 },
          note: "No evidence for this measure on this sheet.",
        },
        {
          status: "conflicting",
          source: {
            fileName: "A-102.pdf",
            pageNumber: 1,
            excerpt: "No evidence for this measure on this sheet.",
          },
        },
      ],
    });

    assert.equal(synthesized.status, "verified");
  });

  it("L. normalizeEvidenceStatus accepts common LLM aliases", () => {
    assert.equal(normalizeEvidenceStatus("supported"), "verified");
    assert.equal(normalizeEvidenceStatus("conflicting_information"), "conflicting");
    assert.equal(normalizeEvidenceStatus("missing"), "not_found");
    assert.equal(normalizeEvidenceStatus("manual_review"), "requires_professional_dob_review");
  });

  it("M. normalizeRawObservation preserves observation metadata", () => {
    const normalized = normalizeRawObservation(
      {
        status: "conflicting",
        relevant: true,
        source: { fileName: "Sheet.pdf", pageNumber: 1, excerpt: "System included on plan." },
        note: "Model flagged conflict.",
      },
      "Provide monitored alarm system",
    );
    assert.equal(normalized.status, "verified");
    assert.equal(normalized.relevant, true);
    assert.equal(normalized.note, "Model flagged conflict.");
  });

  it("N. generic per-sheet not_found normalizes to not_found regardless of model status", () => {
    const status = validateModelStatusAgainstEvidence({
      status: "conflicting",
      note: "No evidence for this measure on this sheet.",
    });
    assert.equal(status, "not_found");
  });

  it("O. genuine numeric conflict still surfaces after raw normalization", () => {
    const measure = "Maintain an occupant load below 49 people per floor";
    const merged = mergeFindingsFromSheets(
      [
        rawSheetFinding({
          measureId: "measure-occupant",
          measure,
          status: "verified",
          fileName: "Base_Set.pdf",
          pageNumber: 3,
          excerpt: "Occupant load 48 per floor.",
        }),
      ],
      [
        rawSheetFinding({
          measureId: "measure-occupant",
          measure,
          status: "conflicting",
          fileName: "Evidence_Conflict.pdf",
          pageNumber: 1,
          excerpt: "Occupant load schedule shows 60 occupants.",
        }),
      ],
    );

    assert.equal(merged[0]?.status, "conflicting");
    assert.equal(validateSynthesisInvariants(merged[0]!).length, 0);
  });
});
