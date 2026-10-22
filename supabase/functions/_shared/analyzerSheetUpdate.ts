/**
 * Pure sheet-update and cancellation rules for the Supabase analyzer.
 * Code Analyzer V2 is not involved. Callers persist the result.
 */

export const ANALYZER_MAX_SHEETS = 100;
export const ANALYZER_MAX_FILE_BYTES = 15 * 1024 * 1024;
export const ANALYZER_MAX_TOTAL_BYTES = 250 * 1024 * 1024;

const UPDATEABLE_RUN = new Set([
  "uploading",
  "completed",
  "completed_with_errors",
  "cancelled",
  "failed",
]);
const WORKER_RUN = new Set(["queued", "processing"]);
const CANCELLABLE_JOB = new Set(["upload_pending", "queued", "processing"]);
const SHEET_TOKEN = /(?:^|[^A-Za-z0-9])([A-Za-z]{1,3})[\s._-]*(\d{1,4}(?:\.\d{1,2})?)(?=$|[^A-Za-z0-9])/g;
const DISCIPLINE_PREFIXES = new Set([
  "A", "C", "D", "E", "F", "G", "L", "M", "P", "Q", "S", "T",
  "AD", "DM", "EL", "EN", "EQ", "FA", "FP", "FS", "ID", "ME", "MP", "PL", "SE", "SP", "SS", "ST",
]);

export interface ExistingAnalyzerSheet {
  id: string;
  ordinal: number;
  original_file_name: string;
  file_size: number;
  detected_sheet_number: string | null;
  status: string;
}

export interface IncomingAnalyzerSheet {
  name: string;
  size: number;
  type?: string;
  replaceJobId?: string | null;
}

export type SheetPlanAction = "add" | "replace" | "resume" | "skip" | "confirm" | "reject";

export interface SheetPlanItem {
  action: SheetPlanAction;
  fileName: string;
  fileSize: number;
  jobId?: string;
  supersedeJobId?: string;
  matchedBy?: "sheet_number" | "file_name";
  existingLabel?: string;
  reason?: string;
}

export interface SheetUpdatePlan {
  items: SheetPlanItem[];
  added: number;
  replaced: number;
  resumed: number;
  skipped: number;
  needsConfirmation: boolean;
  accepted: boolean;
  mutates: boolean;
  totalSheetsAfter: number;
  totalBytesAfter: number;
  error: string | null;
}

export interface SheetMutations {
  deleteJobIds: string[];
  inserts: Array<{
    fileName: string;
    fileSize: number;
    supersedeJobId?: string;
  }>;
  resumes: Array<{
    jobId: string;
    fileName: string;
    fileSize: number;
    supersedeJobId?: string;
  }>;
  skipped: Array<{ fileName: string; reason: string }>;
}

export function cleanAnalyzerFileName(value: unknown): string {
  let cleaned = "";
  for (const char of String(value || "drawing.pdf")) {
    const code = char.charCodeAt(0);
    if (code <= 31 || code === 127) continue;
    cleaned += char === "\\" || char === "/" ? "_" : char;
  }
  return cleaned.slice(0, 240);
}

export function analyzerFileIdentity(name: string, size: number): string {
  return `${cleanAnalyzerFileName(name).trim().toLowerCase()}:${Math.trunc(size)}`;
}

export function normalizeSheetNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (normalized.length < 2) return null;
  if (!/[A-Z]/.test(normalized) || !/\d/.test(normalized)) return null;
  return normalized;
}

export function sheetNumberCandidates(fileName: string): string[] {
  const base = cleanAnalyzerFileName(fileName).replace(/\.pdf$/i, " ");
  const found: Array<{ value: string; score: number }> = [];
  for (const match of base.matchAll(SHEET_TOKEN)) {
    const letters = match[1].toUpperCase();
    const digits = match[2];
    const value = normalizeSheetNumber(`${letters}${digits}`);
    if (!value) continue;
    const digitLength = digits.replace(/\./g, "").length;
    let score = 0;
    if (DISCIPLINE_PREFIXES.has(letters)) score += 5;
    if (digitLength >= 2) score += 3;
    if (digitLength >= 3) score += 2;
    if (digitLength === 1) score -= 2;
    if (score < 3) continue;
    found.push({ value, score });
  }
  found.sort((left, right) => right.score - left.score);
  return [...new Set(found.map((item) => item.value))];
}

export function runAllowsSheetUpdate(status: string | null | undefined): boolean {
  return Boolean(status && UPDATEABLE_RUN.has(status));
}

