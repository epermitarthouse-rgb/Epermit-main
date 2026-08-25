import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalMeasureKey,
  measuresAreCanonicallyEquivalent,
  normalizeMeasureText,
} from "./canonicalMeasure.ts";

describe("canonicalMeasure", () => {
  it("A. collapses article-only measure wording differences", () => {
    assert.equal(
      measuresAreCanonicallyEquivalent("Include standpipe", "Include a standpipe"),
      true,
    );
    assert.equal(
      canonicalMeasureKey({ id: "1", measure: "Include standpipe", measureId: "m1" }),
      canonicalMeasureKey({ id: "2", measure: "Include a standpipe", measureId: "m2" }),
    );
  });

  it("B. keeps distinct compensating measures separate", () => {
    assert.equal(
      measuresAreCanonicallyEquivalent(
        "Provide a fully automatic sprinkler system throughout the building",
        "Provide a fully monitored fire alarm and emergency notification system",
      ),
      false,
    );
    assert.notEqual(
      canonicalMeasureKey({
        id: "1",
        measure: "Provide sprinkler system throughout the building",
        measureId: "m1",
      }),
      canonicalMeasureKey({
        id: "2",
        measure: "Provide fire alarm system throughout the building",
        measureId: "m2",
      }),
    );
  });

  it("normalizes punctuation, spacing, and case", () => {
    assert.equal(
      normalizeMeasureText("  Maintain   an occupant load below 49 people per floor. "),
      normalizeMeasureText("maintain occupant load below 49 people per floor"),
    );
  });
});
