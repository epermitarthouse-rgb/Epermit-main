/**
 * Montgomery `portal_data.tabs.reports.pdfs[].structuredRows` (Excel-derived, snake_case) → `PgcReviewCommentsRow`.
 * Used by comment-parser-agent Phase B — no PDF/text parsing.
 */
import type { PgcReviewCommentsRow } from "./pgcReviewCommentsStackedParse.ts";

/** Shape from scraper Excel parser */
export type MontgomeryPortalStructuredExcelRow = {
  ref?: string | number | null;
  cycle?: string | number | null;
  reviewed_by?: string | null;
  type?: string | null;
  filename?: string | null;
  discussion?: string | null;
  status?: string | null;
};

function cell(v: unknown): string {
  if (v == null || v === false) return "";
  if (typeof v === "number" && Number.isFinite(v)) {
    const n = Math.floor(v);
    if (Math.abs(v - n) < 1e-9 && n >= 0 && n < 2147483647) return String(n);
    return String(v);
  }
  return String(v).replace(/\s+/g, " ").trim();
}

/** Preserve intentional newlines in DISCUSSION (collapse horizontal whitespace only outside newlines poorly — keep simple trim). */
function discussionField(v: unknown): string {
  return String(v ?? "").replace(/\r\n|\r/g, "\n").trim();
}

/** Compact audit blob for persisted `originalTextBlock`. */
export function montgomeryStructuredRowToAuditBlock(row: MontgomeryPortalStructuredExcelRow): string {
  return `[montgomery:excel-row]\n${JSON.stringify(row, null, 0)}`;
}

export function mapMontgomeryStructuredRowsToPgcDeterministic(
  rows: readonly MontgomeryPortalStructuredExcelRow[],
): PgcReviewCommentsRow[] {
  const out: PgcReviewCommentsRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? {};
    const refRaw = cell(r.ref ?? (r as { REF?: unknown }).REF);
    const refTrim = refRaw.trim();
    if (!refTrim || !/^\d{1,5}$/.test(refTrim)) continue;
    const audited: MontgomeryPortalStructuredExcelRow = {
      ref: refTrim,
      cycle: cell(r.cycle),
      reviewed_by: cell(r.reviewed_by),
      type: cell(r.type),
      filename: cell(r.filename),
      discussion: discussionField(r.discussion),
      status: cell(r.status),
    };
    const rowMapped: PgcReviewCommentsRow = {
      ref: refTrim,
      cycle: String(audited.cycle ?? "").trim(),
      reviewedBy: String(audited.reviewed_by ?? "").trim(),
      dateTime: "",
      type: String(audited.type ?? "").trim(),
      filename: String(audited.filename ?? "").trim(),
      discussion: audited.discussion ?? "",
      status: String(audited.status ?? "").trim(),
      originalTextBlock: montgomeryStructuredRowToAuditBlock(audited),
    };
    out.push(rowMapped);
  }
  return out;
}
