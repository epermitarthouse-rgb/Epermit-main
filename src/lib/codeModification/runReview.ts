import { toast } from "sonner";
import {
  ANALYSIS_TYPE_DC_MODIFICATION,
  computeSheetFingerprint,
} from "@/lib/codeAnalyzer/model";
import {
  completeAnalyzerRun,
  createAnalyzerRun,
  fetchDocumentsByIds,
} from "@/lib/codeAnalyzer/persistence";
import { persistPendingAnalyzerSources } from "@/lib/codeAnalyzer/persistPending";
import type { CodeAnalyzerSheet } from "@/lib/codeAnalyzer/model";
import type { DrawingUploadProgress } from "@/lib/codeAnalyzer/uploadBatchProgress";
import {
  computeFormsFingerprint,
  type CodeModificationReview,
  computeModificationSourceFingerprint,
} from "@/lib/codeModification/model";
import { pagesAreSparse } from "@/lib/codeModification/extractForm";
import { fetchModificationForms, replaceModificationReview } from "@/lib/codeModification/persistence";
import {
  buildFormExclusionDocumentIds,
  registeredDrawingSourceIdsFromSheets,
  resolveCodeModDrawingEvidence,
} from "@/lib/codeModification/evidenceSources";
import { fileToBase64, requestCodeModificationReview } from "@/lib/codeModification/reviewClient";
import { analyzerWorkflowFor } from "@/lib/codeModification/workflow";
import { pdfPagesToImageFiles } from "@/lib/pdfToImage";
import { extractPdfTextAllPages } from "@/utils/extractDocumentText";
import type { ProjectDocument } from "@/types/document";

async function loadFormFile(
  doc: ProjectDocument,
  getDownloadUrl: (doc: ProjectDocument) => Promise<string | null>,
): Promise<File> {
  const url = await getDownloadUrl(doc);
  if (!url) throw new Error(`Could not download ${doc.file_name}`);
  const response = await fetch(url);
  const blob = await response.blob();
  return new File([blob], doc.file_name, {
    type: doc.file_type || blob.type || "application/pdf",
  });
}

async function extractMergedFormContent(
  formDocs: ProjectDocument[],
  getDownloadUrl: (doc: ProjectDocument) => Promise<string | null>,
): Promise<{
  formPages: { pageNumber: number; text: string }[];
  formImages: { pageNumber: number; imageBase64: string; imageType?: string }[];
}> {
  const formPages: { pageNumber: number; text: string }[] = [];
  const formImages: { pageNumber: number; imageBase64: string; imageType?: string }[] = [];
  let pageOffset = 0;

  for (const doc of formDocs) {
    const formFile = await loadFormFile(doc, getDownloadUrl);
    const extractedPages = await extractPdfTextAllPages(formFile);
    const docPages = extractedPages.pages.map((page) => ({
      pageNumber: pageOffset + page.pageNumber,
      text: page.text,
    }));
    formPages.push(...docPages);

    if (pagesAreSparse(docPages) || extractedPages.sparsePageNumbers.length > 0) {
      const rendered = await pdfPagesToImageFiles(formFile);
      for (const page of rendered.pages) {
        formImages.push({
          pageNumber: pageOffset + page.pageNumber,
          imageBase64: await fileToBase64(page.file),
          imageType: page.file.type || "image/png",
        });
      }
    }

    pageOffset += extractedPages.pages.length;
  }

  return { formPages, formImages };
}

