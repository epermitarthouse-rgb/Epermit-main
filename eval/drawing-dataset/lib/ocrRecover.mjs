/**
 * Tiled OCR recovery using the Code Analyzer worker's local OCR (macOS Vision).
 * Words are visual interpretation, not professionally verified text.
 * Does not call a model.
 */
import { createRequire } from "node:module";
import { ensurePdfjsPolyfill, loadPdfjs } from "./pdfExtract.mjs";
import { rasterFeatures, OCR_KEEP } from "./cellClassify.mjs";

const require = createRequire(import.meta.url);
ensurePdfjsPolyfill();
const { ocrEngine, recognizePng } = require("../../../code-analyzer-worker/lib/ocr.js");
const { groupWordsIntoLines, correctedSheetToken } = require("../../../code-analyzer-worker/lib/ocrLines.js");

export const RECOVERY_VERSION = "phase2a2.recover.1";
export const TILE_COLS = 4;
export const TILE_ROWS = 3;
export const TILE_OVERLAP = 0.04;
export const TILE_MAX_PX = 1600;
export const RASTER_SCALE = 0.2;

const TEXT_OPS = new Set([44, 45, 46, 47]);
const PATH_OPS = new Set([13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28]);
const IMAGE_OPS = new Set([63, 65, 66, 82, 85, 86, 87, 88, 89]);

export function operatorStats(fnArray, opName) {
  let text = 0;
  let path = 0;
  let image = 0;
  let other = 0;
  const named = {};
  for (const fn of fnArray || []) {
    const name = opName[fn] || String(fn);
    named[name] = (named[name] || 0) + 1;
    if (TEXT_OPS.has(fn)) text += 1;
    else if (PATH_OPS.has(fn) || name === "constructPath") path += 1;
    else if (IMAGE_OPS.has(fn) || /Image|XObject/i.test(name)) image += 1;
    else other += 1;
  }
  return { operators: (fnArray || []).length, text, path, image, other };
}

function round(value) {
  return Math.round(Number(value) * 10) / 10;
}

function tileBoxes(pageWidth, pageHeight) {
  const tiles = [];
  const overlapX = pageWidth * TILE_OVERLAP;
  const overlapY = pageHeight * TILE_OVERLAP;
  const width = pageWidth / TILE_COLS;
  const height = pageHeight / TILE_ROWS;
  for (let row = 0; row < TILE_ROWS; row += 1) {
    for (let col = 0; col < TILE_COLS; col += 1) {
      const x = Math.max(0, col * width - overlapX);
      const yBottom = Math.max(0, (TILE_ROWS - 1 - row) * height - overlapY);
      const w = Math.min(pageWidth - x, width + overlapX * 2);
      const h = Math.min(pageHeight - yBottom, height + overlapY * 2);
      tiles.push({ id: `t${row}c${col}`, row, col, x, y: yBottom, width: w, height: h });
    }
  }
  return tiles;
}

function wordToPdfBox(tile, word) {
  if (word.origin === "top-left-px") {
    return null;
  }
  return {
    x: tile.x + Number(word.x) * tile.width,
    y: tile.y + Number(word.y) * tile.height,
    width: Number(word.width) * tile.width,
    height: Number(word.height) * tile.height,
    unit: "pdf-point",
    origin: "bottom-left",
  };
}

function overlaps(left, right) {
  const w = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x);
  const h = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.min(left.width * left.height || 1, right.width * right.height || 1);
}

export function dedupeOcrWords(words) {
  const kept = [];
  const sorted = [...words].sort((left, right) => Number(right.confidence) - Number(left.confidence));
  for (const word of sorted) {
    const text = String(word.text || "").replace(/\s+/g, " ").trim();
    if (!text || Number(word.confidence) < OCR_KEEP) continue;
    const duplicate = kept.some((other) => other.text === text && overlaps(word.box, other.box) >= 0.5);
    if (duplicate) continue;
    kept.push({ ...word, text });
  }
  return kept;
}

