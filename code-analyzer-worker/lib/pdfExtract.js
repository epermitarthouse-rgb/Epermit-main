"use strict";

const fs = require("fs/promises");
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
const { MIN_PAGE_TEXT_CHARS } = require("./chunk");

const PDF_POINTS_PER_INCH = 72;

/**
 * Inches from the page pdf.js will rasterize.
 * `page.view` is the CropBox ∩ MediaBox (MediaBox when there is no CropBox);
 * getViewport applies /Rotate. UserUnit scales the default user space (PDF 1.6).
 */
function readPdfPageSizeInches(page) {
  const userUnit = typeof page.userUnit === "number" && page.userUnit > 0 ? page.userUnit : 1;
  const viewport = page.getViewport({ scale: 1 });
  const widthInches = (viewport.width * userUnit) / PDF_POINTS_PER_INCH;
  const heightInches = (viewport.height * userUnit) / PDF_POINTS_PER_INCH;
  return { widthInches, heightInches };
}

function normalizeWhitespace(text) {
  return text.replace(/\s+/g, " ").trim();
}

async function extractPageText(page) {
  const textContent = await page.getTextContent();
  const parts = textContent.items.map((item) => ("str" in item ? item.str : ""));
  return normalizeWhitespace(parts.join(" "));
}

async function* extractPdfPagesFromFile(filePath, onPageStart) {
  const buffer = await fs.readFile(filePath);
  const data = new Uint8Array(buffer);
  const loadingTask = pdfjsLib.getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
  });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;

  try {
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      if (onPageStart) onPageStart(pageNum, totalPages);
      const page = await pdf.getPage(pageNum);
      try {
        const text = await extractPageText(page);
        const size = readPdfPageSizeInches(page);
        yield {
          pageNumber: pageNum,
          text,
          lowText: text.length < MIN_PAGE_TEXT_CHARS,
          widthInches: size.widthInches,
          heightInches: size.heightInches,
        };
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await pdf.destroy();
  }
}

module.exports = { extractPdfPagesFromFile, readPdfPageSizeInches, PDF_POINTS_PER_INCH };
