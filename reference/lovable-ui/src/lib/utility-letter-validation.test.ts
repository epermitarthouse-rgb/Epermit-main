import { describe, expect, it } from "vitest";
import {
  validateLetterInputs,
  type LetterPreset,
} from "./utility-letter-validation";

const validPreset: LetterPreset = {
  id: "standard",
  label: "Standard prototype",
  kicker: "Baseline McD prototype",
  peaks: [
    { label: "Peak demand", value: "180 kW" },
    { label: "Service entrance", value: "1,600 A · 480 V" },
  ],
  breakdown: [
    { name: "Kitchen line", kw: 60 },
    { name: "HVAC", kw: 40 },
    { name: "Lighting", kw: 20 },
  ],
  declaredTotalKw: 120,
};

const baseInput = {
  preset: validPreset,
  jurisdiction: "Miami-Dade, FL",
  utility: "FPL",
};

describe("validateLetterInputs", () => {
  it("passes when every required field is populated and sums match", () => {
    const r = validateLetterInputs(baseInput);
    expect(r.hasMissing).toBe(false);
    expect(r.missingList).toEqual([]);
    expect(r.breakdownSumKw).toBe(120);
    expect(r.totalKw).toBe(120);
    expect(r.totalDelta).toBe(0);
    expect(r.invalidBreakdownNames).toEqual([]);
  });

  it("flags blank prototype label", () => {
    const r = validateLetterInputs({
      ...baseInput,
      preset: { ...validPreset, label: "   " },
    });
    expect(r.missingFields.label).toBe(true);
    expect(r.missingList).toContain("prototype label");
    expect(r.hasMissing).toBe(true);
  });

  it("flags blank prototype description (kicker)", () => {
    const r = validateLetterInputs({
      ...baseInput,
      preset: { ...validPreset, kicker: "" },
    });
    expect(r.missingFields.kicker).toBe(true);
    expect(r.missingList).toContain("prototype description");
  });

  it("flags blank jurisdiction", () => {
    const r = validateLetterInputs({ ...baseInput, jurisdiction: "" });
    expect(r.missingFields.jurisdiction).toBe(true);
    expect(r.missingList).toContain("jurisdiction");
  });

  it("flags blank utility (whitespace-only)", () => {
    const r = validateLetterInputs({ ...baseInput, utility: "   " });
    expect(r.missingFields.utility).toBe(true);
    expect(r.missingList).toContain("utility");
  });

  it("flags missing Peak demand entry", () => {
    const r = validateLetterInputs({
      ...baseInput,
      preset: {
        ...validPreset,
        peaks: [{ label: "Service entrance", value: "1,600 A · 480 V" }],
      },
    });
    expect(r.missingFields.peakDemand).toBe(true);
    expect(r.missingList).toContain("peak demand");
  });

  it("flags blank Peak demand value", () => {
    const r = validateLetterInputs({
      ...baseInput,
      preset: {
        ...validPreset,
        peaks: [
          { label: "Peak demand", value: "  " },
          { label: "Service entrance", value: "1,600 A · 480 V" },
        ],
      },
    });
    expect(r.missingFields.peakDemand).toBe(true);
  });

  it("flags missing Service entrance entry", () => {
    const r = validateLetterInputs({
      ...baseInput,
      preset: {
        ...validPreset,
        peaks: [{ label: "Peak demand", value: "180 kW" }],
      },
    });
    expect(r.missingFields.serviceEntrance).toBe(true);
    expect(r.missingList).toContain("service entrance");
  });

  it("flags empty breakdown", () => {
    const r = validateLetterInputs({
      ...baseInput,
      preset: { ...validPreset, breakdown: [], declaredTotalKw: undefined },
    });
    expect(r.missingFields.breakdownEmpty).toBe(true);
    expect(r.missingList).toContain("load breakdown");
    // totalKw defaults to 0 -> also triggers totalKw missing
    expect(r.missingFields.totalKw).toBe(true);
  });

  it("flags breakdown items with blank names", () => {
    const r = validateLetterInputs({
      ...baseInput,
      preset: {
        ...validPreset,
        breakdown: [
          { name: "", kw: 60 },
          { name: "HVAC", kw: 40 },
          { name: "Lighting", kw: 20 },
        ],
      },
    });
    expect(r.missingFields.breakdownInvalid).toBe(true);
    expect(r.invalidBreakdownNames).toContain("(unnamed)");
    expect(r.missingList.some((m) => m.includes("valid breakdown line items"))).toBe(true);
  });

  it("flags breakdown items with zero or negative kW", () => {
    const r = validateLetterInputs({
      ...baseInput,
      preset: {
        ...validPreset,
        breakdown: [
          { name: "Kitchen line", kw: 60 },
          { name: "HVAC", kw: 0 },
          { name: "Lighting", kw: -5 },
        ],
        declaredTotalKw: 60,
      },
    });
    expect(r.missingFields.breakdownInvalid).toBe(true);
    expect(r.invalidBreakdownNames).toEqual(["HVAC", "Lighting"]);
  });

  it("flags breakdown items with NaN kW", () => {
    const r = validateLetterInputs({
      ...baseInput,
      preset: {
        ...validPreset,
        breakdown: [
          { name: "Kitchen line", kw: 60 },
          { name: "HVAC", kw: Number.NaN },
          { name: "Lighting", kw: 20 },
        ],
        declaredTotalKw: 80,
      },
    });
    expect(r.missingFields.breakdownInvalid).toBe(true);
    expect(r.invalidBreakdownNames).toContain("HVAC");
  });

  it("prefers 'load breakdown' over 'valid breakdown line items' when empty", () => {
    const r = validateLetterInputs({
      ...baseInput,
      preset: { ...validPreset, breakdown: [], declaredTotalKw: 10 },
    });
    expect(r.missingList).toContain("load breakdown");
    expect(r.missingList.some((m) => m.startsWith("valid breakdown"))).toBe(false);
  });

  it("flags total connected load when it resolves to zero", () => {
    const r = validateLetterInputs({
      ...baseInput,
      preset: { ...validPreset, declaredTotalKw: 0, breakdown: [] },
    });
    expect(r.missingFields.totalKw).toBe(true);
    expect(r.missingList).toContain("total connected load");
  });

  it("flags sum mismatch when breakdown sum drifts more than ±0.5 kW", () => {
    const r = validateLetterInputs({
      ...baseInput,
      preset: { ...validPreset, declaredTotalKw: 100 }, // sum is 120
    });
    expect(r.missingFields.totalMismatch).toBe(true);
    expect(r.totalDelta).toBe(20);
    expect(
      r.missingList.some((m) => m.includes("does not match declared total")),
    ).toBe(true);
  });

  it("tolerates sub-0.5 kW rounding drift", () => {
    const r = validateLetterInputs({
      ...baseInput,
      preset: {
        ...validPreset,
        breakdown: [
          { name: "A", kw: 60.2 },
          { name: "B", kw: 40 },
          { name: "C", kw: 20 },
        ],
        declaredTotalKw: 120, // Δ = +0.2 → within tolerance
      },
    });
    expect(r.missingFields.totalMismatch).toBe(false);
    expect(r.hasMissing).toBe(false);
  });

  it("uses breakdown sum as authoritative total when declaredTotalKw is omitted", () => {
    const { declaredTotalKw: _drop, ...rest } = validPreset;
    void _drop;
    const r = validateLetterInputs({ ...baseInput, preset: rest });
    expect(r.missingFields.totalMismatch).toBe(false);
    expect(r.totalKw).toBe(120);
    expect(r.hasMissing).toBe(false);
  });

  it("accumulates every missing field in a single pass", () => {
    const r = validateLetterInputs({
      preset: {
        label: "",
        kicker: "",
        peaks: [],
        breakdown: [],
        declaredTotalKw: 0,
      },
      jurisdiction: "",
      utility: "",
    });
    expect(r.hasMissing).toBe(true);
    expect(r.missingList).toEqual(
      expect.arrayContaining([
        "prototype label",
        "prototype description",
        "jurisdiction",
        "utility",
        "peak demand",
        "service entrance",
        "load breakdown",
        "total connected load",
      ]),
    );
  });
});