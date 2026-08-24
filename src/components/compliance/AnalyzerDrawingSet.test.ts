import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CURRENT_DRAWINGS_GRID_CLASS } from "./AnalyzerDrawingSet.tsx";

describe("AnalyzerDrawingSet layout", () => {
  it("uses a responsive grid for current drawings (1 / 2 / 3 columns)", () => {
    assert.match(CURRENT_DRAWINGS_GRID_CLASS, /\bgrid\b/);
    assert.match(CURRENT_DRAWINGS_GRID_CLASS, /grid-cols-1/);
    assert.match(CURRENT_DRAWINGS_GRID_CLASS, /md:grid-cols-2/);
    assert.match(CURRENT_DRAWINGS_GRID_CLASS, /xl:grid-cols-3/);
    assert.match(CURRENT_DRAWINGS_GRID_CLASS, /gap-4/);
  });
});
