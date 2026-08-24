import type { CodeAnalyzerSheet } from "./model";
import {
  detectIndexSheet,
  parseIndexEntriesFromText,
  runIndexCompletenessPrescreen,
  type IndexCompletenessResult,
  type IndexSheetEntry,
} from "./indexCompleteness";
import { requestDrawingIndexExtract } from "./indexExtractClient";
import { blobToBase64 } from "./blobToBase64";

async function loadSheetImageBase64(
  sheet: CodeAnalyzerSheet,
  getDownloadUrl: (documentId: string) => Promise<string | null>,
): Promise<{ imageBase64: string; imageType: string } | null> {
  const docId = sheet.image_document_id ?? sheet.source_document_id;
  const url = await getDownloadUrl(docId);
  if (!url) return null;
  const response = await fetch(url);
  const blob = await response.blob();
  return {
    imageBase64: await blobToBase64(blob),
    imageType: blob.type || "image/png",
  };
}

/** Run prescreen; uses vision only when an index sheet exists but text parsing is empty. */
export async function runDrawingIndexPrescreen(params: {
  sheets: CodeAnalyzerSheet[];
  pageTextBySheetId?: Record<string, string>;
  getDownloadUrl?: (documentId: string) => Promise<string | null>;
}): Promise<IndexCompletenessResult> {
  const indexSheet = detectIndexSheet(params.sheets, { pageTextBySheetId: params.pageTextBySheetId });
  if (!indexSheet) {
    return runIndexCompletenessPrescreen(params.sheets, { pageTextBySheetId: params.pageTextBySheetId });
  }

  let indexEntries: IndexSheetEntry[] = parseIndexEntriesFromText(
    params.pageTextBySheetId?.[indexSheet.id],
  );

  if (
    indexEntries.length === 0 &&
    params.getDownloadUrl &&
    (indexSheet.image_document_id || indexSheet.source_document_id)
  ) {
    try {
      const image = await loadSheetImageBase64(indexSheet, params.getDownloadUrl);
      if (image) {
        indexEntries = await requestDrawingIndexExtract({
          imageBase64: image.imageBase64,
          imageType: image.imageType,
          pageText: params.pageTextBySheetId?.[indexSheet.id],
        });
      }
    } catch (err) {
      console.warn("[index prescreen] Vision extract failed:", err);
    }
  }

  return runIndexCompletenessPrescreen(params.sheets, {
    pageTextBySheetId: params.pageTextBySheetId,
    indexEntries,
  });
}
