/**
 * Phase 2A.6 benchmark adjudication runner.
 * Builds review records, queue, crops, independent FN process, and audit-ready store.
 * Does not mark findings professionally verified automatically.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { prepareRecordCrop } from "./adjudicateCrops.mjs";
import { sortAdjudicationQueue, summarizeQueueBands } from "./adjudicateQueue.mjs";
import {
  ADJUDICATION_VERSION,
  applyAdjudicationDecision,
  emptyReviewState,
  metricsFromReviews,
} from "./adjudicateSchema.mjs";
import { attachBenchmarkIds, benchmarkMissedIssueId } from "./benchmarkIds.mjs";
import { inventoryAccountability } from "./hybridSelect.mjs";
import { normalizeAutomatedAssessment } from "./semanticAssess.mjs";

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function loadJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function c002ExampleNote(record) {
  if (record.clientReportId !== "C-002") return null;
  return {
    exampleId: "C-002",
    note: "Hydraulic numbers may be present on the sheet (evidence grounding) while the hydraulic conclusion can still be incorrect (technical correctness). Adjudicate these dimensions separately.",
    suggestedDimensions: {
      evidenceGrounding: "Review whether cited GPM/density values appear.",
      technicalCorrectness: "Review whether the finding's inconsistency conclusion is technically right.",
      findingValidity: "Only after both dimensions are judged.",
    },
  };
}

function buildCaseRecord(semanticRow, findingMapRow) {
  const original = semanticRow.original || findingMapRow?.original || {};
  const withIds = attachBenchmarkIds([{
    ...findingMapRow,
    ...semanticRow,
    original,
    wordingSha256: semanticRow.wordingSha256 || findingMapRow?.wordingSha256,
    sha256: semanticRow.sha256 || findingMapRow?.sha256,
    sheetNumber: semanticRow.sheetNumber || findingMapRow?.sheetNumber,
  }])[0];

  return {
    benchmarkId: withIds.benchmarkId,
    benchmarkIdVersion: withIds.benchmarkIdVersion,
    clientReportId: semanticRow.clientReportId,
    wordingSha256: withIds.wordingSha256,
    sourceFileSha256: withIds.sha256 || null,
    relativePath: semanticRow.relativePath,
    sheetNumber: semanticRow.sheetNumber,
    severity: semanticRow.severity,
    discipline: semanticRow.discipline,
    labelStatus: semanticRow.labelStatus || findingMapRow?.labelStatus || "unverified_model_output",
    original: {
      title: original.title,
      observation: original.observation,
      drawingEvidence: original.drawingEvidence,
      drawingLocation: original.drawingLocation,
      recommendation: original.recommendation,
      codeReference: original.codeReference ?? null,
      severity: original.severity,
    },
    automatedRetrieval: {
      assessment: normalizeAutomatedAssessment(semanticRow.assessment?.automatedAssessment),
      legacyAssessment: semanticRow.assessment?.automatedAssessment || null,
      retrievalSuccess: semanticRow.assessment?.retrievalSuccess || false,
      bestScore: semanticRow.assessment?.bestScore ?? semanticRow.retrieval?.bestScore ?? 0,
      rationale: semanticRow.assessment?.rationale || null,
      note: "Automated retrieval only. Not verified grounding or technical correctness.",
    },
    retrieval: semanticRow.retrieval || null,
    qualityFlags: semanticRow.qualityFlags || [],
    specialNotes: c002ExampleNote(semanticRow),
    crop: null,
    review: emptyReviewState(),
    wordingUnchanged: true,
    professionallyVerified: false,
  };
}

function buildIndependentSheetReview(inventory, recon) {
  const pdfs = (inventory.files || []).filter((file) => file.format === "pdf");
  return {
    adjudicationVersion: ADJUDICATION_VERSION,
    purpose: "Independent drawing review to discover missed issues (false negatives) without relying on the 252 model findings.",
    precision: "Not measured",
    recall: "Not measured",
    falseNegativeRate: "Not measured",
    instructions: [
      "Review sheets independently of the existing finding list when possible.",
      "Record only issues you can cite on the drawing with coordinates or clear location text.",
      "Do not invent code citations, dimensions, or findings.",
      "Confirmed missed issues may later contribute to recall only after authorized verification.",
    ],
    accountability: {
      pdfFiles: pdfs.length,
      s204IdentityCount: recon.fileMatches?.find((match) => match.relativePath === "S-204.00.pdf")?.identityCount || 0,
      s300MatchMethod: recon.fileMatches?.find((match) => match.relativePath === "S-300.00.pdf")?.method || null,
    },
    sheets: pdfs.map((file) => ({
      relativePath: file.relativePath,
      sourceFileSha256: file.sha256,
      sheetMatch: recon.fileMatches?.find((match) => match.relativePath === file.relativePath) || null,
      review: {
        status: "pending",
        reviewerId: null,
        reviewedAt: null,
        noMissedIssuesObserved: null,
        notes: null,
        professionallyVerified: false,
      },
      missedIssues: [],
    })),
    confirmedMissedIssues: [],
    templateMissedIssue: {
      benchmarkMissedIssueId: null,
      relativePath: null,
      sourceFileSha256: null,
      title: null,
      observation: null,
      drawingEvidence: null,
      drawingLocation: null,
      bbox: null,
      codeReference: null,
      severity: null,
      reviewerId: null,
      justification: null,
      professionallyVerified: false,
      contributesToMetrics: false,
      note: "Fill via adjudicate-missed CLI or manual JSON; IDs are assigned on apply.",
    },
  };
}

export async function initAdjudication(options) {
  const onProgress = options.onProgress || (() => {});
  const outDir = path.join(options.outDir, options.outName || "adjudication");
  const casesDir = path.join(outDir, "cases");
  const cropDir = path.join(outDir, "crops");
  const decisionsDir = path.join(outDir, "decisions");
  await mkdir(casesDir, { recursive: true });
  await mkdir(cropDir, { recursive: true });
  await mkdir(decisionsDir, { recursive: true });

  const findingMapPath = path.join(options.outDir, "finding-map.json");
  const findingMapBefore = await readFile(findingMapPath);
  const findingMapHash = sha256Text(findingMapBefore);
  const findingMap = JSON.parse(findingMapBefore.toString("utf8"));
  const inventory = await loadJson(path.join(options.outDir, "inventory.json"));
  const recon = await loadJson(path.join(options.outDir, "reconciliation.json"));
  const account = inventoryAccountability(inventory);
  const semanticPath = path.join(options.outDir, "semantic-ground", "finding-evidence.json");
  if (!existsSync(semanticPath)) {
    throw new Error("Missing semantic-ground/finding-evidence.json. Run Phase 2A.5 first.");
  }
  const semantic = await loadJson(semanticPath);
  const byClient = new Map((findingMap.findings || []).map((row) => [row.clientReportId, row]));

  let records = (semantic.records || []).map((row) => buildCaseRecord(row, byClient.get(row.clientReportId)));
  records = sortAdjudicationQueue(records);

  const cropLimit = options.cropLimit ?? records.length;
  let cropIndex = 0;
  for (const record of records) {
    onProgress({ status: "case", clientReportId: record.clientReportId, queueOrder: record.queueOrder });
    let crop = {
      source: "coordinates_only",
      cropStatus: options.renderCrops === false ? "coordinates_only" : "pending",
    };
    if (cropIndex < cropLimit) {
      crop = await prepareRecordCrop(record, {
        sourceDir: options.sourceDir,
        cropDir,
        renderCrops: options.renderCrops !== false && Boolean(options.sourceDir),
        force: options.force,
        cropFn: options.cropFn,
        pythonBin: options.pythonBin,
      });
      cropIndex += 1;
    }
    record.crop = crop;
    await writeFile(path.join(casesDir, `${record.benchmarkId}.json`), JSON.stringify(record, null, 2));
  }

  const findingMapAfter = await readFile(findingMapPath);
  if (sha256Text(findingMapAfter) !== findingMapHash) {
    throw new Error("finding-map.json changed during adjudication init. Aborting.");
  }

  const independent = buildIndependentSheetReview(inventory, recon);
  const metrics = metricsFromReviews(records);
  const bandCounts = summarizeQueueBands(records);
  const summary = {
    adjudicationVersion: ADJUDICATION_VERSION,
    phase: "2A.6",
    productionNote: "The Supabase analyzer, GPT-4o path, stored findings, M1–M4 reports, and Code Analyzer V2 are unchanged.",
    methodologyNote: "Adjudication separates evidence grounding, technical correctness, and finding validity. Automated evidence_retrieved is not verification. C-002 is the canonical example.",
    precision: metrics.precision,
    recall: metrics.recall,
    falsePositiveRate: metrics.falsePositiveRate,
    falseNegativeRate: metrics.falseNegativeRate,
    accountability: {
      inventoryFiles: account.recordedFiles,
      pdfFiles: account.pdfCount,
      findings: records.length,
      findingsUnchanged: true,
      findingMapSha256: findingMapHash,
      s204IdentityCount: recon.fileMatches?.find((match) => match.relativePath === "S-204.00.pdf")?.identityCount || 0,
      s300MatchMethod: recon.fileMatches?.find((match) => match.relativePath === "S-300.00.pdf")?.method || null,
      archivePresent: account.zipPresent,
    },
    queueBands: bandCounts,
    verifiedVersusPending: {
      professionallyVerified: records.filter((row) => row.review?.professionallyVerified).length,
      pending: records.filter((row) => !row.review?.professionallyVerified).length,
      contributesToMetrics: records.filter((row) => row.review?.contributesToMetrics).length,
      implementedFunctionality: true,
      localTestingOnly: true,
      professionallyCompletedReviews: 0,
    },
    metrics,
    records,
  };

  await writeFile(path.join(outDir, "manifest.json"), JSON.stringify({
    adjudicationVersion: ADJUDICATION_VERSION,
    findingMapSha256: findingMapHash,
    caseCount: records.length,
    createdAt: new Date().toISOString(),
    queueBands: bandCounts,
  }, null, 2));
  await writeFile(path.join(outDir, "queue.json"), JSON.stringify({
    adjudicationVersion: ADJUDICATION_VERSION,
    bands: bandCounts,
    items: records.map((row) => ({
      queueOrder: row.queueOrder,
      queueBand: row.queueBand,
      benchmarkId: row.benchmarkId,
      clientReportId: row.clientReportId,
      severity: row.severity,
      relativePath: row.relativePath,
      automatedRetrieval: row.automatedRetrieval.assessment,
      title: row.original?.title || null,
      reviewStatus: row.review.status,
      professionallyVerified: false,
    })),
  }, null, 2));
  await writeFile(path.join(outDir, "cases.json"), JSON.stringify({
    adjudicationVersion: ADJUDICATION_VERSION,
    findingMapSha256: findingMapHash,
    findingsUnchanged: true,
    records,
  }, null, 2));
  await writeFile(path.join(outDir, "independent-sheet-review.json"), JSON.stringify(independent, null, 2));
  await writeFile(path.join(outDir, "metrics.json"), JSON.stringify({
    adjudicationVersion: ADJUDICATION_VERSION,
    ...metrics,
    professionallyCompletedReviews: 0,
  }, null, 2));
  await writeFile(path.join(outDir, "audit-log.jsonl"), "");
  await writeFile(path.join(outDir, "comparison.json"), JSON.stringify(summary, null, 2));
  await writeFile(path.join(outDir, "comparison.md"), renderAdjudicationReport(summary));
  await writeFile(path.join(outDir, "README.md"), renderAdjudicationReadme());

  return { summary, outDir, findingMapHash, findingsUnchanged: true };
}

export async function applyDecisionFile(options) {
  const outDir = path.join(options.outDir, options.outName || "adjudication");
  const decision = typeof options.decision === "object"
    ? options.decision
    : JSON.parse(await readFile(options.decisionPath, "utf8"));
  const casesPath = path.join(outDir, "cases.json");
  const bundle = await loadJson(casesPath);
  const index = bundle.records.findIndex((row) => row.benchmarkId === decision.benchmarkId
    || row.clientReportId === decision.clientReportId);
  if (index === -1) throw new Error(`Case not found for decision ${decision.benchmarkId || decision.clientReportId}`);
  const updated = applyAdjudicationDecision(bundle.records[index], decision, { now: options.now });
  bundle.records[index] = updated;
  await writeFile(path.join(outDir, "cases", `${updated.benchmarkId}.json`), JSON.stringify(updated, null, 2));
  await writeFile(casesPath, JSON.stringify(bundle, null, 2));
  await writeFile(
    path.join(outDir, "decisions", `${updated.benchmarkId}-${Date.now()}.json`),
    JSON.stringify({ decision, applied: updated.review }, null, 2),
  );
  const auditLine = JSON.stringify({
    at: updated.review.reviewedAt,
    benchmarkId: updated.benchmarkId,
    clientReportId: updated.clientReportId,
    reviewerId: decision.reviewerId,
    overallOutcome: updated.review.overallOutcome,
    professionallyVerified: updated.review.professionallyVerified,
    contributesToMetrics: updated.review.contributesToMetrics,
  });
  const existingAudit = existsSync(path.join(outDir, "audit-log.jsonl"))
    ? await readFile(path.join(outDir, "audit-log.jsonl"), "utf8")
    : "";
  await writeFile(path.join(outDir, "audit-log.jsonl"), `${existingAudit}${auditLine}\n`);

  const metrics = metricsFromReviews(bundle.records);
  await writeFile(path.join(outDir, "metrics.json"), JSON.stringify({
    adjudicationVersion: ADJUDICATION_VERSION,
    ...metrics,
  }, null, 2));
  return { record: updated, metrics };
}

export async function applyMissedIssue(options) {
  const outDir = path.join(options.outDir, options.outName || "adjudication");
  const payload = options.issue;
  const packPath = path.join(outDir, "independent-sheet-review.json");
  const pack = await loadJson(packPath);
  if (!payload?.reviewerId) throw new Error("reviewerId required for missed-issue submissions.");
  if (!payload.relativePath || !payload.title || !payload.observation) {
    throw new Error("relativePath, title, and observation are required.");
  }
  const sheet = pack.sheets.find((row) => row.relativePath === payload.relativePath);
  if (!sheet) throw new Error(`Sheet not in independent review pack: ${payload.relativePath}`);
  const issue = {
    benchmarkMissedIssueId: benchmarkMissedIssueId({
      relativePath: payload.relativePath,
      sourceFileSha256: sheet.sourceFileSha256,
      title: payload.title,
      observation: payload.observation,
    }),
    relativePath: payload.relativePath,
    sourceFileSha256: sheet.sourceFileSha256,
    title: payload.title,
    observation: payload.observation,
    drawingEvidence: payload.drawingEvidence || null,
    drawingLocation: payload.drawingLocation || null,
    bbox: payload.bbox || null,
    codeReference: payload.codeReference || null,
    severity: payload.severity || null,
    reviewerId: payload.reviewerId,
    justification: payload.justification || null,
    professionallyVerified: false,
    contributesToMetrics: false,
    note: "Recorded for FN discovery. Does not change precision/recall until authorized verification coverage exists.",
  };
  sheet.missedIssues.push(issue);
  if (payload.professionallyVerified) {
    throw new Error("Missed issues cannot be auto-marked professionallyVerified in this phase; leave false.");
  }
  pack.confirmedMissedIssues = pack.sheets.flatMap((row) => row.missedIssues);
  await writeFile(packPath, JSON.stringify(pack, null, 2));
  return { issue, pack };
}

export function renderAdjudicationReport(summary) {
  const lines = [];
  lines.push("# Phase 2A.6 benchmark adjudication");
  lines.push("");
  lines.push("Implemented workflow + local testing. Professionally completed reviews: 0 unless audit says otherwise.");
  lines.push("Precision: Not measured");
  lines.push("Recall: Not measured");
  lines.push("False-negative rate: Not measured");
  lines.push("");
  lines.push(summary.productionNote);
  lines.push(summary.methodologyNote);
  lines.push("");
  lines.push("## Verified versus pending");
  lines.push("");
  lines.push(`- professionally verified cases: ${summary.verifiedVersusPending.professionallyVerified}`);
  lines.push(`- pending cases: ${summary.verifiedVersusPending.pending}`);
  lines.push(`- contributes to metrics: ${summary.verifiedVersusPending.contributesToMetrics}`);
  lines.push(`- professionally completed reviews: ${summary.verifiedVersusPending.professionallyCompletedReviews}`);
  lines.push("");
  lines.push("## Queue bands");
  lines.push("");
  lines.push("| Band | Count |");
  lines.push("| --- | ---: |");
  for (const [band, count] of Object.entries(summary.queueBands || {})) {
    lines.push(`| ${band} | ${count} |`);
  }
  lines.push("");
  lines.push("## Guardrails");
  lines.push("");
  lines.push(`- inventory files: ${summary.accountability.inventoryFiles}`);
  lines.push(`- pdf files: ${summary.accountability.pdfFiles}`);
  lines.push(`- findings: ${summary.accountability.findings}`);
  lines.push(`- findings unchanged: ${summary.accountability.findingsUnchanged}`);
  lines.push(`- S-204 identities: ${summary.accountability.s204IdentityCount}`);
  lines.push(`- S-300 match: ${summary.accountability.s300MatchMethod}`);
  lines.push("");
  lines.push("C-002: evaluate evidence grounding separately from technical correctness.");
  lines.push("");
  return lines.join("\n");
}

function renderAdjudicationReadme() {
  return `# Adjudication workspace (Phase 2A.6)

## Outcomes
- confirmed_valid
- false_positive
- needs_more_evidence
- not_applicable
- deferred

## Dimensions (independent)
1. evidenceGrounding
2. technicalCorrectness
3. findingValidity

\`evidence_retrieved\` from Phase 2A.5 is automated text/region match only.

## Apply a decision
\`\`\`bash
node eval/drawing-dataset/cli/adjudicate-apply.mjs \\
  --out eval/drawing-dataset/out/mcd-649fdaa6 \\
  --decision /path/to/decision.json
\`\`\`

Decision JSON must include reviewerId. Set professionallyVerified + authorizeMetricsContribution only for authorized qualified review.

## Independent missed issues
\`\`\`bash
node eval/drawing-dataset/cli/adjudicate-missed.mjs \\
  --out eval/drawing-dataset/out/mcd-649fdaa6 \\
  --issue /path/to/missed-issue.json
\`\`\`

Precision/recall remain Not measured until authorized ground truth exists.
`;
}
