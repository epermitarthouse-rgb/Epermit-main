#!/usr/bin/env node
/**
 * Record an ARC missed issue into missed-issue-slots.json + feedback ledger.
 *
 *   node eval/drawing-dataset/cli/record-missed-issue.mjs \
 *     --sheet A-3.06 --title "..." --location "Detail @ high roof" \
 *     --identity "jdoe" --role "RA"
 */
import { parseArgs } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendLedger,
  buildMissedIssueRecord,
  createLedgerRecord,
  loadJson,
  writeJson,
} from "../lib/arcFeedbackLedger.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packDir = path.resolve(__dirname, "../fixtures/professional-benchmark/v1");

async function main() {
  const { values } = parseArgs({
    options: {
      sheet: { type: "string" },
      title: { type: "string" },
      location: { type: "string" },
      severity: { type: "string" },
      observation: { type: "string" },
      evidence: { type: "string" },
      identity: { type: "string" },
      role: { type: "string" },
      discipline: { type: "string" },
    },
  });
  if (!values.sheet || !values.title || !values.location) {
    console.error("Required: --sheet --title --location");
    process.exit(2);
  }

  const slotsPath = path.join(packDir, "missed-issue-slots.json");
  const ledgerPath = path.join(packDir, "feedback-ledger.jsonl");
  const slots = await loadJson(slotsPath);
  const sheet = (slots.sheets || []).find((s) =>
    String(s.sheetId).replace(/\s+/g, "").toUpperCase()
      === String(values.sheet).replace(/\s+/g, "").toUpperCase()
  );
  if (!sheet) {
    console.error(`Unknown sheet slot: ${values.sheet}`);
    process.exit(2);
  }

  const missed = buildMissedIssueRecord({
    title: values.title,
    severity: values.severity || null,
    observation: values.observation || null,
    drawingLocation: values.location,
    evidenceQuote: values.evidence || null,
    reviewerIdentity: values.identity || null,
    reviewerRole: values.role || null,
  });
  sheet.missedIssues = [...(sheet.missedIssues || []), missed];
  await writeJson(slotsPath, slots);

  const record = createLedgerRecord({
    source: "manual",
    status: "preliminary",
    pbItemId: null,
    findingOrCheckId: `missed:${missed.id}`,
    sheetId: sheet.sheetId,
    drawingNumber: sheet.drawingNumber || sheet.sheetId,
    decision: "confirmed_issue",
    justification: `Missed issue recorded: ${missed.title}`,
    supportingEvidence: missed.evidenceQuote,
    correctedInterpretation: missed.observation,
    originalAi: {
      title: null,
      severity: null,
      rationale: "Analyzer did not identify this issue",
      evidenceQuote: null,
    },
    reviewer: {
      identity: values.identity || null,
      role: values.role || null,
      discipline: values.discipline || null,
      reviewedAt: missed.reviewedAt,
    },
    notes: "False-negative / missed-issue entry for recall evaluation when authorized.",
  });
  await appendLedger(ledgerPath, record);
  console.log(JSON.stringify({ sheetId: sheet.sheetId, missedId: missed.id, ledgerPath }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
