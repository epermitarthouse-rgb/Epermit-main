"use strict";

/** First line of the OCR block in sheet text. Readers treat what follows as graphic text, not text-layer rows. */
const OCR_TEXT_HEADING = "GRAPHIC TEXT (OCR):";
/** A drawing index read from graphics, written as one line so a 1000-character chunk keeps it whole. */
const OCR_INDEX_HEADING = "INDEX OF SHEETS (OCR):";

const INDEX_TITLE_RE =
  /\b(drawing\s+index|sheet\s+index|index\s+of\s+(?:drawings|sheets)|drawings?\s+index|sheet\s+list|list\s+of\s+(?:drawings|sheets)|drawing\s+list|schedule\s+of\s+drawings)\b/i;
const SHEET_TOKEN_RE = /^[A-Z]{1,3}-?\d{1,4}(?:\.\d{1,2})?(?:-\d{1,2})?$/;
const MIN_INDEX_ROWS = 5;

/** Cyrillic and Greek capitals OCR returns for Latin letters ("Е-4.3" with a Cyrillic E). */
const HOMOGLYPHS = {
  "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H", "О": "O", "Р": "P", "С": "C", "Т": "T", "Х": "X", "Ѕ": "S", "І": "I", "Ј": "J",
  "Α": "A", "Β": "B", "Ε": "E", "Ζ": "Z", "Η": "H", "Ι": "I", "Κ": "K", "Μ": "M", "Ν": "N", "Ο": "O", "Ρ": "P", "Τ": "T", "Υ": "Y", "Χ": "X",
};
const HOMOGLYPH_RE = new RegExp(`[${Object.keys(HOMOGLYPHS).join("")}]`, "g");

function foldHomoglyphs(text) {
  return String(text || "").replace(HOMOGLYPH_RE, (char) => HOMOGLYPHS[char]);
}

function wordBox(word) {
  const box = word?.box || word;
  const x = Number(box?.x);
  const y = Number(box?.y);
  const width = Number(box?.width ?? box?.w) || 0;
  const height = Number(box?.height ?? box?.h) || 0;
  if (!Number.isFinite(x) || !Number.isFinite(y) || height <= 0) return null;
  return { x, y, width, height };
}

/**
 * Rotated drawing text (dimension strings, vertical labels) has a box much taller than wide.
 * Its glyph size is the box width, not the height.
 */
function isVertical(text, box) {
  return text.replace(/\s/g, "").length >= 2 && box.height > 1.6 * box.width;
}

/**
 * Reading-axis view of a box: `along` runs with the text, `across` is the glyph size.
 * Horizontal text reads left to right; vertical text reads bottom to top (90° CAD rotation).
 */
function axes(box, vertical) {
  return vertical
    ? { start: box.y, end: box.y + box.height, low: box.x, high: box.x + box.width, size: box.width }
    : { start: box.x, end: box.x + box.width, low: box.y, high: box.y + box.height, size: box.height };
}

/**
 * Words in PDF points (bottom-left origin) grouped into reading lines. Words join only when
 * they share an orientation, sit on the same baseline, and are close along it, so table
 * columns, stacked labels, and rotated dimension strings stay separate lines.
 * @param {Array<{ text?: string; t?: string; confidence?: number; c?: number; box?: Record<string, number> }>} words
 * @returns {Array<{ text: string; box: { x: number; y: number; width: number; height: number }; confidence: number; words: number; vertical: boolean }>}
 */
