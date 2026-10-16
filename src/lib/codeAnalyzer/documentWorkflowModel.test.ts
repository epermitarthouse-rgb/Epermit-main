import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildConsolidatedDocumentCards,
  isAnalyzerWorkflowDocument,
  resolveActiveWorkflowStep,
  resolveDocumentPurpose,
} from "./documentWorkflowModel.ts";

describe("documentWorkflowModel", () => {
  it("treats architectural sheet filenames as drawings even when stored as specifications", () => {
    for (const fileName of ["A-1.03-00.pdf", "A-1.04.00.pdf", "A-3.02-00.pdf"]) {
      const { purpose, detail } = resolveDocumentPurpose(
        {
          id: "sheet",
          file_name: fileName,
          analyzer_class: "specification",
          analyzer_processing_status: "completed",
          document_type: "specification",
        },
        0,
      );
      assert.equal(purpose, "Drawing", fileName);
      assert.match(detail ?? "", /Plan sheets/, fileName);
    }
  });

  it("includes specification and permit_drawing project uploads", () => {
    assert.equal(isAnalyzerWorkflowDocument({ id: "1", file_name: "a.pdf", analyzer_class: null, analyzer_processing_status: "not_started", document_type: "permit_drawing" }), true);
    assert.equal(isAnalyzerWorkflowDocument({ id: "2", file_name: "b.pdf", analyzer_class: "specification", analyzer_processing_status: "completed", document_type: "specification" }), true);
    assert.equal(isAnalyzerWorkflowDocument({ id: "3", file_name: "c.pdf", analyzer_class: null, analyzer_processing_status: null, document_type: "other" }), false);
  });

  it("maps mixed drawing with one sheet to Drawing purpose", () => {
    const { purpose, detail } = resolveDocumentPurpose(
      { id: "d", file_name: "set.pdf", analyzer_class: "mixed", analyzer_processing_status: "completed", document_type: "specification" },
      1,
    );
    assert.equal(purpose, "Drawing");
    assert.match(detail ?? "", /drawing pages/i);
  });

  it("builds one card per document id and pending uploads", () => {
    const cards = buildConsolidatedDocumentCards({
      documents: [
        { id: "doc-a", file_name: "A.pdf", analyzer_class: "specification", analyzer_processing_status: "completed", document_type: "specification" },
        { id: "doc-b", file_name: "B.pdf", analyzer_class: "mixed", analyzer_processing_status: "completed", document_type: "specification" },
        { id: "doc-c", file_name: "orphan.png", analyzer_class: null, analyzer_processing_status: "not_started", document_type: "permit_drawing" },
      ],
      jobs: [
        {
          id: "j1",
          project_id: "p",
          document_id: "doc-a",
          status: "completed",
          progress_phase: "done",
          total_pages: 4,
          processed_pages: 4,
          failed_pages: 0,
          analyzer_class: "specification",
          content_fingerprint: "x",
          last_error: null,
          error_code: null,
          progress_detail: {},
          created_at: "2026-01-01",
          updated_at: "2026-01-01",
          completed_at: "2026-01-01",
        },
        {
          id: "j2",
          project_id: "p",
          document_id: "doc-b",
          status: "completed",
          progress_phase: "done",
          total_pages: 5,
          processed_pages: 5,
          failed_pages: 0,
          analyzer_class: "mixed",
          content_fingerprint: "y",
          last_error: null,
          error_code: null,
          progress_detail: {},
          created_at: "2026-01-01",
          updated_at: "2026-01-01",
          completed_at: "2026-01-01",
        },
      ],
      sheets: [
        {
          id: "s1",
          project_id: "p",
          source_document_id: "doc-b",
          image_document_id: null,
          page_number: 3,
          file_name: "B.pdf",
          excluded: false,
          created_at: "2026-01-01",
        },
      ],
      pendingUploads: [{ id: "pending-1", name: "New.pdf", status: "pending" }],
      completedSheetIds: new Set(),
      failedSheetIds: new Set(),
      analyzing: false,
    });

    assert.equal(cards.length, 4);
    const ids = new Set(cards.map((c) => c.key));
    assert.equal(ids.size, 4);
    const spec = cards.find((c) => c.documentId === "doc-a");
    assert.equal(spec?.purpose, "Supporting document");
    assert.equal(spec?.status, "Used as analysis context");
    assert.equal(spec?.eligibleForBulkDelete, true);
    const drawing = cards.find((c) => c.documentId === "doc-b");
    assert.equal(drawing?.purpose, "Drawing");
    assert.equal(drawing?.eligibleForBulkDelete, true);
    assert.match(drawing?.countLabel ?? "", /1 plan sheet from 5 pages/);
    const legacy = cards.find((c) => c.documentId === "doc-c");
    assert.equal(legacy?.purpose, "Drawing");
    assert.equal(legacy?.eligibleForBulkDelete, true);
    const pending = cards.find((c) => c.key === "pending:pending-1");
    assert.equal(pending?.eligibleForBulkDelete, false);
  });

  it("keeps Run analysis active while a queued or running analysis is in progress", () => {
    const step = resolveActiveWorkflowStep({
      hasAnyDocuments: true,
      anyOrganizing: false,
      includedSheetCount: 4,
      analyzing: true,
      hasResults: true,
      analysisStale: false,
    });
    assert.equal(step.activeStep, 4);
    assert.match(step.nextHint, /Analysis is running/);
  });

  it("resolves workflow step for organizing vs review", () => {
    assert.equal(
      resolveActiveWorkflowStep({ hasAnyDocuments: true, anyOrganizing: true, includedSheetCount: 1, analyzing: false, hasResults: false, analysisStale: false }).activeStep,
      2,
    );
    assert.equal(
      resolveActiveWorkflowStep({ hasAnyDocuments: true, anyOrganizing: false, includedSheetCount: 2, analyzing: false, hasResults: true, analysisStale: false }).activeStep,
      5,
    );
  });
});
