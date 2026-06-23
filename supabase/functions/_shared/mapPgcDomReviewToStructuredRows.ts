/**
 * PGC corrections-tab DOM rows → Montgomery Review Comments Excel structuredRows schema.
 * Mirror of scraper-service/lib/pgcDomReviewStructuredRows.js for comment-parser-agent.
 */
import type { MontgomeryPortalStructuredExcelRow } from "./mapMontgomeryStructuredRowsToDeterministic.ts";

export const PGC_REVIEW_COMMENTS_REPORT_NAME = "Plan Review - Review Comments";

export type PgcDomReviewPortalRow = {
  workflowName?: string;
  correctionId?: string;
  correctionID?: string;
  refNumber?: string;
  referenceNumber?: string;
  changemarkNumber?: string;
  department?: string;
  reviewer?: string;
  reviewerName?: string;
  datetime?: string;
  dateCreated?: string;
  cycle?: string;
  reviewCycle?: string;
  status?: string;
  statusName?: string;
  correctionType?: string;
  commentText?: string;
  comment?: string;
  responseText?: string;
  fileName?: string;
  fileUrl?: string;
  viewUrl?: string;
};

export type PgcWorkflowBucket = {
  workflowName?: string;
  rows?: PgcDomReviewPortalRow[];
  skippedStale?: boolean;
};

export type PgcDomStructuredRow = MontgomeryPortalStructuredExcelRow & {
  correctionId?: string;
  department?: string;
  responseText?: string;
  changemarkNumber?: string;
  datetime?: string;
  fileUrl?: string;
  viewUrl?: string;
};

