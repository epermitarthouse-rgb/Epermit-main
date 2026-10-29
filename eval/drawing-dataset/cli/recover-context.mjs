import path from "node:path";
import { fileURLToPath } from "node:url";
import { recoverDrawingDataset } from "../lib/recoverDataset.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

function argument(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1];
}

const sourceDir = argument("--source");
const outDir = argument("--out", path.join(repoRoot, "eval/drawing-dataset/out/mcd-649fdaa6"));
const limitRaw = argument("--limit");

if (!sourceDir) {
  console.error("Usage: node eval/drawing-dataset/cli/recover-context.mjs --source <drawing-directory> [--out <dir>] [--force] [--limit N]");
  process.exit(2);
}

const result = await recoverDrawingDataset({
  sourceDir: path.resolve(sourceDir),
  outDir: path.resolve(outDir),
  force: process.argv.includes("--force"),
  limit: limitRaw ? Number(limitRaw) : undefined,
  onProgress: (event) => console.error(`${event.status}\t${event.relativePath}`),
});

const assessment = result.assessment;
console.log(`Accountability: ${assessment.accountabilityPassed ? "PASS" : "FAIL"}`);
console.log(`Content completeness: ${assessment.contentComplete ? "COMPLETE" : "NOT COMPLETE"}`);
console.log(`Precision: ${assessment.precision}`);
console.log(`Recall: ${assessment.recall}`);
console.log(`Cells: ${result.report.counts.cells}`);
console.log(`Remaining unread: ${result.report.counts.remainingUnread}`);
console.log(`OCR chars: ${result.report.counts.ocrChars}`);
console.log(`Grounding: ${JSON.stringify(result.report.grounding)}`);
console.log(`Output: ${result.outDir}`);
process.exit(assessment.accountabilityPassed ? 0 : 1);
