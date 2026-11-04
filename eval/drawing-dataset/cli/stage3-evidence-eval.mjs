#!/usr/bin/env node
/**
 * Stage 3 evidence evaluation (local only, no network).
 *
 * Scores the production v1 path per drawing: 4x3 recovery words, reconstructed lines and
 * the v1 analyzer Stage 3 block, against a visual ground truth. Optional 12x9 observations
 * add raw / filtered / deduplicated word stages.
 *
 * Usage: node eval/drawing-dataset/cli/stage3-evidence-eval.mjs --manifest <drawings.json> [--out <result.json>] [--detail]
 * Manifest: { drawings: [{ sheetId, groundTruth, layout, recovery, savedPack?, ocr12x9? }] } (paths absolute or
 * relative to the manifest). Customer inputs and outputs stay under gitignored out/.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dedupeOcrWords } from "../lib/ocrRecover.mjs";
import { extractForSheet, rebuildAssociationsFromFreshOcr } from "../lib/stage3MacOcrWorker.mjs";
import { formatStage3PromptBlock } from "../lib/stage3VisualExtractionSpike.mjs";
import { buildStage3V2PackFromRecovery } from "../lib/stage3EvidenceV2.mjs";
import { renderAnnotation } from "../lib/stage3TechnicalDigest.mjs";
import {
  STAGE3_EVIDENCE_EVAL_VERSION,
  evaluateItems,
  linesAsItems,
  prepareGroundTruth,
  summarize,
  v1AnalyzerBlock,
  v1DeliveredItems,
  v2AnalyzerBlock,
  v2DeliveredItems,
  v2RenderedIds,
  wordsAsItems,
} from "../lib/stage3EvidenceEval.mjs";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : null;
}
const manifestPath = arg("manifest");
if (!manifestPath) {
  console.error("usage: stage3-evidence-eval.mjs --manifest <drawings.json> [--out <result.json>] [--detail]");
  process.exit(2);
}
const detail = process.argv.includes("--detail");
const base = path.dirname(path.resolve(manifestPath));
const resolve = (p) => (p ? path.resolve(base, p) : null);
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const manifest = readJson(manifestPath);

/** The worker's v1 pack for one drawing: fresh-OCR association rebuild, routed extractor, prompt block. */
export function v1PackFor(sheetId, layout, recovery) {
  const rebuilt = rebuildAssociationsFromFreshOcr(layout, recovery);
  const pack = extractForSheet(sheetId, rebuilt);
  pack.promptBlock = formatStage3PromptBlock(pack);
  return { pack, layout: rebuilt };
}

const results = [];
for (const d of manifest.drawings) {
  const gt = prepareGroundTruth(readJson(resolve(d.groundTruth)));
  const layout = readJson(resolve(d.layout));
  const recovery = readJson(resolve(d.recovery));
  const page = recovery.pages[0];
  const stages = {};
  const run = (name, items, extra = {}) => {
    const e = evaluateItems(items, gt, { detail });
    stages[name] = { ...extra, summary: summarize(e), ...(detail ? { evaluation: e } : {}) };
  };

  if (d.ocr12x9 && existsSync(resolve(d.ocr12x9))) {
    const obs = readJson(resolve(d.ocr12x9)).observations;
    const filtered = obs.filter((o) => String(o.text || "").trim() && o.confidence >= 0.45);
    run("12x9 raw observations", wordsAsItems(obs, "r"), { units: obs.length });
    run("12x9 after confidence filter", wordsAsItems(filtered, "f"), { units: filtered.length });
    const deduped = dedupeOcrWords(obs);
    run("12x9 after production dedupe", wordsAsItems(deduped, "d"), { units: deduped.length });
  }
  run("4x3 deduplicated words", wordsAsItems(page.words, "w"), { units: page.words.length });
  run("4x3 reconstructed lines", linesAsItems(page.lines, page.words, "l"), { units: page.lines.length });

  const { pack, layout: rebuilt } = v1PackFor(d.sheetId, layout, recovery);
  const block = v1AnalyzerBlock([pack]);
  const delivered = v1DeliveredItems(pack, block, rebuilt, recovery);
  run("v1 analyzer Stage 3 block", delivered, {
    units: delivered.length, packChars: pack.promptBlock.length, blockChars: block.length,
    truncatedAtPackBound: pack.promptBlock.length > 1200, packId: pack.id, topic: pack.topic,
    ...(detail ? { block } : {}),
  });

  const v2 = buildStage3V2PackFromRecovery({ sheetId: d.sheetId, layout: rebuilt, recovery, source: "4x3" });
  const v2Block = v2AnalyzerBlock([v2]);
  const rowById = new Map(v2.evidenceModel.rows.map((r) => [r.rid, r]));
  const annById = new Map(v2.evidenceModel.annotations.map((a) => [a.aid, a]));
  const rendered = new Set(v2RenderedIds(v2, v2Block, (aid) => renderAnnotation(annById.get(aid), rowById)));
  const v2Items = v2DeliveredItems(v2).filter((item) => rendered.has(item.id));
  run("v2 analyzer Stage 3 block", v2Items, {
    units: v2Items.length, packChars: v2.promptBlock.length, blockChars: v2Block.length,
    shownNotRendered: v2.digest.shown.length - rendered.size, digest: { ...v2.digest, shown: undefined, omitted: undefined },
    ...(detail ? { block: v2Block } : {}),
  });

  let parity = null;
  if (d.savedPack && existsSync(resolve(d.savedPack))) {
    const saved = readJson(resolve(d.savedPack));
    parity = {
      packId: pack.id === saved.id,
      promptBlock: pack.promptBlock === saved.promptBlock,
      extractedTexts: JSON.stringify(pack.extractedTexts) === JSON.stringify(saved.extractedTexts),
    };
  }
  results.push({ sheetId: d.sheetId, scope: gt.scope, groundTruth: { rows: gt.rows.length, technicalRows: gt.rows.filter((r) => r.technical).length, annotations: gt.annotations.length, technicalAnnotations: gt.annotations.filter((a) => a.technical).length }, parity, stages });
}

const out = { evalVersion: STAGE3_EVIDENCE_EVAL_VERSION, generatedAt: new Date().toISOString(), results };
if (arg("out")) writeFileSync(path.resolve(arg("out")), JSON.stringify(out, null, 1));
for (const r of results) {
  console.log(`\n## ${r.sheetId} (${r.scope}) GT rows=${r.groundTruth.rows} tech=${r.groundTruth.technicalRows} ann=${r.groundTruth.annotations} techAnn=${r.groundTruth.technicalAnnotations}${r.parity ? ` parity=${JSON.stringify(r.parity)}` : ""}`);
  for (const [name, s] of Object.entries(r.stages)) {
    const m = s.summary;
    console.log(`${name.padEnd(30)} units=${String(s.units).padEnd(5)} techRows exact=${m.techRowsExact} clean=${m.techRowsClean} contra=${m.techRowsContradicted} marked=${m.techRowsMarked} merge=${m.techRowsInMerge} partial=${m.techRowsPartial} wrong=${m.techRowsWrong} none=${m.techRowsNone} | techAnn complete=${m.techAnnComplete} clean=${m.techAnnClean} context=${m.techAnnContext} | mixed=${m.mixedSegments} wrongTechUnmarked=${m.wrongTechUnmarked} wrongDim=${m.wrongDimUnmarked} outOfScope=${m.segmentsOutOfScope}${s.blockChars ? ` | chars pack=${s.packChars} block=${s.blockChars}` : ""}`);
  }
}
