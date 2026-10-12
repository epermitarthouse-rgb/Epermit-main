import { describe, it, expect } from "vitest";
import { buildConsolidatedDocumentCards } from "./documentWorkflowModel.ts";

describe("terminal post-analysis card status", () => {
  it("shows Not analyzed instead of Ready for analysis when run settled and no sheets", () => {
    const cards = buildConsolidatedDocumentCards({
      documents: [
        {
          id: "ask04",
          file_name: "ASK04 - SECTION DETAILS.pdf",
          analyzer_class: "drawing_set",
          analyzer_processing_status: "completed",
          document_type: "specification",
        },
      ],
      jobs: [
        {
          id: "j1",
          project_id: "p",
          document_id: "ask04",
          status: "completed",
          progress_phase: "done",
          total_pages: 1,
          processed_pages: 1,
          failed_pages: 0,
          analyzer_class: "drawing_set",
          content_fingerprint: "x",
          last_error: null,
          error_code: null,
          progress_detail: { sheets_created: 0 },
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
      analysisSettled: true,
    });
    const card = cards.find((c) => c.documentId === "ask04");
    expect(card?.status).toBe("Not analyzed");
    expect(card?.status).not.toBe("Ready for analysis");
    expect(card?.statusDetail).toMatch(/No analyzable plan sheets/i);
  });

  it("shows Ready for analysis when sheets exist but run not settled", () => {
    const cards = buildConsolidatedDocumentCards({
      documents: [
        {
          id: "ask02",
          file_name: "ASK02 - PARTIAL FLOOR PLANS.pdf",
          analyzer_class: "drawing_set",
          analyzer_processing_status: "completed",
          document_type: "specification",
        },
      ],
      jobs: [],
      sheets: [
        {
          id: "s1",
          project_id: "p",
          source_document_id: "ask02",
          image_document_id: null,
          page_number: 1,
          file_name: "ASK02 - PARTIAL FLOOR PLANS.pdf",
          excluded: false,
          created_at: "2026-01-01",
        },
      ],
      pendingUploads: [],
      completedSheetIds: new Set(),
      failedSheetIds: new Set(),
      analyzing: false,
      analysisSettled: false,
    });
    const card = cards.find((c) => c.documentId === "ask02");
    expect(card?.status).toBe("Ready for analysis");
  });
});
