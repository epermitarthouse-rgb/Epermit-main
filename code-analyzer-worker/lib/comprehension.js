"use strict";

const fs = require("fs/promises");
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");

const MAX_REGIONS = 6;
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
  if (/\b\d+\s*-?\s*(?:hour|hr)\b|\b1\s*hr\b/i.test(text)) return "rating";
  if (/\d/.test(text) && /["″]|in(?:ch)?|ft|'/i.test(text)) return "dimension";
  if (/legend|wall\s*type|partition/i.test(text)) return "legend";
  if (/schedule/i.test(text)) return "schedule";
  if (/note|shall|provide|gfci|emergency|hammer|draft/i.test(text)) return "note";
  if (/detail|callout/i.test(text)) return "detail";
  return "tag";
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

/**
 * @param {string} filePath
 * @param {number} pageNumber
 * @param {{ render?: boolean }} [options]
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
      return { text: "", items: [], regions: [], regionImages: [], pageWidth: 0, pageHeight: 0 };
    }
    const page = await pdf.getPage(pageNum);
    try {
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent();
      const items = [];
      for (const item of textContent.items) {
        if (!("str" in item) || !String(item.str || "").trim()) continue;
        const region = boxFromTextItem(item, viewport.width, viewport.height);
        items.push({ str: String(item.str), region });
      }
      const regions = selectInspectionRegions(items, {
        pageWidth: viewport.width,
        pageHeight: viewport.height,
      });
      let regionImages = [];
      if (options.render && regions.length) {
        regionImages = await renderRegionCrops(page, regions.slice(0, 2));
      }
      return {
        text: items.map((item) => item.str).join(" "),
        items,
        regions,
        regionImages,
        pageWidth: viewport.width,
        pageHeight: viewport.height,
      };
    } finally {
      page.cleanup();
    }
  } finally {
    await pdf.destroy();
  }
}

async function renderRegionCrops(page, regions) {
  let createCanvas;
  try {
    ({ createCanvas } = require("canvas"));
  } catch {
    return [];
  }
  const sharp = require("sharp");
  const scale = 2;
  const viewport = page.getViewport({ scale });
  if (viewport.width > 5000 || viewport.height > 5000) return [];
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");
  await page.render({ canvasContext: context, viewport }).promise;
  const png = canvas.toBuffer("image/png");
  const crops = [];
  for (const region of regions) {
    if (!region || !(region.width > 1) || !(region.height > 1)) continue;
    const left = Math.max(0, Math.floor(Number(region.x) * scale) - 8);
    const top = Math.max(0, Math.floor((Number(region.pageHeight) - Number(region.y) - Number(region.height)) * scale) - 8);
    const width = Math.min(Math.ceil(viewport.width) - left, Math.ceil(Number(region.width) * scale) + 16);
    const height = Math.min(Math.ceil(viewport.height) - top, Math.ceil(Number(region.height) * scale) + 16);
    if (width < 4 || height < 4 || width > 900 || height > 900) continue;
    try {
      const extracted = await sharp(png).extract({ left, top, width, height }).png().toBuffer();
      crops.push({
        imageBase64: extracted.toString("base64"),
        imageType: "image/png",
        label: `${region.reason || "region"}: ${String(region.quote || "").slice(0, 80)}`,
      });
    } catch {
      continue;
    }
  }
  return crops;
}

module.exports = {
  boxFromTextItem,
  selectInspectionRegions,
  comprehendPdfPage,
  MAX_REGIONS,
};
