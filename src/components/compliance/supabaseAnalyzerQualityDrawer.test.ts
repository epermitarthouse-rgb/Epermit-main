import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fixtureDataset } from "@/lib/supabaseAnalyzer/fixtures/architectReviewFixtures";
import { FindingsMatrix } from "./supabaseAnalyzerPresentation";
import { SupabaseAnalyzerQualityDrawer } from "./supabaseAnalyzerQualityDrawer";

describe("Quality Evaluation drawer", () => {
  it("is collapsed by default and keeps metrics out of the findings summary", () => {
    const { dataset } = fixtureDataset();
    const drawer = renderToStaticMarkup(createElement(SupabaseAnalyzerQualityDrawer, { dataset }));
    const matrix = renderToStaticMarkup(createElement(FindingsMatrix, {
      counts: { all: 252, critical: 4, warning: 83, advisory: 165 },
      active: "all",
      processing: false,
      onSelect: () => {},
    }));
    assert.match(drawer, /analyzer-quality-evaluation/);
    assert.match(drawer, /Quality evaluation/);
    assert.equal(drawer.includes("aria-expanded=\"false\""), true);
    assert.equal(drawer.includes("analyzer-quality-evaluation-body"), false);
    assert.equal(drawer.includes("Precision"), false);
    assert.equal(matrix.includes("Precision"), false);
    assert.equal(matrix.includes("Not measured"), false);
    assert.equal(matrix.includes("Quality evaluation"), false);
  });
});