export function runIsWorkerActive(status: string | null | undefined): boolean {
  return Boolean(status && WORKER_RUN.has(status));
}

function sheetLabel(job: ExistingAnalyzerSheet): string {
  if (job.detected_sheet_number) {
    return `${job.detected_sheet_number} (${job.original_file_name})`;
  }
  return job.original_file_name;
}

function countable(job: Pick<ExistingAnalyzerSheet, "status">): boolean {
  return job.status !== "cancelled";
}

export function nextSheetOrdinal(used: ReadonlySet<number>): number | null {
  for (let ordinal = 1; ordinal <= ANALYZER_MAX_SHEETS; ordinal += 1) {
    if (!used.has(ordinal)) return ordinal;
  }
  return null;
}

function emptyPlan(jobs: readonly ExistingAnalyzerSheet[]): SheetUpdatePlan {
  const active = jobs.filter(countable);
  return {
    items: [],
    added: 0,
    replaced: 0,
    resumed: 0,
    skipped: 0,
    needsConfirmation: false,
    accepted: true,
    mutates: false,
    totalSheetsAfter: active.length,
    totalBytesAfter: jobs.reduce((sum, job) => sum + job.file_size, 0),
    error: null,
  };
}

export function planSheetUpdate(
  jobs: readonly ExistingAnalyzerSheet[],
  incoming: readonly IncomingAnalyzerSheet[],
  options?: { confirmed?: boolean },
): SheetUpdatePlan {
  const confirmed = options?.confirmed === true;
  if (incoming.length < 1) {
    return { ...emptyPlan(jobs), accepted: false, error: "Select at least one PDF sheet" };
  }
  if (incoming.length > ANALYZER_MAX_SHEETS) {
    return {
      ...emptyPlan(jobs),
      accepted: false,
      error: `Select between 1 and ${ANALYZER_MAX_SHEETS} PDF sheets`,
    };
  }

  const items: SheetPlanItem[] = [];
  const claimed = new Set<string>();
  const seenIncoming = new Set<string>();
  let error: string | null = null;

  const claim = (jobId: string) => {
    if (claimed.has(jobId)) return false;
    claimed.add(jobId);
    return true;
  };

  for (const file of incoming) {
    const fileName = cleanAnalyzerFileName(file.name).trim() || "drawing.pdf";
    const fileSize = Number(file.size);
    const type = String(file.type || "application/pdf");
    if (!fileName.toLowerCase().endsWith(".pdf") || (file.type && type !== "application/pdf")) {
      error = `${fileName}: only individual PDF sheets are accepted`;
      items.push({ action: "reject", fileName, fileSize, reason: error });
      continue;
    }
    if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > ANALYZER_MAX_FILE_BYTES) {
      error = `${fileName}: file must be 15 MB or smaller`;
      items.push({ action: "reject", fileName, fileSize, reason: error });
      continue;
    }
    const identity = analyzerFileIdentity(fileName, fileSize);
    if (seenIncoming.has(identity)) {
      items.push({
        action: "skip",
        fileName,
        fileSize,
        reason: "duplicate file in this update",
      });
      continue;
    }
    seenIncoming.add(identity);

    const identityMatch = jobs.find((job) => analyzerFileIdentity(job.original_file_name, job.file_size) === identity);
    if (identityMatch) {
      if (identityMatch.status === "upload_pending") {
        if (!claim(identityMatch.id)) {
          items.push({
            action: "reject",
            fileName,
            fileSize,
            reason: `${fileName} matches a drawing already included in this update`,
          });
          error = `${fileName} matches a drawing already included in this update`;
          continue;
        }
        const requested = file.replaceJobId && file.replaceJobId !== identityMatch.id
          ? jobs.find((job) => job.id === file.replaceJobId)
          : undefined;
        const candidates = sheetNumberCandidates(fileName);
        const sheetMatches = jobs.filter((job) => {
          if (job.id === identityMatch.id) return false;
          const detected = normalizeSheetNumber(job.detected_sheet_number);
          return Boolean(detected && candidates.includes(detected));
        });
        const fileNameKey = fileName.trim().toLowerCase();
        const nameMatches = jobs.filter((job) => (
          job.id !== identityMatch.id
          && job.original_file_name.trim().toLowerCase() === fileNameKey
          && job.file_size !== fileSize
        ));
        const healed = sheetMatches.length === 1
          ? sheetMatches[0]
          : sheetMatches.length === 0 && nameMatches.length === 1
            ? nameMatches[0]
            : undefined;
        const supersede = requested || healed;
        if (supersede && !claim(supersede.id)) {
          error = `${fileName} matches a drawing already included in this update`;
          items.push({ action: "reject", fileName, fileSize, reason: error });
          continue;
        }
        items.push({
          action: "resume",
          fileName,
          fileSize,
          jobId: identityMatch.id,
          supersedeJobId: supersede?.id,
          existingLabel: sheetLabel(identityMatch),
          reason: "Continuing the upload already prepared for this drawing",
        });
      } else {
        items.push({
          action: "skip",
          fileName,
          fileSize,
          jobId: identityMatch.id,
          existingLabel: sheetLabel(identityMatch),
          reason: "This drawing is already in the analysis and was not changed",
        });
      }
      continue;
    }

    const candidates = sheetNumberCandidates(fileName);
    const sheetMatches = candidates.length === 0
      ? []
      : jobs.filter((job) => {
        const detected = normalizeSheetNumber(job.detected_sheet_number);
        return Boolean(detected && candidates.includes(detected));
      });
    const fileNameKey = fileName.trim().toLowerCase();
    const nameMatches = jobs.filter((job) => (
      job.original_file_name.trim().toLowerCase() === fileNameKey
      && job.file_size !== fileSize
    ));
    const matches = sheetMatches.length > 0 ? sheetMatches : nameMatches;
    const matchedBy = sheetMatches.length > 0 ? "sheet_number" as const : "file_name" as const;

    if (matches.length > 1) {
      error = `${fileName} matches more than one drawing. Rename it so only one sheet is replaced.`;
      items.push({ action: "reject", fileName, fileSize, reason: error });
      continue;
    }

    if (matches.length === 1) {
      const target = matches[0];
      if (!claim(target.id)) {
        error = `${fileName} matches a drawing already included in this update`;
        items.push({ action: "reject", fileName, fileSize, reason: error });
        continue;
      }
      const acknowledged = confirmed && file.replaceJobId === target.id;
      if (!acknowledged) {
        items.push({
          action: "confirm",
          fileName,
          fileSize,
          jobId: target.id,
          supersedeJobId: target.id,
          matchedBy,
          existingLabel: sheetLabel(target),
          reason: matchedBy === "sheet_number"
            ? `Matches sheet ${target.detected_sheet_number}`
            : "Matches an existing file name with different contents",
        });
        continue;
      }
      items.push({
        action: "replace",
        fileName,
        fileSize,
        jobId: target.id,
        supersedeJobId: target.id,
        matchedBy,
        existingLabel: sheetLabel(target),
      });
      continue;
    }

    if (file.replaceJobId) {
      error = `${fileName} was marked as a replacement, but it does not match that drawing`;
      items.push({ action: "reject", fileName, fileSize, reason: error });
      continue;
    }

    items.push({ action: "add", fileName, fileSize });
  }

  const deleteIds = new Set(
    items.flatMap((item) => {
      if (item.action === "replace" || item.action === "confirm") return item.supersedeJobId ? [item.supersedeJobId] : [];
      if (item.action === "resume" && item.supersedeJobId) return [item.supersedeJobId];
      return [];
    }),
  );
  const insertCount = items.filter((item) => item.action === "add" || item.action === "replace" || item.action === "confirm").length;
  const surviving = jobs.filter((job) => !deleteIds.has(job.id));
  const physicalAfter = surviving.length + insertCount;
  const totalSheetsAfter = surviving.filter(countable).length + insertCount;
  const removedBytes = jobs
    .filter((job) => deleteIds.has(job.id))
    .reduce((sum, job) => sum + job.file_size, 0);
  const addedBytes = items
    .filter((item) => item.action === "add" || item.action === "replace" || item.action === "confirm")
    .reduce((sum, item) => sum + item.fileSize, 0);
  const totalBytesAfter = jobs.reduce((sum, job) => sum + job.file_size, 0) - removedBytes + addedBytes;

  if (!error && physicalAfter > ANALYZER_MAX_SHEETS) {
    error = `This analysis cannot exceed ${ANALYZER_MAX_SHEETS} drawings`;
  }
  if (!error && totalSheetsAfter > ANALYZER_MAX_SHEETS) {
    error = `This analysis cannot exceed ${ANALYZER_MAX_SHEETS} drawings`;
  }
  if (!error && totalBytesAfter > ANALYZER_MAX_TOTAL_BYTES) {
    error = "Drawing set exceeds the 250 MB run limit";
  }

  const added = items.filter((item) => item.action === "add").length;
  const replaced = items.filter((item) => item.action === "replace").length;
  const awaiting = items.filter((item) => item.action === "confirm").length;
  const resumed = items.filter((item) => item.action === "resume").length;
  const skipped = items.filter((item) => item.action === "skip").length;
  const needsConfirmation = awaiting > 0 || (!confirmed && added > 0);
  const accepted = !error && !needsConfirmation && items.every((item) => item.action !== "reject");

  return {
    items,
    added,
    replaced,
    resumed,
    skipped,
    needsConfirmation,
    accepted,
    mutates: added + replaced + awaiting + items.filter((item) => item.supersedeJobId && item.action === "resume").length > 0,
    totalSheetsAfter: error ? jobs.filter(countable).length : totalSheetsAfter,
    totalBytesAfter: error ? jobs.reduce((sum, job) => sum + job.file_size, 0) : totalBytesAfter,
    error,
  };
}

