import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeAnalyzerDatasetMetrics,
  computeRunAnalysisMetrics,
  countSourceDocuments,
  existingFailed,
  formatAnalysisProgressSummary,
  formatAnalyzerDatasetSummary,
  isDatasetChangedSinceRun,
  newSincePreviousRun,
  removedSincePreviousRun,
  sheetKeysFromRunFingerprint,
} from "./sheetState.ts";
import type { CodeAnalyzerSheet } from "./model.ts";

function sheet(
  partial: Partial<CodeAnalyzerSheet> & { id: string; source_document_id: string; page_number: number },
): CodeAnalyzerSheet {
  return {
    project_id: "p1",
    image_document_id: null,
    file_name: `${partial.id}.png`,
    excluded: false,
    created_at: "2026-08-01T00:00:00Z",
    ...partial,
  };
}

describe("sheetState semantics", () => {
  const prevFp = "src-a005:1|src-spec:18|src-a009:1";

  it("A: previous run has A005, current fails — A005 is failed, not new", () => {
    const included = [
      sheet({ id: "s-a005", source_document_id: "src-a005", page_number: 1 }),
      sheet({ id: "s-spec18", source_document_id: "src-spec", page_number: 18 }),
    ];
    const newSheets = newSincePreviousRun(included, prevFp);
    assert.equal(newSheets.length, 0);

    const failed = existingFailed(included, prevFp, new Set(["s-a005", "s-spec18"]));
    assert.equal(failed.length, 2);
    assert.deepEqual(failed.map((s) => s.id).sort(), ["s-a005", "s-spec18"]);
  });

  it("B: previous run lacks A009, user uploads — A009 is new", () => {
    const included = [
      sheet({ id: "s-a005", source_document_id: "src-a005", page_number: 1 }),
      sheet({ id: "s-a009", source_document_id: "src-a009", page_number: 1 }),
    ];
    const newSheets = newSincePreviousRun(included, "src-a005:1");
    assert.equal(newSheets.length, 1);
    assert.equal(newSheets[0]?.id, "s-a009");
  });

  it("detects removed sheets since previous run", () => {
    const included = [sheet({ id: "s1", source_document_id: "src-a005", page_number: 1 })];
    const removed = removedSincePreviousRun(included, prevFp);
    assert.deepEqual(removed.sort(), ["src-a009:1", "src-spec:18"]);
  });

  it("dataset changed when fingerprint differs", () => {
    const included = [sheet({ id: "s1", source_document_id: "src-new", page_number: 1 })];
    assert.equal(isDatasetChangedSinceRun(included, prevFp), true);
    assert.equal(isDatasetChangedSinceRun(included, "src-new:1"), false);
  });

  it("sheetKeysFromRunFingerprint strips instruction suffix", () => {
    const keys = sheetKeysFromRunFingerprint("a:1|b:2||instr:Focus egress");
    assert.deepEqual([...keys].sort(), ["a:1", "b:2"]);
  });
});

