#!/usr/bin/env node
/**
 * Export finalized ARC decisions + feedback summary for learning evaluation.
 * Does not change production analyzer behavior.
 *
 *   node eval/drawing-dataset/cli/export-finalized-decisions.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import {
  loadJson,
  readLedger,
  summarizeFeedback,
} from "../lib/arcFeedbackLedger.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const packDir = path.join(repoRoot, "eval/drawing-dataset/fixtures/professional-benchmark/v1");
const outDir = path.join(repoRoot, "eval/drawing-dataset/out/mcd-649fdaa6/arc-learning");

async function main() {
  const itemsDoc = await loadJson(path.join(packDir, "items.json"));
  const missed = await loadJson(path.join(packDir, "missed-issue-slots.json"));
  const ledger = await readLedger(path.join(packDir, "feedback-ledger.jsonl"));
  const summary = summarizeFeedback(ledger, itemsDoc.items);

  const reviewedItems = itemsDoc.items.filter((item) => item.reviewer?.decision);
  const finalizedLedger = ledger.filter((row) => row.status === "finalized" || row.status === "disputed");
  const needsSecond = [
    ...ledger.filter((row) => row.needsSecondReview || row.status === "needs_second_review"),
    ...summary.disagreements.map((d) => ({
      type: "disagreement",
      pbItemId: d.pbItemId,
      decisions: d.decisions,
      recordIds: d.recordIds,
    })),
  ];

  const improvementCandidates = [];
  for (const row of ledger) {
    if (row.decision === "false_positive" || row.decision === "rejected") {
      improvementCandidates.push({
        category: "false_positive",
        pbItemId: row.pbItemId,
        findingOrCheckId: row.findingOrCheckId,
        technicalCheckId: row.technicalCheckId,
        sourceRecordId: row.recordId,
        proposedAction: "Add regression fixture / persist-time or technical-check coverage after approval",
      });
    }
    if (row.findingOrCheckId?.startsWith("missed:")) {
      improvementCandidates.push({
        category: "missed_issue",
        pbItemId: row.pbItemId,
        findingOrCheckId: row.findingOrCheckId,
        sourceRecordId: row.recordId,
        proposedAction: "Evaluate prompt/extraction gap; do not auto-train",
      });
    }
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    professionallyVerified: false,
    precisionRecallMeasured: false,
    disclaimer:
      "Export of ARC review artifacts for evaluation only. Original AI findings are preserved. No automatic production learning.",
    completion: summary.completion,
    decisionCounts: summary.decisionCounts,
    statusCounts: summary.statusCounts,
    disagreements: summary.disagreements,
    metricsEligibleRecords: summary.metricsEligible,
    independentlyVerifiedCount: summary.independentlyVerifiedCount,
    reviewedItems,
    finalizedLedger,
    needsSecondReview: needsSecond,
    missedIssues: missed.sheets,
    improvementCandidates,
    learningLoop: {
      steps: [
        "reviewed evidence",
        "structured feedback (ledger)",
        "evaluation (this export)",
        "proposed improvement (candidates)",
        "tested release (requires approval)",
      ],
      automaticProductionLearning: false,
    },
  };

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "finalized-decisions.json"), JSON.stringify(payload, null, 2));

  const md = [
    "# ARC feedback summary",
    "",
    `Generated: ${payload.exportedAt}`,
    `Reviewed items: ${summary.completion.reviewedItems} / ${summary.completion.totalItems}`,
    `Remaining: ${summary.completion.remaining}`,
    "",
    "## Decision counts",
    "",
    ...Object.entries(summary.decisionCounts)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `- ${k}: ${n}`),
    "",
    "## Needs second review",
    "",
    ...(needsSecond.length
      ? needsSecond.map((row) => `- ${JSON.stringify(row)}`)
      : ["- None"]),
    "",
    "## Recurring improvement candidates",
    "",
    ...(improvementCandidates.length
      ? improvementCandidates.slice(0, 30).map((c) =>
        `- [${c.category}] ${c.pbItemId || c.findingOrCheckId}: ${c.proposedAction}`)
      : ["- None yet — complete ARC reviews first"]),
    "",
    "## Guardrails",
    "",
    "- Original AI findings unchanged.",
    "- No automatic prompt/validator changes.",
    "- Precision/recall only after authorized metrics contribution.",
    "",
  ].join("\n");
  await writeFile(path.join(outDir, "feedback-summary.md"), md);

  console.log(JSON.stringify({
    outDir,
    reviewed: summary.completion.reviewedItems,
    remaining: summary.completion.remaining,
    improvementCandidates: improvementCandidates.length,
    disagreements: summary.disagreements.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
