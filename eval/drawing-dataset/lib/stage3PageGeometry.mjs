/**
 * Stage 3 v2 page geometry: printed rules (straight ink runs) measured from the drawing itself.
 *
 * Rules ground two v2 decisions that text geometry cannot make reliably:
 * - the title-block border (a rule running most of the page height near the right edge), and
 * - table cell boundaries (a rule crossing the baseline between two OCR observations).
 *
 * detectRules is a pure function of a greyscale-like RGBA image; renderPageGeometry renders a PDF
 * page with the same pdf.js + canvas stack as ocrRecover.mjs. Coordinates are PDF points,
 * origin bottom-left.
 */
import { createRequire } from "node:module";
import { ensurePdfjsPolyfill, loadPdfjs } from "./pdfExtract.mjs";

const require = createRequire(import.meta.url);

export const PAGE_GEOMETRY_VERSION = "stage3-page-geometry.v1";
export const GEOMETRY_DENSITY = 2;
const DARK = 160;
const MIN_RULE_PT = 8;

const r1 = (v) => Math.round(v * 10) / 10;

/**
 * Straight ink runs of at least minRulePt points, merged across adjacent pixel columns (or rows)
 * that overlap along the run. Returns { vertical: [{ x, y0, y1 }], horizontal: [{ y, x0, x1 }] }.
 */
export function detectRules(image, width, height, { density = GEOMETRY_DENSITY, pageHeight, minRulePt = MIN_RULE_PT } = {}) {
  const data = image.data || image;
  const dark = (x, y) => {
    const i = (y * width + x) * 4;
    return data[i] < DARK && data[i + 1] < DARK && data[i + 2] < DARK;
  };
  const minRun = Math.max(2, Math.round(minRulePt * density));
  const H = pageHeight ?? height / density;

  const runsOf = (count, length, at) => {
    const out = [];
    for (let a = 0; a < count; a++) {
      let start = -1;
      for (let b = 0; b <= length; b++) {
        const on = b < length && at(a, b);
        if (on && start < 0) start = b;
        else if (!on && start >= 0) {
          if (b - start >= minRun) out.push({ a, b0: start, b1: b });
          start = -1;
        }
      }
    }
    return out;
  };
  const merge = (runs) => {
    const merged = [];
    const open = [];
    for (const run of runs) {
      let host = null;
      for (const m of open) {
        if (run.a - m.aMax <= 1 && Math.min(run.b1, m.b1) - Math.max(run.b0, m.b0) > 0.5 * Math.min(run.b1 - run.b0, m.b1 - m.b0)) { host = m; break; }
      }
      if (host) {
        host.aMax = run.a;
        host.b0 = Math.min(host.b0, run.b0);
        host.b1 = Math.max(host.b1, run.b1);
      } else {
        const m = { aMin: run.a, aMax: run.a, b0: run.b0, b1: run.b1 };
        open.push(m);
        merged.push(m);
      }
      for (let i = open.length - 1; i >= 0; i--) if (run.a - open[i].aMax > 1) open.splice(i, 1);
    }
    return merged;
  };

  const vertical = merge(runsOf(width, height, (x, y) => dark(x, y))).map((m) => ({
    x: r1((m.aMin + m.aMax + 1) / 2 / density),
    y0: r1(H - m.b1 / density),
    y1: r1(H - m.b0 / density),
    thickness: r1((m.aMax - m.aMin + 1) / density),
  }));
  const horizontal = merge(runsOf(height, width, (y, x) => dark(x, y))).map((m) => ({
    y: r1(H - (m.aMin + m.aMax + 1) / 2 / density),
    x0: r1(m.b0 / density),
    x1: r1(m.b1 / density),
    thickness: r1((m.aMax - m.aMin + 1) / density),
  }));
  return { vertical, horizontal };
}

/** Render page 1 of a PDF and measure its rules. Returns null geometry fields only on render failure. */
export async function renderPageGeometry(pdfPath, { density = GEOMETRY_DENSITY, pageNumber = 1 } = {}) {
  ensurePdfjsPolyfill();
  const pdfjs = await loadPdfjs();
  const canvas = require("@napi-rs/canvas");
  const { readFile } = await import("node:fs/promises");
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(await readFile(pdfPath)),
    disableFontFace: true,
    useSystemFonts: true,
    verbosity: 0,
    isEvalSupported: false,
  }).promise;
  try {
    const page = await pdf.getPage(pageNumber);
    try {
      const view = page.view || [0, 0, 0, 0];
      const pageWidth = view[2] - view[0];
      const pageHeight = view[3] - view[1];
      const viewport = page.getViewport({ scale: density });
      const w = Math.ceil(viewport.width), h = Math.ceil(viewport.height);
      const surface = canvas.createCanvas(w, h);
      const ctx = surface.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const rules = detectRules(ctx.getImageData(0, 0, w, h), w, h, { density, pageHeight });
      return { version: PAGE_GEOMETRY_VERSION, density, pageWidth: r1(pageWidth), pageHeight: r1(pageHeight), ...rules };
    } finally {
      page.cleanup?.();
    }
  } finally {
    await pdf.destroy().catch(() => {});
  }
}

/** True when a vertical rule crosses the band [yLow, yHigh] strictly between xLeft and xRight. */
export function ruleBetween(geometry, { xLeft, xRight, yLow, yHigh }) {
  if (!geometry?.vertical?.length || xRight <= xLeft) return false;
  return geometry.vertical.some((v) => v.x > xLeft && v.x < xRight && v.y0 <= yLow && v.y1 >= yHigh);
}
