/**
 * Stage 3 v2 sheet evidence model: rows resolved for overlapping readings, grouped
 * into annotations (callouts, notes, dimensions), classified and prioritised.
 *
 * Safety rules:
 * - Rows join one annotation only through a strong, unambiguous stacking link
 *   (similar text height, small gap, aligned edges, mutual nearest neighbours).
 *   Weaker relationships are never joined; both sides are flagged contextUncertain.
 * - Table cells (short rows with row-mates on the same baseline) are never stacked
 *   into column groups. With page geometry, the cells of one ruled table row form a
 *   record; ruled rows take no stacking links to rows outside them.
 * - Overlapping readings of similar text are kept as a conflict: the primary
 *   reading and its alternatives; none is promoted. Overlapping boxes with dissimilar
 *   text are different printed lines and stay separate rows.
 * - Format and glyph doubts are recorded as uncertainty reasons, never corrected.
 */
import { substringDistance } from "./stage3ObservationResolve.mjs";

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
 *          inside capitals, ° / * where an inch mark belongs, a fraction slash without a denominator
 *          or numerator, a letter where the inches of a feet-inches value belong (7"-q"), a 7-digit
 *          cold-formed steel designation (600S162-43 read as 6005162-43), a short symbol ending
 *          in l, or a one-letter symbol ending in I, before a number (Sd1 read as Sdl, S1 as SI),
 *          a | next to a digit, a letter between a number and its unit or a digit glued to a
 *          unit (57 KIPS read as 15T KIPS3);
 * inch_mark - a feet-inches value whose inch mark is missing or read as '.
 */
export function uncertaintyReasons(text) {
  const t = clean(text);
  const reasons = new Set();
  if (/\d[Il]|[Il]\d|(?:^|[\s(-])[Il][-/]\d|\d[-/][Il]\b|\b[Il]\/|\d\s*[°*]/.test(t) || /[A-Z]l\b|\bl[A-Z]/.test(t)
    || /(?:^|\s)\d+\/(?=\s|$)/.test(t) || /\b\d{7}-\d{2}\b/.test(t) || /\b[A-Za-z]{1,2}l\s+[\d.]/.test(t)
    || /\d\s*["']\s*-\s*[A-Za-z]{1,2}\s*["']/.test(t) || /(?:^|\s)\/\d/.test(t)
    || /\b[A-Za-z]I\s+[\d.]/.test(t) || /\|\d|\d\|/.test(t)
    || /\d[A-Za-z]\s+(?:PSF|PSI|KSI|MPH|KIPS?|GPM|PLF|LBS?)\b/.test(t) || /\b(?:PSF|PSI|KSI|MPH|KIPS?|GPM|PLF|LBS?)\d/.test(t)) reasons.add("glyph");
  if (/\d+\s*'\s*-?\s*\d+(?:\s+\d+\/\d+)?\s*'/.test(t) || /\d+\s*'\s*-\s*\d+(?:\s+\d+\/\d+)?(?![\d"/'°*])/.test(t)) reasons.add("inch_mark");
  return [...reasons];
}

// ---------- overlapping readings ----------
/** Readings of the same text: the shorter is within half its length in edits of part of the longer. */
export const SAME_TEXT_MAX_EDITS = 0.5;
export function similarReadings(a, b) {
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  return s.length > 0 && substringDistance(s, l) <= SAME_TEXT_MAX_EDITS * s.length;
}

/** Containment key: separators . , ; : become word breaks (a decimal point between digits stays). */
const containKey = (s) => ` ${norm(s).replace(/(?<!\d)[.,;:]|[.,;:](?!\d)/g, " ").replace(/\s+/g, " ").trim()} `;
const containedIn = (k, longer) => k.trim().length > 0 && containKey(longer).includes(k);

/** Shortest cut word for cutReading: shorter stems match too many words. */
export const CUT_STEM_MIN = 4;
/**
 * A reading cut at a tile edge inside a word whose last, partly seen glyph was misread
 * (DOOR 5 RESTROOM EXTERIC for ... EXTERIOR, 7 - ...): without its last letter it is contained in the
 * longer reading, where that word continues with other letters, and its box ends before the
 * longer box. Only a cut word qualifies, never a number: a cut number may be a different value.
 */
