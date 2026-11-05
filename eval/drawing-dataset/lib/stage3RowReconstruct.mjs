/**
 * Stage 3 v2 rows: printed text rows with word-level provenance, built from the
 * recovery page (production 4x3 words and groupWordsIntoLines lines).
 *
 * A production line is split back into separate rows where its observations are more than
 * ROW_SPLIT_GAP text heights apart, or where a printed rule crosses the baseline between them
 * (table cells, detail borders, title-block cells). Rows that only re-read fragments of rendered
 * PDF text-layer glyphs (pdf.js renders text-layer text; OCR reads a first glyph) are excluded.
 */
import { ruleBetween } from "./stage3PageGeometry.mjs";

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const textKey = (s) => clean(s).toUpperCase().replace(/\s+/g, "");
const r1 = (v) => Math.round(v * 10) / 10;
export const roundBox = (b) => ({ x: r1(b.x), y: r1(b.y), width: r1(b.width), height: r1(b.height) });

/** Words of a production line: same text pieces inside the line box. */
export function lineWords(line, words) {
  const eps = 0.01;
  const within = words.filter((w) => w.box.x >= line.box.x - eps && w.box.y >= line.box.y - eps
    && w.box.x + w.box.width <= line.box.x + line.box.width + eps
    && w.box.y + w.box.height <= line.box.y + line.box.height + eps);
  let rest = String(line.text);
  const used = [];
  for (const w of [...within].sort((a, b) => clean(b.text).length - clean(a.text).length)) {
    const t = clean(w.text);
    const i = rest.indexOf(t);
    if (!t || i < 0) continue;
    used.push(w);
    rest = rest.slice(0, i) + "\u0000".repeat(t.length) + rest.slice(i + t.length);
  }
  if (line.words != null && used.length !== line.words) return null;
  return used.sort((a, b) => (line.vertical ? a.box.y - b.box.y : a.box.x - b.box.x));
}

export const ROW_SPLIT_GAP = 1.5;

const unionBox = (boxes) => {
  const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
  return { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y };
};

/** A cell rule is longer than any glyph stroke and may sit slightly inside an OCR box. */
export const CELL_RULE_MIN_HEIGHTS = 1.5;
export const CELL_RULE_INSET_HEIGHTS = 0.5;

/**
 * True when a printed rule separates two consecutive observations of a horizontal line: a vertical
 * rule at least CELL_RULE_MIN_HEIGHTS text heights long crossing their shared baseline band, between
 * (or up to CELL_RULE_INSET_HEIGHTS inside) the end of a and the start of b.
 */
export function cellRuleBetween(a, b, geometry) {
  if (!geometry?.vertical?.length) return false;
  const h = Math.max(a.box.height, b.box.height);
  const mid = (Math.max(a.box.y, b.box.y) + Math.min(a.box.y + a.box.height, b.box.y + b.box.height)) / 2;
  const band = 0.4 * Math.min(a.box.height, b.box.height);
  const long = { ...geometry, vertical: geometry.vertical.filter((v) => v.y1 - v.y0 >= CELL_RULE_MIN_HEIGHTS * h) };
  return ruleBetween(long, {
    xLeft: a.box.x + a.box.width - CELL_RULE_INSET_HEIGHTS * h,
    xRight: b.box.x + CELL_RULE_INSET_HEIGHTS * h,
    yLow: mid - band,
    yHigh: mid + band,
  });
}

/**
 * Split a line's words where the reading-direction gap exceeds ROW_SPLIT_GAP text heights (separate
 * columns) or, for horizontal lines with page geometry, where a printed rule separates them.
 * Returns parts; each part after the first records why it was split.
 */
export function splitLineWords(ws, vertical, geometry = null) {
  const along = (b) => (vertical ? [b.y, b.height, b.width] : [b.x, b.width, b.height]);
  const parts = [[ws[0]]];
  const reasons = [null];
  for (let i = 1; i < ws.length; i++) {
    const [p0, plen, ph] = along(ws[i - 1].box), [c0, , ch] = along(ws[i].box);
    const reason = c0 - (p0 + plen) > ROW_SPLIT_GAP * Math.max(ph, ch) ? "gap"
      : !vertical && cellRuleBetween(ws[i - 1], ws[i], geometry) ? "rule" : null;
    if (reason) { parts.push([]); reasons.push(reason); }
    parts.at(-1).push(ws[i]);
  }
  parts.reasons = reasons;
  return parts;
}