function normCell(v: unknown): string {
  if (v == null || v === false) return "";
  return String(v).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normDiscussion(v: unknown): string {
  return String(v ?? "").replace(/\r\n|\r/g, "\n").trim();
}

export function isValidPgcDomReviewRow(row: PgcDomReviewPortalRow | null | undefined): boolean {
  if (!row || typeof row !== "object") return false;
  const ref = normCell(row.refNumber ?? row.referenceNumber);
  const comment = normDiscussion(row.commentText ?? row.comment);
  return ref.length > 0 || comment.length > 0;
}

export function mapPgcWorkflowBucketRowForPortal(
  row: PgcDomReviewPortalRow,
  workflowName?: string,
): Record<string, string> {
  return {
    workflowName: normCell(row.workflowName) || normCell(workflowName),
    correctionId: normCell(row.correctionId ?? row.correctionID),
    refNumber: normCell(row.refNumber ?? row.referenceNumber),
    changemarkNumber: normCell(row.changemarkNumber),
    department: normCell(row.department),
    reviewer: normCell(row.reviewer ?? row.reviewerName),
    datetime: normCell(row.datetime ?? row.dateCreated),
    cycle: normCell(row.cycle ?? row.reviewCycle),
    status: normCell(row.status ?? row.statusName),
    correctionType: normCell(row.correctionType),
    commentText: normDiscussion(row.commentText),
    responseText: normDiscussion(row.responseText),
    fileName: normCell(row.fileName),
    fileUrl: normCell(row.fileUrl),
    viewUrl: normCell(row.viewUrl ?? row.fileUrl),
  };
}

export function mapPgcDomRowToStructuredRow(row: PgcDomReviewPortalRow): PgcDomStructuredRow {
  const portal = mapPgcWorkflowBucketRowForPortal(row, row.workflowName);
  const refTrim = portal.refNumber.replace(/^ref\.?\s*#?\s*/i, "").trim();
  const structured: PgcDomStructuredRow = {
    ref: refTrim,
    cycle: portal.cycle,
    reviewed_by: portal.reviewer,
    type: portal.correctionType,
    filename: portal.fileName,
    discussion: portal.commentText,
    status: portal.status,
  };
  if (portal.correctionId) structured.correctionId = portal.correctionId;
  if (portal.department) structured.department = portal.department;
  if (portal.responseText) structured.responseText = portal.responseText;
  if (portal.changemarkNumber) structured.changemarkNumber = portal.changemarkNumber;
  if (portal.datetime) structured.datetime = portal.datetime;
  if (portal.fileUrl) structured.fileUrl = portal.fileUrl;
  if (portal.viewUrl) structured.viewUrl = portal.viewUrl;
  return structured;
}

export function dedupeKeyForPgcDomRow(row: PgcDomReviewPortalRow): string {
  const portal = mapPgcWorkflowBucketRowForPortal(row, row.workflowName);
  if (portal.correctionId) return `cid:${portal.correctionId}`;
  const ref = normCell(portal.refNumber);
  const cycle = normCell(portal.cycle);
  const comment = normDiscussion(portal.commentText);
  if (ref && (cycle || comment)) {
    return `ref:${ref}|cycle:${cycle}|comment:${comment.toLowerCase()}`;
  }
  const reviewer = normCell(portal.reviewer).toLowerCase();
  const file = normCell(portal.fileName).toLowerCase();
  return `text:${comment.toLowerCase()}|file:${file}|reviewer:${reviewer}`;
}

function isShowAllWorkflowBucket(bucket: PgcWorkflowBucket): boolean {
  const name = normCell(bucket?.workflowName).toLowerCase();
  return name === "show all" || name === "showall" || /\bshow\s+all\b/i.test(name);
}

export function flattenAndDedupePgcWorkflowBuckets(
  workflowBuckets: PgcWorkflowBucket[] | null | undefined,
): PgcDomReviewPortalRow[] {
  const buckets = Array.isArray(workflowBuckets) ? workflowBuckets : [];
  const showAll = buckets.find(
    (b) =>
      isShowAllWorkflowBucket(b) &&
      !b.skippedStale &&
      Array.isArray(b.rows) &&
      b.rows.length > 0,
  );

  const candidates: PgcDomReviewPortalRow[] = [];
  if (showAll) {
    for (const row of showAll.rows ?? []) {
      if (isValidPgcDomReviewRow(row)) {
        candidates.push({ ...row, workflowName: showAll.workflowName || "Show All" });
      }
    }
  } else {
    for (const bucket of buckets) {
      if (bucket?.skippedStale) continue;
      const wfName = bucket?.workflowName || "";
      for (const row of bucket.rows ?? []) {
        if (!isValidPgcDomReviewRow(row)) continue;
        candidates.push({ ...row, workflowName: wfName });
      }
    }
  }

  const out: PgcDomReviewPortalRow[] = [];
  const seen = new Set<string>();
  for (const row of candidates) {
    const key = dedupeKeyForPgcDomRow(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export function mapPgcDomRowsToStructuredRows(
  domRows: PgcDomReviewPortalRow[],
): PgcDomStructuredRow[] {
  const out: PgcDomStructuredRow[] = [];
  for (const row of domRows) {
    const mapped = mapPgcDomRowToStructuredRow(row);
    const ref = normCell(mapped.ref);
    const discussion = normDiscussion(mapped.discussion);
    if (!ref && !discussion) continue;
    if (ref && !/^\d{1,5}$/.test(ref)) continue;
    out.push(mapped);
  }
  return out;
}

export function mapPgcWorkflowBucketsToStructuredRows(
  workflowBuckets: PgcWorkflowBucket[] | null | undefined,
): PgcDomStructuredRow[] {
  return mapPgcDomRowsToStructuredRows(flattenAndDedupePgcWorkflowBuckets(workflowBuckets));
}

export function countUniquePgcDomReviewComments(
  workflowBuckets: PgcWorkflowBucket[] | null | undefined,
): number {
  return flattenAndDedupePgcWorkflowBuckets(workflowBuckets).filter(isValidPgcDomReviewRow).length;
}

export function pdfEntryHasAuthoritativeStructuredRows(pdf: {
  structuredRows?: unknown[];
  structuredRowsSource?: string;
}): boolean {
  const sr = pdf?.structuredRows;
  if (!Array.isArray(sr) || sr.length === 0) return false;
  const source = String(pdf.structuredRowsSource || "excel").trim().toLowerCase();
  return source !== "pgc-dom";
}

export function pdfEntryHasUsableReviewText(pdf: { text?: string }): boolean {
  const text = String(pdf?.text || "").trim();
  if (!text) return false;
  if (/^No data found\.?$/i.test(text)) return false;
  if (text.length < 120 && /^No data found/i.test(text) && !/\bSTATUS\b/i.test(text)) {
    return false;
  }
  if (/\bREF\s*#?\s*\d+\b/i.test(text)) return true;
  const bareRefLines = text.split(/\r?\n/).filter((l) => /^\d{1,3}$/.test(l.trim())).length;
  return bareRefLines >= 2;
}
