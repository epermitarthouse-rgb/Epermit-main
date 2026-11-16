#!/usr/bin/env node
/**
 * Controlled comparison on the five drawings, scored with the unchanged stage 3 evaluator and the
 * same ground truth (232 technical rows). No model calls: every arm is built from saved OCR.
 *
 *   av        Apple Vision 4x3 (saved recovery)                    lines + unchanged v2 block
 *   qwen      Qwen 72B as benchmarked (snap every tile)            lines + unchanged v2 block
 *   boxes     Qwen 72B, snap only misaligned tiles                 lines (box policy alone)
 *   validated Qwen 72B, box policy + value validation              lines + unchanged v2 block
 *   spatial   validated lines + experimental spatial evidence      lines + spatial block (same budget)
 *   check     rebuild with the original policy (must equal qwen)   lines
 *
 * Row categories (technical ground-truth rows, from evaluator row states):
 *   exact      exact or exact_contradicted (a correct reading exists; contradicted counted as a risk)
 *   uncertain  the correct value appears only as a marked reading (exact_marked), or the only
 *              readings are wrong but marked (uncertain / conflict); never counted as exact
 *   incorrect  wrong with at least one unmarked wrong reading
 *   partial, inMerge, missed
 * Evidence: retained = technical rows exact in the delivered block; precision = delivered in-scope
 * readings that match a technical row (exact, with extra text, or joined) / delivered in-scope readings.
 *
 * Usage: node compare-arms.mjs [--backend openrouter-72b] [--write]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { rebuildAssociationsFromFreshOcr } from "../lib/stage3MacOcrWorker.mjs";
import { buildStage3V2PackFromRecovery } from "../lib/stage3EvidenceV2.mjs";
import { renderAnnotation } from "../lib/stage3TechnicalDigest.mjs";
import {
  evaluateItems, linesAsItems, overlapSmaller, prepareGroundTruth, quality, textKey,
  v2AnalyzerBlock, v2DeliveredItems, v2RenderedIds,
} from "../lib/stage3EvidenceEval.mjs";
import { qwenLineItems, qwenRecovery, readTileBoxes, restrictGroundTruth } from "./lib/qwenRecovery.mjs";
import { buildSpatialEvidence, deliveredItems, retrieveEvidence } from "./lib/spatialEvidence.mjs";
import { buildIndex, detailRegion } from "./stage3-link.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const DATASET = path.resolve(HERE, "..");
const OUT = path.join(DATASET, "out/qwen-spatial-audit");
const RESEARCH = path.join(DATASET, "out/gpt-5.4-audit-3364698b/ocr-research-final");
const MANIFEST = path.join(RESEARCH, "implementation/data/drawings.json");
const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const backend = arg("backend", "openrouter-72b");
const write = process.argv.includes("--write");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const res = (p) => path.resolve(path.dirname(MANIFEST), p);
const MATCHING = new Set(["correct", "correct_with_extra", "correct_join"]);

const QUERIES = [
  { sheet: "A-3.06-00", query: "guard rail height minimum", expect: ["3'-6\"MIN HEIGHT FROM", "3'-6\""] },
  { sheet: "A-3.06-00", query: "guard rail sphere passage", expect: ["PREVENT THE PASSAGE OF A SPHERE 21\" IN DIA"] },
  { sheet: "A-1.01-00", query: "fire rated partition", expect: ["NEW 1 HR. FIRE"] },
  { sheet: "A-6.00-00", query: "door 11 note", expect: ["(NOTE 11)"] },
  { sheet: "A-6.00-00", query: "jamb head frame", expect: ["2\"JAMB & HEAD", "2\"JAMB 4\"HD"] },
  { sheet: "S-201.00", query: "ground snow load", expect: ["GROUND SNOW LOAD: 25 PSF + DRIFT"] },
  { sheet: "S-201.00", query: "seismic loading", expect: ["Ss 0.133", "S1 0.43", "Sds 0.142", "Sd1 0.069"] },
  { sheet: "S-201.00", query: "basic wind speed", expect: ["BASIC WIND SPEED (3 SECOND GUST) 115 MPH"] },
  { sheet: "S-201.00", query: "stud 600S162 MIL", expect: ["600S162-43 MIL @ 16\" O/C"] },
];

function rowCategories(e) {
  const tech = e.rows.filter((r) => r.technical);
  const st = (r) => r.state;
  return {
    technicalRows: tech.length,
    exact: tech.filter((r) => ["exact", "exact_contradicted"].includes(st(r))).length,
    exactContradicted: tech.filter((r) => st(r) === "exact_contradicted").length,
    uncertain: tech.filter((r) => st(r) === "exact_marked" || (st(r) === "wrong" && r.wrongUnmarked === 0)).length,
    uncertainCorrectFlagged: tech.filter((r) => st(r) === "exact_marked").length,
    incorrect: tech.filter((r) => st(r) === "wrong" && r.wrongUnmarked > 0).length,
    partial: tech.filter((r) => st(r) === "partial").length,
    inMerge: tech.filter((r) => st(r) === "exact_in_merge").length,
    missed: tech.filter((r) => st(r) === "none").length,
    completeTechnicalAnnotations: e.annotationsTechnical.complete,
    technicalAnnotations: e.annotationsTechnical.annotations,
  };
}

const isExact = (s) => s === "exact" || s === "exact_contradicted";

/** Rows whose text is read somewhere, whether that read sits on the row, and the misplaced rows (as eval-ocr spatialCheck). */
function placement(gt, lines) {
  let found = 0, placed = 0;
  const misplaced = [];
  for (const r of gt.rows.filter((x) => x.technical)) {
    const t = textKey(r.text);
    const hits = lines.filter((l) => { const q = quality(l.text, r.text); return q === "E" || (q === "S" && textKey(l.text).length <= t.length * 1.6); });
    if (!hits.length) continue;
    found += 1;
    const best = hits.map((l) => ({ l, o: overlapSmaller(l.box, r.box) })).sort((a, b) => b.o - a.o)[0];
    if (best.o >= 0.5) placed += 1;
    else misplaced.push({ truth: r.text, read: best.l.text, overlap: Number(best.o.toFixed(2)),
      dyPt: Math.round((best.l.box.y + best.l.box.height / 2) - (r.box.y + r.box.height / 2)), dxPt: Math.round((best.l.box.x + best.l.box.width / 2) - (r.box.x + r.box.width / 2)) });
  }
  return { technicalRowsTextFound: found, boxOnRow: placed, misplaced };
}

