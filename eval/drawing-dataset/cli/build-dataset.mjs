import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDrawingDataset } from "../lib/buildDataset.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

function argument(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1];
}

const sourceDir = argument("--source");
const outDir = argument("--out", path.join(repoRoot, "eval/drawing-dataset/out/mcd-649fdaa6"));
const findingsPath = argument("--findings", path.join(repoRoot, "src/lib/supabaseAnalyzer/fixtures/run649fdaa6.clientPdf.json"));
const benchmarkPath = argument("--benchmark", path.join(repoRoot, "src/lib/supabaseAnalyzer/qualityBenchmark.ts"));

if (!sourceDir) {
  console.error("Usage: node eval/drawing-dataset/cli/build-dataset.mjs --source <drawing-directory> [--out <dir>] [--force]");
  process.exit(2);
}

const result = await buildDrawingDataset({
  sourceDir: path.resolve(sourceDir),
  outDir: path.resolve(outDir),
  findingsPath: path.resolve(findingsPath),
  benchmarkPath: path.resolve(benchmarkPath),
  force: process.argv.includes("--force"),
  requireBaselineCounts: true,
  onProgress: (event) => {
    console.error(`${event.status}\t${event.relativePath}`);
  },
});

const assessment = result.assessment;
console.log(`Accountability: ${assessment.accountabilityPassed ? "PASS" : "FAIL"}`);
console.log(`Content completeness: ${assessment.contentComplete ? "COMPLETE" : "NOT COMPLETE"}`);
console.log(`Precision: ${assessment.precision}`);
console.log(`Recall: ${assessment.recall}`);
console.log(`Files: ${assessment.counts.files}`);
console.log(`PDF pages: ${assessment.counts.pdfPages}`);
console.log(`Unresolved ink cells: ${assessment.counts.unresolvedRegions}`);
console.log(`Findings: ${assessment.counts.findings}`);
console.log(`Content gaps: ${assessment.contentIssues.length}`);
console.log(`Output: ${result.outDir}`);
process.exit(assessment.accountabilityPassed ? 0 : 1);
