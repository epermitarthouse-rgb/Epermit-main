/**
 * Portal Harvest queue/detail metrics and status derivation.
 * Pure helpers — no network I/O. Do not treat permit/portal status as harvest status.
 */

export const STALE_HARVEST_DAYS = 7;

export type ArtifactStatus =
  | "success"
  | "failed"
  | "pending"
  | "skipped"
  | "not_available";

export type HarvestQueueStatus =
  | "Synced"
  | "Awaiting First Harvest"
  | "Stale"
  | "Partial"
  | "Failed"
  | "Queued"
  | "Running"
  | "Credentials Required"
  | "Human Action Required";

export type LogicalReportStatus = "Complete" | "Partial" | "Failed" | "Pending" | "Skipped";

const SUCCESSFUL_JOB_STATUSES = new Set([
  "completed",
  "completed_with_warnings",
]);

const FAILED_JOB_STATUSES = new Set([
  "failed",
  "failed_unrecoverable",
]);

const RUNNING_JOB_STATUSES = new Set([
  "running",
  "resuming",
  "rate_limited",
]);

const AUTH_ERROR_RE =
  /credential|auth|login|password|session.?expired|unauthorized|forbidden|mfa|2fa/i;

export interface LatestScrapeJobSummary {
  id: string;
  project_id: string;
  status: string;
  created_at?: string | null;
  updated_at?: string | null;
  completed_at?: string | null;
  error_code?: string | null;
  error_user_message?: string | null;
}

export interface PortalHarvestProjectInput {
  id: string;
  credential_id?: string | null;
  portal_status?: string | null;
  last_checked_at?: string | null;
  permit_number?: string | null;
  name?: string | null;
  jurisdiction?: string | null;
  /** True when projects.portal_data IS NOT NULL (loaded separately; not from useProjects). */
  hasPortalData?: boolean;
  latestJob?: LatestScrapeJobSummary | null;
  /** Optional: artifact-level partial signal from detail view. */
  hasPartialArtifacts?: boolean;
  /** Optional: session scrape running for this project. */
  isSessionScraping?: boolean;
}

export interface PortalHarvestRow {
  projectId: string;
  linked: boolean;
  uniqueCredentialId: string | null;
  hasSuccessfulHarvest: boolean;
  lastSuccessfulHarvestAt: string | null;
  lastCheckedAt: string | null;
  lastAttemptedAt: string | null;
  daysSinceSuccessfulHarvest: number | null;
  harvestStatus: HarvestQueueStatus;
  portalStatus: string | null;
  needsAttention: boolean;
  attentionReasons: string[];
}

/** Statuses counted in the Needs Attention summary card (excludes Awaiting First Harvest). */
export const NEEDS_ATTENTION_STATUSES: HarvestQueueStatus[] = [
  "Stale",
  "Partial",
  "Failed",
  "Credentials Required",
  "Human Action Required",
];

export const ACTIVE_HARVEST_STATUSES: HarvestQueueStatus[] = ["Queued", "Running"];

export interface AttentionBreakdown {
  stale: number;
  partial: number;
  failed: number;
  credentialsRequired: number;
  humanActionRequired: number;
  queued: number;
  running: number;
}

export interface PortalHarvestSummaryMetrics {
  connectedProjects: number;
  uniqueCredentials: number;
  /** Current harvest status exactly Synced (fresh, not overridden). */
  upToDate: number;
  awaitingFirstHarvest: number;
  /** Unique union of stale/partial/failed/credentials/human-action (excludes awaiting). */
  needsAttention: number;
  /** Queued + Running — excluded from Needs Attention; part of connected reconciliation. */
  activeJobs: number;
  attentionBreakdown: AttentionBreakdown;
  /**
   * connectedProjects should equal
   * upToDate + awaitingFirstHarvest + needsAttention + activeJobs
   */
  reconciles: boolean;
}

export interface ReportArtifactInput {
  id?: string | null;
  sourceReportId?: string | null;
  reportName?: string | null;
  fileName?: string | null;
  fileSlug?: string | null;
  sourcePath?: string | null;
  scrapeRunId?: string | null;
  scrapeJobId?: string | null;
  pdfUrl?: string | null;
  excelUrl?: string | null;
  pdfDownloaded?: boolean;
  excelDownloaded?: boolean;
  exportUnavailable?: boolean;
  error?: string | null;
  pdfError?: string | null;
  excelError?: string | null;
  pdfStatus?: ArtifactStatus | null;
  excelStatus?: ArtifactStatus | null;
  logicalStatus?: LogicalReportStatus | null;
  pdfExportedAt?: string | null;
  excelExportedAt?: string | null;
}

