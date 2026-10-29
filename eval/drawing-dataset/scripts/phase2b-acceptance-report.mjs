#!/usr/bin/env node
/**
 * Phase 2B Final Acceptance — simulated persist-time regression report.
 * Does not call GPT-4o. Writes gitignored eval output only.
 */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const fixturePath = path.join(repoRoot, "eval/drawing-dataset/fixtures/phase2b-critical-regression.json");
const outDir = path.join(repoRoot, "eval/drawing-dataset/out/mcd-649fdaa6/phase2b");
const outPath = path.join(outDir, "acceptance-report.md");

async function loadValidator() {
  // Prefer compiled-free TS via dynamic import of the shared module through tsx when available.
  const qualityUrl = pathToFileURL(
    path.join(repoRoot, "supabase/functions/_shared/analyzerFindingQuality.ts"),
  ).href;
  try {
    return await import(qualityUrl);
  } catch {
    // Fallback: spawn note — caller should run via `npx tsx`.
    throw new Error("Run this script with: npx tsx eval/drawing-dataset/scripts/phase2b-acceptance-report.mjs");
  }
}

function dcContext(sheetIndex, sheetDiscipline) {
  return {
    analysisMode: "both",
    jurisdictionKey: "dc",
    jurisdictionLabel: "Washington D.C. (12A DCMR)",
    codeEdition: "2017",
    codeContext: "2017 DC Construction Codes (2015 IBC base)",
    sheetIndex: sheetIndex || [],
    sheetDiscipline: sheetDiscipline || null,
  };
}

function row(cells) {
  return `| ${cells.join(" | ")} |`;
}

