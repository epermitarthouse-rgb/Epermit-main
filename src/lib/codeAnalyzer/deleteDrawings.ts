import type { CodeAnalyzerSheet } from "./model";
import type { ProjectDocument } from "@/types/document";

export type DeleteProjectDocumentFn = (document: ProjectDocument) => Promise<boolean>;

export type ResolveAnalyzerSourceDocumentFn = (
  sourceDocumentId: string,
) => Promise<ProjectDocument | null>;

/**
 * Resolve a source document and run the standard analyzer source delete path.
 */
export async function removeAnalyzerSourceDocument(params: {
  sourceDocumentId: string;
  persistedSheets: CodeAnalyzerSheet[];
  sheetDocuments: ProjectDocument[];
  resolveSourceDocument: ResolveAnalyzerSourceDocumentFn;
  deleteDocument: DeleteProjectDocumentFn;
}): Promise<boolean> {
  const source = await params.resolveSourceDocument(params.sourceDocumentId);
  if (!source) return false;

  const relatedSheets = params.persistedSheets.filter(
    (s) => s.source_document_id === source.id,
  );
  const imageDocs = params.sheetDocuments.filter((d) =>
    relatedSheets.some((s) => s.image_document_id === d.id),
  );

  return deleteAnalyzerSourceDrawing({
    sourceDocument: source,
    sheets: relatedSheets,
    imageDocuments: imageDocs,
    deleteDocument: params.deleteDocument,
  });
}

export async function removeAnalyzerSourceDocuments(params: {
  sourceDocumentIds: string[];
  persistedSheets: CodeAnalyzerSheet[];
  sheetDocuments: ProjectDocument[];
  resolveSourceDocument: ResolveAnalyzerSourceDocumentFn;
  deleteDocument: DeleteProjectDocumentFn;
}): Promise<{ removed: string[]; failed: string[] }> {
  const removed: string[] = [];
  const failed: string[] = [];
  for (const sourceDocumentId of params.sourceDocumentIds) {
    const ok = await removeAnalyzerSourceDocument({
      sourceDocumentId,
      persistedSheets: params.persistedSheets,
      sheetDocuments: params.sheetDocuments,
      resolveSourceDocument: params.resolveSourceDocument,
      deleteDocument: params.deleteDocument,
    });
    if (ok) removed.push(sourceDocumentId);
    else failed.push(sourceDocumentId);
  }
  return { removed, failed };
}

/**
 * Remove an entire uploaded drawing (PDF or image) from the analyzer dataset.
 * Deletes page-image child documents first, then the source document.
 * Sheets cascade from source_document_id.
 */
export async function deleteAnalyzerSourceDrawing(params: {
  sourceDocument: ProjectDocument;
  sheets: CodeAnalyzerSheet[];
  imageDocuments: ProjectDocument[];
  deleteDocument: DeleteProjectDocumentFn;
}): Promise<boolean> {
  const sourceId = params.sourceDocument.id;
  const childImages = params.imageDocuments.filter((doc) => {
    if (doc.id === sourceId) return false;
    return params.sheets.some(
      (s) => s.source_document_id === sourceId && s.image_document_id === doc.id,
    );
  });

  for (const child of childImages) {
    const ok = await params.deleteDocument(child);
    if (!ok) return false;
  }

  return params.deleteDocument(params.sourceDocument);
}

/**
 * Remove a single page/sheet from the analyzer dataset without deleting the
 * original multi-page PDF (when the image document is distinct from the source).
 */
export async function deleteAnalyzerSheet(params: {
  sheet: CodeAnalyzerSheet;
  sourceDocument: ProjectDocument | null;
  imageDocument: ProjectDocument | null;
  deleteDocument: DeleteProjectDocumentFn;
  deleteSheetRow: (sheetId: string) => Promise<void>;
}): Promise<boolean> {
  const { sheet, sourceDocument, imageDocument, deleteDocument, deleteSheetRow } = params;
  const imageIsDistinct =
    Boolean(imageDocument) &&
    Boolean(sourceDocument) &&
    imageDocument!.id !== sourceDocument!.id;

  if (imageIsDistinct && imageDocument) {
    const ok = await deleteDocument(imageDocument);
    if (!ok) return false;
  }

  await deleteSheetRow(sheet.id);
  return true;
}