describe("computeAnalyzerDatasetMetrics", () => {
  it("C: 20-page PDF → 1 document, 20 sheets", () => {
    const included = Array.from({ length: 20 }, (_, i) =>
      sheet({
        id: `s${i + 1}`,
        source_document_id: "pdf-one",
        page_number: i + 1,
      }),
    );
    const metrics = computeAnalyzerDatasetMetrics({ includedSheets: included });
    assert.equal(metrics.sourceDocumentCount, 1);
    assert.equal(metrics.includedSheetCount, 20);
    assert.equal(formatAnalyzerDatasetSummary(metrics), "Documents: 1 source document · Sheets: 20 included sheets");
  });

  it("D: 16 docs → 34 sheets, 32 success + 2 failed → correct metrics", () => {
    const included: CodeAnalyzerSheet[] = [];
    for (let d = 0; d < 16; d += 1) {
      const pages = d < 2 ? 3 : 2;
      for (let p = 1; p <= pages; p += 1) {
        included.push(
          sheet({
            id: `s-${d}-${p}`,
            source_document_id: `doc-${d}`,
            page_number: p,
          }),
        );
      }
    }
    assert.equal(included.length, 34);
    const failedIds = new Set(["s-0-1", "s-1-1"]);
    const completedIds = new Set(included.map((s) => s.id).filter((id) => !failedIds.has(id)));
    const metrics = computeAnalyzerDatasetMetrics({
      includedSheets: included,
      completedSheetIds: completedIds,
      failedSheetIds: failedIds,
    });
    assert.equal(metrics.sourceDocumentCount, 16);
    assert.equal(metrics.includedSheetCount, 34);
    assert.equal(metrics.analyzedCompletedCount, 32);
    assert.equal(metrics.analyzedFailedCount, 2);
    assert.equal(
      formatAnalysisProgressSummary(metrics),
      "Analysis: 32 completed, 2 failed, 34 total",
    );
  });

  it("H: counts excluded index source document toward document total", () => {
    const sheets = [
      sheet({ id: "s-index", source_document_id: "doc-index", page_number: 1, excluded: true }),
      ...Array.from({ length: 15 }, (_, i) =>
        sheet({ id: `s-${i}`, source_document_id: `doc-${i}`, page_number: 1 }),
      ),
    ];
    const metrics = computeAnalyzerDatasetMetrics({ includedSheets: sheets });
    assert.equal(metrics.sourceDocumentCount, 16);
    assert.equal(metrics.includedSheetCount, 15);
  });
});

describe("computeRunAnalysisMetrics", () => {
  it("A: counter agreement — 21 completed, 13 failed, 34 total after partial run", () => {
    const sheets: CodeAnalyzerSheet[] = [];
    for (let d = 0; d < 15; d += 1) {
      const pages = d === 0 ? 20 : 1;
      for (let p = 1; p <= pages; p += 1) {
        sheets.push(
          sheet({
            id: `s-${d}-${p}`,
            source_document_id: `doc-${d}`,
            page_number: p,
            image_document_id: `img-${d}-${p}`,
          }),
        );
      }
    }
    sheets.push(
      sheet({
        id: "s-index",
        source_document_id: "doc-index",
        page_number: 1,
        image_document_id: "img-index",
        excluded: true,
      }),
    );
    assert.equal(sheets.filter((s) => !s.excluded).length, 34);
    const failedIds = new Set(sheets.slice(0, 13).map((s) => s.id));
    const hydratedIds = new Set(
      sheets
        .slice(13)
        .map((s) => s.image_document_id!)
        .filter(Boolean),
    );
    const metrics = computeRunAnalysisMetrics({
      sheets,
      failedSheetIds: failedIds,
      hydratedImageDocumentIds: hydratedIds,
    });
    assert.equal(metrics.sourceDocumentCount, 16);
    assert.equal(metrics.analyzedCompletedCount, 21);
    assert.equal(metrics.analyzedFailedCount, 13);
    assert.equal(metrics.analysisTotalCount, 34);
    assert.equal(
      formatAnalysisProgressSummary(metrics),
      "Analysis: 21 completed, 13 failed, 34 total",
    );
  });

  it("F: counts excluded-sheet source documents toward source document total", () => {
    const sheets = [
      sheet({ id: "s1", source_document_id: "doc-index", page_number: 1, excluded: true }),
      sheet({ id: "s2", source_document_id: "doc-a", page_number: 1 }),
    ];
    assert.equal(countSourceDocuments(sheets), 2);
    const metrics = computeRunAnalysisMetrics({ sheets, failedSheetIds: new Set() });
    assert.equal(metrics.sourceDocumentCount, 2);
    assert.equal(metrics.includedSheetCount, 1);
  });

  it("G: prefers hydrate match over empty session completed set", () => {
    const included = [
      sheet({ id: "s-a005", source_document_id: "src-a005", page_number: 1, image_document_id: "img-a005" }),
      sheet({ id: "s-a009", source_document_id: "src-a009", page_number: 1, image_document_id: "img-a009" }),
    ];
    const metrics = computeRunAnalysisMetrics({
      sheets: included,
      failedSheetIds: new Set(["s-a005"]),
      hydratedImageDocumentIds: new Set(["img-a005"]),
    });
    assert.equal(metrics.analyzedCompletedCount, 0);
    assert.equal(metrics.analyzedFailedCount, 1);
  });
});
