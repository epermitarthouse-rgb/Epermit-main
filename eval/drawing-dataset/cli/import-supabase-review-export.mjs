#!/usr/bin/env node
/**
 * Import Supabase analyzer JSON export reviews into the ARC feedback ledger.
 * Maps Accept/Modify/Reject → professional classifications for benchmark linkage.
 * Does not mutate production findings. Does not set verified metrics by default.
 *
 *   node eval/drawing-dataset/cli/import-supabase-review-export.mjs --export path/to/export.json
 */
import { parseArgs } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendLedger,
  createLedgerRecord,
  findLink,
  loadJson,
  mapTriageToProfessional,
  normalizeDecision,
} from "../lib/arcFeedbackLedger.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const packDir = path.join(repoRoot, "eval/drawing-dataset/fixtures/professional-benchmark/v1");

async function main() {
  const { values } = parseArgs({
    options: {
      export: { type: "string" },
      "authorize-metrics": { type: "boolean", default: false },
      finalize: { type: "boolean", default: false },
    },
  });
  if (!values.export) {
    console.error("Usage: import-supabase-review-export.mjs --export <supabase-analyzer-export.json>");
    process.exit(2);
  }

  const authorize = Boolean(values["authorize-metrics"]);
  const payload = await loadJson(path.resolve(values.export));
  const linkMap = await loadJson(path.join(packDir, "benchmark-link-map.v1.json"));
  const items = (await loadJson(path.join(packDir, "items.json"))).items || [];
  const ledgerPath = path.join(packDir, "feedback-ledger.jsonl");

  const findings = payload.findings || payload.data?.findings || [];
  let imported = 0;
  let unmatched = 0;

  for (const finding of findings) {
    const review = finding.review || finding.exportedReview || null;
    if (!review?.decision) continue;
    const triage = normalizeDecision(review.decision);
    if (!triage) continue;

    const sheetId = finding.sheetNumber || finding.detected_sheet_number || finding.sheetId || null;
    const title = finding.title || "";
    let link = null;
    // Prefer explicit quality / check ids if present on export metadata.
    const checkId = finding.findingOrCheckId || finding.qualityCaseId || finding.benchmarkId || null;
    if (checkId) link = findLink(linkMap, { findingOrCheckId: checkId });
    if (!link && sheetId) {
      link = (linkMap.links || []).find((row) =>
        String(row.sheetId).replace(/\s+/g, "").toUpperCase()
          === String(sheetId).replace(/\s+/g, "").toUpperCase()
        && title && String(items.find((i) => i.id === row.pbItemId)?.analyzerFinding?.title || "")
          .toLowerCase().includes(title.toLowerCase().slice(0, 18))
      ) || null;
    }

    const pbItem = link ? items.find((i) => i.id === link.pbItemId) : null;
    const professional = mapTriageToProfessional(triage) || triage;
    const record = createLedgerRecord({
      source: "supabase_ui_export",
      status: values.finalize ? "finalized" : "preliminary",
      pbItemId: link?.pbItemId || null,
      findingOrCheckId: link?.findingOrCheckId || checkId || null,
      technicalCheckId: link?.technicalCheckId || null,
      sourceRunId: finding.runId || finding.run_id || payload.run?.id || null,
      findingId: finding.id || finding.finding_id || null,
      sheetId,
      drawingNumber: finding.drawingNumber || sheetId,
      originalAi: {
        title,
        severity: finding.severity || null,
        rationale: finding.observation || finding.rationale || null,
        evidenceQuote: finding.drawingEvidence || finding.drawing_evidence || null,
      },
      decision: triage,
      correctedInterpretation: review.modifiedResponse || review.modified_response || null,
      justification: review.modifiedResponse || review.modified_response || `UI decision: ${triage}`,
      supportingEvidence: finding.drawingEvidence || finding.drawing_evidence || pbItem?.evidenceQuote || null,
      reviewer: {
        identity: review.decidedBy || null,
        role: "project_editor",
        reviewedAt: review.decidedAt || review.decided_at || null,
      },
      notes: link
        ? `Mapped to ${link.pbItemId} as professional hint ${professional}`
        : "No benchmark link matched; ledger-only preliminary record",
    }, { authorizeMetricsContribution: authorize });

    await appendLedger(ledgerPath, record);
    imported += 1;
    if (!link) unmatched += 1;
  }

  console.log(JSON.stringify({ imported, unmatched, ledgerPath, authorizeMetrics: authorize }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
