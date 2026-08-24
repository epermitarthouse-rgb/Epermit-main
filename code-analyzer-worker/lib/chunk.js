"use strict";

const MIN_PAGE_TEXT_CHARS = 40;
const MAX_CHUNK_CHARS = 1500;
const CHUNK_OVERLAP = 200;

/** Generic architectural/equipment sheet labels (A-1.04, EQ-2.00, S-201.00, etc.) */
const SHEET_LABEL_RE = /\b([A-Z]{1,4}-\d+(?:\.\d+)*)\b/g;

function detectSheetLabel(text) {
  const matches = [...text.matchAll(SHEET_LABEL_RE)];
  if (matches.length === 0) return null;
  return matches[0]?.[1] ?? null;
}

function detectSheetTitle(text, sheetLabel) {
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 12)) {
    if (line.length < 10 || line.length > 120) continue;
    if (sheetLabel && line.includes(sheetLabel)) continue;
    const letters = line.replace(/[^A-Za-z]/g, "");
    if (letters.length < 6) continue;
    const upperCount = [...letters].filter((c) => c === c.toUpperCase() && c !== c.toLowerCase()).length;
    if (upperCount / letters.length >= 0.65) {
      return line.slice(0, 120);
    }
  }
  return null;
}

function chunkPage(page) {
  const sheetLabel = detectSheetLabel(page.text);
  const sheetTitle = detectSheetTitle(page.text, sheetLabel);
  const baseMeta = {
    low_text: page.lowText,
  };

  if (!page.text || page.text.length === 0) {
    return [];
  }

  if (page.text.length <= MAX_CHUNK_CHARS) {
    return [{
      pageNumber: page.pageNumber,
      chunkIndex: 0,
      chunkText: page.text,
      sheetLabel,
      sheetTitle,
      metadata: baseMeta,
    }];
  }

  const chunks = [];
  let start = 0;
  let chunkIndex = 0;

  while (start < page.text.length) {
    const end = Math.min(start + MAX_CHUNK_CHARS, page.text.length);
    chunks.push({
      pageNumber: page.pageNumber,
      chunkIndex,
      chunkText: page.text.slice(start, end),
      sheetLabel,
      sheetTitle,
      metadata: { ...baseMeta, split: true },
    });
    chunkIndex++;
    if (end >= page.text.length) break;
    start = Math.max(0, end - CHUNK_OVERLAP);
  }

  return chunks;
}

function vectorToPg(embedding) {
  return `[${embedding.join(",")}]`;
}

module.exports = {
  chunkPage,
  vectorToPg,
  MIN_PAGE_TEXT_CHARS,
};