export function sheetMutations(plan: SheetUpdatePlan): SheetMutations {
  return {
    deleteJobIds: plan.items.flatMap((item) => (
      item.action === "replace" && item.supersedeJobId ? [item.supersedeJobId] : []
    )),
    inserts: plan.items.flatMap((item) => (
      item.action === "add" || item.action === "replace"
        ? [{
          fileName: item.fileName,
          fileSize: item.fileSize,
          supersedeJobId: item.action === "replace" ? item.supersedeJobId : undefined,
        }]
        : []
    )),
    resumes: plan.items.flatMap((item) => (
      item.action === "resume" && item.jobId
        ? [{
          jobId: item.jobId,
          fileName: item.fileName,
          fileSize: item.fileSize,
          supersedeJobId: item.supersedeJobId,
        }]
        : []
    )),
    skipped: plan.items.flatMap((item) => (
      item.action === "skip" ? [{ fileName: item.fileName, reason: item.reason || "Skipped" }] : []
    )),
  };
}

export function applySheetMutations<T extends ExistingAnalyzerSheet>(
  jobs: readonly T[],
  mutations: SheetMutations,
  createId: () => string,
): T[] {
  const deleteIds = new Set([
    ...mutations.deleteJobIds,
    ...mutations.inserts.flatMap((item) => item.supersedeJobId ? [item.supersedeJobId] : []),
    ...mutations.resumes.flatMap((item) => item.supersedeJobId ? [item.supersedeJobId] : []),
  ]);
  const next = jobs.filter((job) => !deleteIds.has(job.id));
  const used = new Set(next.map((job) => job.ordinal));
  for (const insert of mutations.inserts) {
    const ordinal = nextSheetOrdinal(used);
    if (ordinal == null) throw new Error("This analysis cannot exceed 100 drawings");
    used.add(ordinal);
    next.push({
      id: createId(),
      ordinal,
      original_file_name: cleanAnalyzerFileName(insert.fileName),
      file_size: insert.fileSize,
      detected_sheet_number: null,
      status: "upload_pending",
    } as T);
  }
  return next;
}

