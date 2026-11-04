/**
 * Stage 3 v2 sheet evidence model: rows resolved for overlapping readings, grouped
 * into annotations (callouts, notes, dimensions), classified and prioritised.
 *
 * Safety rules:
 * - Rows join one annotation only through a strong, unambiguous stacking link
 *   (similar text height, small gap, aligned edges, mutual nearest neighbours).
 *   Weaker relationships are never joined; both sides are flagged contextUncertain.
 * - Table cells (short rows with row-mates on the same baseline) are never stacked
 *   into column groups.
 * - Overlapping readings with different text are kept as a conflict: the primary
 *   reading and its alternatives; none is promoted.
 * - Format and glyph doubts are recorded as uncertainty reasons, never corrected.
 */

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const norm = (s) => clean(s).toUpperCase()
  .replace(/[″“”〃]/g, '"').replace(/[’‘`´]/g, "'").replace(/[—–]/g, "-")
  .replace(/^[-_.•\s]+/, "").replace(/[-_\s]+$/, "").trim();
const textKey = (s) => norm(s).replace(/\s+/g, "");

export function overlapSmaller(a, b) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.min(a.width * a.height || 1, b.width * b.height || 1);
}
const union = (bs) => {
  const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
  const r = (v) => Math.round(v * 10) / 10;
  return { x: r(x), y: r(y), width: r(Math.max(...bs.map((b) => b.x + b.width)) - x), height: r(Math.max(...bs.map((b) => b.y + b.height)) - y) };
};

// ---------- classification ----------
const TECHNICAL_ROW = /\d|A\.F\.F|ELEV\.|\bMIN\b|V\.I\.F|\bTYP\b|@/i;
const FEET_INCH = /\d+\s*'\s*-?\s*\d+/;
const INCH = /\d+(?:[\s-]+\d+\s*\/\s*\d+)?\s*"|\b\d+\s*\/\s*\d+\s*"/;
const ELEVATION = /\bELEV\.?|\bEL\.\s*[+-]?\s*\d|[+-]\s*\d+\s*'/;
const DATUM = /A\.?F\.?F\b|\bT\.?O\.?\s|\bB\.?O\.?\s|\bFROM\b|\bABOVE\b|\bBELOW\b|\bFIN\.?\s*(?:FLR|FLOOR)|\bGRADE\b/;
const QUALIFIER = /\bMIN\b|\bMAX\b|\bTYP\b|V\.?I\.?F|\bCLR\b|\bEQ\b|\bSIM\b|\bNOM\b|O\/C|\bU\.?N\.?O\b/;
const REFERENCE = /\b[A-Z]{1,2}-?\d{1,2}\.\d{2}\b|\b\d{1,2}\s*\/\s*[A-Z]{1,2}-?\d/;
const UNIT_VALUE = /\d+(?:\.\d+)?\s*(?:PSF|PSI|KSI|MPH|KIPS?|GPM|PLF|LBS?|SF|MIL|GA\.?|HR\.?)\b|\b\d+\.\d+\b/;

export function classifyText(text) {
  const t = norm(text);
  const classes = [];
  if (FEET_INCH.test(t) || INCH.test(t)) classes.push("dimension");
  if (ELEVATION.test(t)) classes.push("elevation");
  if (DATUM.test(t)) classes.push("datum");
  if (QUALIFIER.test(t)) classes.push("qualifier");
  if (REFERENCE.test(t)) classes.push("reference");
  if (UNIT_VALUE.test(t)) classes.push("value");
  if (/\d/.test(t) && !classes.length) classes.push("numeric");
  return { technical: TECHNICAL_ROW.test(t), classes };
}

/**
 * Reasons to doubt a technical reading, from its format only:
 * glyph  - I or l where a digit belongs (next to digits, fractions or dimension marks), a lowercase l
 *          inside capitals, or ° / * where an inch mark belongs;
 *          inside capitals, a fraction slash without a denominator, a 7-digit cold-formed steel
 *          designation (600S162-43 read as 6005162-43), or a short symbol ending in l before a
 *          number (Sd1 read as Sdl);
 * inch_mark - a feet-inches value whose inch mark is missing or read as '.
 */
export function uncertaintyReasons(text) {
  const t = clean(text);
  const reasons = new Set();
  if (/\d[Il]|[Il]\d|(?:^|[\s(-])[Il][-/]\d|\d[-/][Il]\b|\b[Il]\/|\d\s*[°*]/.test(t) || /[A-Z]l\b|\bl[A-Z]/.test(t)
    || /(?:^|\s)\d+\/(?=\s|$)/.test(t) || /\b\d{7}-\d{2}\b/.test(t) || /\b[A-Za-z]{1,2}l\s+[\d.]/.test(t)) reasons.add("glyph");
  if (/\d+\s*'\s*-?\s*\d+(?:\s+\d+\/\d+)?\s*'/.test(t) || /\d+\s*'\s*-\s*\d+(?:\s+\d+\/\d+)?(?![\d"/'°*])/.test(t)) reasons.add("inch_mark");
  return [...reasons];
}

// ---------- overlapping readings ----------
/**
 * Resolve rows that read the same place (same orientation, overlap >= 50% of the smaller box):
 * a reading contained in a longer one is absorbed, an identical one is a duplicate, and a different
 * one becomes an alternative of the kept row (a conflict).
 */
export function resolveOverlaps(rows) {
  const ordered = [...rows].sort((a, b) => textKey(b.text).length - textKey(a.text).length || b.confidence - a.confidence);
  const kept = [];
  for (const row of ordered) {
    const k = textKey(row.text);
    let best = null, bestOverlap = 0;
    for (const other of kept) {
      if (other.vertical !== row.vertical) continue;
      const o = overlapSmaller(row.box, other.box);
      if (o >= 0.5 && o > bestOverlap) { best = other; bestOverlap = o; }
    }
    if (!best) { kept.push({ ...row, alternatives: [], absorbed: [] }); continue; }
    const bk = textKey(best.text);
    if (k === bk || bk.includes(k)) best.absorbed.push(row.rid);
    else if (!best.alternatives.some((a) => textKey(a.text) === k)) best.alternatives.push({ rid: row.rid, text: row.text, box: row.box, confidence: row.confidence, words: row.words });
  }
  const order = new Map(rows.map((r, i) => [r.rid, i]));
  return kept.sort((a, b) => order.get(a.rid) - order.get(b.rid));
}

// ---------- grouping ----------
/** Reading frame: horizontal rows as is; vertical rows (rotated, read bottom to top) turned upright. */
function frame(row) {
  const b = row.box;
  if (!row.vertical) return { left: b.x, right: b.x + b.width, top: b.y + b.height, bottom: b.y, h: b.height };
  return { left: b.y, right: b.y + b.height, top: -b.x, bottom: -(b.x + b.width), h: b.width };
}

function hasRowMate(row, rows, f) {
  return rows.some((o) => {
    if (o === row || o.vertical !== row.vertical) return false;
    const g = frame(o);
    const sameLine = Math.abs((g.top + g.bottom) / 2 - (f.top + f.bottom) / 2) <= 0.35 * Math.max(f.h, g.h);
    const gap = Math.max(g.left - f.right, f.left - g.right);
    return sameLine && gap > 0 && gap <= 12 * Math.max(f.h, g.h);
  });
}

const LIST_ITEM = /^\(?\d{1,2}[.)]\s/;
const ABBREVIATION_END = /\b(?:A\.F\.F|EXIST|NEW|ELEV|EQ|SIM|NO|EA|O\.C|DIA|TYP|MIN|MAX|V\.I\.F|REQ'D|CONT|CLR|NOM|GA|GYP|BD|T\.O|B\.O)\.\)?$/i;
const CONNECTOR_END = /(?:\b(?:FROM|TO|AT|OF|WITH|AND|OR|FOR|IN|ON|BY|THE|A)|[@+&,\-/])\s*$/i;
const VALUE_END = /(?:\d(?:\.\d+)?\s*(?:PSF|PSI|KSI|MPH|KIPS?|GPM|PLF|LBS?|SF|%|"|')?|\bD, ASSUMED)\s*\)?$/;
const SYMBOL_VALUE = /^[A-Za-z][A-Za-z0-9]{0,3}=?\s+[\d.]+$/;
const BUBBLE_NUMBER = /^\d{1,2}[A-Z]?$/;
const SHEET_REFERENCE = /^[A-Z]{1,2}-?\d{1,2}\.\d{2}$/;

/**
 * Text boundaries between vertically stacked rows: the lower row starts a new annotation.
 * Each cue was measured on the phase 1 ground truth (it never splits a printed annotation there):
 * sentence end, leader dash, (E)/(N) label, numbered list item, a row starting with a number after a
 * row that does not continue into it, and parallel label/value lines.
 */
export function startsNewAnnotation(upper, lower) {
  const a = clean(upper), b = clean(lower);
  if (/\.\s*\)?$/.test(a) && !ABBREVIATION_END.test(a)) return true;
  if (/^[-–•]\s?\S/.test(b)) return true;
  if (/^\((?:E|N|EX)\)\s/i.test(b)) return true;
  if (LIST_ITEM.test(b)) return true;
  if (/^\d/.test(b) && !CONNECTOR_END.test(a) && !/^\d{2,4}[A-Z]?$/.test(b)) return true;
  if (VALUE_END.test(a) && VALUE_END.test(b) && /[A-Z]{3}/.test(a) && /[A-Z]{3}/.test(b)) return true;
  if (/[A-Z]:\s*\S/.test(a) && /[A-Z]:(\s|$)/.test(b)) return true;
  if (SYMBOL_VALUE.test(a) && SYMBOL_VALUE.test(b)) return true;
  return false;
}

/** Link strength between an upper row a and a lower row b (in reading frame). */
function link(a, fa, b, fb) {
  const h = Math.max(fa.h, fb.h);
  const bubble = BUBBLE_NUMBER.test(clean(a.text)) && SHEET_REFERENCE.test(clean(b.text));
  if (Math.max(fa.h, fb.h) / Math.max(0.1, Math.min(fa.h, fb.h)) > (bubble ? 2.5 : 1.4)) return null;
  const gap = fa.bottom - fb.top;
  if (gap < -0.3 * h || gap > 1.6 * h) return null;
  const overlap = Math.min(fa.right, fb.right) - Math.max(fa.left, fb.left);
  const narrower = Math.min(fa.right - fa.left, fb.right - fb.left);
  const leftAligned = Math.abs(fa.left - fb.left) <= 1.2 * h;
  const centred = Math.abs((fa.left + fa.right) / 2 - (fb.left + fb.right) / 2) <= 1.5 * h && overlap >= 0.5 * narrower;
  if (gap <= 0.8 * h && (leftAligned || centred)) return "strong";
  if (overlap > 0 || Math.abs(fa.left - fb.left) <= 2 * h) return "weak";
  return null;
}

/**
 * Group rows into annotations. Strong links are kept only between mutual nearest neighbours,
 * never between table cells, and never into a new numbered list item.
 */
export function groupAnnotations(rows) {
  const frames = new Map(rows.map((r) => [r.rid, frame(r)]));
  const tableCell = new Map(rows.map((r) => [r.rid, textKey(r.text).length <= 14 && hasRowMate(r, rows, frames.get(r.rid))]));
  const below = new Map(), above = new Map(), weak = new Set();
  for (const a of rows) {
    const fa = frames.get(a.rid);
    let best = null, bestGap = Infinity;
    for (const b of rows) {
      if (a === b || a.vertical !== b.vertical) continue;
      const fb = frames.get(b.rid);
      if (fb.top > fa.top) continue;
      const kind = link(a, fa, b, fb);
      if (!kind) continue;
      const gap = fa.bottom - fb.top;
      if (kind === "weak") { weak.add(`${a.rid}|${b.rid}`); continue; }
      if (gap < bestGap) { best = b; bestGap = gap; }
    }
    if (best) below.set(a.rid, best.rid);
  }
  for (const [a, b] of below) {
    const prev = above.get(b);
    if (prev) above.set(b, frames.get(prev).bottom - frames.get(b).top <= frames.get(a).bottom - frames.get(b).top ? prev : a);
    else above.set(b, a);
  }
  const parent = new Map(rows.map((r) => [r.rid, r.rid]));
  const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
  const rowById = new Map(rows.map((r) => [r.rid, r]));
  const contextUncertain = new Set();
  for (const [a, b] of below) {
    if (above.get(b) !== a) { contextUncertain.add(a); contextUncertain.add(b); continue; }
    if (tableCell.get(a) && tableCell.get(b)) continue;
    if (startsNewAnnotation(rowById.get(a).text, rowById.get(b).text)) continue;
    parent.set(find(b), find(a));
  }
  for (const pair of weak) {
    const [a, b] = pair.split("|");
    if (find(a) !== find(b) && !(tableCell.get(a) && tableCell.get(b))) { contextUncertain.add(a); contextUncertain.add(b); }
  }
  const groups = new Map();
  for (const r of rows) {
    const root = find(r.rid);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(r);
  }
  return [...groups.values()].map((members) => {
    members.sort((p, q) => frames.get(q.rid).top - frames.get(p.rid).top || frames.get(p.rid).left - frames.get(q.rid).left);
    return { rows: members, contextUncertain: members.some((m) => contextUncertain.has(m.rid)) };
  });
}

// ---------- model ----------
const CLASS_ORDER = ["dimension", "elevation", "datum", "qualifier", "reference", "value", "numeric"];

export function annotationPriority(a) {
  const c = new Set(a.classes);
  let p = 0;
  if ((c.has("dimension") || c.has("value")) && (c.has("datum") || c.has("elevation"))) p = 6;
  else if (c.has("elevation")) p = 6;
  else if (c.has("dimension") && c.has("qualifier")) p = 5;
  else if (c.has("dimension") || c.has("value")) p = 4;
  else if (c.has("reference")) p = 3;
  else if (c.has("qualifier")) p = 2;
  else if (c.has("numeric")) p = 1;
  if (p && a.rows.length > 1) p += 1;
  const chars = a.rows.reduce((n, r) => n + 3 + [r.text, ...(r.alternatives || []).map((x) => x.text)].reduce((m, t) => m + clean(t).length + 3, 0), 0);
  if (p && chars > 300) p = Math.max(1, p - 3);
  if (a.regionKind === "title_block") p = Math.max(0, p - 4);
  if (p && textKey(a.rows.map((r) => r.text).join("")).length <= 2 && !c.has("dimension")) p = Math.max(0, p - 1);
  return p;
}

/**
 * Build the sheet evidence model from rows. regionOf(row) returns the layout region kind of a row
 * (or null). Annotation ids follow reading order.
 */
export function buildEvidenceModel(rawRows, options = {}) {
  const regionOf = options.regionOf || (() => null);
  const resolved = resolveOverlaps(rawRows).map((r) => {
    const cls = classifyText(r.text);
    const altTechnical = r.alternatives.some((a) => classifyText(a.text).technical);
    const technical = cls.technical || altTechnical;
    return { ...r, technical, classes: cls.classes, uncertain: technical ? uncertaintyReasons(r.text) : [], regionKind: regionOf(r) };
  });
  const groups = groupAnnotations(resolved);
  for (const g of groups) {
    const parens = (s) => (s.match(/\(/g) || []).length - (s.match(/\)/g) || []).length;
    if (parens(g.rows.map((r) => r.text).join(" ")) === 0) continue;
    for (const r of g.rows) if (parens(r.text) !== 0 && !r.uncertain.includes("truncated")) r.uncertain = [...r.uncertain, "truncated"];
  }
  const annotations = groups.map((g) => {
    const classes = CLASS_ORDER.filter((c) => g.rows.some((r) => r.classes.includes(c) || r.alternatives.some((a) => classifyText(a.text).classes.includes(c))));
    const kinds = g.rows.map((r) => r.regionKind).filter(Boolean);
    const regionKind = kinds.sort((a, b) => kinds.filter((x) => x === b).length - kinds.filter((x) => x === a).length)[0] || null;
    const a = {
      rows: g.rows.map((r) => r.rid),
      box: union(g.rows.map((r) => r.box)),
      vertical: g.rows[0].vertical,
      technical: g.rows.some((r) => r.technical),
      classes,
      regionKind,
      contextUncertain: g.contextUncertain,
      conflict: g.rows.some((r) => r.alternatives.length > 0),
      uncertain: [...new Set(g.rows.flatMap((r) => r.uncertain))],
    };
    a.priority = annotationPriority({ ...a, rows: g.rows });
    return a;
  });
  annotations.sort((p, q) => (q.box.y + q.box.height) - (p.box.y + p.box.height) || p.box.x - q.box.x);
  annotations.forEach((a, i) => { a.aid = `a${String(i + 1).padStart(3, "0")}`; });
  return { rows: resolved, annotations };
}
