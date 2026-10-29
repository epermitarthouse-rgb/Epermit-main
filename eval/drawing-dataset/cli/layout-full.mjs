import path from "node:path";
import { fileURLToPath } from "node:url";
import { runLayoutFull } from "../lib/layoutPilot.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

function argument(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1];
}

const sourceDir = argument("--source");
const outDir = argument("--out", path.join(repoRoot, "eval/drawing-dataset/out/mcd-649fdaa6"));

if (!sourceDir) {
  console.error("Usage: node eval/drawing-dataset/cli/layout-full.mjs --source <drawing-directory> [--out <dir>] [--force]");
  process.exit(2);
}

const result = await runLayoutFull({
  sourceDir: path.resolve(sourceDir),
  outDir: path.resolve(outDir),
  force: process.argv.includes("--force"),
  onProgress: (event) => console.error(`${event.status}\t${event.relativePath}`),
});

const summary = result.summary;
console.log(`Sheets: ${summary.sheets.length}`);
console.log(`Processed: ${summary.coverage.sheetsProcessed}`);
console.log(`Overlays: ${summary.coverage.sheetsWithOverlays}`);
console.log(`Failures: ${summary.coverage.sheetsFailed}`);
console.log(`Findings preserved: ${summary.accountability.findings}`);
console.log(`S-204 identities: ${summary.accountability.s204IdentityCount}`);
console.log(`S-300 match: ${summary.accountability.s300MatchMethod}`);
console.log(`Baseline matches: ${summary.grounding.baselineMatched}`);
console.log(`Layout-region matches: ${summary.grounding.layoutMatched}`);
console.log(`Decision: ${summary.recommendation.decision}`);
console.log(`Precision: ${summary.precision}`);
console.log(`Recall: ${summary.recall}`);
console.log(`Output: ${result.outDir}`);
process.exit(summary.accountability.findingsUnchanged && summary.coverage.sheetsFailed === 0 ? 0 : 1);