/** Text-layer spans of a layout (pdf.js text), padded by 2 pt. */
export function textLayerSpans(layout) {
  return (layout?.associations || [])
    .filter((a) => a.extractionMethod === "pdfjs-text-layer" && clean(a.text) && a.bbox)
    .map((a) => ({ text: clean(a.text), box: { x: a.bbox.x - 2, y: a.bbox.y - 2, width: a.bbox.width + 4, height: a.bbox.height + 4 } }));
}

const intersection = (a, b) => {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};
const isSubsequence = (needle, hay) => {
  let i = 0;
  for (const ch of needle) {
    i = hay.indexOf(ch, i);
    if (i < 0) return false;
    i += 1;
  }
  return true;
};

export const ECHO_MIN_COVERAGE = 0.5;
export const ECHO_MAX_CHARS = 3;

/**
 * A row that re-reads rendered text-layer glyphs: at least ECHO_MIN_COVERAGE of its box lies inside
 * text-layer spans, and it is a glyph fragment of them (at most ECHO_MAX_CHARS characters, a
 * subsequence of the span text and shorter than it) or a single-character duplicate. Longer rows
 * that agree with the text layer are real printed text read twice (fire-protection sheets carry
 * their notes and schedules in the text layer) and are kept. Returns the span texts or null.
 */
export function textLayerEcho(row, spans) {
  if (!spans?.length) return null;
  const key = textKey(row.text);
  if (!key || key.length > ECHO_MAX_CHARS) return null;
  const area = row.box.width * row.box.height || 1;
  const over = spans.filter((s) => intersection(row.box, s.box) > 0);
  if (!over.length) return null;
  const covered = Math.min(1, over.reduce((n, s) => n + intersection(row.box, s.box), 0) / area);
  if (covered < ECHO_MIN_COVERAGE) return null;
  const spanKey = textKey(over.map((s) => s.text).join(""));
  if (key.length > 1 && key.length >= spanKey.length) return null;
  return isSubsequence(key, spanKey) ? over.map((s) => s.text) : null;
}

/**
 * Rows from a recovery page with provenance. Options: geometry (page rules, for cell splits) and
 * textSpans (text-layer spans, for the echo filter). Returns { rows, echoes }.
 */
export function reconstructRows(page, options = {}) {
  const rows = rowsFromRecoveryPage(page, options);
  if (!options.textSpans?.length) return { rows, echoes: [] };
  const kept = [], echoes = [];
  for (const r of rows) {
    const spans = textLayerEcho(r, options.textSpans);
    if (spans) echoes.push({ rid: r.rid, text: r.text, box: r.box, textLayer: spans.slice(0, 3) });
    else kept.push(r);
  }
  return { rows: kept, echoes };
}

/** Rows from a recovery page. Each row keeps its words (text, box, confidence) for provenance. */
export function rowsFromRecoveryPage(page, options = {}) {
  const words = page?.words || [];
  const rows = [];
  for (const line of (page?.lines || []).filter((l) => clean(l.text) && l.box)) {
    const matched = lineWords(line, words);
    const parts = matched && matched.length > 1 ? splitLineWords(matched, line.vertical, options.geometry) : [matched || [{ text: line.text, box: line.box, confidence: line.confidence }]];
    for (const ws of parts) {
      rows.push({
        rid: `r${String(rows.length + 1).padStart(3, "0")}`,
        text: parts.length > 1 ? clean(ws.map((w) => w.text).join(" ")) : clean(line.text),
        box: roundBox(parts.length > 1 ? unionBox(ws.map((w) => w.box)) : line.box),
        vertical: Boolean(line.vertical),
        confidence: Math.min(...ws.map((w) => Number(w.confidence ?? 1))),
        words: ws.map((w) => ({
          text: clean(w.text), box: roundBox(w.box), confidence: Number(w.confidence ?? 1),
          ...(w.support != null ? { support: w.support, tiles: (w.agreeingTiles || []).length } : {}),
          ...(w.continuedFrom ? { continuedFrom: w.continuedFrom.map((s) => s.text) } : {}),
        })),
        ...(parts.length > 1 ? { splitFrom: clean(line.text), splitBy: [...new Set(parts.reasons.filter(Boolean))].join("+") } : {}),
      });
    }
  }
  return rows;
}
