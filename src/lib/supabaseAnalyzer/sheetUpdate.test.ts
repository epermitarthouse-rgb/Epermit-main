import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  analyzerActionPresentation,
  analyzerFileIdentity,
  applyCancellation,
  applySheetMutations,
  countPersistedSheets,
  isClaimableAnalyzerJob,
  planSheetUpdate,
  retryWouldRestart,
  sheetMutations,
  sheetNumberCandidates,
  updateConfirmationCopy,
  type ExistingAnalyzerSheet,
} from "../../../supabase/functions/_shared/analyzerSheetUpdate.ts";

function job(
  id: string,
  ordinal: number,
  name: string,
  status: ExistingAnalyzerSheet["status"] = "completed",
  extras: Partial<ExistingAnalyzerSheet> = {},
): ExistingAnalyzerSheet {
  return {
    id,
    ordinal,
    original_file_name: name,
    file_size: 1024,
    detected_sheet_number: null,
    status,
    ...extras,
  };
}

function completedSet(count: number): ExistingAnalyzerSheet[] {
  return Array.from({ length: count }, (_, index) => job(
    `job-${index + 1}`,
    index + 1,
    `sheet-${index + 1}.pdf`,
    "completed",
    { detected_sheet_number: `A-${String(index + 1).padStart(3, "0")}` },
  ));
}

