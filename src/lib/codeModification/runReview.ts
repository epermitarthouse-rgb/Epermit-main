import { toast } from "sonner";
import {
  ANALYSIS_TYPE_DC_MODIFICATION,
  computeSheetFingerprint,
} from "@/lib/codeAnalyzer/model";
import {
  completeAnalyzerRun,
  createAnalyzerRun,
  fetchDocumentsByIds,
  markCurrentRunStale,
} from "@/lib/codeAnalyzer/persistence";
import { persistPendingAnalyzerSources } from "@/lib/codeAnalyzer/persistPending";
import type { CodeAnalyzerSheet } from "@/lib/codeAnalyzer/model";
import {
  computeFormFingerprint,
  computeModificationSourceFingerprint,
  type CodeModificationReview,
} from "@/lib/codeModification/model";
import { pagesAreSparse } from "@/lib/codeModification/extractForm";
import { replaceModificationReview } from "@/lib/codeModification/persistence";
import { fileToBase64, requestCodeModificationReview } from "@/lib/codeModification/reviewClient";
import { analyzerWorkflowFor } from "@/lib/codeModification/workflow";
import { pdfPagesToImageFiles } from "@/lib/pdfToImage";
import { extractPdfTextAllPages } from "@/utils/extractDocumentText";
import type { ProjectDocument } from "@/types/document";

export async function runDcCodeModificationReview(params: {
  projectId: string;
  userId: string;
  jurisdiction: string;
  projectType: string;
  codeYear: string;
  persistedSheets: CodeAnalyzerSheet[];
  pendingDrawingFiles: Array<{ id: string; file: File; discipline?: "general" }>;
  sheetDocuments: ProjectDocument[];
  modificationForm: ProjectDocument | null;
  pendingFormFile: File | null;
  getDownloadUrl: (doc: ProjectDocument) => Promise<string | null>;
  persistUpload: (opts: {
    file: File;
    document_type: string;
    description: string;
    parent_document_id?: string;
  }) => Promise<ProjectDocument | { id: string; file_name?: string } | null>;
}): Promise<{ review: CodeModificationReview; form: ProjectDocument }> {
  const workflow = analyzerWorkflowFor("dc_code_modification", params.jurisdiction);
  if (!workflow.ok) {
    throw new Error("DC Code Modification Review is only available for Washington, D.C.");
  }

  let sheets = params.persistedSheets;
  if (params.pendingDrawingFiles.length > 0) {
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
    });
    for (const warning of persisted.warnings) toast.warning(warning);
    sheets = [...sheets, ...persisted.sheets];
  }

  let formDoc = params.modificationForm;
  if (params.pendingFormFile) {
    if (formDoc) {
      await markCurrentRunStale(params.projectId, ANALYSIS_TYPE_DC_MODIFICATION);
    }
    const uploaded = await params.persistUpload({
      file: params.pendingFormFile,
      document_type: "code_modification_application",
      description: "DC Code Modification application",
    });
    if (!uploaded) throw new Error("Failed to upload the Code Modification application");
    formDoc = uploaded as ProjectDocument;
  }
  if (!formDoc) throw new Error("Upload a DC Code Modification application first");

  let formFile = params.pendingFormFile;
  if (!formFile) {
    const url = await params.getDownloadUrl(formDoc);
    if (!url) throw new Error("Could not download the Code Modification application");
    const response = await fetch(url);
    const blob = await response.blob();
    formFile = new File([blob], formDoc.file_name, {
      type: formDoc.file_type || blob.type || "application/pdf",
    });
  }

  const extractedPages = await extractPdfTextAllPages(formFile);
  const formPages = extractedPages.pages.map((p) => ({ pageNumber: p.pageNumber, text: p.text }));
  const formImages: { pageNumber: number; imageBase64: string; imageType?: string }[] = [];
  if (pagesAreSparse(formPages) || extractedPages.sparsePageNumbers.length > 0) {
    const rendered = await pdfPagesToImageFiles(formFile);
    for (const page of rendered.pages) {
      formImages.push({
        pageNumber: page.pageNumber,
        imageBase64: await fileToBase64(page.file),
        imageType: page.file.type || "image/png",
      });
    }
  }

  const included = sheets.filter((s) => !s.excluded);
  const docsById = new Map(params.sheetDocuments.map((d) => [d.id, d]));
  const missingIds = included
    .flatMap((s) => [s.image_document_id, s.source_document_id])
    .filter((id): id is string => Boolean(id) && !docsById.has(id));
  if (missingIds.length > 0) {
    const fetched = await fetchDocumentsByIds(missingIds);
    for (const doc of fetched) docsById.set(doc.id, doc);
  }

  const sheetPayload = [];
  for (const sheet of included) {
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

  const formFingerprint = computeFormFingerprint({
    formDocumentId: formDoc.id,
    updatedAt: formDoc.updated_at,
  });
  const sourceFingerprint = computeModificationSourceFingerprint(
    formFingerprint,
    computeSheetFingerprint(sheets),
  );

  const run = await createAnalyzerRun({
    projectId: params.projectId,
    userId: params.userId,
    jurisdiction: params.jurisdiction,
    projectType: params.projectType,
    codeYear: params.codeYear,
    analysisMode: "dc_code_modification",
    analysisType: ANALYSIS_TYPE_DC_MODIFICATION,
    formDocumentId: formDoc.id,
    sourceFingerprint,
  });

  try {
    const result = await requestCodeModificationReview({
      jurisdiction: params.jurisdiction,
      projectType: params.projectType,
      codeYear: params.codeYear,
      formPages,
      formImages: formImages.length ? formImages : undefined,
      sheets: sheetPayload,
      formDocument: { id: formDoc.id, fileName: formDoc.file_name },
    });
    await replaceModificationReview({
      run_id: run.id,
      project_id: params.projectId,
      form_document_id: formDoc.id,
      form_fingerprint: formFingerprint,
      extracted_request: result.extracted_request,
      evidence: result.evidence,
      overall_status: result.overall_status,
      extraction_warnings: result.extraction_warnings ?? [],
    });
    await completeAnalyzerRun(run.id, "current");
    return {
      review: {
        run_id: run.id,
        project_id: params.projectId,
        form_document_id: formDoc.id,
        form_fingerprint: formFingerprint,
        extracted_request: result.extracted_request,
        evidence: result.evidence,
        overall_status: result.overall_status,
        extraction_warnings: result.extraction_warnings ?? [],
      },
      form: formDoc,
    };
  } catch (err) {
    await completeAnalyzerRun(run.id, "failed").catch(() => undefined);
    throw err;
  }
}
