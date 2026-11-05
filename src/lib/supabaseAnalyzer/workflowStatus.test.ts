import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  countPersistedUploadManifest,
  deriveAnalyzerWorkflowView,
  drawingSetNeedsFreshAnalysis,
  formatUploadFailureLabel,
  formatUploadSuccessLabel,
  formatUploadingDrawingsLabel,
  isAnalyzerStatusLineVisible,
  type AnalyzerWorkflowView,
} from "./workflowStatus";

function visibleStatus(view: Pick<AnalyzerWorkflowView, "headline" | "detail">) {
  return `${view.headline} ${view.detail || ""}`;
}

function assertFriendlyStatus(view: Pick<AnalyzerWorkflowView, "headline" | "detail">) {
  const text = visibleStatus(view);
  assert.doesNotMatch(text, /Incomplete:/);
  assert.doesNotMatch(text, /Paid analysis stays blocked/);
  assert.doesNotMatch(text, /verified OCR/);
  assert.doesNotMatch(text, /\bOCR\b/);
  assert.doesNotMatch(text, /\bGPT\b/);
  assert.doesNotMatch(text, /evidence pack/i);
  assert.doesNotMatch(text, /override/i);
  assert.doesNotMatch(text, /preprocess/i);
  assert.doesNotMatch(text, /paid analysis/i);
  assert.doesNotMatch(text, /\.pdf/);
}

