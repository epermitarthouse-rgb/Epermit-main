/**
 * Experimental spatial evidence selection from a Qwen sheet index (no model calls).
 *
 * The v2 block re-associates OCR words into annotations and fills a fixed budget; on Qwen lines most
 * of that budget goes to tile-seam fragments, duplicate readings from overlapping tiles and long
 * notes. Here the units are Qwen's own annotations after suppressing those duplicates, each placed in
 * the detail it belongs to (text-layer detail titles), ranked by technical content per character with
 * at least one unit per detail, and rendered compactly under detail headers. Every unit keeps an id
 * that resolves, in the evidence pack, to its lines, page boxes, tiles and value checks; uncertain
 * and conflicting readings are rendered with the same markers as v2 and never as plain facts.
 *
 *   buildSpatialEvidence(index, { details, maxChars }) -> { block, pack, delivered }
 *   retrieveEvidence(pack, query, { maxChars })         -> { block, units }
 */
import { classifyText } from "../../lib/stage3AnnotationModel.mjs";
import { clean, overlapSmaller, textKey } from "../../lib/stage3EvidenceEval.mjs";

const CODE_REF = /\b(?:IBC|IRC|IECC|IEBC|ACI|ASCE|AISC|AISI|AWC|NDS|NFPA|ANSI|ASTM|ADA|UL\s?\d|ICC|OSHA|DCMR)\b/;
const REQUIREMENT = /\b(?:SHALL|MIN\.?|MAX\.?|REQUIRED|RATED|RATING|FIRE|TYP\.?|V\.I\.F\.?|PROVIDE|PER)\b/;
const CLASS_WEIGHT = { dimension: 3, elevation: 3, value: 3, datum: 2, qualifier: 1.5, reference: 2, numeric: 1 };
const FOOTER_CHARS = 120;

const center = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const inBox = (p, b) => p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;

function lineValue(l) {
  const t = clean(l.text).toUpperCase();
  const { technical, classes } = classifyText(t);
  let v = classes.reduce((s, c) => s + (CLASS_WEIGHT[c] || 0), 0);
  if (CODE_REF.test(t)) v += 3;
  if (REQUIREMENT.test(t)) v += 1;
  if (l.category === "schedule_cell" || l.category === "schedule_title") v += 1;
  return { technical, classes, value: technical ? v + 1 : v * 0.3 };
}

/** Lines that only repeat another line (cut at a tile seam, or a second tile's copy) are dropped. */
function suppressDuplicates(lines) {
  const keep = [];
  const dropped = new Map();
  for (const l of [...lines].sort((a, b) => textKey(b.text).length - textKey(a.text).length)) {
    const k = textKey(l.text);
    const host = keep.find((h) => overlapSmaller(h.box, l.box) >= 0.5 && textKey(h.text).includes(k));
    if (host || !k) dropped.set(l.lid, host?.lid || null);
    else keep.push(l);
  }
  return { keep, dropped };
}

/** Detail whose region holds the box; else a notes-style title directly above it in the same column. */
function regionOf(box, details) {
  const p = center(box);
  const hits = details.filter((d) => d.region && inBox(p, d.region));
  hits.sort((a, b) => a.region.width * a.region.height - b.region.width * b.region.height);
  if (hits[0]) return hits[0];
  const above = details.filter((d) => d.titleBox && d.titleBox.y > p.y && p.x >= d.titleBox.x - 60 && p.x <= d.titleBox.x + Math.max(d.titleBox.width, 600));
  above.sort((a, b) => a.titleBox.y - b.titleBox.y);
  return above[0] || null;
}

const EDGE_PX = 25;

/** Every tile reading of `text` touches the edge of its tile (the print continues into the next tile). */
function cutAtTileEdge(l, text, tileSize) {
  const reads = (l.provenance || []).filter((p) => p.text === text && p.px);
  return reads.length > 0 && reads.every((p) => {
    const { w: tw, h: th } = tileSize(p.tileId);
    return p.px.x <= EDGE_PX || p.px.y <= EDGE_PX || p.px.x + p.px.w >= tw - EDGE_PX || p.px.y + p.px.h >= th - EDGE_PX;
  });
}

/**
 * A cross-tile "conflict" whose other reading is a piece of this one cut at a tile edge is a seam
 * fragment, not a disagreement: the longer reading is shown and the cut kept as such. A contained
 * reading away from the tile edge (a door number beside its row, a bubble number beside its sheet
 * tag) is a separate label, and every other difference stays a conflict.
 */