export function countPersistedSheets(jobs: readonly Pick<ExistingAnalyzerSheet, "status">[]) {
  return {
    total: jobs.filter(countable).length,
    queued: jobs.filter((job) => job.status === "queued").length,
    processing: jobs.filter((job) => job.status === "processing").length,
    completed: jobs.filter((job) => job.status === "completed").length,
    failed: jobs.filter((job) => job.status === "failed").length,
    cancelled: jobs.filter((job) => job.status === "cancelled").length,
    uploadPending: jobs.filter((job) => job.status === "upload_pending").length,
  };
}

export interface UpdateConfirmationCopy {
  title: "Update Analysis";
  confirmLabel: "Update Analysis";
  cancelLabel: "Cancel";
  intro: string;
  adds: string[];
  replacements: string[];
  skipped: string[];
}

export function updateConfirmationCopy(plan: SheetUpdatePlan): UpdateConfirmationCopy {
  return {
    title: "Update Analysis",
    confirmLabel: "Update Analysis",
    cancelLabel: "Cancel",
    intro: "Completed drawings that are not replaced stay in this analysis. Only the new or replaced PDFs are analyzed again.",
    adds: plan.items
      .filter((item) => item.action === "add")
      .map((item) => item.fileName),
    replacements: plan.items
      .filter((item) => item.action === "confirm" || item.action === "replace")
      .map((item) => `Replace ${item.existingLabel || "the existing drawing"} with ${item.fileName}. Findings for that sheet will be superseded.`),
    skipped: plan.items
      .filter((item) => item.action === "skip")
      .map((item) => `${item.fileName} is already in this analysis and was not changed.`),
  };
}

