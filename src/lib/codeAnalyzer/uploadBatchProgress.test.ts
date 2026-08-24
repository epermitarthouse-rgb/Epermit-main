import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatPdfProcessingDetail,
  formatUploadCompletionToast,
  formatUploadProgressLabel,
  shouldClearUploadProgress,
  uploadProgressPercent,
  type DrawingUploadProgress,
} from "./uploadBatchProgress.ts";

describe("uploadBatchProgress helpers", () => {
  it("formats single-file upload progress", () => {
    const progress: DrawingUploadProgress = {
      total: 1,
      completed: 0,
      currentIndex: 1,
      currentFileName: "A001-SITE PLAN.pdf",
      phase: "uploading",
    };
    assert.equal(
      formatUploadProgressLabel(progress),
      "Uploading A001-SITE PLAN.pdf — 1 of 1",
    );
    assert.equal(uploadProgressPercent(progress), 0);
  });

  it("formats multi-file upload progress with count", () => {
    const progress: DrawingUploadProgress = {
      total: 16,
      completed: 6,
      currentIndex: 7,
      currentFileName: "A006-WATERPROOFING DETAILS.pdf",
      phase: "uploading",
    };
    assert.equal(
      formatUploadProgressLabel(progress),
      "Uploading A006-WATERPROOFING DETAILS.pdf — 7 of 16",
    );
    assert.equal(uploadProgressPercent(progress), 38);
  });

  it("shows completed count when all source files finish", () => {
    const progress: DrawingUploadProgress = {
      total: 16,
      completed: 16,
      currentIndex: 16,
      phase: "complete",
    };
    assert.equal(formatUploadProgressLabel(progress), "Uploading drawings — 16 of 16 uploaded");
    assert.equal(uploadProgressPercent(progress), 100);
    assert.equal(shouldClearUploadProgress(progress), true);
  });

  it("returns single-file success completion message", () => {
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

  it("returns multi-file success completion message", () => {
    const toast = formatUploadCompletionToast({
      total: 16,
      succeeded: 16,
      failed: 0,
    });
    assert.deepEqual(toast, {
      type: "success",
      message: "All 16 drawings uploaded successfully",
    });
  });

  it("returns mixed success/failure completion message", () => {
    const toast = formatUploadCompletionToast({
      total: 16,
      succeeded: 15,
      failed: 1,
    });
    assert.deepEqual(toast, {
      type: "warning",
      message: "15 of 16 uploaded — 1 failed",
    });
  });

  it("returns error when every upload fails", () => {
    const toast = formatUploadCompletionToast({
      total: 3,
      succeeded: 0,
      failed: 3,
    });
    assert.deepEqual(toast, {
      type: "error",
      message: "Upload failed: none of 3 drawings uploaded",
    });
  });

  it("formats multi-page PDF secondary processing detail", () => {
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
});
