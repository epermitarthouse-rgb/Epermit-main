/**
 * Collect and group retryable failed Portal Harvest artifacts (PGC-focused).
 *
 * Historical scrape_file_results attempts are retained for audit/history, but the
 * UI and retry action expose **one current record per stable artifact identity**.
 * Latest attempt status wins: success removes the artifact from the failed list.
 */

import {
  classifyPortalFileArtifactStatus,
  type PortalFileLike,
  type PortalFolderLike,
} from "./portalHarvestMetrics";
import type { ScrapeFileResult } from "./scrapeFileResultTypes";

export type FailedArtifactType = "file" | "pdf" | "excel";

export type FailedItemRetryLiveState =
  | "queued"
  | "retrying"
  | "succeeded"
  | "failed"
  | "human_action_required";

export type PortalFailedItemSource =
  | "scrape_file_results"
  | "portal_file"
  | "report_artifact";

export type FailedAttemptStatus =
  | "failed"
  | "success"
  | "skipped"
  | "pending"
  | "not_available";

export interface FailedArtifactAttempt {
  status: FailedAttemptStatus;
  at: string | null;
  reason?: string | null;
  source: PortalFailedItemSource;
  fileVersion?: string | null;
  scrapeJobId?: string | null;
}

export interface PortalFailedItem {
  /** Stable UI/selection id (= identityKey). */
  id: string;
  /** Stable artifact identity used for dedupe across sources/jobs. */
  identityKey: string;
  name: string;
  folder: string;
  artifactType: FailedArtifactType;
  failureReason: string;
  lastAttempt: string | null;
  retryCount: number;
  retryable: boolean;
  notRetryableReason?: string;
  source: PortalFailedItemSource;
  /** File retry identity */
  fileId?: string | null;
  fileVersion?: string | null;
  folderId?: string | null;
  /** Report retry identity */
  reportSlug?: string | null;
  reportName?: string | null;
  format?: "pdf" | "excel";
  liveState?: FailedItemRetryLiveState;
  /** Older attempts for optional history UI (latest is the current item). */
  attempts?: FailedArtifactAttempt[];
}

export interface PortalFailedItemsGroup {
  folder: string;
  artifactType: FailedArtifactType;
  items: PortalFailedItem[];
}

export interface PortalReportEntryLike {
  fileSlug?: string | null;
  sourceReportId?: string | null;
  reportName?: string | null;
  pdfStatus?: string | null;
  excelStatus?: string | null;
  pdfError?: string | null;
  excelError?: string | null;
  pdfExportedAt?: string | null;
  excelExportedAt?: string | null;
  pdfUrl?: string | null;
  excelUrl?: string | null;
  pdfRetries?: number | null;
  excelRetries?: number | null;
  retryCount?: number | null;
  exportUnavailable?: boolean | null;
  logicalStatus?: string | null;
}

export interface CollectPortalFailedItemsInput {
  projectId?: string | null;
  scrapeFileResults?: ScrapeFileResult[] | null;
  folders?: PortalFolderLike[] | null;
  reportEntries?: PortalReportEntryLike[] | null;
  /** projects.last_checked_at — used as portal snapshot timestamp. */
  portalSnapshotAt?: string | null;
  /** When true (default), skip pending artifacts even if present in sources. */
  excludePending?: boolean;
}

function normStatus(s: string | null | undefined): string {
  return String(s || "").trim().toLowerCase();
}

