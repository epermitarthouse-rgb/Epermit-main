import { describe, it, expect } from "vitest";
import {
  countFailedSheetJobs,
  failedSheetIdsForDocument,
} from "./retryWorkflow.ts";
import type { SheetJobSummary } from "./asyncRun.ts";
import type { CodeAnalyzerSheet } from "./model.ts";
import { buildConsolidatedDocumentCards } from "./documentWorkflowModel.ts";

function job(partial: Partial<SheetJobSummary> & Pick<SheetJobSummary, "sheet_id">): SheetJobSummary {
  return {
    id: partial.id ?? "j1",
    run_id: partial.run_id ?? "r1",
    analysis_mode: partial.analysis_mode ?? "ibc",
    status: partial.status ?? "failed",
    last_error: partial.last_error ?? "timeout",
    sheet_id: partial.sheet_id,
  };
}

describe("retryWorkflow helpers", () => {
  it("failedSheetIdsForDocument returns only failed sheets for that source document", () => {
    const sheets: CodeAnalyzerSheet[] = [
      {
        id: "s1",
        project_id: "p",
        source_document_id: "doc-a",
        image_document_id: null,
        page_number: 1,
        file_name: "A.pdf",
        excluded: false,
        created_at: "2026-01-01",
      },
      {
        id: "s2",
        project_id: "p",
        source_document_id: "doc-b",
        image_document_id: null,
        page_number: 1,
        file_name: "B.pdf",
        excluded: false,
        created_at: "2026-01-01",
      },
    ];
    const sheetJobs = [
      job({ id: "j1", sheet_id: "s1", status: "failed" }),
      job({ id: "j2", sheet_id: "s1", analysis_mode: "local", status: "completed" }),
      job({ id: "j3", sheet_id: "s2", status: "failed" }),
    ];
    expect(failedSheetIdsForDocument("doc-a", sheets, sheetJobs)).toEqual(["s1"]);
    expect(countFailedSheetJobs(sheetJobs)).toBe(2);
  });

  it("buildConsolidatedDocumentCards exposes retry organizing on failed ingestion", () => {
    const cards = buildConsolidatedDocumentCards({
      documents: [
        {
          id: "doc-x",
          file_name: "X.pdf",
          analyzer_class: null,
          analyzer_processing_status: "failed",
          document_type: "specification",
        },
      ],
      jobs: [
        {
          id: "ing-1",
          project_id: "p",
          document_id: "doc-x",
          status: "failed",
          progress_phase: "done",
          total_pages: 1,
          processed_pages: 0,
          failed_pages: 1,
          analyzer_class: null,
          content_fingerprint: "abc",
          last_error: "Raster error",
          error_code: null,
          progress_detail: {},
          created_at: "2026-01-01",
          updated_at: "2026-01-01",
          completed_at: "2026-01-01",
        },
      ],
      sheets: [],
      pendingUploads: [],
      completedSheetIds: new Set(),
      failedSheetIds: new Set(),
      analyzing: false,
    });
    const card = cards.find((c) => c.documentId === "doc-x");
    expect(card?.showRetryOrganizing).toBe(true);
    expect(card?.statusDetail ?? "").toMatch(/Raster error/);
  });

  it("document card shows retry failed analysis when sheet jobs failed for drawing", () => {
    const cards = buildConsolidatedDocumentCards({
      documents: [
        {
          id: "doc-d",
          file_name: "D.pdf",
          analyzer_class: "drawing_set",
          analyzer_processing_status: "completed",
          document_type: "specification",
        },
      ],
      jobs: [],
      sheets: [
        {
          id: "sheet-1",
          project_id: "p",
          source_document_id: "doc-d",
          image_document_id: null,
          page_number: 1,
          file_name: "D.pdf",
          excluded: false,
          created_at: "2026-01-01",
        },
      ],
      pendingUploads: [],
      completedSheetIds: new Set(),
      failedSheetIds: new Set(["sheet-1"]),
      analyzing: false,
      sheetJobs: [
        job({ id: "j-ibc", sheet_id: "sheet-1", status: "failed" }),
        job({ id: "j-local", sheet_id: "sheet-1", analysis_mode: "local", status: "completed" }),
      ],
    });
    const card = cards.find((c) => c.documentId === "doc-d");
    expect(card?.showRetryFailedAnalysis).toBe(true);
    expect(card?.retryFailedSheetIds).toEqual(["sheet-1"]);
  });
});
