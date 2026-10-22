import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AnalyzerRunDataset, SupabaseAnalyzerFinding, SupabaseAnalyzerRun, SupabaseAnalyzerSheetJob } from "./client.ts";
import { buildSupabaseAnalyzerJsonExport } from "./exportDataset.ts";
import {
  buildReviewDecisionRecord,
  indexReviewDecisions,
  mergeReviewDecision,
  nextRunSeverityFilter,
  projectAnalyzerReview,
  reviewDecisionKey,
  reviewForExport,
  reviewReportLines,
  type FindingReviewDecision,
  type ReviewFilterFinding,
} from "./reviewDecisions.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function finding(partial: Partial<SupabaseAnalyzerFinding> & Pick<SupabaseAnalyzerFinding, "id" | "sheet_job_id" | "severity">): SupabaseAnalyzerFinding {
  return {
    run_id: "run-1",
    finding_index: 0,
    category: "Egress",
    title: "Stair width",
    observation: "The stair note is narrower than the recorded width.",
    drawing_evidence: "Stair note on the plan.",
    drawing_location: "Grid B",
    suggested_code_reference: "IBC 1011",
    recommendation: "Original recommendation text",
    ai_provider: "openai",
    ai_model: "gpt-4o-secret-model",
    jurisdiction_key: "dc",
    code_edition: "2017",
    provenance_status: "model_generated_from_uploaded_pdf",
    verification_status: "proposed_reference",
    created_at: "2026-10-22T00:00:00.000Z",
    ...partial,
  };
}

function review(partial: Partial<FindingReviewDecision> & Pick<FindingReviewDecision, "run_id" | "finding_id" | "decision">): FindingReviewDecision {
  return {
    id: `review-${partial.run_id}-${partial.finding_id}`,
    project_id: "project-1",
    sheet_job_id: "sheet-a",
    modified_response: null,
    decided_at: "2026-10-22T01:00:00.000Z",
    decided_by: "auth-user-9f3c",
    ...partial,
  };
}

function sheetJob(id: string, ordinal: number): SupabaseAnalyzerSheetJob {
  return {
    id,
    run_id: "run-1",
    project_id: "project-1",
    ordinal,
    original_file_name: `${id}.pdf`,
    object_path: "project-1/run-1/signed-url-token.pdf",
    file_size: 1200,
    discipline: "Architectural",
    detected_sheet_number: id.toUpperCase(),
    detected_sheet_title: "Floor plan",
    status: "completed",
    attempt_count: 1,
    max_attempts: 3,
    last_error: null,
    error_code: null,
    input_tokens: 40,
    output_tokens: 80,
    estimated_cost_usd: 4.5,
    analysis_summary: "Sheet summary",
    created_at: "2026-10-22T00:00:00.000Z",
    updated_at: "2026-10-22T00:00:00.000Z",
  };
}

function run(): SupabaseAnalyzerRun {
  return {
    id: "run-1",
    project_id: "project-1",
    created_by: "auth-user-9f3c",
    status: "completed",
    jurisdiction_key: "dc",
    jurisdiction_label: "Washington D.C.",
    project_type: "Commercial",
    code_edition: "2017",
    code_context: "2017 DC Construction Codes",
    analysis_mode: "both",
    analysis_scope: null,
    source_coverage: "adoption_metadata_only",
    ai_provider: "openai",
    ai_model: "gpt-4o-secret-model",
    total_sheets: 2,
    uploaded_sheets: 2,
    queued_sheets: 0,
    processing_sheets: 0,
    completed_sheets: 2,
    failed_sheets: 0,
    total_input_tokens: 40,
    total_output_tokens: 80,
    estimated_cost_usd: 4.5,
    budget_limit_usd: 20,
    started_at: null,
    completed_at: "2026-10-22T00:00:00.000Z",
    cancelled_at: null,
    created_at: "2026-10-22T00:00:00.000Z",
    updated_at: "2026-10-22T00:00:00.000Z",
  };
}

