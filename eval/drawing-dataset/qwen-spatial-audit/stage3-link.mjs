#!/usr/bin/env node
/**
 * Stage 3: cross-sheet spatial linking (offline, no model calls).
 *
 * Inputs: the 82-sheet index (index82.json: file names, sheet keys, text-layer detail titles) and
 * the stage 2 sheet index of each primary drawing. Outputs, per backend:
 *   references   every cross-sheet or detail reference found in Qwen lines or the text layer
 *   resolutions  target file, target detail and target region, or why it did not resolve
 *   pairs        source and target regions (page points) for crop rendering and stage 4
 *   comparisons  value checks between paired evidence (opening forces, door marks, heights)
 *   targeted     tiles of non-primary sheets that a resolved reference needs read
 *
 * A reference resolves to a sheet only through the 82-sheet index. A detail resolves only when the
 * target sheet prints that detail number in its text layer (or in the Qwen lines of a primary sheet).
 * Regions are approximate (title-anchored) and marked as such. No relationship is marked verified.
 *
 * Usage: node stage3-link.mjs [--backend local-3b] [--subset]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.resolve(HERE, "../out/qwen-spatial-audit");
const PRIMARY = ["A-3.06-00", "A-4.00-00", "A-1.01-00", "A-6.00-00", "S-201.00"];
const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const backend = arg("backend", "local-3b");
const subset = process.argv.includes("--subset");
const variant = arg("variant", "");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

/** Same canonical key as run.py canonical_sheet. */
export function canonicalSheet(label) {
  const s = String(label || "").toUpperCase().replace(/\.PDF$/, "").trim();
  const m = s.match(/^([A-Z]{1,2})-?(\d{1,3})(?:\.(\d{1,2}))?/);
  if (!m) return null;
  let [, pre, num, dec] = m;
  if (pre === "S" && num.length === 3) return `S-${num}`;
  if (dec === undefined && num.length === 3 && ["A", "E", "M", "P"].includes(pre)) { dec = num.slice(1); num = num[0]; }
  return dec !== undefined ? `${pre}-${Number(num)}.${dec}` : `${pre}-${num}`;
}

const SHEET_TOKEN = /\b([A-Z]{1,2})-?(\d{1,3})(?:\.(\d{1,2}))?(?:-\d{1,2})?\b/g;
const CUE = /\b(SEE|REFER|REF\.?|SHEET|SHT\.?|DETAIL|DTL\.?|ON|PER|FOR)\b/;
const DETAIL_NUM = /^\d{1,2}[A-Z]?$/;

/** Sheet keys an index knows, with lookups for detail titles. */
export function buildIndex(index82) {
  const byKey = new Map();
  for (const s of index82.sheets) if (s.sheetKey && s.status === "indexed") byKey.set(s.sheetKey, s);
  return { byKey, lookup: (raw) => byKey.get(canonicalSheet(raw)) || null };
}

const center = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const near = (a, b, dx, dy) => Math.abs(center(a).x - center(b).x) <= dx && Math.abs(center(a).y - center(b).y) <= dy;

