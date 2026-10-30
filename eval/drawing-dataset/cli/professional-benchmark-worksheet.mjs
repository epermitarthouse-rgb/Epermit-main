#!/usr/bin/env node
/**
 * Expand professional-benchmark v1 items into a CSV worksheet for ARC reviewers.
 * No GPT. Writes under out/ (gitignored) by default; also refreshes committed template.
 */
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const packDir = path.join(repoRoot, "eval/drawing-dataset/fixtures/professional-benchmark/v1");
const outDir = path.join(repoRoot, "eval/drawing-dataset/out/arc-review-package-v1");

const HEADER = [
  "id",
  "priority",
  "sheetId",
  "drawingNumber",
  "sourceRunId",
  "findingOrCheckId",
  "technicalCheckId",
  "analyzerSeverity",
  "analyzerTitle",
  "analyzerRationale",
  "evidenceQuote",
  "drawingLocation",
  "codeEditionSection",
  "codeBasisNote",
  "crossSheetRefs",
  "evidenceProvenanceOrigin",
  "technicalCheckOutcomeHint",
  "recommendedDiscipline",
  "decisionOptions",
  "reviewerDecision",
  "reviewerExplanation",
  "correctedInterpretation",
  "correctedSeverity",
  "supportingJustification",
  "reviewerIdentity",
  "reviewerRole",
  "reviewerDiscipline",
  "reviewedAt",
  "completionStatus",
  "needsSecondReview",
  "secondReviewDiscipline",
  "secondReviewNotes",
  "professionallyVerified",
  "contributesToMetrics",
];

const DISCIPLINE_BY_PRIORITY = {
  critical_life_safety: "Fire PE / Architect (by sheet)",
  door_schedule: "Architect (RA); Fire PE if ratings",
  structural: "Structural PE",
  admin_date: "Architect (RA)",
  electrical_restatement: "Electrical PE",
  code_edition: "Fire PE / Code specialist",
  guardrail: "Architect (RA)",
  consistency: "Architect (RA)",
  hydraulic: "Fire PE",
};

const DISCIPLINE_BY_SHEET = {
  FP200: "Fire PE",
  FP201: "Fire PE",
  "A-3.06": "Architect (RA)",
  "A-6.00": "Architect (RA); Fire PE if ratings",
  "A-1.03-00": "Architect (RA)",
  "M-1.4": "Mechanical PE",
  "S-201.00": "Structural PE",
  "S-204.00": "Structural PE",
  "A-1.00-00": "Architect (RA)",
  "A-2.01-00": "Architect (RA)",
  "E-1.1-00": "Electrical PE",
  "E-1.3-00": "Electrical PE",
};

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function recommendDiscipline(item) {
  return DISCIPLINE_BY_SHEET[item.sheetId] || DISCIPLINE_BY_PRIORITY[item.priority] || "Assign by topic";
}

async function main() {
  const items = JSON.parse(await readFile(path.join(packDir, "items.json"), "utf8"));
  const rows = [HEADER.join(",")];
  for (const item of items.items) {
    const decision = item.reviewer?.decision || "";
    const completionStatus = decision ? "reviewed" : "pending";
    rows.push(
      [
        item.id,
        item.priority,
        item.sheetId,
        item.drawingNumber,
        item.sourceRunId,
        item.findingOrCheckId,
        item.technicalCheckId,
        item.analyzerFinding?.severity,
        item.analyzerFinding?.title,
        item.analyzerFinding?.rationale,
        item.evidenceQuote,
        item.drawingLocation,
        item.codeEditionSection,
        item.codeBasisNote,
        (item.crossSheetRefs || []).join("; "),
        item.evidenceProvenance?.origin,
        item.technicalCheckOutcomeHint,
        recommendDiscipline(item),
        "Accept(confirmed_issue)|Reject(false_positive)|Modify(partially_supported)|Insufficient Evidence(insufficient_evidence)|N/A(not_applicable)",
        decision,
        item.reviewer?.explanation,
        "", // correctedInterpretation — fill on Modify
        "", // correctedSeverity
        "", // supportingJustification
        item.reviewer?.identity,
        item.reviewer?.role,
        "",
        item.reviewer?.reviewedAt,
        completionStatus,
        "",
        "",
        "",
        item.reviewer?.professionallyVerified ? "false" : "false",
        "false",
      ].map(csvEscape).join(","),
    );
  }

  const csvBody = rows.join("\n") + "\n";
  await mkdir(outDir, { recursive: true });
  const csvPath = path.join(outDir, "review-worksheet-18-items.csv");
  await writeFile(csvPath, csvBody);
  await writeFile(path.join(packDir, "review-worksheet.template.csv"), csvBody);

  const packageFiles = [
    "ARC_REVIEWER_INSTRUCTIONS.md",
    "ARC_PACKAGE_README.md",
    "LABEL_MAP.md",
    "items.json",
    "manifest.json",
    "missed-issue-slots.json",
    "benchmark-link-map.v1.json",
    "feedback-ledger.schema.json",
    "feedback-ledger.jsonl",
    "sample-filled-worksheet.csv",
  ];
  for (const name of packageFiles) {
    await copyFile(path.join(packDir, name), path.join(outDir, name));
  }
  await copyFile(
    path.join(repoRoot, "eval/drawing-dataset/PROFESSIONAL_ACCURACY_METHODOLOGY.md"),
    path.join(outDir, "PROFESSIONAL_ACCURACY_METHODOLOGY.md"),
  );

  await writeFile(
    path.join(outDir, "README.txt"),
    [
      "PermitPilot ARC Professional Review Package v1",
      "==============================================",
      "",
      "Start here:",
      "  1. ARC_REVIEWER_INSTRUCTIONS.md  — how to review (architects & engineers)",
      "  2. review-worksheet-18-items.csv — fill all 18 items",
      "  3. missed-issue-slots.json       — note issues the analyzer missed",
      "",
      "Decision vocabulary (reviewerDecision column):",
      "  confirmed_issue | false_positive | partially_supported | insufficient_evidence | not_applicable",
      "  (Accept / Reject / Modify / Insufficient Evidence / N/A)",
      "",
      "On Modify: fill correctedInterpretation, correctedSeverity, supportingJustification.",
      "For second discipline: set needsSecondReview=true and secondReviewDiscipline.",
      "",
      "Do NOT set professionallyVerified or contributesToMetrics — engineering authorizes that later.",
      "Do NOT send customer drawings externally without explicit approval.",
      "",
      `Items: ${items.items.length}`,
      `Generated: ${new Date().toISOString()}`,
      "",
    ].join("\n"),
  );

  console.log(JSON.stringify({
    csvPath,
    packageDir: outDir,
    rows: items.items.length,
    templateRefreshed: path.join(packDir, "review-worksheet.template.csv"),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