/** SSRS ReportViewer URLs are live portal links — never count as downloaded artifacts. */
export function isSsrsReportViewerUrl(url: string | null | undefined): boolean {
  const s = String(url || "").trim();
  if (!s) return false;
  return /ReportViewer\.aspx/i.test(s);
}

/** Prefer Supabase storage public URLs for downloadable report artifacts. */
export function isStorageBackedReportUrl(url: string | null | undefined): boolean {
  const s = String(url || "").trim();
  if (!s || isSsrsReportViewerUrl(s)) return false;
  return /\/storage\/v1\/object\/public\//i.test(s) || /^https?:\/\//i.test(s);
}

export interface LogicalReport {
  key: string;
  title: string;
  status: LogicalReportStatus;
  artifacts: { format: "pdf" | "excel" | "other"; status: ArtifactStatus }[];
}

export interface ReportCompletionSummary {
  logicalReports: number;
  complete: number;
  partial: number;
  failed: number;
  pending: number;
  skipped: number;
  reportArtifactsDownloaded: number;
  reportArtifactsFailed: number;
  reportArtifactsTotal: number;
  /** True when a reliable expected logical total is known. */
  hasExpectedLogicalTotal: boolean;
  expectedLogicalTotal: number | null;
}

export interface FileCompletionSummary {
  downloaded: number;
  failed: number;
  pending: number;
  skipped: number;
  expectedTotal: number | null;
  hasExpectedTotal: boolean;
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

export function daysSince(iso: string | null | undefined, nowMs = Date.now()): number | null {
  const t = parseTime(iso);
  if (t == null) return null;
  return Math.floor((nowMs - t) / (1000 * 60 * 60 * 24));
}

export function isSuccessfulJobStatus(status: string | null | undefined): boolean {
  return SUCCESSFUL_JOB_STATUSES.has(String(status || "").trim());
}

export function isFailedJobStatus(status: string | null | undefined): boolean {
  return FAILED_JOB_STATUSES.has(String(status || "").trim());
}

export function isRunningJobStatus(status: string | null | undefined): boolean {
  return RUNNING_JOB_STATUSES.has(String(status || "").trim());
}

export function jobIndicatesCredentialFailure(job: LatestScrapeJobSummary | null | undefined): boolean {
  if (!job) return false;
  const blob = `${job.error_code || ""} ${job.error_user_message || ""}`;
  return AUTH_ERROR_RE.test(blob);
}

export function jobIndicatesHumanAction(job: LatestScrapeJobSummary | null | undefined): boolean {
  if (!job) return false;
  if (String(job.status || "").trim() === "waiting_user") return true;
  const blob = `${job.error_code || ""} ${job.error_user_message || ""}`;
  return /mfa|2fa|otp|human|manual|confirm|intervention|captcha/i.test(blob);
}

/**
 * Normalize report identity for dedupe. Strips format suffixes only — does not
 * merge genuinely different report titles.
 */
export function normalizeReportIdentity(raw: string | null | undefined): string {
  let s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!s) return "";
  s = s.replace(/\.(pdf|xlsx|xls)$/i, "");
  s = s.replace(/\s*[-–—_:]\s*(pdf|excel|xlsx|xls)\s*$/i, "");
  s = s.replace(/\s*\((pdf|excel|xlsx|xls)\)\s*$/i, "");
  return s.trim();
}

export function reportDedupeKey(input: ReportArtifactInput): string {
  const stableId = String(input.id ?? "").trim();
  if (stableId) return `id:${stableId.toLowerCase()}`;

  const sourceId = String(input.sourceReportId ?? "").trim();
  if (sourceId) return `src:${sourceId.toLowerCase()}`;

  const title = normalizeReportIdentity(
    input.reportName || input.fileName || input.fileSlug || "",
  );
  if (title) return `title:${title}`;

  const path = normalizeReportIdentity(input.sourcePath || "");
  if (path) return `path:${path}`;

  const fallbackName = normalizeReportIdentity(input.fileName || input.reportName || "");
  const run = String(input.scrapeRunId ?? "").trim().toLowerCase();
  if (fallbackName && run) return `name+run:${fallbackName}|${run}`;
  if (fallbackName) return `name:${fallbackName}`;
  return "";
}

