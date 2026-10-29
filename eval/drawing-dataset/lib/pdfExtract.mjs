/**
 * PDF text, annotation, and ink-grid extraction.
 * Text-layer strings are machine-extracted. Ink cells with no text-layer item
 * stay visually unresolved. This module does not invent glyphs for those cells.
 *
 * Node 18 has no process.getBuiltinModule. pdf.js 4 needs it to load
 * @napi-rs/canvas. The polyfill is installed before pdf.js is imported.
 */
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
if (typeof process.getBuiltinModule !== "function") {
  process.getBuiltinModule = (name) => (name === "module" ? { createRequire: () => require } : require(name));
}

const COLS = 8;
const ROWS = 6;
const INK_THRESHOLD = 245;
const UNRESOLVED_INK_RATIO = 0.03;
const RENDER_SCALE = 0.08;

let pdfjsPromise;
function loadPdfjs() {
  if (!pdfjsPromise) pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsPromise;
}

export function classifyPdfFailure(error) {
  const name = String(error?.name || "");
  const message = String(error?.message || error || "");
  if (name === "PasswordException" || /password/i.test(message)) {
    return { status: "password_protected", errorClass: name || "PasswordException", message: message.slice(0, 240) };
  }
  return { status: "unreadable", errorClass: name || "Error", message: message.slice(0, 240) };
}

export function scanBoxDeclarations(buffer) {
  const latin = buffer.toString("latin1");
  const mediaInline = latin.match(/\/MediaBox\s*\[/g) || [];
  const cropInline = latin.match(/\/CropBox\s*\[/g) || [];
  const mediaIndirect = latin.match(/\/MediaBox\s+\d+\s+\d+\s+R/g) || [];
  const cropIndirect = latin.match(/\/CropBox\s+\d+\s+\d+\s+R/g) || [];
  return {
    mediaBoxInline: mediaInline.length,
    cropBoxInline: cropInline.length,
    mediaBoxIndirect: mediaIndirect.length,
    cropBoxIndirect: cropIndirect.length,
    cropBoxPresent: cropInline.length + cropIndirect.length > 0,
    indirectBoxesUnresolved: mediaIndirect.length + cropIndirect.length > 0,
  };
}

function round(value) {
  return Math.round(Number(value) * 10) / 10;
}

function itemRecord(item, pageWidth, pageHeight) {
  const transform = item.transform || [1, 0, 0, 1, 0, 0];
  const text = typeof item.str === "string" ? item.str : "";
  if (!text) return null;
  return {
    text,
    x: round(transform[4]),
    y: round(transform[5]),
    w: round(item.width || 0),
    h: round(item.height || Math.hypot(transform[2] || 0, transform[3] || 0)),
    fontName: item.fontName || null,
    pageWidth: round(pageWidth),
    pageHeight: round(pageHeight),
    origin: "machine_extracted",
  };
}

export function linesFromItems(items) {
  const sorted = [...items].sort((left, right) => right.y - left.y || left.x - right.x);
  const groups = [];
  for (const item of sorted) {
    const last = groups[groups.length - 1];
    const tolerance = Math.max(3, (item.h || 8) * 0.6);
    if (!last || Math.abs(last.y - item.y) > tolerance) groups.push({ y: item.y, items: [item] });
    else last.items.push(item);
  }
  const lines = [];
  for (const group of groups) {
    group.items.sort((left, right) => left.x - right.x);
    let current = [];
    let followedWideGap = false;
    const pushCurrent = () => {
      if (!current.length) return;
      lines.push({ items: current, followedWideGap });
      current = [];
      followedWideGap = false;
    };
    for (const item of group.items) {
      const previous = current[current.length - 1];
      const gap = previous ? item.x - (previous.x + (previous.w || 0)) : 0;
      if (previous && gap > 36) {
        pushCurrent();
        followedWideGap = true;
      }
      current.push(item);
    }
    pushCurrent();
  }
  return lines.map((line) => ({
    text: line.items.map((item) => item.text).join(" ").replace(/[ \t]+/g, " ").trim(),
    x: line.items[0].x,
    y: round(line.items[0].y),
    itemCount: line.items.length,
    wideGaps: line.followedWideGap ? 1 : 0,
    origin: "machine_extracted",
  })).filter((line) => line.text);
}

function spansMatching(items, pattern, kind, limit) {
  const spans = [];
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const expression = new RegExp(pattern.source, flags);
  for (const item of items) {
    expression.lastIndex = 0;
    const matches = item.text.match(expression);
    if (!matches) continue;
    for (const match of matches) {
      spans.push({
        kind,
        text: match,
        x: item.x,
        y: item.y,
        origin: "machine_extracted",
      });
      if (spans.length >= limit) return { spans, truncated: true };
    }
  }
  return { spans, truncated: false };
}

export function measureInkGrid(image, width, height, textPoints) {
  const data = image.data;
  const cellW = width / COLS;
  const cellH = height / ROWS;
  const ink = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  const seen = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  let inkPixels = 0;
  let sampled = 0;
  const stride = 2;
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const offset = (y * width + x) * 4;
      const dark = data[offset] < INK_THRESHOLD || data[offset + 1] < INK_THRESHOLD || data[offset + 2] < INK_THRESHOLD;
      const col = Math.min(COLS - 1, Math.floor(x / cellW));
      const row = Math.min(ROWS - 1, Math.floor(y / cellH));
      seen[row][col] += 1;
      sampled += 1;
      if (dark) {
        ink[row][col] += 1;
        inkPixels += 1;
      }
    }
  }
  const textCells = new Set();
  for (const point of textPoints) {
    if (!Number.isFinite(point.vx) || !Number.isFinite(point.vy)) continue;
    const col = Math.min(COLS - 1, Math.max(0, Math.floor(point.vx / cellW)));
    const row = Math.min(ROWS - 1, Math.max(0, Math.floor(point.vy / cellH)));
    textCells.add(`${row}:${col}`);
  }
  const unresolved = [];
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const ratio = seen[row][col] ? ink[row][col] / seen[row][col] : 0;
      if (ratio < UNRESOLVED_INK_RATIO) continue;
      if (textCells.has(`${row}:${col}`)) continue;
      unresolved.push({
        cell: `r${row}c${col}`,
        row,
        col,
        inkRatio: Math.round(ratio * 1000) / 1000,
        reason: "ink_without_text_layer",
        interpretation: "unresolved",
      });
    }
  }
  return {
    inkRatio: sampled ? Math.round((inkPixels / sampled) * 1000) / 1000 : 0,
    sampledPixels: sampled,
    unresolved,
    grid: { columns: COLS, rows: ROWS, unresolvedInkRatio: UNRESOLVED_INK_RATIO },
  };
}

