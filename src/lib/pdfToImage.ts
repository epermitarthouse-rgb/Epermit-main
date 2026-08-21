/**
 * PDF rasterization for AI Code Analyzer and plan viewers.
 * Creates a Worker with the worker URL per call so we never assign to
 * GlobalWorkerOptions (which is read-only in the ESM module).
 */
import * as pdfjsLib from "pdfjs-dist";
// Resolve worker from node_modules so we never touch GlobalWorkerOptions
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { COMPLIANCE_MAX_PAGES_PER_PDF, planPdfPageNumbers } from "@/lib/codeAnalyzer/model";

export async function pdfFirstPageToImageBase64(
  file: File
): Promise<{ base64: string; mimeType: string }> {
  const arrayBuffer = await file.arrayBuffer();
  const worker = new Worker(pdfjsWorkerUrl, { type: "module" });
  const pdfWorker = new pdfjsLib.PDFWorker({ port: worker });
  const loadingTask = pdfjsLib.getDocument({
    data: arrayBuffer,
    worker: pdfWorker,
  });
  const doc = await loadingTask.promise;
  const page = await doc.getPage(1);
  const scale = 2;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    worker.terminate();
    throw new Error("Could not get canvas context");
  }
  const renderTask = page.render({
    canvasContext: ctx,
    viewport,
  });
  await renderTask.promise;
  worker.terminate();
  const dataUrl = canvas.toDataURL("image/png");
  const base64 = dataUrl.split(",")[1];
  if (!base64) throw new Error("Failed to encode PDF page as image");
  return { base64, mimeType: "image/png" };
}

export interface PdfDocumentHandle {
  numPages: number;
  renderPage: (
    pageNumber: number,
    canvas: HTMLCanvasElement,
    scale: number
  ) => Promise<{ width: number; height: number }>;
  destroy: () => void;
}

export async function loadPdfDocument(
  source: ArrayBuffer | string
): Promise<PdfDocumentHandle> {
  const worker = new Worker(pdfjsWorkerUrl, { type: "module" });
  const pdfWorker = new pdfjsLib.PDFWorker({ port: worker });

  const loadingParams: Record<string, unknown> = { worker: pdfWorker };
  if (typeof source === "string") {
    loadingParams.url = source;
  } else {
    loadingParams.data = source;
  }

  const doc = await pdfjsLib.getDocument(loadingParams as any).promise;

  const renderPage = async (
    pageNumber: number,
    canvas: HTMLCanvasElement,
    scale: number
  ) => {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get canvas context");
    await page.render({ canvasContext: ctx, viewport }).promise;
    return { width: viewport.width, height: viewport.height };
  };

  const destroy = () => {
    doc.destroy();
    worker.terminate();
  };

  return { numPages: doc.numPages, renderPage, destroy };
}

export interface PdfPageImageFile {
  pageNumber: number;
  file: File;
}

/**
 * Rasterize each PDF page to a PNG File (up to maxPages).
 * Callers must not assume page 1 is the only page.
 */
export async function pdfPagesToImageFiles(
  pdfFile: File,
  options?: { maxPages?: number; scale?: number },
): Promise<{
  pages: PdfPageImageFile[];
  truncated: boolean;
  totalPages: number;
}> {
  const arrayBuffer = await pdfFile.arrayBuffer();
  const handle = await loadPdfDocument(arrayBuffer);
  try {
    const planned = planPdfPageNumbers(
      handle.numPages,
      options?.maxPages ?? COMPLIANCE_MAX_PAGES_PER_PDF,
    );
    const scale = options?.scale ?? 2;
    const pages: PdfPageImageFile[] = [];
    const baseName = pdfFile.name.replace(/\.pdf$/i, "") || "document";

    for (const pageNumber of planned.pageNumbers) {
      const canvas = document.createElement("canvas");
      await handle.renderPage(pageNumber, canvas, scale);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
          "image/png",
          1,
        );
      });
      pages.push({
        pageNumber,
        file: new File([blob], `${baseName}-page${pageNumber}.png`, { type: "image/png" }),
      });
    }

    return {
      pages,
      truncated: planned.truncated,
      totalPages: planned.totalPages,
    };
  } finally {
    handle.destroy();
  }
}