function artifactStatusFromFlags(opts: {
  url?: string | null;
  downloaded?: boolean;
  error?: string | null;
  unavailable?: boolean;
  explicitStatus?: ArtifactStatus | null;
}): ArtifactStatus {
  if (opts.explicitStatus) return opts.explicitStatus;
  if (opts.unavailable) return "not_available";
  if (opts.error && String(opts.error).trim()) return "failed";
  const url = String(opts.url || "").trim();
  if (url && isSsrsReportViewerUrl(url)) {
    // Viewer-only links are not downloaded artifacts.
    return opts.downloaded === false ? "pending" : "pending";
  }
  if (url && isStorageBackedReportUrl(url)) return "success";
  if (opts.downloaded === true && url) return "success";
  // Local download flag without a storage URL is not harvest success.
  if (opts.downloaded === true && !url) return "pending";
  if (opts.downloaded === false && !url) return "pending";
  return "pending";
}

export function logicalReportStatusFromArtifacts(
  artifacts: { status: ArtifactStatus }[],
  requiredFormatsPresent: boolean,
): LogicalReportStatus {
  const relevant = artifacts.filter((a) => a.status !== "not_available");
  if (relevant.length === 0) {
    if (artifacts.some((a) => a.status === "skipped")) return "Skipped";
    return "Pending";
  }
  const successes = relevant.filter((a) => a.status === "success").length;
  const failures = relevant.filter((a) => a.status === "failed").length;
  const pendings = relevant.filter((a) => a.status === "pending").length;
  const skipped = relevant.filter((a) => a.status === "skipped").length;

  if (successes > 0 && (failures > 0 || (pendings > 0 && requiredFormatsPresent))) {
    return "Partial";
  }
  if (successes > 0 && failures === 0 && pendings === 0) return "Complete";
  if (successes === 0 && failures > 0) return "Failed";
  if (skipped > 0 && successes === 0 && failures === 0) return "Skipped";
  return "Pending";
}

/**
 * Prefer reportEntries; fall back to pdfs / table rows. Never sum parallel arrays.
 */
