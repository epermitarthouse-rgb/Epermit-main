"use strict";

const fs = require("fs/promises");
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
const { MIN_PAGE_TEXT_CHARS } = require("./chunk");

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
        yield { pageNumber: pageNum, text, lowText: text.length < MIN_PAGE_TEXT_CHARS };
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await pdf.destroy();
  }
}

module.exports = { extractPdfPagesFromFile };