export function inkOccupancy(image, width, height, box, pageWidth, pageHeight) {
  const scaleX = width / pageWidth;
  const scaleY = height / pageHeight;
  const left = Math.max(0, Math.floor(box.x * scaleX));
  const right = Math.min(width, Math.ceil((box.x + box.width) * scaleX));
  const top = Math.max(0, Math.floor((pageHeight - box.y - box.height) * scaleY));
  const bottom = Math.min(height, Math.ceil((pageHeight - box.y) * scaleY));
  if (right <= left || bottom <= top) return { sampled: 0, ink: 0, ratio: 0 };
  const data = image.data;
  let sampled = 0;
  let ink = 0;
  for (let y = top; y < bottom; y += 2) {
    for (let x = left; x < right; x += 2) {
      const offset = (y * width + x) * 4;
      sampled += 1;
      if (data[offset] < 245 || data[offset + 1] < 245 || data[offset + 2] < 245) ink += 1;
    }
  }
  return { sampled, ink, ratio: sampled ? Math.round((ink / sampled) * 1000) / 1000 : 0 };
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
  return { png: Buffer.from(surface.toBuffer("image/png")), pixelWidth: pixelW, pixelHeight: pixelH, image: context.getImageData(0, 0, pixelW, pixelH) };
}

export async function recoverPdfPage(page, pdfjs, options = {}) {
  const canvas = require("@napi-rs/canvas");
  const view = page.view || [0, 0, 0, 0];
  const pageWidth = view[2] - view[0];
  const pageHeight = view[3] - view[1];
  const ops = await page.getOperatorList();
  const opName = Object.fromEntries(Object.entries(pdfjs.OPS || {}).map(([name, value]) => [value, name]));
  const operators = operatorStats(ops.fnArray, opName);
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
  const tiles = tileBoxes(pageWidth, pageHeight);
  const rawWords = [];
  const tileOutcomes = [];
  let ocrAttempted = false;
  if (!engine && typeof options.ocr !== "function") {
    for (const tile of tiles) {
      tileOutcomes.push({ id: tile.id, status: "ocr_unavailable", words: 0 });
    }
  } else {
    ocrAttempted = true;
    for (const tile of tiles) {
      const scale = Math.min(TILE_MAX_PX / tile.width, TILE_MAX_PX / tile.height);
      try {
        const clip = await renderClip(page, canvas, pageHeight, tile, scale);
        const recognized = await recognizePng(clip.png, options);
        if (recognized.unavailable) {
          tileOutcomes.push({ id: tile.id, status: "ocr_unavailable", words: 0 });
          ocrAttempted = false;
          break;
        }
        if (recognized.failed) {
          tileOutcomes.push({ id: tile.id, status: "ocr_failed", words: 0 });
          continue;
        }
        let added = 0;
        for (const word of recognized.words || []) {
          const box = wordToPdfBox(tile, word);
          if (!box) continue;
          rawWords.push({
            text: word.text,
            confidence: Number(word.confidence),
            box: {
              ...box,
              pageWidth: round(pageWidth),
              pageHeight: round(pageHeight),
            },
            engine: recognized.engine,
            origin: "visual_interpretation",
            independentlyVerified: false,
          });
          added += 1;
        }
        tileOutcomes.push({ id: tile.id, status: "ocr_ok", words: added, engine: recognized.engine });
      } catch (error) {
        tileOutcomes.push({
          id: tile.id,
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
  const sheetTokens = [];
  for (const line of lines) {
    const token = correctedSheetToken(line.text.split(/\s+/)[0] || "") || correctedSheetToken(line.text);
    if (token && !sheetTokens.includes(token)) sheetTokens.push(token);
  }
  return {
    recoveryVersion: RECOVERY_VERSION,
    pageWidth: round(pageWidth),
    pageHeight: round(pageHeight),
    operators,
    engine: engine || (typeof options.ocr === "function" ? "injected" : null),
    ocrAttempted,
    tileOutcomes,
    rasterCells,
    words,
    lines,
    sheetTokens,
    ocrChars: words.reduce((sum, word) => sum + word.text.length, 0),
    ocrLineCount: lines.length,
  };
}

export async function recoverPdfFile(filePath, options = {}) {
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
        pages.push({ pageNumber, ...(await recoverPdfPage(page, pdfjs, options)) });
      } finally {
        page.cleanup?.();
      }
    }
    return { recoveryVersion: RECOVERY_VERSION, pageCount: pdf.numPages, pages };
  } finally {
    await pdf.destroy().catch(() => {});
  }
}
