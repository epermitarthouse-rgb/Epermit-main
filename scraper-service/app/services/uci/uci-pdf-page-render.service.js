"use strict";

/**
 * @param {Buffer} pdfBuffer
 * @param {number} pageNumber
 * @param {object} [opts]
 * @returns {Promise<{ pngBuffer: Buffer, width: number, height: number, mimeType: string } | null>}
 */
async function renderPdfPageToPng(pdfBuffer, pageNumber, opts = {}) {
  const scale = opts.scale ?? 1.5;
  const maxEdge = opts.maxEdge ?? 2048;

  let pdfjs;
  try {
    pdfjs = require("pdfjs-dist/legacy/build/pdf.js");
  } catch {
    return null;
  }

  let createCanvas;
  try {
    ({ createCanvas } = require("canvas"));
  } catch {
    return null;
  }

  const uint8 = new Uint8Array(pdfBuffer.buffer, pdfBuffer.byteOffset, pdfBuffer.byteLength);
  const pdf = await pdfjs.getDocument({ data: uint8, disableFontFace: true, verbosity: 0 }).promise;

  try {
    const page = await pdf.getPage(pageNumber);
    try {
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      await page.render({ canvasContext: context, viewport }).promise;
      let pngBuffer = canvas.toBuffer("image/png");

      try {
        const sharp = require("sharp");
        const meta = await sharp(pngBuffer).metadata();
        const w = meta.width ?? viewport.width;
        const h = meta.height ?? viewport.height;
        const edge = Math.max(w, h);
        if (edge > maxEdge) {
          pngBuffer = await sharp(pngBuffer)
            .resize({
              width: w >= h ? maxEdge : undefined,
              height: h > w ? maxEdge : undefined,
              fit: "inside",
              withoutEnlargement: true,
            })
            .png({ compressionLevel: 9 })
            .toBuffer();
        }
      } catch {
        // sharp optional — keep original png
      }

      return {
        pngBuffer,
        width: viewport.width,
        height: viewport.height,
        mimeType: "image/png",
      };
    } finally {
      if (typeof page.cleanup === "function") page.cleanup();
    }
  } finally {
    if (typeof pdf.destroy === "function") await pdf.destroy();
  }
}

module.exports = {
  renderPdfPageToPng,
};