export function deriveLogicalReports(reportsTab: {
  reportEntries?: ReportArtifactInput[] | null;
  pdfs?: Array<{
    fileName?: string;
    pdfUrl?: string | null;
    excelUrl?: string | null;
    pdfPublicUrl?: string | null;
    excelPublicUrl?: string | null;
    error?: string | null;
    url?: string | null;
  }> | null;
  tables?: Array<{ rows?: Record<string, string>[] }> | null;
} | null | undefined): LogicalReport[] {
  const map = new Map<string, LogicalReport>();

  const upsert = (input: ReportArtifactInput, formats: LogicalReport["artifacts"]) => {
    const key = reportDedupeKey(input);
    if (!key) return;
    const title =
      String(input.reportName || input.fileName || input.fileSlug || key).trim() || key;
    const existing = map.get(key);
    if (!existing) {
      const status = logicalReportStatusFromArtifacts(formats, formats.length > 1);
      map.set(key, { key, title, status, artifacts: formats });
      return;
    }
    const merged = [...existing.artifacts];
    for (const f of formats) {
      const idx = merged.findIndex((m) => m.format === f.format);
      if (idx >= 0) {
        // Prefer success over pending/failed when merging duplicate sources.
        const rank: Record<ArtifactStatus, number> = {
          success: 4,
          failed: 3,
          pending: 2,
          skipped: 1,
          not_available: 0,
        };
        if (rank[f.status] > rank[merged[idx].status]) merged[idx] = f;
      } else {
        merged.push(f);
      }
    }
    existing.artifacts = merged;
    existing.status = logicalReportStatusFromArtifacts(merged, merged.length > 1);
  };

  const entries = reportsTab?.reportEntries ?? [];
  if (entries.length > 0) {
    for (const entry of entries) {
      const formats: LogicalReport["artifacts"] = [];
      // PGC / ProjectDox: every logical report expects PDF + Excel.
      const expectsBothFormats =
        entry.pdfDownloaded != null ||
        entry.excelDownloaded != null ||
        entry.pdfStatus != null ||
        entry.excelStatus != null ||
        !!entry.pdfUrl ||
        !!entry.excelUrl;
      if (expectsBothFormats || entry.pdfUrl || entry.pdfDownloaded != null) {
        formats.push({
          format: "pdf",
          status: artifactStatusFromFlags({
            url: entry.pdfUrl,
            downloaded: entry.pdfDownloaded,
            error: entry.pdfError || entry.error,
            unavailable: entry.exportUnavailable && !entry.pdfUrl && !entry.pdfDownloaded,
            explicitStatus: entry.pdfStatus ?? null,
          }),
        });
      }
      if (expectsBothFormats || entry.excelUrl || entry.excelDownloaded != null) {
        formats.push({
          format: "excel",
          status: artifactStatusFromFlags({
            url: entry.excelUrl,
            downloaded: entry.excelDownloaded,
            error: entry.excelError,
            unavailable: entry.exportUnavailable && !entry.excelUrl && !entry.excelDownloaded,
            explicitStatus: entry.excelStatus ?? null,
          }),
        });
      }
      if (formats.length === 0) {
        formats.push({
          format: "other",
          status: entry.exportUnavailable ? "not_available" : "pending",
        });
      }
      upsert(entry, formats);
      const logical = map.get(reportDedupeKey(entry));
      if (logical && entry.logicalStatus) {
        logical.status = entry.logicalStatus;
      }
    }
    return Array.from(map.values());
  }

  const pdfs = reportsTab?.pdfs ?? [];
  if (pdfs.length > 0) {
    for (const pdf of pdfs) {
      const formats: LogicalReport["artifacts"] = [];
      const pdfUrl = pdf.pdfUrl || pdf.pdfPublicUrl || pdf.url || null;
      const excelUrl = pdf.excelUrl || pdf.excelPublicUrl || null;
      if (pdfUrl) {
        formats.push({
          format: "pdf",
          status: artifactStatusFromFlags({ url: pdfUrl, error: pdf.error }),
        });
      }
      if (excelUrl) {
        formats.push({
          format: "excel",
          status: artifactStatusFromFlags({ url: excelUrl }),
        });
      }
      if (formats.length === 0) {
        formats.push({
          format: "other",
          status: pdf.error ? "failed" : "pending",
        });
      }
      upsert({ reportName: pdf.fileName, fileName: pdf.fileName, error: pdf.error }, formats);
    }
    return Array.from(map.values());
  }

  const rows = reportsTab?.tables?.[0]?.rows ?? [];
  for (const row of rows) {
    const name = row["REPORT NAME"] ?? row["Report Name"] ?? row["reportName"] ?? "";
    if (!String(name).trim()) continue;
    upsert(
      { reportName: String(name) },
      [{ format: "other", status: "pending" }],
    );
  }
  return Array.from(map.values());
}

export function summarizeReportCompletion(
  logical: LogicalReport[],
  expectedLogicalTotal?: number | null,
): ReportCompletionSummary {
  let complete = 0;
  let partial = 0;
  let failed = 0;
  let pending = 0;
  let skipped = 0;
  let reportArtifactsDownloaded = 0;
  let reportArtifactsFailed = 0;
  let reportArtifactsTotal = 0;

  for (const r of logical) {
    if (r.status === "Complete") complete += 1;
    else if (r.status === "Partial") partial += 1;
    else if (r.status === "Failed") failed += 1;
    else if (r.status === "Skipped") skipped += 1;
    else pending += 1;

    for (const a of r.artifacts) {
      if (a.status === "not_available") continue;
      reportArtifactsTotal += 1;
      if (a.status === "success") reportArtifactsDownloaded += 1;
      if (a.status === "failed") reportArtifactsFailed += 1;
    }
  }

  const hasExpected =
    expectedLogicalTotal != null &&
    Number.isFinite(expectedLogicalTotal) &&
    expectedLogicalTotal > 0;

  return {
    logicalReports: logical.length,
    complete,
    partial,
    failed,
    pending,
    skipped,
    reportArtifactsDownloaded,
    reportArtifactsFailed,
    reportArtifactsTotal,
    hasExpectedLogicalTotal: hasExpected,
    expectedLogicalTotal: hasExpected ? expectedLogicalTotal! : null,
  };
}