async function main() {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  const { validateAnalyzerFindings, buildAnalyzerUserPrompt } = await loadValidator();
  const sheetIndex = fixture.sheetIndexForProvisional || [];

  const caseRows = [];
  for (const item of fixture.cases) {
    const result = validateAnalyzerFindings([item.draft], {
      ...dcContext(sheetIndex, item.draft.category),
      analysisDate: item.analysisDate || "2026-10-29T15:00:00.000Z",
    });
    const published = result.published[0];
    caseRows.push({
      id: item.id,
      baseline: `${item.draft.severity} / published as drafted`,
      afterSeverity: published?.severity ?? "WITHHELD",
      outcome: published?.validation?.outcome ?? "withheld",
      rules: (published?.validation?.rules || result.withheld[0]?.rules || []).join(", "),
      originalSeverity: published?.validation?.originalSeverity ?? item.draft.severity,
      withheld: result.withheld.length,
      published: result.published.length,
    });
  }

  const positiveRows = [];
  for (const item of fixture.positiveControls || []) {
    const result = validateAnalyzerFindings([item.draft], dcContext(sheetIndex, item.draft.category));
    const published = result.published[0];
    positiveRows.push({
      id: item.id,
      severity: published?.severity ?? "WITHHELD",
      outcome: published?.validation?.outcome ?? "withheld",
      rules: (published?.validation?.rules || []).join(", ") || "(none)",
      titlePreserved: published?.title === item.draft.title,
      withheld: result.withheld.length,
    });
  }

  const samplePrompt = buildAnalyzerUserPrompt("A-1.03-00.pdf", sheetIndex);

  const lines = [
    "# Phase 2B — Final Acceptance Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Fixture: \`${path.relative(repoRoot, fixturePath)}\` (${fixture.version})`,
    `Professionally verified: **${fixture.professionallyVerified}**`,
    "",
    "## Evidence class",
    "",
    "- **Simulated:** persist-time `validateAnalyzerFindings` on frozen drafts (this report).",
    "- **Actual GPT-4o:** not run (no API key in this environment; cost/guardrail). Cross-sheet PDF access was verified by inspecting the processor + prompt builders.",
    "",
    "## Cross-sheet context available to GPT-4o",
    "",
    "- Each sheet job attaches **one** PDF (`input_file`) for the current sheet only.",
    "- User prompt includes a **submitted sheet index** of filenames / detected numbers / titles — not OCR or bytes of other sheets.",
    "- Prompt explicitly states other sheets were **not read** in this request.",
    "",
    "Sample user-prompt excerpt:",
    "",
    "```",
    samplePrompt.split("\n").slice(0, 8).join("\n"),
    "```",
    "",
    "## Soft-fail contract",
    "",
    fixture.softFailContract.description,
    "",
    `- Limitation-only rules (no severity downgrade): ${(fixture.softFailContract.limitationOnlyRules || []).join(", ")}`,
    `- Severity-adjust rules: ${(fixture.softFailContract.severityAdjustRules || []).join(", ")}`,
    `- Hard-withhold rules: ${fixture.softFailContract.hardWithholdRules.join(", ")}`,
    "- Validation provenance (`originalSeverity`, rules, coverageLimitation) stays in `raw_metadata.validation`.",
    "- Hard-withhold findings are omitted from published findings and recorded on `sheet_analysis_completed` audit metadata (`withheld_count` / `withheld`).",
    "",
    "## Provisional Critical cases (simulated before → after)",
    "",
    row(["Case", "Baseline", "After severity", "Outcome", "Rules", "Withheld?"]),
    row(["---", "---", "---", "---", "---", "---"]),
    ...caseRows.map((r) => row([
      r.id,
      r.baseline,
      r.afterSeverity,
      r.outcome,
      r.rules || "—",
      r.withheld ? "yes" : "no",
    ])),
    "",
    "## Positive-control Critical preservation (simulated)",
    "",
    row(["Case", "Severity", "Outcome", "Rules", "Title preserved", "Withheld?"]),
    row(["---", "---", "---", "---", "---", "---"]),
    ...positiveRows.map((r) => row([
      r.id,
      r.severity,
      r.outcome,
      r.rules,
      r.titlePreserved ? "yes" : "no",
      r.withheld ? "yes" : "no",
    ])),
    "",
    "## Client-facing surface impact",
    "",
    "- PDF/Excel/JSON exports do not call `validateAnalyzerFindings` and strip validation internals.",
    "- Historical findings and reviewer decisions are not rewritten by persist-time guards.",
    "- Severity-adjust rules change **new-run** severity only for demonstrable on-sheet technical errors.",
    "- Cross-sheet unread references do not by themselves change Critical/Warning severity.",
    "- Quality Evaluation drawer remains collapsed and separate from findings summary metrics.",
    "",
    "## Deployment recommendation",
    "",
    "Conditional staged Edge deploy after local regression green. No historical rewrite. This file is simulated only.",
    "",
  ];

  await mkdir(outDir, { recursive: true });
  await writeFile(outPath, lines.join("\n"), "utf8");
  console.log(`Wrote ${outPath}`);

  const failedCases = [];
  for (const item of fixture.cases) {
    const actual = caseRows.find((row) => row.id === item.id);
    if (!actual || actual.withheld !== (item.expectWithheld ? 1 : 0)) failedCases.push(item.id);
    else if (actual.afterSeverity !== item.expectSeverity) failedCases.push(item.id);
    else if (actual.outcome !== item.expectOutcome) failedCases.push(item.id);
    else if (item.expectRule && !actual.rules.includes(item.expectRule)) failedCases.push(item.id);
  }
  const failedPos = [];
  for (const item of fixture.positiveControls || []) {
    const actual = positiveRows.find((row) => row.id === item.id);
    if (!actual || actual.withheld || actual.severity !== "critical") failedPos.push(item.id);
    else if (actual.outcome !== (item.expectOutcome || "accepted")) failedPos.push(item.id);
    else if (item.expectPreserveText && !actual.titlePreserved) failedPos.push(item.id);
  }
  if (failedCases.length || failedPos.length) {
    console.error("Acceptance mismatches", { failedCases, failedPos, caseRows, positiveRows });
    process.exit(1);
  }
  console.log("Simulated acceptance: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
