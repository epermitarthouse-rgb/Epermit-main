#!/usr/bin/env node
/**
 * Local Stage 3 targeted visual extraction spike.
 * Writes only under gitignored eval/drawing-dataset/out/.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runStage3VisualExtractionSpike } from "../lib/stage3VisualExtractionSpike.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const datasetOut = path.resolve(root, "eval/drawing-dataset/out/mcd-649fdaa6");
const outDir = path.resolve(datasetOut, "phase3-stage3-spike");
const sourceDir = process.env.DRAWING_SOURCE_DIR
  || path.resolve(datasetOut, "source-pdfs");

const summary = await runStage3VisualExtractionSpike({
  datasetOut,
  outDir,
  sourceDir: process.argv.includes("--crops") ? sourceDir : null,
});

console.log(JSON.stringify({
  version: summary.version,
  outDir,
  latencyMsTotal: summary.latencyMsTotal,
  comparisons: summary.comparisons,
  sheets: Object.fromEntries(
    Object.entries(summary.sheets).map(([id, pack]) => [id, {
      status: pack.status,
      detailIdentifier: pack.detailIdentifier || pack.assessment?.detailIdentifier || null,
      hitSummary: pack.hits || null,
      association: pack.assessment?.status || null,
    }]),
  ),
}, null, 2));
