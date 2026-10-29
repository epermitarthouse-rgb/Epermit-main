import path from "node:path";
import { fileURLToPath } from "node:url";
import { initAdjudication } from "../lib/adjudicateRunner.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

function argument(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1];
}

const sourceDir = argument("--source");
const outDir = argument("--out", path.join(repoRoot, "eval/drawing-dataset/out/mcd-649fdaa6"));
const cropLimit = Number(argument("--crop-limit", "12"));

const result = await initAdjudication({
  sourceDir: sourceDir ? path.resolve(sourceDir) : undefined,
  outDir: path.resolve(outDir),
  force: process.argv.includes("--force"),
  renderCrops: !process.argv.includes("--no-crops") && Boolean(sourceDir),
  cropLimit: Number.isFinite(cropLimit) ? cropLimit : 12,
  onProgress: (event) => {
    if (event.queueOrder <= 8 || process.argv.includes("--verbose")) {
      console.error(`${event.status}\t#${event.queueOrder}\t${event.clientReportId}`);
    }
  },
});

const summary = result.summary;
console.log(`Cases: ${summary.accountability.findings}`);
console.log(`Queue bands: ${JSON.stringify(summary.queueBands)}`);
console.log(`Professionally verified: ${summary.verifiedVersusPending.professionallyVerified}`);
console.log(`Pending: ${summary.verifiedVersusPending.pending}`);
console.log(`Precision: ${summary.precision}`);
console.log(`Recall: ${summary.recall}`);
console.log(`Output: ${result.outDir}`);
process.exit(summary.accountability.findingsUnchanged && summary.accountability.findings === 252 ? 0 : 1);