export function summarizeFileCompletion(input: {
  downloaded?: number;
  failed?: number;
  pending?: number;
  skipped?: number;
  expectedTotal?: number | null;
}): FileCompletionSummary {
  const downloaded = Math.max(0, input.downloaded ?? 0);
  const failed = Math.max(0, input.failed ?? 0);
  const pending = Math.max(0, input.pending ?? 0);
  const skipped = Math.max(0, input.skipped ?? 0);
  const expected =
    input.expectedTotal != null &&
    Number.isFinite(input.expectedTotal) &&
    input.expectedTotal > 0
      ? input.expectedTotal
      : null;
  // Only treat as known expected when explicitly provided (do not invent from downloaded+failed
  // unless caller passes that sum as expectedTotal).
  return {
    downloaded,
    failed,
    pending,
    skipped,
    expectedTotal: expected,
    hasExpectedTotal: expected != null,
  };
}

/** When discovery totals exist (e.g. live scrape_file_results), pass expected = downloaded+failed+pending+skipped. */
export function fileCompletionFromCounts(counts: {
  downloaded: number;
  failed: number;
  pending?: number;
  skipped?: number;
  /** When true, denominator = sum of all known buckets. */
  treatKnownBucketsAsExpected?: boolean;
}): FileCompletionSummary {
  const pending = counts.pending ?? 0;
  const skipped = counts.skipped ?? 0;
  const expected = counts.treatKnownBucketsAsExpected
    ? counts.downloaded + counts.failed + pending + skipped
    : null;
  return summarizeFileCompletion({
    downloaded: counts.downloaded,
    failed: counts.failed,
    pending,
    skipped,
    expectedTotal: expected,
  });
}

export function countSavedFiles(folders: Array<{ files?: unknown[] }> | null | undefined): number {
  return (folders ?? []).reduce((sum, f) => sum + (f.files?.length ?? 0), 0);
}

export interface PortalFileLike {
  name?: string | null;
  fileId?: string | null;
  downloadStatus?: string | null;
  downloadError?: string | null;
  publicUrl?: string | null;
  viewUrl?: string | null;
  downloadUrl?: string | null;
  fileSizeKB?: number | null;
  uploadedDate?: string | null;
  status?: string | null;
  version?: string | number | null;
  retryCount?: number | null;
}

export interface PortalFolderLike {
  name?: string | null;
  folderName?: string | null;
  parentFolder?: string | null;
  folderID?: string | number | null;
  filesCount?: number | null;
  fileCount?: number | null;
  files?: PortalFileLike[] | null;
}

export interface PortalFolderCompletion {
  folderKey: string;
  folderName: string;
  parentFolder: string | null;
  discovered: number;
  downloaded: number;
  failed: number;
  pending: number;
  skipped: number;
}

export interface PortalFilesHarvestSummary {
  foldersTotal: number;
  populatedFolders: number;
  parentFolders: number;
  discovered: number;
  downloaded: number;
  failed: number;
  pending: number;
  skipped: number;
  /** True when discovered === downloaded+failed+pending+skipped (always for classified rows). */
  reconciles: boolean;
  folders: PortalFolderCompletion[];
  /** Incomplete harvest: some success plus remaining failed/pending work. */
  isPartial: boolean;
  /** At least one durable downloaded file exists. */
  hasUsableDownloads: boolean;
}

function isStorageUrl(url: string | null | undefined): boolean {
  return /supabase\.co\/storage\//i.test(String(url || "").trim());
}

/**
 * Classify a persisted portal_data file row. Missing status + no storage URL = pending
 * (discovered but not downloaded) — never treat as success.
 */
export function classifyPortalFileArtifactStatus(
  file: PortalFileLike | null | undefined,
): ArtifactStatus {
  if (!file) return "pending";
  const st = String(file.downloadStatus || "").trim().toLowerCase();
  if (st === "ok" || st === "success" || st === "uploaded" || st === "downloaded") {
    return "success";
  }
  if (st === "failed" || st.startsWith("failed_")) return "failed";
  if (st === "activation_skipped" || st.startsWith("skipped")) return "skipped";
  if (st === "pending" || st === "discovered" || st === "queued" || st === "downloading") {
    return "pending";
  }
  if (
    isStorageUrl(file.publicUrl) ||
    isStorageUrl(file.viewUrl) ||
    isStorageUrl(file.downloadUrl)
  ) {
    return "success";
  }
  return "pending";
}