describe("run and sheet finding filters", () => {
  const findings: ReviewFilterFinding[] = [
    { id: "a-c", sheet_job_id: "arch", severity: "critical" },
    { id: "a-w", sheet_job_id: "arch", severity: "warning" },
    { id: "s-c", sheet_job_id: "struct", severity: "critical" },
    { id: "s-a", sheet_job_id: "struct", severity: "advisory" },
  ];
  const sheets = [
    { id: "arch", discipline: "Architectural" },
    { id: "struct", discipline: "Structural" },
  ];

  it("shows only critical findings and clears them with All Findings", () => {
    const critical = projectAnalyzerReview({
      sheets,
      findings,
      discipline: "all",
      runSeverity: nextRunSeverityFilter("all", "critical"),
    });
    assert.deepEqual(critical.visibleFindings.map((item) => item.id), ["a-c", "s-c"]);
    assert.equal(nextRunSeverityFilter("critical", "all"), "all");
    const cleared = projectAnalyzerReview({
      sheets,
      findings,
      discipline: "all",
      runSeverity: nextRunSeverityFilter("critical", "all"),
    });
    assert.equal(cleared.visibleFindings.length, findings.length);
    assert.equal(cleared.emptyMessage, null);
  });

  it("intersects discipline and severity without deleting findings", () => {
    const originalIds = findings.map((item) => item.id);
    const view = projectAnalyzerReview({
      sheets,
      findings,
      discipline: "Architectural",
      runSeverity: "critical",
    });
    assert.deepEqual(view.sheets.map((sheet) => sheet.id), ["arch"]);
    assert.deepEqual(view.visibleFindings.map((item) => item.id), ["a-c"]);
    assert.deepEqual(findings.map((item) => item.id), originalIds);
    assert.equal(view.visibleFindings[0], findings[0]);
  });

  it("returns an empty state when the combined filters match nothing", () => {
    const view = projectAnalyzerReview({
      sheets,
      findings,
      discipline: "Architectural",
      runSeverity: "advisory",
    });
    assert.equal(view.visibleFindings.length, 0);
    assert.equal(view.emptyMessage, "No advisory findings match the current filters.");
    assert.equal(findings.length, 4);
  });

  it("keeps a per-sheet filter from changing the other sheet", () => {
    const view = projectAnalyzerReview({
      sheets,
      findings,
      discipline: "all",
      runSeverity: "critical",
      sheetSeverity: { arch: "warning" },
    });
    assert.deepEqual(view.findingsBySheet.get("arch")?.map((item) => item.id), ["a-w"]);
    assert.deepEqual(view.findingsBySheet.get("struct")?.map((item) => item.id), ["s-c"]);
    assert.equal(findings.length, 4);
  });

  it("does not change saved review decisions when the filter changes", () => {
    const decisions = [
      review({ run_id: "run-1", finding_id: "a-c", decision: "accepted" }),
      review({
        run_id: "run-1",
        finding_id: "a-w",
        decision: "modified",
        modified_response: "Reviewer edited response",
      }),
    ];
    const before = JSON.stringify(decisions);
    projectAnalyzerReview({
      sheets,
      findings,
      discipline: "Architectural",
      runSeverity: "warning",
      sheetSeverity: { struct: "advisory" },
    });
    assert.equal(JSON.stringify(decisions), before);
    assert.equal(indexReviewDecisions(decisions).get(reviewDecisionKey("run-1", "a-w"))?.modified_response, "Reviewer edited response");
  });
});

describe("review decision records", () => {
  const base = {
    projectId: "project-1",
    runId: "run-a",
    sheetJobId: "sheet-a",
    findingId: "finding-1",
    decidedAt: "2026-10-22T02:00:00.000Z",
    decidedBy: "auth-user-9f3c",
    originalRecommendation: "Original recommendation text",
  };

  it("maps accept, modify, and reject without replacing the original recommendation", () => {
    const recommendation = "Original recommendation text";
    const accepted = buildReviewDecisionRecord({ ...base, decision: "accepted", originalRecommendation: recommendation });
    const rejected = buildReviewDecisionRecord({ ...base, decision: "rejected", originalRecommendation: recommendation });
    const modified = buildReviewDecisionRecord({
      ...base,
      decision: "modified",
      modifiedResponse: "  Edited reviewer response  ",
      originalRecommendation: recommendation,
    });
    assert.equal(recommendation, "Original recommendation text");
    assert.equal(accepted.record.decision, "accepted");
    assert.equal(accepted.record.modified_response, null);
    assert.equal(rejected.record.decision, "rejected");
    assert.equal(rejected.record.modified_response, null);
    assert.equal(modified.record.decision, "modified");
    assert.equal(modified.record.modified_response, "Edited reviewer response");
    assert.equal(modified.originalRecommendation, recommendation);
    assert.notEqual(modified.record.modified_response, recommendation);
  });

  it("keys decisions by run id and finding id", () => {
    const indexed = indexReviewDecisions([
      review({ run_id: "run-a", finding_id: "finding-1", decision: "accepted" }),
      review({ run_id: "run-b", finding_id: "finding-1", decision: "rejected" }),
      review({
        run_id: "run-a",
        finding_id: "finding-2",
        decision: "modified",
        modified_response: "Only on run A finding 2",
      }),
    ]);
    assert.equal(indexed.get(reviewDecisionKey("run-a", "finding-1"))?.decision, "accepted");
    assert.equal(indexed.get(reviewDecisionKey("run-b", "finding-1"))?.decision, "rejected");
    assert.equal(indexed.get(reviewDecisionKey("run-a", "finding-2"))?.modified_response, "Only on run A finding 2");
    assert.equal(indexed.get(reviewDecisionKey("run-b", "finding-2")), undefined);
  });

  it("merges a decision onto the dataset without rewriting finding text", () => {
    const savedFinding = finding({ id: "finding-1", sheet_job_id: "sheet-a", severity: "critical" });
    const dataset = { findings: [savedFinding], reviews: [] as FindingReviewDecision[] };
    const record = buildReviewDecisionRecord({
      ...base,
      decision: "modified",
      modifiedResponse: "Edited reviewer response",
      originalRecommendation: savedFinding.recommendation,
    }).record;
    const next = mergeReviewDecision(dataset, { ...record, id: "review-1" });
    assert.equal(next.findings[0], savedFinding);
    assert.equal(next.findings[0].recommendation, "Original recommendation text");
    assert.equal(next.reviews[0].modified_response, "Edited reviewer response");
  });
});

