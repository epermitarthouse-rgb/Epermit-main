/**
 * Stage 3 evidence evaluation harness (local only).
 *
 * Scores OCR words, reconstructed lines and the evidence that reaches the analyzer
 * prompt against a visual ground truth of printed rows and annotations. Every
 * delivered segment is traced to ground-truth rows through the boxes of the OCR
 * words it came from, so a correct value inside a cross-annotation merge is kept
 * apart from a clean, attributable delivery.
 *
 * Ground truth format (customer ground truth stays under gitignored out/):
 *   { sheet, scope: "sheet" | "windows", windows?: [{x,y,width,height}],
 *     rows: [{ gid, aid, text, technical, box, vertical, region? }],
 *     annotations: [{ aid, rows: [gid], technical }],
 *     noise?: { textLayerEcho: [box], nonText: [box] } }
 *
 * Delivered items: [{ id, segments: [{ text, words: [{ text, box }], marker? }] }]
 * A segment is one rendered line of evidence; marker "conflict" | "uncertain"
 * means the evidence presents the segment as unconfirmed.
 */

export const STAGE3_EVIDENCE_EVAL_VERSION = "stage3-evidence-eval.v1";

export const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
export const norm = (s) => clean(s).toUpperCase()
  .replace(/[″“”〃]/g, '"').replace(/[’‘`´]/g, "'").replace(/[—–]/g, "-")
  .replace(/^[-_.•\s]+/, "").replace(/[-_\s]+$/, "").trim();
export const textKey = (s) => norm(s).replace(/\s+/g, "");

/** Stage 04 row rule: dimensions, elevations, qualifiers and references. */
export const TECHNICAL_ROW = /\d|A\.F\.F|ELEV\.|\bMIN\b|V\.I\.F|\bTYP\b|@/i;
export const isTechnicalRow = (text) => TECHNICAL_ROW.test(String(text || ""));

/** Values whose misreading changes a dimension or elevation. */
export const DIMENSION_OR_ELEVATION = /\d\s*['"]|\d+\s*\/\s*\d+|\bELEV\.?|\bEL\.|A\.F\.F|\bMIN\b|V\.I\.F/i;
export const isDimensionOrElevation = (text) => DIMENSION_OR_ELEVATION.test(norm(text));

const DIMENSION_TOKEN = /\d+\s*'\s*-?\s*\d+(?:\s+\d+\s*\/\s*\d+)?\s*["']?|\d+(?:[\s-]+\d+\s*\/\s*\d+)?\s*"|\d+\s*\/\s*\d+\s*"?/g;
/** Dimension and elevation values of a text (feet-inches, inches, fractions), spaces removed. */
export function dimensionTokens(text) {
  return (norm(text).match(DIMENSION_TOKEN) || []).map((t) => t.replace(/\s+/g, ""));
}
/** True when a delivered reading changes, drops or adds a dimension value of the printed row. */
export function changesDimensionValue(deliveredText, truthText, merged = false) {
  const d = dimensionTokens(deliveredText), t = dimensionTokens(truthText);
  if (!t.length && !d.length) return false;
  if (merged) return !t.every((x) => d.includes(x));
  return d.length !== t.length || [...d].sort().join("|") !== [...t].sort().join("|");
}

/** E exact, F fragment of the truth, S truth plus extra text, V wrong. */
export function quality(text, truth) {
  const k = textKey(text), t = textKey(truth);
  if (!k) return "V";
  if (k === t) return "E";
  if (t.includes(k)) return "F";
  if (k.includes(t)) return "S";
  return "V";
}

export function overlapSmaller(a, b) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.min(a.width * a.height || 1, b.width * b.height || 1);
}

export const isVerticalRead = (text, box) => clean(text).replace(/\s/g, "").length >= 2 && box.height > 1.6 * box.width;

const center = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const inside = (p, b) => p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;

/**
 * Geometric word-to-row mapping: same orientation, overlap >= 50% of the smaller box, best overlap wins.
 * Short or near-threshold reads can be classed in the other orientation, so a row of the other orientation
 * is accepted only when nothing matches and it overlaps >= 80%.
 */
export function createRowMapper(groundTruth) {
  const rows = groundTruth.rows;
  const windows = groundTruth.scope === "windows" ? groundTruth.windows || [] : null;
  return {
    inScope(box) {
      if (!windows) return true;
      const c = center(box);
      return windows.some((w) => inside(c, w));
    },
    rowOf(text, box) {
      const vertical = isVerticalRead(text, box);
      let best = null, bestOverlap = 0, other = null, otherOverlap = 0;
      for (const r of rows) {
        const o = overlapSmaller(box, r.box);
        if (Boolean(r.vertical) !== vertical) {
          if (o >= 0.8 && o > otherOverlap) { otherOverlap = o; other = r.gid; }
          continue;
        }
        if (o >= 0.5 && o > bestOverlap) { bestOverlap = o; best = r.gid; }
      }
      return best || other;
    },
  };
}

/** Words of a groupWordsIntoLines line: same text pieces inside the line box (Stage 04 attribution). */
export function attributeLineWords(line, words) {
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

const OK_SEGMENT = new Set(["correct", "correct_with_extra", "correct_join"]);
const PARTIAL_SEGMENT = new Set(["fragment", "fragment_join"]);

/** Classify one segment against the ground truth (Stage 04 line categories). */
export function classifySegment(segment, gt, mapper) {
  const rowById = gt.rowById;
  const words = (segment.words || []).map((w) => {
    const scoped = mapper.inScope(w.box);
    const gid = scoped ? mapper.rowOf(w.text, w.box) : null;
    return { text: clean(w.text), box: w.box, scoped, gid, quality: gid ? quality(w.text, rowById.get(gid).text) : null };
  });
  const scopedWords = words.filter((w) => w.scoped);
  if (!scopedWords.length) return { ...segment, words, gids: [], category: "out_of_scope", rows: [] };
  const gids = [...new Set(scopedWords.filter((w) => w.gid).map((w) => w.gid))];
  const noise = scopedWords.some((w) => !w.gid);
  let category;
  if (!gids.length) category = "noise";
  else if (gids.length > 1) {
    category = new Set(gids.map((g) => rowById.get(g).aid)).size > 1 ? "merge_across_annotations" : "merge_across_rows_same_annotation";
  } else if (noise) category = "merged_with_noise";
  else {
    const q = quality(segment.text, rowById.get(gids[0]).text);
    if (scopedWords.length === 1) category = { E: "correct", S: "correct_with_extra", F: "fragment", V: "ocr_error" }[q];
    else if (q === "E" || q === "S") category = "correct_join";
    else if (q === "F") category = "fragment_join";
    else category = scopedWords.every((w) => w.quality !== "V") ? "stitched_fragments" : "stitched_with_ocr_error";
  }
  const rows = gids.map((gid) => {
    const row = rowById.get(gid);
    let state;
    if (gids.length === 1) state = OK_SEGMENT.has(category) ? "exact" : PARTIAL_SEGMENT.has(category) ? "partial" : "wrong";
    else state = textKey(segment.text).includes(textKey(row.text)) ? "exact_in_merge" : "wrong";
    return { gid, state };
  });
  return { ...segment, words, gids, category, rows };
}

const overlapArea = (a, b) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
const coveredBy = (box, boxes) => boxes.reduce((s, b) => s + overlapArea(box, b), 0) / Math.max(1e-6, box.width * box.height);

/**
 * Echo filter outcome: excluded rows that are ground-truth text-layer echoes, excluded rows that
 * are real ground-truth rows (must be 0), and echo rows still kept.
 */
export function evaluateEchoFilter(echoes, groundTruth, keptRows = []) {
  const echoBoxes = groundTruth.noise?.textLayerEcho || [];
  const gtBoxes = groundTruth.rows.map((r) => r.box);
  const isEcho = (box) => coveredBy(box, echoBoxes) >= 0.5;
  const isReal = (box) => coveredBy(box, gtBoxes) >= 0.3;
  const removedEcho = echoes.filter((e) => isEcho(e.box)).length;
  const realDropped = echoes.filter((e) => !isEcho(e.box) && isReal(e.box)).map((e) => e.text);
  const keptEcho = keptRows.filter((r) => isEcho(r.box) && !isReal(r.box)).length;
  return { excluded: echoes.length, removedEcho, keptEcho, realDropped: realDropped.length, realDroppedTexts: realDropped.slice(0, 5) };
}

/**
 * Region labels of ground-truth technical rows under a region set (production association rule
 * by centre point). Windowed ground truth lies in the drawing field. Mislabelled: a drawing row
 * placed in the title block, or a title-block row placed outside it.
 */
export function evaluateRegionLabels(regions, groundTruth, associate) {
  const tech = groundTruth.rows.filter((r) => r.technical);
  const kinds = associate(tech.map((r) => ({ kind: "ocr_line", text: r.text, bbox: { ...r.box, unit: "pdf-point", origin: "bottom-left" } })), regions || []);
  let mislabelled = 0;
  const examples = [];
  tech.forEach((r, i) => {
    const expected = r.region || "drawing";
    const got = kinds[i]?.regionKind || null;
    if ((expected === "title_block") !== (got === "title_block")) {
      mislabelled += 1;
      if (examples.length < 3) examples.push(`${r.text} -> ${got}`);
    }
  });
  return { technicalRows: tech.length, mislabelled, examples };
}

export function prepareGroundTruth(groundTruth) {
  const rowById = new Map(groundTruth.rows.map((r) => [r.gid, r]));
  const annById = new Map(groundTruth.annotations.map((a) => [a.aid, a]));
  return { ...groundTruth, rowById, annById };
}

/**
 * Evaluate a set of delivered items. Returns per-row and per-annotation outcomes and totals.
 * Row states: exact (attributable, alone or with its own annotation), exact_contradicted
 * (exact plus an unmarked wrong reading of the same row), exact_in_merge (only inside a
 * cross-row merge), partial, wrong, none.
 */
/** Two printed rows on one text line, side by side (separate columns or cells), in reading frame. */
export function sideBySide(a, b) {
  if (Boolean(a.vertical) !== Boolean(b.vertical)) return false;
  const f = (r) => (r.vertical
    ? { x: r.box.y, w: r.box.height, y: r.box.x, h: r.box.width }
    : { x: r.box.x, w: r.box.width, y: r.box.y, h: r.box.height });
  const p = f(a), q = f(b);
  const yOverlap = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y);
  const xOverlap = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x);
  return yOverlap >= 0.5 * Math.min(p.h, q.h) && xOverlap <= 0.1 * Math.min(p.w, q.w);
}

export function evaluateItems(items, groundTruthInput, options = {}) {
  const gt = groundTruthInput.rowById ? groundTruthInput : prepareGroundTruth(groundTruthInput);
  const mapper = createRowMapper(gt);
  const classified = items.map((item) => ({ ...item, segments: item.segments.map((s) => classifySegment(s, gt, mapper)) }));
  const perRow = new Map(gt.rows.map((r) => [r.gid, { exact: 0, exactMarked: 0, exactInMerge: 0, partial: 0, wrongUnmarked: 0, wrongMarked: 0, items: new Set() }]));
  const segmentLog = [];
  for (const item of classified) {
    for (const seg of item.segments) {
      segmentLog.push({ item: item.id, text: seg.text, category: seg.category, gids: seg.gids, marker: seg.marker || null });
      for (const r of seg.rows) {
        const p = perRow.get(r.gid);
        p.items.add(item.id);
        if (r.state === "exact" && seg.marker) p.exactMarked++;
        else if (r.state === "exact") p.exact++;
        else if (r.state === "exact_in_merge") p.exactInMerge++;
        else if (r.state === "partial") p.partial++;
        else if (seg.marker) p.wrongMarked++;
        else p.wrongUnmarked++;
      }
    }
  }
  const rows = gt.rows.map((r) => {
    const p = perRow.get(r.gid);
    const state = p.exact ? (p.wrongUnmarked ? "exact_contradicted" : "exact")
      : p.exactMarked ? (p.wrongUnmarked ? "exact_contradicted" : "exact_marked")
        : p.exactInMerge ? "exact_in_merge" : p.partial ? "partial" : (p.wrongUnmarked || p.wrongMarked) ? "wrong" : "none";
    return { gid: r.gid, aid: r.aid, text: r.text, technical: r.technical, state, wrongUnmarked: p.wrongUnmarked, wrongMarked: p.wrongMarked };
  });
  const rowState = new Map(rows.map((r) => [r.gid, r.state]));

  // Context: one item carries every row of the annotation exactly and no row of another annotation.
  const itemRows = classified.map((item) => {
    const exact = new Set(), all = new Set();
    for (const seg of item.segments) for (const r of seg.rows) { all.add(r.gid); if (r.state === "exact") exact.add(r.gid); }
    return { id: item.id, exact, all };
  });
  const annotations = gt.annotations.map((a) => {
    const states = a.rows.map((g) => rowState.get(g));
    const complete = states.every((s) => s === "exact" || s === "exact_contradicted" || s === "exact_marked");
    const completeClean = states.every((s) => s === "exact");
    const contextPreserved = complete && itemRows.some((it) => a.rows.every((g) => it.exact.has(g)) && [...it.all].every((g) => gt.rowById.get(g).aid === a.aid));
    return { aid: a.aid, technical: a.technical, rows: a.rows.length, complete, completeClean, contextPreserved, states };
  });

  const mixedSegments = segmentLog.filter((s) => s.category === "merge_across_annotations");
  const crossColumnSegments = segmentLog.filter((s) => {
    const rs = [...new Set(s.gids)].map((g) => gt.rowById.get(g));
    return rs.some((a, i) => rs.slice(i + 1).some((b) => sideBySide(a, b)));
  });
  const mixedItems = classified.filter((item) => {
    const aids = new Set(item.segments.flatMap((s) => s.gids.map((g) => gt.rowById.get(g).aid)));
    return aids.size > 1 && !item.contextUncertain;
  });
  const wrongSegments = classified.flatMap((item) => item.segments.filter((s) => s.rows.some((r) => r.state === "wrong")));
  const wrongTechUnmarked = wrongSegments.filter((s) => !s.marker && s.rows.some((r) => r.state === "wrong" && gt.rowById.get(r.gid).technical));
  const wrongDimUnmarked = wrongTechUnmarked.filter((s) => s.rows.some((r) => r.state === "wrong" && changesDimensionValue(s.text, gt.rowById.get(r.gid).text, s.gids.length > 1)));
  const tally = (subset) => {
    const rs = rows.filter(subset);
    const c = (s) => rs.filter((r) => r.state === s).length;
    return {
      rows: rs.length, exact: c("exact") + c("exact_contradicted"), exactClean: c("exact"), exactContradicted: c("exact_contradicted"),
      exactMarked: c("exact_marked"), exactInMerge: c("exact_in_merge"), partial: c("partial"), wrong: c("wrong"), none: c("none"),
    };
  };
  const annTally = (subset) => {
    const as = annotations.filter(subset);
    return {
      annotations: as.length, complete: as.filter((a) => a.complete).length, completeClean: as.filter((a) => a.completeClean).length,
      contextPreserved: as.filter((a) => a.contextPreserved).length,
    };
  };
  const categories = {};
  for (const s of segmentLog) categories[s.category] = (categories[s.category] || 0) + 1;
  return {
    items: classified.length,
    segments: segmentLog.length,
    segmentCategories: categories,
    rowsTechnical: tally((r) => r.technical),
    rowsAll: tally(() => true),
    annotationsTechnical: annTally((a) => a.technical),
    annotationsAll: annTally(() => true),
    mixedSegments: mixedSegments.length,
    mixedItems: mixedItems.length,
    crossColumnSegments: crossColumnSegments.length,
    wrongTechnicalSegmentsUnmarked: wrongTechUnmarked.length,
    wrongDimensionOrElevationUnmarked: wrongDimUnmarked.length,
    wrongTechnicalSegmentsMarked: wrongSegments.filter((s) => s.marker).length,
    rows: options.detail === false ? undefined : rows,
    annotations: options.detail === false ? undefined : annotations,
    segmentLog: options.detail === false ? undefined : segmentLog,
  };
}

/** Each OCR word as its own item (funnel word stages). */
export function wordsAsItems(words, prefix = "w") {
  return words.map((w, i) => ({ id: `${prefix}${i}`, segments: [{ text: clean(w.text), words: [{ text: w.text, box: w.box }] }] }));
}

/** Each reconstructed line as its own item, with the words it was built from. */
export function linesAsItems(lines, words, prefix = "l") {
  return lines.map((line, i) => {
    const used = attributeLineWords(line, words) || [{ text: line.text, box: line.box }];
    return { id: `${prefix}${i}`, segments: [{ text: clean(line.text), words: used.map((w) => ({ text: w.text, box: w.box })) }] };
  });
}

function oneLine(value, max) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Texts a v1 pack delivers, parsed from the analyzer Stage 3 block (formatStage3PromptBlock fields:
 * detailIdentifier, associatedDetail, excerpts, rejectedGenericHeights). A text cut by the analyzer
 * bound is delivered as its visible prefix.
 */
export function v1DeliveredTexts(pack, analyzerBlock) {
  const out = [];
  const lines = analyzerBlock.split("\n");
  const fieldParts = (name, sep) => {
    const line = lines.find((l) => l.startsWith(`${name}: `));
    if (!line) return null;
    const body = line.slice(name.length + 2);
    const truncated = body.endsWith("…") && line === lines[lines.length - 1];
    const parts = (truncated ? body.slice(0, -1) : body).split(sep);
    return { parts, truncated };
  };
  const take = (name, texts, sep) => {
    const f = fieldParts(name, sep);
    if (!f) return;
    texts.forEach((text, i) => {
      if (!text || i >= f.parts.length) return;
      const shown = f.parts[i];
      if (shown === text) out.push({ field: name, text, complete: true });
      else if (f.truncated && i === f.parts.length - 1 && text.startsWith(shown) && shown.length >= 2) out.push({ field: name, text, visible: shown, complete: false });
    });
  };
  if (pack.detailIdentifier) take("detailIdentifier", [oneLine(pack.detailIdentifier, 160)], /$^/);
  if (pack.assessment?.detailIdentifier) take("associatedDetail", [oneLine(pack.assessment.detailIdentifier, 160)], /$^/);
  take("excerpts", (pack.extractedTexts || []).slice(0, 12).map((t) => oneLine(t, 160)), " || ");
  take("rejectedGenericHeights", pack.assessment?.rejectedGenericHeights || [], " | ");
  return out;
}

/**
 * Delivered v1 items: each delivered text, traced to every association that carries it.
 * OCR associations resolve to their recovery words; text-layer spans are one word at their box.
 */
export function v1DeliveredItems(pack, analyzerBlock, layout, recovery) {
  const page = recovery?.pages?.[0] || { lines: [], words: [] };
  const lineWords = (assoc) => {
    const line = page.lines.find((l) => l.text === assoc.text && Math.abs(l.box.x - assoc.bbox.x) < 0.06 && Math.abs(l.box.y - assoc.bbox.y) < 0.06);
    if (!line) return null;
    return attributeLineWords(line, page.words);
  };
  const items = [];
  for (const [i, d] of v1DeliveredTexts(pack, analyzerBlock).entries()) {
    const sources = (layout.associations || []).filter((a) => oneLine(a.text, d.field === "rejectedGenericHeights" ? 240 : 160) === d.text);
    const text = d.complete ? d.text : d.visible;
    sources.forEach((a, j) => {
      const ocr = a.origin === "visual_interpretation" || a.blockKind === "ocr_line";
      const words = ocr ? lineWords(a) : null;
      items.push({
        id: `v1-${i}-${j}`, field: d.field, complete: d.complete, source: ocr ? "ocr_line" : "text_layer",
        segments: [{ text, words: (words || [{ text: a.text, box: a.bbox }]).map((w) => ({ text: w.text, box: w.box })) }],
      });
    });
    if (!sources.length) items.push({ id: `v1-${i}-x`, field: d.field, complete: d.complete, source: "unmatched", segments: [{ text, words: [] }] });
  }
  return items;
}

/**
 * Delivered v2 items from a v2 pack: every shown annotation is one item; each printed row is a
 * segment with its source words. Conflicting readings are one segment per reading, marked
 * "conflict"; rows with a format doubt are marked "uncertain". Shown ids must also be rendered
 * in the analyzer block (checked by the caller with v2RenderedIds).
 */
export function v2DeliveredItems(pack) {
  const model = pack.evidenceModel;
  const rowById = new Map(model.rows.map((r) => [r.rid, r]));
  const annById = new Map(model.annotations.map((a) => [a.aid, a]));
  return (pack.digest?.shown || []).map((aid) => {
    const a = annById.get(aid);
    const segments = a.rows.flatMap((rid) => {
      const r = rowById.get(rid);
      if (r.alternatives?.length) return [r, ...r.alternatives].map((x) => ({ text: x.text, words: x.words, marker: "conflict" }));
      return [{ text: r.text, words: r.words, ...(r.uncertain?.length ? { marker: "uncertain" } : {}) }];
    });
    return { id: aid, contextUncertain: Boolean(a.contextUncertain), segments };
  });
}

/** Mirror of the analyzer Stage 3 block for one pack (analyzerStage3VisualEvidence.ts, v1 bounds). */
export const V1_ANALYZER_BOUNDS = { maxPacks: 3, maxCharsPerPack: 1200, maxTotalChars: 3200 };
export function v1AnalyzerBlock(packs, status = "recovered", bounds = V1_ANALYZER_BOUNDS) {
  const lines = [
    "Stage 3 Apple Vision OCR evidence (machine-extracted; independentlyVerified=false):",
    "Not professionally verified. Quote before Critical absence. Do not treat OCR recovery as verified compliance. Empty/missing packs mean not recovered — not proof of absence.",
    `stage3_status=${status} version=phase3.stage3-visual-evidence.v1`,
  ];
  let total = lines.join("\n").length;
  let used = 0;
  for (const pack of packs) {
    if (used >= bounds.maxPacks) break;
    const raw = String(pack.promptBlock || "").trim();
    const block = raw.length <= bounds.maxCharsPerPack ? raw : `${raw.slice(0, bounds.maxCharsPerPack)}…`;
    if (!block) continue;
    if (total + block.length + 2 > bounds.maxTotalChars) break;
    lines.push(block);
    total += block.length + 2;
    used += 1;
  }
  return lines.join("\n");
}

/**
 * Mirror of the analyzer v2 Stage 3 block (analyzerStage3VisualEvidence.ts formatStage3VisualEvidencePrompt
 * for version v2). A pack longer than the room left is cut at its last complete line, never mid-annotation.
 */
export const V2_ANALYZER_BOUNDS = { maxPacks: 1, maxCharsPerPack: 2600, maxTotalChars: 3200 };
export const V2_ANALYZER_HEADER = [
  "Stage 3 Apple Vision OCR evidence v2 (machine-extracted; independentlyVerified=false). Not professionally verified. Quote before Critical absence. Omitted or missing items mean not recovered — not proof of absence.",
  "Reading rules: each \"- \" line is one printed annotation; \" / \" separates its rows; \" ; \" separates the cells of one table row. {A | B} = conflicting OCR readings of one place, neither confirmed. ?text = OCR format or glyph doubt; verify on the PDF before relying on it. (ctx?) = relation to nearby items unconfirmed. Never combine values from different lines.",
];
export function v2AnalyzerBlock(packs, status = "recovered", notes = [], bounds = V2_ANALYZER_BOUNDS) {
  const lines = [...V2_ANALYZER_HEADER, `stage3_status=${status} version=phase3.stage3-visual-evidence.v2`];
  const notesLine = notes.length ? `stage3_notes: ${notes.map((n) => oneLine(n, 160)).join(" | ")}` : "";
  let total = lines.join("\n").length + (notesLine ? notesLine.length + 1 : 0);
  let used = 0;
  for (const pack of packs) {
    if (used >= bounds.maxPacks) break;
    const room = Math.min(bounds.maxCharsPerPack, bounds.maxTotalChars - total - 1);
    const raw = String(pack.promptBlock || "").trim();
    if (!raw || room <= 0) continue;
    let block = raw;
    if (block.length > room) {
      const kept = [];
      let len = 0;
      for (const line of raw.split("\n")) {
        if (len + line.length + (kept.length ? 1 : 0) > room) break;
        kept.push(line);
        len += line.length + (kept.length > 1 ? 1 : 0);
      }
      block = kept.join("\n");
    }
    if (!block) continue;
    lines.push(block);
    total += block.length + 1;
    used += 1;
  }
  if (notesLine) lines.push(notesLine);
  return lines.join("\n");
}

/** Ids of v2 shown annotations whose rendered line is present in the analyzer block. */
export function v2RenderedIds(pack, analyzerBlock, renderLine) {
  const present = new Set(analyzerBlock.split("\n"));
  return (pack.digest?.shown || []).filter((aid) => present.has(renderLine(aid)));
}

/** Compact one-line summary of an evaluation for console tables. */
export function summarize(e) {
  const t = e.rowsTechnical, a = e.annotationsTechnical;
  return {
    techRowsExact: t.exact, techRowsClean: t.exactClean, techRowsContradicted: t.exactContradicted, techRowsMarked: t.exactMarked, techRowsInMerge: t.exactInMerge,
    techRowsPartial: t.partial, techRowsWrong: t.wrong, techRowsNone: t.none, techRows: t.rows,
    techAnnComplete: a.complete, techAnnClean: a.completeClean, techAnnContext: a.contextPreserved, techAnn: a.annotations,
    mixedSegments: e.mixedSegments, mixedItems: e.mixedItems, crossColumn: e.crossColumnSegments, wrongTechUnmarked: e.wrongTechnicalSegmentsUnmarked, wrongDimUnmarked: e.wrongDimensionOrElevationUnmarked,
    items: e.items, segmentsOutOfScope: e.segmentCategories.out_of_scope || 0,
  };
}