/** References in one sheet's lines: inline sheet notes, `n/SHEET` callouts and stacked bubbles. */
export function findReferences(sheetKey, allLines, idx, { titleBlockX = 0.85 * 2592 } = {}) {
  const refs = [];
  const lines = allLines.filter((l) => l.box.x < titleBlockX);
  for (const l of lines) {
    const text = String(l.text || "").toUpperCase();
    const inline = [...text.matchAll(/\b(\d{1,2}[A-Z]?)\s*\/\s*([A-Z]{1,2}-?\d{1,3}(?:\.\d{1,2})?)\b/g)];
    for (const m of inline) refs.push({ kind: "detail_callout_inline", detail: m[1], target: m[2], line: l, topic: null });
    if (inline.length) continue;
    if (isBare(l)) continue;
    const tokens = [...text.matchAll(SHEET_TOKEN)].map((m) => m[0]).filter((t) => canonicalSheet(t) && canonicalSheet(t) !== sheetKey);
    if (!tokens.length) continue;
    const cued = CUE.test(text);
    for (const t of tokens) {
      const known = Boolean(idx.lookup(t));
      if (!cued && !known) continue;
      const after = text.slice(text.indexOf(t) + t.length);
      const topic = (after.match(/^\s*(?:FOR|OF)\s+([A-Z][A-Z ]{2,30}?)(?=\s+AND\b|[,.;]|$)/) || [])[1] || null;
      refs.push({ kind: "sheet_note", detail: null, target: t, line: l, topic: topic?.trim() || null, cued });
    }
  }
  // Stacked bubble: a short detail number directly above a bare sheet token (section and detail marks).
  // Hand-lettered fonts draw 1, 0 and 9 like I, O and q; such a bubble number is only a candidate,
  // kept as printed in `bubblePrinted`, and resolves only if the target sheet prints that detail.
  const bubbleNumber = (t) => {
    const raw = String(t).trim();
    if (DETAIL_NUM.test(raw)) return { detail: raw };
    const digits = raw.replace(/[Il|]/g, "1").replace(/[Oo]/g, "0").replace(/q/g, "9");
    return digits !== raw && DETAIL_NUM.test(digits) && /\d/.test(digits) ? { detail: digits, printed: raw } : null;
  };
  for (const s of lines.filter(isBare)) {
    if (!idx.lookup(s.text)) continue;
    const top = lines.find((n) => n !== s && bubbleNumber(n.text) && n.box.y > s.box.y
      && near(n.box, s.box, Math.max(s.box.width, 30), 3 * Math.max(s.box.height, 8)));
    if (top) {
      const b = bubbleNumber(top.text);
      refs.push({ kind: "detail_bubble", detail: b.detail, target: String(s.text).trim(), line: s, bubbleLine: top, topic: null, ...(b.printed ? { bubblePrinted: b.printed } : {}) });
    }
    else if (canonicalSheet(s.text) !== sheetKey) refs.push({ kind: "sheet_tag", detail: null, target: String(s.text).trim(), line: s, topic: null });
  }
  return refs;
}

const LOOKALIKE = { I: "1", L: "1", "|": "1", O: "0", Q: "9" };
const SHEETISH = /\b([A-Z]{1,2})-([0-9IOLQ|]{1,3}(?:\.[0-9IOLQ|]{1,2})?)\b/g;

/**
 * Sheet tokens with look-alike glyphs in the number (A-3.0I, A-4.0I, A-I.03) resolved against the
 * sheet index: only when the digit form is a known sheet and the printed form is not. Returns lines
 * for reference detection with the digit form substituted and `refLookalike` recording the change;
 * the stage 2 line (text, uncertainty, value checks) is not modified.
 */
export function resolveLookalikeRefs(lines, idx) {
  return lines.map((l) => {
    const text = String(l.text || "");
    const changes = [];
    const fixed = text.toUpperCase().replace(SHEETISH, (tok, pre, num) => {
      if (!/[IOLQ|]/.test(num)) return tok;
      const cand = `${pre}-${num.replace(/[IOLQ|]/g, (c) => LOOKALIKE[c])}`;
      const known = idx.lookup(cand);
      if (!known || idx.lookup(tok)) { changes.push({ printed: tok, candidate: cand, status: known ? "printed_form_also_known" : "candidate_not_in_sheet_index" }); return tok; }
      changes.push({ printed: tok, candidate: cand, sheetKey: known.sheetKey, status: "resolved_by_sheet_index" });
      return cand;
    });
    if (!changes.length) return l;
    return { ...l, text: changes.some((c) => c.status === "resolved_by_sheet_index") ? fixed : l.text, printedText: l.text, refLookalike: changes };
  });
}

function isBare(l) {
  const t = String(l.text || "").trim().toUpperCase();
  return t.length <= 10 && /^[A-Z]{1,2}-?\d[\d.]*(?:-\d{1,2})?$/.test(t) && Boolean(canonicalSheet(t));
}

/** Approximate region of a detail: from its title upward, bounded by the nearest titles above and to the right. */
export function detailRegion(detail, allDetails, page) {
  const t = detail.titleBox;
  const others = allDetails.filter((d) => d !== detail);
  const right = others.filter((d) => d.titleBox.x > t.x + 20 && Math.abs(d.titleBox.y - t.y) < 200).map((d) => d.titleBox.x);
  const above = others.filter((d) => d.titleBox.y > t.y + 20 && d.titleBox.x < t.x + 600 && d.titleBox.x + d.titleBox.width > t.x - 100).map((d) => d.titleBox.y);
  const x0 = Math.max(0, t.x - 40);
  const x1 = Math.min(page[0] * 0.86, right.length ? Math.min(...right) - 10 : t.x + 900);
  const y0 = Math.max(0, t.y - 20);
  const y1 = Math.min(page[1] - 30, above.length ? Math.min(...above) - 10 : t.y + 700);
  return { x: x0, y: y0, width: Math.max(50, x1 - x0), height: Math.max(50, y1 - y0) };
}

