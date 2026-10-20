"use strict";

/** First line of the OCR block in sheet text. Readers treat what follows as graphic text, not text-layer rows. */
const OCR_TEXT_HEADING = "GRAPHIC TEXT (OCR):";
/** A drawing index read from graphics, written as one line so a 1000-character chunk keeps it whole. */
const OCR_INDEX_HEADING = "INDEX OF SHEETS (OCR):";

const INDEX_TITLE_RE =
  /\b(drawing\s+index|sheet\s+index|index\s+of\s+(?:drawings|sheets)|drawings?\s+index|sheet\s+list|list\s+of\s+(?:drawings|sheets)|drawing\s+list|schedule\s+of\s+drawings)\b/i;
const SHEET_TOKEN_RE = /^[A-Z]{1,3}-?\d{1,4}(?:\.\d{1,2})?(?:-\d{1,2})?$/;
const MIN_INDEX_ROWS = 5;

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
 * Words in PDF points (bottom-left origin) grouped into reading lines. Words on the same
 * baseline but far apart stay separate lines, so table columns and notes do not merge.
 * @param {Array<{ text?: string; t?: string; confidence?: number; c?: number; box?: Record<string, number> }>} words
 * @returns {Array<{ text: string; box: { x: number; y: number; width: number; height: number }; confidence: number; words: number }>}
 */
function groupWordsIntoLines(words) {
  const items = [];
  for (const word of words || []) {
    const text = String(word?.text ?? word?.t ?? "").trim();
    const box = wordBox(word);
    if (!text || !box) continue;
    items.push({ text, box, confidence: Number(word?.confidence ?? word?.c) || 0 });
  }
  items.sort((a, b) => (b.box.y + b.box.height) - (a.box.y + a.box.height) || a.box.x - b.box.x);
  const lines = [];
  for (const item of items) {
    const center = item.box.y + item.box.height / 2;
    let best = null;
    let bestGap = Infinity;
    for (const line of lines) {
      const tolerance = 0.5 * Math.max(item.box.height, line.height);
      if (Math.abs(center - line.center) > tolerance) continue;
      const gap = item.box.x - line.right;
      const maxGap = Math.max(2.5 * Math.max(item.box.height, line.height), 12);
      if (gap > maxGap || item.box.x < line.left - item.box.height) continue;
      if (gap < bestGap) {
        best = line;
        bestGap = gap;
      }
    }
    if (!best) {
      lines.push({
        items: [item],
        left: item.box.x,
        right: item.box.x + item.box.width,
        top: item.box.y + item.box.height,
        bottom: item.box.y,
        center,
        height: item.box.height,
      });
      continue;
    }
    best.items.push(item);
    best.left = Math.min(best.left, item.box.x);
    best.right = Math.max(best.right, item.box.x + item.box.width);
    best.top = Math.max(best.top, item.box.y + item.box.height);
    best.bottom = Math.min(best.bottom, item.box.y);
    best.height = Math.max(best.height, item.box.height);
    best.center = (best.top + best.bottom) / 2;
  }
  return lines
    .map((line) => {
      const ordered = line.items.sort((a, b) => a.box.x - b.box.x);
      return {
        text: ordered.map((item) => item.text).join(" "),
        box: { x: line.left, y: line.bottom, width: line.right - line.left, height: line.top - line.bottom },
        confidence: Math.min(...ordered.map((item) => item.confidence)),
        words: ordered.length,
      };
    })
    .sort((a, b) => (b.box.y + b.box.height) - (a.box.y + a.box.height) || a.box.x - b.box.x);
}

const PREFIX_DIGIT_LETTER = { 5: "S", 6: "G", 8: "B" };

/**
 * Hand-lettered CAD fonts read "1" as I, "0" as O, S as 5, and G as 6. The numeric part and a
 * single leading prefix digit are corrected; a word such as "WALL" or "POOL" is never a sheet number.
 */
function correctedSheetToken(raw) {
  let token = String(raw || "").replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/gi, "").toUpperCase();
  const digitPrefix = token.match(/^([568])(-[0-9OI].*)$/);
  if (digitPrefix) token = `${PREFIX_DIGIT_LETTER[digitPrefix[1]]}${digitPrefix[2]}`;
  if (SHEET_TOKEN_RE.test(token) && /\d/.test(token)) return token;
  for (let size = 1; size <= 3; size += 1) {
    const prefix = token.slice(0, size);
    const rest = token.slice(size);
    if (!/^[A-Z]+$/.test(prefix) || !rest) continue;
    const separator = /^[-.]/.test(rest) ? rest[0] : "";
    const body = rest.slice(separator.length);
    if (!/^[0-9OIL|][0-9OIL|.-]*$/.test(body)) continue;
    const printed = /\d/.test(body) || separator;
    if (!printed && !/^[OI]{3,}$/.test(body)) continue;
    const fixed = `${prefix}${separator}${body.replace(/O/g, "0").replace(/[IL|]/g, "1")}`;
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
