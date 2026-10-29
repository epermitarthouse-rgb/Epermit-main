import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyDecisionFile } from "../lib/adjudicateRunner.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

function argument(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1];
}

const outDir = argument("--out", path.join(repoRoot, "eval/drawing-dataset/out/mcd-649fdaa6"));
const decisionPath = argument("--decision");
if (!decisionPath) {
  console.error("Usage: node eval/drawing-dataset/cli/adjudicate-apply.mjs --decision <file.json> [--out <dir>]");
  process.exit(2);
}

const result = await applyDecisionFile({
  outDir: path.resolve(outDir),
  decisionPath: path.resolve(decisionPath),
});

console.log(`benchmarkId: ${result.record.benchmarkId}`);
console.log(`outcome: ${result.record.review.overallOutcome}`);
console.log(`professionallyVerified: ${result.record.review.professionallyVerified}`);
console.log(`contributesToMetrics: ${result.record.review.contributesToMetrics}`);
console.log(`precision: ${result.metrics.precision}`);
console.log(`recall: ${result.metrics.recall}`);