function normalizeFileName(name: string | null | undefined): string {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function parseAttemptTs(value: string | null | undefined): number {
  if (!value) return 0;
  const t = Date.parse(String(value));
  return Number.isFinite(t) ? t : 0;
}

function isFailedStatus(status: string | null | undefined): boolean {
  const st = normStatus(status);
  return st === "failed" || st.startsWith("failed_");
}

function isSuccessStatus(status: string | null | undefined): boolean {
  const st = normStatus(status);
  return (
    st === "ok" ||
    st === "success" ||
    st === "uploaded" ||
    st === "downloaded" ||
    st === "complete"
  );
}

function isNotAvailableStatus(status: string | null | undefined): boolean {
  const st = normStatus(status);
  return (
    st === "not_available" ||
    st === "not available" ||
    st === "unavailable" ||
    st === "skipped" ||
    st.startsWith("skipped")
  );
}

export function assessFileRetryability(input: {
  fileId?: string | null;
  name?: string | null;
  failureReason?: string | null;
}): { retryable: boolean; notRetryableReason?: string } {
  const fileId = String(input.fileId || "").trim();
  if (!fileId) {
    return {
      retryable: false,
      notRetryableReason: "Missing portal file ID — cannot target download",
    };
  }
  const reason = String(input.failureReason || "").toLowerCase();
  if (
    /non[_-]?retryable|failed_non_retryable|human.?action|credential|login|auth|mfa|2fa/i.test(
      reason,
    )
  ) {
    return {
      retryable: false,
      notRetryableReason: "Failure requires human action or re-authentication",
    };
  }
  if (/oversiz|too.?large|storage_object_too_large/i.test(reason)) {
    return {
      retryable: false,
      notRetryableReason: "File exceeds storage size limits",
    };
  }
  return { retryable: true };
}

export function assessReportArtifactRetryability(input: {
  reportName?: string | null;
  reportSlug?: string | null;
  format: "pdf" | "excel";
  status?: string | null;
  error?: string | null;
  exportUnavailable?: boolean | null;
}): { retryable: boolean; notRetryableReason?: string } {
  if (isNotAvailableStatus(input.status)) {
    return {
      retryable: false,
      notRetryableReason: "Artifact marked Not available — not a retry target",
    };
  }
  const name = String(input.reportName || "").trim();
  const slug = String(input.reportSlug || "").trim();
  if (!name && !slug) {
    return {
      retryable: false,
      notRetryableReason: "Missing report name/slug — cannot target export",
    };
  }
  const err = String(input.error || "").toLowerCase();
  if (
    input.exportUnavailable ||
    /export_skipped_no_wflow|no_viewer_url|export_unavailable|corrections?.?404|not.?available/i.test(
      err,
    )
  ) {
    return {
      retryable: false,
      notRetryableReason:
        "Export path unavailable (missing workflow/viewer metadata)",
    };
  }
  if (/human.?action|credential|login|auth|mfa|2fa/i.test(err)) {
    return {
      retryable: false,
      notRetryableReason: "Failure requires human action or re-authentication",
    };
  }
  return { retryable: true };
}

/**
 * Stable identity for current-status dedupe.
 * Prefer projectId + fileId; reports include format; fallback folder + filename.
 */
export function failedArtifactIdentityKey(input: {
  projectId?: string | null;
  artifactType: FailedArtifactType;
  fileId?: string | null;
  folderId?: string | null;
  folder?: string | null;
  name?: string | null;
  reportSlug?: string | null;
  reportName?: string | null;
  format?: "pdf" | "excel" | null;
}): string {
  const project = String(input.projectId || "_").trim() || "_";
  if (input.artifactType === "file") {
    const fileId = String(input.fileId || "").trim();
    if (fileId) return `file:${project}:${fileId}`;
    const folderPart =
      String(input.folderId || "").trim() ||
      String(input.folder || "").trim().toLowerCase() ||
      "_";
    const namePart = normalizeFileName(input.name) || "_";
    return `file-name:${project}:${folderPart}:${namePart}`;
  }
  const slug =
    String(input.reportSlug || "").trim() ||
    String(input.reportName || "").trim() ||
    "_";
  const format = input.format || input.artifactType;
  return `report:${project}:${slug}:${format}`;
}

function attemptStatusFromScrapeRow(status: string | null | undefined): FailedAttemptStatus {
  const st = normStatus(status);
  if (st === "uploaded" || st === "success" || st === "ok") return "success";
  if (st === "failed" || st.startsWith("failed_")) return "failed";
  if (st === "skipped" || st.startsWith("skipped")) return "skipped";
  if (
    st === "not_available" ||
    st === "unavailable" ||
    st === "not available"
  ) {
    return "not_available";
  }
  return "pending";
}

function attemptStatusFromPortalFile(
  file: PortalFileLike,
): FailedAttemptStatus {
  const classified = classifyPortalFileArtifactStatus(file);
  if (classified === "success") return "success";
  if (classified === "failed") return "failed";
  if (classified === "skipped" || classified === "not_available") {
    return classified === "not_available" ? "not_available" : "skipped";
  }
  return "pending";
}

function sortAttemptsNewestFirst(
  attempts: FailedArtifactAttempt[],
): FailedArtifactAttempt[] {
  return [...attempts].sort((a, b) => {
    const dt = parseAttemptTs(b.at) - parseAttemptTs(a.at);
    if (dt !== 0) return dt;
    // Prefer scrape_file_results over portal snapshot on exact ties.
    if (a.source !== b.source) {
      if (a.source === "scrape_file_results") return -1;
      if (b.source === "scrape_file_results") return 1;
    }
    return 0;
  });
}

type MutableArtifact = {
  identityKey: string;
  artifactType: FailedArtifactType;
  name: string;
  folder: string;
  folderId?: string | null;
  fileId?: string | null;
  fileVersion?: string | null;
  reportSlug?: string | null;
  reportName?: string | null;
  format?: "pdf" | "excel";
  exportUnavailable?: boolean | null;
  attempts: FailedArtifactAttempt[];
  portalRetryCount?: number;
};

function upsertArtifact(
  map: Map<string, MutableArtifact>,
  draft: Omit<MutableArtifact, "attempts"> & {
    attempt: FailedArtifactAttempt;
  },
): void {
  const existing = map.get(draft.identityKey);
  if (!existing) {
    map.set(draft.identityKey, {
      identityKey: draft.identityKey,
      artifactType: draft.artifactType,
      name: draft.name,
      folder: draft.folder,
      folderId: draft.folderId,
      fileId: draft.fileId,
      fileVersion: draft.fileVersion,
      reportSlug: draft.reportSlug,
      reportName: draft.reportName,
      format: draft.format,
      exportUnavailable: draft.exportUnavailable,
      portalRetryCount: draft.portalRetryCount,
      attempts: [draft.attempt],
    });
    return;
  }
  existing.attempts.push(draft.attempt);
  if (draft.name) existing.name = draft.name;
  if (draft.folder) existing.folder = draft.folder;
  if (draft.folderId) existing.folderId = draft.folderId;
  if (draft.fileId) existing.fileId = draft.fileId;
  if (draft.fileVersion) existing.fileVersion = draft.fileVersion;
  if (draft.reportSlug) existing.reportSlug = draft.reportSlug;
  if (draft.reportName) existing.reportName = draft.reportName;
  if (draft.format) existing.format = draft.format;
  if (draft.portalRetryCount != null) {
    existing.portalRetryCount = Math.max(
      Number(existing.portalRetryCount) || 0,
      Number(draft.portalRetryCount) || 0,
    );
  }
  if (draft.exportUnavailable != null) {
    existing.exportUnavailable = draft.exportUnavailable;
  }
}

function collectAttemptsFromScrapeFileResults(
  map: Map<string, MutableArtifact>,
  rows: ScrapeFileResult[],
  projectId: string | null | undefined,
): void {
  for (const row of rows) {
    const fileId = String(row.portal_file_id || "").trim();
    const name = String(row.file_name || fileId || "File").trim() || "File";
    const folder =
      [row.parent_folder, row.folder_name]
        .map((x) => String(x || "").trim())
        .filter(Boolean)
        .join(" / ") || "Files";
    const identityKey = failedArtifactIdentityKey({
      projectId: projectId || row.project_id,
      artifactType: "file",
      fileId,
      folder,
      name,
    });
    const status = attemptStatusFromScrapeRow(row.status);
    // History keeps all terminal-ish attempts; pending noise is omitted.
    if (status === "pending") continue;
    upsertArtifact(map, {
      identityKey,
      artifactType: "file",
      name,
      folder,
      fileId: fileId || null,
      fileVersion: String(row.file_version || "").trim() || null,
      attempt: {
        status,
        at: row.updated_at || row.created_at || null,
        reason:
          status === "failed"
            ? String(
                row.failure_message || row.failure_code || "Download failed",
              ).trim() || "Download failed"
            : null,
        source: "scrape_file_results",
        fileVersion: String(row.file_version || "").trim() || null,
        scrapeJobId: row.scrape_job_id || null,
      },
    });
  }
}

function collectAttemptsFromPortalFolders(
  map: Map<string, MutableArtifact>,
  folders: PortalFolderLike[],
  projectId: string | null | undefined,
  portalSnapshotAt: string | null | undefined,
): void {
  for (const folder of folders) {
    const folderId = String(
      (folder as { folderID?: string | null; folderId?: string | null })
        .folderID ||
        (folder as { folderId?: string | null }).folderId ||
        "",
    ).trim();
    const folderLabel =
      [folder.parentFolder, folder.folderName || folder.name]
        .map((x) => String(x || "").trim())
        .filter(Boolean)
        .join(" / ") || "Files";
    for (const file of folder.files || []) {
      const status = attemptStatusFromPortalFile(file as PortalFileLike);
      // Portal snapshot contributes current success/failed/skipped; skip pure pending.
      if (status === "pending") continue;
      const fileId = String(file.fileId || "").trim();
      const name = String(file.name || fileId || "File").trim() || "File";
      const identityKey = failedArtifactIdentityKey({
        projectId,
        artifactType: "file",
        fileId,
        folderId,
        folder: folderLabel,
        name,
      });
      const reason =
        status === "failed"
          ? String(
              file.downloadError || file.downloadStatus || "Download failed",
            ).trim() || "Download failed"
          : null;
      const uploadedDate = file.uploadedDate
        ? String(file.uploadedDate).trim()
        : "";
      // Prefer last_checked_at / uploadedDate. Undated portal success still
      // overrides undated historical failures so recovered files leave the list.
      const attemptAt =
        portalSnapshotAt ||
        uploadedDate ||
        (status === "success" ? "9999-12-31T23:59:59.000Z" : null);
      upsertArtifact(map, {
        identityKey,
        artifactType: "file",
        name,
        folder: folderLabel,
        folderId: folderId || null,
        fileId: fileId || null,
        fileVersion:
          file.version != null ? String(file.version).trim() || null : null,
        portalRetryCount:
          Number((file as { retryCount?: number }).retryCount) || 0,
        attempt: {
          status,
          at: attemptAt,
          reason,
          source: "portal_file",
          fileVersion:
            file.version != null ? String(file.version).trim() || null : null,
        },
      });
    }
  }
}

function collectAttemptsFromReportEntries(
  map: Map<string, MutableArtifact>,
  entries: PortalReportEntryLike[],
  projectId: string | null | undefined,
  portalSnapshotAt: string | null | undefined,
): void {
  for (const entry of entries) {
    const reportName = String(entry.reportName || "").trim() || "Report";
    const slug =
      String(entry.fileSlug || entry.sourceReportId || "").trim() || reportName;
    for (const format of ["pdf", "excel"] as const) {
      const status = format === "pdf" ? entry.pdfStatus : entry.excelStatus;
      const error = format === "pdf" ? entry.pdfError : entry.excelError;
      const exportedAt =
        format === "pdf" ? entry.pdfExportedAt : entry.excelExportedAt;
      const url = format === "pdf" ? entry.pdfUrl : entry.excelUrl;
      const st = normStatus(status);
      if (!st || st === "pending" || st === "discovered" || st === "queued") {
        continue;
      }
      let attemptStatus: FailedAttemptStatus;
      if (isSuccessStatus(st) || (url && isSuccessStatus(st || "success"))) {
        attemptStatus = "success";
      } else if (isFailedStatus(st)) {
        attemptStatus = "failed";
      } else if (isNotAvailableStatus(st)) {
        attemptStatus = "not_available";
      } else {
        continue;
      }
      // Keep not_available only when there is an error signal (retry dialog history).
      if (
        attemptStatus === "not_available" &&
        !error &&
        !entry.exportUnavailable
      ) {
        continue;
      }
      const identityKey = failedArtifactIdentityKey({
        projectId,
        artifactType: format,
        reportSlug: slug,
        reportName,
        format,
      });
      upsertArtifact(map, {
        identityKey,
        artifactType: format,
        name: reportName,
        folder: "Reports",
        reportSlug: slug,
        reportName,
        format,
        exportUnavailable: entry.exportUnavailable,
        portalRetryCount:
          format === "pdf"
            ? Number(entry.pdfRetries ?? entry.retryCount) || 0
            : Number(entry.excelRetries ?? entry.retryCount) || 0,
        attempt: {
          status: attemptStatus,
          at: exportedAt || portalSnapshotAt || null,
          reason:
            attemptStatus === "failed" || attemptStatus === "not_available"
              ? String(
                  error || status || `${format.toUpperCase()} export failed`,
                ).trim() || `${format.toUpperCase()} export failed`
              : null,
          source: "report_artifact",
        },
      });
    }
  }
}

function toPortalFailedItem(artifact: MutableArtifact): PortalFailedItem | null {
  const attempts = sortAttemptsNewestFirst(artifact.attempts);
  if (attempts.length === 0) return null;
  const current = attempts[0];
  // Only current failures (and not-available-with-error) appear in the failed inventory.
  if (current.status === "success" || current.status === "skipped") {
    return null;
  }
  if (current.status === "pending") return null;
  if (current.status !== "failed" && current.status !== "not_available") {
    return null;
  }

  const failureReason =
    String(current.reason || "Download failed").trim() || "Download failed";
  const failedAttemptCount = attempts.filter((a) => a.status === "failed").length;
  const retryCount = Math.max(
    Number(artifact.portalRetryCount) || 0,
    Math.max(0, failedAttemptCount - 1),
  );

  let retryable = false;
  let notRetryableReason: string | undefined;
  if (artifact.artifactType === "file") {
    const assess = assessFileRetryability({
      fileId: artifact.fileId,
      name: artifact.name,
      failureReason,
    });
    retryable = current.status === "failed" && assess.retryable;
    notRetryableReason = assess.notRetryableReason;
    if (current.status === "not_available") {
      retryable = false;
      notRetryableReason =
        notRetryableReason || "Artifact marked Not available — not a retry target";
    }
  } else {
    const assess = assessReportArtifactRetryability({
      reportName: artifact.reportName,
      reportSlug: artifact.reportSlug,
      format: artifact.format || artifact.artifactType,
      status: current.status,
      error: failureReason,
      exportUnavailable: artifact.exportUnavailable,
    });
    retryable = current.status === "failed" && assess.retryable;
    notRetryableReason = assess.notRetryableReason;
  }

  // Prefer latest attempt's version for retry targeting.
  const latestVersion =
    current.fileVersion ||
    attempts.find((a) => a.fileVersion)?.fileVersion ||
    artifact.fileVersion ||
    null;

  return {
    id: artifact.identityKey,
    identityKey: artifact.identityKey,
    name: artifact.name,
    folder: artifact.folder,
    artifactType: artifact.artifactType,
    failureReason,
    lastAttempt: current.at,
    retryCount,
    retryable,
    notRetryableReason,
    source: current.source,
    fileId: artifact.fileId || null,
    fileVersion: latestVersion,
    folderId: artifact.folderId || null,
    reportSlug: artifact.reportSlug || null,
    reportName: artifact.reportName || null,
    format: artifact.format,
    attempts,
  };
}

/**
 * Collect current failed harvest items — one row per stable artifact identity.
 * Historical attempts remain on `item.attempts` for optional UI history.
 */
export function collectPortalFailedItems(
  input: CollectPortalFailedItemsInput,
): PortalFailedItem[] {
  const map = new Map<string, MutableArtifact>();
  const projectId = input.projectId || null;
  collectAttemptsFromScrapeFileResults(
    map,
    input.scrapeFileResults || [],
    projectId,
  );
  collectAttemptsFromPortalFolders(
    map,
    input.folders || [],
    projectId,
    input.portalSnapshotAt,
  );
  collectAttemptsFromReportEntries(
    map,
    input.reportEntries || [],
    projectId,
    input.portalSnapshotAt,
  );

  const out: PortalFailedItem[] = [];
  for (const artifact of map.values()) {
    const item = toPortalFailedItem(artifact);
    if (item) out.push(item);
  }
  return out.sort((a, b) => {
    const folderCmp = a.folder.localeCompare(b.folder);
    if (folderCmp !== 0) return folderCmp;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Shared selector for operator card + retry modal counts.
 * Always run card and modal through this (or collectPortalFailedItems + this).
 */
export function selectCurrentFailedInventory(
  input: CollectPortalFailedItemsInput,
): {
  items: PortalFailedItem[];
  counts: { total: number; retryable: number; notRetryable: number };
} {
  const items = collectPortalFailedItems(input);
  return { items, counts: countRetryableFailedItems(items) };
}

export function groupFailedItemsByFolderAndType(
  items: PortalFailedItem[],
): PortalFailedItemsGroup[] {
  const map = new Map<string, PortalFailedItemsGroup>();
  for (const item of items) {
    const key = `${item.folder}::${item.artifactType}`;
    let group = map.get(key);
    if (!group) {
      group = { folder: item.folder, artifactType: item.artifactType, items: [] };
      map.set(key, group);
    }
    group.items.push(item);
  }
  return Array.from(map.values()).sort((a, b) => {
    const folderCmp = a.folder.localeCompare(b.folder);
    if (folderCmp !== 0) return folderCmp;
    return a.artifactType.localeCompare(b.artifactType);
  });
}

export function countRetryableFailedItems(items: PortalFailedItem[]): {
  total: number;
  retryable: number;
  notRetryable: number;
} {
  let retryable = 0;
  let notRetryable = 0;
  for (const item of items) {
    if (item.retryable) retryable += 1;
    else notRetryable += 1;
  }
  return { total: items.length, retryable, notRetryable };
}

export interface PgcRetryArtifactPayload {
  files: Array<{ portalFileId: string; fileVersion?: string; fileName?: string }>;
  reports: Array<{
    fileSlug?: string;
    reportName?: string;
    formats: Array<"pdf" | "excel">;
  }>;
}

/**
 * Sync dialog checkbox selection when failed-items list updates.
 * - resetToAll: true only when the dialog first opens (default-select retryable).
 * - While open / on submit / live-state updates: never expand selection to all —
 *   only keep previously selected IDs that remain retryable.
 */
export function syncFailedItemsSelection(
  prevSelected: Iterable<string>,
  retryableIds: readonly string[],
  options: { resetToAll: boolean },
): Set<string> {
  if (options.resetToAll) {
    return new Set(retryableIds);
  }
  const valid = new Set(retryableIds);
  const next = new Set<string>();
  for (const id of prevSelected) {
    if (valid.has(id)) next.add(id);
  }
  return next;
}

/** Build scraper retry payload from selected failed items only. */
export function buildPgcRetryArtifactPayload(
  selected: PortalFailedItem[],
): PgcRetryArtifactPayload {
  const files: PgcRetryArtifactPayload["files"] = [];
  const reportMap = new Map<
    string,
    { fileSlug?: string; reportName?: string; formats: Set<"pdf" | "excel"> }
  >();

  for (const item of selected) {
    if (!item.retryable) continue;
    if (item.artifactType === "file") {
      const portalFileId = String(item.fileId || "").trim();
      if (!portalFileId) continue;
      if (files.some((f) => f.portalFileId === portalFileId)) continue;
      files.push({
        portalFileId,
        fileVersion: item.fileVersion ? String(item.fileVersion) : undefined,
        fileName: item.name,
      });
      continue;
    }
    if (item.artifactType !== "pdf" && item.artifactType !== "excel") continue;
    const key =
      String(item.reportSlug || item.reportName || "").trim() || item.id;
    let entry = reportMap.get(key);
    if (!entry) {
      entry = {
        fileSlug: item.reportSlug || undefined,
        reportName: item.reportName || undefined,
        formats: new Set(),
      };
      reportMap.set(key, entry);
    }
    entry.formats.add(item.artifactType);
  }

  return {
    files,
    reports: Array.from(reportMap.values()).map((r) => ({
      fileSlug: r.fileSlug,
      reportName: r.reportName,
      formats: Array.from(r.formats),
    })),
  };
}

/** Ensure successful / non-selected items are excluded from the retry payload. */
export function filterRetryPayloadToSelectedFailedOnly(
  payload: PgcRetryArtifactPayload,
  selectedIds: Set<string>,
  allFailed: PortalFailedItem[],
): PgcRetryArtifactPayload {
  const selected = allFailed.filter((i) => selectedIds.has(i.id) && i.retryable);
  return buildPgcRetryArtifactPayload(selected);
}

export function summarizeRetryLiveResults(
  items: Array<{ liveState?: FailedItemRetryLiveState | null }>,
): { succeeded: number; stillFailed: number; humanActionRequired: number } {
  let succeeded = 0;
  let stillFailed = 0;
  let humanActionRequired = 0;
  for (const item of items) {
    if (item.liveState === "succeeded") succeeded += 1;
    else if (item.liveState === "human_action_required") humanActionRequired += 1;
    else if (item.liveState === "failed") stillFailed += 1;
  }
  return { succeeded, stillFailed, humanActionRequired };
}

export function mapScrapeFileStatusToRetryLiveState(
  status: string | null | undefined,
): FailedItemRetryLiveState {
  const st = normStatus(status);
  if (st === "uploaded" || st === "skipped" || st === "success" || st === "ok") {
    return "succeeded";
  }
  if (st === "failed" || st.startsWith("failed_")) return "failed";
  if (st === "retrying" || st === "downloading") return "retrying";
  if (st === "waiting_user" || /human/.test(st)) return "human_action_required";
  if (st === "discovered" || st === "queued" || st === "pending") return "queued";
  return "queued";
}

export function mapReportArtifactStatusToRetryLiveState(
  status: string | null | undefined,
): FailedItemRetryLiveState {
  const st = normStatus(status);
  if (isSuccessStatus(st)) return "succeeded";
  if (isFailedStatus(st)) return "failed";
  if (st === "retrying" || st === "exporting" || st === "downloading") {
    return "retrying";
  }
  if (/human|credential|auth/.test(st)) return "human_action_required";
  return "queued";
}

/**
 * After retry, harvest is Synced only when no required failed/pending work remains.
 * Partial stays when failed or pending remain.
 */
export function harvestStatusAfterRetry(input: {
  failedRemaining: number;
  pendingRemaining: number;
  hadSuccess: boolean;
}): "Synced" | "Partial" | "Failed" {
  if (input.failedRemaining <= 0 && input.pendingRemaining <= 0) {
    return "Synced";
  }
  if (input.hadSuccess || input.failedRemaining > 0 || input.pendingRemaining > 0) {
    if (input.failedRemaining > 0 && !input.hadSuccess && input.pendingRemaining <= 0) {
      return "Failed";
    }
    return "Partial";
  }
  return "Partial";
}
