#!/usr/bin/env node
/**
 * Merge a filled ARC review worksheet CSV into professional-benchmark items + feedback ledger.
 * Never overwrites analyzerFinding fields. Never promotes verified metrics without --authorize-metrics.
 *
 *   node eval/drawing-dataset/cli/merge-professional-worksheet.mjs --csv path/to/filled.csv
 */
import { parseArgs } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import {
  appendLedger,
  applyDecisionToItem,
  createLedgerRecord,
  loadJson,
  writeJson,
} from "../lib/arcFeedbackLedger.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const packDir = path.join(repoRoot, "eval/drawing-dataset/fixtures/professional-benchmark/v1");

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    return row;
  });
}

function normalizeLooksLikeModify(decisionRaw) {
  const raw = String(decisionRaw || "").trim().toLowerCase().replace(/\s+/g, "_");
  return raw === "modify" || raw === "modified" || raw === "partially_supported";
}

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

async function main() {
  const { values } = parseArgs({
    options: {
      csv: { type: "string" },
      "authorize-metrics": { type: "boolean", default: false },
      finalize: { type: "boolean", default: false },
    },
  });
  if (!values.csv) {
    console.error("Usage: merge-professional-worksheet.mjs --csv <filled.csv> [--finalize] [--authorize-metrics]");
    process.exit(2);
  }

  const authorize = Boolean(values["authorize-metrics"]);
  const itemsPath = path.join(packDir, "items.json");
  const ledgerPath = path.join(packDir, "feedback-ledger.jsonl");
  const linkMap = await loadJson(path.join(packDir, "benchmark-link-map.v1.json"));
  const itemsDoc = await loadJson(itemsPath);
  const csvText = await readFile(path.resolve(values.csv), "utf8");
  const rows = parseCsv(csvText);

  let updated = 0;
  const byId = new Map(itemsDoc.items.map((item) => [item.id, item]));

  for (const row of rows) {
    const decisionRaw = row.reviewerDecision || row.decision || "";
    if (!String(decisionRaw).trim()) continue;
    const id = row.id || row.pbItemId;
    const item = byId.get(id);
    if (!item) {
      console.warn(`skip unknown item id=${id}`);
      continue;
    }
    const justification =
      row.supportingJustification || row.reviewerExplanation || row.justification || "";
    const correctedInterpretation =
      row.correctedInterpretation ||
      (normalizeLooksLikeModify(decisionRaw) ? justification : null);
    const patched = applyDecisionToItem(item, {
      decision: decisionRaw,
      justification,
      correctedInterpretation,
      modifiedSeverity: row.correctedSeverity || row.modifiedSeverity || null,
      reviewer: {
        identity: row.reviewerIdentity || null,
        role: row.reviewerRole || null,
        discipline: row.reviewerDiscipline || null,
        reviewedAt: row.reviewedAt || new Date().toISOString(),
      },
      professionallyVerified: authorize && String(row.professionallyVerified).toLowerCase() === "true",
      contributesToMetrics: authorize && String(row.contributesToMetrics).toLowerCase() === "true",
    }, { authorizeMetricsContribution: authorize });

    byId.set(id, patched);
    updated += 1;

    const link = (linkMap.links || []).find((l) => l.pbItemId === id);
    const record = createLedgerRecord({
      source: "worksheet",
      status: values.finalize ? "finalized" : "preliminary",
      pbItemId: id,
      findingOrCheckId: item.findingOrCheckId || link?.findingOrCheckId || null,
      technicalCheckId: item.technicalCheckId || link?.technicalCheckId || null,
      sourceRunId: item.sourceRunId || null,
      sheetId: item.sheetId || null,
      drawingNumber: item.drawingNumber || null,
      originalAi: {
        title: item.analyzerFinding?.title || null,
        severity: item.analyzerFinding?.severity || null,
        rationale: item.analyzerFinding?.rationale || null,
        evidenceQuote: item.evidenceQuote || null,
      },
      decision: decisionRaw,
      justification,
      supportingEvidence: row.evidenceQuote || item.evidenceQuote || null,
      correctedInterpretation,
      modifiedSeverity: row.correctedSeverity || row.modifiedSeverity || null,
      reviewer: {
        identity: row.reviewerIdentity || null,
        role: row.reviewerRole || null,
        discipline: row.reviewerDiscipline || null,
        reviewedAt: row.reviewedAt || null,
      },
      independentlyVerified: authorize && String(row.professionallyVerified).toLowerCase() === "true",
      contributesToMetrics: authorize && String(row.contributesToMetrics).toLowerCase() === "true",
      needsSecondReview: String(row.needsSecondReview || "").toLowerCase() === "true",
      analyzerVersion: row.analyzerVersion || null,
      evidenceExtractionVersion: row.evidenceExtractionVersion || null,
    }, { authorizeMetricsContribution: authorize });
    await appendLedger(ledgerPath, record);
  }

  itemsDoc.items = itemsDoc.items.map((item) => byId.get(item.id) || item);
  await writeJson(itemsPath, itemsDoc);
  console.log(JSON.stringify({
    updated,
    itemsPath,
    ledgerPath,
    authorizeMetrics: authorize,
    finalize: Boolean(values.finalize),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
