/**
 * Report model for Supabase Code Analyzer deliverables.
 * Read-only over stored findings and reviewer decisions. Report IDs belong to one
 * report version (identified by the fingerprint); the Supabase finding UUID is the identity.
 * Stored severity is carried verbatim.
 */
import type {
  AnalyzerRunDataset,
  SupabaseAnalyzerFinding,
  SupabaseAnalyzerSheetJob,
} from "@/lib/supabaseAnalyzer/client";
import {
  displayDisciplineForSheet,
  disciplineSortIndex,
} from "@/lib/supabaseAnalyzer/disciplineDisplay";
import type { FindingReviewDecision, ReviewDecisionStatus } from "@/lib/supabaseAnalyzer/reviewDecisions";

export const ARCHITECT_REVIEW_MODEL_VERSION = "architect-review.v1";

const SEVERITY_ORDER = ["critical", "warning", "advisory"] as const;
type KnownSeverity = (typeof SEVERITY_ORDER)[number];

const SEVERITY_PREFIX: Record<KnownSeverity, string> = {
  critical: "C",
  warning: "W",
  advisory: "A",
};
const UNKNOWN_SEVERITY_PREFIX = "U";

export interface ReportSheetRef {
  jobId: string;
  ordinal: number | null;
  sheetNumber: string | null;
  sheetTitle: string | null;
  fileName: string | null;
  discipline: string;
}

export interface ReportFindingReview {
  decision: ReviewDecisionStatus;
  modifiedResponse: string | null;
  decidedAt: string;
}

export interface ReportFinding {
  /** Report-version-specific label such as C-001. Not a permanent identity. */
  reportId: string;
  /** Immutable Supabase finding UUID. */
  findingId: string;
  runId: string;
  sheetJobId: string;
  findingIndex: number;
  /** 1-based position in sheet order across the run (matches the sheet-ordered PDF). */
  sourceSequence: number;
  /** Stored severity, unchanged. */
  severity: string;
  category: string;
  title: string;
  observation: string;
  drawingEvidence: string;
  drawingLocation: string | null;
  codeReference: string | null;
  /** Stored recommendation, unchanged. */
  recommendation: string;
  provenanceStatus: string;
  verificationStatus: string;
  codeEdition: string;
  sheet: ReportSheetRef;
  review: ReportFindingReview | null;
  /** Rejected findings are withdrawn from client deliverables and keep their report ID. */
  clientStatus: "included" | "withdrawn";
  /** Reviewer response for modified findings; otherwise the stored recommendation. */
  presentedRecommendation: string;
  recommendationRevised: boolean;
}

export interface ReportSeverityTotals {
  all: number;
  critical: number;
  warning: number;
  advisory: number;
  other: number;
}

export interface ReportInventoryRow {
  discipline: string;
  sheets: number;
  critical: number;
  warning: number;
  advisory: number;
  other: number;
  total: number;
}

export type ReportCoverageOutcome = "findings" | "no_findings" | "failed" | "cancelled" | "pending";

export interface ReportCoverageRow extends ReportSheetRef {
  status: string;
  findingCount: number;
  outcome: ReportCoverageOutcome;
}

export interface ArchitectReviewModel {
  modelVersion: typeof ARCHITECT_REVIEW_MODEL_VERSION;
  runId: string;
  runStatus: string;
  /** False while sheets are pending or the run did not finish; deliverables must be marked draft. */
  isFinal: boolean;
  /** Every published finding in report order, including withdrawn ones. */
  findings: ReportFinding[];
  clientFindings: ReportFinding[];
  withdrawnFindings: ReportFinding[];
  reportIdByFindingId: ReadonlyMap<string, string>;
  totals: {
    published: ReportSeverityTotals;
    client: ReportSeverityTotals;
    withdrawn: number;
  };
  /** Discipline × severity counts of client findings; sheet counts cover every sheet in the run. */
  inventory: ReportInventoryRow[];
  inventoryTotal: ReportInventoryRow;
  coverage: ReportCoverageRow[];
  /** Data conditions a reviewer should see, such as an unrecognized stored severity. */
  integrityIssues: string[];
}