const TOPIC_DETAILS = [
  [/DOOR/, /DOOR (SCHEDULE|HARDWARE)/], [/WINDOW/, /WINDOW/], [/FINISH|FLOOR/, /FLOOR|FINISH|WALL/], [/PARTITION/, /PARTITION/],
  [/GUARD/, /GUARD/], [/TOILET|RESTROOM/, /TOILET/], [/STAIR/, /STAIR/], [/ROOF/, /ROOF/],
];

export function resolveReference(ref, idx, sheetIndexes) {
  const target = idx.lookup(ref.target);
  if (!target) return { status: "not_in_82_sheet_index", targetKey: canonicalSheet(ref.target) };
  const printed = String(ref.target).trim().toUpperCase();
  const out = {
    status: "sheet_resolved", targetKey: target.sheetKey, fileName: target.fileName, inPrimary: PRIMARY.some((p) => canonicalSheet(p) === target.sheetKey),
    printedToken: printed, printedMatchesIndexKey: printed === target.sheetKey, sameSheet: false,
  };
  let detail = null;
  if (ref.detail) {
    detail = (target.details || []).find((d) => d.detail === ref.detail) || null;
    if (!detail) return { ...out, status: "detail_not_found_on_target", detailRequested: ref.detail, targetDetails: (target.details || []).map((d) => d.detail) };
  } else if (ref.topic) {
    const rule = TOPIC_DETAILS.find(([topic]) => topic.test(ref.topic));
    detail = rule ? (target.details || []).find((d) => rule[1].test(d.title)) || null : null;
  }
  if (!detail) return { ...out, targetRegion: null, regionMethod: "whole_sheet (no detail number or topic match)" };
  return {
    ...out, status: ref.detail ? "detail_resolved" : "topic_resolved",
    detail: { number: detail.detail, title: detail.title, scale: detail.scale, titleBox: detail.titleBox },
    targetRegion: detailRegion(detail, target.details, target.page), regionMethod: "approximate: above the text-layer detail title, bounded by neighbouring titles",
  };
}

/** Tiles of a sheet's stage 1 grid that intersect a region (for a targeted stage 2 pass). */
function tilesFor(region, stage1) {
  return stage1.tiles.filter((t) => !t.skipped && t.pageBox.x < region.x + region.width && t.pageBox.x + t.pageBox.width > region.x
    && t.pageBox.y < region.y + region.height && t.pageBox.y + t.pageBox.height > region.y).map((t) => t.id);
}

const LBS = /(\d+(?:\s+\d\/\d)?|\d+\.\d+)\s*(?:LBS?|LBF|POUNDS)\b/;
/** Opening-force statements: value, condition words and source. Different conditions are not a conflict. */
export function openingForces(sheetKey, lines) {
  const out = [];
  for (const l of lines) {
    const t = String(l.text).toUpperCase();
    const m = t.match(LBS);
    if (!m || !/(DOOR|OPEN|PUSH|PULL|FORCE|HARDWARE)/.test(t)) continue;
    const condition = [/EXTERIOR/.test(t) && "exterior", /INTERIOR/.test(t) && "interior", /FIRE/.test(t) && "fire door", /SLIDING|FOLDING/.test(t) && "sliding/folding"].filter(Boolean);
    out.push({ sheet: sheetKey, lid: l.lid || null, text: l.text, value: m[1].replace(/\s+/g, " "), condition: condition.length ? condition : ["unstated"], box: l.box, source: l.source || "qwen" });
  }
  return out;
}

export function compareOpeningForces(statements) {
  const byCond = new Map();
  for (const s of statements) for (const c of s.condition) byCond.set(c, [...(byCond.get(c) || []), s]);
  const comparisons = [];
  for (const [cond, ss] of byCond) {
    const values = [...new Set(ss.map((s) => s.value))];
    const sheets = [...new Set(ss.map((s) => s.sheet))];
    comparisons.push({
      field: "door opening force", condition: cond, values, sheets,
      status: values.length > 1 ? (cond === "unstated" ? "values_differ_condition_unstated" : "candidate_contradiction") : sheets.length > 1 ? "consistent_across_sheets" : "single_sheet",
      evidence: ss.map((s) => ({ sheet: s.sheet, text: s.text, box: s.box, lid: s.lid })),
    });
  }
  return comparisons;
}