export function cutReading(short, long) {
  const s = containKey(short.text).trim(), l = containKey(long.text);
  const last = s.split(" ").pop();
  if (!/^[A-Z]+$/.test(last) || last.length - 1 < CUT_STEM_MIN) return false;
  const stem = ` ${s.slice(0, -1)}`;
  const at = l.indexOf(stem);
  if (at < 0 || !/[A-Z]/.test(l[at + stem.length] || "") || l[at + stem.length] === s.at(-1)) return false;
  return short.box.x + short.box.width < long.box.x + long.box.width;
}

/**
 * A reading that also covers the list number left of a longer reading which starts after it
 * (9. DOOR 5 against DOOR 5 RESTROOM EXTERIOR, ...): without the number it is contained in the
 * longer reading. Both are partial reads of one note, not competing readings.
 */
export function listNumberReading(short, long) {
  const m = clean(short.text).match(/^\(?\d{1,2}[.)]\s+(.+)$/);
  if (!m || LIST_ITEM.test(clean(long.text))) return false;
  return containedIn(containKey(m[1]), long.text) && short.box.x < long.box.x;
}

/**
 * Resolve rows that read the same place (same orientation, overlap >= 50% of the smaller box, similar
 * text): a reading contained in a longer one (the kept row or one of its alternatives, ignoring
 * separator punctuation) is absorbed, an identical one is a duplicate, a partial reading (cutReading,
 * listNumberReading) is absorbed and recorded in `cutReadings`, and a different one becomes an alternative of the kept row
 * (a conflict). Dense line spacing makes boxes of neighbouring lines overlap; with dissimilar text
 * they remain separate rows.
 */
export function resolveOverlaps(rows) {
  const ordered = [...rows].sort((a, b) => textKey(b.text).length - textKey(a.text).length || b.confidence - a.confidence);
  const kept = [];
  for (const row of ordered) {
    const k = textKey(row.text);
    let best = null, bestOverlap = 0;
    for (const other of kept) {
      if (other.vertical !== row.vertical || !similarReadings(k, textKey(other.text))) continue;
      const o = overlapSmaller(row.box, other.box);
      if (o >= 0.5 && o > bestOverlap) { best = other; bestOverlap = o; }
    }
    if (!best) { kept.push({ ...row, alternatives: [], absorbed: [], cutReadings: [] }); continue; }
    const bk = textKey(best.text);
    const ck = containKey(row.text);
    if (k === bk || bk.includes(k) || containedIn(ck, best.text)
      || best.alternatives.some((a) => containedIn(ck, a.text))) best.absorbed.push(row.rid);
    else if (cutReading(row, best) || listNumberReading(row, best)) {
      best.absorbed.push(row.rid);
      const kind = cutReading(row, best) ? "cut_word" : "list_number";
      if (!best.cutReadings.some((c) => c.text === row.text)) best.cutReadings.push({ rid: row.rid, kind, text: row.text, box: row.box, confidence: row.confidence });
    } else if (!best.alternatives.some((a) => textKey(a.text) === k)) best.alternatives.push({ rid: row.rid, text: row.text, box: row.box, confidence: row.confidence, words: row.words });
  }
  const order = new Map(rows.map((r, i) => [r.rid, i]));
  return kept.sort((a, b) => order.get(a.rid) - order.get(b.rid));
}