function resolveCuts(l, tileSize) {
  if (!l.conflict || !l.alternatives?.length) return l;
  const readings = [l.text, ...l.alternatives];
  const longest = readings.reduce((a, b) => (textKey(b).length > textKey(a).length ? b : a));
  const cut = readings.filter((r) => r !== longest);
  if (!cut.every((r) => textKey(longest).includes(textKey(r)) && cutAtTileEdge(l, r, tileSize))) return l;
  const uncertain = Boolean(l.confidenceBasis?.selfReportedUncertain) || (l.valueChecks || []).some((c) => String(c.status).startsWith("flagged"));
  return { ...l, text: longest, conflict: false, uncertain, alternatives: [], cutReadings: [...(l.cutReadings || []), ...cut], seamResolved: true };
}

const rowText = (l) => (l.conflict && l.alternatives?.length ? `{${[l.text, ...l.alternatives].map(clean).join(" | ")}}` : l.uncertain ? `?${clean(l.text)}` : clean(l.text));

/**
 * index: stage 2 sheet index; details: [{ number, title, scale, region }] in page points (bottom-left).
 */
export function buildSpatialEvidence(index, { details = [], maxChars = 3200, source = "qwen", tileSize = () => ({ w: 980, h: 980 }) } = {}) {
  const { width: W } = index.page;
  const tb = index.layout?.titleBlock;
  const inTitleBlock = (b) => (tb ? inBox(center(b), tb) : false) || b.x > 0.85 * W;
  const lines = index.lines.map((l) => resolveCuts(l, tileSize));
  const { keep, dropped } = suppressDuplicates(lines);
  const keepIds = new Set(keep.map((l) => l.lid));
  const byId = new Map(lines.map((l) => [l.lid, l]));

  // Units: Qwen annotations restricted to kept lines; an annotation longer than one budget share is split by line.
  const units = [];
  const seen = new Set();
  for (const a of index.annotations) {
    const ls = a.lines.filter((id) => keepIds.has(id)).map((id) => byId.get(id));
    if (!ls.length) continue;
    ls.forEach((l) => seen.add(l.lid));
    ls.sort((p, q) => (q.box.y + q.box.height) - (p.box.y + p.box.height) || p.box.x - q.box.x);
    const chars = ls.reduce((n, l) => n + rowText(l).length + 3, 0);
    if (chars > maxChars / 6) ls.forEach((l) => units.push({ aid: a.aid, lines: [l] }));
    else units.push({ aid: a.aid, lines: ls });
  }
  for (const l of keep) if (!seen.has(l.lid)) units.push({ aid: null, lines: [l] });

  for (const u of units) {
    const vals = u.lines.map(lineValue);
    u.text = u.lines.map(rowText).join(" / ");
    u.key = textKey(u.lines.map((l) => l.text).join("|"));
    u.box = u.lines.reduce((b, l) => (b ? { x: Math.min(b.x, l.box.x), y: Math.min(b.y, l.box.y), width: Math.max(b.x + b.width, l.box.x + l.box.width) - Math.min(b.x, l.box.x), height: Math.max(b.y + b.height, l.box.y + l.box.height) - Math.min(b.y, l.box.y) } : { ...l.box }), null);
    u.technical = vals.some((v) => v.technical);
    u.classes = [...new Set(vals.flatMap((v) => v.classes))];
    u.value = vals.reduce((s, v) => s + v.value, 0);
    u.titleBlock = inTitleBlock(u.box);
    u.detailTitle = details.some((d) => d.titleBox && overlapSmaller(u.box, { x: d.titleBox.x - 40, y: d.titleBox.y - 30, width: d.titleBox.width + 80, height: d.titleBox.height + 60 }) >= 0.6);
    u.detail = u.titleBlock ? null : regionOf(u.box, details);
    u.regionKey = u.titleBlock ? "title block" : u.detail ? `${u.detail.number ?? ""} ${u.detail.title}`.trim() : "sheet";
    u.uncertain = u.lines.some((l) => l.uncertain || l.conflict);
    u.lengthChars = u.text.length + 8;
    u.density = u.value / u.lengthChars;
  }

  // Identical units of one region are rendered once with a count; all copies stay in the pack.
  const groups = new Map();
  const captions = new Map();
  for (const u of units) {
    if ((u.titleBlock || u.detailTitle) && textKey(u.text)) {
      const k = `${u.titleBlock ? "title block" : "detail title"}|${u.key}`;
      if (!captions.has(k)) captions.set(k, { ...u, regionKey: u.titleBlock ? "title block" : `detail title ${u.regionKey}`, copies: [u] });
      else captions.get(k).copies.push(u);
    }
    if (u.titleBlock || u.detailTitle || !textKey(u.text)) continue;
    const g = `${u.regionKey}|${u.key}`;
    if (!groups.has(g)) groups.set(g, { ...u, copies: [u] });
    else groups.get(g).copies.push(u);
  }
  const cands = [...groups.values()].filter((g) => g.value > 0 && textKey(g.text).length >= 1);
  cands.forEach((g) => { g.density = (g.value * Math.min(g.copies.length, 3)) / (g.lengthChars + (g.copies.length > 1 ? 4 : 0)); });

  // Pass 1: the best technical unit of every detail; pass 2: global density order.
  const regions = new Map();
  for (const g of cands) regions.set(g.regionKey, [...(regions.get(g.regionKey) || []), g]);
  for (const list of regions.values()) list.sort((a, b) => b.density - a.density);
  const header = [
    `Stage3 spatial evidence (experimental; machine-extracted; independentlyVerified=false). sheet=${index.sheetId} discipline=${index.discipline} source=${source} model=${index.model}`,
    "Rules: each \"- \" line is one printed annotation; \" / \" separates its rows; ×n = same text printed n times in that detail. ?text = look-alike glyph or model doubt, unverified; {A | B} = overlapping tiles disagree, neither confirmed. eN cites boxes and tiles in the evidence pack. Not shown is not absent.",
  ];
  const selected = new Set();
  let budget = maxChars - header.join("\n").length - 1 - FOOTER_CHARS;
  const regionHeader = (g) => `## ${g.regionKey}${g.detail?.scale ? ` (${g.detail.scale})` : ""}`;
  const headerCost = (g) => ([...selected].some((s) => s.regionKey === g.regionKey) ? 0 : regionHeader(g).length + 1);
  const take = (g) => {
    const cost = g.lengthChars + (g.copies.length > 1 ? 4 : 0) + headerCost(g);
    if (cost > budget) return false;
    selected.add(g);
    budget -= cost;
    return true;
  };
  for (const [, list] of [...regions].sort((a, b) => b[1][0].density - a[1][0].density)) {
    const best = list.find((g) => g.technical);
    if (best) take(best);
  }
  for (const g of [...cands].sort((a, b) => b.density - a.density)) if (!selected.has(g)) take(g);

  // Render grouped by detail (reading order inside a detail: top to bottom, left to right).
  const ids = new Map();
  let n = 0;
  const regionOrder = [...new Set([...selected].sort((a, b) => (b.box.y - a.box.y) || (a.box.x - b.box.x)).map((g) => g.regionKey))];
  const out = [];
  for (const r of regionOrder) {
    out.push(regionHeader([...selected].find((g) => g.regionKey === r)));
    for (const g of [...selected].filter((x) => x.regionKey === r).sort((a, b) => (b.box.y + b.box.height) - (a.box.y + a.box.height) || a.box.x - b.box.x)) {
      const id = `e${++n}`;
      ids.set(g, id);
      out.push(`- ${id} ${g.text}${g.copies.length > 1 ? ` ×${g.copies.length}` : ""}`);
    }
  }
  const omitted = cands.filter((g) => !selected.has(g));
  const footer = `shown ${selected.size}/${cands.length} units; omitted ${omitted.length} (${omitted.filter((g) => g.technical).length} technical) by budget; title block, detail titles (in headers) and duplicates excluded`;
  const block = [...header, ...out, footer].join("\n");

  const unitJson = (g, id) => ({
    id, region: g.regionKey, text: g.text, technical: g.technical, classes: g.classes, uncertain: g.uncertain, value: Number(g.value.toFixed(2)),
    copies: g.copies.map((c) => ({ aid: c.aid, box: c.box, lines: c.lines.map((l) => ({ lid: l.lid, text: l.text, ocrText: l.ocrText, box: l.box,
      tiles: (l.provenance || []).map((p) => p.tileId), uncertain: l.uncertain, conflict: l.conflict, alternatives: l.alternatives,
      ...(l.seamResolved ? { seamResolved: true, cutReadings: l.cutReadings } : {}), valueChecks: l.valueChecks })) })),
  });
  const pack = {
    version: "qsa.spatial-evidence.v1", sheetId: index.sheetId, source, model: index.model, page: index.page, maxChars,
    details: details.map((d) => ({ number: d.number, title: d.title, scale: d.scale, region: d.region, regionMethod: "approximate: above the text-layer detail title" })),
    shown: [...selected].map((g) => unitJson(g, ids.get(g))),
    omitted: omitted.map((g, i) => unitJson(g, `o${i + 1}`)),
    captions: [...captions.values()].map((g, i) => unitJson(g, `c${i + 1}`)),
    suppressedLines: [...dropped].map(([lid, host]) => ({ lid, duplicateOf: host })),
  };
  return { block, pack, delivered: deliveredItems([...selected]) };
}