describe("review exports", () => {
  it("includes the decision and modified response and excludes secrets", () => {
    const saved = finding({
      id: "finding-1",
      sheet_job_id: "sheet-a",
      severity: "warning",
      recommendation: "Original recommendation text",
    });
    const otherRun = review({
      run_id: "run-other",
      finding_id: "finding-1",
      decision: "rejected",
      modified_response: "Should not leak across runs",
    });
    const savedReview = review({
      run_id: "run-1",
      finding_id: "finding-1",
      sheet_job_id: "sheet-a",
      decision: "modified",
      modified_response: "Edited reviewer response",
      decided_by: "auth-user-9f3c",
    });
    const dataset: AnalyzerRunDataset = {
      run: run(),
      jobs: [sheetJob("sheet-a", 1)],
      findings: [{
        ...saved,
        raw_metadata: { validation: "p0-validation-token", openai_request_id: "req-secret-token" },
      } as SupabaseAnalyzerFinding],
      reviews: [savedReview, otherRun],
    };
    const exported = buildSupabaseAnalyzerJsonExport(dataset, "Highland", "2026-10-22T03:00:00.000Z");
    const serialized = JSON.stringify(exported);
    const lines = reviewReportLines(exported.sheets[0].findings[0].review);
    assert.equal(exported.sheets[0].findings[0].recommendation, "Original recommendation text");
    assert.deepEqual(exported.sheets[0].findings[0].review, {
      decision: "modified",
      modifiedResponse: "Edited reviewer response",
      decidedAt: "2026-10-22T01:00:00.000Z",
    });
    assert.deepEqual(lines, [
      "Reviewer decision: Modified",
      "Reviewer response: Edited reviewer response",
    ]);
    assert.equal(serialized.includes("Edited reviewer response"), true);
    assert.equal(serialized.includes("Original recommendation text"), true);
    assert.equal(serialized.includes("Should not leak across runs"), false);
    assert.equal(serialized.includes("auth-user-9f3c"), false);
    assert.equal(serialized.includes("decided_by"), false);
    assert.equal(serialized.includes("created_by"), false);
    assert.equal(serialized.includes("p0-validation-token"), false);
    assert.equal(serialized.includes("req-secret-token"), false);
    assert.equal(serialized.includes("signed-url-token"), false);
    assert.equal(serialized.includes("gpt-4o-secret-model"), false);
    assert.equal(serialized.includes("estimated_cost"), false);
    assert.equal(lines.join("\n").includes("auth-user-9f3c"), false);
    const reportSource = readFileSync(join(__dirname, "report.ts"), "utf8");
    assert.match(reportSource, /reviewReportLines\(review\)/);
    assert.match(reportSource, /Recommended action: \$\{finding\.recommendation\}/);
  });
});

describe("review persistence migration", () => {
  it("adds a separate review table and does not rewrite finding text", () => {
    const sql = readFileSync(
      join(__dirname, "../../../supabase/migrations/20261022153000_supabase_analyzer_finding_reviews.sql"),
      "utf8",
    );
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.supabase_analyzer_finding_reviews/);
    assert.match(sql, /UNIQUE \(run_id, finding_id\)/);
    assert.match(sql, /has_project_editor_access/);
    assert.match(sql, /has_project_access/);
    assert.equal(sql.includes("UPDATE public.supabase_analyzer_findings"), false);
    assert.equal(sql.includes("code_analyzer_learning"), false);
    assert.equal(sql.includes("document_annotations"), false);
  });
});
