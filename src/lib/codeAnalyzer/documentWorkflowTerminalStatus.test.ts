import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
    assert.equal(card?.status, "Not analyzed");
    assert.notEqual(card?.status, "Ready for analysis");
    assert.match(card?.statusDetail ?? "", /No analyzable plan sheets/i);
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
    assert.equal(card?.status, "Ready for analysis");
  });
});
