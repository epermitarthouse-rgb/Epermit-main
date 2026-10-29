import path from "node:path";
import { fileURLToPath } from "node:url";
import { runHybridPilot } from "../lib/hybridPilot.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

function argument(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1];
}

const sourceDir = argument("--source");
const outDir = argument("--out", path.join(repoRoot, "eval/drawing-dataset/out/mcd-649fdaa6"));
const doclingMode = argument("--docling", process.argv.includes("--skip-docling") ? "off" : "layout");

if (!sourceDir) {
  console.error("Usage: node eval/drawing-dataset/cli/hybrid-pilot.mjs --source <drawing-directory> [--out <dir>] [--docling layout|ocr|parse|off] [--force]");
  process.exit(2);
}

const result = await runHybridPilot({
  sourceDir: path.resolve(sourceDir),
  outDir: path.resolve(outDir),
  force: process.argv.includes("--force"),
  skipDocling: doclingMode === "off" || process.argv.includes("--skip-docling"),
  doclingMode,
  forceDocling: process.argv.includes("--force-docling"),
  onProgress: (event) => console.error(`${event.status}\t${event.relativePath}`),
});

const summary = result.summary;
console.log(`Inventory PDFs: ${summary.accountability.pdfCount}`);
console.log(`Required files present: ${summary.accountability.requiredPresent}`);
console.log(`Pilot sheets: ${summary.sheets.length}`);
console.log(`Findings preserved: ${summary.grounding.findings}`);
console.log(`Baseline matches: ${summary.grounding.baselineMatched}`);
console.log(`Hybrid matches: ${summary.grounding.hybridMatched}`);
console.log(`Recommendation: ${summary.recommendation.decision}`);
console.log(`Precision: ${summary.precision}`);
console.log(`Recall: ${summary.recall}`);
console.log(`Output: ${result.outDir}`);
process.exit(summary.accountability.requiredPresent ? 0 : 1);
