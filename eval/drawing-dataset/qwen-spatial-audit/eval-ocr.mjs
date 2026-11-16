#!/usr/bin/env node
/**
 * OCR and evidence comparison: Apple Vision 4x3 (saved recovery, not re-run) against Qwen2.5-VL
 * (stage 2 sheet index), scored with the existing stage 3 evaluator and visual ground truth.
 *
 * Stages per drawing and OCR source:
 *   lines          every OCR line as delivered text (OCR quality)
 *   v2 rows        the unchanged v2 row reconstruction on that OCR
 *   v2 block       the unchanged v2 analyzer Stage 3 block (what the reasoning model receives)
 * plus a spatial check: of the rows whose text is read anywhere, how many carry a correct box.
 *
 * When Qwen read only part of a sheet, both sources are scored on the ground-truth rows inside the
 * tiles Qwen read, so the comparison stays like for like.
 *
 * Usage: node eval-ocr.mjs [--backend local-3b] [--subset] [--write-blocks]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { rebuildAssociationsFromFreshOcr } from "../lib/stage3MacOcrWorker.mjs";
import { buildStage3V2Model, buildStage3V2PackFromRecovery } from "../lib/stage3EvidenceV2.mjs";
import { renderAnnotation } from "../lib/stage3TechnicalDigest.mjs";
import {
  evaluateItems, linesAsItems, overlapSmaller, prepareGroundTruth, quality, summarize, textKey,
  v2AnalyzerBlock, v2DeliveredItems, v2RenderedIds,
} from "../lib/stage3EvidenceEval.mjs";
import { qwenLineItems, qwenRecovery, readTileBoxes, restrictGroundTruth } from "./lib/qwenRecovery.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const DATASET = path.resolve(HERE, "..");
const OUT = path.join(DATASET, "out/qwen-spatial-audit");
const MANIFEST = path.join(DATASET, "out/gpt-5.4-audit-3364698b/ocr-research-final/implementation/data/drawings.json");
const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const backend = arg("backend", "local-3b");
const subset = process.argv.includes("--subset");
const writeBlocks = process.argv.includes("--write-blocks");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const base = path.dirname(MANIFEST);
const res = (p) => path.resolve(base, p);

/** Rows whose text is read somewhere (exact or with extra text), and whether that read sits on the row. */
export function spatialCheck(gt, lines) {
  let found = 0, placed = 0;
  const ious = [];
  for (const r of gt.rows.filter((x) => x.technical)) {
    const t = textKey(r.text);
    const hits = lines.filter((l) => { const q = quality(l.text, r.text); return q === "E" || (q === "S" && textKey(l.text).length <= t.length * 1.6); });
    if (!hits.length) continue;
    found += 1;
    const best = Math.max(...hits.map((l) => overlapSmaller(l.box, r.box)));
    if (best >= 0.5) placed += 1;
    ious.push(best);
  }
  ious.sort((a, b) => a - b);
  return { technicalRowsTextFound: found, boxOnRow: placed, medianOverlap: ious.length ? Number(ious[Math.floor(ious.length / 2)].toFixed(3)) : null };
}

function v2Stages(sheetId, layout, recovery, geometry, source, gt) {
  const relaid = rebuildAssociationsFromFreshOcr(layout, recovery);
  const model = buildStage3V2Model({ layout: relaid, recovery, geometry });
  const rowsEval = evaluateItems(model.rows.map((r) => ({ id: r.rid, segments: [{ text: r.text, words: r.words }] })), gt, { detail: false });
  const pack = buildStage3V2PackFromRecovery({ sheetId, layout: relaid, recovery, source, geometry });
  const block = v2AnalyzerBlock([pack]);
  const rowById = new Map(pack.evidenceModel.rows.map((r) => [r.rid, r]));
  const annById = new Map(pack.evidenceModel.annotations.map((a) => [a.aid, a]));
  const rendered = new Set(v2RenderedIds(pack, block, (aid) => renderAnnotation(annById.get(aid), rowById)));
  const items = v2DeliveredItems(pack).filter((i) => rendered.has(i.id));
  const blockEval = evaluateItems(items, gt, { detail: false });
  return { rows: { units: model.rows.length, summary: summarize(rowsEval) }, block: { units: items.length, chars: block.length, summary: summarize(blockEval) }, blockText: block };
}

