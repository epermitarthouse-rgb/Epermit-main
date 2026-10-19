import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildConsolidatedDocumentCards } from "./documentWorkflowModel.ts";
import { metricsFromAsyncSheetJobs } from "./asyncRunProgress.ts";
import {
  formatUniqueSheetProgress,
  uniqueSheetAnalysisProgress,
  type SheetAnalysisJobLike,
} from "./uniqueSheetProgress.ts";

function jobsForSheets(
  sheetCount: number,
  modes: string[],
  statusFor: (sheetIndex: number, mode: string) => string,
): SheetAnalysisJobLike[] {
  const jobs: SheetAnalysisJobLike[] = [];
  for (let index = 0; index < sheetCount; index += 1) {
    for (const mode of modes) {
      jobs.push({
        sheet_id: `sheet-${index}`,
        status: statusFor(index, mode),
      });
    }
  }
  return jobs;
}

describe("unique sheet analysis progress", () => {
  it("counts 82 sheets with 164 jobs only when both required jobs succeed", () => {
    const sheetIds = Array.from({ length: 82 }, (_, index) => `sheet-${index}`);
    const pending = uniqueSheetAnalysisProgress({
      jobs: jobsForSheets(82, ["ibc", "local"], () => "pending"),
      sheetIds,
    });
    assert.equal(pending.completed, 0);
    assert.equal(pending.total, 82);
    assert.equal(pending.remaining, 82);
    assert.equal(pending.percent, 0);
    assert.equal(pending.sheetsAnalyzedLabel, "Sheets Analyzed: 0 / 82");
    assert.equal(pending.breakdownLabel, "0 completed · 82 remaining");

    const oneMode = uniqueSheetAnalysisProgress({
      jobs: jobsForSheets(82, ["ibc", "local"], (_index, mode) =>
        mode === "ibc" ? "completed" : "pending",
      ),
      sheetIds,
    });
    assert.equal(oneMode.completed, 0);
    assert.equal(oneMode.remaining, 82);
    assert.equal(oneMode.completedSheetIds.size, 0);
    assert.doesNotMatch(oneMode.combinedLabel, /164|jobs/i);

    const bothForFirst = uniqueSheetAnalysisProgress({
      jobs: jobsForSheets(82, ["ibc", "local"], (index) => (index === 0 ? "completed" : "pending")),
      sheetIds,
    });
    assert.equal(bothForFirst.completed, 1);
    assert.equal(bothForFirst.total, 82);
    assert.equal(bothForFirst.remaining, 81);
    assert.equal(bothForFirst.percent, Math.round((1 / 82) * 100));
    assert.deepEqual([...bothForFirst.completedSheetIds], ["sheet-0"]);
    assert.equal(bothForFirst.sheetsAnalyzedLabel, "Sheets Analyzed: 1 / 82");
    assert.equal(bothForFirst.breakdownLabel, "1 completed · 81 remaining");
    assert.doesNotMatch(bothForFirst.combinedLabel, /164|jobs/i);

    const failed = uniqueSheetAnalysisProgress({
      jobs: jobsForSheets(82, ["ibc", "local"], (index, mode) => {
        if (index === 3 && mode === "local") return "failed";
        if (index === 3) return "completed";
        return "completed";
      }),
      sheetIds,
    });
    assert.equal(failed.completed, 81);
    assert.equal(failed.failedSheetIds.has("sheet-3"), true);
    assert.equal(failed.completedSheetIds.has("sheet-3"), false);
    assert.equal(failed.remaining, 1);

    const cancelled = uniqueSheetAnalysisProgress({
      jobs: jobsForSheets(82, ["ibc", "local"], (index, mode) => {
        if (index === 4 && mode === "ibc") return "cancelled";
        return "completed";
      }),
      sheetIds,
    });
    assert.equal(cancelled.completed, 81);
    assert.equal(cancelled.cancelledSheetIds.has("sheet-4"), true);
    assert.equal(cancelled.completedSheetIds.has("sheet-4"), false);
    assert.equal(cancelled.remaining, 1);
    assert.match(formatUniqueSheetProgress(cancelled.completed, cancelled.total).combinedLabel, /81 \/ 82/);
  });

  it("covers a single sheet and a 10-sheet set", () => {
    const one = uniqueSheetAnalysisProgress({
      jobs: [
        { sheet_id: "only", status: "completed" },
        { sheet_id: "only", status: "processing" },
      ],
      sheetIds: ["only"],
    });
    assert.equal(one.completed, 0);
    assert.equal(one.total, 1);
    assert.equal(one.remaining, 1);
    assert.equal(one.percent, 0);

    const oneDone = uniqueSheetAnalysisProgress({
      jobs: [
        { sheet_id: "only", status: "completed" },
        { sheet_id: "only", status: "completed" },
      ],
      sheetIds: ["only"],
    });
    assert.equal(oneDone.completed, 1);
    assert.equal(oneDone.remaining, 0);
    assert.equal(oneDone.percent, 100);
    assert.equal(oneDone.combinedLabel, "Sheets Analyzed: 1 / 1 · 1 completed · 0 remaining · 100%");

    const ten = uniqueSheetAnalysisProgress({
      jobs: jobsForSheets(10, ["ibc", "local"], (index) => (index < 4 ? "completed" : "pending")),
      sheetIds: Array.from({ length: 10 }, (_, index) => `sheet-${index}`),
    });
    assert.equal(ten.completed, 4);
    assert.equal(ten.total, 10);
    assert.equal(ten.remaining, 6);
    assert.equal(ten.percent, 40);
    assert.equal(ten.sheetsAnalyzedLabel, "Sheets Analyzed: 4 / 10");
    assert.doesNotMatch(ten.combinedLabel, /jobs/i);
  });

  it("keeps display metrics on the same unique-sheet rule", () => {
    const jobs = jobsForSheets(82, ["ibc", "local"], (index, mode) => {
      if (index === 0) return "completed";
      if (index === 1 && mode === "ibc") return "completed";
      return "pending";
    }).map((job, index) => ({
      id: `job-${index}`,
      run_id: "run-1",
      sheet_id: job.sheet_id,
      analysis_mode: index % 2 === 0 ? "ibc" : "local",
      status: job.status,
      last_error: null,
    }));
    const metrics = metricsFromAsyncSheetJobs(
      jobs,
      Array.from({ length: 82 }, (_, index) => `sheet-${index}`),
    );
    assert.equal(metrics.completed, 1);
    assert.equal(metrics.total, 82);
    assert.equal(metrics.remaining, 81);
    assert.equal(metrics.completedSheetIds.has("sheet-1"), false);
    assert.doesNotMatch(metrics.combinedLabel, /164|jobs/i);
  });

  it("does not mark a document card complete when only one mode finished", () => {
    const cards = buildConsolidatedDocumentCards({
      documents: [
        {
          id: "doc-1",
          file_name: "A-1.pdf",
          analyzer_class: "drawing_set",
          analyzer_processing_status: "completed",
          document_type: "permit_drawing",
        },
      ],
      jobs: [],
      sheets: [
        {
          id: "sheet-1",
          project_id: "p",
          source_document_id: "doc-1",
          image_document_id: "img-1",
          page_number: 1,
          file_name: "A-1.pdf",
          excluded: false,
          created_at: "2026-01-01",
        },
      ],
      pendingUploads: [],
      completedSheetIds: new Set(["sheet-1"]),
      failedSheetIds: new Set(),
      analyzing: true,
      sheetJobs: [
        {
          id: "j-ibc",
          run_id: "run-1",
          sheet_id: "sheet-1",
          analysis_mode: "ibc",
          status: "completed",
          last_error: null,
        },
        {
          id: "j-local",
          run_id: "run-1",
          sheet_id: "sheet-1",
          analysis_mode: "local",
          status: "processing",
          last_error: null,
        },
      ],
    });
    const card = cards.find((item) => item.documentId === "doc-1");
    assert.equal(card?.status, "Analyzing");
    assert.match(card?.statusDetail ?? "", /Sheets Analyzed: 0 \/ 1/);
    assert.match(card?.statusDetail ?? "", /0 completed · 1 remaining/);
    assert.doesNotMatch(card?.statusDetail ?? "", /jobs/i);
  });
});