function pageCaptureClass({ textChars, inkRatio, visualStatus, unresolvedCount }) {
  if (visualStatus !== "measured") return "partial_visual_unavailable";
  if (textChars < 15 && inkRatio < 0.005) return "empty_measured";
  if (unresolvedCount > 0) return "partial_unread_ink";
  return "partial_text_read_no_unread_ink_cells";
}

async function renderInk(page, items, canvas) {
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  const width = Math.max(1, Math.ceil(viewport.width));
  const height = Math.max(1, Math.ceil(viewport.height));
  const surface = canvas.createCanvas(width, height);
  const context = surface.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  await page.render({ canvasContext: context, viewport }).promise;
  const image = context.getImageData(0, 0, width, height);
  const textPoints = items.map((item) => {
    const [vx, vy] = viewport.convertToViewportPoint(item.x, item.y);
    return { vx, vy };
  });
  const grid = measureInkGrid(image, width, height, textPoints);
  return { visualStatus: "measured", width, height, scale: RENDER_SCALE, ...grid };
}

export async function extractPdfFile(filePath) {
  const buffer = await readFile(filePath);
  const boxScan = scanBoxDeclarations(buffer);
  const pdfjs = await loadPdfjs();
  let pdf;
  try {
    const task = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      disableFontFace: true,
      useSystemFonts: true,
      verbosity: 0,
      isEvalSupported: false,
    });
    pdf = await task.promise;
  } catch (error) {
    const failure = classifyPdfFailure(error);
    return {
      openStatus: failure.status,
      error: { errorClass: failure.errorClass, message: failure.message },
      pageCount: null,
      metadata: {},
      boxScan,
      pages: [],
    };
  }

  try {
    let metadata = {};
    try {
      const meta = await pdf.getMetadata();
      metadata = {
        title: meta?.info?.Title || null,
        author: meta?.info?.Author || null,
        creator: meta?.info?.Creator || null,
        producer: meta?.info?.Producer || null,
      };
    } catch {
      metadata = { title: null, author: null, creator: null, producer: null, metadataReadFailed: true };
    }
    const canvas = require("@napi-rs/canvas");
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      pages.push(await extractPage(pdf, pageNumber, canvas));
    }
    return {
      openStatus: "opened",
      error: null,
      pageCount: pdf.numPages,
      metadata,
      boxScan,
      pages,
    };
  } finally {
    await pdf.destroy().catch(() => {});
  }
}