function v2Block(sheetId, layout, recovery, geometry, source) {
  const relaid = rebuildAssociationsFromFreshOcr(layout, recovery);
  const pack = buildStage3V2PackFromRecovery({ sheetId, layout: relaid, recovery, source, geometry });
  const block = v2AnalyzerBlock([pack]);
  const rowById = new Map(pack.evidenceModel.rows.map((r) => [r.rid, r]));
  const annById = new Map(pack.evidenceModel.annotations.map((a) => [a.aid, a]));
  const rendered = new Set(v2RenderedIds(pack, block, (aid) => renderAnnotation(annById.get(aid), rowById)));
  return { block, items: v2DeliveredItems(pack).filter((i) => rendered.has(i.id)) };
}

function evidenceScore(items, gt, ocrStates, block) {
  const e = evaluateItems(items, gt, {});
  const inScope = e.segmentLog.filter((s) => s.category !== "out_of_scope");
  const techHit = inScope.filter((s) => MATCHING.has(s.category) && s.gids.some((g) => gt.rowById.get(g).technical));
  const retained = e.rows.filter((r) => r.technical && isExact(r.state));
  const exactInOcr = [...ocrStates.values()].filter(isExact).length;
  return {
    chars: block.length, units: items.length,
    retainedExact: retained.length, retainedOfOcrExact: retained.filter((r) => isExact(ocrStates.get(r.gid))).length, ocrExact: exactInOcr,
    readings: inScope.length, technicalReadings: techHit.length,
    precision: inScope.length ? Number((techHit.length / inScope.length).toFixed(3)) : null,
    recallOfOcrExact: exactInOcr ? Number((retained.filter((r) => isExact(ocrStates.get(r.gid))).length / exactInOcr).toFixed(3)) : null,
    rows: rowCategories(e),
    exactGids: retained.map((r) => r.gid),
  };
}