describe("supabase analyzer workflow status", () => {
  it("formats upload progress without hardcoding sheet counts", () => {
    assert.equal(
      formatUploadingDrawingsLabel(12, 82),
      "12 of 82 drawings have been received.",
    );
    assert.equal(
      formatUploadingDrawingsLabel(12, 82, "A-2.01-00.pdf"),
      "12 of 82 drawings have been received.",
    );
    assert.equal(
      formatUploadSuccessLabel(82, 82),
      "82 of 82 drawings were received.",
    );
    assert.equal(
      formatUploadFailureLabel(80, 82, 2),
      "Some drawings could not be received.",
    );
    assert.equal(
      formatUploadFailureLabel(0, 82, 2),
      "Drawings could not be received.",
    );
  });

  it("counts only non-cancelled persisted jobs for the upload manifest", () => {
    const manifest = countPersistedUploadManifest([
      { status: "completed" },
      { status: "queued" },
      { status: "upload_pending" },
      { status: "cancelled" },
    ]);
    assert.deepEqual(manifest, {
      uploaded: 2,
      total: 3,
      pending: 1,
      failed: 0,
    });
  });

  it("marks drawing set outdated when pending files mutate a completed run", () => {
    assert.equal(
      drawingSetNeedsFreshAnalysis({
        runStatus: "completed",
        pendingMutates: true,
      }),
      true,
    );
    assert.equal(
      drawingSetNeedsFreshAnalysis({
        runStatus: "completed",
        pendingMutates: false,
      }),
      false,
    );
    assert.equal(
      drawingSetNeedsFreshAnalysis({
        runStatus: "processing",
        pendingMutates: true,
      }),
      false,
    );
  });

  it("shows Ready for analysis instead of prior completion when drawings changed", () => {
    const view = deriveAnalyzerWorkflowView({
      run: {
        status: "completed",
        total_sheets: 82,
        completed_sheets: 82,
        failed_sheets: 0,
      },
      jobs: Array.from({ length: 82 }, () => ({ status: "completed" })),
      pendingMutates: true,
    });
    assert.equal(view.stage, "ready");
    assert.equal(view.headline, "Ready for analysis.");
    assert.equal(view.detail, "The drawing set changed, so earlier results are under Previous analyses.");
    assertFriendlyStatus(view);
    assert.equal(view.drawingSetOutdated, true);
    assert.equal(view.treatFindingsAsPrevious, true);
    assert.equal(view.analysis, null);
  });

  it("shows live upload progress from confirmed counts", () => {
    const view = deriveAnalyzerWorkflowView({
      run: { status: "uploading", total_sheets: 82, uploaded_sheets: 10 },
      jobs: [
        ...Array.from({ length: 10 }, () => ({ status: "queued" })),
        ...Array.from({ length: 72 }, () => ({ status: "upload_pending" })),
      ],
      pendingMutates: false,
      submitting: true,
      liveUpload: { completed: 17, total: 82, fileName: "A-101.pdf", phase: "uploading" },
    });
    assert.equal(view.stage, "uploading");
    assert.equal(view.headline, "Drawings are being received.");
    assert.equal(view.detail, "17 of 82 drawings have been received.");
    assert.doesNotMatch(visibleStatus(view), /A-101\.pdf/);
    assertFriendlyStatus(view);
    assert.equal(view.upload?.uploaded, 17);
    assert.equal(view.upload?.total, 82);
  });

  it("shows upload success then does not claim analysis complete", () => {
    const view = deriveAnalyzerWorkflowView({
      run: { status: "uploading", total_sheets: 82 },
      jobs: Array.from({ length: 82 }, () => ({ status: "upload_pending" })),
      pendingMutates: false,
      submitting: true,
      liveUpload: { completed: 82, total: 82, phase: "complete", failed: 0 },
    });
    assert.equal(view.headline, "Drawings were received.");
    assert.equal(view.detail, "82 of 82 drawings were received.");
    assertFriendlyStatus(view);
    assert.notEqual(view.stage, "complete");
  });

  it("keeps OCR prep separate from upload and analysis when Stage 3 is enabled", () => {
    const view = deriveAnalyzerWorkflowView({
      run: {
        status: "queued",
        total_sheets: 82,
        completed_sheets: 0,
        failed_sheets: 0,
        analysis_scope: {
          stage3FullCoverageOcr: true,
          stage3OcrPreprocess: {
            requiredSheetCount: 82,
            terminal: false,
            missingEvidence: 0,
            incompleteSheets: ["Z-9.99-00.pdf", "M-1.00-00.pdf"],
            counts: { completed: 20, pending: 60, processing: 2, failed: 0, skipped: 0 },
          },
        },
      },
      jobs: Array.from({ length: 82 }, () => ({ status: "queued" })),
      pendingMutates: false,
    });
    assert.equal(view.stage, "ocr_prep");
    assert.equal(view.headline, "Agents are extracting information from the drawings.");
    assert.equal(view.detail, "20 of 82 drawings are ready.");
    assert.doesNotMatch(visibleStatus(view), /Incomplete:/);
    assert.doesNotMatch(visibleStatus(view), /Paid analysis stays blocked/);
    assert.doesNotMatch(visibleStatus(view), /verified OCR/);
    assert.doesNotMatch(visibleStatus(view), /Z-9\.99-00\.pdf/);
    assertFriendlyStatus(view);
    assert.equal(view.ocr?.evidenceVerified, false);
    assert.equal(view.analysis, null);
  });

  it("shows evidence verified ready state without claiming GPT injection", () => {
    const view = deriveAnalyzerWorkflowView({
      run: {
        status: "queued",
        total_sheets: 82,
        completed_sheets: 0,
        failed_sheets: 0,
        processing_sheets: 0,
        analysis_scope: {
          stage3FullCoverageOcr: true,
          stage3OcrPreprocess: {
            requiredSheetCount: 82,
            terminal: true,
            missingEvidence: 0,
            incompleteSheets: [],
            counts: { completed: 82, pending: 0, processing: 0, failed: 0, skipped: 0 },
          },
        },
      },
      jobs: Array.from({ length: 82 }, () => ({ status: "queued" })),
      pendingMutates: false,
    });
    assert.equal(view.stage, "ready");
    assert.equal(view.headline, "Ready for analysis.");
    assert.equal(view.detail, "82 of 82 drawings are ready.");
    assert.doesNotMatch(visibleStatus(view), /injected/i);
    assertFriendlyStatus(view);
    assert.equal(view.ocr?.evidenceVerified, true);
    assert.equal(view.analysis, null);
  });

  it("shows analyzing and complete labels from persisted sheet counts", () => {
    const analyzing = deriveAnalyzerWorkflowView({
      run: {
        status: "processing",
        total_sheets: 82,
        completed_sheets: 40,
        failed_sheets: 2,
      },
      jobs: Array.from({ length: 82 }, () => ({ status: "processing" })),
      pendingMutates: false,
    });
    assert.equal(analyzing.headline, "Agents are reviewing the drawings.");
    assert.equal(analyzing.detail, "42 of 82 drawings have been reviewed.");
    assertFriendlyStatus(analyzing);

    const complete = deriveAnalyzerWorkflowView({
      run: {
        status: "completed",
        total_sheets: 82,
        completed_sheets: 82,
        failed_sheets: 0,
      },
      jobs: Array.from({ length: 82 }, () => ({ status: "completed" })),
      pendingMutates: false,
    });
    assert.equal(complete.headline, "The review is ready for Accept, Reject, or Modify.");
    assert.equal(complete.detail, "82 of 82 drawings have been reviewed.");
    assertFriendlyStatus(complete);
    assert.equal(complete.drawingSetOutdated, false);
  });

  it("after refresh uses persisted upload_pending jobs for uploading status", () => {
    const view = deriveAnalyzerWorkflowView({
      run: { status: "uploading", total_sheets: 5, uploaded_sheets: 3 },
      jobs: [
        { status: "queued" },
        { status: "queued" },
        { status: "queued" },
        { status: "upload_pending" },
        { status: "upload_pending" },
      ],
      pendingMutates: false,
    });
    assert.equal(view.stage, "uploading");
    assert.equal(view.headline, "Drawings are being received.");
    assert.equal(view.detail, "3 of 5 drawings have been received.");
    assertFriendlyStatus(view);
    assert.equal(view.upload?.pending, 2);
  });

  it("uses one friendly sentence for the remaining workflow stages", () => {
    const failedUpload = deriveAnalyzerWorkflowView({
      run: { status: "uploading", total_sheets: 82 },
      jobs: Array.from({ length: 82 }, () => ({ status: "upload_pending" })),
      pendingMutates: false,
      submitting: true,
      liveUpload: { completed: 80, total: 82, phase: "complete", failed: 2 },
    });
    assert.equal(failedUpload.headline, "Some drawings could not be received.");
    assert.equal(
      failedUpload.detail,
      "80 of 82 drawings were received. The drawings that did not arrive stay selected so you can retry.",
    );
    assertFriendlyStatus(failedUpload);

    const reviewing = deriveAnalyzerWorkflowView({
      run: {
        status: "processing",
        total_sheets: 82,
        completed_sheets: 12,
        failed_sheets: 0,
        processing_sheets: 4,
        analysis_scope: {
          stage3FullCoverageOcr: true,
          stage3OcrPreprocess: {
            requiredSheetCount: 82,
            terminal: true,
            missingEvidence: 0,
            incompleteSheets: ["A-2.01-00.pdf"],
            counts: { completed: 82, pending: 0, processing: 0, failed: 0, skipped: 0 },
          },
        },
      },
      jobs: Array.from({ length: 82 }, () => ({ status: "processing" })),
      pendingMutates: false,
    });
    assert.equal(reviewing.stage, "analyzing");
    assert.equal(reviewing.headline, "Agents are reviewing the drawings.");
    assert.equal(reviewing.detail, "12 of 82 drawings have been reviewed.");
    assertFriendlyStatus(reviewing);

    const withErrors = deriveAnalyzerWorkflowView({
      run: {
        status: "completed_with_errors",
        total_sheets: 82,
        completed_sheets: 80,
        failed_sheets: 2,
      },
      jobs: Array.from({ length: 82 }, () => ({ status: "completed" })),
      pendingMutates: false,
    });
    assert.equal(withErrors.stage, "complete_with_errors");
    assert.equal(
      withErrors.headline,
      "The review is ready for Accept, Reject, or Modify, though some drawings could not be reviewed.",
    );
    assert.equal(withErrors.detail, "82 of 82 drawings have been reviewed.");
    assertFriendlyStatus(withErrors);

    const cancelled = deriveAnalyzerWorkflowView({
      run: { status: "cancelled", total_sheets: 5 },
      jobs: Array.from({ length: 5 }, () => ({ status: "queued" })),
      pendingMutates: false,
    });
    assert.equal(cancelled.headline, "The review was cancelled.");
    assert.equal(cancelled.detail, null);
    assertFriendlyStatus(cancelled);

    const failed = deriveAnalyzerWorkflowView({
      run: { status: "failed", total_sheets: 5 },
      jobs: Array.from({ length: 5 }, () => ({ status: "queued" })),
      pendingMutates: false,
    });
    assert.equal(failed.headline, "The review could not be finished.");
    assert.equal(failed.detail, null);
    assertFriendlyStatus(failed);

    const saved = deriveAnalyzerWorkflowView({
      run: null,
      jobs: Array.from({ length: 82 }, () => ({ status: "queued" })),
      pendingMutates: false,
    });
    assert.equal(saved.headline, "Ready for analysis.");
    assert.equal(saved.detail, "82 of 82 drawings have been received.");
    assertFriendlyStatus(saved);

    const idle = deriveAnalyzerWorkflowView({
      run: null,
      jobs: [],
      pendingMutates: false,
    });
    assert.equal(idle.headline, "Ready for analysis.");
    assert.equal(idle.detail, null);
    assertFriendlyStatus(idle);
  });

  it("keeps the status sentence visible while the sheet page changes", () => {
    const reading = deriveAnalyzerWorkflowView({
      run: {
        status: "queued",
        total_sheets: 82,
        completed_sheets: 0,
        failed_sheets: 0,
        analysis_scope: {
          stage3FullCoverageOcr: true,
          stage3OcrPreprocess: {
            requiredSheetCount: 82,
            terminal: false,
            missingEvidence: 0,
            incompleteSheets: [],
            counts: { completed: 20, pending: 60, processing: 2, failed: 0, skipped: 0 },
          },
        },
      },
      jobs: Array.from({ length: 82 }, () => ({ status: "queued" })),
      pendingMutates: false,
    });
    const reviewing = deriveAnalyzerWorkflowView({
      run: {
        status: "processing",
        total_sheets: 82,
        completed_sheets: 40,
        failed_sheets: 2,
      },
      jobs: Array.from({ length: 82 }, () => ({ status: "processing" })),
      pendingMutates: false,
    });
    const waitingToReview = deriveAnalyzerWorkflowView({
      run: {
        status: "queued",
        total_sheets: 82,
        completed_sheets: 0,
        failed_sheets: 0,
        processing_sheets: 0,
        analysis_scope: {
          stage3FullCoverageOcr: true,
          stage3OcrPreprocess: {
            requiredSheetCount: 82,
            terminal: true,
            missingEvidence: 0,
            incompleteSheets: [],
            counts: { completed: 82, pending: 0, processing: 0, failed: 0, skipped: 0 },
          },
        },
      },
      jobs: Array.from({ length: 82 }, () => ({ status: "queued" })),
      pendingMutates: false,
    });
    assert.equal(waitingToReview.stage, "ready");

    for (const pageIndex of [0, 1, 12]) {
      for (const listPage of [1, 2, 4]) {
        const readingVisible = isAnalyzerStatusLineVisible({
          stage: reading.stage,
          drawingSetOutdated: reading.drawingSetOutdated,
          hasUpload: Boolean(reading.upload),
          runInProgress: true,
          totalSheets: 82,
        });
        const reviewingVisible = isAnalyzerStatusLineVisible({
          stage: reviewing.stage,
          drawingSetOutdated: reviewing.drawingSetOutdated,
          hasUpload: Boolean(reviewing.upload),
          runInProgress: true,
          totalSheets: 82,
        });
        const waitingVisible = isAnalyzerStatusLineVisible({
          stage: waitingToReview.stage,
          drawingSetOutdated: waitingToReview.drawingSetOutdated,
          hasUpload: Boolean(waitingToReview.upload),
          runInProgress: true,
          totalSheets: 82,
        });
        assert.equal(readingVisible, true, `reading status hidden at list page ${listPage}, index ${pageIndex}`);
        assert.equal(reviewingVisible, true, `review status hidden at list page ${listPage}, index ${pageIndex}`);
        assert.equal(waitingVisible, true, `ready status hidden at list page ${listPage}, index ${pageIndex}`);
      }
    }

    const idle = deriveAnalyzerWorkflowView({
      run: null,
      jobs: [],
      pendingMutates: false,
    });
    assert.equal(isAnalyzerStatusLineVisible({
      stage: idle.stage,
      drawingSetOutdated: idle.drawingSetOutdated,
      hasUpload: Boolean(idle.upload),
      runInProgress: false,
      totalSheets: 0,
    }), false);
  });
});
