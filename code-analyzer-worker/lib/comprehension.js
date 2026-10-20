"use strict";

const crypto = require("crypto");
const fs = require("fs/promises");
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
const { ocrEngine, recognizePng } = require("./ocr.js");
const {
  composeSheetText,
  correctedSheetToken,
  groupWordsIntoLines,
  indexRowsFromLines,
  pageIsTitledIndex,
} = require("./ocrLines.js");

const MAX_REGIONS = 6;
const MAX_GRAPHIC_REGIONS = 8;
const MAX_REGION_IMAGES = 2;
const TILE_MAX_PX = 1700;
/** Tesseract needs about 20 px per capital to read small CAD lettering; Vision reads it at 1700. */
const TILE_MAX_PX_BY_ENGINE = { tesseract: 2600 };
const CROP_MAX_PX = 1200;
const OCR_CONFIDENCE_MIN = 0.45;
const GRAPHIC_INTEREST_RE =
  /\bone\s+hours?\b|\b1\s*h\b|\b\d+\s*-?\s*(?:hour|hr)\b|fire\s*rated|partition|legend|schedule|emergency|wall\s*type|gfci|water[\s-]*hammer|draft[\s-]*stop|\d+\s*(?:["″]|ft|')/i;
const INTEREST_RE =
  /\d|hr\b|hour|note|legend|schedule|a\.?\s*f\.?\s*f|gfci|exit|wall\s*type|partition|detail|emergency|hammer|draft[\s-]*stop/i;

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * PDF user-space box plus a top-left normalized box for the viewer.
 * Returned only when the text item has a real transform.
 * @param {{ transform?: number[]; width?: number; height?: number }} item
 * @param {number} pageWidth
 * @param {number} pageHeight
 */
function boxFromTextItem(item, pageWidth, pageHeight) {
  const transform = item?.transform || [];
  const x = Number(transform[4]);
  const y = Number(transform[5]);
  const width = Number(item?.width) || 0;
  const height = Number(item?.height) || Math.abs(Number(transform[3])) || 0;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !(pageWidth > 0) || !(pageHeight > 0)) return null;
  if (width <= 0 && height <= 0) return null;
  return {
    x,
    y,
    width,
    height,
    unit: "pdf-point",
    origin: "bottom-left",
    pageWidth,
    pageHeight,
    normalized: {
      x: clamp01(x / pageWidth),
      y: clamp01(1 - (y + height) / pageHeight),
      width: clamp01(width / pageWidth),
      height: clamp01(height / pageHeight),
      origin: "top-left",
    },
  };
}

function reasonFor(text) {
  if (/\bone\s+hours?\b|\b[1I]\s*h(?:r)?\b|\b\d+\s*-?\s*(?:hour|hr)\b/i.test(text)) return "rating";
  if (/\d/.test(text) && /["″]|in(?:ch)?|ft|'/i.test(text)) return "dimension";
  if (/legend|wall\s*type|partition|fire\s*rated/i.test(text)) return "legend";
  if (/schedule/i.test(text)) return "schedule";
  if (/note|shall|provide|gfci|emergency|hammer|draft/i.test(text)) return "note";
  if (/detail|callout|elevation/i.test(text)) return "detail";
  return "tag";
}

/**
 * Map a bottom-left normalized word box inside a PDF tile back to page points.
 * @param {{ x: number; y: number; width: number; height: number }} tile
 * @param {{ x: number; y: number; width: number; height: number }} word
 */
function pdfBoxFromNormalized(tile, word) {
  return {
    x: tile.x + Number(word.x) * tile.width,
    y: tile.y + Number(word.y) * tile.height,
    width: Number(word.width) * tile.width,
    height: Number(word.height) * tile.height,
  };
}

function withNormalized(box, pageWidth, pageHeight) {
  const width = Number(box.width) || 0;
  const height = Number(box.height) || 0;
  const x = Number(box.x) || 0;
  const y = Number(box.y) || 0;
  return {
    ...box,
    x,
    y,
    width,
    height,
    unit: "pdf-point",
    origin: "bottom-left",
    pageWidth,
    pageHeight,
    normalized: {
      x: clamp01(x / pageWidth),
      y: clamp01(1 - (y + height) / pageHeight),
      width: clamp01(width / pageWidth),
      height: clamp01(height / pageHeight),
      origin: "top-left",
    },
  };
}

function tileBoxes(pageWidth, pageHeight) {
  const columns = pageWidth >= 2000 ? 3 : 2;
  const rows = pageHeight >= 1200 ? 2 : 1;
  const tileW = pageWidth / columns;
  const tileH = pageHeight / rows;
  // Tiles overlap so a label on a seam ("1H ONE HOUR FIRE RATED WALLS") is read whole by one tile.
  const overlapX = tileW * 0.06;
  const overlapY = tileH * 0.06;
  const boxes = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const x = Math.max(0, col * tileW - overlapX);
      const y = Math.max(0, pageHeight - (row + 1) * tileH - overlapY);
      boxes.push({
        x,
        y,
        width: Math.min(pageWidth, (col + 1) * tileW + overlapX) - x,
        height: Math.min(pageHeight, pageHeight - row * tileH + overlapY) - y,
      });
    }
  }
  return boxes.slice(0, 6);
}

function scaleForBox(box, maxPx) {
  const longest = Math.max(Number(box.width) || 0, Number(box.height) || 0);
  if (!(longest > 0)) return 1;
  return Math.max(0.5, Math.min(4, maxPx / longest));
}

/**
 * A drawing-size page. Its graphic text is read even when the text layer is dense: a dense layer
 * can still leave legends, tags, rotated dimensions, and stamped notes only in the linework.
 */
function isDrawingPage(pageWidth, pageHeight) {
  return pageWidth > 1000 && pageHeight > 700;
}

/**
 * Full-sheet pixels per inch. Crops are attached when this is too coarse to read tags.
 * @param {number} imageWidth
 * @param {number} imageHeight
 * @param {number} pageWidth
 * @param {number} pageHeight
 */
function shouldAttachRegionImages(imageWidth, imageHeight, pageWidth, pageHeight) {
  const widthIn = pageWidth / 72;
  const heightIn = pageHeight / 72;
  if (!(imageWidth > 0) || !(imageHeight > 0) || !(widthIn > 0) || !(heightIn > 0)) return true;
  const dpi = Math.min(imageWidth / widthIn, imageHeight / heightIn);
  return dpi < 120;
}

function boxesNear(a, b) {
  const gap = 12;
  return Math.abs(a.x - b.x) < gap + a.width && Math.abs(a.y - b.y) < gap + a.height;
}

/**
 * Selective regions. Never slices the page into a grid.
 * @param {Array<{ str?: string; region?: Record<string, unknown> | null }>} items
 * @param {{ pageWidth: number; pageHeight: number }} page
 */
function selectInspectionRegions(items, page) {
  const pageArea = page.pageWidth * page.pageHeight;
  /** @type {Array<Record<string, unknown>>} */
  const boxes = [];
  for (const item of items || []) {
    const text = String(item.str || "").trim();
    if (!text || !INTEREST_RE.test(text) || !item.region) continue;
    const region = item.region;
    const area = Number(region.width) * Number(region.height);
    if (pageArea && area > pageArea * 0.2) continue;
    boxes.push({ ...region, quote: text.slice(0, 160), reason: reasonFor(text) });
  }

  /** @type {Array<Record<string, unknown>>} */
  const merged = [];
  for (const box of boxes) {
    const neighbor = merged.find((existing) => boxesNear(existing, box) && existing.reason === box.reason);
    if (!neighbor) {
      merged.push({ ...box });
      continue;
    }
    const x = Math.min(neighbor.x, box.x);
    const y = Math.min(neighbor.y, box.y);
    neighbor.width = Math.max(neighbor.x + neighbor.width, box.x + box.width) - x;
    neighbor.height = Math.max(neighbor.y + neighbor.height, box.y + box.height) - y;
    neighbor.x = x;
    neighbor.y = y;
    if (String(neighbor.quote || "").length < String(box.quote || "").length) neighbor.quote = box.quote;
  }

  const rank = { rating: 5, dimension: 4, legend: 3, note: 3, schedule: 2, detail: 2, tag: 1 };
  merged.sort((a, b) => (rank[b.reason] || 0) - (rank[a.reason] || 0));
  return merged.slice(0, MAX_REGIONS);
}

const graphicCache = new Map();

/** Keyed by file content: each job downloads the same PDF to a new temp path. */
function cacheKey(buffer, pageNumber) {
  return `${crypto.createHash("sha1").update(buffer).digest("hex")}:${pageNumber}`;
}

/**
 * Render one PDF rectangle from the original page. The canvas is only the crop.
 * @param {import("pdfjs-dist").PDFPageProxy} page
 * @param {{ x: number; y: number; width: number; height: number; pageWidth?: number; pageHeight?: number }} region
 * @param {number} scale
 */
async function renderPdfClip(page, region, scale, maxPx = CROP_MAX_PX) {
  let createCanvas;
  try {
    ({ createCanvas } = require("canvas"));
  } catch {
    return null;
  }
  const pageHeight = Number(region.pageHeight) || page.getViewport({ scale: 1 }).height;
  const pad = 12;
  const x = Math.max(0, Number(region.x) - pad);
  const y = Math.max(0, Number(region.y) - pad);
  const widthPt = Math.max(1, Number(region.width) + pad * 2);
  const heightPt = Math.max(1, Number(region.height) + pad * 2);
  const pixelW = Math.max(8, Math.min(maxPx, Math.ceil(widthPt * scale)));
  const pixelH = Math.max(8, Math.min(maxPx, Math.ceil(heightPt * scale)));
  const usedScale = Math.min(scale, pixelW / widthPt, pixelH / heightPt);
  const canvas = createCanvas(Math.max(8, Math.ceil(widthPt * usedScale)), Math.max(8, Math.ceil(heightPt * usedScale)));
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const viewport = page.getViewport({ scale: usedScale });
  const left = x * usedScale;
  const top = (pageHeight - y - heightPt) * usedScale;
  await page.render({
    canvasContext: context,
    viewport,
    transform: [1, 0, 0, 1, -left, -top],
  }).promise;
  return {
    png: canvas.toBuffer("image/png"),
    pixelWidth: canvas.width,
    pixelHeight: canvas.height,
    scale: usedScale,
    clip: { x, y, width: canvas.width / usedScale, height: canvas.height / usedScale },
  };
}

function wordToPdfBox(tile, word, pixelWidth, pixelHeight) {
  if (word.origin === "top-left-px" && pixelWidth > 0 && pixelHeight > 0) {
    const x = tile.x + (Number(word.left) / pixelWidth) * tile.width;
    const topPt = tile.y + tile.height - (Number(word.top) / pixelHeight) * tile.height;
    const height = (Number(word.height) / pixelHeight) * tile.height;
    return {
      x,
      y: topPt - height,
      width: (Number(word.width) / pixelWidth) * tile.width,
      height,
    };
  }
  return pdfBoxFromNormalized(tile, word);
}

/**
 * @param {import("pdfjs-dist").PDFPageProxy} page
 * @param {number} pageWidth
 * @param {number} pageHeight
 * @param {{ ocr?: Function }} options
 */
/**
 * Tesseract word boxes from an image rotated 90° clockwise, mapped back to the unrotated image.
 * Text that reads bottom to top (rotated CAD dimensions and labels) is horizontal there.
 */
function unrotatedWord(word, originalHeight) {
  return {
    ...word,
    left: Number(word.top),
    top: originalHeight - (Number(word.left) + Number(word.width)),
    width: Number(word.height),
    height: Number(word.width),
    rotated: true,
  };
}

function overlapsAny(box, boxes) {
  return boxes.some((other) => {
    const w = Math.min(box.x + box.width, other.x + other.width) - Math.max(box.x, other.x);
    const h = Math.min(box.y + box.height, other.y + other.height) - Math.max(box.y, other.y);
    return w > 0 && h > 0 && w * h >= 0.5 * Math.min(box.width * box.height, other.width * other.height);
  });
}

/**
 * Tesseract's sparse-text mode does not read rotated text, so each tile is also read rotated;
 * only words that are vertical on the sheet are kept from that pass.
 */
async function rotatedTesseractWords(rendered, options) {
  let sharp;
  try {
    sharp = require("sharp");
  } catch {
    return [];
  }
  const png = await sharp(rendered.png).rotate(90).png().toBuffer().catch(() => null);
  if (!png) return [];
  const recognized = await recognizePng(png, options);
  if (recognized.unavailable || recognized.failed) return [];
  return (recognized.words || [])
    .filter((word) => word.origin === "top-left-px" && String(word.text || "").replace(/\s/g, "").length >= 2)
    .map((word) => unrotatedWord(word, rendered.pixelHeight));
}

async function discoverGraphicalRegions(page, pageWidth, pageHeight, options) {
  const tiles = tileBoxes(pageWidth, pageHeight);
  const engine = ocrEngine(options);
  const tileMaxPx = TILE_MAX_PX_BY_ENGINE[engine] || TILE_MAX_PX;
  const lines = [];
  const words = [];
  let unavailable = 0;
  let read = 0;
  const started = Date.now();
  const budgetMs = Number(options.graphicsBudgetMs ?? process.env.CODE_ANALYZER_GRAPHICS_BUDGET_MS) || 150000;
  for (const tile of tiles) {
    // Tiles left when the budget runs out are recorded unreadable, never as having no text.
    if (Date.now() - started > budgetMs) {
      unavailable += 1;
      lines.push({ tile, readable: false, quote: null, confidence: null, extractionMethod: engine || "none", limitations: "region_unreadable" });
      continue;
    }
    const scale = scaleForBox(tile, tileMaxPx);
    let rendered;
    try {
      rendered = await renderPdfClip(page, { ...tile, pageWidth, pageHeight }, scale, tileMaxPx);
    } catch {
      rendered = null;
    }
    if (!rendered?.png) {
      unavailable += 1;
      continue;
    }
    const recognized = await recognizePng(rendered.png, options);
    if (recognized.unavailable || recognized.failed) {
      unavailable += 1;
      lines.push({
        tile,
        readable: false,
        quote: null,
        confidence: null,
        extractionMethod: recognized.engine || "none",
        limitations: recognized.unavailable ? "ocr_unavailable" : "region_unreadable",
      });
      continue;
    }
    read += 1;
    const clip = rendered.clip || tile;
    const tileWords = [...(recognized.words || [])];
    if (recognized.engine === "tesseract" && Date.now() - started < budgetMs * 0.75) {
      const placed = tileWords.map((word) => wordToPdfBox(clip, word, rendered.pixelWidth, rendered.pixelHeight));
      for (const word of await rotatedTesseractWords(rendered, options)) {
        const box = wordToPdfBox(clip, word, rendered.pixelWidth, rendered.pixelHeight);
        if (box.height > 1.6 * box.width && !overlapsAny(box, placed)) tileWords.push(word);
      }
    }
    for (const word of tileWords) {
      const text = String(word.text || "").trim();
      if (!text) continue;
      const box = wordToPdfBox(clip, word, rendered.pixelWidth, rendered.pixelHeight);
      const confident = Number(word.confidence) >= OCR_CONFIDENCE_MIN;
      // Overlapping tiles read a label near a seam twice; the first read is kept.
      if (confident && !words.some((other) => other.text === text && overlapsAny(box, [other.box]))) {
        words.push({ text, confidence: Number(word.confidence), box, ...(word.rotated ? { rotated: true } : {}) });
      }
      if (!GRAPHIC_INTEREST_RE.test(text)) continue;
      lines.push({
        tile,
        readable: confident,
        quote: confident ? text : null,
        confidence: Number(word.confidence),
        extractionMethod: recognized.engine,
        limitations: confident ? null : "region_unreadable",
        box,
        reason: reasonFor(text),
      });
    }
  }

  const rank = { rating: 6, legend: 5, note: 4, schedule: 3, dimension: 2, detail: 2, graphic: 1, tag: 1 };
  lines.sort((a, b) => {
    const byReason = (rank[b.reason] || 0) - (rank[a.reason] || 0);
    if (byReason) return byReason;
    return (b.readable === true) - (a.readable === true);
  });

  const regions = [];
  for (const line of lines) {
    if (regions.length >= MAX_GRAPHIC_REGIONS) break;
    const box = line.box || line.tile;
    if (!box || !(box.width > 0) || !(box.height > 0)) continue;
    if (regions.filter((region) => region.reason === "dimension").length >= 3 && line.reason === "dimension") continue;
    regions.push({
      ...withNormalized(box, pageWidth, pageHeight),
      quote: line.readable ? line.quote : null,
      reason: line.reason || (line.quote ? reasonFor(line.quote) : "graphic"),
      readable: Boolean(line.readable && line.quote),
      confidence: line.confidence,
      extractionMethod: line.extractionMethod || "ocr-crop",
      source: "original-pdf-crop",
      limitations: line.readable ? null : line.limitations || "region_unreadable",
    });
  }

  // Readable words mean the graphic text was read, whether or not a region of interest was found.
  let readStatus = "unreadable";
  if (words.length || regions.some((region) => region.readable && region.quote)) readStatus = "recognized";
  else if (unavailable === tiles.length) readStatus = "ocr_unavailable";
  else if (!regions.length && unavailable === 0) readStatus = "no_graphic_text";
  // A tile that could not be read leaves part of the sheet unread.
  if (readStatus === "recognized" && unavailable > 0 && read < tiles.length) readStatus = "unreadable";
  return { regions, readStatus, words };
}

const INDEX_CROP_MAX_PX = 4000;
/**
 * Render scales (px per point) for the index re-read. Tesseract drops most hand-lettered sheet
 * numbers above about 2.5 px/pt, and each scale misses different rows, so it reads each column
 * at several. Other engines read the whole index once at the highest scale.
 */
const INDEX_REREAD_SCALES = { tesseract: [1.2, 1.7, 2.2] };

/**
 * Lines read from one crop. A word below the confidence floor is kept when it parses as a
 * sheet number: these lines only feed index rows, which must still align in a column.
 */
async function readIndexCrop(page, box, scale, options) {
  const rendered = await renderPdfClip(page, box, scale, INDEX_CROP_MAX_PX).catch(() => null);
  if (!rendered?.png) return [];
  const recognized = await recognizePng(rendered.png, options);
  if (recognized.unavailable || recognized.failed) return [];
  return groupWordsIntoLines((recognized.words || [])
    .filter((word) => Number(word.confidence) >= OCR_CONFIDENCE_MIN || correctedSheetToken(word.text))
    .map((word) => ({ text: word.text, confidence: Number(word.confidence), box: wordToPdfBox(rendered.clip, word, rendered.pixelWidth, rendered.pixelHeight) })));
}

function boundsOf(rows, pageWidth, pageHeight, padX, padY, right = null) {
  const left = Math.max(0, Math.min(...rows.map((row) => row.box.x)) - padX);
  const bottom = Math.max(0, Math.min(...rows.map((row) => row.box.y)) - padY);
  const edge = right ?? Math.max(...rows.map((row) => row.box.x + row.box.width)) + padX;
  const top = Math.min(pageHeight, Math.max(...rows.map((row) => row.box.y + row.box.height)) + padY);
  return { x: left, y: bottom, width: Math.min(pageWidth, edge) - left, height: top - bottom, pageWidth, pageHeight };
}

/** Index rows grouped into left-aligned columns, as indexRowsFromLines aligns them. */
function indexColumns(rows) {
  const columns = [];
  for (const row of rows) {
    const tolerance = Math.max(18, 2 * row.box.height);
    const column = columns.find((existing) => Math.abs(existing.x - row.box.x) <= tolerance);
    if (column) column.rows.push(row);
    else columns.push({ x: row.box.x, rows: [row] });
  }
  return columns;
}

/**
 * One line per physical row from several reads of a column: the sheet number most reads agree
 * on (separators ignored), then the most confident, then the reading that kept its separators.
 */
function votedRowLines(lines) {
  const slots = [];
  for (const line of lines) {
    const token = correctedSheetToken(line.text.trim().split(/\s+/)[0] || "");
    if (!token) continue;
    const center = line.box.y + line.box.height / 2;
    const slot = slots.find((item) => Math.abs(item.center - center) <= 0.6 * Math.max(item.height, line.box.height));
    const reading = { line, token, key: token.replace(/[-.]/g, "") };
    if (slot) slot.readings.push(reading);
    else slots.push({ center, height: line.box.height, readings: [reading] });
  }
  return slots.map((slot) => {
    const votes = new Map();
    for (const reading of slot.readings) votes.set(reading.key, (votes.get(reading.key) || 0) + 1);
    return [...slot.readings].sort((a, b) => votes.get(b.key) - votes.get(a.key)
      || b.line.confidence - a.line.confidence
      || b.token.length - a.token.length)[0].line;
  });
}

/**
 * Tile OCR is too coarse for small index text. When the page is an index, the sheet-number
 * rows are read again from the original PDF at a higher resolution.
 */
async function rereadIndexColumns(page, pageWidth, pageHeight, tileLines, options) {
  const rows = indexRowsFromLines(tileLines, { minRows: 3 });
  if (!rows.length) return [];
  const scales = INDEX_REREAD_SCALES[ocrEngine(options)];
  if (!scales) {
    const right = Math.max(...rows.map((row) => row.box.x + row.box.width));
    const span = Math.max(right - Math.min(...rows.map((row) => row.box.x)), 1);
    const box = boundsOf(rows, pageWidth, pageHeight, 12, 24, right + span * 0.4 + 24);
    return readIndexCrop(page, box, Math.min(4, INDEX_CROP_MAX_PX / Math.max(box.width, box.height)), options);
  }
  const lines = [];
  for (const column of indexColumns(rows)) {
    const rowHeight = Math.max(...column.rows.map((row) => row.box.height));
    const numberWidth = Math.max(...column.rows.map((row) => {
      const text = row.title ? `${row.sheetNumber} ${row.title}` : row.sheetNumber;
      return row.box.width * Math.min(1, (row.sheetNumber.length + 1) / text.length);
    }));
    const box = boundsOf(column.rows, pageWidth, pageHeight, 6, 3 * rowHeight, Math.min(...column.rows.map((row) => row.box.x)) + numberWidth + 12);
    const readings = [];
    for (const scale of scales) readings.push(...await readIndexCrop(page, box, scale, options));
    lines.push(...votedRowLines(readings));
  }
  return lines;
}

const QUESTION_CUES = [
  { id: "fire-rated-partition", quote: /fire\s*rat|one\s*hours?|\b[1I]\s*h(?:r)?\b|partition|wall\s*type|\blegend\b/i },
  { id: "corridor-width", quote: /\bcorridor\b|\begress\b|exit\s*access|clear\s*width/i },
  { id: "emergency-lighting", quote: /emergency\s+light|egress\s+light|inverter|foot-?candle|nfpa\s*101/i },
  { id: "accessibility-route", quote: /accessible|clearance|threshold|turning|door\s*width/i },
  { id: "plumbing-details", quote: /fixture|water[\s-]*hammer|grease|backflow|\brpz\b|drain|arrester/i },
  { id: "mechanical-schedule", quote: /\bschedule\b|\bequipment\b|\bcfm\b|\bhvac\b/i },
  { id: "special-inspections", quote: /special\s+inspection/i },
];

function boilerplateKind(quote) {
  const text = String(quote || "");
  if (/scale\b|=\s*1\s*['′]\s*-?\s*0|1\/\d+\s*["″]/i.test(text)) return "scale";
  if (/\b(street|avenue|ave\b|suite|boulevard|road|drive|odonnell)\b/i.test(text)) return "address";
  if (/\b(sheet\s*(?:no|number)|drawn by|checked by|project\s*(?:no|number)|copyright)\b/i.test(text)) return "title-block";
  return null;
}

/**
 * Pick at most two regions for the questions on this sheet.
 * Title blocks, addresses, and scales lose unless a question cue is in the quote.
 * A low score is a limitation, not a guess.
 * @param {Array<Record<string, unknown>>} regions
 * @param {{ questions?: string[] }} [context]
 */
function rankRegionsForQuestions(regions, context = {}) {
  const questions = Array.isArray(context.questions) && context.questions.length ? context.questions : null;
  const cues = questions
    ? QUESTION_CUES.filter((cue) => questions.includes(cue.id))
    : QUESTION_CUES;
  const scored = (regions || []).map((region) => {
    const quote = String(region.quote || "");
    const boilerplate = boilerplateKind(quote);
    const matched = cues.filter((cue) => quote && cue.quote.test(quote)).map((cue) => cue.id);
    let score = matched.length * 8;
    if (!questions && !matched.length && !boilerplate && (region.reason === "rating" || region.reason === "legend")) {
      score += 7;
    }
    if (boilerplate && !matched.length) score -= 12;
    return {
      region: { ...region, matchedQuestions: matched, boilerplate },
      score,
    };
  });
  scored.sort((a, b) => b.score - a.score || String(b.region.quote || "").length - String(a.region.quote || "").length);
  const picked = scored.filter((item) => item.score >= 6).slice(0, MAX_REGION_IMAGES);
  return {
    regions: picked.map((item) => item.region),
    limitation: picked.length ? null : "crop_selection_unconfident",
  };
}

function questionIds(questions) {
  return (Array.isArray(questions) ? questions : [])
    .map((question) => (typeof question === "string" ? question : question?.id))
    .filter(Boolean);
}

function unionBox(items) {
  const boxes = items.map((item) => item.region);
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const top = Math.max(...boxes.map((box) => box.y + box.height));
  const sample = boxes[0];
  return {
    x,
    y,
    width: right - x,
    height: top - y,
    pageWidth: sample.pageWidth,
    pageHeight: sample.pageHeight,
    unit: "pdf-point",
    origin: "bottom-left",
  };
}

/**
 * Join nearby positioned text items into lines and keep a line that matches the question.
 * Title-block, address, and scale lines are skipped unless the question cue is in that line.
 * @param {Array<Record<string, unknown>>} items
 * @param {Array<string | { id?: string }>} questions
 */
function questionLineRegions(items, questions) {
  const cues = QUESTION_CUES.filter((cue) => questionIds(questions).includes(cue.id));
  if (!cues.length) return [];
  const positioned = [];
  for (const item of items || []) {
    const text = String(item.str || item.quote || "").trim();
    if (!text || !item.region || !(item.region.width > 0) || !(item.region.height > 0)) continue;
    positioned.push({ text, region: item.region });
  }
  positioned.sort((a, b) => b.region.y - a.region.y || a.region.x - b.region.x);
  const lines = [];
  for (const item of positioned) {
    const line = lines.find((existing) => Math.abs(existing.y - item.region.y) <= 8 && item.region.x <= existing.maxX + 40);
    if (!line) {
      lines.push({ y: item.region.y, maxX: item.region.x + item.region.width, items: [item] });
      continue;
    }
    line.items.push(item);
    line.maxX = Math.max(line.maxX, item.region.x + item.region.width);
    line.y = (line.y + item.region.y) / 2;
  }
  const regions = [];
  for (const line of lines) {
    line.items.sort((a, b) => a.region.x - b.region.x);
    const quote = line.items.map((item) => item.text).join(" ");
    const matched = cues.filter((cue) => cue.quote.test(quote)).map((cue) => cue.id);
    if (!matched.length || boilerplateKind(quote)) continue;
    regions.push({
      ...unionBox(line.items),
      quote: quote.slice(0, 180),
      reason: "note",
      readable: true,
      matchedQuestions: matched,
      boilerplate: null,
      extractionMethod: "pdfjs-text-line",
      source: "question-line",
      limitations: null,
    });
  }
  regions.sort((a, b) => String(b.quote || "").length - String(a.quote || "").length);
  return regions.slice(0, MAX_REGION_IMAGES);
}

/**
 * Interior bands from the original page when no positioned line covers the question.
 * The right and bottom title-block edges are left out. No quote is invented.
 * @param {number} pageWidth
 * @param {number} pageHeight
 * @param {Array<string | { id?: string }>} questions
 */
function visualFallbackRegions(pageWidth, pageHeight, questions) {
  const ids = questionIds(questions);
  if (!ids.length || !(pageWidth > 0) || !(pageHeight > 0)) return [];
  const bands = [
    { x: pageWidth * 0.08, y: pageHeight * 0.48, width: pageWidth * 0.5, height: pageHeight * 0.12 },
    { x: pageWidth * 0.08, y: pageHeight * 0.28, width: pageWidth * 0.5, height: pageHeight * 0.12 },
  ];
  return bands.map((band) => ({
    x: band.x,
    y: band.y,
    width: band.width,
    height: band.height,
    pageWidth,
    pageHeight,
    unit: "pdf-point",
    origin: "bottom-left",
    quote: null,
    reason: "question-fallback",
    readable: false,
    matchedQuestions: ids,
    boilerplate: null,
    extractionMethod: "question-visual-fallback",
    source: "original-pdf",
    limitations: "region_unreadable",
  }));
}

async function renderRegionCrops(page, regions) {
  const crops = [];
  for (const region of regions) {
    if (crops.length >= MAX_REGION_IMAGES) break;
    if (!region || !(region.width > 1) || !(region.height > 1)) continue;
    try {
      const rendered = await renderPdfClip(page, region, 3);
      if (!rendered?.png || rendered.png.length < 80) continue;
      crops.push({
        imageBase64: rendered.png.toString("base64"),
        imageType: "image/png",
        label: region.quote
          ? `${region.reason || "region"}: ${String(region.quote).slice(0, 80)}`
          : `${region.reason || "region"}: unreadable`,
        region: {
          x: region.x,
          y: region.y,
          width: region.width,
          height: region.height,
          pageWidth: region.pageWidth,
          pageHeight: region.pageHeight,
          unit: "pdf-point",
          origin: "bottom-left",
        },
        extractionMethod: "original-pdf-clip",
        readable: region.readable !== false,
        questions: region.matchedQuestions || [],
        boilerplate: region.boilerplate || null,
      });
    } catch {
      continue;
    }
  }
  return crops;
}

/**
 * @param {string} filePath
 * @param {number} pageNumber
 * @param {{ render?: boolean; ocr?: Function; discoverGraphics?: boolean }} [options]
 */
async function comprehendPdfPage(filePath, pageNumber, options = {}) {
  const buffer = await fs.readFile(filePath);
  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: true,
  }).promise;
  const pageNum = Math.max(1, Number(pageNumber) || 1);
  try {
    if (pageNum > pdf.numPages) {
      return emptyPage();
    }
    const page = await pdf.getPage(pageNum);
    try {
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent();
      const items = [];
      for (const item of textContent.items) {
        if (!("str" in item) || !String(item.str || "").trim()) continue;
        const region = boxFromTextItem(item, viewport.width, viewport.height);
        items.push({
          str: String(item.str),
          region,
          extractionMethod: "pdfjs-text-layer",
          readable: true,
        });
      }
      const textRegions = selectInspectionRegions(items, {
        pageWidth: viewport.width,
        pageHeight: viewport.height,
      }).map((region) => ({
        ...region,
        readable: true,
        extractionMethod: "pdfjs-text-layer",
        source: "original-pdf",
        limitations: null,
      }));

      let graphic = { regions: [], readStatus: "text-layer", words: [], indexLines: [] };
      const textLayer = items.map((item) => item.str).join(" ");
      const discover = options.discoverGraphics !== false && isDrawingPage(viewport.width, viewport.height);
      if (discover) {
        const key = cacheKey(buffer, pageNum);
        const cached = options.ocr ? null : graphicCache.get(key);
        if (cached) {
          graphic = cached;
        } else {
          graphic = await discoverGraphicalRegions(page, viewport.width, viewport.height, options);
          const tileLines = groupWordsIntoLines(graphic.words);
          graphic.indexLines = pageIsTitledIndex(tileLines, textLayer)
            ? await rereadIndexColumns(page, viewport.width, viewport.height, tileLines, options)
            : [];
          if (!options.ocr) {
            graphicCache.set(key, graphic);
            if (graphicCache.size > 8) graphicCache.delete(graphicCache.keys().next().value);
          }
        }
      }

      const graphicItems = graphic.regions
        .filter((region) => region.readable && region.quote)
        .map((region) => ({
          str: region.quote,
          region,
          extractionMethod: region.extractionMethod || "ocr-crop",
          readable: true,
          confidence: region.confidence,
        }));
      const unreadableItems = graphic.regions
        .filter((region) => !region.readable)
        .map((region) => ({
          str: "",
          region,
          extractionMethod: region.extractionMethod || "ocr-crop",
          readable: false,
          limitations: region.limitations || "region_unreadable",
        }));

      const regions = [...graphic.regions, ...textRegions].slice(0, MAX_REGIONS + MAX_GRAPHIC_REGIONS);
      const selection = rankRegionsForQuestions(regions, { questions: options.questions });
      let regionImages = [];
      if (options.render && selection.regions.length) {
        regionImages = await renderRegionCrops(page, selection.regions);
      }
      const composed = composeSheetText(textLayer, groupWordsIntoLines(graphic.words || []), graphic.indexLines || []);
      return {
        text: composed.text,
        textLayer,
        indexRows: composed.indexRows,
        ocrLineCount: composed.ocrLineCount,
        items: [...items, ...graphicItems, ...unreadableItems],
        regions,
        regionImages,
        cropLimitation: selection.limitation,
        pageWidth: viewport.width,
        pageHeight: viewport.height,
        graphicalReadStatus: graphic.readStatus,
        sourcePdf: filePath,
      };
    } finally {
      page.cleanup();
    }
  } finally {
    await pdf.destroy();
  }
}

async function renderCropsFromFile(filePath, pageNumber, regions) {
  const buffer = await fs.readFile(filePath);
  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: true,
  }).promise;
  const pageNum = Math.max(1, Number(pageNumber) || 1);
  try {
    if (pageNum > pdf.numPages || !regions?.length) return [];
    const page = await pdf.getPage(pageNum);
    try {
      return await renderRegionCrops(page, regions);
    } finally {
      page.cleanup();
    }
  } finally {
    await pdf.destroy();
  }
}

function emptyPage() {
  return {
    text: "",
    textLayer: "",
    indexRows: [],
    ocrLineCount: 0,
    items: [],
    regions: [],
    regionImages: [],
    cropLimitation: "crop_selection_unconfident",
    pageWidth: 0,
    pageHeight: 0,
    graphicalReadStatus: "no_page",
  };
}

module.exports = {
  boxFromTextItem,
  selectInspectionRegions,
  rankRegionsForQuestions,
  questionLineRegions,
  visualFallbackRegions,
  boilerplateKind,
  comprehendPdfPage,
  renderCropsFromFile,
  pdfBoxFromNormalized,
  shouldAttachRegionImages,
  renderPdfClip,
  MAX_REGIONS,
  MAX_REGION_IMAGES,
};