function printedElsewhere(sheet) {
  const keys = [];
  const s1 = path.join(OUT, "sheets", sheet, "stage1/stage1.json");
  if (existsSync(s1)) keys.push(...readJson(s1).textLayer.lines.map((l) => textKey(l.text)));
  const o12 = path.join(RESEARCH, "implementation/data/ocr12x9", `${sheet}.json`);
  if (existsSync(o12)) keys.push(...readJson(o12).observations.map((o) => textKey(o.text)));
  const joined = keys.filter((k) => k.length >= 2).join("\n");
  return (t) => { const k = textKey(t); return k.length >= 2 && joined.includes(k); };
}

function ocrArm(items, gt, lines, isPrinted) {
  const e = evaluateItems(items, gt, {});
  const segsFor = (gid) => e.segmentLog.filter((s) => s.gids.includes(gid)).map((s) => `${s.text}${s.marker ? ` [${s.marker}]` : ""}`);
  const noise = e.segmentLog.filter((s) => s.category === "noise");
  const tech = e.rows.filter((r) => r.technical);
  return {
    rows: rowCategories(e),
    placement: placement(gt, lines),
    states: new Map(tech.map((r) => [r.gid, r.state])),
    incorrectRows: tech.filter((r) => r.state === "wrong" && r.wrongUnmarked > 0).map((r) => ({ gid: r.gid, truth: r.text, read: segsFor(r.gid) })),
    uncertainRows: tech.filter((r) => r.state === "exact_marked" || (r.state === "wrong" && r.wrongUnmarked === 0)).map((r) => ({ gid: r.gid, truth: r.text, read: segsFor(r.gid) })),
    contradictedRows: tech.filter((r) => r.state === "exact_contradicted").map((r) => ({ gid: r.gid, truth: r.text, read: segsFor(r.gid) })),
    unsupportedReadings: noise.filter((s) => !isPrinted(s.text)).map((s) => s.text),
    noMatchReadings: noise.length,
  };
}

const idxPath = (sheet, variant) => path.join(OUT, "sheets", sheet, "stage2", `sheet-index.${backend}${variant ? `.${variant}` : ""}.json`);
const index82 = readJson(path.join(OUT, "index82.json"));
const idx82 = buildIndex(index82);
const manifest = readJson(MANIFEST);
const results = [];
const blocksDir = path.join(OUT, "blocks");
if (write) mkdirSync(path.join(OUT, "evidence"), { recursive: true });