// ---------- format tie-break ----------
const GLYPH_DIGIT = { I: "1", l: "1", "|": "1", O: "0", o: "0" };
const glyphKey = (t) => t.replace(/[Il|Oo]/g, (c) => GLYPH_DIGIT[c]).replace(/["'″]/g, "").replace(/[.,;:]+$/, "");
const FEET_INCH_TOKEN = /^\(?\d+'-\d+(?:\s?\d+\/\d+)?"[.,;:)]?$/;
const NUMBER_TOKEN = /^[-(#]?\d+(?:[-/.,x]\d+)*["']?[.,;:)]?$/;
const SHEET_TOKEN = /^[A-Z]{1,2}-\d+(?:\.\d+)+[.,;:)]?$/;

/** Which of two tokens is the well-formed reading of the same glyphs: "a", "b", "neutral" or null. */
function tokenWinner(a, b) {
  if (a === b) return "same";
  if (glyphKey(a) !== glyphKey(b)) return null;
  const fa = FEET_INCH_TOKEN.test(a), fb = FEET_INCH_TOKEN.test(b);
  if (fa !== fb) return fa ? "a" : "b";
  const wa = NUMBER_TOKEN.test(a) || SHEET_TOKEN.test(a), wb = NUMBER_TOKEN.test(b) || SHEET_TOKEN.test(b);
  if (wa !== wb) return wa ? "a" : "b";
  return a.replace(/[.,;:]+$/, "") === b.replace(/[.,;:]+$/, "") ? "neutral" : null;
}

/** Whether reading `a` is the well-formed one against `b`: every differing token is won or neutral, one is won. */
function formatBeats(a, b) {
  const ta = clean(a).split(" "), tb = clean(b).split(" ");
  if (ta.length !== tb.length) return false;
  let won = false;
  for (let i = 0; i < ta.length; i += 1) {
    const w = tokenWinner(ta[i], tb[i]);
    if (w === null || w === "b") return false;
    if (w === "a") won = true;
  }
  return won;
}

/**
 * Resolve competing readings by format alone: readings that are identical except for glyphs Vision
 * confuses (I, l, | for 1; O for 0) or inch and foot marks, where one reading is a well-formed number,
 * dimension or sheet reference in every token where they differ. Any other difference keeps the
 * conflict. The rejected readings stay in `formatRejected`.
 */
export function formatTieBreak(row) {
  if (!row.alternatives?.length) return row;
  const readings = [{ text: row.text, words: row.words, confidence: row.confidence }, ...row.alternatives];
  const winner = readings.find((r) => readings.every((o) => o === r || formatBeats(r.text, o.text)));
  if (!winner) return row;
  return {
    ...row, text: winner.text, words: winner.words, confidence: winner.confidence, alternatives: [],
    formatRejected: readings.filter((r) => r !== winner).map((r) => r.text),
  };
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
const VALUE_END = /(?:\d(?:\.\d+)?\s*(?:PSF|PSI|KSI|MPH|KIPS?|GPM|PLF|LBS?|SF|%|"|')?|\b[A-F][,.] ASSUMED)\s*\)?[;:]?$/;
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

/** Design-data field: a label (no digits, or a short symbol) with one value at the end. */
const FIELD_ROW = /^(?:[A-Za-z][A-Za-z0-9]{0,3}=?|[A-Z][A-Z .'/&()-]*[A-Z.):=])\s*(?:\d[\d.]*|\.\d+)\s*(?:PSF|PSI|KSI|MPH|KIPS?|GPM|PLF|LBS?|SF|%)?\s*\)?$|^[A-Z][A-Z .'/&-]* [A-F][,.] ASSUMED$/;
/** A caption without a value: capitals only, at least two words. */
const BARE_LABEL = /^[A-Z][A-Z.'/&-]*(?: [A-Z.'/&-]+)+:?$/;

/**
 * Inside a design-data list (a stack with at least FIELD_LIST_MIN field rows), each field and each
 * bare caption is its own line: a value row never continues into the next caption. A caption
 * ending in ':' keeps its continuation (BASIC SEISMIC FORCE RESISTING SYSTEM: / ORD. PLAIN ...).
 * Counting captions towards the list as well split printed notes on A-3.06, so they do not count.
 */
export const FIELD_LIST_MIN = 3;
export function fieldListBoundary(upper, lower) {
  const a = clean(upper), b = clean(lower);
  if (/:$/.test(a)) return false;
  const fa = FIELD_ROW.test(a), fb = FIELD_ROW.test(b);
  const la = BARE_LABEL.test(a), lb = BARE_LABEL.test(b);
  return (fa && (fb || lb)) || (la && (fb || lb));
}

const BARE_DIMENSION = /^\d+(?:\s*'\s*-?\s*\d+(?:\s+\d+\/\d+)?\s*"?|\s*(?:\d+\/\d+\s*)?"|\s*')$/;
const QUALIFIER_ONLY = /^(?:MIN|MAX|TYP|CLR|CLEAR|EQ|NOM|V\.I\.F|A\.F\.F|O\.C)\.?$/i;
const LABEL = (t) => !/\d/.test(t) && /[A-Z]{3}/i.test(t) && !QUALIFIER_ONLY.test(t);

/**
 * A bare dimension stacked against a descriptive label: next to a dimension line the label may name
 * that dimension or a neighbouring element, which position alone cannot settle. Such a join is kept
 * but marked context-uncertain. A dimension with its qualifier (12" / MIN.) is not affected.
 */
export function dimensionLabelPair(upper, lower) {
  const a = clean(upper), b = clean(lower);
  return (BARE_DIMENSION.test(a) && LABEL(b)) || (BARE_DIMENSION.test(b) && LABEL(a));
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

// ---------- ruled table rows (records) ----------
const BAND_OVERSHOOT = 0.25;
const BAND_MAX_HEIGHTS = 5;
const GRID_MIN_RULES = 4;
const GRID_EXTENT_TOLERANCE = 2;
const GRID_REACH_BANDS = 6;
const spansBox = (rule, box) => rule.x0 <= box.x + 1 && rule.x1 >= box.x + box.width - 1;

/**
 * Row rules of the same table as `rule`: horizontal rules with the same extent within a few row
 * pitches. Dimension lines and detail frames do not repeat like this; schedule row lines do.
 */
function gridRuleCount(rule, geometry, pitch) {
  return geometry.horizontal.filter((r) => Math.abs(r.x0 - rule.x0) <= GRID_EXTENT_TOLERANCE
    && Math.abs(r.x1 - rule.x1) <= GRID_EXTENT_TOLERANCE && Math.abs(r.y - rule.y) <= GRID_REACH_BANDS * pitch).length;
}

/**
 * The table row band of a cell: the nearest horizontal rules above and below its centre that run
 * across the whole cell. Null when either is missing, the band is far taller than the text, or the
 * cell box crosses a band rule (an OCR box spanning two table rows).
 */
export function tableRowBand(cell, geometry) {
  const cy = cell.box.y + cell.box.height / 2;
  let above = null, below = null;
  for (const r of geometry?.horizontal || []) {
    if (!spansBox(r, cell.box)) continue;
    if (r.y >= cy && (!above || r.y < above.y)) above = r;
    if (r.y < cy && (!below || r.y > below.y)) below = r;
  }
  if (!above || !below) return null;
  const height = above.y - below.y;
  if (height > BAND_MAX_HEIGHTS * cell.box.height) return null;
  if (gridRuleCount(above, geometry, height) < GRID_MIN_RULES || gridRuleCount(below, geometry, height) < GRID_MIN_RULES) return null;
  const overshoot = Math.max(0, cell.box.y + cell.box.height - above.y) + Math.max(0, below.y - cell.box.y);
  return overshoot > BAND_OVERSHOOT * height ? null : { top: above.y, bottom: below.y, x0: above.x0, x1: above.x1 };
}

const COLUMN_RULE_MIN_BANDS = 1.5;

/** Two horizontal rows on the same text line with a gap between them. */
function sideBySideRows(a, b) {
  const h = Math.max(a.box.height, b.box.height);
  const sameLine = Math.abs((a.box.y + a.box.height / 2) - (b.box.y + b.box.height / 2)) <= 0.35 * h;
  return sameLine && (a.box.x + a.box.width <= b.box.x || b.box.x + b.box.width <= a.box.x);
}

/**
 * Table cells: rows inside a ruled table row band, with the band identity and the column index
 * (count of the band's column rules left of the row centre). Column rules are vertical rules
 * inside the table extent that cross the band and are longer than it. A cell's lines stack; a cell
 * holding rows side by side is not one cell (dimension linework, or a column rule that was not
 * detected), and its rows are grouped as ordinary rows. The band's other cells stay a table row.
 */
export function tableCells(rows, geometry) {
  const cells = new Map();
  if (!geometry?.horizontal?.length) return cells;
  for (const r of rows) {
    if (r.vertical || r.regionKind === "title_block") continue;
    const band = tableRowBand(r, geometry);
    if (!band) continue;
    const pitch = band.top - band.bottom;
    const columnRules = (geometry.vertical || []).filter((v) => v.x > band.x0 + 1 && v.x < band.x1 - 1
      && v.y0 <= band.bottom + 0.25 * pitch && v.y1 >= band.top - 0.25 * pitch && v.y1 - v.y0 >= COLUMN_RULE_MIN_BANDS * pitch);
    const cx = r.box.x + r.box.width / 2;
    cells.set(r.rid, { key: `${band.top}|${band.bottom}|${band.x0}|${band.x1}`, column: columnRules.filter((v) => v.x < cx).length });
  }
  const rowById = new Map(rows.map((r) => [r.rid, r]));
  const byCell = new Map();
  for (const [rid, c] of cells) {
    const k = `${c.key}#${c.column}`;
    if (!byCell.has(k)) byCell.set(k, []);
    byCell.get(k).push(rowById.get(rid));
  }
  for (const members of byCell.values()) {
    if (members.some((a, i) => members.slice(i + 1).some((b) => sideBySideRows(a, b)))) for (const r of members) cells.delete(r.rid);
  }
  return cells;
}

/**
 * Group rows into annotations. Strong links are kept only between mutual nearest neighbours,
 * never between table cells, and never into a new numbered list item. With page geometry, rows
 * inside a ruled table row take no stacking links: each cell (lines between the same column
 * rules) is read top to bottom, and a row with two or more occupied cells forms one record.
 */
export function groupAnnotations(rows, options = {}) {
  const frames = new Map(rows.map((r) => [r.rid, frame(r)]));
  const tableCell = new Map(rows.map((r) => [r.rid, textKey(r.text).length <= 14 && hasRowMate(r, rows, frames.get(r.rid))]));
  const cells = tableCells(rows, options.geometry);
  const below = new Map(), above = new Map(), weak = new Set();
  for (const a of rows) {
    if (cells.has(a.rid)) continue;
    const fa = frames.get(a.rid);
    let best = null, bestGap = Infinity;
    for (const b of rows) {
      if (a === b || a.vertical !== b.vertical || cells.has(b.rid)) continue;
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
  const stack = new Map(rows.map((r) => [r.rid, r.rid]));
  const stackOf = (x) => (stack.get(x) === x ? x : (stack.set(x, stackOf(stack.get(x))), stack.get(x)));
  for (const [a, b] of below) if (above.get(b) === a) stack.set(stackOf(b), stackOf(a));
  const fieldRows = new Map();
  if (options.fieldLists !== false) {
    for (const r of rows) if (FIELD_ROW.test(clean(r.text))) fieldRows.set(stackOf(r.rid), (fieldRows.get(stackOf(r.rid)) || 0) + 1);
  }
  const listRows = options.listRows || new Set();
  const inFieldList = (rid) => (fieldRows.get(stackOf(rid)) || 0) >= FIELD_LIST_MIN || listRows.has(rid);
  for (const [a, b] of below) {
    if (above.get(b) !== a) { contextUncertain.add(a); contextUncertain.add(b); continue; }
    if (tableCell.get(a) && tableCell.get(b)) continue;
    if (startsNewAnnotation(rowById.get(a).text, rowById.get(b).text)) continue;
    if (inFieldList(a) && fieldListBoundary(rowById.get(a).text, rowById.get(b).text)) continue;
    if (dimensionLabelPair(rowById.get(a).text, rowById.get(b).text)) { contextUncertain.add(a); contextUncertain.add(b); }
    parent.set(find(b), find(a));
  }
  for (const pair of weak) {
    const [a, b] = pair.split("|");
    if (find(a) !== find(b) && !(tableCell.get(a) && tableCell.get(b))) { contextUncertain.add(a); contextUncertain.add(b); }
  }
  const readingOrder = (p, q) => frames.get(q.rid).top - frames.get(p.rid).top || frames.get(p.rid).left - frames.get(q.rid).left;
  const groups = new Map();
  for (const r of rows) {
    if (cells.has(r.rid)) continue;
    const root = find(r.rid);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(r);
  }
  const out = [...groups.values()].map((members) => ({
    rows: members.sort(readingOrder), contextUncertain: members.some((m) => contextUncertain.has(m.rid)),
  }));
  const bands = new Map();
  for (const r of rows) {
    const c = cells.get(r.rid);
    if (!c) continue;
    if (!bands.has(c.key)) bands.set(c.key, new Map());
    const band = bands.get(c.key);
    if (!band.has(c.column)) band.set(c.column, []);
    band.get(c.column).push(r);
  }
  for (const band of bands.values()) {
    const columns = [...band.keys()].sort((p, q) => p - q).map((k) => band.get(k).sort(readingOrder));
    if (columns.length === 1) out.push({ rows: columns[0], contextUncertain: false });
    else out.push({ rows: columns.flat(), contextUncertain: false, layout: "record", cells: columns.map((c) => c.map((r) => r.rid)) });
  }
  return out;
}


// ---------- model ----------
const CLASS_ORDER = ["dimension", "elevation", "datum", "qualifier", "reference", "value", "numeric"];

function classPriority(classes) {
  const c = new Set(classes);
  if ((c.has("dimension") || c.has("value")) && (c.has("datum") || c.has("elevation"))) return 6;
  if (c.has("elevation")) return 6;
  if (c.has("dimension") && c.has("qualifier")) return 5;
  if (c.has("dimension") || c.has("value")) return 4;
  if (c.has("reference")) return 3;
  if (c.has("qualifier")) return 2;
  if (c.has("numeric")) return 1;
  return 0;
}

export function annotationPriority(a) {
  const c = new Set(a.classes);
  let p = classPriority(a.classes);
  if (p && a.rows.length > 1) p += 1;
  const chars = a.rows.reduce((n, r) => n + 3 + [r.text, ...(r.alternatives || []).map((x) => x.text)].reduce((m, t) => m + clean(t).length + 3, 0), 0);
  if (p && chars > 300) p = Math.max(1, p - 3);
  if (a.regionKind === "title_block") p = Math.max(0, p - 4);
  if (p && textKey(a.rows.map((r) => r.text).join("")).length <= 2 && !c.has("dimension")) p = Math.max(0, p - 1);
  return p;
}

// ---------- design-data lists ----------
/** Longest row of a design-data list member: field lines are short; note sentences are not. */
export const LIST_ROW_MAX = 60;

/**
 * Design-data lists: columns of short annotations (left edges within 1.2 row heights, vertical gaps
 * up to 1.6) holding at least FIELD_LIST_MIN field rows, plus short annotations whose centre lies
 * inside such a column (indented values, Cs= 0.095). Each field stays its own annotation; the list
 * id lets the digest select and show the fields together, so a caption printed without a value
 * (SEISMIC DESIGN CATEGORY) is shown in its list rather than dropped for having no number.
 * Returns a map aid -> list id.
 */
export function designDataLists(annotations, rowById) {
  const rowsOf = (a) => a.rows.map((rid) => rowById.get(rid));
  const eligible = annotations.filter((a) => !a.vertical && a.layout !== "record" && a.regionKind !== "title_block"
    && rowsOf(a).every((r) => clean(r.text).length <= LIST_ROW_MAX));
  const rowH = new Map(eligible.map((a) => [a.aid, Math.max(...rowsOf(a).map((r) => r.box.height))]));
  const parent = new Map(eligible.map((a) => [a.aid, a.aid]));
  const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
  for (const a of eligible) {
    let best = null, bestGap = Infinity;
    for (const b of eligible) {
      if (a === b) continue;
      const h = Math.max(rowH.get(a.aid), rowH.get(b.aid));
      const gap = a.box.y - (b.box.y + b.box.height);
      if (gap < -0.3 * h || gap > 1.6 * h || Math.abs(a.box.x - b.box.x) > 1.2 * h) continue;
      if (gap < bestGap) { best = b; bestGap = gap; }
    }
    if (best) parent.set(find(best.aid), find(a.aid));
  }
  const columns = new Map();
  for (const a of eligible) {
    const root = find(a.aid);
    if (!columns.has(root)) columns.set(root, []);
    columns.get(root).push(a);
  }
  const lists = [...columns.values()].filter((members) => members.length > 1
    && members.flatMap(rowsOf).filter((r) => FIELD_ROW.test(clean(r.text))).length >= FIELD_LIST_MIN);
  const listOf = new Map();
  lists.forEach((members, i) => { for (const a of members) listOf.set(a.aid, `L${i + 1}`); });
  const boxes = lists.map((members, i) => ({ id: `L${i + 1}`, box: union(members.map((a) => a.box)) }));
  for (const a of eligible) {
    if (listOf.has(a.aid)) continue;
    const cx = a.box.x + a.box.width / 2, cy = a.box.y + a.box.height / 2;
    const inside = boxes.filter(({ box }) => box.x <= a.box.x && cx <= box.x + box.width && cy >= box.y && cy <= box.y + box.height);
    if (inside.length) listOf.set(a.aid, inside.sort((p, q) => q.box.x - p.box.x)[0].id);
  }
  return listOf;
}

/**
 * Selection priority of a design-data list: that of one annotation holding all its fields (their
 * classes, several rows), so splitting a list into fields does not lower its standing in the budget.
 */
export function listPriority(classes) {
  const p = classPriority(classes);
  return p ? p + 1 : 0;
}

/**
 * Build the sheet evidence model from rows. regionOf(row) returns the layout region kind of a row
 * (or null). Annotation ids follow reading order.
 */
export function buildEvidenceModel(rawRows, options = {}) {
  const regionOf = options.regionOf || (() => null);
  const overlaps = resolveOverlaps(rawRows);
  const resolved = (options.formatTieBreak === false ? overlaps : overlaps.map(formatTieBreak)).map((r) => {
    const cls = classifyText(r.text);
    const altTechnical = r.alternatives.some((a) => classifyText(a.text).technical);
    const technical = cls.technical || altTechnical;
    return { ...r, technical, classes: cls.classes, uncertain: technical ? uncertaintyReasons(r.text) : [], regionKind: regionOf(r) };
  });
  const formatDoubts = new Map(resolved.map((r) => [r.rid, r.uncertain]));
  const rowById = new Map(resolved.map((r) => [r.rid, r]));
  const lists = options.designLists !== false;
  let annotations = annotate(groupAnnotations(resolved, { geometry: options.geometry, fieldLists: options.fieldLists }), formatDoubts);
  let listOf = lists ? designDataLists(annotations, rowById) : new Map();
  if (listOf.size && options.fieldLists !== false) {
    const listRows = new Set(annotations.filter((a) => listOf.has(a.aid)).flatMap((a) => a.rows));
    annotations = annotate(groupAnnotations(resolved, { geometry: options.geometry, listRows }), formatDoubts);
    listOf = designDataLists(annotations, rowById);
  }
  const listClasses = new Map();
  for (const a of annotations) {
    if (!listOf.has(a.aid)) continue;
    a.list = listOf.get(a.aid);
    listClasses.set(a.list, [...(listClasses.get(a.list) || []), ...a.classes]);
  }
  for (const a of annotations) if (a.list) a.listPriority = listPriority(listClasses.get(a.list));
  if (options.repeatedNotes !== false) markRepeatedReadings(resolved, annotations);
  return { rows: resolved, annotations };
}

/** Annotations from row groups, in reading order with ids; marks rows of unbalanced parenthesised groups truncated. */
function annotate(groups, formatDoubts) {
  for (const g of groups) for (const r of g.rows) r.uncertain = formatDoubts.get(r.rid);
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
      ...(g.layout ? { layout: g.layout, cells: g.cells } : {}),
      conflict: g.rows.some((r) => r.alternatives.length > 0),
      uncertain: [...new Set(g.rows.flatMap((r) => r.uncertain))],
    };
    a.priority = annotationPriority({ ...a, rows: g.rows });
    return a;
  });
  annotations.sort((p, q) => (q.box.y + q.box.height) - (p.box.y + p.box.height) || p.box.x - q.box.x);
  annotations.forEach((a, i) => { a.aid = `a${String(i + 1).padStart(3, "0")}`; });
  return annotations;
}

// ---------- repeated notes ----------
/** Digit pairs Vision misreads for each other in a printed number. */
const CONFUSABLE_DIGITS = new Set(["17", "08", "38", "56", "68", "89"]);
const REPEAT_MIN_CONTEXT = 8;
const numberCore = (tok) => tok.match(/^\(?(\d+(?:\.\d+)?)["']?[.,;:)]*$/)?.[1] ?? null;

function confusableNumbers(a, b) {
  if (a.length !== b.length || a === b) return false;
  let diff = 0, pair = "";
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === b[i]) continue;
    diff += 1;
    pair = [a[i], b[i]].sort().join("");
  }
  return diff === 1 && CONFUSABLE_DIGITS.has(pair);
}

/**
 * The same note printed at several places can be read with a different digit in one copy (A-4.00:
 * FROM 70 DEGREES at one place, FROM 10 DEGREES at two). A number whose surrounding words (at least
 * REPEAT_MIN_CONTEXT, unbroken) match another technical annotation at a separate place, and which
 * differs from it only by one confusable digit, gets `repeatedReadings` on its row: the readings of
 * all copies and their sources. Row text is not changed and no copy is preferred (majority may be
 * wrong). Numbers that differ otherwise are genuinely different notes and are not marked.
 */
export function markRepeatedReadings(rows, annotations) {
  const rowById = new Map(rows.map((r) => [r.rid, r]));
  const seqs = annotations
    .filter((a) => a.technical && a.layout !== "record" && a.regionKind !== "title_block")
    .map((a) => ({ a, toks: a.rows.flatMap((rid) => clean(rowById.get(rid).text).split(" ").map((t, i) => ({ rid, i, t, k: norm(t) }))) }));
  const index = new Map();
  const keysAt = (toks, i) => [
    `R|${toks.slice(i + 1, i + 4).map((x) => x.k).join(" ")}`,
    `L|${toks.slice(Math.max(0, i - 3), i).map((x) => x.k).join(" ")}`,
  ];
  for (const s of seqs) {
    s.toks.forEach((tok, i) => {
      if (!numberCore(tok.t)) return;
      for (const key of keysAt(s.toks, i)) {
        if (key.split(" ").length < 3) continue;
        if (!index.has(key)) index.set(key, []);
        index.get(key).push({ s, i });
      }
    });
  }
  const marks = new Map();
  const mark = (s, i, other, j) => {
    const tok = s.toks[i];
    const row = rowById.get(tok.rid);
    if (row.alternatives?.length) return;
    const id = `${tok.rid}#${tok.i}`;
    if (!marks.has(id)) marks.set(id, { row, index: tok.i, own: numberCore(tok.t), readings: new Set([numberCore(tok.t)]), sources: [] });
    const m = marks.get(id);
    m.readings.add(numberCore(other.toks[j].t));
    if (!m.sources.some((x) => x.aid === other.a.aid && x.rid === other.toks[j].rid)) m.sources.push({ aid: other.a.aid, rid: other.toks[j].rid });
  };
  for (const s of seqs) {
    s.toks.forEach((tok, i) => {
      const own = numberCore(tok.t);
      if (!own) return;
      const seen = new Set();
      for (const key of keysAt(s.toks, i)) {
        for (const { s: o, i: j } of index.get(key) || []) {
          if (o === s || seen.has(`${o.a.aid}#${j}`) || overlapSmaller(s.a.box, o.a.box) > 0) continue;
          seen.add(`${o.a.aid}#${j}`);
          if (!confusableNumbers(own, numberCore(o.toks[j].t) || "")) continue;
          let left = 0, right = 0;
          while (i - left - 1 >= 0 && j - left - 1 >= 0 && s.toks[i - left - 1].k === o.toks[j - left - 1].k) left += 1;
          while (i + right + 1 < s.toks.length && j + right + 1 < o.toks.length && s.toks[i + right + 1].k === o.toks[j + right + 1].k) right += 1;
          if (left + right >= REPEAT_MIN_CONTEXT) mark(s, i, o, j);
        }
      }
    });
  }
  for (const m of marks.values()) {
    m.row.repeatedReadings = [...(m.row.repeatedReadings || []), { index: m.index, own: m.own, readings: [...m.readings].sort(), sources: m.sources }];
  }
  for (const a of annotations) {
    if (a.rows.some((rid) => rowById.get(rid).repeatedReadings?.length)) a.repeatedConflict = true;
  }
}