/** Door marks in a plan's tag-like lines that the schedule does / does not list (candidates only). */
export function doorMarks(planLines, scheduleLines, scheduleRegion) {
  const inRegion = (b) => !scheduleRegion || (center(b).x >= scheduleRegion.x && center(b).x <= scheduleRegion.x + scheduleRegion.width && center(b).y >= scheduleRegion.y && center(b).y <= scheduleRegion.y + scheduleRegion.height);
  const schedule = new Set(scheduleLines.filter((l) => inRegion(l.box) && /^\d{1,2}[A-Z]?$/.test(String(l.text).trim())).map((l) => String(l.text).trim()));
  const tags = planLines.filter((l) => l.category === "room_or_tag" && /^\d{1,2}[A-Z]?$/.test(String(l.text).trim()));
  return {
    scheduleMarks: [...schedule].sort((a, b) => parseInt(a) - parseInt(b)),
    planTags: tags.map((l) => ({ text: String(l.text).trim(), box: l.box, lid: l.lid })),
    planTagsNotInSchedule: tags.filter((l) => !schedule.has(String(l.text).trim())).map((l) => String(l.text).trim()),
    note: "Plan tags are Qwen 'room_or_tag' lines that are bare numbers; room numbers and door marks are not separated, so mismatches are candidates for review only.",
  };
}