for (const d of manifest.drawings) {
  const sheet = d.sheetId;
  const stage1 = readJson(path.join(OUT, "sheets", sheet, "stage1/stage1.json"));
  const idx = Object.fromEntries(["", "check", "boxes", "validated"].map((v) => [v || "qwen", readJson(idxPath(sheet, v))]));
  const fullGt = readJson(res(d.groundTruth));
  const gt = prepareGroundTruth(restrictGroundTruth(fullGt, readTileBoxes(idx.qwen, stage1)));
  const isPrinted = printedElsewhere(sheet);
  const layout = readJson(res(d.layout));
  const avRecovery = readJson(res(d.recovery));
  const geometry = d.geometry && existsSync(res(d.geometry)) ? readJson(res(d.geometry)) : null;
  const avPage = avRecovery.pages[0];

  const ocr = {
    av: ocrArm(linesAsItems(avPage.lines, avPage.words, "l"), gt, avPage.lines, isPrinted),
    qwen: ocrArm(qwenLineItems(idx.qwen), gt, idx.qwen.lines, isPrinted),
    check: ocrArm(qwenLineItems(idx.check), gt, idx.check.lines, isPrinted),
    boxes: ocrArm(qwenLineItems(idx.boxes), gt, idx.boxes.lines, isPrinted),
    validated: ocrArm(qwenLineItems(idx.validated), gt, idx.validated.lines, isPrinted),
  };

  const s82 = idx82.lookup(sheet);
  const details = (s82?.details || []).map((x) => ({ number: x.detail, title: x.title, scale: x.scale, titleBox: x.titleBox, region: detailRegion(x, s82.details, s82.page) }));
  const avV2 = v2Block(sheet, layout, avRecovery, geometry, "4x3");
  const qV2 = v2Block(sheet, layout, qwenRecovery(idx.qwen), geometry, `qwen-${backend}`);
  const vV2 = v2Block(sheet, layout, qwenRecovery(idx.validated), geometry, `qwen-${backend}-validated`);
  const sp = buildSpatialEvidence(idx.validated, { details, maxChars: 3200, source: `qwen-${backend}-validated` });
  const evidence = {
    av: evidenceScore(avV2.items, gt, ocr.av.states, avV2.block),
    qwen: evidenceScore(qV2.items, gt, ocr.qwen.states, qV2.block),
    validated: evidenceScore(vV2.items, gt, ocr.validated.states, vV2.block),
    spatial: evidenceScore(sp.delivered, gt, ocr.validated.states, sp.block),
  };

  const retrieval = QUERIES.filter((q) => q.sheet === sheet).map((q) => {
    const r = retrieveEvidence(sp.pack, q.query);
    const has = (texts) => q.expect.map((x) => ({ expect: x, found: texts.some((t) => ["E", "S"].includes(quality(t, x))) }));
    const segTexts = (items) => items.flatMap((i) => i.segments.map((s) => s.text));
    return {
      query: q.query,
      qwenV2Block: has(segTexts(qV2.items)), spatialBlock: has(segTexts(sp.delivered)),
      retrieved: has(segTexts(deliveredItems(r.units))), retrievedChars: r.block.length, retrievedUnits: r.units.length,
    };
  });

  const validation = idx.validated.build?.validation || null;
  const corrected = idx.validated.lines.filter((l) => l.ocrText && l.ocrText !== l.text);
  const flagged = idx.validated.lines.filter((l) => (l.valueChecks || []).some((c) => String(c.status).startsWith("flagged")));
  const transitions = (from, to) => [...ocr[to].states].filter(([g, s]) => isExact(s) !== isExact(ocr[from].states.get(g)))
    .map(([g, s]) => ({ truth: gt.rowById.get(g).text, before: ocr[from].states.get(g), after: s }));

  if (write) {
    writeFileSync(path.join(OUT, "evidence", `${sheet}.spatial.block.txt`), sp.block);
    writeFileSync(path.join(OUT, "evidence", `${sheet}.spatial.pack.json`), JSON.stringify(sp.pack, null, 1));
    mkdirSync(blocksDir, { recursive: true });
    writeFileSync(path.join(blocksDir, `${sheet}.qwen-${backend}-validated.v2.block.txt`), vV2.block);
  }
  const lost = (a, b) => evidence[a].exactGids.filter((g) => !evidence[b].exactGids.includes(g)).map((g) => gt.rowById.get(g).text);
  const changes = { boxPolicy: transitions("qwen", "boxes"), validation: transitions("boxes", "validated"),
    evidenceOnlyInValidatedV2: lost("validated", "spatial"), evidenceOnlyInSpatial: lost("spatial", "validated"),
    spatialExactNotExactInOcr: evidence.spatial.exactGids.filter((g) => !isExact(ocr.validated.states.get(g)))
      .map((g) => ({ truth: gt.rowById.get(g).text, ocrState: ocr.validated.states.get(g) })) };
  const seamResolvedLines = sp.pack.shown.flatMap((u) => u.copies.flatMap((c) => c.lines.filter((l) => l.seamResolved).map((l) => ({ text: l.text, cut: l.cutReadings }))));
  changes.spatialSeamResolvedShown = seamResolvedLines;
  for (const a of Object.values(ocr)) a.states = undefined;
  results.push({
    sheet, gtTechnicalRows: gt.rows.filter((r) => r.technical).length, ocr, evidence, retrieval,
    validation: { tally: validation, correctedLines: corrected.map((l) => ({ lid: l.lid, ocr: l.ocrText, text: l.text, checks: l.valueChecks })),
      flaggedLines: flagged.map((l) => ({ lid: l.lid, text: l.text, checks: l.valueChecks })) },
    changes,
    blockChars: { av: avV2.block.length, qwen: qV2.block.length, validated: vV2.block.length, spatial: sp.block.length },
  });
}

