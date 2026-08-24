import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CodeAnalyzerSheet } from "./model.ts";
import {
  deriveDocumentCardStatus,
  deriveSheetChipStatus,
  deriveUploadQueueCardStatus,
  countDocumentSheetStates,
} from "./documentCardStatus.ts";
import { computeRunAnalysisMetrics } from "./sheetState.ts";

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

function sheetsForPdf(sourceId: string, count: number): CodeAnalyzerSheet[] {
  return Array.from({ length: count }, (_, i) =>
    sheet({
      id: `${sourceId}-s${i + 1}`,
      source_document_id: sourceId,
      page_number: i + 1,
      image_document_id: `${sourceId}-img-${i + 1}`,
    }),
  );
}

describe("documentCardStatus", () => {
  it("A: 20 pending → Ready", () => {
    const sheets = sheetsForPdf("spec-pdf", 20);
    const card = deriveDocumentCardStatus({
      includedSheets: sheets,
      completedSheetIds: new Set(),
      failedSheetIds: new Set(),
      analyzing: false,
    });
    assert.equal(card.status, "ready");
    assert.equal(card.badgeLabel, "Ready");
    assert.equal(card.progressLabel, "Ready for analysis");
    assert.equal(
      deriveSheetChipStatus(sheets[0], {
        completedSheetIds: new Set(),
        failedSheetIds: new Set(),
        analyzing: false,
      }),
      "pending",
    );
  });

  it("B: 10 completed + 10 analyzing → Analyzing", () => {
    const sheets = sheetsForPdf("pdf-one", 20);
    const completed = new Set(sheets.slice(0, 10).map((s) => s.id));
    const card = deriveDocumentCardStatus({
      includedSheets: sheets,
      completedSheetIds: completed,
      failedSheetIds: new Set(),
      analyzing: true,
      currentAnalyzingSheetId: sheets[10]?.id,
    });
    assert.equal(card.status, "analyzing");
    assert.equal(card.progressLabel, "10 of 20 sheets analyzed");
    const counts = countDocumentSheetStates({
      includedSheets: sheets,
      completedSheetIds: completed,
      failedSheetIds: new Set(),
      currentAnalyzingSheetId: sheets[10]?.id,
    });
    assert.equal(counts.completed, 10);
    assert.equal(counts.analyzing, 1);
    assert.equal(counts.pending, 9);
  });

  it("C: 20 completed → Completed", () => {
    const sheets = sheetsForPdf("pdf-one", 20);
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

  it("D: 15 completed + 5 failed → Partial", () => {
    const sheets = sheetsForPdf("spec-pdf", 20);
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

  it("E: 20 failed → Failed", () => {
    const sheets = sheetsForPdf("pdf-one", 20);
    const failed = new Set(sheets.map((s) => s.id));
    const card = deriveDocumentCardStatus({
      includedSheets: sheets,
      completedSheetIds: new Set(),
      failedSheetIds: failed,
      analyzing: false,
    });
    assert.equal(card.status, "failed");
    assert.equal(card.progressLabel, "20 of 20 failed");
  });

  it("F: retry flow Partial → Analyzing → Partial → Completed", () => {
    const sheets = sheetsForPdf("spec-pdf", 20);
    const failed = new Set(sheets.slice(15, 20).map((s) => s.id));
    const completedPartial = new Set(sheets.slice(0, 15).map((s) => s.id));

    const partial = deriveDocumentCardStatus({
      includedSheets: sheets,
      completedSheetIds: completedPartial,
      failedSheetIds: failed,
      analyzing: false,
    });
    assert.equal(partial.status, "partial");

    const retrying = deriveDocumentCardStatus({
      includedSheets: sheets,
      completedSheetIds: completedPartial,
      failedSheetIds: failed,
      analyzing: true,
      currentAnalyzingSheetId: sheets[15]?.id,
    });
    assert.equal(retrying.status, "analyzing");

    const partialAgain = deriveDocumentCardStatus({
      includedSheets: sheets,
      completedSheetIds: completedPartial,
      failedSheetIds: new Set(sheets.slice(16, 20).map((s) => s.id)),
      analyzing: false,
    });
    assert.equal(partialAgain.status, "partial");

    const done = deriveDocumentCardStatus({
      includedSheets: sheets,
      completedSheetIds: new Set(sheets.map((s) => s.id)),
      failedSheetIds: new Set(),
      analyzing: false,
    });
    assert.equal(done.status, "completed");
  });

  it("derives per-document status via computeRunAnalysisMetrics (SPEC 20-sheet partial)", () => {
    const allSheets = [
      ...sheetsForPdf("spec-pdf", 20),
      ...sheetsForPdf("other-pdf", 5),
    ];
    const specSheets = allSheets.filter((s) => s.source_document_id === "spec-pdf");
    const failedIds = new Set(specSheets.slice(15, 20).map((s) => s.id));
    const hydratedIds = new Set(specSheets.slice(0, 15).map((s) => s.image_document_id!));

    const specMetrics = computeRunAnalysisMetrics({
      sheets: specSheets,
      failedSheetIds: failedIds,
      hydratedImageDocumentIds: hydratedIds,
    });
    const card = deriveDocumentCardStatus({
      includedSheets: specSheets,
      completedSheetIds: specMetrics.completedSheetIds,
      failedSheetIds: specMetrics.failedSheetIds,
      analyzing: false,
    });
    assert.equal(card.status, "partial");
    assert.equal(card.progressLabel, "15 completed · 5 failed");
  });

  it("does not show Ready when some sheets completed but others pending (interrupted run)", () => {
    const sheets = sheetsForPdf("pdf-one", 20);
    const completed = new Set(sheets.slice(0, 15).map((s) => s.id));
    const card = deriveDocumentCardStatus({
      includedSheets: sheets,
      completedSheetIds: completed,
      failedSheetIds: new Set(),
      analyzing: false,
    });
    assert.notEqual(card.status, "ready");
    assert.equal(card.status, "analyzing");
  });

  it("upload queue card — active upload vs finished", () => {
    const uploading = deriveUploadQueueCardStatus("uploading");
    assert.equal(uploading.status, "uploading");
    assert.match(uploading.borderClass, /border-gold/);

    const pending = deriveUploadQueueCardStatus("pending");
    assert.equal(pending.status, "ready");

    const completed = deriveUploadQueueCardStatus("completed");
    assert.equal(completed.status, "completed");
  });

  it("stale document when analysis is out of date and sheet is new", () => {
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
