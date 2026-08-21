import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatCosComparisonCellValue } from "./uciCosComparisonPresentation.js";

describe("formatCosComparisonCellValue", () => {
  it("renders nullish and empty as em dash", () => {
    assert.equal(formatCosComparisonCellValue(null), "—");
    assert.equal(formatCosComparisonCellValue(undefined), "—");
    assert.equal(formatCosComparisonCellValue(""), "—");
  });

  it("renders plain scalars", () => {
    assert.equal(formatCosComparisonCellValue(800), "800");
    assert.equal(formatCosComparisonCellValue("208Y/120V"), "208Y/120V");
  });

  it("renders value + unit objects (demand / design basis)", () => {
    assert.equal(formatCosComparisonCellValue({ value: 180, unit: "kW" }), "180 kW");
    assert.equal(formatCosComparisonCellValue({ value: 800, unit: "A" }), "800 A");
  });

  it("renders value-only objects without inventing a unit", () => {
    assert.equal(formatCosComparisonCellValue({ value: 180 }), "180");
  });

  it("unwraps nested value objects from calculated load-profile baselines", () => {
    assert.equal(
      formatCosComparisonCellValue({ value: { value: 180, unit: "kW" } }),
      "180 kW",
    );
  });

  it("never stringifies to [object Object]", () => {
    const samples = [
      { value: 180, unit: "kW" },
      { value: { value: 144.5, unit: "kW" }, unit: null },
      800,
    ];
    for (const sample of samples) {
      const rendered = formatCosComparisonCellValue(sample);
      assert.notEqual(rendered, "[object Object]");
    }
  });
});