const manifest = readJson(MANIFEST);
const results = [];
for (const d of manifest.drawings) {
  const sheet = d.sheetId;
  const idxPath = path.join(OUT, "sheets", sheet, "stage2", `sheet-index.${backend}${subset ? ".subset" : ""}.json`);
  const s1Path = path.join(OUT, "sheets", sheet, "stage1", "stage1.json");
  if (!existsSync(idxPath)) { results.push({ sheet, status: `no ${backend} sheet index` }); continue; }
  const index = readJson(idxPath);
  const stage1 = readJson(s1Path);
  const fullGt = readJson(res(d.groundTruth));
  const tileBoxes = readTileBoxes(index, stage1);
  const restricted = restrictGroundTruth(fullGt, tileBoxes);
  const coverage = { gtRows: fullGt.rows.length, gtRowsInReadTiles: restricted.rows.length, tilesRead: tileBoxes.length };
  const gt = prepareGroundTruth(restricted);
  const layout = readJson(res(d.layout));
  const avRecovery = readJson(res(d.recovery));
  const geometry = d.geometry && existsSync(res(d.geometry)) ? readJson(res(d.geometry)) : null;
  const avPage = avRecovery.pages[0];
  const qRecovery = qwenRecovery(index);

  const av = {
    lines: { units: avPage.lines.length, summary: summarize(evaluateItems(linesAsItems(avPage.lines, avPage.words, "l"), gt, { detail: false })) },
    ...(() => { const v = v2Stages(sheet, layout, avRecovery, geometry, "4x3", gt); return { v2Rows: v.rows, v2Block: v.block, _block: v.blockText }; })(),
    spatial: spatialCheck(gt, avPage.lines),
  };
  const rawIndex = { ...index, lines: index.lines.map((l) => ({ ...l, box: l.modelBox || l.box })) };
  const qw = {
    lines: { units: index.lines.length, summary: summarize(evaluateItems(qwenLineItems(index), gt, { detail: false })) },
    linesModelBoxes: { units: index.lines.length, summary: summarize(evaluateItems(qwenLineItems(rawIndex), gt, { detail: false })) },
    ...(() => { const v = v2Stages(sheet, layout, qRecovery, geometry, `qwen-${backend}`, gt); return { v2Rows: v.rows, v2Block: v.block, _block: v.blockText }; })(),
    spatial: spatialCheck(gt, index.lines),
    spatialModelBoxes: spatialCheck(gt, rawIndex.lines),
    snapped: index.lines.filter((l) => l.snapShiftPx != null).length,
  };
  if (writeBlocks) {
    const dir = path.join(OUT, "blocks");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${sheet}.apple-vision-4x3.v2.block.txt`), av._block);
    writeFileSync(path.join(dir, `${sheet}.qwen-${backend}.v2.block.txt`), qw._block);
  }
  delete av._block; delete qw._block;
  results.push({ sheet, coverage, appleVision4x3: av, qwen: { backend, model: index.model, ...qw } });
}

const out = { generatedAt: new Date().toISOString(), backend, subset, scorer: "stage3-evidence-eval.v1 (unchanged)", results };
mkdirSync(path.join(OUT, "eval"), { recursive: true });
writeFileSync(path.join(OUT, "eval", `ocr-compare.${backend}${subset ? ".subset" : ""}.json`), JSON.stringify(out, null, 1));

const fmt = (m) => `techRows exact=${m.techRowsExact}/${m.techRows} wrong=${m.techRowsWrong} partial=${m.techRowsPartial} none=${m.techRowsNone} | techAnn complete=${m.techAnnComplete}/${m.techAnn} | wrongTechUnmarked=${m.wrongTechUnmarked} mixed=${m.mixedSegments}`;
for (const r of results) {
  if (!r.coverage) { console.log(`\n## ${r.sheet}: ${r.status}`); continue; }
  console.log(`\n## ${r.sheet} GT rows in read tiles ${r.coverage.gtRowsInReadTiles}/${r.coverage.gtRows} (tiles read ${r.coverage.tilesRead})`);
  for (const [name, src] of [["AppleVision4x3", r.appleVision4x3], [`Qwen ${backend}`, r.qwen]]) {
    console.log(`  ${name.padEnd(16)} lines   ${fmt(src.lines.summary)}`);
    console.log(`  ${"".padEnd(16)} v2rows  ${fmt(src.v2Rows.summary)}`);
    console.log(`  ${"".padEnd(16)} v2block ${fmt(src.v2Block.summary)} chars=${src.v2Block.chars}`);
    console.log(`  ${"".padEnd(16)} spatial ${JSON.stringify(src.spatial)}`);
    if (src.linesModelBoxes) {
      console.log(`  ${"".padEnd(16)} lines (model boxes, no snap) ${fmt(src.linesModelBoxes.summary)}`);
      console.log(`  ${"".padEnd(16)} spatial (model boxes) ${JSON.stringify(src.spatialModelBoxes)} snapped=${src.snapped}/${src.lines.units}`);
    }
  }
}