async function extractPage(pdf, pageNumber, canvas) {
  let page;
  try {
    page = await pdf.getPage(pageNumber);
  } catch (error) {
    const failure = classifyPdfFailure(error);
    return failedPage(pageNumber, failure);
  }
  try {
    const view = page.view || [0, 0, 0, 0];
    const pageWidth = view[2] - view[0];
    const pageHeight = view[3] - view[1];
    const textContent = await page.getTextContent();
    const items = [];
    for (const item of textContent.items || []) {
      const record = itemRecord(item, pageWidth, pageHeight);
      if (record) items.push(record);
    }
    const lines = linesFromItems(items);
    const pageText = lines.map((line) => line.text).join("\n");
    let annotations = [];
    try {
      const raw = await page.getAnnotations({ intent: "display" });
      annotations = (raw || []).map((annotation) => ({
        subtype: annotation.subtype || null,
        contents: annotation.contents || annotation.contentsObj?.str || "",
        rect: Array.isArray(annotation.rect) ? annotation.rect.map(round) : null,
        origin: "machine_extracted",
      })).filter((annotation) => annotation.contents);
    } catch (error) {
      annotations = [{ subtype: null, contents: "", rect: null, origin: "machine_extracted", readError: String(error?.name || "Error") }];
    }
    let visual;
    try {
      visual = await renderInk(page, items, canvas);
    } catch (error) {
      visual = {
        visualStatus: "unavailable",
        inkRatio: null,
        unresolved: [],
        errorClass: error?.name || "Error",
        message: String(error?.message || error).slice(0, 240),
      };
    }
    const codeRefs = spansMatching(items, /\b(?:IBC|IFC|IMC|IPC|IECC|NEC|NFPA|ASHRAE|ADA|DCMR)\s*[\d§.][\d.\-]*/i, "code_reference", 80);
    const dates = spansMatching(items, /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/, "date", 80);
    const wideGapLines = lines.filter((line) => line.wideGaps > 0).length;
    const flags = [];
    if (visual.visualStatus !== "measured") flags.push("visual_unavailable");
    if (pageCaptureClass({
      textChars: pageText.length,
      inkRatio: visual.inkRatio || 0,
      visualStatus: visual.visualStatus,
      unresolvedCount: visual.unresolved.length,
    }) === "partial_unread_ink") flags.push("unread_ink");
    if (pageText.length < 80 && (visual.inkRatio || 0) > 0.02) flags.push("low_text_high_ink");
    if (wideGapLines > 0) flags.push("wide_text_gaps");
    if (!pageText.trim() && visual.visualStatus === "measured" && (visual.inkRatio || 0) < 0.005) flags.push("empty_page");
    const captureClass = pageCaptureClass({
      textChars: pageText.length,
      inkRatio: visual.inkRatio || 0,
      visualStatus: visual.visualStatus,
      unresolvedCount: visual.unresolved.length,
    });
    return {
      pageNumber,
      outcome: captureClass === "failed" ? "failed" : "recorded",
      captureClass,
      pageWidth: round(pageWidth),
      pageHeight: round(pageHeight),
      rotation: page.rotate || 0,
      textChars: pageText.length,
      textItemCount: items.length,
      lineCount: lines.length,
      annotationCount: annotations.length,
      inkRatio: visual.inkRatio,
      visualStatus: visual.visualStatus,
      unresolvedRegions: visual.unresolved,
      flags,
      codeReferenceCount: codeRefs.spans.length,
      codeReferencesTruncated: codeRefs.truncated,
      dateSpanCount: dates.spans.length,
      wideGapLineCount: wideGapLines,
      items,
      lines,
      pageText,
      annotations,
      codeReferences: codeRefs.spans,
      dateSpans: dates.spans,
      visualError: visual.visualStatus === "measured" ? null : { errorClass: visual.errorClass, message: visual.message },
    };
  } catch (error) {
    return failedPage(pageNumber, classifyPdfFailure(error));
  } finally {
    page.cleanup?.();
  }
}

function failedPage(pageNumber, failure) {
  return {
    pageNumber,
    outcome: "failed",
    captureClass: "failed",
    textChars: 0,
    textItemCount: 0,
    lineCount: 0,
    annotationCount: 0,
    inkRatio: null,
    visualStatus: "unavailable",
    unresolvedRegions: [],
    flags: ["page_extraction_failed"],
    items: [],
    lines: [],
    pageText: "",
    annotations: [],
    codeReferences: [],
    dateSpans: [],
    error: { errorClass: failure.errorClass, message: failure.message },
  };
}

export function ensurePdfjsPolyfill() {
  if (typeof process.getBuiltinModule !== "function") {
    process.getBuiltinModule = (name) => (name === "module" ? { createRequire: () => require } : require(name));
  }
}

export { loadPdfjs, COLS, ROWS, INK_THRESHOLD };

export const VISUAL_GRID = { columns: COLS, rows: ROWS, unresolvedInkRatio: UNRESOLVED_INK_RATIO, renderScale: RENDER_SCALE };