export async function runDcCodeModificationReview(params: {
  projectId: string;
  userId: string;
  jurisdiction: string;
  projectType: string;
  codeYear: string;
  persistedSheets: CodeAnalyzerSheet[];
  pendingDrawingFiles: Array<{ id: string; file: File; discipline?: "general" }>;
  sheetDocuments: ProjectDocument[];
  modificationForms: ProjectDocument[];
  analysisInstructions?: string | null;
  getDownloadUrl: (doc: ProjectDocument) => Promise<string | null>;
  persistUpload: (opts: {
    file: File;
    document_type: string;
    description: string;
    parent_document_id?: string;
  }) => Promise<ProjectDocument | { id: string; file_name?: string } | null>;
  onUploadProgress?: (progress: DrawingUploadProgress) => void;
}): Promise<{
  review: CodeModificationReview;
  forms: ProjectDocument[];
  drawingUpload?: { total: number; failed: number; failedSourceIds: string[] };
}> {
  const workflow = analyzerWorkflowFor("dc_code_modification", params.jurisdiction);
  if (!workflow.ok) {
    throw new Error("DC Code Modification Review is only available for Washington, D.C.");
  }

  let sheets = params.persistedSheets;
  let drawingUpload: { total: number; failed: number; failedSourceIds: string[] } | undefined;
  if (params.pendingDrawingFiles.length > 0) {
    const pendingCount = params.pendingDrawingFiles.length;
    const persisted = await persistPendingAnalyzerSources({
      projectId: params.projectId,
      pendingFiles: params.pendingDrawingFiles.map((f) => ({
        id: f.id,
        file: f.file,
        discipline: (f.discipline ?? "general") as never,
      })),
      existingSheets: sheets,
      uploadDocument: params.persistUpload,
      renderPdfPages: pdfPagesToImageFiles,
      onUploadProgress: params.onUploadProgress,
    });
    for (const warning of persisted.warnings) toast.warning(warning);
    drawingUpload = {
      total: pendingCount,
      failed: persisted.failedSources.length,
      failedSourceIds: persisted.failedSources.map((f) => f.id),
    };
    sheets = [...sheets, ...persisted.sheets];
  }

  const formDocs = [...params.modificationForms].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );
  if (formDocs.length === 0) {
    throw new Error("Upload at least one DC Code Modification document first");
  }

  const { formPages, formImages } = await extractMergedFormContent(formDocs, params.getDownloadUrl);
  const primaryFormDoc = formDocs[0]!;

  const included = sheets.filter((s) => !s.excluded);
  const docsById = new Map(params.sheetDocuments.map((d) => [d.id, d]));
  const missingIds = included
    .flatMap((s) => [s.image_document_id, s.source_document_id])
    .filter((id): id is string => Boolean(id) && !docsById.has(id));
  if (missingIds.length > 0) {
    const fetched = await fetchDocumentsByIds(missingIds);
    for (const doc of fetched) docsById.set(doc.id, doc);
  }

  const modificationForms = await fetchModificationForms(params.projectId);
  const exclusionDocs = [...Array.from(docsById.values()), ...modificationForms].filter(
    (doc, index, arr) => arr.findIndex((other) => other.id === doc.id) === index,
  );
  const evidenceSheets = resolveCodeModDrawingEvidence({
    sheets,
    documents: exclusionDocs,
    formDocuments: formDocs,
  });
  const excludedEvidenceDocumentIds = buildFormExclusionDocumentIds(
    exclusionDocs,
    formDocs,
    registeredDrawingSourceIdsFromSheets(sheets),
  );

  if (included.length > 0 && evidenceSheets.length === 0) {
    throw new Error(
      "Drawing sheets are registered but none qualify for evidence review. Remove duplicate form uploads of drawing PDFs or re-upload base permit drawings in the Drawings section.",
    );
  }

  const sheetPayload = [];
  for (const sheet of evidenceSheets) {
    const imageDoc =
      (sheet.image_document_id && docsById.get(sheet.image_document_id)) ||
      docsById.get(sheet.source_document_id);
    if (!imageDoc) continue;
    const url = await params.getDownloadUrl(imageDoc);
    if (!url) continue;
    const response = await fetch(url);
    const blob = await response.blob();
    const imageFile = new File([blob], imageDoc.file_name, {
      type: imageDoc.file_type || blob.type || "image/png",
    });
    sheetPayload.push({
      id: sheet.id,
      documentId: imageDoc.id,
      fileName: sheet.file_name ?? imageDoc.file_name,
      sheetLabel: sheet.file_name ?? imageDoc.file_name,
      pageNumber: sheet.page_number,
      imageBase64: await fileToBase64(imageFile),
      imageType: imageFile.type || "image/png",
    });
  }

  if (evidenceSheets.length > 0 && sheetPayload.length === 0) {
    throw new Error(
      "Drawing evidence sheets could not be loaded for review. Check storage access for rendered drawing pages.",
    );
  }

  const formFingerprint = computeFormsFingerprint(
    formDocs.map((doc) => ({
      formDocumentId: doc.id,
      updatedAt: doc.updated_at,
    })),
  );
  const sourceFingerprint = computeModificationSourceFingerprint(
    formFingerprint,
    computeSheetFingerprint(sheets),
    params.analysisInstructions,
  );

  const run = await createAnalyzerRun({
    projectId: params.projectId,
    userId: params.userId,
    jurisdiction: params.jurisdiction,
    projectType: params.projectType,
    codeYear: params.codeYear,
    analysisMode: "dc_code_modification",
    analysisType: ANALYSIS_TYPE_DC_MODIFICATION,
    formDocumentId: primaryFormDoc.id,
    sourceFingerprint,
    analysisInstructions: params.analysisInstructions,
  });

  try {
    const result = await requestCodeModificationReview({
      jurisdiction: params.jurisdiction,
      projectType: params.projectType,
      codeYear: params.codeYear,
      formPages,
      formImages: formImages.length ? formImages : undefined,
      sheets: sheetPayload,
      formDocument: { id: primaryFormDoc.id, fileName: primaryFormDoc.file_name },
      formDocuments: formDocs.map((doc) => ({ id: doc.id, fileName: doc.file_name })),
      excludedEvidenceDocumentIds: Array.from(excludedEvidenceDocumentIds),
      analysisInstructions: params.analysisInstructions,
    });
    const review = await replaceModificationReview(
      {
        run_id: run.id,
        project_id: params.projectId,
        form_document_id: primaryFormDoc.id,
        form_fingerprint: formFingerprint,
        extracted_request: result.extracted_request,
        evidence: result.evidence,
        overall_status: result.overall_status,
        extraction_warnings: result.extraction_warnings ?? [],
      },
      formDocs.map((doc) => doc.id),
    );
    await completeAnalyzerRun(run.id, "current");
    return { review, forms: formDocs, drawingUpload };
  } catch (err) {
    await completeAnalyzerRun(run.id, "failed").catch(() => undefined);
    throw err;
  }
}
