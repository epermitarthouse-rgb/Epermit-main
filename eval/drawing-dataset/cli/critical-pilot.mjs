import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCriticalPilot } from "../lib/criticalPilot.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

function argument(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1];
}

const sourceDir = argument("--source");
const outDir = argument("--out", path.join(repoRoot, "eval/drawing-dataset/out/mcd-649fdaa6"));

const result = await runCriticalPilot({
  sourceDir: sourceDir ? path.resolve(sourceDir) : undefined,
  outDir: path.resolve(outDir),
  onProgress: (event) => console.error(`${event.status}\t${event.clientReportId}`),
});

const summary = result.summary;
console.log(`Critical assessments: ${summary.assessments.length}`);
console.log(`Professionally verified: ${summary.accountability.professionallyVerified}`);
for (const row of summary.distinctions.provisionalConclusions) {
  console.log(`${row.clientReportId}: ${row.overallOutcome} (evidence=${row.evidenceGrounding}, tech=${row.technicalCorrectness})`);
}
console.log(`Usability gaps: ${summary.usabilityGaps.length}`);
console.log(`Precision: ${summary.precision}`);
console.log(`Recall: ${summary.recall}`);
console.log(`Output: ${result.outDir}`);
process.exit(summary.accountability.findingsUnchanged ? 0 : 1);
