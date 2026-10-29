/**
 * Offline quality evaluation for stored Supabase analyzer results.
 * Does not call a model, rewrite findings, or treat unlabeled AI output as gold.
 */
import {
  buildArchitectReviewModel,
  type ArchitectReviewModel,
  type ReportCoverageOutcome,
  type ReportFinding,
} from "@/lib/supabaseAnalyzer/architectReview";
import type { AnalyzerRunDataset } from "@/lib/supabaseAnalyzer/client";
import {
  QUALITY_BENCHMARK_V1,
  QUALITY_EVALUATION_VERSION,
  type QualityBenchmark,
  type QualityBenchmarkCase,
  type QualityExpected,
  type QualityTopic,
} from "@/lib/supabaseAnalyzer/qualityBenchmark";
import {
  validateAnalyzerFindings,
  type DraftAnalyzerFinding,
  type SubmittedSheetRef,
} from "../../../supabase/functions/_shared/analyzerFindingQuality.ts";

export const NOT_MEASURED = "Not measured";

export type QualityMetric =
  | {
      status: "measured";
      value: number;
      numerator: number;
      denominator: number;
    }
  | {
      status: "not_measured";
      reason: string;
    };

export type CaseOutcome = "true_positive" | "false_positive" | "false_negative" | "mitigated" | "unmatched";

export interface EvaluatedQualityCase {
  id: string;
  truth: QualityBenchmarkCase["truth"];
  use: QualityBenchmarkCase["use"];
  topic: QualityTopic;
  expected: QualityExpected;
  outcome: CaseOutcome;
  summary: string;
  rationale: string;
  source: string;
  matchedReportId: string | null;
  matchedSeverity: string | null;
  clientStatus: ReportFinding["clientStatus"] | null;
}

export interface QualityBreakdownRow {
  key: string;
  findings: number;
  evidencePresent: number;
  labeled: number;
}

export interface QualityEvaluationReport {
  evaluationVersion: typeof QUALITY_EVALUATION_VERSION;
  benchmarkId: string;
  runId: string;
  independentlyVerified: false;
  disclaimer: string;
  limitations: readonly string[];
  precision: QualityMetric;
  recall: QualityMetric;
  falsePositiveRate: QualityMetric;
  falseNegativeRate: QualityMetric;
  labeledAccuracyEligible: number;
  verifiedRegression: {
    labeled: number;
    stillPublished: number;
    mitigated: number;
    unmatched: number;
  };
  provisional: EvaluatedQualityCase[];
  cases: EvaluatedQualityCase[];
  coverage: {
    sheets: number;
    completed: number;
    withFindings: number;
    noFindings: number;
    failed: number;
    pending: number;
    cancelled: number;
    publishedFindings: number;
    presentedFindings: number;
    withdrawnFindings: number;
  };
  evidence: {
    status: "measured";
    present: number;
    total: number;
    note: string;
  };
  persistRuleOverlay: {
    status: "measured" | "not_measured";
    wouldWithhold: number;
    published: number;
    reason?: string;
  };
  byDiscipline: QualityBreakdownRow[];
  bySeverity: QualityBreakdownRow[];
}

function notMeasured(reason: string): QualityMetric {
  return { status: "not_measured", reason };
}

