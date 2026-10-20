"use strict";

/**
 * Standalone OCR report for drawing PDFs: the same comprehension path the worker runs.
 *
 *   node scripts/ocr-sheet-report.js <out.json> <file.pdf> [file.pdf ...]
 *
 * Reports, per sheet: the OCR engine and version, graphic read status, text-layer item count,
 * OCR line count, index rows, and the composed sheet text. No model call is made.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { comprehendPdfPage } = require("../lib/comprehension.js");

function engineVersion() {
  if (process.platform === "darwin") return { engine: "macos-vision", version: null };
  const probe = spawnSync("tesseract", ["--version"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) return { engine: null, version: null };
  return { engine: "tesseract", version: String(probe.stdout || probe.stderr).split("\n")[0].trim() };
}

async function main() {
  const [out, ...files] = process.argv.slice(2);
  if (!out || !files.length) {
    console.error("usage: node scripts/ocr-sheet-report.js <out.json> <file.pdf> [...]");
    process.exit(2);
  }
  const report = { ...engineVersion(), sheets: [] };
  for (const file of files) {
    const started = Date.now();
    let page;
    try {
      page = await comprehendPdfPage(file, 1, { render: false });
    } catch (error) {
      report.sheets.push({ fileName: path.basename(file), error: error.message, ms: Date.now() - started });
      console.error(`${path.basename(file)}: failed: ${error.message}`);
      continue;
    }
    const textItems = page.items.filter((item) => item.extractionMethod === "pdfjs-text-layer").length;
    report.sheets.push({
      fileName: path.basename(file),
      textItems,
      graphicalReadStatus: page.graphicalReadStatus,
      ocrLineCount: page.ocrLineCount,
      indexRows: page.indexRows.map((row) => row.sheetNumber),
      ocrLines: page.ocrLines || [],
      text: page.text,
      ms: Date.now() - started,
    });
    console.error(`${path.basename(file)}: ${page.graphicalReadStatus}, ${page.ocrLineCount} OCR lines, ${page.indexRows.length} index rows, ${Date.now() - started} ms`);
  }
  fs.writeFileSync(out, JSON.stringify(report, null, 1));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