describe("Supabase analyzer sheet update", () => {
  it("normalizes sheet numbers from file names without treating words as sheets", () => {
    assert.deepEqual(sheetNumberCandidates("A-101.pdf"), ["A101"]);
    assert.deepEqual(sheetNumberCandidates("a101.1 floor.pdf"), ["A1011"]);
    assert.deepEqual(sheetNumberCandidates("Rev 2 A-101.pdf"), ["A101"]);
    assert.deepEqual(sheetNumberCandidates("Floor Plan.pdf"), []);
    assert.deepEqual(sheetNumberCandidates("sheet-12.pdf"), []);
  });

  it("adds a drawing without duplicating or reprocessing completed sheets", () => {
    const existing = completedSet(82);
    const preview = planSheetUpdate(existing, [{ name: "A-200.pdf", size: 2048, type: "application/pdf" }]);
    assert.equal(preview.needsConfirmation, true);
    assert.equal(preview.accepted, false);
    assert.equal(preview.totalSheetsAfter, 83);
    assert.equal(updateConfirmationCopy(preview).title, "Update Analysis");
    assert.deepEqual(updateConfirmationCopy(preview).adds, ["A-200.pdf"]);

    const confirmed = planSheetUpdate(existing, [{ name: "A-200.pdf", size: 2048, type: "application/pdf" }], {
      confirmed: true,
    });
    assert.equal(confirmed.accepted, true);
    assert.equal(confirmed.added, 1);
    assert.equal(confirmed.replaced, 0);
    const next = applySheetMutations(existing, sheetMutations(confirmed), () => "job-new");
    assert.equal(next.length, 83);
    assert.equal(countPersistedSheets(next).total, 83);
    assert.equal(countPersistedSheets(next).completed, 82);
    assert.equal(countPersistedSheets(next).uploadPending, 1);
    for (const prior of existing) {
      assert.equal(next.find((item) => item.id === prior.id)?.status, "completed");
    }
  });

  it("replaces one matched sheet and keeps the other completed sheets", () => {
    const existing = [
      job("arch", 1, "A-101.pdf", "completed", { detected_sheet_number: "A-101" }),
      job("struct", 2, "S-201.pdf", "completed", { detected_sheet_number: "S-201" }),
    ];
    const findings = [
      { id: "f1", sheet_job_id: "arch", is_published: true },
      { id: "f2", sheet_job_id: "struct", is_published: true },
    ];
    const preview = planSheetUpdate(existing, [{ name: "A-101-rev.pdf", size: 4096, type: "application/pdf" }]);
    assert.equal(preview.items[0]?.action, "confirm");
    assert.equal(preview.items[0]?.matchedBy, "sheet_number");
    assert.match(updateConfirmationCopy(preview).replacements[0] || "", /A-101/);

    const confirmed = planSheetUpdate(existing, [{
      name: "A-101-rev.pdf",
      size: 4096,
      type: "application/pdf",
      replaceJobId: "arch",
    }], { confirmed: true });
    assert.equal(confirmed.replaced, 1);
    assert.equal(confirmed.added, 0);
    assert.equal(confirmed.totalSheetsAfter, 2);
    const next = applySheetMutations(existing, sheetMutations(confirmed), () => "arch-new");
    assert.equal(next.length, 2);
    assert.equal(next.some((item) => item.id === "arch"), false);
    assert.equal(next.find((item) => item.id === "struct")?.status, "completed");
    assert.equal(next.find((item) => item.id === "arch-new")?.status, "upload_pending");
    const remainingFindings = findings.filter((finding) => next.some((item) => item.id === finding.sheet_job_id));
    assert.deepEqual(remainingFindings.map((finding) => finding.id), ["f2"]);
  });

  it("replaces a revised file name and skips an unchanged duplicate", () => {
    const existing = [
      job("a", 1, "Cover.pdf", "completed"),
      job("b", 2, "Notes.pdf", "completed"),
    ];
    const preview = planSheetUpdate(existing, [
      { name: " Cover.PDF ", size: 1024, type: "application/pdf" },
      { name: "Cover.pdf", size: 5000, type: "application/pdf" },
    ]);
    assert.equal(preview.items[0]?.action, "skip");
    assert.equal(preview.items[1]?.action, "confirm");
    assert.equal(preview.items[1]?.matchedBy, "file_name");
    assert.equal(preview.totalSheetsAfter, 2);

    const sameAgain = planSheetUpdate(existing, [
      { name: "Cover.pdf", size: 1024, type: "application/pdf" },
      { name: "Notes.pdf", size: 1024, type: "application/pdf" },
    ], { confirmed: true });
    assert.equal(sameAgain.accepted, true);
    assert.equal(sameAgain.mutates, false);
    assert.equal(sameAgain.skipped, 2);
    assert.deepEqual(
      applySheetMutations(existing, sheetMutations(sameAgain), () => "unused").map((item) => item.id),
      ["a", "b"],
    );
  });

  it("repeats a confirmed replacement without creating a second job", () => {
    const existing = [
      job("arch", 1, "A-101.pdf", "completed", { detected_sheet_number: "A-101" }),
      job("pending", 2, "A-101-rev.pdf", "upload_pending", { file_size: 4096 }),
    ];
    const repeated = planSheetUpdate(existing, [{
      name: "A-101-rev.pdf",
      size: 4096,
      type: "application/pdf",
      replaceJobId: "arch",
    }], { confirmed: true });
    assert.equal(repeated.resumed, 1);
    assert.equal(repeated.added, 0);
    assert.equal(sheetMutations(repeated).inserts.length, 0);
    const next = applySheetMutations(existing, sheetMutations(repeated), () => "extra");
    assert.equal(next.some((item) => item.id === "arch"), false);
    assert.equal(next.some((item) => item.id === "pending"), true);
    assert.equal(next.length, 1);
  });

  it("does not create a second job when the same update is repeated", () => {
    const existing = [job("pending", 1, "A-300.pdf", "upload_pending")];
    const repeated = planSheetUpdate(existing, [{
      name: "A-300.pdf",
      size: 1024,
      type: "application/pdf",
    }], { confirmed: true });
    assert.equal(repeated.resumed, 1);
    assert.equal(repeated.added, 0);
    assert.equal(sheetMutations(repeated).inserts.length, 0);
    assert.equal(analyzerFileIdentity("A-300.pdf", 1024), analyzerFileIdentity(" a-300.pdf ", 1024));
  });

  it("asks before replacing and rejects a replacement that was not confirmed", () => {
    const existing = [job("arch", 1, "A-101.pdf", "completed", { detected_sheet_number: "A-101" })];
    const unconfirmed = planSheetUpdate(existing, [{
      name: "A-101-rev.pdf",
      size: 2048,
      type: "application/pdf",
    }], { confirmed: true });
    assert.equal(unconfirmed.accepted, false);
    assert.equal(unconfirmed.needsConfirmation, true);
    assert.equal(sheetMutations(unconfirmed).inserts.length, 0);
  });

  it("keeps an 82-sheet run unchanged when no drawings are submitted", () => {
    const existing = completedSet(82);
    const plan = planSheetUpdate(existing, existing.map((item) => ({
      name: item.original_file_name,
      size: item.file_size,
      type: "application/pdf",
    })), { confirmed: true });
    assert.equal(plan.skipped, 82);
    assert.equal(plan.mutates, false);
    assert.equal(plan.totalSheetsAfter, 82);
    assert.equal(countPersistedSheets(existing).completed, 82);
  });
});

