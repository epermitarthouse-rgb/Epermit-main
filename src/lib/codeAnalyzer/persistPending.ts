/**
 * Persist pending analyzer uploads as source documents + per-page sheets.
 */
import type { DocumentDiscipline } from "@/types/document";
import {
  allocateIncludedSheetKeys,
  COMPLIANCE_MAX_INCLUDED_SHEETS,
  COMPLIANCE_MAX_PAGES_PER_PDF,
  isPdfFile,
  sheetFingerprintKey,
  type CodeAnalyzerSheet,
} from "./model";
import { insertAnalyzerSheet } from "./persistence";
import type { PdfPageImageFile } from "@/lib/pdfToImage";

export interface PersistPendingUploadDocument {
  (opts: {
    file: File;
    document_type: string;
    description: string;
    parent_document_id?: string;
  }): Promise<{ id: string; file_name?: string } | null>;
}

export interface PersistPendingSourceFile {
  id: string;
  file: File;
  discipline: DocumentDiscipline;
}

export async function persistPendingAnalyzerSources(params: {
  projectId: string;
  pendingFiles: PersistPendingSourceFile[];
  existingSheets: CodeAnalyzerSheet[];
  uploadDocument: PersistPendingUploadDocument;
  renderPdfPages: (file: File) => Promise<{
    pages: PdfPageImageFile[];
    truncated: boolean;
    totalPages: number;
  }>;
  insertSheet?: typeof insertAnalyzerSheet;
  maxPagesPerPdf?: number;
  maxIncludedSheets?: number;
}): Promise<{ sheets: CodeAnalyzerSheet[]; warnings: string[] }> {
  const insertSheet = params.insertSheet ?? insertAnalyzerSheet;
  const warnings: string[] = [];
  const created: CodeAnalyzerSheet[] = [];
  const maxIncluded = params.maxIncludedSheets ?? COMPLIANCE_MAX_INCLUDED_SHEETS;

  const incomingKeys: { source_document_id: string; page_number: number }[] = [];
  const staged: Array<{
    sourceId: string;
    fileName: string;
    discipline: DocumentDiscipline;
    pages: Array<{ pageNumber: number; imageFile: File; imageDocId?: string }>;
  }> = [];

  for (const pending of params.pendingFiles) {
    const isPdf = isPdfFile(pending.file);
    const sourceDoc = await params.uploadDocument({
      file: pending.file,
      document_type: "permit_drawing",
      description: isPdf
        ? `AI Code Analyzer source drawing (PDF)`
        : `AI Code Analyzer source drawing`,
    });
    if (!sourceDoc) {
      throw new Error(`Failed to upload ${pending.file.name}`);
    }

    let pages: Array<{ pageNumber: number; imageFile: File }>;
    if (isPdf) {
      const rendered = await params.renderPdfPages(pending.file);
      if (rendered.truncated) {
        warnings.push(
          `${pending.file.name} has ${rendered.totalPages} pages; the first ${params.maxPagesPerPdf ?? COMPLIANCE_MAX_PAGES_PER_PDF} were added as sheets.`,
        );
      }
      if (rendered.pages.length === 0) {
        throw new Error(`${pending.file.name} has no renderable pages`);
      }
      pages = rendered.pages.map((p) => ({ pageNumber: p.pageNumber, imageFile: p.file }));
    } else {
      pages = [{ pageNumber: 1, imageFile: pending.file }];
    }

    for (const page of pages) {
      incomingKeys.push({ source_document_id: sourceDoc.id, page_number: page.pageNumber });
    }

    staged.push({
      sourceId: sourceDoc.id,
      fileName: pending.file.name,
      discipline: pending.discipline,
      pages: pages.map((p) => ({ pageNumber: p.pageNumber, imageFile: p.imageFile })),
    });
  }

  const allocation = allocateIncludedSheetKeys(
    params.existingSheets,
    incomingKeys,
    maxIncluded,
  );
  if (allocation.excludedNewCount > 0) {
    warnings.push(
      `${allocation.excludedNewCount} additional page(s) were added as excluded because the included-sheet cap is ${maxIncluded}.`,
    );
  }

  for (const source of staged) {
    for (const page of source.pages) {
      const key = sheetFingerprintKey({
        source_document_id: source.sourceId,
        page_number: page.pageNumber,
      });
      const excluded = !allocation.includedKeys.has(key);
      let imageDocumentId = source.sourceId;
      const pageIsDistinctImage = isPdfFile({ name: source.fileName }) || page.pageNumber > 1;
      if (pageIsDistinctImage && isPdfFile({ name: source.fileName })) {
        const imageDoc = await params.uploadDocument({
          file: page.imageFile,
          document_type: "permit_drawing",
          description: `AI Code Analyzer page ${page.pageNumber}`,
          parent_document_id: source.sourceId,
        });
        if (!imageDoc) {
          throw new Error(`Failed to upload page ${page.pageNumber} of ${source.fileName}`);
        }
        imageDocumentId = imageDoc.id;
      }

      const sheet = await insertSheet({
        project_id: params.projectId,
        source_document_id: source.sourceId,
        image_document_id: imageDocumentId,
        page_number: page.pageNumber,
        file_name: source.fileName,
        discipline: source.discipline,
        excluded,
      });
      created.push(sheet);
    }
  }

  return { sheets: created, warnings };
}
