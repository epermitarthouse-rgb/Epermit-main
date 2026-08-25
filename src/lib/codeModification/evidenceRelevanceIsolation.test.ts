import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyObservationRelevance,
  mergeFindingsFromSheets,
  synthesizeMeasureEvidence,
  validateSynthesisInvariants,
} from "./mergeEvidence.ts";
import { observationRelatesToMeasure } from "./measureComponentCompleteness.ts";
import type { EvidenceFinding } from "./model.ts";

const NOT_FOUND_NOTE = "No relevant evidence was found in the reviewed drawing set.";

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

describe("evidence relevance isolation A–F", () => {
  const recommendationsMeasure =
    "Incorporate agency recommendations from June 9, 2026 review meeting";
  const featureMeasure = "Include a building feature per submitted drawings";
  const unrelatedExcerpt = "Class I building feature noted on riser diagram.";
  const relatedUnresolvedExcerpt =
    "Agency recommendations from the review meeting require licensed professional confirmation.";

  it("A. recommendations-style measure + unrelated feature evidence → irrelevant", () => {
    const observation = {
      status: "verified" as const,
      source: {
        fileName: "Sheet-A.pdf",
        pageNumber: 1,
        excerpt: unrelatedExcerpt,
      },
      note: "Feature shown on sheet.",
    };

    assert.equal(observationRelatesToMeasure(unrelatedExcerpt, recommendationsMeasure), false);
    assert.equal(classifyObservationRelevance(observation, recommendationsMeasure), false);
  });

  it("B. measure A no evidence, measure B strong support → A NOT_FOUND without B leakage", () => {
    const merged = mergeFindingsFromSheets(
      [
        finding({
          id: "a-seed",
          measureId: "measure-a",
          measure: recommendationsMeasure,
          status: "not_found",
          note: "No drawing evidence was reviewed for this measure.",
        }),
      ],
      [
        finding({
          id: "b-support",
          measureId: "measure-b",
          measure: featureMeasure,
          status: "verified",
          source: {
            fileName: "Sheet-B.pdf",
            pageNumber: 2,
            excerpt: "Building feature included per addendum.",
          },
        }),
        finding({
          id: "a-wrong",
          measureId: "measure-a",
          measure: recommendationsMeasure,
          status: "verified",
          source: {
            fileName: "Sheet-B.pdf",
            pageNumber: 2,
            excerpt: "Building feature included per addendum.",
          },
        }),
      ],
    );

    const measureA = merged.find((row) => row.measureId === "measure-a");
    const measureB = merged.find((row) => row.measureId === "measure-b");
    assert.ok(measureA);
    assert.ok(measureB);
    assert.equal(measureA.status, "not_found");
    assert.equal(measureA.source, null);
    assert.equal(measureA.note, NOT_FOUND_NOTE);
    assert.equal(measureB.status, "verified");
    assert.doesNotMatch(measureA.note ?? "", /building feature/i);
  });

  it("C. unrelated partial cannot trigger professional review for another measure", () => {
    const synthesized = synthesizeMeasureEvidence({
      id: "measure-a",
      measureId: "measure-a",
      measure: recommendationsMeasure,
      status: "requires_professional_dob_review",
      observations: [
        {
          status: "requires_professional_dob_review",
          source: {
            fileName: "Sheet-A.pdf",
            pageNumber: 1,
            excerpt: unrelatedExcerpt,
          },
          note: "Feature detail requires review.",
        },
      ],
    });

    assert.equal(synthesized.status, "not_found");
    assert.equal(synthesized.source, null);
    assert.equal(validateSynthesisInvariants(synthesized).length, 0);
  });

  it("D. professional review requires relevant unresolved observation", () => {
    const synthesized = synthesizeMeasureEvidence({
      id: "measure-a",
      measureId: "measure-a",
      measure: recommendationsMeasure,
      status: "requires_professional_dob_review",
      observations: [
        {
          status: "requires_professional_dob_review",
          source: {
            fileName: "Sheet-G.pdf",
            pageNumber: 1,
            excerpt: relatedUnresolvedExcerpt,
          },
          note: "Recommendations reference requires licensed review.",
        },
      ],
    });

    assert.equal(synthesized.status, "requires_professional_dob_review");
    assert.ok(synthesized.source);
    assert.equal(validateSynthesisInvariants(synthesized).length, 0);
  });

  it("E. review notes cannot contain another measure's evidence text", () => {
    const merged = mergeFindingsFromSheets(
      [
        finding({
          id: "a-seed",
          measureId: "measure-a",
          measure: recommendationsMeasure,
          status: "not_found",
          note: "No drawing evidence was reviewed for this measure.",
        }),
        finding({
          id: "b-seed",
          measureId: "measure-b",
          measure: featureMeasure,
          status: "not_found",
          note: "No drawing evidence was reviewed for this measure.",
        }),
      ],
      [
        finding({
          id: "b-support",
          measureId: "measure-b",
          measure: featureMeasure,
          status: "verified",
          source: {
            fileName: "Sheet-B.pdf",
            pageNumber: 1,
            excerpt: "Building feature included per addendum.",
          },
        }),
        finding({
          id: "a-leak",
          measureId: "measure-a",
          measure: recommendationsMeasure,
          status: "verified",
          source: {
            fileName: "Sheet-B.pdf",
            pageNumber: 1,
            excerpt: "Building feature included per addendum.",
          },
        }),
      ],
    );

    const measureA = merged.find((row) => row.measureId === "measure-a");
    assert.ok(measureA);
    assert.equal(measureA.status, "not_found");
    assert.doesNotMatch(measureA.note ?? "", /building feature/i);
    assert.doesNotMatch(measureA.note ?? "", /Sheet-B/i);
  });

  it("F. multiple measures concurrent → measure-local observations only", () => {
    const merged = mergeFindingsFromSheets(
      [
        finding({
          id: "a",
          measureId: "measure-a",
          measure: recommendationsMeasure,
          status: "not_found",
        }),
        finding({
          id: "b",
          measureId: "measure-b",
          measure: featureMeasure,
          status: "verified",
          source: {
            fileName: "Sheet-B.pdf",
            pageNumber: 1,
            excerpt: "Building feature included.",
          },
        }),
      ],
      [
        finding({
          id: "a-cross",
          measureId: "measure-a",
          measure: recommendationsMeasure,
          status: "partially_supported",
          source: {
            fileName: "Sheet-B.pdf",
            pageNumber: 1,
            excerpt: "Building feature included.",
          },
        }),
      ],
    );

    assert.equal(merged.length, 2);
    const measureA = merged.find((row) => row.measureId === "measure-a");
    const measureB = merged.find((row) => row.measureId === "measure-b");
    assert.equal(measureA?.status, "not_found");
    assert.equal(measureB?.status, "verified");
    assert.equal(measureA?.source, null);
    assert.equal(measureB?.source?.fileName, "Sheet-B.pdf");
  });
});
