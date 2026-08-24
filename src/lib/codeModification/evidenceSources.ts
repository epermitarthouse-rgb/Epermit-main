/**
 * DC Code Modification evidence sources.
 * Applications hold applicant claims; only permit drawing sheets verify evidence.
 */

import type { CodeAnalyzerSheet } from "@/lib/codeAnalyzer/model";
import type { ProjectDocument } from "@/types/document";
import type { CodeModificationSheetInput } from "./reviewClient";

export type FormExclusionDocumentRef = Pick<
  ProjectDocument,
  "id" | "document_type" | "parent_document_id" | "file_name"
>;

export function normalizeEvidenceFileName(fileName: string | null | undefined): string {
  return String(fileName ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Root source document ids registered in code_analyzer_sheets for this review.
 * These remain eligible for evidence even when a form-slot upload reused the filename.
 */
export function registeredDrawingSourceIdsFromSheets(
  sheets: ReadonlyArray<Pick<CodeAnalyzerSheet, "source_document_id">>,
): Set<string> {
  return new Set(sheets.map((sheet) => sheet.source_document_id).filter(Boolean));
}

/**
 * Document ids that must never be used as drawing-evidence sources:
 * - code_modification_application rows
 * - rendered/page child documents derived from them
 * - active form documents for this review
 * - duplicate permit_drawing uploads of a real form file name (mis-upload to Drawings)
 */
export function buildFormExclusionDocumentIds(
  documents: FormExclusionDocumentRef[],
  formDocuments?: ReadonlyArray<Pick<ProjectDocument, "id" | "file_name">> | null,
  registeredDrawingSourceIds?: ReadonlySet<string>,
): Set<string> {
  const excluded = new Set<string>();

  for (const doc of documents) {
    if (doc.document_type === "code_modification_application") {
      excluded.add(doc.id);
    }
  }

  for (const formDocument of formDocuments ?? []) {
    if (formDocument?.id) {
      excluded.add(formDocument.id);
    }

    const formFileName = normalizeEvidenceFileName(formDocument?.file_name);
    if (formFileName) {
      for (const doc of documents) {
        if (normalizeEvidenceFileName(doc.file_name) !== formFileName) continue;
        if (doc.document_type !== "permit_drawing") continue;
        if (registeredDrawingSourceIds?.has(doc.id)) continue;
        excluded.add(doc.id);
      }
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const doc of documents) {
      if (
        doc.parent_document_id &&
        excluded.has(doc.parent_document_id) &&
        !excluded.has(doc.id)
      ) {
        excluded.add(doc.id);
        changed = true;
      }
    }
  }

  return excluded;
}

export function sheetUsesExcludedDocument(
  sheet: Pick<CodeAnalyzerSheet, "source_document_id" | "image_document_id">,
  excludedDocumentIds: ReadonlySet<string>,
): boolean {
  if (excludedDocumentIds.has(sheet.source_document_id)) return true;
  if (sheet.image_document_id && excludedDocumentIds.has(sheet.image_document_id)) {
    return true;
  }
  return false;
}

export function filterDrawingEvidenceSheets<
  T extends Pick<CodeAnalyzerSheet, "source_document_id" | "image_document_id">,
>(sheets: T[], excludedDocumentIds: ReadonlySet<string>): T[] {
  return sheets.filter((sheet) => !sheetUsesExcludedDocument(sheet, excludedDocumentIds));
}

/** Resolve included analyzer sheets that qualify as drawing evidence for Code Mod review. */
export function resolveCodeModDrawingEvidence<
  T extends Pick<CodeAnalyzerSheet, "source_document_id" | "image_document_id" | "excluded">,
>(input: {
  sheets: T[];
  documents: FormExclusionDocumentRef[];
  formDocuments: ReadonlyArray<Pick<ProjectDocument, "id" | "file_name">>;
}): T[] {
  const included = input.sheets.filter((sheet) => !sheet.excluded);
  const registeredDrawingSourceIds = registeredDrawingSourceIdsFromSheets(input.sheets);
  const excludedDocumentIds = buildFormExclusionDocumentIds(
    input.documents,
    input.formDocuments,
    registeredDrawingSourceIds,
  );
  return filterDrawingEvidenceSheets(included, excludedDocumentIds);
}

export function sheetPayloadUsesExcludedDocument(
  sheet: CodeModificationSheetInput,
  excludedDocumentIds: ReadonlySet<string>,
): boolean {
  return Boolean(sheet.documentId && excludedDocumentIds.has(sheet.documentId));
}

export function filterDrawingEvidenceSheetPayload(
  sheets: CodeModificationSheetInput[],
  excludedDocumentIds: ReadonlySet<string>,
): CodeModificationSheetInput[] {
  return sheets.filter((sheet) => !sheetPayloadUsesExcludedDocument(sheet, excludedDocumentIds));
}