function groupWordsIntoLines(words) {
  const items = [];
  for (const word of words || []) {
    const text = foldHomoglyphs(word?.text ?? word?.t ?? "").trim();
    const box = wordBox(word);
    if (!text || !box) continue;
    const vertical = isVertical(text, box);
    items.push({ text, box, vertical, axis: axes(box, vertical), confidence: Number(word?.confidence ?? word?.c) || 0 });
  }
  items.sort((a, b) => Number(a.vertical) - Number(b.vertical)
    || (b.box.y + b.box.height) - (a.box.y + a.box.height) || a.box.x - b.box.x);
  const lines = [];
  for (const item of items) {
    const { axis } = item;
    const center = (axis.low + axis.high) / 2;
    let best = null;
    let bestGap = Infinity;
    for (const line of lines) {
      if (line.vertical !== item.vertical) continue;
      const size = Math.max(axis.size, line.size);
      if (Math.abs(center - (line.low + line.high) / 2) > 0.5 * size) continue;
      const gap = axis.start >= line.end ? axis.start - line.end : line.start - axis.end;
      if (gap > Math.max(2.5 * size, 12) || gap < -size) continue;
      if (gap < bestGap) {
        best = line;
        bestGap = gap;
      }
    }
    if (!best) {
      lines.push({ items: [item], vertical: item.vertical, ...axis });
      continue;
    }
    best.items.push(item);
    best.start = Math.min(best.start, axis.start);
    best.end = Math.max(best.end, axis.end);
    best.low = Math.min(best.low, axis.low);
    best.high = Math.max(best.high, axis.high);
    best.size = Math.max(best.size, axis.size);
  }
  return lines
    .map((line) => {
      const ordered = line.items.sort((a, b) => a.axis.start - b.axis.start);
      const left = Math.min(...ordered.map((item) => item.box.x));
      const bottom = Math.min(...ordered.map((item) => item.box.y));
      const right = Math.max(...ordered.map((item) => item.box.x + item.box.width));
      const top = Math.max(...ordered.map((item) => item.box.y + item.box.height));
      return {
        text: ordered.map((item) => item.text).join(" "),
        box: { x: left, y: bottom, width: right - left, height: top - bottom },
        confidence: Math.min(...ordered.map((item) => item.confidence)),
        words: ordered.length,
        vertical: line.vertical,
      };
    })
    .sort((a, b) => (b.box.y + b.box.height) - (a.box.y + a.box.height) || a.box.x - b.box.x);
}

const PREFIX_DIGIT_LETTER = { 4: "A", 5: "S", 6: "G", 8: "B" };

/**
 * Hand-lettered CAD fonts read "1" as I, "0" as O or an open C, S as 5, and G as 6. The numeric
 * part and a single leading prefix digit are corrected; a word such as "WALL" or "POOL" is never
 * a sheet number. C counts as 0 only after the first numeric character ("FP30C", "E-1.3-C").
 */
function correctedSheetToken(raw) {
  const trimmed = foldHomoglyphs(raw).trim();
  let token = trimmed.replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/gi, "").toUpperCase();
  // ".6-00" is the tail of "P-1.6-00", not sheet G-00: only a token that starts with the digit is corrected.
  const digitPrefix = token === trimmed.replace(/[^A-Z0-9]+$/gi, "").toUpperCase() && token.match(/^([4568])(-[0-9OI].*)$/);
  if (digitPrefix) token = `${PREFIX_DIGIT_LETTER[digitPrefix[1]]}${digitPrefix[2]}`;
  if (SHEET_TOKEN_RE.test(token) && /\d/.test(token)) return token;
  for (let size = 1; size <= 3; size += 1) {
    const prefix = token.slice(0, size);
    const rest = token.slice(size);
    if (!/^[A-Z]+$/.test(prefix) || !rest) continue;
    const separator = /^[-.]/.test(rest) ? rest[0] : "";
    const body = rest.slice(separator.length);
    if (!/^[0-9OIL|][0-9OIL|C.-]*$/.test(body)) continue;
    const printed = /\d/.test(body) || separator;
    if (!printed && !/^[OI]{3,}$/.test(body)) continue;
    const fixed = `${prefix}${separator}${body.replace(/[OC]/g, "0").replace(/[IL|]/g, "1")}`;
    if (SHEET_TOKEN_RE.test(fixed)) return fixed;
  }
  return null;
}

function leadingSheetToken(text) {
  return correctedSheetToken(String(text || "").trim().split(/\s+/)[0] || "");
}