function main() {
  const index82 = readJson(path.join(OUT, "index82.json"));
  const idx = buildIndex(index82);
  const sheetIndexes = new Map();
  for (const s of PRIMARY) {
    const p = path.join(OUT, "sheets", s, "stage2", `sheet-index.${backend}${subset ? ".subset" : ""}${variant ? `.${variant}` : ""}.json`);
    if (existsSync(p)) sheetIndexes.set(s, readJson(p));
  }
  const stage1 = new Map(PRIMARY.map((s) => [s, readJson(path.join(OUT, "sheets", s, "stage1", "stage1.json"))]));
  const references = [];
  const forces = [];
  const lookalikes = [];
  for (const s of PRIMARY) {
    const key = canonicalSheet(s);
    const tl = stage1.get(s).textLayer.lines.map((l, i) => ({ ...l, lid: `T${i}`, source: "text_layer" }));
    const q = resolveLookalikeRefs((sheetIndexes.get(s)?.lines || []).map((l) => ({ ...l, source: "qwen" })), idx);
    for (const l of q.filter((x) => x.refLookalike)) lookalikes.push({ sheet: s, lid: l.lid, printed: l.printedText, uncertain: Boolean(l.uncertain), box: l.box, checks: l.refLookalike });
    for (const [src, lines] of [["text_layer", tl], ["qwen", q]]) {
      for (const r of findReferences(key, lines, idx)) {
        references.push({ sourceSheet: s, source: src, kind: r.kind, raw: r.line.printedText || r.line.text, detail: r.detail, target: r.target, topic: r.topic,
          sourceBox: r.line.box, lid: r.line.lid, bubble: r.bubbleLine ? { text: r.bubbleLine.text, box: r.bubbleLine.box } : undefined,
          ...(r.line.refLookalike ? { targetFromLookalike: r.line.refLookalike, readingUncertain: Boolean(r.line.uncertain) } : {}),
          ...(r.bubblePrinted ? { bubblePrinted: r.bubblePrinted } : {}) });
      }
    }
    forces.push(...openingForces(key, q));
  }
  // One reference per (sheet, target, detail, topic, place); the Qwen and text-layer copies of one note collapse.
  const seen = new Map();
  for (const r of references) {
    const k = `${r.sourceSheet}|${canonicalSheet(r.target)}|${r.detail}|${r.topic}|${Math.round(r.sourceBox.x / 60)}|${Math.round(r.sourceBox.y / 60)}`;
    if (!seen.has(k)) seen.set(k, { ...r, sources: [r.source] });
    else seen.get(k).sources.push(r.source);
  }
  const refs = [...seen.values()].map((r, i) => {
    const resolution = resolveReference(r, idx, sheetIndexes);
    if (resolution.targetKey === canonicalSheet(r.sourceSheet)) resolution.sameSheet = true;
    return { refId: `R${String(i).padStart(3, "0")}`, ...r, resolution };
  });

  const pairs = [], targeted = new Map();
  for (const r of refs) {
    const res = r.resolution;
    if (!res.fileName) continue;
    const srcFile = idx.lookup(r.sourceSheet)?.fileName || `${r.sourceSheet}.pdf`;
    const pageOf = (f) => index82.sheets.find((s) => s.fileName === f)?.page || [2592, 1728];
    const [pw, ph] = pageOf(srcFile);
    const sb = r.sourceBox;
    const sourceCrop = { x: Math.max(0, sb.x - 150), y: Math.max(0, sb.y - 100), width: Math.min(pw, sb.width + 300), height: Math.min(ph, sb.height + 200) };
    const targetCrop = res.targetRegion || null;
    pairs.push({
      pairId: `P-${r.refId}`, refId: r.refId,
      kind: r.detail ? "plan_to_detail" : /DOOR|WINDOW|SCHEDULE|FINISH/.test(r.topic || "") ? "plan_to_schedule" : "note_to_sheet",
      source: { sheet: r.sourceSheet, fileName: srcFile, text: r.raw, box: sb, cropBox: sourceCrop, sources: r.sources },
      target: { sheet: res.targetKey, fileName: res.fileName, detail: res.detail || null, cropBox: targetCrop, regionMethod: res.regionMethod, status: res.status },
    });
    if (targetCrop && !res.inPrimary) {
      const t = targeted.get(res.fileName) || { fileName: res.fileName, regions: [] };
      t.regions.push({ refId: r.refId, region: targetCrop });
      targeted.set(res.fileName, t);
    } else if (targetCrop && res.inPrimary) {
      const tsheet = PRIMARY.find((p) => canonicalSheet(p) === res.targetKey);
      const q = sheetIndexes.get(tsheet)?.lines || [];
      pairs[pairs.length - 1].target.qwenLines = q.filter((l) => center(l.box).x >= targetCrop.x && center(l.box).x <= targetCrop.x + targetCrop.width
        && center(l.box).y >= targetCrop.y && center(l.box).y <= targetCrop.y + targetCrop.height).map((l) => ({ lid: l.lid, text: l.text, box: l.box, uncertain: l.uncertain }));
    }
  }
  const a601 = sheetIndexes.get("A-6.00-00");
  const scheduleDetail = idx.lookup("A-6.00")?.details?.find((d) => d.title === "DOOR SCHEDULE");
  const scheduleRegion = scheduleDetail ? detailRegion(scheduleDetail, idx.lookup("A-6.00").details, idx.lookup("A-6.00").page) : null;
  const doors = a601 && sheetIndexes.get("A-1.01-00") ? doorMarks(sheetIndexes.get("A-1.01-00").lines, a601.lines, scheduleRegion) : null;

  const out = {
    version: "qsa.stage3.v1", backend, subset, generatedAt: new Date().toISOString(),
    sheetIndex: { pdfs: index82.pdfs, withDetailTitles: index82.pdfsWithDetailTitles, detailTitles: index82.sheets.reduce((n, s) => n + (s.details?.length || 0), 0) },
    primaryRead: [...sheetIndexes.keys()],
    variant: variant || null, lookalikeSheetTokens: lookalikes,
    references: refs, pairs,
    comparisons: { openingForces: compareOpeningForces(forces), doorMarks: doors },
    targeted: [...targeted.values()],
    tally: {
      references: refs.length,
      byStatus: refs.reduce((m, r) => ({ ...m, [r.resolution.status]: (m[r.resolution.status] || 0) + 1 }), {}),
      byKind: refs.reduce((m, r) => ({ ...m, [r.kind]: (m[r.kind] || 0) + 1 }), {}),
      bySource: refs.reduce((m, r) => { for (const s of new Set(r.sources)) m[s] = (m[s] || 0) + 1; return m; }, {}),
    },
  };
  const dir = path.join(OUT, "stage3");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `links.${backend}${subset ? ".subset" : ""}${variant ? `.${variant}` : ""}.json`);
  writeFileSync(file, JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out.tally, null, 1));
  for (const r of refs) console.log(`${r.refId} ${r.sourceSheet} [${r.sources.join("+")}] ${r.kind} "${String(r.raw).slice(0, 70)}" -> ${r.resolution.status} ${r.resolution.fileName || r.resolution.targetKey || ""}${r.resolution.detail ? ` #${r.resolution.detail.number} ${r.resolution.detail.title}` : ""}`);
  console.log(`pairs=${pairs.length} targeted sheets=${out.targeted.length} -> ${file}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) main();
