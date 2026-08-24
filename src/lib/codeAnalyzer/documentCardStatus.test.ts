import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CodeAnalyzerSheet } from "./model.ts";
import {
  deriveDocumentCardStatus,
  deriveSheetChipStatus,
  deriveUploadQueueCardStatus,
  countDocumentSheetStates,
} from "./documentCardStatus.ts";

function sheet(
  partial: Partial<CodeAnalyzerSheet> & { id: string; source_document_id: string; page_number: number },
): CodeAnalyzerSheet {
  return {
    project_id: "p1",
    image_document_id: null,
    file_name: `${partial.id}.pdf`,
    excluded: false,
    created_at: "2026-08-01T00:00:00Z",
    ...partial,
  };
}

describe("documentCardStatus", () => {
  it("A: single-sheet document transitions pending → analyzing → completed → failed", () => {
    const sheets = [sheet({ id: "s1", source_document_id: "doc-a", page_number: 1 })];

    const pending = deriveDocumentCardStatus({
      includedSheets: sheets,
      completedSheetIds: new Set(),
      failedSheetIds: new Set(),
      analyzing: false,
    });
    assert.equal(pending.status, "ready");
    assert.equal(deriveSheetChipStatus(sheets[0], {
      completedSheetIds: new Set(),
      failedSheetIds: new Set(),
      analyzing: false,
    }), "pending");

    const analyzing = deriveDocumentCardStatus({
      includedSheets: sheets,
      completedSheetIds: new Set(),
      failedSheetIds: new Set(),
      analyzing: true,
      currentAnalyzingSheetId: "s1",
    });
    assert.equal(analyzing.status, "analyzing");
    assert.equal(analyzing.progressLabel, "0 of 1 sheet analyzed");
    assert.equal(deriveSheetChipStatus(sheets[0], {
      completedSheetIds: new Set(),
      failedSheetIds: new Set(),
      analyzing: true,
      currentAnalyzingSheetId: "s1",
    }), "analyzing");

    const completed = deriveDocumentCardStatus({
      includedSheets: sheets,
      completedSheetIds: new Set(["s1"]),
      failedSheetIds: new Set(),
      analyzing: false,
    });
    assert.equal(completed.status, "completed");
    assert.equal(completed.progressLabel, "1 of 1 completed");

    const failed = deriveDocumentCardStatus({
      includedSheets: sheets,
      completedSheetIds: new Set(),
      failedSheetIds: new Set(["s1"]),
      analyzing: false,
    });
    assert.equal(failed.status, "failed");
    assert.equal(failed.progressLabel, "1 of 1 failed");
  });

  it("B: 20-sheet PDF partial — 15 completed, 2 failed, 3 pending during analysis", () => {
    const sheets = Array.from({ length: 20 }, (_, i) =>
      sheet({ id: `s${i + 1}`, source_document_id: "pdf-one", page_number: i + 1 }),
    );
    const completed = new Set(sheets.slice(0, 15).map((s) => s.id));
    const failed = new Set(sheets.slice(15, 17).map((s) => s.id));

    const card = deriveDocumentCardStatus({
      includedSheets: sheets,
      completedSheetIds: completed,
      failedSheetIds: failed,
      analyzing: true,
      currentAnalyzingSheetId: "s18",
    });
    assert.equal(card.status, "analyzing");
    assert.equal(card.progressLabel, "15 of 20 sheets analyzed");
    const counts = countDocumentSheetStates({
      includedSheets: sheets,
      completedSheetIds: completed,
      failedSheetIds: failed,
      currentAnalyzingSheetId: "s18",
    });
    assert.equal(counts.completed, 15);
    assert.equal(counts.failed, 2);
    assert.equal(counts.analyzing, 1);
    assert.equal(counts.pending, 2);
  });

  it("C: 20-sheet PDF all complete", () => {
    const sheets = Array.from({ length: 20 }, (_, i) =>
      sheet({ id: `s${i + 1}`, source_document_id: "pdf-one", page_number: i + 1 }),
    );
    const completed = new Set(sheets.map((s) => s.id));
    const card = deriveDocumentCardStatus({
      includedSheets: sheets,
      completedSheetIds: completed,
      failedSheetIds: new Set(),
      analyzing: false,
    });
    assert.equal(card.status, "completed");
    assert.equal(card.progressLabel, "20 of 20 completed");
  });

  it("D: retry transitions failed → analyzing → completed", () => {
    const sheets = [sheet({ id: "s1", source_document_id: "doc-a", page_number: 1 })];

    const failed = deriveDocumentCardStatus({
      includedSheets: sheets,
      completedSheetIds: new Set(),
      failedSheetIds: new Set(["s1"]),
      analyzing: false,
    });
    assert.equal(failed.status, "failed");

    const retrying = deriveDocumentCardStatus({
      includedSheets: sheets,
      completedSheetIds: new Set(),
      failedSheetIds: new Set(["s1"]),
      analyzing: true,
      currentAnalyzingSheetId: "s1",
    });
    assert.equal(retrying.status, "analyzing");
    assert.equal(retrying.progressLabel, "0 of 1 sheet analyzed");

    const done = deriveDocumentCardStatus({
      includedSheets: sheets,
      completedSheetIds: new Set(["s1"]),
      failedSheetIds: new Set(),
      analyzing: false,
    });
    assert.equal(done.status, "completed");
  });

  it("E: upload queue card — active upload vs finished", () => {
    const uploading = deriveUploadQueueCardStatus("uploading");
    assert.equal(uploading.status, "uploading");
    assert.match(uploading.borderClass, /border-gold/);

    const pending = deriveUploadQueueCardStatus("pending");
    assert.equal(pending.status, "ready");

    const completed = deriveUploadQueueCardStatus("completed");
    assert.equal(completed.status, "completed");
  });

  it("F: partial when run finished with mixed success and failure", () => {
    const sheets = Array.from({ length: 20 }, (_, i) =>
      sheet({ id: `s${i + 1}`, source_document_id: "pdf-one", page_number: i + 1 }),
    );
    const completed = new Set(sheets.slice(0, 15).map((s) => s.id));
    const failed = new Set(sheets.slice(15, 20).map((s) => s.id));
    const card = deriveDocumentCardStatus({
      includedSheets: sheets,
      completedSheetIds: completed,
      failedSheetIds: failed,
      analyzing: false,
    });
    assert.equal(card.status, "partial");
    assert.equal(card.progressLabel, "15 completed · 5 failed");
  });

  it("G: stale document when analysis is out of date and sheet is new", () => {
    const sheets = [
      sheet({ id: "s-old", source_document_id: "doc-a", page_number: 1 }),
      sheet({ id: "s-new", source_document_id: "doc-a", page_number: 2 }),
    ];
    const card = deriveDocumentCardStatus({
      includedSheets: sheets,
      completedSheetIds: new Set(["s-old"]),
      failedSheetIds: new Set(),
      analyzing: false,
      analysisStale: true,
      newSheetIds: new Set(["s-new"]),
    });
    assert.equal(card.status, "stale");
    assert.equal(card.badgeLabel, "Needs update");
  });
});