/** Delivered items in the evaluator's shape: one segment per row reading, markers as in v2. */
export function deliveredItems(groups) {
  const items = [];
  for (const g of groups) {
    for (const c of g.copies) {
      const segments = c.lines.flatMap((l) => (l.conflict && l.alternatives?.length
        ? [l.text, ...l.alternatives].map((t) => ({ text: clean(t), words: [{ text: t, box: l.box }], marker: "conflict" }))
        : [{ text: clean(l.text), words: [{ text: l.text, box: l.box }], ...(l.uncertain ? { marker: "uncertain" } : {}) }]));
      items.push({ id: `${c.aid || c.lines[0].lid}`, segments });
    }
  }
  return items;
}

/**
 * Plan-review questions asked of every sheet. Terms are matched against unit text and detail
 * names; a question is only put to the reasoning model when the sheet has evidence for it.
 */
export const REVIEW_QUESTIONS = [
  { id: "Q-TITLE", question: "Title block, sheet numbering, detail titles and scale notations.", terms: [/\bSCALE\b/, /\bSHEET:|PAGE #|\bOF \d/, /TITLE BLOCK$|DETAIL TITLE /] },
  { id: "Q-GUARD", question: "Guards and guardrails: required height, opening limitation, attachment.", terms: [/GUARD ?RAIL|GUARDRAIL|\bGUARD\b/, /SPHERE/, /\bRAILING\b/] },
  { id: "Q-ROOF", question: "Roof assembly, slope, parapet and membrane details.", terms: [/\bROOF\b/, /MEMBRANE/, /PARAPET/, /\d+:\d+ ?MIN/] },
  { id: "Q-ELEV", question: "Elevations, heights and dimensions that must agree across details.", terms: [/ELEV\.?\s*\+/, /A\.F\.F/, /V\.I\.F/, /\d+'-\d+"? ?(MIN|MAX)/] },
  { id: "Q-DOOR", question: "Door schedule: sizes, types, frames, hardware and fire ratings.", terms: [/\bDOOR\b/, /\d'-\d+"X\d'-\d+"/i, /JAMB|\bHEAD\b|H\.M\./, /HARDWARE/] },
  { id: "Q-FORCE", question: "Door opening force and accessible operation.", terms: [/\bLBS?\b|\bLBF\b|POUND/, /OPENING FORCE|PUSH|PULL/] },
  { id: "Q-FIRE", question: "Fire-resistance ratings, rated assemblies and listings.", terms: [/\bHR\b|HOUR|FIRE|RATED|RATING|\bUL\b/] },
  { id: "Q-ACCESS", question: "Accessibility: clearances, mounting heights, grab bars, lavatories, signage.", terms: [/GRAB BAR|LAVATORY|TOILET|ACCESSIBLE|ADA|ANSI|A117/, /\d+" ?(MIN|MAX)\.?/, /CENTERLINE|\bSIGN(AGE)?\b/] },
  { id: "Q-LOADS", question: "Design loads: live, roof, snow (ground, flat, exposure, importance, thermal).", terms: [/LIVE LOAD|SNOW|PSF|DRIFT|EXPOSURE FACTOR|THERMAL FACTOR/] },
  { id: "Q-WIND", question: "Wind design: basic wind speed, exposure, pressure coefficients.", terms: [/\bWIND\b|MPH|PRESSURE COEFFICIENT|CLADDING/] },
  { id: "Q-SEISMIC", question: "Seismic design: SDC, use group, importance factor, Ss/S1/Sds/Sd1, R, Cs, base shear.", terms: [/SEISMIC|BASE SHEAR|\bS[SD]?[S1Il]\b|\bSd[s1l]\b|\bCs\s*=|\bR\s*=/] },
  { id: "Q-MATERIAL", question: "Structural materials and connections: studs, gauges, steel grades, fasteners.", terms: [/\d{3}[ST]\d{3}-\d+|MIL\b|KSI|ASTM|SCREW|WELD|CONNECTION|STEEL/] },
  { id: "Q-CODE", question: "Governing codes, editions and referenced standards.", terms: [/\b(IBC|ACI|AWC|NDS|ASCE|AISI|AISC|IRC|IECC|NFPA)\b|BUILDING CODE/] },
  { id: "Q-XREF", question: "Referenced sheets and details that must be checked together.", terms: [/\bSEE\b|\bREFER|\d+\s*\/\s*[A-Z]-?\d/] },
];

/** Evidence for each question from the whole pack (shown and omitted units), with same-detail neighbours. */
export function questionEvidence(pack, questions = REVIEW_QUESTIONS, { perQuestionChars = 700, totalChars = 6000, neighbours = 2 } = {}) {
  const all = [...pack.shown, ...pack.omitted, ...(pack.captions || [])];
  const ref = (u) => u.id;
  const out = [];
  let used = 0;
  const asked = [];
  for (const q of questions) {
    const scored = all.map((u) => ({ u, s: q.terms.filter((t) => t.test(`${u.text} ${u.region}`.toUpperCase())).length })).filter((h) => h.s > 0)
      .sort((a, b) => b.s - a.s || Number(b.u.technical) - Number(a.u.technical) || b.u.value - a.u.value);
    if (!scored.length) continue;
    const chosen = [];
    for (const { u } of scored) {
      if (!chosen.includes(u)) chosen.push(u);
      const c = center(u.copies[0].box);
      all.filter((v) => v !== u && v.region === u.region && v.technical && !chosen.includes(v))
        .map((v) => ({ v, d: Math.hypot(center(v.copies[0].box).x - c.x, center(v.copies[0].box).y - c.y) }))
        .sort((a, b) => a.d - b.d).slice(0, neighbours).forEach(({ v }) => { if (Math.hypot(center(v.copies[0].box).x - c.x, center(v.copies[0].box).y - c.y) < 120) chosen.push(v); });
    }
    const inSummary = chosen.filter((u) => pack.shown.includes(u)).map(ref);
    const lines = [`### ${q.id} ${q.question}`, ...(inSummary.length ? [`- in summary: ${inSummary.join(", ")}`] : [])];
    let qUsed = lines.join("\n").length;
    let added = 0;
    for (const u of chosen.filter((v) => !pack.shown.includes(v))) {
      const line = `- ${ref(u)} [${u.region}] ${u.text}`;
      if (qUsed + line.length + 1 > perQuestionChars || used + qUsed + line.length + 1 > totalChars) break;
      lines.push(line);
      qUsed += line.length + 1;
      added += 1;
    }
    out.push(lines.join("\n"));
    used += qUsed + 1;
    asked.push({ id: q.id, inSummary: inSummary.length, retrieved: added });
  }
  const header = "Question-targeted evidence from the full sheet index. Units already in the summary above are listed by id; units the summary omitted (oN) and title-block or detail-caption readings (cN) are quoted. Same markers: ?text unverified, {A | B} tiles disagree.";
  return { block: [header, ...out].join("\n"), asked };
}

/** Units of the pack (shown or omitted) relevant to a technical query, with their detail neighbours. */
export function retrieveEvidence(pack, query, { maxChars = 1200, neighbours = 4 } = {}) {
  const words = clean(query).toUpperCase().split(/\s+/).filter((w) => w.length >= 3);
  const all = [...pack.shown, ...pack.omitted];
  const score = (u) => {
    const t = `${u.text} ${u.region}`.toUpperCase();
    return words.reduce((s, w) => s + (t.includes(w) ? 1 : 0), 0) / words.length;
  };
  const hits = all.map((u) => ({ u, s: score(u) })).filter((h) => h.s >= 0.5).sort((a, b) => b.s - a.s || b.u.value - a.u.value);
  const chosen = [];
  const add = (u) => { if (!chosen.includes(u)) chosen.push(u); };
  for (const { u } of hits) {
    add(u);
    const c = center(u.copies[0].box);
    all.filter((v) => v !== u && v.region === u.region && v.technical)
      .map((v) => ({ v, d: Math.hypot(center(v.copies[0].box).x - c.x, center(v.copies[0].box).y - c.y) }))
      .sort((a, b) => a.d - b.d).slice(0, neighbours).forEach(({ v }) => add(v));
  }
  const lines = [];
  let used = 0;
  for (const u of chosen) {
    const line = `- ${u.id} [${u.region}] ${u.text}`;
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  return { block: lines.join("\n"), units: chosen.slice(0, lines.length) };
}
