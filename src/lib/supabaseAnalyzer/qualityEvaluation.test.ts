import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildArchitectReviewModel } from "./architectReview.ts";
import type { AnalyzerRunDataset } from "./client.ts";
import { finding, fixtureDataset, job, review, run, uuidFor } from "./fixtures/architectReviewFixtures.ts";
import {
  QUALITY_BENCHMARK_ID,
  QUALITY_BENCHMARK_V1,
  QUALITY_EVALUATION_VERSION,
} from "./qualityBenchmark.ts";
import {
  NOT_MEASURED,
  evaluateAnalyzerQuality,
  formatQualityMetric,
  matchBenchmarkCase,
} from "./qualityEvaluation.ts";

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

const here = dirname(fileURLToPath(import.meta.url));

function metricReasons(report: ReturnType<typeof evaluateAnalyzerQuality>) {
  return [report.precision, report.recall, report.falsePositiveRate, report.falseNegativeRate];
}

describe("quality evaluation: 252-finding baseline", () => {
  it("does not invent precision or recall for unlabeled published findings", () => {
    const { dataset } = fixtureDataset();
    const report = evaluateAnalyzerQuality(dataset);
    assert.equal(report.evaluationVersion, QUALITY_EVALUATION_VERSION);
    assert.equal(report.benchmarkId, QUALITY_BENCHMARK_ID);
    assert.equal(report.independentlyVerified, false);
    assert.equal(report.labeledAccuracyEligible, 0);
    for (const metric of metricReasons(report)) {
      assert.equal(metric.status, "not_measured");
      assert.equal(formatQualityMetric(metric), NOT_MEASURED);
    }
    assert.equal(report.precision.status, "not_measured");
    assert.match("reason" in report.precision ? report.precision.reason : "", /not treated as correct/i);
    assert.equal(report.coverage.publishedFindings, 252);
    assert.equal(report.coverage.sheets, 82);
    assert.equal(formatQualityMetric(report.precision).includes("%"), false);
  });

  it("matches verified known-error cases on the frozen fixture and keeps them as regression, not accuracy", () => {
    const { dataset } = fixtureDataset();
    const model = buildArchitectReviewModel(dataset);
    const report = evaluateAnalyzerQuality(dataset);
    assert.equal(report.verifiedRegression.labeled, 4);
    assert.equal(report.verifiedRegression.stillPublished, 4);
    assert.equal(report.verifiedRegression.mitigated, 0);
    assert.equal(report.verifiedRegression.unmatched, 0);
    const hydraulic = QUALITY_BENCHMARK_V1.cases.find((item) => item.id === "fp-hydraulic-density-area")!;
    const matched = matchBenchmarkCase(model, hydraulic);
    assert.equal(matched?.reportId, "C-002");
    assert.equal(matched?.severity, "critical");
    const dates = report.cases.find((item) => item.id === "fp-revision-dates-future");
    assert.equal(dates?.matchedReportId, "W-002");
    assert.equal(dates?.outcome, "false_positive");
    assert.equal(report.provisional.length, 7);
    assert.equal(report.provisional.every((item) => item.use === "provisional"), true);
    assert.ok(report.byDiscipline.some((row) => row.key === "Fire Protection" && row.labeled >= 1));
    assert.ok(report.bySeverity.some((row) => row.key === "critical" && row.labeled >= 1));
  });

  it("records persist-time overlay without rewriting stored findings", () => {
    const { dataset } = fixtureDataset();
    const before = JSON.stringify(dataset.findings);
    const report = evaluateAnalyzerQuality(dataset);
    assert.equal(JSON.stringify(dataset.findings), before);
    assert.equal(report.persistRuleOverlay.status, "measured");
    assert.equal(report.persistRuleOverlay.published, 252);
    assert.equal(typeof report.persistRuleOverlay.wouldWithhold, "number");
    assert.equal(dataset.findings.find((item) => item.title.includes("GFCI Protection for Kitchen"))?.severity, "advisory");
  });
});

