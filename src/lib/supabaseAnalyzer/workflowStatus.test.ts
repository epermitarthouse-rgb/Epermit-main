import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  countPersistedUploadManifest,
  deriveAnalyzerWorkflowView,
  drawingSetNeedsFreshAnalysis,
  formatUploadFailureLabel,
  formatUploadSuccessLabel,
  formatUploadingDrawingsLabel,
} from "./workflowStatus";

describe("supabase analyzer workflow status", () => {
  it("formats upload progress without hardcoding sheet counts", () => {
    assert.equal(
      formatUploadingDrawingsLabel(12, 82),
      "Uploading drawings — 12/82 uploaded",
    );
    assert.equal(
      formatUploadSuccessLabel(82, 82),
      "82/82 drawings uploaded successfully",
    );
    assert.equal(
      formatUploadFailureLabel(80, 82, 2),
      "80/82 drawings uploaded — 2 failed",
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
    assert.equal(view.headline, "Ready for analysis");
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
    assert.match(view.headline, /Uploading drawings — 17\/82 uploaded/);
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
    assert.equal(view.headline, "82/82 drawings uploaded successfully");
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
    assert.equal(view.headline, "OCR processed — 20/82 · evidence verification pending");
    assert.match(view.detail || "", /82\/82 drawings uploaded/);
    assert.match(view.detail || "", /Z-9\.99-00\.pdf/);
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
    assert.match(view.headline, /Evidence verified — ready for analysis \(82\/82\)/);
    assert.doesNotMatch(view.headline, /injected/i);
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
    assert.equal(analyzing.headline, "Analyzing drawings — 42/82");

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
    assert.equal(complete.headline, "Analysis complete — 82/82");
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
    assert.equal(view.headline, "Uploading drawings — 3/5 uploaded");
    assert.equal(view.upload?.pending, 2);
  });
});
