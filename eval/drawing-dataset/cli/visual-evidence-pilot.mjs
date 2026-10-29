#!/usr/bin/env node
/**
 * Offline Phase 3 visual evidence grounding pilot.
 * No GPT calls. Writes gitignored eval output only.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runVisualEvidencePilot } from "../lib/visualEvidencePilot.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

async function main() {
  const sourceDir = arg(
    "--source",
    "/Users/javerianaveed/Desktop/008-0003 New York Ave Wash DC_PERMIT REV5 SET_2026-10-15_Individual",
  );
  const datasetOut = arg(
    "--dataset-out",
    path.join(repoRoot, "eval/drawing-dataset/out/mcd-649fdaa6"),
  );
  const outDir = arg(
    "--out",
    path.join(datasetOut, "phase3-visual-pilot"),
  );
  const summary = await runVisualEvidencePilot({
    sourceDir,
    datasetOut,
    outDir,
    force: process.argv.includes("--force"),
  });
  console.log(JSON.stringify({
    outDir,
    metrics: summary.metrics,
    sheets: summary.sheets.map((sheet) => ({
      sheetId: sheet.sheetId,
      topicHitCounts: sheet.topicHitCounts,
      assessments: sheet.assessments,
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
