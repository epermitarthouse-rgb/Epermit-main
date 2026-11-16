#!/usr/bin/env node
/**
 * Row-level OCR detail behind eval-ocr.mjs: for each drawing and OCR source, which ground-truth
 * technical rows were read exactly, read with a wrong value, read partly or missed, and which
 * in-scope readings match no ground-truth row (hallucination candidates). Candidates are split by
 * whether the same text exists in the PDF text layer or the saved Apple Vision 12x9 read of the
 * sheet (then it is printed text outside the ground-truth rows, not invented).
 *
 * Usage: node ocr-detail.mjs --backend openrouter-72b [--subset] [--compare local-3b]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { changesDimensionValue, evaluateItems, linesAsItems, prepareGroundTruth, textKey } from "../lib/stage3EvidenceEval.mjs";
import { qwenLineItems, readTileBoxes, restrictGroundTruth } from "./lib/qwenRecovery.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const DATASET = path.resolve(HERE, "..");
const OUT = path.join(DATASET, "out/qwen-spatial-audit");
const RESEARCH = path.join(DATASET, "out/gpt-5.4-audit-3364698b/ocr-research-final");
const MANIFEST = path.join(RESEARCH, "implementation/data/drawings.json");
const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const backend = arg("backend", "openrouter-72b");
const compare = arg("compare");
const subset = process.argv.includes("--subset");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const res = (p) => path.resolve(path.dirname(MANIFEST), p);

function printedElsewhere(sheet) {
  const keys = [];
  const s1 = path.join(OUT, "sheets", sheet, "stage1/stage1.json");
  if (existsSync(s1)) keys.push(...readJson(s1).textLayer.lines.map((l) => textKey(l.text)));
  const o12 = path.join(RESEARCH, "implementation/data/ocr12x9", `${sheet}.json`);
  if (existsSync(o12)) keys.push(...readJson(o12).observations.map((o) => textKey(o.text)));
  const joined = keys.filter((k) => k.length >= 2).join("\n");
  return (t) => { const k = textKey(t); return k.length >= 2 && joined.includes(k); };
}

function detail(items, gt, isPrinted) {
  const e = evaluateItems(items, gt, {});
  const segsFor = (gid) => e.segmentLog.filter((s) => s.gids.includes(gid)).map((s) => `${s.text} [${s.category}]`);
  const tech = e.rows.filter((r) => r.technical);
  const by = (st) => tech.filter((r) => st.includes(r.state));
  const wrong = by(["wrong"]).map((r) => ({
    truth: r.text, read: segsFor(r.gid),
    changesValue: e.segmentLog.some((s) => s.gids.includes(r.gid) && !["correct", "correct_with_extra", "correct_join"].includes(s.category) && changesDimensionValue(s.text, r.text, s.gids.length > 1)),
  }));
  const noise = e.segmentLog.filter((s) => s.category === "noise");
  const unsupported = noise.filter((s) => !isPrinted(s.text));
  return {
    technicalRows: tech.length,
    exact: by(["exact", "exact_contradicted"]).length, exactContradicted: by(["exact_contradicted"]).length,
    exactMarkedConflict: by(["exact_marked"]).length, exactInMerge: by(["exact_in_merge"]).length,
    contradictedRows: by(["exact_contradicted"]).map((r) => ({ truth: r.text, read: segsFor(r.gid) })),
    wrong: wrong.length, wrongChangesValue: wrong.filter((w) => w.changesValue).length, partial: by(["partial"]).length, missed: by(["none"]).length,
    wrongRows: wrong, partialRows: by(["partial"]).map((r) => ({ truth: r.text, read: segsFor(r.gid) })), missedRows: by(["none"]).map((r) => r.text),
    inScopeReadings: e.segmentLog.filter((s) => s.category !== "out_of_scope").length,
    noMatchReadings: noise.length, noMatchPrintedElsewhere: noise.length - unsupported.length, noMatchUnsupported: unsupported.length,
    unsupportedExamples: unsupported.map((s) => s.text).slice(0, 25),
    states: Object.fromEntries(tech.map((r) => [r.gid, r.state])),
  };
}

const manifest = readJson(MANIFEST);
const out = { generatedAt: new Date().toISOString(), backend, compare, subset, sheets: [] };
for (const d of manifest.drawings) {
  const sheet = d.sheetId;
  const idxPath = (b) => path.join(OUT, "sheets", sheet, "stage2", `sheet-index.${b}${subset ? ".subset" : ""}.json`);
  if (!existsSync(idxPath(backend))) continue;
  const index = readJson(idxPath(backend));
  const stage1 = readJson(path.join(OUT, "sheets", sheet, "stage1/stage1.json"));
  const fullGt = readJson(res(d.groundTruth));
  const gt = prepareGroundTruth(restrictGroundTruth(fullGt, readTileBoxes(index, stage1)));
  const isPrinted = printedElsewhere(sheet);
  const av = readJson(res(d.recovery)).pages[0];
  const row = {
    sheet, gtScope: fullGt.scope || "full", gtRowsScored: gt.rows.length, tilesRead: index.coverage.tilesRead, tilesNonBlank: index.coverage.tilesTotal - index.coverage.tilesBlank,
    appleVision4x3: detail(linesAsItems(av.lines, av.words, "l"), gt, isPrinted),
    [backend]: detail(qwenLineItems(index), gt, isPrinted),
  };
  if (compare && existsSync(idxPath(compare))) {
    const cIdx = readJson(idxPath(compare));
    const same = JSON.stringify(cIdx.tileReports.map((t) => t.tileId).sort()) === JSON.stringify(index.tileReports.map((t) => t.tileId).sort());
    row[compare] = same ? detail(qwenLineItems(cIdx), gt, isPrinted) : { skipped: "different tiles read" };
  }
  out.sheets.push(row);
  const f = (x) => (x.skipped ? x.skipped : `exact ${x.exact}/${x.technicalRows} (also-misread ${x.exactContradicted}) conflict-marked ${x.exactMarkedConflict} wrong ${x.wrong} (value changed ${x.wrongChangesValue}) partial ${x.partial} missed ${x.missed} | no-match ${x.noMatchReadings} (unsupported ${x.noMatchUnsupported})`);
  console.log(`## ${sheet} (${row.gtScope}, ${row.gtRowsScored} GT rows, tiles ${row.tilesRead}/${row.tilesNonBlank})`);
  for (const k of ["appleVision4x3", backend, compare].filter((k) => k && row[k])) console.log(`  ${k.padEnd(16)} ${f(row[k])}`);
}
mkdirSync(path.join(OUT, "eval"), { recursive: true });
writeFileSync(path.join(OUT, "eval", `ocr-detail.${backend}${subset ? ".subset" : ""}.json`), JSON.stringify(out, null, 1));