export function summarizePortalFilesFromFolders(
  folders: PortalFolderLike[] | null | undefined,
): PortalFilesHarvestSummary {
  const list = folders ?? [];
  const parents = new Set<string>();
  const folderSummaries: PortalFolderCompletion[] = [];
  let discovered = 0;
  let downloaded = 0;
  let failed = 0;
  let pending = 0;
  let skipped = 0;
  let populatedFolders = 0;

  for (const folder of list) {
    const files = folder.files ?? [];
    const parent = folder.parentFolder ? String(folder.parentFolder) : null;
    if (parent) parents.add(parent);
    const folderName = String(folder.folderName || folder.name || "Folder");
    let fDown = 0;
    let fFail = 0;
    let fPend = 0;
    let fSkip = 0;
    for (const file of files) {
      discovered += 1;
      const status = classifyPortalFileArtifactStatus(file);
      if (status === "success") {
        downloaded += 1;
        fDown += 1;
      } else if (status === "failed") {
        failed += 1;
        fFail += 1;
      } else if (status === "skipped") {
        skipped += 1;
        fSkip += 1;
      } else {
        pending += 1;
        fPend += 1;
      }
    }
    if (files.length > 0) populatedFolders += 1;
    folderSummaries.push({
      folderKey: `${parent || ""}::${folder.folderID || folderName}`,
      folderName,
      parentFolder: parent,
      discovered: files.length,
      downloaded: fDown,
      failed: fFail,
      pending: fPend,
      skipped: fSkip,
    });
  }

  const sumParts = downloaded + failed + pending + skipped;
  return {
    foldersTotal: list.length,
    populatedFolders,
    parentFolders: parents.size,
    discovered,
    downloaded,
    failed,
    pending,
    skipped,
    reconciles: discovered === sumParts,
    folders: folderSummaries,
    isPartial:
      downloaded > 0 && (failed > 0 || pending > 0),
    hasUsableDownloads: downloaded > 0,
  };
}

/** True when reports or files show incomplete required work after some success. */
export function harvestArtifactsIndicatePartial(input: {
  reportCompletion?: ReportCompletionSummary | null;
  filesSummary?: PortalFilesHarvestSummary | null;
}): boolean {
  const reports = input.reportCompletion;
  const files = input.filesSummary;
  if (
    reports &&
    (reports.partial > 0 ||
      (reports.complete > 0 && (reports.failed > 0 || reports.pending > 0)))
  ) {
    return true;
  }
  if (files?.isPartial) return true;
  // Reports all pending/failed but files partially downloaded (or vice versa).
  if (
    files &&
    files.hasUsableDownloads &&
    reports &&
    reports.logicalReports > 0 &&
    reports.complete === 0 &&
    (reports.failed > 0 || reports.pending > 0)
  ) {
    return true;
  }
  return false;
}

export function deriveLastSuccessfulHarvestAt(
  input: PortalHarvestProjectInput,
): string | null {
  const job = input.latestJob;
  if (job && isSuccessfulJobStatus(job.status)) {
    return job.completed_at || job.updated_at || job.created_at || null;
  }
  if (input.hasPortalData) {
    // Persisted portal_data is successful-harvest evidence; last_checked_at is best available timestamp.
    return input.last_checked_at || null;
  }
  return null;
}

export function hasSuccessfulHarvestEvidence(input: PortalHarvestProjectInput): boolean {
  if (input.hasPortalData) return true;
  if (input.latestJob && isSuccessfulJobStatus(input.latestJob.status)) return true;
  return false;
}

/**
 * Mutually exclusive harvest status for queue/detail.
 * Permit/portal status (Approved, Open, …) must never be returned here.
 */
export function deriveHarvestQueueStatus(
  input: PortalHarvestProjectInput,
  nowMs = Date.now(),
): HarvestQueueStatus {
  const linked = !!input.credential_id;
  const job = input.latestJob;

  if (input.isSessionScraping || (job && isRunningJobStatus(job.status))) {
    return "Running";
  }
  if (job && String(job.status).trim() === "queued") {
    return "Queued";
  }
  if (jobIndicatesHumanAction(job) || (job && String(job.status).trim() === "waiting_user")) {
    return "Human Action Required";
  }
  if (!linked || jobIndicatesCredentialFailure(job)) {
    return "Credentials Required";
  }

  const success = hasSuccessfulHarvestEvidence(input);
  const lastSuccess = deriveLastSuccessfulHarvestAt(input);
  const latestStatus = job ? String(job.status).trim() : "";

  if (job && isFailedJobStatus(latestStatus)) {
    return "Failed";
  }

  // Terminal partial outcomes (not in-progress "partial", which is Running above).
  if (
    input.hasPartialArtifacts ||
    latestStatus === "completed_with_warnings" ||
    latestStatus === "partial_external_blocker"
  ) {
    return "Partial";
  }

  if (!success) {
    return "Awaiting First Harvest";
  }

  const age = daysSince(lastSuccess, nowMs);
  if (age != null && age > STALE_HARVEST_DAYS) {
    return "Stale";
  }
  return "Synced";
}