describe("Supabase analyzer cancellation", () => {
  it("cancels pending work and preserves completed findings", () => {
    const jobs = [
      job("done-1", 1, "A-101.pdf", "completed"),
      job("done-2", 2, "A-102.pdf", "completed"),
      job("queued", 3, "A-103.pdf", "queued"),
      job("active", 4, "A-104.pdf", "processing"),
      job("waiting", 5, "A-105.pdf", "upload_pending"),
    ];
    const findings = [
      { id: "keep-1", sheet_job_id: "done-1", is_published: true },
      { id: "keep-2", sheet_job_id: "done-2", is_published: true },
      { id: "drop", sheet_job_id: "active", is_published: true },
    ];
    const cancelled = applyCancellation(jobs, findings);
    assert.deepEqual(cancelled.cancelledJobIds, ["queued", "active", "waiting"]);
    assert.equal(cancelled.jobs.find((item) => item.id === "done-1")?.status, "completed");
    assert.equal(cancelled.jobs.find((item) => item.id === "queued")?.status, "cancelled");
    assert.equal(cancelled.jobs.find((item) => item.id === "queued")?.error_code, "run_cancelled");
    assert.equal(cancelled.findings.find((item) => item.id === "keep-1")?.is_published, true);
    assert.equal(cancelled.findings.find((item) => item.id === "keep-2")?.is_published, true);
    assert.equal(cancelled.findings.find((item) => item.id === "drop")?.is_published, false);
    const counts = countPersistedSheets(cancelled.jobs);
    assert.equal(counts.completed, 2);
    assert.equal(counts.cancelled, 3);
    assert.equal(counts.queued, 0);
    assert.equal(counts.total, 2);
  });

  it("does not let a later worker claim or retry a cancelled job", () => {
    const run = {
      status: "cancelled",
      cancelledAt: "2026-10-22T00:00:00Z",
      estimatedCostUsd: 1,
      budgetLimitUsd: 20,
    };
    const cancelledJob = {
      status: "cancelled",
      attempt_count: 1,
      max_attempts: 3,
      leaseExpired: true,
      error_code: "run_cancelled",
    };
    assert.equal(isClaimableAnalyzerJob(cancelledJob, run), false);
    assert.equal(isClaimableAnalyzerJob({
      status: "queued",
      attempt_count: 0,
      max_attempts: 3,
    }, run), false);
    assert.equal(isClaimableAnalyzerJob({
      status: "processing",
      attempt_count: 1,
      max_attempts: 3,
      leaseExpired: true,
    }, { ...run, status: "processing", cancelledAt: null }), true);
    assert.equal(retryWouldRestart({ status: "failed", error_code: "run_cancelled" }), false);
    assert.equal(retryWouldRestart({ status: "failed", error_code: "openai_http_500" }), true);
    assert.equal(retryWouldRestart({ status: "cancelled", error_code: "run_cancelled" }), false);
  });

  it("keeps concurrent active jobs from being claimable once the run is cancelled", () => {
    const jobs = [
      job("one", 1, "A-1.pdf", "processing"),
      job("two", 2, "A-2.pdf", "queued"),
      job("three", 3, "A-3.pdf", "completed"),
    ];
    const cancelled = applyCancellation(jobs, []);
    const run = {
      status: "cancelled",
      cancelledAt: "2026-10-22T00:00:00Z",
      estimatedCostUsd: 0,
      budgetLimitUsd: 20,
    };
    for (const item of cancelled.jobs) {
      assert.equal(isClaimableAnalyzerJob({
        status: item.status,
        attempt_count: 1,
        max_attempts: 3,
        leaseExpired: true,
      }, run), false);
    }
    assert.equal(cancelled.jobs.find((item) => item.id === "three")?.status, "completed");
  });
});

