import type { CodeAnalyzerSheet } from "./model";
import {
  canonicalSheetNumber,
  detectIndexSheet,
  isCredibleDrawingSheetNumber,
  parseIndexEntriesFromText,
  parseOcrIndexEntries,
  runIndexCompletenessPrescreen,
  type IndexCompletenessResult,
  type IndexSheetEntry,
} from "./indexCompleteness";
import { requestDrawingIndexExtract } from "./indexExtractClient";
import { blobToBase64 } from "./blobToBase64";

export type SheetImage = { imageBase64: string; imageType: string };
export type RasterizePdfPage = (pdf: Blob, pageNumber: number) => Promise<SheetImage>;

/** Longest rendered side for the index image; enough for table text without an oversized request. */
const INDEX_IMAGE_MAX_SIDE = 3200;

async function rasterizePdfPageInBrowser(pdf: Blob, pageNumber: number): Promise<SheetImage> {
  const { loadPdfDocument } = await import("@/lib/pdfToImage");
  const handle = await loadPdfDocument(await pdf.arrayBuffer());
  try {
    const probe = document.createElement("canvas");
    const base = await handle.renderPage(pageNumber, probe, 1);
    const scale = Math.max(1, Math.min(3, INDEX_IMAGE_MAX_SIDE / Math.max(base.width, base.height)));
    const canvas = document.createElement("canvas");
    await handle.renderPage(pageNumber, canvas, scale);
    const dataUrl = canvas.toDataURL("image/png");
    return { imageBase64: dataUrl.split(",")[1] ?? "", imageType: "image/png" };
  } finally {
    handle.destroy();
  }
}

/** A stored PDF page is rendered to an image first; the vision endpoint only reads images. */
export async function loadSheetImage(
  sheet: CodeAnalyzerSheet,
  getDownloadUrl: (documentId: string) => Promise<string | null>,
  rasterize: RasterizePdfPage = rasterizePdfPageInBrowser,
  fetchBlob: (url: string) => Promise<Blob> = async (url) => (await fetch(url)).blob(),
): Promise<SheetImage | null> {
  const docId = sheet.image_document_id ?? sheet.source_document_id;
  const url = await getDownloadUrl(docId);
  if (!url) return null;
  const blob = await fetchBlob(url);
  const isPdf = blob.type === "application/pdf" || /\.pdf(?:$|\?)/i.test(url);
  if (isPdf) return rasterize(blob, sheet.page_number || 1);
  return { imageBase64: await blobToBase64(blob), imageType: blob.type || "image/png" };
}

/** Keep only rows that read as drawing sheet numbers; vision output is never trusted blindly. */
export function credibleIndexEntries(entries: IndexSheetEntry[]): IndexSheetEntry[] {
  const seen = new Set<string>();
  const out: IndexSheetEntry[] = [];
  for (const entry of entries) {
    const key = canonicalSheetNumber(entry.rawLabel || entry.sheetNumber);
    if (!key || !isCredibleDrawingSheetNumber(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...entry, sheetNumber: key });
  }
  return out;
}

/** "Not found" needs every included sheet's text. A sheet without text may be the index. */
export class IndexTextUnavailableError extends Error {
  readonly textlessSheets: number;
  constructor(textlessSheets: number) {
    super(
      `Sheet text is not ready for ${textlessSheets} ${textlessSheets === 1 ? "sheet" : "sheets"}, so the drawing index was not checked.`,
    );
    this.name = "IndexTextUnavailableError";
    this.textlessSheets = textlessSheets;
  }
}

function sheetsWithoutText(sheets: CodeAnalyzerSheet[], pageTextBySheetId?: Record<string, string>): number {
  return sheets.filter((sheet) => !sheet.excluded && !pageTextBySheetId?.[sheet.id]?.trim()).length;
}

/**
 * The prescreen a run stores. A held result that found the index is kept. An empty or
 * "not found" result is checked again on current text, so a stale miss is not persisted.
 */
export async function indexSnapshotForRun(
  held: IndexCompletenessResult | null | undefined,
  recheck: () => Promise<IndexCompletenessResult>,
): Promise<IndexCompletenessResult | undefined> {
  if (held?.hasIndex) return held;
  try {
    return await recheck();
  } catch (err) {
    console.warn("[index prescreen] Run snapshot not taken:", err);
    return undefined;
  }
}

/** Run prescreen; uses vision only when an index sheet exists but text parsing is empty. */
export async function runDrawingIndexPrescreen(params: {
  sheets: CodeAnalyzerSheet[];
  pageTextBySheetId?: Record<string, string>;
  getDownloadUrl?: (documentId: string) => Promise<string | null>;
  extract?: typeof requestDrawingIndexExtract;
  rasterize?: RasterizePdfPage;
  fetchBlob?: (url: string) => Promise<Blob>;
}): Promise<IndexCompletenessResult> {
  const indexSheet = detectIndexSheet(params.sheets, { pageTextBySheetId: params.pageTextBySheetId });
  if (!indexSheet) {
    const textless = sheetsWithoutText(params.sheets, params.pageTextBySheetId);
    if (textless > 0) throw new IndexTextUnavailableError(textless);
    return runIndexCompletenessPrescreen(params.sheets, { pageTextBySheetId: params.pageTextBySheetId });
  }

  const indexText = params.pageTextBySheetId?.[indexSheet.id];
  let indexEntries: IndexSheetEntry[] = parseIndexEntriesFromText(indexText);
  const ocrEntries = credibleIndexEntries(parseOcrIndexEntries(indexText));
  let indexSource: IndexCompletenessResult["indexSource"] = indexEntries.length ? "text" : null;
  let indexReadError: string | null = null;

  if (
    indexEntries.length === 0 &&
    params.getDownloadUrl &&
    (indexSheet.image_document_id || indexSheet.source_document_id)
  ) {
    try {
      const image = await loadSheetImage(indexSheet, params.getDownloadUrl, params.rasterize, params.fetchBlob);
      if (image?.imageBase64) {
        indexEntries = credibleIndexEntries(
          await (params.extract ?? requestDrawingIndexExtract)({
            imageBase64: image.imageBase64,
            imageType: image.imageType,
            pageText: params.pageTextBySheetId?.[indexSheet.id],
          }),
        );
        if (indexEntries.length) indexSource = "vision";
        else indexReadError = "The index image was read, but no sheet rows were recognized.";
      } else {
        indexReadError = "The index sheet image could not be loaded.";
      }
    } catch (err) {
      console.warn("[index prescreen] Vision extract failed:", err);
      indexReadError = err instanceof Error ? err.message : "Index extraction failed.";
    }
  }

  if (indexSource === "vision" && ocrEntries.length) {
    const read = new Set(indexEntries.map((entry) => entry.sheetNumber));
    const added = ocrEntries.filter((entry) => !read.has(entry.sheetNumber));
    if (added.length) {
      indexEntries = [...indexEntries, ...added];
      indexSource = "vision+ocr";
    }
  } else if (!indexEntries.length && ocrEntries.length) {
    indexEntries = ocrEntries;
    indexSource = "ocr";
    indexReadError = null;
  }

  const result = runIndexCompletenessPrescreen(params.sheets, {
    pageTextBySheetId: params.pageTextBySheetId,
    indexEntries,
  });
  return { ...result, indexSource, ...(indexReadError && result.status === "index_unreadable" ? { indexReadError } : {}) };
}