function measured(numerator: number, denominator: number): QualityMetric {
  if (denominator <= 0) return notMeasured("No verified labels in this denominator.");
  return { status: "measured", value: numerator / denominator, numerator, denominator };
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function formatQualityMetric(metric: QualityMetric, asPercent = true): string {
  if (metric.status === "not_measured") return NOT_MEASURED;
  if (!asPercent) return `${metric.numerator} / ${metric.denominator}`;
  return `${Math.round(metric.value * 1000) / 10}%`;
}

export function matchBenchmarkCase(model: ArchitectReviewModel, item: QualityBenchmarkCase): ReportFinding | null {
  if (item.match.reportId) {
    const byId = model.findings.find((finding) => finding.reportId === item.match.reportId);
    if (byId) return byId;
  }
  const title = item.match.titleIncludes ? normalize(item.match.titleIncludes) : "";
  const sheet = item.match.sheetNumber ? normalize(item.match.sheetNumber).replace(/\s/g, "") : "";
  return model.findings.find((finding) => {
    const sheetOk = !sheet || normalize(finding.sheet.sheetNumber || "").replace(/\s/g, "") === sheet
      || normalize(finding.sheet.sheetNumber || "").includes(sheet);
    const titleOk = !title || normalize(finding.title).includes(title);
    return sheetOk && titleOk;
  }) || null;
}

function outcomeFor(item: QualityBenchmarkCase, finding: ReportFinding | null): CaseOutcome {
  if (item.expected === "false_negative") {
    return finding ? "true_positive" : "false_negative";
  }
  if (!finding) return "unmatched";
  if (item.expected === "true_positive") {
    return finding.clientStatus === "withdrawn" ? "false_negative" : "true_positive";
  }
  const stillIssue = finding.clientStatus === "included"
    && (finding.severity === "critical" || finding.severity === "warning" || finding.severity === "advisory");
  return stillIssue ? "false_positive" : "mitigated";
}

function evidencePresent(finding: ReportFinding): boolean {
  const evidence = finding.drawingEvidence.replace(/\s+/g, " ").trim();
  if (evidence.length < 12) return false;
  return !/^(n\/a|na|none|see drawing|the drawing|drawing|note)\.?$/i.test(evidence);
}

function draftFromFinding(finding: ReportFinding): DraftAnalyzerFinding {
  return {
    category: finding.category || "General",
    severity: finding.severity,
    title: finding.title,
    observation: finding.observation,
    drawing_evidence: finding.drawingEvidence,
    drawing_location: finding.drawingLocation || "",
    suggested_code_reference: finding.codeReference || "",
    recommendation: finding.recommendation,
  };
}

function overlayWithholdCount(dataset: AnalyzerRunDataset, findings: ReportFinding[]): QualityEvaluationReport["persistRuleOverlay"] {
  try {
    const sheetIndex: SubmittedSheetRef[] = dataset.jobs.map((job) => ({
      fileName: job.original_file_name,
      detectedSheetNumber: job.detected_sheet_number,
      detectedSheetTitle: job.detected_sheet_title,
      discipline: job.discipline,
    }));
    const result = validateAnalyzerFindings(
      findings.map(draftFromFinding),
      {
        analysisMode: dataset.run.analysis_mode ?? null,
        jurisdictionKey: dataset.run.jurisdiction_key,
        jurisdictionLabel: dataset.run.jurisdiction_label,
        codeEdition: dataset.run.code_edition,
        codeContext: dataset.run.code_context,
        sheetIndex,
      },
    );
    return {
      status: "measured",
      wouldWithhold: result.withheld.length,
      published: findings.length,
    };
  } catch {
    return {
      status: "not_measured",
      wouldWithhold: 0,
      published: findings.length,
      reason: "Persist-time rules could not be applied to this dataset.",
    };
  }
}

function coverageFrom(model: ArchitectReviewModel) {
  const count = (outcome: ReportCoverageOutcome) => model.coverage.filter((row) => row.outcome === outcome).length;
  return {
    sheets: model.coverage.length,
    completed: count("findings") + count("no_findings"),
    withFindings: count("findings"),
    noFindings: count("no_findings"),
    failed: count("failed"),
    pending: count("pending"),
    cancelled: count("cancelled"),
    publishedFindings: model.totals.published.all,
    presentedFindings: model.totals.client.all,
    withdrawnFindings: model.totals.withdrawn,
  };
}

function breakdown(
  findings: ReportFinding[],
  labeledIds: Set<string>,
  keyOf: (finding: ReportFinding) => string,
): QualityBreakdownRow[] {
  const rows = new Map<string, QualityBreakdownRow>();
  for (const finding of findings) {
    const key = keyOf(finding);
    const row = rows.get(key) || { key, findings: 0, evidencePresent: 0, labeled: 0 };
    row.findings += 1;
    if (evidencePresent(finding)) row.evidencePresent += 1;
    if (labeledIds.has(finding.reportId)) row.labeled += 1;
    rows.set(key, row);
  }
  return [...rows.values()].sort((left, right) => right.findings - left.findings || left.key.localeCompare(right.key));
}

export function evaluateAnalyzerQuality(
  dataset: AnalyzerRunDataset,
  benchmark: QualityBenchmark = QUALITY_BENCHMARK_V1,
): QualityEvaluationReport {
  const model = buildArchitectReviewModel(dataset);
  const cases: EvaluatedQualityCase[] = benchmark.cases.map((item) => {
    const finding = matchBenchmarkCase(model, item);
    return {
      id: item.id,
      truth: item.truth,
      use: item.use,
      topic: item.topic,
      expected: item.expected,
      outcome: outcomeFor(item, finding),
      summary: item.summary,
      rationale: item.rationale,
      source: item.source,
      matchedReportId: finding?.reportId || null,
      matchedSeverity: finding?.severity || null,
      clientStatus: finding?.clientStatus || null,
    };
  });

  const accuracy = cases.filter((item) => item.use === "accuracy" && item.truth === "verified");
  const truePositives = accuracy.filter((item) => item.outcome === "true_positive").length;
  const falsePositives = accuracy.filter((item) => item.outcome === "false_positive").length;
  const falseNegatives = accuracy.filter((item) => item.outcome === "false_negative").length;
  const accuracyEligible = truePositives + falsePositives + falseNegatives;

  const regression = cases.filter((item) => item.use === "regression" && item.truth === "verified");
  const stillPublished = regression.filter((item) => item.outcome === "false_positive").length;
  const mitigated = regression.filter((item) => item.outcome === "mitigated").length;
  const unmatched = regression.filter((item) => item.outcome === "unmatched").length;

  const labeledIds = new Set(
    cases.map((item) => item.matchedReportId).filter((id): id is string => Boolean(id)),
  );
  const present = model.findings.filter(evidencePresent).length;

  const noAccuracyLabels = accuracyEligible === 0;
  return {
    evaluationVersion: QUALITY_EVALUATION_VERSION,
    benchmarkId: benchmark.id,
    runId: dataset.run.id,
    independentlyVerified: false,
    disclaimer:
      "Automated evaluation of stored results. Not a professional code determination, not an approval, and not confirmation that findings are correct or complete.",
    limitations: benchmark.limitations,
    precision: noAccuracyLabels
      ? notMeasured("No verified true-positive and false-positive labels for this analysis. Unlabeled AI findings are not treated as correct.")
      : measured(truePositives, truePositives + falsePositives),
    recall: noAccuracyLabels
      ? notMeasured("No verified gold list of required issues for this analysis.")
      : measured(truePositives, truePositives + falseNegatives),
    falsePositiveRate: noAccuracyLabels
      ? notMeasured("False-positive rate needs verified labels. Known-error cases are listed separately and are not an overall rate.")
      : measured(falsePositives, truePositives + falsePositives),
    falseNegativeRate: noAccuracyLabels
      ? notMeasured("False-negative rate needs a verified gold issue list.")
      : measured(falseNegatives, truePositives + falseNegatives),
    labeledAccuracyEligible: accuracyEligible,
    verifiedRegression: {
      labeled: regression.length,
      stillPublished,
      mitigated,
      unmatched,
    },
    provisional: cases.filter((item) => item.use === "provisional"),
    cases,
    coverage: coverageFrom(model),
    evidence: {
      status: "measured",
      present,
      total: model.findings.length,
      note: "Heuristic only: the finding includes specific drawing evidence text. This is not professional grounding or code verification.",
    },
    persistRuleOverlay: overlayWithholdCount(dataset, model.findings),
    byDiscipline: breakdown(model.findings, labeledIds, (finding) => finding.sheet.discipline || "Unspecified"),
    bySeverity: breakdown(model.findings, labeledIds, (finding) => finding.severity || "unspecified"),
  };
}