export function buildPortalHarvestRow(
  input: PortalHarvestProjectInput,
  nowMs = Date.now(),
): PortalHarvestRow {
  const linked = !!input.credential_id;
  const hasSuccessfulHarvest = hasSuccessfulHarvestEvidence(input);
  const lastSuccessfulHarvestAt = deriveLastSuccessfulHarvestAt(input);
  const lastCheckedAt = input.last_checked_at || null;
  const lastAttemptedAt =
    input.latestJob?.updated_at ||
    input.latestJob?.created_at ||
    lastCheckedAt;
  const harvestStatus = deriveHarvestQueueStatus(input, nowMs);
  const daysSinceSuccessfulHarvest = daysSince(lastSuccessfulHarvestAt, nowMs);

  const attentionReasons: string[] = [];
  if (harvestStatus === "Stale") attentionReasons.push("stale");
  if (harvestStatus === "Failed") attentionReasons.push("failed");
  if (harvestStatus === "Partial") attentionReasons.push("partial");
  if (harvestStatus === "Credentials Required") attentionReasons.push("credentials_required");
  if (harvestStatus === "Human Action Required") attentionReasons.push("human_action_required");

  return {
    projectId: input.id,
    linked,
    uniqueCredentialId: input.credential_id || null,
    hasSuccessfulHarvest,
    lastSuccessfulHarvestAt,
    lastCheckedAt,
    lastAttemptedAt,
    daysSinceSuccessfulHarvest,
    harvestStatus,
    portalStatus: input.portal_status || null,
    needsAttention: NEEDS_ATTENTION_STATUSES.includes(harvestStatus),
    attentionReasons,
  };
}

export function summarizePortalHarvestMetrics(rows: PortalHarvestRow[]): PortalHarvestSummaryMetrics {
  const linkedRows = rows.filter((r) => r.linked);
  const credentialIds = new Set(
    linkedRows.map((r) => r.uniqueCredentialId).filter((id): id is string => !!id),
  );

  const attentionBreakdown: AttentionBreakdown = {
    stale: linkedRows.filter((r) => r.harvestStatus === "Stale").length,
    partial: linkedRows.filter((r) => r.harvestStatus === "Partial").length,
    failed: linkedRows.filter((r) => r.harvestStatus === "Failed").length,
    credentialsRequired: linkedRows.filter((r) => r.harvestStatus === "Credentials Required").length,
    humanActionRequired: linkedRows.filter((r) => r.harvestStatus === "Human Action Required")
      .length,
    queued: linkedRows.filter((r) => r.harvestStatus === "Queued").length,
    running: linkedRows.filter((r) => r.harvestStatus === "Running").length,
  };

  const upToDate = linkedRows.filter((r) => r.harvestStatus === "Synced").length;
  const awaitingFirstHarvest = linkedRows.filter(
    (r) => r.harvestStatus === "Awaiting First Harvest",
  ).length;
  const needsAttention = linkedRows.filter((r) => r.needsAttention).length;
  const activeJobs = attentionBreakdown.queued + attentionBreakdown.running;
  const connectedProjects = linkedRows.length;
  const reconciles =
    connectedProjects === upToDate + awaitingFirstHarvest + needsAttention + activeJobs;

  return {
    connectedProjects,
    uniqueCredentials: credentialIds.size,
    upToDate,
    awaitingFirstHarvest,
    needsAttention,
    activeJobs,
    attentionBreakdown,
    reconciles,
  };
}

