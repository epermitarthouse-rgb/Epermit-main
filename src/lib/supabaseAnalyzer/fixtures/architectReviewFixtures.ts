import fixture from "./run649fdaa6.clientPdf.json" with { type: "json" };
import type { AnalyzerRunDataset, SupabaseAnalyzerFinding, SupabaseAnalyzerRun, SupabaseAnalyzerSheetJob } from "../client.ts";
import type { FindingReviewDecision } from "../reviewDecisions.ts";

export type FixtureFinding = (typeof fixture.findings)[number];

export const RUN_ID = "649fdaa6-14b9-45b9-bd62-695166363f75";

export function run(partial: Partial<SupabaseAnalyzerRun> = {}): SupabaseAnalyzerRun {
  return {
    id: RUN_ID,
    project_id: "project-1",
    created_by: "user-1",
    status: "completed",
    jurisdiction_key: "dc",
    jurisdiction_label: "Washington D.C. (12A DCMR)",
    project_type: "Commercial (General)",
    code_edition: "2017",
    code_context: "2017 DC Construction Codes (2015 IBC base)",
    analysis_mode: "both",
    analysis_scope: null,
    source_coverage: "adoption_metadata_only",
    ai_provider: "openai",
    ai_model: "gpt-4o",
    total_sheets: 82,
    uploaded_sheets: 82,
    queued_sheets: 0,
    processing_sheets: 0,
    completed_sheets: 82,
    failed_sheets: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    estimated_cost_usd: 0,
    budget_limit_usd: 20,
    started_at: null,
    completed_at: null,
    cancelled_at: null,
    created_at: "2026-10-26T12:00:00Z",
    updated_at: "2026-10-26T12:38:04Z",
    ...partial,
  };
}

export function job(partial: Partial<SupabaseAnalyzerSheetJob> & Pick<SupabaseAnalyzerSheetJob, "id" | "ordinal">): SupabaseAnalyzerSheetJob {
  return {
    run_id: RUN_ID,
    project_id: "project-1",
    original_file_name: `sheet-${partial.ordinal}.pdf`,
    object_path: `project-1/${RUN_ID}/${partial.id}.pdf`,
    file_size: 1000,
    discipline: null,
    detected_sheet_number: null,
    detected_sheet_title: null,
    status: "completed",
    attempt_count: 1,
    max_attempts: 3,
    last_error: null,
    error_code: null,
    input_tokens: 0,
    output_tokens: 0,
    estimated_cost_usd: 0,
    analysis_summary: null,
    created_at: "2026-10-26T12:00:00Z",
    updated_at: "2026-10-26T12:00:00Z",
    ...partial,
  };
}

export function finding(
  partial: Partial<SupabaseAnalyzerFinding> & Pick<SupabaseAnalyzerFinding, "id" | "sheet_job_id" | "severity" | "finding_index">,
): SupabaseAnalyzerFinding {
  return {
    run_id: RUN_ID,
    category: "General",
    title: "Observation",
    observation: "Visible note on the sheet.",
    drawing_evidence: "Title block note.",
    drawing_location: "Title block",
    suggested_code_reference: null,
    recommendation: "Confirm with the adopted text.",
    ai_provider: "openai",
    ai_model: "gpt-4o",
    jurisdiction_key: "dc",
    code_edition: "2017",
    provenance_status: "model_generated_from_uploaded_pdf",
    verification_status: "unresolved_reference",
    created_at: "2026-10-26T12:00:00Z",
    ...partial,
  };
}

export function review(findingId: string, decision: FindingReviewDecision["decision"], extra: Partial<FindingReviewDecision> = {}): FindingReviewDecision {
  return {
    id: `review-${findingId}`,
    project_id: "project-1",
    run_id: RUN_ID,
    sheet_job_id: "unused",
    finding_id: findingId,
    decision,
    modified_response: decision === "modified" ? "Reviewer wording." : null,
    decided_at: "2026-10-27T09:00:00Z",
    decided_by: "reviewer-1",
    ...extra,
  };
}