describe("Supabase analyzer action buttons", () => {
  it("shows Update Analysis, Cancel Analysis, Processing, Cancelled, and Retry without overlap", () => {
    const ready = analyzerActionPresentation({
      hasProject: true,
      hasRun: true,
      runStatus: "completed",
      fileCount: 1,
      failedSheets: 0,
      submitting: false,
      cancelling: false,
    });
    assert.equal(ready.primaryLabel, "Update Analysis");
    assert.equal(ready.primaryDisabled, false);
    assert.equal(ready.showCancel, false);

    const processing = analyzerActionPresentation({
      hasProject: true,
      hasRun: true,
      runStatus: "processing",
      fileCount: 1,
      failedSheets: 2,
      submitting: false,
      cancelling: false,
    });
    assert.equal(processing.primaryLabel, "Processing");
    assert.equal(processing.primaryDisabled, true);
    assert.equal(processing.showCancel, true);
    assert.equal(processing.cancelLabel, "Cancel Analysis");
    assert.equal(processing.showRetry, false);
    assert.equal(processing.lockSelection, true);

    const cancelling = analyzerActionPresentation({
      hasProject: true,
      hasRun: true,
      runStatus: "processing",
      fileCount: 1,
      failedSheets: 0,
      submitting: false,
      cancelling: true,
    });
    assert.equal(cancelling.cancelLabel, "Cancelling…");
    assert.equal(cancelling.cancelDisabled, true);
    assert.equal(cancelling.primaryDisabled, true);

    const cancelled = analyzerActionPresentation({
      hasProject: true,
      hasRun: true,
      runStatus: "cancelled",
      fileCount: 1,
      failedSheets: 3,
      submitting: false,
      cancelling: false,
    });
    assert.equal(cancelled.statusText, "Cancelled");
    assert.equal(cancelled.primaryLabel, "Update Analysis");
    assert.equal(cancelled.showCancel, false);
    assert.equal(cancelled.showRetry, false);

    const retry = analyzerActionPresentation({
      hasProject: true,
      hasRun: true,
      runStatus: "completed_with_errors",
      fileCount: 0,
      failedSheets: 2,
      submitting: false,
      cancelling: false,
    });
    assert.equal(retry.showRetry, true);
    assert.equal(retry.primaryDisabled, true);

    const firstRun = analyzerActionPresentation({
      hasProject: true,
      hasRun: false,
      runStatus: null,
      fileCount: 2,
      failedSheets: 0,
      submitting: false,
      cancelling: false,
    });
    assert.equal(firstRun.primaryLabel, "Analyze for Compliance");

    const submitting = analyzerActionPresentation({
      hasProject: true,
      hasRun: true,
      runStatus: "uploading",
      fileCount: 2,
      failedSheets: 0,
      submitting: true,
      cancelling: false,
    });
    assert.equal(submitting.primaryLabel, "Uploading");
    assert.equal(submitting.primaryDisabled, true);
    assert.equal(submitting.cancelDisabled, true);

    const savedOnly = analyzerActionPresentation({
      hasProject: true,
      hasRun: true,
      runStatus: "completed",
      fileCount: 0,
      selectedSheetCount: 1,
      failedSheets: 0,
      submitting: false,
      cancelling: false,
    });
    assert.equal(savedOnly.primaryLabel, "Update Analysis");
    assert.equal(savedOnly.primaryDisabled, false);

    const savedWhileProcessing = analyzerActionPresentation({
      hasProject: true,
      hasRun: true,
      runStatus: "processing",
      fileCount: 0,
      selectedSheetCount: 82,
      failedSheets: 0,
      submitting: false,
      cancelling: false,
    });
    assert.equal(savedWhileProcessing.primaryDisabled, true);
    assert.equal(savedWhileProcessing.lockSelection, true);
  });
});
