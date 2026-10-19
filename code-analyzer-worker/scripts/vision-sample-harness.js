"use strict";

/**
 * Isolated harness for five permit sheets.
 *
 * Explicit General IBC: one ibc job per sheet. DC amendments are not a second mode.
 * The full folder is the retrieval context when this is later allowed to index text.
 * It does not call OpenAI. SEND_ENABLED is false until a later approved turn flips it.
 * CODE_ANALYZER_DRAWING_RAG_PERSIST is forced off. Nothing is written to Supabase.
 *
 * Dry run (the only path this commit will take):
 *   node scripts/vision-sample-harness.js
 */

const fs = require("fs");
const path = require("path");
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");

const SEND_ENABLED = false;
const FOLDER = "/Users/javerianaveed/Desktop/008-0003 New York Ave Wash DC_PERMIT REV5 SET_2026-10-15_Individual";
const SHEETS = ["A-1.00-00.pdf", "A-3.02-00.pdf", "E-2.1-00.pdf", "EQ-1.00-0.pdf", "P-3.0-00.pdf"];
const RASTER_DPI = Number(process.env.CODE_ANALYZER_RASTER_DPI) || 150;
const OUT_DIR = path.join(__dirname, "..", "tmp-vision-harness");

delete process.env.CODE_ANALYZER_DRAWING_RAG_PERSIST;

function highDetailTokens(width, height) {
  let w = width;
  let h = height;
  const fit = Math.min(1, 2048 / Math.max(w, h));
  w *= fit;
  h *= fit;
  const short = Math.min(w, h);
  if (short > 768) {
    const scale = 768 / short;
    w *= scale;
    h *= scale;
  }
  const tiles = Math.ceil(w / 512) * Math.ceil(h / 512);
  return 85 + 170 * tiles;
}

async function pagePoints(filePath) {
  const buffer = await fs.promises.readFile(filePath);
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer), disableFontFace: true }).promise;
  try {
    const page = await pdf.getPage(1);
    try {
      const viewport = page.getViewport({ scale: 1 });
      return { width: viewport.width, height: viewport.height, pages: pdf.numPages };
    } finally {
      page.cleanup();
    }
  } finally {
    await pdf.destroy();
  }
}

async function main() {
  if (process.env.CODE_ANALYZER_VISION_HARNESS_SEND === "1" || process.env.CODE_ANALYZER_VISION_HARNESS_CONFIRM === "1") {
    if (!SEND_ENABLED) {
      console.error("Refusing to call the API. SEND_ENABLED is false until the budget is approved.");
      process.exit(2);
    }
  }

  const names = fs.readdirSync(FOLDER).filter((name) => name.toLowerCase().endsWith(".pdf"));
  const sheets = [];
  for (const fileName of SHEETS) {
    const filePath = path.join(FOLDER, fileName);
    if (!fs.existsSync(filePath)) throw new Error(`Missing sample sheet ${fileName}`);
    const box = await pagePoints(filePath);
    const pixels = {
      width: Math.ceil((box.width / 72) * RASTER_DPI),
      height: Math.ceil((box.height / 72) * RASTER_DPI),
    };
    sheets.push({
      fileName,
      points: box,
      rasterDpi: RASTER_DPI,
      rasterPixels: pixels,
      fullSheetHighDetailTokens: highDetailTokens(pixels.width, pixels.height),
      crops: 2,
      cropDetail: "low",
      cropTokens: 85 * 2,
    });
  }

  const plan = {
    jurisdiction: "general",
    amendmentsEnforced: false,
    analysisModes: ["ibc"],
    calls: sheets.length,
    retryWorstCaseCalls: sheets.length * 2,
    retrievalFolderPdfCount: names.length,
    persist: false,
    api: "not called",
    outputDirWhenApproved: OUT_DIR,
    sheets,
  };
  console.log(JSON.stringify(plan, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