/**
 * Index rows read from graphic text: lines that start with a sheet number and stand in one
 * left-aligned column of at least five rows. A lone title-block sheet number is not a row.
 * @param {Array<{ text: string; box: { x: number; y: number; width: number; height: number } }>} lines
 */
function indexRowsFromLines(lines, { minRows = MIN_INDEX_ROWS } = {}) {
  const candidates = [];
  for (const line of lines || []) {
    const sheetNumber = leadingSheetToken(line.text);
    if (!sheetNumber) continue;
    const title = line.text.trim().split(/\s+/).slice(1).join(" ").trim() || null;
    candidates.push({ sheetNumber, title, box: line.box });
  }
  const columns = [];
  for (const row of candidates) {
    const tolerance = Math.max(18, 2 * row.box.height);
    const column = columns.find((existing) => Math.abs(existing.x - row.box.x) <= tolerance);
    if (column) column.rows.push(row);
    else columns.push({ x: row.box.x, rows: [row] });
  }
  const rows = [];
  const seen = new Set();
  for (const column of columns.filter((item) => item.rows.length >= minRows)) {
    for (const row of column.rows.sort((a, b) => b.box.y - a.box.y)) {
      if (seen.has(row.sheetNumber)) continue;
      seen.add(row.sheetNumber);
      rows.push(row);
    }
  }
  return rows;
}

function pageIsTitledIndex(lines, textLayer = "") {
  return INDEX_TITLE_RE.test(textLayer) || (lines || []).some((line) => INDEX_TITLE_RE.test(line.text));
}

/**
 * One line a text parser can read. Null when the page is not an index or no column of rows
 * was found. Rows from a high-resolution re-read come first; tile rows fill what it missed.
 */
function declaredIndexLine(lines, textLayer = "", indexLines = []) {
  if (!pageIsTitledIndex([...(lines || []), ...(indexLines || [])], textLayer)) return null;
  const rows = [];
  const seen = new Set();
  for (const row of [...indexRowsFromLines(indexLines), ...indexRowsFromLines(lines)]) {
    if (seen.has(row.sheetNumber)) continue;
    seen.add(row.sheetNumber);
    rows.push(row);
  }
  if (rows.length < MIN_INDEX_ROWS) return null;
  return { text: `${OCR_INDEX_HEADING} ${rows.map((row) => row.sheetNumber).join(" ")}`, rows };
}

function normalizedWords(text) {
  return String(text || "").toLowerCase().match(/[a-z0-9][a-z0-9.'"-]*/g) || [];
}

/**
 * OCR lines that add text the PDF text layer does not already contain. A line whose words
 * all appear in the text layer is a duplicate of selectable text.
 */
function novelLines(lines, textLayer) {
  const known = new Set(normalizedWords(textLayer));
  return (lines || []).filter((line) => normalizedWords(line.text).some((word) => !known.has(word)));
}

/**
 * Sheet text: a declared index line first (so the first chunk keeps it), then the text layer,
 * then every confident OCR line under one heading.
 */
function composeSheetText(textLayer, lines, indexLines = []) {
  const index = declaredIndexLine(lines, textLayer, indexLines);
  const extra = novelLines(lines, textLayer).map((line) => line.text);
  return {
    text: [
      index ? index.text : "",
      textLayer || "",
      extra.length ? [OCR_TEXT_HEADING, ...extra].join("\n") : "",
    ].filter(Boolean).join("\n"),
    indexRows: index ? index.rows.map((row) => ({ sheetNumber: row.sheetNumber, title: row.title, box: row.box })) : [],
    ocrLineCount: extra.length,
  };
}

module.exports = {
  OCR_TEXT_HEADING,
  OCR_INDEX_HEADING,
  groupWordsIntoLines,
  indexRowsFromLines,
  declaredIndexLine,
  pageIsTitledIndex,
  novelLines,
  composeSheetText,
  correctedSheetToken,
};
