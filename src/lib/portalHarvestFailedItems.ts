/**
 * Collect and group retryable failed Portal Harvest artifacts (PGC-focused).
 * Sources: scrape_file_results (failed) + report PDF/Excel artifact statuses.
 * Pending items are intentionally excluded — full harvest remains a separate action.
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

export interface PortalFailedItem {
  id: string;
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
  /** Report retry identity */
  reportSlug?: string | null;
  reportName?: string | null;
  format?: "pdf" | "excel";
  liveState?: FailedItemRetryLiveState;
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
  scrapeFileResults?: ScrapeFileResult[] | null;
  folders?: PortalFolderLike[] | null;
  reportEntries?: PortalReportEntryLike[] | null;
  /** When true (default), skip pending artifacts even if present in sources. */
  excludePending?: boolean;
}

function normStatus(s: string | null | undefined): string {
  return String(s || "").trim().toLowerCase();
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

function fileFailedItemId(fileId: string, version: string, source: string): string {
  return `file:${source}:${fileId}:${version || ""}`;
}

function reportFailedItemId(
  slugOrName: string,
  format: "pdf" | "excel",
): string {
  return `report:${slugOrName}:${format}`;
}

function collectFromScrapeFileResults(
  rows: ScrapeFileResult[],
): PortalFailedItem[] {
  const out: PortalFailedItem[] = [];
  for (const row of rows) {
    if (normStatus(row.status) !== "failed") continue;
    const fileId = String(row.portal_file_id || "").trim();
    const version = String(row.file_version || "").trim();
    const folder = [row.parent_folder, row.folder_name]
      .map((x) => String(x || "").trim())
      .filter(Boolean)
      .join(" / ") || "Files";
    const failureReason =
      String(row.failure_message || row.failure_code || "Download failed").trim() ||
      "Download failed";
    const assess = assessFileRetryability({
      fileId,
      name: row.file_name,
      failureReason,
    });
    const metaRetry =
      row && typeof (row as { metadata?: { retryCount?: number } }).metadata ===
        "object"
        ? Number(
            (row as { metadata?: { retryCount?: number } }).metadata?.retryCount,
          ) || 0
        : 0;
    out.push({
      id: fileFailedItemId(fileId || row.id, version, "sfr"),
      name: String(row.file_name || fileId || "File").trim() || "File",
      folder,
      artifactType: "file",
      failureReason,
      lastAttempt: row.updated_at || row.created_at || null,
      retryCount: metaRetry,
      retryable: assess.retryable,
      notRetryableReason: assess.notRetryableReason,
      source: "scrape_file_results",
      fileId: fileId || null,
      fileVersion: version || null,
    });
  }
  return out;
}

function collectFromPortalFolders(
  folders: PortalFolderLike[],
  seenFileKeys: Set<string>,
): PortalFailedItem[] {
  const out: PortalFailedItem[] = [];
  for (const folder of folders) {
    const folderLabel = [folder.parentFolder, folder.folderName || folder.name]
      .map((x) => String(x || "").trim())
      .filter(Boolean)
      .join(" / ") || "Files";
    for (const file of folder.files || []) {
      const status = classifyPortalFileArtifactStatus(file as PortalFileLike);
      if (status !== "failed") continue;
      const fileId = String(file.fileId || "").trim();
      const version = "";
      const key = `${fileId}|${version}`;
      if (fileId && seenFileKeys.has(key)) continue;
      if (fileId) seenFileKeys.add(key);
      const failureReason =
        String(file.downloadError || file.downloadStatus || "Download failed").trim() ||
        "Download failed";
      const assess = assessFileRetryability({
        fileId,
        name: file.name,
        failureReason,
      });
      out.push({
        id: fileFailedItemId(fileId || String(file.name || "file"), version, "portal"),
        name: String(file.name || fileId || "File").trim() || "File",
        folder: folderLabel,
        artifactType: "file",
        failureReason,
        lastAttempt: file.uploadedDate ? String(file.uploadedDate) : null,
        retryCount: Number((file as { retryCount?: number }).retryCount) || 0,
        retryable: assess.retryable,
        notRetryableReason: assess.notRetryableReason,
        source: "portal_file",
        fileId: fileId || null,
        fileVersion: null,
      });
    }
  }
  return out;
}

function collectFromReportEntries(
  entries: PortalReportEntryLike[],
): PortalFailedItem[] {
  const out: PortalFailedItem[] = [];
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

      // Never include pending or successful artifacts.
      if (!st || st === "pending" || st === "discovered" || st === "queued") {
        continue;
      }
      if (isSuccessStatus(st) || (url && isSuccessStatus(st || "success"))) {
        continue;
      }
      // Include failed + not_available-with-error (shown as not retryable).
      const include =
        isFailedStatus(st) ||
        (isNotAvailableStatus(st) && (!!error || !!entry.exportUnavailable));
      if (!include) continue;

      const assess = assessReportArtifactRetryability({
        reportName,
        reportSlug: slug,
        format,
        status,
        error,
        exportUnavailable: entry.exportUnavailable,
      });
      const retries =
        format === "pdf"
          ? Number(entry.pdfRetries ?? entry.retryCount) || 0
          : Number(entry.excelRetries ?? entry.retryCount) || 0;
      out.push({
        id: reportFailedItemId(slug, format),
        name: reportName,
        folder: "Reports",
        artifactType: format,
        failureReason:
          String(error || status || `${format.toUpperCase()} export failed`).trim() ||
          `${format.toUpperCase()} export failed`,
        lastAttempt: exportedAt ? String(exportedAt) : null,
        retryCount: retries,
        retryable: assess.retryable,
        notRetryableReason: assess.notRetryableReason,
        source: "report_artifact",
        reportSlug: slug,
        reportName,
        format,
      });
    }
  }
  return out;
}

/** Collect failed harvest items. Pending artifacts are never included. */
export function collectPortalFailedItems(
  input: CollectPortalFailedItemsInput,
): PortalFailedItem[] {
  const items: PortalFailedItem[] = [];
  const sfr = input.scrapeFileResults || [];
  const fromSfr = collectFromScrapeFileResults(sfr);
  items.push(...fromSfr);

  const seenFileKeys = new Set(
    fromSfr
      .map((i) => `${String(i.fileId || "").trim()}|${String(i.fileVersion || "").trim()}`)
      .filter((k) => !k.startsWith("|")),
  );
  items.push(...collectFromPortalFolders(input.folders || [], seenFileKeys));
  items.push(...collectFromReportEntries(input.reportEntries || []));

  // Defensive: never return pending-classified portal files.
  return items.filter((item) => {
    if (item.artifactType === "file" && item.source === "portal_file") {
      return true;
    }
    return true;
  });
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
