/**
 * Targeted OCR: mixed-graphics cells only.
 * Words are visual_interpretation. This module does not call a model.
 */
import { createRequire } from "node:module";
import { ensurePdfjsPolyfill, loadPdfjs } from "./pdfExtract.mjs";
import { rasterFeatures } from "./cellClassify.mjs";
import { cellBox, shouldOcrCell } from "./hybridLayout.mjs";
import { dedupeOcrWords, inkOccupancy } from "./ocrRecover.mjs";

const require = createRequire(import.meta.url);
ensurePdfjsPolyfill();
const { ocrEngine, recognizePng } = require("../../../code-analyzer-worker/lib/ocr.js");
const { groupWordsIntoLines } = require("../../../code-analyzer-worker/lib/ocrLines.js");

export const TARGETED_OCR_VERSION = "phase2a2.hybrid.ocr.2";
const RASTER_SCALE = 0.2;
const TILE_MAX_PX = 1400;

function round(value) {
  return Math.round(Number(value) * 10) / 10;
}

function wordToPdfBox(tile, word) {
  if (word.origin === "top-left-px") return null;
  return {
    x: tile.x + Number(word.x) * tile.width,
    y: tile.y + Number(word.y) * tile.height,
    width: Number(word.width) * tile.width,
    height: Number(word.height) * tile.height,
    unit: "pdf-point",
    origin: "bottom-left",
  };
}

async function renderClip(page, canvas, pageHeight, tile, scale) {
  const pixelW = Math.max(8, Math.ceil(tile.width * scale));
  const pixelH = Math.max(8, Math.ceil(tile.height * scale));
  const surface = canvas.createCanvas(pixelW, pixelH);
  const context = surface.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, pixelW, pixelH);
  const viewport = page.getViewport({ scale });
  const left = tile.x * scale;
  const top = (pageHeight - tile.y - tile.height) * scale;
  await page.render({ canvasContext: context, viewport, transform: [1, 0, 0, 1, -left, -top] }).promise;
  return { png: Buffer.from(surface.toBuffer("image/png")), pixelWidth: pixelW, pixelHeight: pixelH };
}

export async function targetedOcrPage(page, pdfjs, options = {}) {
  const canvas = require("@napi-rs/canvas");
  const view = page.view || [0, 0, 0, 0];
  const pageWidth = view[2] - view[0];
  const pageHeight = view[3] - view[1];
  const rasterViewport = page.getViewport({ scale: RASTER_SCALE });
  const rasterW = Math.max(1, Math.ceil(rasterViewport.width));
  const rasterH = Math.max(1, Math.ceil(rasterViewport.height));
  const raster = canvas.createCanvas(rasterW, rasterH);
  const rasterCtx = raster.getContext("2d");
  rasterCtx.fillStyle = "#ffffff";
  rasterCtx.fillRect(0, 0, rasterW, rasterH);
  await page.render({ canvasContext: rasterCtx, viewport: rasterViewport }).promise;
  const rasterImage = rasterCtx.getImageData(0, 0, rasterW, rasterH);
  const rasterCells = rasterFeatures(rasterImage, rasterW, rasterH);

  const engine = ocrEngine(options);
  const rawWords = [];
  const cellOutcomes = [];
  let ocrAttempted = false;
  const drawingCells = options.drawingCells || {};
  const selected = rasterCells.filter((cell) => shouldOcrCell(cell, drawingCells[cell.cell]));

  if (!engine && typeof options.ocr !== "function") {
    for (const cell of selected) {
      cellOutcomes.push({ cell: cell.cell, status: "ocr_unavailable", words: 0 });
    }
  } else {
    ocrAttempted = true;
    for (const cell of selected) {
      const tile = cellBox(cell.row, cell.col, pageWidth, pageHeight);
      const scale = Math.min(TILE_MAX_PX / tile.width, TILE_MAX_PX / tile.height);
      try {
        const clip = await renderClip(page, canvas, pageHeight, tile, scale);
        const recognized = await recognizePng(clip.png, options);
        if (recognized.unavailable) {
          cellOutcomes.push({ cell: cell.cell, status: "ocr_unavailable", words: 0 });
          ocrAttempted = false;
          break;
        }
        if (recognized.failed) {
          cellOutcomes.push({ cell: cell.cell, status: "ocr_failed", words: 0 });
          continue;
        }
        let added = 0;
        for (const word of recognized.words || []) {
          const box = wordToPdfBox(tile, word);
          if (!box) continue;
          rawWords.push({
            text: word.text,
            confidence: Number(word.confidence),
            box: { ...box, pageWidth: round(pageWidth), pageHeight: round(pageHeight) },
            engine: recognized.engine,
            cell: cell.cell,
            origin: "visual_interpretation",
            independentlyVerified: false,
          });
          added += 1;
        }
        cellOutcomes.push({ cell: cell.cell, status: "ocr_ok", words: added, engine: recognized.engine });
      } catch (error) {
        cellOutcomes.push({
          cell: cell.cell,
          status: "ocr_failed",
          words: 0,
          errorClass: error?.name || "Error",
          message: String(error?.message || error).slice(0, 240),
        });
      }
    }
  }

  const words = dedupeOcrWords(rawWords).map((word) => {
    const occupancy = inkOccupancy(rasterImage, rasterW, rasterH, word.box, pageWidth, pageHeight);
    return {
      ...word,
      inkOccupancy: occupancy.ratio,
      occupancyStatus: occupancy.ratio >= 0.02 ? "ink_under_box" : "low_ink_under_box",
    };
  });
  const lines = groupWordsIntoLines(words.map((word) => ({
    text: word.text,
    confidence: word.confidence,
    box: word.box,
  }))).map((line) => ({
    text: line.text,
    box: line.box,
    confidence: line.confidence,
    words: line.words,
    vertical: line.vertical,
    origin: "visual_interpretation",
    independentlyVerified: false,
  }));

  return {
    recoveryVersion: TARGETED_OCR_VERSION,
    pageWidth: round(pageWidth),
    pageHeight: round(pageHeight),
    engine: engine || (typeof options.ocr === "function" ? "injected" : null),
    ocrAttempted,
    rasterCells,
    selectedCellCount: selected.length,
    cellOutcomes,
    words,
    lines,
    ocrChars: words.reduce((sum, word) => sum + word.text.length, 0),
    ocrLineCount: lines.length,
  };
}

export async function targetedOcrFile(filePath, options = {}) {
  ensurePdfjsPolyfill();
  const pdfjs = await loadPdfjs();
  const { readFile } = await import("node:fs/promises");
  const buffer = await readFile(filePath);
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    useSystemFonts: true,
    verbosity: 0,
    isEvalSupported: false,
  }).promise;
  try {
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      try {
        const drawingCells = options.pymupdfPages?.find((item) => item.pageNumber === pageNumber)?.drawings?.cells || {};
        pages.push({ pageNumber, ...(await targetedOcrPage(page, pdfjs, { ...options, drawingCells })) });
      } finally {
        page.cleanup?.();
      }
    }
    return { recoveryVersion: TARGETED_OCR_VERSION, pageCount: pdf.numPages, pages };
  } finally {
    await pdf.destroy().catch(() => {});
  }
}
