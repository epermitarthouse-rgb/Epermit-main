#!/usr/bin/env node
/**
 * Combined finding-consistency + technical-check repeatability report.
 * Reuses frozen three-run fixtures. No GPT. No production writes.
 *
 *   node --experimental-strip-types eval/drawing-dataset/cli/consistency-repeatability-report.mjs
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadRunFindings,
  summarizeRepeatability,
  topicRetention,
} from "../lib/threeRunRepeatability.mjs";
import {
  buildPilotSheetInputs,
  classifyEmissionVariance,
  loadTechnicalChecksModule,
} from "../lib/technicalChecksRunner.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const fixtureDir = path.join(repoRoot, "eval/drawing-dataset/fixtures/three-run");
const techFixtureDir = path.join(repoRoot, "eval/drawing-dataset/fixtures/technical-checks");
const rootCausePath = path.join(repoRoot, "eval/drawing-dataset/fixtures/finding-consistency-root-cause.v1.json");
const baselinePath = path.join(repoRoot, "eval/drawing-dataset/fixtures/three-run-evidence-baseline.json");
const outDir = path.join(repoRoot, "eval/drawing-dataset/out/mcd-649fdaa6/consistency");

async function loadLabeled(label) {
  const payload = JSON.parse(await readFile(path.join(fixtureDir, `findings-${label}.json`), "utf8"));
  return loadRunFindings(payload);
}

async function main() {
  const rootCause = JSON.parse(await readFile(rootCausePath, "utf8"));
  const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
  const runs = {
    baseline: await loadLabeled("baseline"),
    phase2b: await loadLabeled("phase2b"),
    v8: await loadLabeled("v8"),
  };
  const summary = summarizeRepeatability(runs);
  const p2bToV8 = topicRetention(runs.phase2b, runs.v8);

  const mod = await loadTechnicalChecksModule(repoRoot);
  const sheets = await buildPilotSheetInputs(techFixtureDir);
  const checkA = mod.runTechnicalChecks({ sheets });
  const checkB = mod.runTechnicalChecks({ sheets });
  const checkAgreement = checkA.results.every((row, index) =>
    row.checkId === checkB.results[index]?.checkId && row.outcome === checkB.results[index]?.outcome
  );

  const emission = (baseline.trackedTopics || []).map((topic) =>
    classifyEmissionVariance(topic.id, topic.acrossRuns)
  );

  const historicalTokens = {
    note: "Historical costs only; no new GPT in this report.",
    stage3ControlledRun: rootCause.runs.stage3,
    fullRunsPublished: Object.fromEntries(
      Object.entries(rootCause.runs).map(([k, v]) => [k, v.publishedFindings]),
    ),
  };

  const lines = [
    "# Finding consistency & technical-check repeatability",
    "",
    `Generated: ${new Date().toISOString()}`,
    "Professionally verified: **false**",
    "Precision/recall measured: **false**",
    "",
    "## Root causes (summary)",
    "",
    ...rootCause.rootCauses.map((c) => `- **${c.id}**: ${c.summary}`),
    "",
    "## Three-run topic retention (frozen findings)",
    "",
    ...Object.entries(summary.counts).map(([label, count]) => `- ${label}: ${count} findings`),
    "",
    `| Phase2B → v8 topics retained | ${p2bToV8.retained} |`,
    `| Phase2B → v8 topics missing in v8 | ${p2bToV8.missingInRight} |`,
    "",
    "### Emission variance (tracked topics)",
    "",
    ...emission.map((row) =>
      `- ${row.topicId}: variants=[${row.severityVariants.join(", ")}] emissionVariance=${row.emissionVariance}`
    ),
    "",
    "## Deterministic technical checks",
    "",
    `- Check version: \`${checkA.version}\``,
    `- Outcome agreement on re-run: **${checkAgreement}**`,
    `- Summary: ${JSON.stringify(checkA.summary)}`,
    "",
    "| Check | Sheet | Outcome |",
    "| --- | --- | --- |",
    ...checkA.results.map((r) => `| \`${r.checkId}\` | ${r.sheetId} | ${r.outcome} |`),
    "",
    "## Separation of variance sources",
    "",
    "| Source | Role |",
    "| --- | --- |",
    "| Model emission | Appear/disappear/severity drift across full GPT runs |",
    "| Persist validators | Adjust/withhold matching drafts only |",
    "| Evidence injection | Stage 1–2 / Stage 3 packs change quote-before-absence behavior |",
    "| Technical checks | Deterministic look-fors; 100% agreement on fixed fixtures |",
    "",
    "## Historical cost note",
    "",
    "```json",
    JSON.stringify(historicalTokens, null, 2),
    "```",
    "",
    "## Limitations",
    "",
    "- Stage 3 controlled run is 2-sheet only — not count-comparable to 82-sheet runs.",
    "- Heuristic topic matching is not professional adjudication.",
    "- Technical-check `no_issue_evidenced` is not verified compliance.",
    "",
  ];

  await mkdir(outDir, { recursive: true });
  const markdown = lines.join("\n");
  await writeFile(path.join(outDir, "consistency-repeatability-report.md"), markdown);
  await writeFile(
    path.join(outDir, "consistency-repeatability-report.json"),
    JSON.stringify({
      rootCauseVersion: rootCause.version,
      threeRunSummary: summary,
      phase2bToV8TopicRetention: p2bToV8,
      emissionVariance: emission,
      technicalChecks: checkA,
      checkAgreement,
      historicalTokens,
      independentlyVerified: false,
    }, null, 2),
  );
  console.log(JSON.stringify({
    outDir,
    checkAgreement,
    technicalCheckSummary: checkA.summary,
    phase2bToV8MissingTopics: p2bToV8.missingInRight,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