export interface AnalyzerActionPresentation {
  primaryLabel: "Analyze for Compliance" | "Update Analysis" | "Processing" | "Uploading";
  primaryDisabled: boolean;
  showCancel: boolean;
  cancelLabel: "Cancel Analysis" | "Cancelling…";
  cancelDisabled: boolean;
  showRetry: boolean;
  retryDisabled: boolean;
  statusText: "Processing" | "Cancelled" | "Uploading" | null;
  lockSelection: boolean;
}

export function analyzerActionPresentation(input: {
  hasProject: boolean;
  hasRun: boolean;
  runStatus: string | null;
  fileCount: number;
  failedSheets: number;
  submitting: boolean;
  cancelling: boolean;
}): AnalyzerActionPresentation {
  const workerActive = runIsWorkerActive(input.runStatus);
  const uploadActive = input.runStatus === "uploading";
  const runActive = workerActive || uploadActive;
  const cancelled = input.runStatus === "cancelled";
  const canUpdate = input.hasRun && runAllowsSheetUpdate(input.runStatus) && !workerActive;
  let primaryLabel: AnalyzerActionPresentation["primaryLabel"] = "Analyze for Compliance";
  if (input.cancelling || workerActive) primaryLabel = "Processing";
  else if (input.submitting) primaryLabel = "Uploading";
  else if (canUpdate) primaryLabel = "Update Analysis";

  return {
    primaryLabel,
    primaryDisabled: !input.hasProject
      || input.submitting
      || input.cancelling
      || workerActive
      || input.fileCount === 0,
    showCancel: runActive || input.cancelling,
    cancelLabel: input.cancelling ? "Cancelling…" : "Cancel Analysis",
    cancelDisabled: input.cancelling || input.submitting,
    showRetry: input.failedSheets > 0
      && !runActive
      && !cancelled
      && !input.submitting
      && !input.cancelling,
    retryDisabled: input.submitting || input.cancelling || workerActive,
    statusText: workerActive || input.cancelling
      ? "Processing"
      : cancelled
        ? "Cancelled"
        : uploadActive
          ? "Uploading"
          : null,
    lockSelection: input.submitting || input.cancelling || workerActive,
  };
}

export interface CancelledAnalysis<Job extends { id: string; status: string }, Finding extends { sheet_job_id: string; is_published: boolean }> {
  jobs: Array<Job & { error_code?: string | null; lease_owner?: string | null }>;
  findings: Finding[];
  cancelledJobIds: string[];
}

export function applyCancellation<
  Job extends { id: string; status: string; error_code?: string | null; lease_owner?: string | null },
  Finding extends { sheet_job_id: string; is_published: boolean },
>(jobs: readonly Job[], findings: readonly Finding[]): CancelledAnalysis<Job, Finding> {
  const cancelledJobIds: string[] = [];
  const nextJobs = jobs.map((job) => {
    if (!CANCELLABLE_JOB.has(job.status)) return job;
    cancelledJobIds.push(job.id);
    return {
      ...job,
      status: "cancelled",
      error_code: "run_cancelled",
      lease_owner: null,
    };
  });
  const cancelled = new Set(cancelledJobIds);
  const nextFindings = findings.map((finding) => (
    cancelled.has(finding.sheet_job_id)
      ? { ...finding, is_published: false }
      : finding
  ));
  return { jobs: nextJobs, findings: nextFindings, cancelledJobIds };
}

export function isClaimableAnalyzerJob(
  job: {
    status: string;
    attempt_count?: number;
    max_attempts?: number;
    leaseExpired?: boolean;
  },
  run: {
    status: string;
    cancelledAt?: string | null;
    estimatedCostUsd: number;
    budgetLimitUsd: number;
  },
): boolean {
  const ready = job.status === "queued"
    || (job.status === "processing" && job.leaseExpired === true);
  return ready
    && (job.attempt_count ?? 0) < (job.max_attempts ?? 3)
    && (run.status === "queued" || run.status === "processing")
    && !run.cancelledAt
    && run.estimatedCostUsd < run.budgetLimitUsd;
}

export function retryWouldRestart(job: { status: string; error_code?: string | null }): boolean {
  return job.status === "failed" && job.error_code !== "run_cancelled";
}