export function uuidFor(sequence: number): string {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

/** Job ids deliberately do not sort in sheet order. */
export function jobIdFor(ordinal: number): string {
  return `job-${String((ordinal * 37) % 101).padStart(3, "0")}`;
}

export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const copy = [...items];
  let state = seed;
  for (let index = copy.length - 1; index > 0; index--) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const swap = state % (index + 1);
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

export function fixtureDataset(): { dataset: AnalyzerRunDataset; expected: Map<string, FixtureFinding> } {
  const rows = [...fixture.findings].sort((left, right) => left.sourceFinding - right.sourceFinding);
  const jobs: SupabaseAnalyzerSheetJob[] = [];
  const findings: SupabaseAnalyzerFinding[] = [];
  const expected = new Map<string, FixtureFinding>();
  let previousKey = "";
  let indexInJob = 0;
  for (const row of rows) {
    const key = `${row.sheetNumber}\u0000${row.sheetTitle}`;
    if (key !== previousKey) {
      const ordinal = jobs.length + 1;
      jobs.push(job({
        id: jobIdFor(ordinal),
        ordinal,
        discipline: row.discipline,
        detected_sheet_number: row.sheetNumber,
        detected_sheet_title: row.sheetTitle,
      }));
      previousKey = key;
      indexInJob = 0;
    }
    const id = uuidFor(row.sourceFinding);
    expected.set(id, row);
    findings.push(finding({
      id,
      sheet_job_id: jobs[jobs.length - 1].id,
      finding_index: indexInJob++,
      severity: row.severity as SupabaseAnalyzerFinding["severity"],
      category: row.discipline,
      title: row.title,
      observation: row.observation,
      drawing_evidence: row.drawingEvidence,
      drawing_location: row.drawingLocation,
      suggested_code_reference: row.codeReference,
      recommendation: row.recommendation,
    }));
  }
  return {
    dataset: { run: run({ total_sheets: jobs.length }), jobs: shuffled(jobs, 7), findings: shuffled(findings, 11), reviews: [] },
    expected,
  };
}

export function stressDataset(options: { sheets?: number; perSheet?: number; severity?: (index: number) => SupabaseAnalyzerFinding["severity"] } = {}): AnalyzerRunDataset {
  const sheets = options.sheets ?? 100;
  const perSheet = options.perSheet ?? 12;
  const severityFor = options.severity ?? ((index: number) => (index % 12 === 0 ? "critical" : index % 3 === 0 ? "warning" : "advisory"));
  const jobs: SupabaseAnalyzerSheetJob[] = [];
  const findings: SupabaseAnalyzerFinding[] = [];
  const reviews: FindingReviewDecision[] = [];
  let sequence = 0;
  for (let ordinal = 1; ordinal <= sheets; ordinal++) {
    const jobId = `stress-job-${String((ordinal * 61) % 1009).padStart(4, "0")}`;
    jobs.push(job({ id: jobId, ordinal, detected_sheet_number: `A-${ordinal}.00`, detected_sheet_title: `Sheet ${ordinal}`, discipline: "Architectural" }));
    for (let index = 0; index < perSheet; index++) {
      sequence += 1;
      const id = uuidFor(sequence);
      findings.push(finding({
        id,
        sheet_job_id: jobId,
        finding_index: index,
        severity: severityFor(sequence),
        title: `Finding ${sequence}`,
        observation: `Observation text for finding ${sequence}. `.repeat(20),
        drawing_evidence: `Evidence for finding ${sequence}. `.repeat(10),
        recommendation: `Recommendation ${sequence}. `.repeat(8),
      }));
      if (sequence % 4 === 0) {
        const decision = sequence % 12 === 0 ? "rejected" : sequence % 8 === 0 ? "modified" : "accepted";
        reviews.push(review(id, decision));
      }
    }
  }
  return {
    run: run({ total_sheets: sheets, completed_sheets: sheets, uploaded_sheets: sheets }),
    jobs: shuffled(jobs, 3),
    findings: shuffled(findings, 5),
    reviews,
  };
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}
