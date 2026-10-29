import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSemanticGrounding } from "../lib/semanticGrounding.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

function argument(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1];
}

const outDir = argument("--out", path.join(repoRoot, "eval/drawing-dataset/out/mcd-649fdaa6"));

const result = await runSemanticGrounding({
  outDir: path.resolve(outDir),
  onProgress: (event) => {
    if (String(event.severity || "").toLowerCase() === "critical" || process.argv.includes("--verbose")) {
      console.error(`${event.status}\t${event.severity}\t${event.clientReportId}`);
    }
  },
});

const summary = result.summary;
console.log(`Findings evaluated: ${summary.accountability.findings}`);
console.log(`Retrieval success: ${summary.coverage.retrievalSuccessCount}/${summary.coverage.total}`);
console.log(`Evidence retrieved: ${summary.coverage.automatedAssessmentCounts.evidence_retrieved}`);
console.log(`Contradicted candidates: ${summary.coverage.automatedAssessmentCounts.contradicted_candidate}`);
console.log(`Insufficient: ${summary.coverage.automatedAssessmentCounts.insufficient_evidence}`);
console.log(`Unresolved: ${summary.coverage.automatedAssessmentCounts.unresolved}`);
console.log(`Critical: ${summary.critical.count}`);
for (const row of summary.critical.records) {
  console.log(`  ${row.clientReportId}: ${row.automatedAssessment} (score ${row.bestScore ?? "n/a"})`);
}
console.log(`Duplicates: ${summary.duplicates.pairCount}`);
console.log(`Decision: ${summary.recommendation.decision}`);
console.log(`Precision: ${summary.precision}`);
console.log(`Recall: ${summary.recall}`);
console.log(`Output: ${result.outDir}`);
process.exit(summary.accountability.findingsUnchanged && summary.accountability.findings === 252 ? 0 : 1);