/** Human-readable non-zero attention + active-job breakdown lines for the banner. */
export function formatAttentionBreakdownLines(breakdown: AttentionBreakdown): string[] {
  const lines: string[] = [];
  if (breakdown.stale > 0) {
    lines.push(`${breakdown.stale} stale`);
  }
  if (breakdown.partial > 0) {
    lines.push(`${breakdown.partial} partial`);
  }
  if (breakdown.failed > 0) {
    lines.push(`${breakdown.failed} failed`);
  }
  if (breakdown.credentialsRequired > 0) {
    lines.push(`${breakdown.credentialsRequired} credentials required`);
  }
  if (breakdown.humanActionRequired > 0) {
    lines.push(`${breakdown.humanActionRequired} human action required`);
  }
  if (breakdown.queued > 0) {
    lines.push(`${breakdown.queued} queued`);
  }
  if (breakdown.running > 0) {
    lines.push(`${breakdown.running} running`);
  }
  return lines;
}

export function harvestStatusTone(
  status: HarvestQueueStatus,
): "default" | "good" | "warn" | "bad" | "info" {
  switch (status) {
    case "Synced":
      return "good";
    case "Running":
    case "Queued":
      return "info";
    case "Stale":
    case "Awaiting First Harvest":
    case "Partial":
    case "Credentials Required":
    case "Human Action Required":
      return "warn";
    case "Failed":
      return "bad";
    default:
      return "default";
  }
}

export function formatReportCompletionCaption(summary: ReportCompletionSummary): {
  value: string;
  subtitle: string;
  detail?: string;
} {
  if (summary.hasExpectedLogicalTotal && summary.expectedLogicalTotal != null) {
    const complete = summary.complete;
    const total = summary.expectedLogicalTotal;
    return {
      value: `${complete} of ${total}`,
      subtitle: `${complete} of ${total} complete`,
      detail:
        summary.failed > 0
          ? `${summary.failed} failed`
          : summary.partial > 0
            ? `${summary.partial} partial`
            : undefined,
    };
  }
  if (summary.logicalReports > 0 && summary.complete < summary.logicalReports) {
    return {
      value: `${summary.complete} of ${summary.logicalReports}`,
      subtitle: `${summary.complete} of ${summary.logicalReports} complete`,
      detail: [
        summary.partial > 0 ? `${summary.partial} partial` : null,
        summary.failed > 0 ? `${summary.failed} failed` : null,
        summary.pending > 0 ? `${summary.pending} pending` : null,
        summary.reportArtifactsTotal > 0
          ? `${summary.reportArtifactsDownloaded} of ${summary.reportArtifactsTotal} artifacts downloaded`
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
    };
  }
  return {
    value: String(summary.logicalReports),
    subtitle:
      summary.logicalReports === 1
        ? "1 logical report captured"
        : `${summary.logicalReports} logical reports captured`,
    detail:
      summary.reportArtifactsTotal > summary.logicalReports
        ? `${summary.reportArtifactsDownloaded} of ${summary.reportArtifactsTotal} report artifacts downloaded`
        : summary.failed > 0
          ? `${summary.failed} failed`
          : undefined,
  };
}

export function formatFileCompletionCaption(summary: FileCompletionSummary): {
  value: string;
  subtitle: string;
  detail?: string;
} {
  if (summary.hasExpectedTotal && summary.expectedTotal != null) {
    const parts: string[] = [];
    if (summary.failed > 0) parts.push(`${summary.failed} failed`);
    if (summary.pending > 0) parts.push(`${summary.pending} pending`);
    if (summary.skipped > 0) parts.push(`${summary.skipped} skipped`);
    return {
      value: `${summary.downloaded} of ${summary.expectedTotal}`,
      subtitle:
        parts.length > 0
          ? parts.join(" · ")
          : `${summary.downloaded} files downloaded`,
      detail: parts.length > 0 ? parts.join(" · ") : undefined,
    };
  }
  return {
    value: String(summary.downloaded),
    subtitle:
      summary.failed === 0
        ? `${summary.downloaded} files downloaded`
        : `${summary.downloaded} downloaded`,
    detail: "Expected total unavailable",
  };
}

/** Index latest scrape job per project from a newest-first job list. */
export function indexLatestJobsByProject(
  jobs: LatestScrapeJobSummary[],
): Map<string, LatestScrapeJobSummary> {
  const map = new Map<string, LatestScrapeJobSummary>();
  for (const job of jobs) {
    if (!job?.project_id) continue;
    if (!map.has(job.project_id)) map.set(job.project_id, job);
  }
  return map;
}
