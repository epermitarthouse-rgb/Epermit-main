/**
 * Lightweight self-test for comment-parser Excel selection rules.
 * Run: deno test supabase/functions/_shared/selectReviewCommentsExcel.selftest.ts
 *
 * Mirrors selection logic in comment-parser-agent (keep in sync).
 */

import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

function isSsrsReportViewerUrl(url: string | null | undefined): boolean {
  return /ReportViewer\.aspx/i.test(String(url || ""));
}

function isStorageBackedExcelUrl(url: string | null | undefined): boolean {
  const s = String(url || "").trim();
  if (!s || isSsrsReportViewerUrl(s)) return false;
  if (/\.pdf(\?|$)/i.test(s)) return false;
  return (
    /\/storage\/v1\/object\/public\//i.test(s) ||
    /\.(xlsx|xls)(\?|$)/i.test(s) ||
    /^https?:\/\//i.test(s)
  );
}

Deno.test("rejects viewer URL and PDF-as-Excel", () => {
  assertEquals(
    isStorageBackedExcelUrl(
      "https://eplans.example/ProjectDox/ReportViewer.aspx?rs:Format=EXCELOPENXML",
    ),
    false,
  );
  assertEquals(
    isStorageBackedExcelUrl(
      "https://x.supabase.co/storage/v1/object/public/a.pdf",
    ),
    false,
  );
  assertEquals(
    isStorageBackedExcelUrl(
      "https://x.supabase.co/storage/v1/object/public/a.xlsx",
    ),
    true,
  );
});

Deno.test("COM-00317 pgc-export without excelUrl is excel missing", () => {
  const review = {
    fileName: "Plan Review - Review Comments",
    info: { source: "pgc-export" },
    excelUrl: null as string | null,
    url: "https://eplans.example/ProjectDox/ReportViewer.aspx?x=1",
    structuredRows: [] as unknown[],
  };
  const isExport =
    review.info?.source === "pgc-export" &&
    String(review.fileName).toLowerCase().includes("review comments");
  const hasExcel =
    isStorageBackedExcelUrl(review.excelUrl) ||
    (Array.isArray(review.structuredRows) && review.structuredRows.length > 0);
  assertEquals(isExport, true);
  assertEquals(hasExcel, false);
});