function knownSeverity(value: string): KnownSeverity | null {
  return (SEVERITY_ORDER as readonly string[]).includes(value) ? (value as KnownSeverity) : null;
}

function severityRank(value: string): number {
  const known = knownSeverity(value);
  return known ? SEVERITY_ORDER.indexOf(known) : SEVERITY_ORDER.length;
}

function emptyTotals(): ReportSeverityTotals {
  return { all: 0, critical: 0, warning: 0, advisory: 0, other: 0 };
}

function addToTotals(totals: ReportSeverityTotals, severity: string) {
  totals.all += 1;
  const known = knownSeverity(severity);
  if (known) totals[known] += 1;
  else totals.other += 1;
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function sheetRef(job: SupabaseAnalyzerSheetJob | undefined, jobId: string): ReportSheetRef {
  if (!job) {
    return { jobId, ordinal: null, sheetNumber: null, sheetTitle: null, fileName: null, discipline: "Unassigned sheet" };
  }
  return {
    jobId: job.id,
    ordinal: job.ordinal,
    sheetNumber: job.detected_sheet_number || null,
    sheetTitle: job.detected_sheet_title || null,
    fileName: job.original_file_name || null,
    discipline: displayDisciplineForSheet(job).display,
  };
}

function coverageOutcome(status: string, findingCount: number): ReportCoverageOutcome {
  if (status === "completed") return findingCount > 0 ? "findings" : "no_findings";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  return "pending";
}

function idWidth(count: number): number {
  return Math.max(3, String(count).length);
}

function sortInventory(rows: ReportInventoryRow[]): ReportInventoryRow[] {
  return rows.sort(
    (left, right) => disciplineSortIndex(left.discipline) - disciplineSortIndex(right.discipline)
      || compareText(left.discipline, right.discipline),
  );
}

export function buildArchitectReviewModel(dataset: AnalyzerRunDataset): ArchitectReviewModel {
  const { run } = dataset;
  const integrityIssues: string[] = [];
  const jobsById = new Map(dataset.jobs.map((job) => [job.id, job]));

  const seenFindingIds = new Set<string>();
  const findings: SupabaseAnalyzerFinding[] = [];
  for (const finding of dataset.findings) {
    if (finding.run_id && finding.run_id !== run.id) {
      integrityIssues.push(`Finding ${finding.id} belongs to another run and was excluded.`);
      continue;
    }
    if (seenFindingIds.has(finding.id)) {
      integrityIssues.push(`Finding ${finding.id} was returned more than once; one copy is used.`);
      continue;
    }
    seenFindingIds.add(finding.id);
    if (!jobsById.has(finding.sheet_job_id)) {
      integrityIssues.push(`Finding ${finding.id} references sheet ${finding.sheet_job_id}, which is not in this run.`);
    }
    if (!knownSeverity(finding.severity)) {
      integrityIssues.push(`Finding ${finding.id} has unrecognized stored severity "${finding.severity}"; it is shown unchanged.`);
    }
    findings.push(finding);
  }

  const reviewByFinding = new Map<string, FindingReviewDecision>();
  for (const review of dataset.reviews || []) {
    if (review.run_id !== run.id) continue;
    reviewByFinding.set(review.finding_id, review);
  }

  const ordinalOf = (finding: SupabaseAnalyzerFinding) => jobsById.get(finding.sheet_job_id)?.ordinal ?? Number.MAX_SAFE_INTEGER;
  const sheetOrder = (left: SupabaseAnalyzerFinding, right: SupabaseAnalyzerFinding) =>
    ordinalOf(left) - ordinalOf(right)
    || compareText(left.sheet_job_id, right.sheet_job_id)
    || left.finding_index - right.finding_index
    || compareText(left.id, right.id);

  const sequenceById = new Map<string, number>();
  [...findings].sort(sheetOrder).forEach((finding, index) => sequenceById.set(finding.id, index + 1));

  const reportOrder = [...findings].sort(
    (left, right) => severityRank(left.severity) - severityRank(right.severity)
      || compareText(knownSeverity(left.severity) ? "" : left.severity, knownSeverity(right.severity) ? "" : right.severity)
      || sheetOrder(left, right),
  );

  const severityCounts = new Map<string, number>();
  for (const finding of reportOrder) {
    const key = knownSeverity(finding.severity) ? finding.severity : UNKNOWN_SEVERITY_PREFIX;
    severityCounts.set(key, (severityCounts.get(key) || 0) + 1);
  }
  const issued = new Map<string, number>();

  const reportFindings: ReportFinding[] = reportOrder.map((finding) => {
    const known = knownSeverity(finding.severity);
    const counterKey = known || UNKNOWN_SEVERITY_PREFIX;
    const next = (issued.get(counterKey) || 0) + 1;
    issued.set(counterKey, next);
    const prefix = known ? SEVERITY_PREFIX[known] : UNKNOWN_SEVERITY_PREFIX;
    const reportId = `${prefix}-${String(next).padStart(idWidth(severityCounts.get(counterKey) || 0), "0")}`;

    const stored = reviewByFinding.get(finding.id);
    const review: ReportFindingReview | null = stored
      ? { decision: stored.decision, modifiedResponse: stored.modified_response, decidedAt: stored.decided_at }
      : null;
    const revised = review?.decision === "modified" && Boolean(review.modifiedResponse?.trim());

    return {
      reportId,
      findingId: finding.id,
      runId: run.id,
      sheetJobId: finding.sheet_job_id,
      findingIndex: finding.finding_index,
      sourceSequence: sequenceById.get(finding.id) || 0,
      severity: finding.severity,
      category: finding.category,
      title: finding.title,
      observation: finding.observation,
      drawingEvidence: finding.drawing_evidence,
      drawingLocation: finding.drawing_location || null,
      codeReference: finding.suggested_code_reference || null,
      recommendation: finding.recommendation,
      provenanceStatus: finding.provenance_status,
      verificationStatus: finding.verification_status,
      codeEdition: finding.code_edition,
      sheet: sheetRef(jobsById.get(finding.sheet_job_id), finding.sheet_job_id),
      review,
      clientStatus: review?.decision === "rejected" ? "withdrawn" : "included",
      presentedRecommendation: revised ? (review?.modifiedResponse as string) : finding.recommendation,
      recommendationRevised: revised,
    };
  });

  const clientFindings = reportFindings.filter((finding) => finding.clientStatus === "included");
  const withdrawnFindings = reportFindings.filter((finding) => finding.clientStatus === "withdrawn");

  const published = emptyTotals();
  for (const finding of reportFindings) addToTotals(published, finding.severity);
  const client = emptyTotals();
  for (const finding of clientFindings) addToTotals(client, finding.severity);

  const findingCountByJob = new Map<string, number>();
  for (const finding of findings) {
    findingCountByJob.set(finding.sheet_job_id, (findingCountByJob.get(finding.sheet_job_id) || 0) + 1);
  }
  const coverage: ReportCoverageRow[] = [...dataset.jobs]
    .sort((left, right) => left.ordinal - right.ordinal || compareText(left.id, right.id))
    .map((job) => {
      const findingCount = findingCountByJob.get(job.id) || 0;
      return {
        ...sheetRef(job, job.id),
        status: job.status,
        findingCount,
        outcome: coverageOutcome(job.status, findingCount),
      };
    });

  const inventoryByDiscipline = new Map<string, ReportInventoryRow>();
  const row = (discipline: string) => {
    let existing = inventoryByDiscipline.get(discipline);
    if (!existing) {
      existing = { discipline, sheets: 0, critical: 0, warning: 0, advisory: 0, other: 0, total: 0 };
      inventoryByDiscipline.set(discipline, existing);
    }
    return existing;
  };
  for (const sheet of coverage) {
    if (sheet.status === "cancelled") continue;
    row(sheet.discipline).sheets += 1;
  }
  for (const finding of clientFindings) {
    const target = row(finding.sheet.discipline);
    const known = knownSeverity(finding.severity);
    if (known) target[known] += 1;
    else target.other += 1;
    target.total += 1;
  }
  const inventory = sortInventory([...inventoryByDiscipline.values()]);
  const inventoryTotal = inventory.reduce<ReportInventoryRow>(
    (sum, item) => ({
      discipline: "Total",
      sheets: sum.sheets + item.sheets,
      critical: sum.critical + item.critical,
      warning: sum.warning + item.warning,
      advisory: sum.advisory + item.advisory,
      other: sum.other + item.other,
      total: sum.total + item.total,
    }),
    { discipline: "Total", sheets: 0, critical: 0, warning: 0, advisory: 0, other: 0, total: 0 },
  );

  const pendingSheets = coverage.some((sheet) => sheet.outcome === "pending");
  const isFinal = !pendingSheets && (run.status === "completed" || run.status === "completed_with_errors");

  return {
    modelVersion: ARCHITECT_REVIEW_MODEL_VERSION,
    runId: run.id,
    runStatus: run.status,
    isFinal,
    findings: reportFindings,
    clientFindings,
    withdrawnFindings,
    reportIdByFindingId: new Map(reportFindings.map((finding) => [finding.findingId, finding.reportId])),
    totals: { published, client, withdrawn: withdrawnFindings.length },
    inventory,
    inventoryTotal,
    coverage,
    integrityIssues,
  };
}

/**
 * Canonical content covered by the report fingerprint: run context, every sheet,
 * every finding field the report renders (keyed by UUID), and every reviewer decision record.
 */
export function architectReviewFingerprintSource(dataset: AnalyzerRunDataset): string {
  const { run } = dataset;
  const jobs = [...dataset.jobs]
    .sort((left, right) => compareText(left.id, right.id))
    .map((job) => [
      job.id,
      job.ordinal,
      job.status,
      job.original_file_name,
      job.detected_sheet_number,
      job.detected_sheet_title,
      job.discipline,
      job.analysis_summary,
    ]);
  const findings = dataset.findings
    .filter((finding) => !finding.run_id || finding.run_id === run.id)
    .sort((left, right) => compareText(left.id, right.id))
    .map((finding) => [
      finding.id,
      finding.sheet_job_id,
      finding.finding_index,
      finding.severity,
      finding.category,
      finding.title,
      finding.observation,
      finding.drawing_evidence,
      finding.drawing_location,
      finding.suggested_code_reference,
      finding.recommendation,
      finding.provenance_status,
      finding.verification_status,
      finding.code_edition,
    ]);
  const reviews = (dataset.reviews || [])
    .filter((review) => review.run_id === run.id)
    .sort((left, right) => compareText(left.finding_id, right.finding_id))
    .map((review) => [
      review.finding_id,
      review.decision,
      review.modified_response,
      review.decided_by,
      review.decided_at,
    ]);
  return JSON.stringify([
    ARCHITECT_REVIEW_MODEL_VERSION,
    [
      run.id,
      run.status,
      run.jurisdiction_label,
      run.code_edition,
      run.code_context,
      run.analysis_mode ?? null,
      run.total_sheets,
    ],
    jobs,
    findings,
    reviews,
  ]);
}

export interface ArchitectReviewFingerprint {
  /** Full SHA-256 hex digest of the canonical content. */
  digest: string;
  /** Short label for reports and the app, e.g. 3F9A-2C71-B04E. */
  label: string;
}

export async function fingerprintArchitectReview(dataset: AnalyzerRunDataset): Promise<ArchitectReviewFingerprint> {
  const bytes = new TextEncoder().encode(architectReviewFingerprintSource(dataset));
  const buffer = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const digest = [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const short = digest.slice(0, 12).toUpperCase();
  return { digest, label: `${short.slice(0, 4)}-${short.slice(4, 8)}-${short.slice(8, 12)}` };
}
