/**
 * Client-side PDF rasterization: render the first page of a PDF to an image File.
 * Use this before upload/API so the backend only ever receives images (fixes 400
 * "Invalid MIME type. Only image types are supported" on deployed environments).
 */
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

/**
 * Renders the first page of a PDF onto a canvas and returns it as an image/png File.
 * Safe to pass to storage upload and to the analyze-drawing API.
 */
export async function pdfFirstPageToImageFile(pdfFile: File): Promise<File> {
  const arrayBuffer = await pdfFile.arrayBuffer();
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

  const blob = await new Promise<Blob | null>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      "image/png",
      1
    );
  });
  if (!blob) throw new Error("Failed to encode PDF page as image");

  const baseName = pdfFile.name.replace(/\.pdf$/i, "") || "document";
  return new File([blob], `${baseName}-page1.png`, { type: "image/png" });
}
