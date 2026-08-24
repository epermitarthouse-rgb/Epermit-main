import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatPdfProcessingDetail,
  formatUploadCompletionToast,
  formatUploadProgressLabel,
  formatPendingUploadCapacityLabel,
  shouldClearUploadProgress,
  shouldShowUploadProgress,
  uploadProgressPercent,
  type DrawingUploadProgress,
} from "./uploadBatchProgress.ts";

describe("uploadBatchProgress helpers", () => {
  it("formats single-document upload progress", () => {
    const progress: DrawingUploadProgress = {
      total: 1,
      completed: 0,
      currentIndex: 1,
      currentFileName: "A001-SITE PLAN.pdf",
      phase: "uploading",
    };
    assert.equal(
      formatUploadProgressLabel(progress),
      "Uploading A001-SITE PLAN.pdf — 1 of 1 document",
    );
    assert.equal(uploadProgressPercent(progress), 0);
  });

  it("formats multi-document upload progress without sheet counts", () => {
    const progress: DrawingUploadProgress = {
      total: 16,
      completed: 6,
      currentIndex: 7,
      currentFileName: "A006-WATERPROOFING DETAILS.pdf",
      phase: "uploading",
    };
    assert.equal(
      formatUploadProgressLabel(progress),
      "Uploading A006-WATERPROOFING DETAILS.pdf — 7 of 16 documents",
    );
    assert.equal(uploadProgressPercent(progress), 38);
    assert.doesNotMatch(formatUploadProgressLabel(progress), /sheet/i);
  });

  it("shows completed document count when all source files finish", () => {
    const progress: DrawingUploadProgress = {
      total: 16,
      completed: 16,
      currentIndex: 16,
      phase: "complete",
    };
    assert.equal(
      formatUploadProgressLabel(progress),
      "Uploading documents — 16 of 16 documents uploaded",
    );
    assert.equal(uploadProgressPercent(progress), 100);
    assert.equal(shouldClearUploadProgress(progress), true);
  });

  it("16 source documents stay document-scoped even when PDFs expand to many sheets elsewhere", () => {
    const sourceDocumentCount = 16;
    const expandedSheetCount = 33;
    const uploadProgress: DrawingUploadProgress = {
      total: sourceDocumentCount,
      completed: sourceDocumentCount,
      currentIndex: sourceDocumentCount,
      phase: "complete",
    };
    assert.equal(expandedSheetCount, 33);
    assert.ok(expandedSheetCount > sourceDocumentCount);
    assert.match(formatUploadProgressLabel(uploadProgress), /16 of 16 documents uploaded/);
    assert.doesNotMatch(formatUploadProgressLabel(uploadProgress), /33/);
    assert.doesNotMatch(formatUploadProgressLabel(uploadProgress), /sheet/i);
  });

  it("returns single-document success completion message", () => {
    const toast = formatUploadCompletionToast({
      total: 1,
      succeeded: 1,
      failed: 0,
      singleFileName: "A001-SITE PLAN.pdf",
    });
    assert.deepEqual(toast, {
      type: "success",
      message: "A001-SITE PLAN.pdf uploaded successfully",
    });
  });

  it("returns multi-document success completion message", () => {
    const toast = formatUploadCompletionToast({
      total: 16,
      succeeded: 16,
      failed: 0,
    });
    assert.deepEqual(toast, {
      type: "success",
      message: "All 16 documents uploaded successfully",
    });
  });

  it("returns mixed success/failure completion message with document units", () => {
    const toast = formatUploadCompletionToast({
      total: 16,
      succeeded: 15,
      failed: 1,
    });
    assert.deepEqual(toast, {
      type: "warning",
      message: "15 of 16 documents uploaded — 1 failed",
    });
    assert.doesNotMatch(toast!.message, /sheet/i);
  });

  it("returns error when every upload fails", () => {
    const toast = formatUploadCompletionToast({
      total: 3,
      succeeded: 0,
      failed: 3,
    });
    assert.deepEqual(toast, {
      type: "error",
      message: "Upload failed: none of 3 documents uploaded",
    });
  });

  it("formats multi-page PDF secondary processing detail without inflating document count", () => {
    const detail = formatPdfProcessingDetail({
      total: 2,
      completed: 0,
      currentIndex: 1,
      currentFileName: "SPEC #24-070.pdf",
      pdfProcessing: { fileName: "SPEC #24-070.pdf", pageCount: 12 },
      phase: "uploading",
    });
    assert.equal(detail, "Processing 12 pages from SPEC #24-070.pdf");
  });

  it("does not clear progress before completion", () => {
    assert.equal(
      shouldClearUploadProgress({
        total: 4,
        completed: 2,
        currentIndex: 3,
        phase: "uploading",
      }),
      false,
    );
  });

  it("does not show upload progress when inactive", () => {
    assert.equal(shouldShowUploadProgress(null), false);
    assert.equal(shouldShowUploadProgress(undefined), false);
    assert.equal(
      shouldShowUploadProgress({
        total: 16,
        completed: 16,
        currentIndex: 16,
        phase: "complete",
      }),
      false,
    );
  });

  it("shows upload progress while upload is active", () => {
    assert.equal(
      shouldShowUploadProgress({
        total: 16,
        completed: 6,
        currentIndex: 7,
        currentFileName: "A006-WATERPROOFING DETAILS.pdf",
        phase: "uploading",
      }),
      true,
    );
  });

  it("does not render pending upload capacity when queue is empty", () => {
    assert.equal(formatPendingUploadCapacityLabel(0, 16), null);
    assert.equal(formatPendingUploadCapacityLabel(-1, 16), null);
  });

  it("renders pending upload capacity only when files are queued", () => {
    assert.equal(formatPendingUploadCapacityLabel(7, 16), "7 of 16 source documents in this upload");
    assert.equal(formatPendingUploadCapacityLabel(1, 16), "1 of 16 source document in this upload");
  });
});