describe("quality evaluation: labeled metrics", () => {
  it("computes precision and recall only from verified accuracy labels", () => {
    const sheet = job({ id: "job-1", ordinal: 1, detected_sheet_number: "A-101", detected_sheet_title: "Plan" });
    const dataset: AnalyzerRunDataset = {
      run: run({ total_sheets: 1, completed_sheets: 1 }),
      jobs: [sheet],
      findings: [
        finding({ id: uuidFor(1), sheet_job_id: "job-1", finding_index: 0, severity: "critical", title: "Exit hardware requires a key", observation: "Door EX-1 requires a key from the inside.", drawing_evidence: "Door schedule EX-1 classroom lock, key from inside." }),
        finding({ id: uuidFor(2), sheet_job_id: "job-1", finding_index: 1, severity: "warning", title: "Stair width short", observation: "Stair is 36 inches against a 44-inch note.", drawing_evidence: "Stair note 36 inches. Egress note 44 inches minimum." }),
        finding({ id: uuidFor(3), sheet_job_id: "job-1", finding_index: 2, severity: "warning", title: "Future revision dates", observation: "Revision 02/16/26 is in the future.", drawing_evidence: "Title block revision 02/16/26." }),
        finding({ id: uuidFor(4), sheet_job_id: "job-1", finding_index: 3, severity: "advisory", title: "Unlabeled coordination note", observation: "Coordinate the roof curb with the structural drawing.", drawing_evidence: "Note 12 coordinate roof curb with structural." }),
      ],
    };
    const report = evaluateAnalyzerQuality(dataset, {
      ...QUALITY_BENCHMARK_V1,
      cases: [
        { id: "tp-exit", truth: "verified", expected: "true_positive", use: "accuracy", topic: "unsupported_finding", match: { titleIncludes: "Exit hardware" }, summary: "Keyed exit", rationale: "Synthetic verified issue.", source: "test" },
        { id: "tp-stair", truth: "verified", expected: "true_positive", use: "accuracy", topic: "unsupported_finding", match: { titleIncludes: "Stair width" }, summary: "Stair width", rationale: "Synthetic verified issue.", source: "test" },
        { id: "fp-dates", truth: "verified", expected: "false_positive", use: "accuracy", topic: "revision_date_interpretation", match: { titleIncludes: "Future revision" }, summary: "Dates", rationale: "Synthetic verified FP.", source: "test" },
        { id: "fn-missing", truth: "verified", expected: "false_negative", use: "accuracy", topic: "unsupported_finding", match: { titleIncludes: "Does not exist" }, summary: "Missing issue", rationale: "Gold issue with no finding.", source: "test" },
        { id: "prov", truth: "provisional", expected: "false_positive", use: "provisional", topic: "code_edition", match: { titleIncludes: "Unlabeled" }, summary: "Provisional", rationale: "Must not enter precision.", source: "test" },
      ],
    });
    assert.equal(report.precision.status, "measured");
    assert.equal(report.recall.status, "measured");
    if (report.precision.status !== "measured" || report.recall.status !== "measured") return;
    assert.equal(report.precision.numerator, 2);
    assert.equal(report.precision.denominator, 3);
    assert.equal(report.recall.numerator, 2);
    assert.equal(report.recall.denominator, 3);
    assert.equal(report.labeledAccuracyEligible, 4);
    assert.equal(formatQualityMetric(report.precision), "66.7%");
    assert.equal(report.cases.find((item) => item.id === "prov")?.outcome, "false_positive");
  });

  it("treats a withdrawn known error as mitigated and does not change stored text", () => {
    const { dataset } = fixtureDataset();
    const model = buildArchitectReviewModel(dataset);
    const hydraulicId = model.findings.find((item) => item.reportId === "C-002")!.findingId;
    const reviewed: AnalyzerRunDataset = {
      ...dataset,
      reviews: [review(hydraulicId, "rejected")],
    };
    const before = reviewed.findings.find((item) => item.id === hydraulicId)!.observation;
    const report = evaluateAnalyzerQuality(reviewed);
    assert.equal(reviewed.findings.find((item) => item.id === hydraulicId)!.observation, before);
    const hydraulic = report.cases.find((item) => item.id === "fp-hydraulic-density-area");
    assert.equal(hydraulic?.clientStatus, "withdrawn");
    assert.equal(hydraulic?.outcome, "mitigated");
    assert.equal(report.verifiedRegression.mitigated, 1);
    assert.equal(report.verifiedRegression.stillPublished, 3);
  });
});

describe("quality evaluation stays off client deliverables", () => {
  it("does not add evaluation metrics to PDF, Excel, JSON or the findings matrix", () => {
    const files = [
      join(here, "brandedReport.ts"),
      join(here, "findingsRegister.ts"),
      join(here, "exportDataset.ts"),
      join(here, "report.ts"),
      join(here, "../../components/compliance/supabaseAnalyzerPresentation.tsx"),
    ].map((path) => readFileSync(path, "utf8"));
    for (const source of files) {
      assert.equal(source.includes("evaluateAnalyzerQuality"), false);
      assert.equal(source.includes("QUALITY_BENCHMARK"), false);
      assert.equal(source.includes("Not measured"), false);
    }
  });
});
