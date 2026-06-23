"use strict";

/**
 * PGC corrections-tab DOM rows → Montgomery Review Comments Excel structuredRows schema.
 * Shared with comment-parser-agent via mirrored TS module.
 */

const PGC_REVIEW_COMMENTS_REPORT_NAME = "Plan Review - Review Comments";

function normCell(v) {
  if (v == null || v === false) return "";
  return String(v).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normDiscussion(v) {
  return String(v ?? "").replace(/\r\n|\r/g, "\n").trim();
}

/** @param {Record<string, unknown>} row */
function isValidPgcDomReviewRow(row) {
  if (!row || typeof row !== "object") return false;
  const ref = normCell(row.refNumber ?? row.referenceNumber);
  const comment = normDiscussion(row.commentText ?? row.comment);
  return ref.length > 0 || comment.length > 0;
}

/** Preserve full portal row shape (display + pipeline metadata). */
function mapPgcWorkflowBucketRowForPortal(row, workflowName) {
  const r = row && typeof row === "object" ? row : {};
  return {
    workflowName: normCell(r.workflowName) || normCell(workflowName),
    correctionId: normCell(r.correctionId ?? r.correctionID),
    refNumber: normCell(r.refNumber ?? r.referenceNumber),
    changemarkNumber: normCell(r.changemarkNumber),
    department: normCell(r.department),
    reviewer: normCell(r.reviewer ?? r.reviewerName),
    datetime: normCell(r.datetime ?? r.dateCreated),
    cycle: normCell(r.cycle ?? r.reviewCycle),
    status: normCell(r.status ?? r.statusName),
    correctionType: normCell(r.correctionType),
    commentText: normDiscussion(r.commentText),
    responseText: normDiscussion(r.responseText),
    fileName: normCell(r.fileName),
    fileUrl: normCell(r.fileUrl),
    viewUrl: normCell(r.viewUrl ?? r.fileUrl),
  };
}

/** @param {Record<string, unknown>} row */
function mapPgcDomRowToStructuredRow(row) {
  const portal = mapPgcWorkflowBucketRowForPortal(row, row.workflowName);
  const refRaw = portal.refNumber;
  const refTrim = refRaw.replace(/^ref\.?\s*#?\s*/i, "").trim();
  const structured = {
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

function dedupeKeyForPgcDomRow(row) {
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

function isShowAllWorkflowBucket(bucket) {
  const name = normCell(bucket?.workflowName).toLowerCase();
  return name === "show all" || name === "showall" || /\bshow\s+all\b/i.test(name);
}

/**
 * Prefer "Show All" bucket; otherwise flatten all buckets with dedupe.
 * @param {Array<{ workflowName?: string, rows?: unknown[], skippedStale?: boolean }>} workflowBuckets
 * @returns {Record<string, unknown>[]}
 */
function flattenAndDedupePgcWorkflowBuckets(workflowBuckets) {
  const buckets = Array.isArray(workflowBuckets) ? workflowBuckets : [];
  const showAll = buckets.find(
    (b) =>
      isShowAllWorkflowBucket(b) &&
      !b.skippedStale &&
      Array.isArray(b.rows) &&
      b.rows.length > 0,
  );
  /** @type {Record<string, unknown>[]} */
  const candidates = [];
  if (showAll) {
    for (const row of showAll.rows) {
      if (isValidPgcDomReviewRow(row)) {
        candidates.push({
          ...(row && typeof row === "object" ? row : {}),
          workflowName: showAll.workflowName || "Show All",
        });
      }
    }
  } else {
    for (const bucket of buckets) {
      if (bucket?.skippedStale) continue;
      const wfName = bucket?.workflowName || "";
      for (const row of Array.isArray(bucket?.rows) ? bucket.rows : []) {
        if (!isValidPgcDomReviewRow(row)) continue;
        candidates.push({
          ...(row && typeof row === "object" ? row : {}),
          workflowName: wfName,
        });
      }
    }
  }

  /** @type {Record<string, unknown>[]} */
  const out = [];
  const seen = new Set();
  for (const row of candidates) {
    const key = dedupeKeyForPgcDomRow(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

/**
 * @param {Array<{ workflowName?: string, rows?: unknown[], skippedStale?: boolean }>} workflowBuckets
 * @returns {Array<{ ref: string, cycle: string, reviewed_by: string, type: string, filename: string, discussion: string, status: string }>}
 */
function mapPgcDomRowsToStructuredRows(domRows) {
  /** @type {ReturnType<typeof mapPgcDomRowToStructuredRow>[]} */
  const out = [];
  for (const row of Array.isArray(domRows) ? domRows : []) {
    const mapped = mapPgcDomRowToStructuredRow(row);
    const ref = normCell(mapped.ref);
    const discussion = normDiscussion(mapped.discussion);
    if (!ref && !discussion) continue;
    if (ref && !/^\d{1,5}$/.test(ref)) continue;
    out.push(mapped);
  }
  return out;
}

/**
 * @param {Array<{ workflowName?: string, rows?: unknown[], skippedStale?: boolean }>} workflowBuckets
 */
function mapPgcWorkflowBucketsToStructuredRows(workflowBuckets) {
  const flat = flattenAndDedupePgcWorkflowBuckets(workflowBuckets);
  return mapPgcDomRowsToStructuredRows(flat);
}

function countUniquePgcDomReviewComments(workflowBuckets) {
  return flattenAndDedupePgcWorkflowBuckets(workflowBuckets).filter(isValidPgcDomReviewRow)
    .length;
}

function pdfEntryHasAuthoritativeStructuredRows(pdfEntry) {
  const sr = pdfEntry?.structuredRows;
  if (!Array.isArray(sr) || sr.length === 0) return false;
  const source = String(pdfEntry.structuredRowsSource || "excel").trim().toLowerCase();
  return source !== "pgc-dom";
}

function pdfEntryHasUsableReviewText(pdfEntry) {
  const text = String(pdfEntry?.text || "").trim();
  if (!text) return false;
  if (/^No data found\.?$/i.test(text)) return false;
  if (text.length < 120 && /^No data found/i.test(text) && !/\bSTATUS\b/i.test(text)) {
    return false;
  }
  if (/\bREF\s*#?\s*\d+\b/i.test(text)) return true;
  const bareRefLines = text.split(/\r?\n/).filter((l) => /^\d{1,3}$/.test(l.trim())).length;
  return bareRefLines >= 2;
}

function pdfEntryHasUsableReviewCommentsContent(pdfEntry) {
  return (
    pdfEntryHasAuthoritativeStructuredRows(pdfEntry) ||
    pdfEntryHasUsableReviewText(pdfEntry)
  );
}

/**
 * Attach PGC DOM structured rows to Review Comments pdf entry when Excel/PDF path is empty.
 * @param {Array<{ workflowName?: string, rows?: unknown[], skippedStale?: boolean }>} workflowBuckets
 * @param {object[]} reportsPdfs
 */
function applyPgcDomReviewCommentsBridge(workflowBuckets, reportsPdfs) {
  const pdfs = Array.isArray(reportsPdfs) ? reportsPdfs : [];
  let reviewIdx = pdfs.findIndex((p) =>
    String(p?.fileName || "")
      .toLowerCase()
      .includes("review comments"),
  );
  let reviewPdf = reviewIdx >= 0 ? pdfs[reviewIdx] : null;

  if (reviewPdf && pdfEntryHasUsableReviewCommentsContent(reviewPdf)) {
    return { applied: false, reportsPdfs: pdfs, mappedCount: 0, reviewPdf };
  }

  const mapped = mapPgcWorkflowBucketsToStructuredRows(workflowBuckets);
  if (mapped.length === 0) {
    return { applied: false, reportsPdfs: pdfs, mappedCount: 0, reviewPdf };
  }

  if (!reviewPdf) {
    reviewPdf = {
      fileName: PGC_REVIEW_COMMENTS_REPORT_NAME,
      pages: 0,
      text: "",
      info: { source: "pgc-export" },
    };
    pdfs.push(reviewPdf);
    reviewIdx = pdfs.length - 1;
  }

  pdfs[reviewIdx] = {
    ...reviewPdf,
    structuredRows: mapped,
    structuredRowsSource: "pgc-dom",
  };

  console.log(
    `[PGC][reports][dom-structured] attached Review Comments structuredRows count=${mapped.length} source=pgc-dom`,
  );

  return {
    applied: true,
    reportsPdfs: pdfs,
    mappedCount: mapped.length,
    reviewPdf: pdfs[reviewIdx],
  };
}

module.exports = {
  PGC_REVIEW_COMMENTS_REPORT_NAME,
  mapPgcWorkflowBucketRowForPortal,
  mapPgcDomRowToStructuredRow,
  flattenAndDedupePgcWorkflowBuckets,
  mapPgcDomRowsToStructuredRows,
  mapPgcWorkflowBucketsToStructuredRows,
  countUniquePgcDomReviewComments,
  pdfEntryHasAuthoritativeStructuredRows,
  pdfEntryHasUsableReviewText,
  pdfEntryHasUsableReviewCommentsContent,
  applyPgcDomReviewCommentsBridge,
  isShowAllWorkflowBucket,
  dedupeKeyForPgcDomRow,
};
