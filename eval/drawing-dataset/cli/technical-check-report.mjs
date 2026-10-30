#!/usr/bin/env node
/**
 * Deterministic technical-check report for A-3.06 / A-6.00 / FP200 fixtures.
 * No GPT. Writes under gitignored out/ unless --stdout.
 *
 *   node --experimental-strip-types eval/drawing-dataset/cli/technical-check-report.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPilotSheetInputs,
  loadTechnicalChecksModule,
} from "../lib/technicalChecksRunner.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const fixtureDir = path.join(repoRoot, "eval/drawing-dataset/fixtures/technical-checks");
const outDir = path.join(repoRoot, "eval/drawing-dataset/out/mcd-649fdaa6/technical-checks");
const stdoutOnly = process.argv.includes("--stdout");

async function main() {
  const mod = await loadTechnicalChecksModule(repoRoot);
  const sheets = await buildPilotSheetInputs(fixtureDir);
  const report = mod.runTechnicalChecks({ sheets });

  const lines = [
    "# Technical-check report (deterministic)",
    "",
    `Version: \`${report.version}\``,
    `Professionally verified: **${report.independentlyVerified}**`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    ...Object.entries(report.summary).map(([k, v]) => `- ${k}: ${v}`),
    "",
    "## Results",
    "",
    "| Check | Sheet | Outcome | Reason |",
    "| --- | --- | --- | --- |",
    ...report.results.map((r) =>
      `| \`${r.checkId}\` | ${r.sheetId} | ${r.outcome} | ${String(r.reason).replace(/\|/g, "/").slice(0, 120)} |`
    ),
    "",
    "## Guardrails",
    "",
    "- Missing evidence → `unresolved` (never auto-violation).",
    "- OCR quotes → never compliance certification; `independentlyVerified` stays false.",
    "- Open-ended GPT discovery is unchanged; this report is eval-only.",
    "",
  ];

  const markdown = lines.join("\n");
  const payload = {
    ...report,
    generatedAt: new Date().toISOString(),
    purpose: "eval-only technical checks; not production accuracy",
  };

  if (stdoutOnly) {
    console.log(markdown);
    return;
  }

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "technical-check-report.json"), JSON.stringify(payload, null, 2));
  await writeFile(path.join(outDir, "technical-check-report.md"), markdown);
  console.log(JSON.stringify({
    outDir,
    results: report.results.length,
    summary: report.summary,
    independentlyVerified: report.independentlyVerified,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