const sum = (f) => results.reduce((s, r) => s + f(r), 0);
const totals = {};
for (const arm of ["av", "qwen", "check", "boxes", "validated"]) {
  totals[arm] = Object.fromEntries(Object.keys(results[0].ocr[arm].rows).map((k) => [k, sum((r) => r.ocr[arm].rows[k])]));
  totals[arm].boxOnRow = sum((r) => r.ocr[arm].placement.boxOnRow);
  totals[arm].textFound = sum((r) => r.ocr[arm].placement.technicalRowsTextFound);
  totals[arm].unsupportedReadings = sum((r) => r.ocr[arm].unsupportedReadings.length);
}
const evTotals = {};
for (const arm of ["av", "qwen", "validated", "spatial"]) {
  const t = { retainedExact: sum((r) => r.evidence[arm].retainedExact), retainedOfOcrExact: sum((r) => r.evidence[arm].retainedOfOcrExact), ocrExact: sum((r) => r.evidence[arm].ocrExact),
    readings: sum((r) => r.evidence[arm].readings), technicalReadings: sum((r) => r.evidence[arm].technicalReadings), maxChars: Math.max(...results.map((r) => r.evidence[arm].chars)) };
  t.precision = Number((t.technicalReadings / t.readings).toFixed(3));
  t.recallOfOcrExact = Number((t.retainedOfOcrExact / t.ocrExact).toFixed(3));
  t.recallOf232 = Number((t.retainedExact / sum((r) => r.gtTechnicalRows)).toFixed(3));
  t.incorrectInBlock = sum((r) => r.evidence[arm].rows.incorrect);
  t.uncertainInBlock = sum((r) => r.evidence[arm].rows.uncertain);
  evTotals[arm] = t;
}

const out = { generatedAt: new Date().toISOString(), backend, scorer: "stage3-evidence-eval.v1 (unchanged)", totals, evidenceTotals: evTotals, results };
mkdirSync(path.join(OUT, "eval"), { recursive: true });
writeFileSync(path.join(OUT, "eval", `compare-arms.${backend}.json`), JSON.stringify(out, null, 1));

const f = (m) => `exact ${m.exact} (contradicted ${m.exactContradicted}) incorrect ${m.incorrect} uncertain ${m.uncertain} partial ${m.partial} merge ${m.inMerge} missed ${m.missed} | ann ${m.completeTechnicalAnnotations}/${m.technicalAnnotations}`;
for (const r of results) {
  console.log(`\n## ${r.sheet} (${r.gtTechnicalRows} technical rows)`);
  for (const arm of ["av", "qwen", "check", "boxes", "validated"]) console.log(`  ${arm.padEnd(10)} ${f(r.ocr[arm].rows)} | box ${r.ocr[arm].placement.boxOnRow}/${r.ocr[arm].placement.technicalRowsTextFound} | unsupported ${r.ocr[arm].unsupportedReadings.length}`);
  for (const arm of ["av", "qwen", "validated", "spatial"]) { const e = r.evidence[arm]; console.log(`  block:${arm.padEnd(10)} retained ${e.retainedExact} (of OCR exact ${e.retainedOfOcrExact}/${e.ocrExact}) precision ${e.precision} chars ${e.chars} incorrect ${e.rows.incorrect} uncertain ${e.rows.uncertain}`); }
  for (const q of r.retrieval) console.log(`  query "${q.query}": v2 ${q.qwenV2Block.filter((x) => x.found).length} spatial ${q.spatialBlock.filter((x) => x.found).length} retrieved ${q.retrieved.filter((x) => x.found).length} / ${q.retrieved.length}`);
}
console.log("\nTOTALS");
for (const [arm, m] of Object.entries(totals)) console.log(`  ${arm.padEnd(10)} ${f(m)} | box ${m.boxOnRow}/${m.textFound} | unsupported ${m.unsupportedReadings}`);
for (const [arm, t] of Object.entries(evTotals)) console.log(`  block:${arm.padEnd(10)} retained ${t.retainedExact} (${t.retainedOfOcrExact}/${t.ocrExact}) precision ${t.precision} recall ${t.recallOfOcrExact} /232 ${t.recallOf232} maxChars ${t.maxChars} incorrect ${t.incorrectInBlock} uncertain ${t.uncertainInBlock}`);
