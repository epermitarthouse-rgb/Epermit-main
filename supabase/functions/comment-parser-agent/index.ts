import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import OpenAI from "https://esm.sh/openai@4.28.0";
import {
  extractMontgomeryGridRefOrder,
  parseMontgomeryGridRowsDeterministic,
  preprocessMontgomeryReviewCommentsExtractText,
} from "../_shared/montgomeryReviewCommentsExtract.ts";
import {
  extractRefSpanRows,
  parsePgcReviewComments,
  type PgcReviewCommentsRow,
} from "../_shared/pgcReviewCommentsStackedParse.ts";
import {
  mapMontgomeryStructuredRowsToPgcDeterministic,
  type MontgomeryPortalStructuredExcelRow,
} from "../_shared/mapMontgomeryStructuredRowsToDeterministic.ts";
import {
  mapPgcWorkflowBucketsToStructuredRows,
  PGC_REVIEW_COMMENTS_REPORT_NAME,
  type PgcWorkflowBucket,
} from "../_shared/mapPgcDomReviewToStructuredRows.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Reuse same output shape as parse-permit-comments
interface ParsedCommentItem {
  original_text: string;
  discipline: string;
  code_reference: string | null;
}

type ParsedCommentIngestSource = "raw_ref" | "raw_ref_staging" | "fallback_llm";

type ParsedCommentRow = {
  id: string;
  project_id?: string;
  original_text?: string | null;
  comment_number?: string | null;
  page_number?: number | null;
  status?: string | null;
  ingest_source?: string | null;
};

interface PortalPdf {
  fileName?: string;
  text?: string;
  pages?: number;
  error?: string;
  info?: { source?: string };
  /** Montgomery Phase A: Excel grid rows from scraper (`excel` source). */
  structuredRows?: MontgomeryPortalStructuredExcelRow[];
  structuredRowsSource?: string;
}

/** Keep aligned with src/lib/pgcReviewCommentsText.ts */
function normalizePgcFlattenedReviewCommentsText(raw: string): string {
  let s = String(raw || "").replace(/\r\n/g, "\n");
  s = s.replace(
    /\.pdf\s*(UnResolved|Resolved|Info\s*Only|InfoOnly)\b/gi,
    ".pdf\n$1",
  );
  s = s.replace(/\.pdf(?=[A-Za-z])/g, ".pdf\n");
  s = s.replace(/REF\s*#\s*CYCLE(?=REVIEWED)/gi, "REF # CYCLE\n");
  s = s.replace(/CYCLE(?=REVIEWED)/gi, "CYCLE\n");
  s = s.replace(/REVIEWED\s*BY(?=TYPE)/gi, "REVIEWED BY\n");
  s = s.replace(/TYPE(?=FILENAME)/gi, "TYPE\n");
  s = s.replace(/FILENAME(?=DISCUSSION)/gi, "FILENAME\n");
  s = s.replace(/DISCUSSION(?=STATUS)/gi, "DISCUSSION\n");
  s = s.replace(/STATUS(?=REF)/gi, "STATUS\n");
  s = s.replace(/REF#\s*/gi, "REF # ");
  s = s.replace(/([^\n])(?=(?:REF\s*#\s*\d+|REF\s*#\s*CYCLE))/gi, "$1\n");
  s = s.replace(
    /\b(UnResolved|Resolved|Info\s*Only|InfoOnly)\b\s*(?=(?:REF\s*#))/gi,
    "$1\n\n",
  );
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

function isPgcExportReviewCommentsPdf(p: PortalPdf): boolean {
  const src = String(p.info?.source ?? "");
  return (
    (src === "pgc-export" ||
      src === "montgomery-export" ||
      src === "howard-export") &&
    String(p.fileName ?? "").toLowerCase().includes("review comments") &&
    !String(p.fileName ?? "").toLowerCase().includes("review details") &&
    !String(p.fileName ?? "").toLowerCase().includes("routing slip")
  );
}

/** Deterministic stacked parser should be attempted on every Review Comments export. */
function shouldAttemptDeterministicStackedParse(pdf: PortalPdf): boolean {
  const name = String(pdf.fileName ?? "").toLowerCase();
  return (
    name.includes("review comments") &&
    !name.includes("review details") &&
    !name.includes("routing slip")
  );
}

function isReviewCommentsReportPdf(p: PortalPdf): boolean {
  return shouldAttemptDeterministicStackedParse(p);
}

function pdfHasParseableReviewCommentsContent(p: PortalPdf): boolean {
  const hasText = typeof p.text === "string" && p.text.trim().length > 0;
  const hasStructuredRows =
    Array.isArray(p.structuredRows) && p.structuredRows.length > 0;
  return hasText || hasStructuredRows;
}

/**
 * Match UI: stacked parse on raw text first (getReviewCommentsDisplayTextForPortal); retry on normalized if needed.
 */
function tryPgcStackedRowsRawThenNormalized(raw: string): PgcReviewCommentsRow[] | null {
  const first = parsePgcReviewComments(raw);
  if (first.ok && first.rows.length > 0) return first.rows;
  const norm = normalizePgcFlattenedReviewCommentsText(raw);
  if (norm.trim() === String(raw ?? "").trim()) return null;
  const second = parsePgcReviewComments(norm);
  if (second.ok && second.rows.length > 0) return second.rows;
  return null;
}

/** Keep ref/cycle/type/etc. on one header line so `parsePgcRawRefDisplayText` line match is stable. */
function pgcPersistSingleLineCell(v: unknown): string {
  return String(v ?? "").replace(/\r\n|\r|\n/g, " ").replace(/\s+/g, " ").trim();
}

function formatPgcDeterministicPersistedComment(
  row: PgcReviewCommentsRow,
  sourceReport: string,
): string {
  return [
    `ref: ${pgcPersistSingleLineCell(row.ref)}`,
    `cycle: ${pgcPersistSingleLineCell(row.cycle)}`,
    `reviewed_by: ${pgcPersistSingleLineCell(row.reviewedBy)}`,
    `type: ${pgcPersistSingleLineCell(row.type)}`,
    `filename: ${pgcPersistSingleLineCell(row.filename)}`,
    `full_discussion_text:`,
    row.discussion,
    `status: ${pgcPersistSingleLineCell(row.status)}`,
    `source_report: ${pgcPersistSingleLineCell(sourceReport)}`,
    `date_time: ${pgcPersistSingleLineCell(row.dateTime)}`,
    "",
    "--- original_source_block ---",
    row.originalTextBlock,
  ]
    .join("\n")
    .trim();
}

function hasLikelySourceRefRows(raw: string): boolean {
  const t = String(raw ?? "");
  if (!t.trim()) return false;
  if (/\bREF\s*#?\s*\d+\b/i.test(t)) return true;
  const lines = t.split(/\r?\n/).map((l) => l.trim());
  const bareRefLines = lines.filter((l) => /^\d{1,3}$/.test(l)).length;
  return bareRefLines >= 2;
}

function toUniqueOrdered(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const v = String(raw ?? "").trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function extractOrderedRefsFromText(raw: string): string[] {
  const refs: string[] = [];
  const text = String(raw ?? "").replace(/\r\n/g, "\n");
  const re = /\bREF\s*#?\s*(\d{1,4})\b/gi;
  let m: RegExpExecArray | null = re.exec(text);
  while (m) {
    refs.push(String(m[1] ?? "").trim());
    m = re.exec(text);
  }
  return toUniqueOrdered(refs);
}

/**
 * Stacked `splitIndexOnlyLine` can produce one-line chunks; `originalTextBlock` is then only a digit. Detect that so
 * we can prefer `extractRefSpanRows` when it has real line-anchored `REF` blocks.
 */
function pgcRowsAreHollowIndexOnlyBlocks(rows: PgcReviewCommentsRow[] | null): boolean {
  if (!rows || rows.length < 2) return false;
  return rows.every((r) => {
    const t = String(r.originalTextBlock ?? "").trim();
    return t.length > 0 && /^\d{1,4}$/.test(t);
  });
}

/**
 * Prefer full portal REF coverage: when stacked/header parse under-counts vs `REF #` lines in text,
 * use `extractRefSpanRows`. Otherwise keep the richer `tryPgc` result when it covers all markers.
 * If `try` is hollow (digit-only blocks) and `span` is not, prefer `span` when counts are adequate.
 */
function pickDeterministicPgcRows(
  rawText: string,
  tryPgcRows: PgcReviewCommentsRow[] | null,
  options?: { extractedRefCountOverride?: number },
): PgcReviewCommentsRow[] | null {
  const span = extractRefSpanRows(rawText);
  const nExtracted =
    typeof options?.extractedRefCountOverride === "number"
      ? options.extractedRefCountOverride
      : extractOrderedRefsFromText(rawText).length;
  const nSpan = span?.length ?? 0;
  const nTry = tryPgcRows?.length ?? 0;
  if (nSpan === 0 && nTry === 0) return null;

  const tryHollow = pgcRowsAreHollowIndexOnlyBlocks(tryPgcRows);
  const spanHollow = pgcRowsAreHollowIndexOnlyBlocks(span);
  const preferSpanOverHollowTry =
    tryHollow &&
    !spanHollow &&
    nSpan > 0 &&
    (nExtracted > 0 ? nSpan >= nExtracted : nSpan >= nTry);

  if (preferSpanOverHollowTry) return span!;

  if (nSpan === 0) return tryPgcRows ?? null;
  if (nTry === 0) return span;
  if (nExtracted > 0) {
    const tryOk = nTry >= nExtracted;
    const spanOk = nSpan >= nExtracted;
    if (spanOk && !tryOk) return span;
    if (tryOk && !spanOk) return tryPgcRows;
    if (spanOk && tryOk) {
      if (tryHollow && !spanHollow) return span!;
      return nTry >= nSpan ? tryPgcRows! : span!;
    }
    return nSpan > nTry ? span! : tryPgcRows!;
  }
  if (tryHollow && !spanHollow && nSpan > 0) return span!;
  return nSpan > nTry ? span! : tryPgcRows!;
}

function diffRefs(fromRefs: string[], toRefs: string[]): string[] {
  const keep = new Set(toRefs);
  return fromRefs.filter((r) => !keep.has(r));
}

function portalCommentKey(row: {
  comment_number?: string | null;
  original_text?: string | null;
}): string {
  const num = String(row.comment_number ?? "").trim();
  if (num) return `ref:${num}`;
  const refs = extractOrderedRefsFromText(String(row.original_text ?? ""));
  if (refs.length > 0) return `ref:${refs[0]}`;
  return `text:${normalizeText(String(row.original_text ?? ""))}`;
}

async function finalizePortalCommentRefresh(
  supabase: ReturnType<typeof createClient>,
  projectId: string,
): Promise<{
  previous_portal_count: number;
  new_staging_count: number;
  deleted_count: number;
  updated_count: number;
  inserted_count: number;
  final_portal_count: number;
}> {
  const portalSources = ["raw_ref", "fallback_llm"];

  const { data: oldRows, error: oldErr } = await supabase
    .from("parsed_comments")
    .select("*")
    .eq("project_id", projectId)
    .in("ingest_source", portalSources);
  if (oldErr) {
    throw new Error(`Failed to read existing portal comments: ${oldErr.message}`);
  }

  const { data: stagingRows, error: stagingErr } = await supabase
    .from("parsed_comments")
    .select("*")
    .eq("project_id", projectId)
    .eq("ingest_source", "raw_ref_staging");
  if (stagingErr) {
    throw new Error(`Failed to read staging comments: ${stagingErr.message}`);
  }

  const old = (oldRows ?? []) as ParsedCommentRow[];
  const staging = (stagingRows ?? []) as ParsedCommentRow[];

  const oldByKey = new Map<string, ParsedCommentRow>();
  for (const row of old) {
    oldByKey.set(portalCommentKey(row), row);
  }

  const matchedOldIds = new Set<string>();
  let updated_count = 0;
  let inserted_count = 0;

  for (const stagingRow of staging) {
    const key = portalCommentKey(stagingRow);
    const existing = oldByKey.get(key);
    if (existing) {
      matchedOldIds.add(existing.id);
      const { error: updErr } = await supabase
        .from("parsed_comments")
        .update({
          original_text: stagingRow.original_text,
          page_number: stagingRow.page_number,
          status: stagingRow.status,
          comment_number: stagingRow.comment_number ?? existing.comment_number,
        })
        .eq("id", existing.id);
      if (updErr) {
        throw new Error(`Failed to update matched comment: ${updErr.message}`);
      }
      await supabase.from("parsed_comments").delete().eq("id", stagingRow.id);
      updated_count++;
    } else {
      const { error: promErr } = await supabase
        .from("parsed_comments")
        .update({ ingest_source: "raw_ref" })
        .eq("id", stagingRow.id);
      if (promErr) {
        throw new Error(`Failed to promote staging comment: ${promErr.message}`);
      }
      inserted_count++;
    }
  }

  const toDeleteIds = old.filter((r) => !matchedOldIds.has(r.id)).map((r) => r.id);
  let deleted_count = 0;
  if (toDeleteIds.length > 0) {
    const { error: delErr } = await supabase
      .from("parsed_comments")
      .delete()
      .in("id", toDeleteIds);
    if (delErr) {
      throw new Error(`Failed to remove stale portal comments: ${delErr.message}`);
    }
    deleted_count = toDeleteIds.length;
  }

  await supabase
    .from("parsed_comments")
    .delete()
    .eq("project_id", projectId)
    .eq("ingest_source", "raw_ref_staging");

  return {
    previous_portal_count: old.length,
    new_staging_count: staging.length,
    deleted_count,
    updated_count,
    inserted_count,
    final_portal_count: updated_count + inserted_count,
  };
}

async function fetchStoredCountsBySource(
  supabase: ReturnType<typeof createClient>,
  projectId: string,
): Promise<{ raw_ref: number; raw_ref_staging: number; fallback_llm: number; total: number }> {
  const { data, error } = await supabase
    .from("parsed_comments")
    .select("id, ingest_source")
    .eq("project_id", projectId);
  if (error) {
    console.warn("[comment-parser] failed to read stored counts by source:", error.message);
    return { raw_ref: 0, raw_ref_staging: 0, fallback_llm: 0, total: 0 };
  }
  const rows = (data ?? []) as Array<{ ingest_source?: string | null }>;
  const raw_ref = rows.filter((r) => r.ingest_source === "raw_ref").length;
  const raw_ref_staging = rows.filter((r) => r.ingest_source === "raw_ref_staging").length;
  const fallback_llm = rows.filter((r) => r.ingest_source === "fallback_llm").length;
  return { raw_ref, raw_ref_staging, fallback_llm, total: rows.length };
}

interface PortalData {
  portalSubtype?: string;
  tabs?: {
    reports?: { pdfs?: PortalPdf[] };
    review?: {
      workflowBuckets?: PgcWorkflowBucket[];
    };
  };
  meta?: {
    comment_parse_cursor?: { pdfIndex: number };
  };
}

function buildPgcDomWorkflowBucketsFallbackPdf(portalData: PortalData): PortalPdf | null {
  const buckets = portalData.tabs?.review?.workflowBuckets;
  if (!Array.isArray(buckets) || buckets.length === 0) return null;
  const mapped = mapPgcWorkflowBucketsToStructuredRows(buckets);
  if (mapped.length === 0) return null;
  console.log(
    "[comment-parser] PGC DOM workflowBuckets fallback structuredRows:",
    mapped.length,
  );
  return {
    fileName: PGC_REVIEW_COMMENTS_REPORT_NAME,
    text: "",
    structuredRows: mapped,
    structuredRowsSource: "pgc-dom",
    info: { source: "pgc-export" },
  };
}

/** True when scraped report text is an empty/placeholder payload (not whole-doc rejection). */
function isNoCommentsPlaceholderText(t: string): boolean {
  const s = t.trim();
  if (!s) return true;
  if (/^No data found\.?$/i.test(s)) return true;
  if (s.length < 120 && /^No data found\.?/i.test(s) && !/\bSTATUS\b/i.test(s)) {
    return true;
  }
  return false;
}

/** Known report titles to exclude (exact match). */
const REPORT_TITLE_EXACT = new Set([
  "Current Project - All Uploaded Files with Sheet Sizes",
  "Plan Review - Department Review Status",
  "Plan Review - Review Comments",
  "Plan Review - Review Details",
  "Plan Review - Workflow Routing Slip",
  "Plan Review - Review Comments Report",
]);

/** Table header phrases (all-uppercase column headers). */
const TABLE_HEADER_PHRASES = new Set([
  "TASK", "TASK STATUS", "REVIEW STATUS", "CYCLE", "ASSIGNED", "ACCEPTED", "COMPLETED", "GROUP", "USER", "SUB TOTAL",
  "WORKFLOW ROUTING SLIP", "REVIEW COMMENTS", "DEPARTMENT", "STATUS", "REVIEWER",
]);

/** Workflow/routing slip noise. */
const ROUTING_SLIP_NOISE = new Set([
  "Upload and Submit", "Accepted", "SystemClosed", "Applicant",
]);

/** Metadata phrases: blocks containing any of these must never be inserted as comments. */
const METADATA_PHRASES = [
  "Created in ProjectDox version",
  "Report Generated:",
  "Workflow Started:",
  "Report date:",
  "Project Name:",
  "Upload and Submit",
  "Workflow Routing Slip",
];

/** Substrings that indicate a real review comment (requirement, instruction, code reference, action request). */
const REAL_COMMENT_SIGNALS = [
  "requirement", "instruction", "code reference", "action request",
  "IBC", "NEC", "DCMR", "NFPA", "provide", "submit", "revise", "correct", "address", "comply",
  "required", "section", "approval", "permit", "shall", "must ",
  "upload", "verify", "review", "code", "plan", "drawing", "sheet", "detail",
  "note", "show", "indicate", "ensure", "install", "comply", "violation",
  "inspection", "certificate", "stamp", "seal", "sign", "abatement", "lead",
  "plat", "survey", "zoning", "fire", "structural", "electrical", "plumbing",
  "mechanical", "energy", "egress", "occupancy", "load", "rating",
];

/** Date/time pattern (e.g. 07/30/2025 02:29 PM or 02/21/2026). */
const DATE_TIME_PATTERN = /^\d{1,2}\/\d{1,2}\/\d{2,4}(\s+\d{1,2}:\d{2}\s*(?:AM|PM))?$/i;

/** Duration pattern (e.g. 147 days 3.5 hrs). */
const DURATION_PATTERN = /^\d+\s*days?\s+[\d.]+\s*hrs?$/i;

function isNoiseBlock(block: string): boolean {
  const t = block.trim();
  const len = t.length;

  if (len === 0) return true;

  // 0. Minimum length: ignore blocks shorter than 15 characters
  if (len < 15) return true;

  // 0b. Metadata phrases: never treat as comment
  for (const phrase of METADATA_PHRASES) {
    if (t.includes(phrase)) return true;
  }

  // 1. Report titles and headers
  if (REPORT_TITLE_EXACT.has(t)) return true;
  if (t.startsWith("Plan Review -") && len < 60) return true;
  if (t.startsWith("Current Project -") && len < 80) return true;

  // 2. Report metadata
  if (t.startsWith("Report Generated:")) return true;
  if (t.startsWith("Project Name:") && len < 40) return true;
  if (t.startsWith("Workflow Started:")) return true;
  if (t.startsWith("Workflow:") && t.includes("Template -")) return true;
  if (t.startsWith("Review Type:") && len < 40) return true;
  if (t.startsWith("Number of Files:")) return true;
  if (t.startsWith("Total Review Comments:") && len < 40) return true;
  if (t.startsWith("Total Review Cycle:")) return true;
  if (t.startsWith("Days Calculated as:")) return true;
  if (t.startsWith("Elapsed Days:") || t.startsWith("Time Elapsed:")) return true;
  if (t.startsWith("Days with Jurisdiction:") || t.startsWith("Time with Jurisdiction:")) return true;
  if (t.startsWith("Days with Applicant") || t.startsWith("Time with Applicant:")) return true;
  if (t.startsWith("Completed Submission") || t.startsWith("Completed Plan Review:")) return true;
  if (t.includes("Created in ProjectDox version")) return true;
  if (t === "No data found." || t === "No data found") return true;

  // 3. Table headers (all words uppercase, matches known header phrases)
  const upper = t.toUpperCase();
  const words = upper.split(/\s+/).filter(Boolean);
  if (words.length >= 1 && words.every((w) => /^[A-Z0-9]+$/.test(w))) {
    const joined = words.join(" ");
    if (TABLE_HEADER_PHRASES.has(joined) || Array.from(TABLE_HEADER_PHRASES).some((h) => joined.includes(h))) return true;
    if (words.length <= 4 && words.every((w) => w.length <= 15)) {
      if (["CYCLE", "DEPARTMENT", "STATUS", "REVIEWER", "REVIEW", "COMMENTS"].some((h) => joined.includes(h))) return true;
    }
  }

  // 4. Short metadata
  if (/^\d+$/.test(t)) return true;
  if (DATE_TIME_PATTERN.test(t)) return true;

  // 5. Workflow routing slip
  if (ROUTING_SLIP_NOISE.has(t)) return true;
  if (DURATION_PATTERN.test(t)) return true;
  if (len < 35 && /^[\w\s\-]+(?:LLC|Inc|Corp)?\.?$/i.test(t)) {
    if (t.includes("Commun-ET") || t.split(/\s+/).length <= 3) return true;
  }

  // 6. Combined report summary (contains both Report Generated and Days/Time)
  if (t.includes("Report Generated:") && (t.includes("Days Calculated as:") || t.includes("Time Elapsed:"))) return true;

  return false;
}

/** Spreadsheet-style rows: one tab-separated row per line (common for SSRS Excel exports, e.g. PGC). */
function splitTabularLinesIntoBlocks(normalized: string): string[] | null {
  const lines = normalized.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 5) return null;
  const tabLines = lines.filter((l) => l.includes("\t"));
  if (tabLines.length < 8) return null;
  if (tabLines.length < Math.ceil(lines.length * 0.55)) return null;
  const filtered = tabLines.filter((l) => l.length >= 15 && !isNoiseBlock(l));
  if (filtered.length < 1) return null;
  return filtered;
}

/** Row looks like a data row from a review grid (let LLM trim to real comment text). */
function isTabularCommentRow(b: string): boolean {
  const parts = b.split("\t").map((p) => p.trim()).filter((p) => p.length > 0);
  return parts.length >= 4 && b.trim().length >= 28;
}

/**
 * PGC SSRS PDF extract: few tabs, many logical rows; split normalized lines into blocks.
 */
function splitPgcFlattenedRowBlocks(normalized: string): string[] | null {
  const lines = normalized.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 4) return null;
  const tabLines = lines.filter((l) => l.includes("\t")).length;
  if (tabLines >= 5 && tabLines / lines.length >= 0.35) return null;
  const markers = lines.filter(
    (l) =>
      /\.pdf\b/i.test(l) ||
      /\b(UnResolved|Resolved|Info\s*Only|InfoOnly)\b/i.test(l) ||
      /^REF\s*#?\s*\d+/i.test(l) ||
      /^REF\s*#?\s*CYCLE\b/i.test(l),
  );
  if (markers.length < 1) return null;
  if (markers.length < 2 && lines.length < 10) return null;
  const out = lines.filter((l) => {
    const t = l.trim();
    if (isNoiseBlock(l)) return false;
    if (t.length >= 15) return true;
    return /^REF\s*#?\s*\d+/i.test(t) || /^REF\s*#?\s*CYCLE\b/i.test(t);
  });
  if (out.length < 2) return null;
  return out;
}

/** Split document text into candidate comment blocks (regex fallback). */
function splitIntoCommentBlocks(text: string, opts?: { pgcFlattened?: boolean }): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  const blocks: string[] = [];

  const tabular = splitTabularLinesIntoBlocks(normalized);
  if (tabular != null && tabular.length >= 1) {
    return tabular;
  }

  if (opts?.pgcFlattened === true) {
    const pgc = splitPgcFlattenedRowBlocks(normalized);
    if (pgc != null && pgc.length >= 1) return pgc;
  }

  // Numbered items: 1. 2. or 1) 2) or • or -
  const numbered = normalized.split(/\n\s*(?:\d+[.)]\s*|\d+\s*[-)]\s*|[•\-*]\s+)/).map((s) => s.trim()).filter((s) => s.length > 15);
  if (numbered.length > 1) {
    blocks.push(...numbered);
    return blocks;
  }

  // Double newline as separator
  const byDouble = normalized.split(/\n\s*\n/).map((s) => s.trim()).filter((s) => s.length > 15);
  if (byDouble.length > 1) {
    blocks.push(...byDouble);
    return blocks;
  }

  // Single block if substantial
  if (normalized.length > 20) blocks.push(normalized);
  return blocks;
}

/** True if block looks like a real review comment (requirement, instruction, code reference, or action request). */
function looksLikeRealComment(block: string): boolean {
  const lower = block.trim().toLowerCase();
  if (lower.length < 15) return false;
  return REAL_COMMENT_SIGNALS.some((signal) => lower.includes(signal.toLowerCase()));
}

/**
 * PGC Review Comments grid row without tabs: 2+ spaces between columns (PDF text extract).
 * Kept separate from isTabularCommentRow so Washington / strict tab paths stay unchanged.
 */
function isPgcSpaceAlignedGridRow(t: string): boolean {
  if (t.includes("\t")) return false;
  if (t.length < 28) return false;
  const parts = t
    .split(/\s{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return parts.length >= 4;
}

/** PGC flattened PDF row: REF/status/pdf signals first — do not reject short REF-only lines before pattern checks. */
function isPgcFlattenedCommentRow(b: string): boolean {
  const t = b.trim();
  if (t.length < 2) return false;
  if (/^REF\s*#?\s*CYCLE\b/i.test(t)) return true;
  if (/^REF\s*#?\s*\d+/i.test(t)) return true;
  if (/\.pdf\b/i.test(t)) return true;
  if (/\b(unresolved|resolved|info\s*only|infoonly)\b/i.test(t)) return true;
  if (t.length >= 40 && looksLikeRealComment(t)) return true;
  if (isPgcSpaceAlignedGridRow(t)) return true;
  return false;
}

/** Short line that is still a PGC grid fragment (must pass isNoiseBlock + isPgcFlattenedCommentRow after). */
function isPgcShortRefOrCycleLine(t: string): boolean {
  return /^REF\s*#?\s*\d+/i.test(t) || /^REF\s*#?\s*CYCLE\b/i.test(t);
}

/** Filter out report titles, metadata, table headers, and other noise before LLM. Only keep blocks that look like real comments. */
/** Keep blocks that carry a portal review row: REF #, .pdf, or status — not only "code-like" phrasing. */
function blockHasPortalRefRowSignals(b: string): boolean {
  const t = b.slice(0, 1_200);
  if (/(?:^|\n)\s*REF\s*#?\s*\d+\b/i.test(t)) return true;
  if (/(?:^|\n)\s*REF\s*#?\s*CYCLE\b/i.test(t)) return true;
  if (isTabularCommentRow(b)) return true;
  if (b.trim().length >= 20 && /\.pdf|UnResolved|Resolved|Info\s*Only|InfoOnly\b/i.test(b)) {
    return true;
  }
  return false;
}

function filterNoiseBlocks(
  blocks: string[],
  opts?: { allowPgcFlattenedRows?: boolean; allowPortalRefBlocks?: boolean },
): string[] {
  return blocks
    .filter((b) => {
      const t = b.trim();
      if (t.length < 1) return false;
      if (opts?.allowPgcFlattenedRows === true && isPgcShortRefOrCycleLine(t)) return true;
      return t.length >= 15;
    })
    .filter((b) => !isNoiseBlock(b))
    .filter((b) => {
      const pgcRow = opts?.allowPgcFlattenedRows === true && isPgcFlattenedCommentRow(b);
      const portalRow = opts?.allowPortalRefBlocks === true && blockHasPortalRefRowSignals(b);
      return looksLikeRealComment(b) || isTabularCommentRow(b) || pgcRow || portalRow;
    });
}

/** One LLM call per chunk so responses stay within max_tokens (large PGC reports need many blocks). */
const CLASSIFY_BATCH_SIZE = 12;

/** Classify comment text using same schema as parse-permit-comments (LLM). */
async function classifyCommentBlocks(
  openai: OpenAI,
  blocks: string[],
  baseIndex = 0,
  opts?: { portalPreservationMode?: boolean },
): Promise<ParsedCommentItem[]> {
  if (blocks.length === 0) return [];

  const systemPrompt = opts?.portalPreservationMode
    ? `You are normalizing the permit portal "Plan Review - Review Comments" report. Output one record per input block, in order, for Comment Review (full portal row preservation).

For EACH input block, output one object with:
- "original_text": full text for that block (trim only outer whitespace; keep status, filenames, and informational lines if they appear in the block).
- "discipline" (Architecture, MEP, Structural, Zoning, Fire, or General)
- "code_reference" string or null

Do not merge blocks. Do not drop blocks for being informational or lacking a code citation. The "comments" array length must equal the number of input blocks.
Return JSON: {"comments":[...]}.`
    : `You are parsing official plan review comments from a building permit review process. ONLY extract actual reviewer comments — these are instructions, requirements, or feedback from government reviewers to the applicant.

DO NOT include:
- Report titles or headers
- Metadata (dates, project numbers, file counts, reviewer names)
- Table column headers
- Workflow routing information (task names, statuses, dates)
- Footer text (like 'Created in ProjectDox')
- Summary statistics (elapsed days, review cycles)

Actual review comments typically:
- Reference specific code sections (e.g., DCMR, IBC, NEC)
- Request specific documents or actions from the applicant
- Describe deficiencies or required corrections
- Mention specific building disciplines (structural, MEP, zoning, etc.)

Your task:
1. Below is a list of raw text blocks. For each block that is an actual review comment, output one object with: "original_text" (cleaned comment text), "discipline" (exactly one of: Architecture, MEP, Structural, Zoning, Fire; use "MEP" for mechanical/electrical/plumbing), "code_reference" (e.g. "IBC 1004.3", "NFPA 101", or null if not present).
2. Return a JSON object with a single key "comments": an array of those objects.
3. If a block is not a real comment, omit it from the array.
Return ONLY valid JSON. No markdown. Example: {"comments":[{"original_text":"Provide 1-hour fire rating","discipline":"Fire","code_reference":"IBC 708.4"}]}`;

  const userContent = blocks.map((b, i) => `[${baseIndex + i + 1}]\n${b}`).join("\n\n");

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    max_tokens: 4096,
    response_format: { type: "json_object" },
  });

  const content = response.choices?.[0]?.message?.content;
  if (!content) return [];

  let data: { comments?: ParsedCommentItem[] };
  try {
    data = JSON.parse(content);
  } catch {
    return [];
  }

  const comments = Array.isArray(data.comments) ? data.comments : [];
  const mapped = comments.map((c: Record<string, unknown>) => ({
    original_text: typeof c.original_text === "string" ? c.original_text : String(c.original_text ?? ""),
    discipline: typeof c.discipline === "string" ? c.discipline : "General",
    code_reference: typeof c.code_reference === "string" ? c.code_reference : null,
  }));
  if (opts?.portalPreservationMode) {
    const merged: ParsedCommentItem[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i] ?? "";
      const c = mapped[i];
      merged.push(
        c
          ? {
            original_text: (c.original_text ?? "").trim() || b.trim() || b,
            discipline: c.discipline || "General",
            code_reference: c.code_reference ?? null,
          }
          : { original_text: b.trim() || b, discipline: "General", code_reference: null },
      );
    }
    return merged;
  }
  return mapped;
}

async function classifyCommentBlocksBatched(
  openai: OpenAI,
  blocks: string[],
  opts?: { portalPreservationMode?: boolean },
): Promise<ParsedCommentItem[]> {
  const merged: ParsedCommentItem[] = [];
  for (let off = 0; off < blocks.length; off += CLASSIFY_BATCH_SIZE) {
    const chunk = blocks.slice(off, off + CLASSIFY_BATCH_SIZE);
    const part = await classifyCommentBlocks(openai, chunk, off, opts);
    merged.push(...part);
  }
  return merged;
}

/** Normalize for duplicate check: trim and collapse whitespace. */
function normalizeText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

const PARSED_COMMENTS_ALLOWED_STATUSES = new Set([
  "Pending Review",
  "Pending",
  "Approved",
  "Rejected",
  "Draft",
  "Ready for Review",
]);

/** Map portal / PGC workflow lines to `parsed_comments.status` (DB `parsed_comments_status_check`). */
function normalizePortalStatus(raw: string): string {
  const trimmed = String(raw ?? "").trim();
  if (PARSED_COMMENTS_ALLOWED_STATUSES.has(trimmed)) return trimmed;
  const t = trimmed.toLowerCase().replace(/\s+/g, " ");
  if (!t) return "Pending";
  if (t === "resolved") return "Approved";
  if (t === "unresolved" || t === "un resolved") return "Pending Review";
  if (t === "info only" || t === "infoonly") return "Pending";
  if (t === "pending review") return "Pending Review";
  if (t === "rejected") return "Rejected";
  if (t === "approved") return "Approved";
  if (t === "draft") return "Draft";
  if (t === "ready for review") return "Ready for Review";
  return "Pending";
}

function previewSnippet(s: string, max = 200): string {
  const one = s.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return one.slice(0, max) + "…";
}

/** Evidence capture output for debugging modal vs parsed_comments mismatch (PGC stacked vs server pipeline). */
function computeDropStageHint(args: {
  split: number;
  afterNoiseFilter: number;
  llmInputBlockCount: number;
  classified: number;
  inserted: number;
  skippedDuplicate: number;
  skippedPostLlmNoise: number;
}): string {
  const {
    split,
    afterNoiseFilter,
    llmInputBlockCount,
    classified,
    inserted,
    skippedDuplicate,
    skippedPostLlmNoise,
  } = args;
  if (split === 0) return "split: no blocks";
  if (split === 1 && afterNoiseFilter >= 1 && classified <= 1 && inserted <= 1) {
    return "split: single block only (likely fallback path, before filter)";
  }
  if (afterNoiseFilter < split) {
    return "filter_stage: noise filter removed blocks (split → after_noise_filter)";
  }
  if (classified < llmInputBlockCount) {
    return "classification_stage: LLM returned fewer items than blocks sent to model (after cap)";
  }
  if (inserted < classified) {
    const parts: string[] = [];
    if (skippedDuplicate > 0) parts.push(`duplicates_skipped=${skippedDuplicate}`);
    if (skippedPostLlmNoise > 0) parts.push(`post_llm_noise_skipped=${skippedPostLlmNoise}`);
    return `persistence_stage: ${parts.join("; ") || "insert failures or empty text"}`;
  }
  return "no_count_drop_vs_prior_stages (all stage counts aligned)";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ code: 500, message: "OpenAI API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !anonKey) {
      return new Response(
        JSON.stringify({ code: 500, message: "SUPABASE_URL or SUPABASE_ANON_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ code: 401, message: "Missing or invalid Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const token = authHeader.replace(/^\s*Bearer\s+/i, "").trim();
    if (!token) {
      return new Response(
        JSON.stringify({ code: 401, message: "Invalid JWT" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    console.log("Authorization header present, validating JWT");

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      console.warn("JWT validation failed:", userError?.message ?? "No user");
      return new Response(
        JSON.stringify({ code: 401, message: "Invalid JWT" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    console.log("JWT validated, user.id:", user.id);

    const body = await req.json().catch(() => ({}));
    const projectId = body.project_id as string | undefined;
    if (!projectId) {
      return new Response(
        JSON.stringify({ code: 400, message: "project_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const maxPdfs = typeof body.max_pdfs === "number" && body.max_pdfs > 0 ? Math.min(body.max_pdfs, 10) : 2;
    const maxComments = typeof body.max_comments === "number" && body.max_comments > 0 ? body.max_comments : undefined;
    const cursorBody = body.cursor as { pdfIndex?: number } | undefined;
    const capturePipelineEvidence = body.capture_pipeline_evidence === true;

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id, user_id, portal_data")
      .eq("id", projectId)
      .single();

    if (projectError || !project) {
      return new Response(
        JSON.stringify({ code: 404, message: "Project not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (project.user_id !== user.id) {
      return new Response(
        JSON.stringify({ code: 403, message: "Forbidden" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const fullRefresh = body.full_refresh === true;

    let portalData = (project.portal_data as PortalData | null) ?? {};

    const savedCursorEarly = portalData.meta?.comment_parse_cursor;
    const startPdfIndexEarly = cursorBody?.pdfIndex ?? savedCursorEarly?.pdfIndex ?? 0;
    const safeStartEarly = Math.max(0, Math.min(startPdfIndexEarly, 9999));
    const portalIngestSource: ParsedCommentIngestSource = fullRefresh
      ? "raw_ref_staging"
      : "raw_ref";

    if (fullRefresh && safeStartEarly === 0) {
      const { error: stagingDelErr } = await supabase
        .from("parsed_comments")
        .delete()
        .eq("project_id", projectId)
        .eq("ingest_source", "raw_ref_staging");
      if (stagingDelErr) {
        console.error("[comment-parser] full_refresh clear staging failed:", stagingDelErr.message);
        return new Response(
          JSON.stringify({
            code: 500,
            message: `Failed to clear staging comments before portal refresh: ${stagingDelErr.message}`,
            parsed_count: 0,
            inserted_raw_ref_count: 0,
            inserted_fallback_count: 0,
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const clearedPortal: PortalData = {
        ...portalData,
        meta: { ...portalData.meta, comment_parse_cursor: null },
      };
      const { error: metaErr } = await supabase
        .from("projects")
        .update({ portal_data: clearedPortal })
        .eq("id", projectId);
      if (metaErr) console.warn("[comment-parser] full_refresh clear cursor:", metaErr.message);
      portalData = clearedPortal;
      console.log("[DEBUG] comment-parser: full_refresh — staging cleared, portal comments preserved until finalize");
    }

    const pdfs = portalData.tabs?.reports?.pdfs ?? [];
    let pdfsToProcess = pdfs.filter(
      (p): p is PortalPdf =>
        isReviewCommentsReportPdf(p) &&
        Array.isArray(p.structuredRows) &&
        p.structuredRows.length > 0,
    );

    if (pdfsToProcess.length === 0) {
      const domFallbackPdf = buildPgcDomWorkflowBucketsFallbackPdf(portalData);
      if (domFallbackPdf) {
        pdfsToProcess = [domFallbackPdf];
      }
    }

    if (pdfsToProcess.length === 0) {
      pdfsToProcess = pdfs.filter(
        (p): p is PortalPdf =>
          isReviewCommentsReportPdf(p) && pdfHasParseableReviewCommentsContent(p),
      );
    }

    if (pdfsToProcess.length === 0) {
      console.log("[DEBUG] comment-parser: no Review Comments PDFs with text or structuredRows, skipping");
      return new Response(
        JSON.stringify({
          parsed_count: 0,
          skipped_count: 0,
          insert_error_count: 0,
          next_cursor: { pdfIndex: 0 },
          done: true,
          total_pdfs: 0,
          reason: "no_matching_pdf",
          message: "No Review Comments reports with text or structuredRows in portal_data.tabs.reports.pdfs",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const totalPdfs = pdfsToProcess.length;

    const savedCursor = portalData.meta?.comment_parse_cursor;
    const startPdfIndex = cursorBody?.pdfIndex ?? savedCursor?.pdfIndex ?? 0;
    const safeStart = Math.max(0, Math.min(startPdfIndex, totalPdfs));

    console.log("[DEBUG] comment-parser: total PDFs:", totalPdfs, "startPdfIndex:", safeStart, "max_pdfs:", maxPdfs);

    if (totalPdfs === 0) {
      return new Response(
        JSON.stringify({
          parsed_count: 0,
          skipped_count: 0,
          insert_error_count: 0,
          next_cursor: { pdfIndex: 0 },
          done: true,
          total_pdfs: 0,
          reason: "no_pdf_content",
          message: "No Review Comments reports with text or structuredRows in portal_data.tabs.reports.pdfs",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const firstPdf = pdfsToProcess[0];
    const firstText = (firstPdf.text ?? "").trim();
    const firstHasStructuredRows =
      Array.isArray(firstPdf.structuredRows) && firstPdf.structuredRows.length > 0;
    if (isNoCommentsPlaceholderText(firstText) && !firstHasStructuredRows) {
      if (fullRefresh) {
        await supabase
          .from("parsed_comments")
          .delete()
          .eq("project_id", projectId)
          .in("ingest_source", ["raw_ref", "fallback_llm", "raw_ref_staging"]);
      }
      const mergedPortalData = {
        ...portalData,
        meta: { ...portalData.meta, comment_parse_cursor: null },
      };
      await supabase.from("projects").update({ portal_data: mergedPortalData }).eq("id", projectId);
      return new Response(
        JSON.stringify({
          parsed_count: 0,
          skipped_count: 0,
          insert_error_count: 0,
          next_cursor: { pdfIndex: totalPdfs },
          done: true,
          total_pdfs: totalPdfs,
          reason: "no_comments_in_portal",
          message: "Plan Review - Review Comments text is empty or a no-data placeholder.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

    const existingNormalized = new Map<string, string>();

    if (!fullRefresh) {
      const existingRows = await supabase
        .from("parsed_comments")
        .select("id, original_text")
        .eq("project_id", projectId);

      const existingData = existingRows.data ?? [];
      console.log("[DEBUG] comment-parser: existing rows for project:", existingData.length);
      for (const row of existingData) {
        const r = row as { id: string; original_text?: string };
        if (r.original_text) existingNormalized.set(normalizeText(r.original_text), r.id);
      }
    } else {
      console.log("[DEBUG] comment-parser: full_refresh — existing duplicate map cleared");
    }

    let parsedCount = 0;
    let skippedPostLlmNoise = 0;
    let skippedDuplicate = 0;
    let skippedEmpty = 0;
    let insertErrorCount = 0;
    let processedPdfCount = 0;
    let nextPdfIndex = safeStart;
    let everHadSplitBlocks = false;
    let everHadFilteredBlocks = false;
    let pipelineEvidence: Record<string, unknown> | null = null;
    const extractedRefs: string[] = [];
    const parsedRefs: string[] = [];
    const normalizedRefs: string[] = [];
    const storedRefs: string[] = [];
    let deterministicParsedRowCount = 0;
    let fallbackParsedRowCount = 0;
    let insertedRawRefCount = 0;
    let insertedFallbackCount = 0;
    let extractedSourceRefCount = 0;
    let parsedSourceRefCount = 0;
    let normalizedRawCommentCount = 0;

    const totalSkips = () =>
      skippedPostLlmNoise + skippedDuplicate + skippedEmpty;

    for (let i = 0; i < maxPdfs && safeStart + i < totalPdfs; i++) {
      const pdfIndex = safeStart + i;
      const pdf = pdfsToProcess[pdfIndex];
      const pageNumber = pdfIndex + 1;
      const rawPdfText = pdf.text ?? "";
      const extractedRefsThisPdf = extractOrderedRefsFromText(rawPdfText);
      if (extractedRefsThisPdf.length > 0) {
        extractedRefs.push(...extractedRefsThisPdf);
        extractedSourceRefCount += extractedRefsThisPdf.length;
      }
      const likelySourceRefRows =
        extractedRefsThisPdf.length > 0 || hasLikelySourceRefRows(rawPdfText);

      const deterministicPgc = shouldAttemptDeterministicStackedParse(pdf);
      if (deterministicPgc) {
        const isMontgomeryExport = String(pdf.info?.source ?? "") === "montgomery-export";

        const hasStructuredArray =
          Array.isArray(pdf.structuredRows) &&
          pdf.structuredRows.length > 0;
        const mappedFromStructured = hasStructuredArray
          ? mapMontgomeryStructuredRowsToPgcDeterministic(pdf.structuredRows!)
          : [];
        const useStructuredRowsPath = mappedFromStructured.length > 0;

        const structuredInputRefs = hasStructuredArray
          ? pdf.structuredRows!
              .map((r) => String(r?.ref ?? "").trim())
              .filter((ref) => ref.length > 0)
          : [];
        const structuredMappedRefs = mappedFromStructured.map((r) =>
          String(r.ref ?? "").trim(),
        ).filter(Boolean);
        const structuredSkippedRefs = structuredInputRefs.filter(
          (ref) => !structuredMappedRefs.includes(ref),
        );

        console.log(
          "[comment-parser] parse path selection " +
            JSON.stringify({
              fileName: pdf.fileName ?? "",
              info_source: pdf.info?.source ?? null,
              structured_rows_available: hasStructuredArray,
              structured_input_row_count: hasStructuredArray
                ? pdf.structuredRows!.length
                : 0,
              structured_mapped_row_count: mappedFromStructured.length,
              selected_path: useStructuredRowsPath ? "structured_rows" : "text_fallback",
              structured_rows_source: pdf.structuredRowsSource ?? null,
              structured_skipped_refs: structuredSkippedRefs,
            }),
        );

        if (hasStructuredArray) {
          const sr = pdf.structuredRows!;
          console.log(
            "[comment-parser] structured rows from Excel " +
              JSON.stringify({
                structured_rows_count: sr.length,
                mapped_row_count: mappedFromStructured.length,
                first_3_refs: sr.slice(0, 3).map((r) => String(r?.ref ?? "").trim()),
                first_row_preview: sr[0] ?? null,
                structured_rows_source: pdf.structuredRowsSource ?? null,
              }),
          );
        }

        let stackedRows: PgcReviewCommentsRow[] | null = null;
        let usedMontgomeryStructuredRows = false;
        let usedMontgomeryDeterministicGrid = false;

        if (useStructuredRowsPath) {
          stackedRows = mappedFromStructured;
          usedMontgomeryStructuredRows = true;
        } else {
          const textForDeterministic = isMontgomeryExport
            ? preprocessMontgomeryReviewCommentsExtractText(rawPdfText)
            : rawPdfText;
          const montgomeryGridRefOrder = isMontgomeryExport
            ? extractMontgomeryGridRefOrder(textForDeterministic)
            : [];

          const tryPgcDeterministicRows = tryPgcStackedRowsRawThenNormalized(textForDeterministic);
          const montgomeryDeterministicRows = isMontgomeryExport
            ? parseMontgomeryGridRowsDeterministic(textForDeterministic)
            : null;

          if (isMontgomeryExport) {
            console.log(
              "[comment-parser] montgomery grid diagnostics " +
                JSON.stringify({
                  grid_ref_order_count: montgomeryGridRefOrder.length,
                  adapted_preview_2000: textForDeterministic.slice(0, 2000),
                  try_pgc_deterministic_row_count: tryPgcDeterministicRows?.length ?? 0,
                  montgomery_deterministic_row_count: montgomeryDeterministicRows?.length ?? 0,
                  refs_try_pgc_first_20:
                    tryPgcDeterministicRows?.slice(0, 20).map((r) =>
                      String(r.ref ?? "").trim()
                    ) ?? [],
                  refs_montgomery_first_20:
                    montgomeryDeterministicRows?.slice(0, 20).map((r) =>
                      String(r.ref ?? "").trim()
                    ) ?? [],
                }),
            );
          }

          stackedRows =
            isMontgomeryExport &&
              montgomeryDeterministicRows &&
              montgomeryDeterministicRows.length > 0
              ? montgomeryDeterministicRows
              : pickDeterministicPgcRows(
                  textForDeterministic,
                  tryPgcDeterministicRows,
                  isMontgomeryExport &&
                    montgomeryGridRefOrder.length > 0 &&
                    !(montgomeryDeterministicRows?.length)
                    ? { extractedRefCountOverride: montgomeryGridRefOrder.length }
                    : undefined,
                );

          usedMontgomeryDeterministicGrid = Boolean(
            isMontgomeryExport &&
              stackedRows &&
              stackedRows === montgomeryDeterministicRows &&
              stackedRows.length > 0,
          );
        }
        if (stackedRows && stackedRows.length > 0) {
          everHadSplitBlocks = true;
          everHadFilteredBlocks = true;
          if (usedMontgomeryDeterministicGrid) {
            console.log(
              "[comment-parser] montgomery deterministic refs before insert " +
                JSON.stringify(stackedRows.map((r) => String(r.ref ?? "").trim())),
            );
          } else if (usedMontgomeryStructuredRows) {
            console.log(
              "[comment-parser] structured rows refs before insert " +
                JSON.stringify(stackedRows.map((r) => String(r.ref ?? "").trim())),
            );
          }
          console.log(
            "[DEBUG] comment-parser: deterministic stacked rows:",
            stackedRows.length,
            "parse_path:",
            useStructuredRowsPath ? "structured_rows" : "text_fallback",
          );
          parsedSourceRefCount += stackedRows.length;
          deterministicParsedRowCount += stackedRows.length;
          parsedRefs.push(...stackedRows.map((r) => String(r.ref ?? "").trim()).filter(Boolean));

          let commentCountThisPdf = 0;
          let roundSkippedDuplicate = 0;
          let roundSkippedEmpty = 0;
          let roundInsertFailures = 0;

          for (const row of stackedRows) {
            if (maxComments != null && parsedCount + totalSkips() + insertErrorCount >= maxComments) {
              break;
            }
            const orig = formatPgcDeterministicPersistedComment(
              row,
              String(pdf.fileName ?? "Plan Review - Review Comments"),
            );
            normalizedRawCommentCount++;
            if (row.ref) normalizedRefs.push(String(row.ref).trim());
            if (!orig.trim()) {
              roundSkippedEmpty++;
              skippedEmpty++;
              continue;
            }

            const key = normalizeText(orig);
            if (existingNormalized.has(key)) {
              roundSkippedDuplicate++;
              skippedDuplicate++;
              continue;
            }

            const { data: inserted, error: insertError } = await supabase.from("parsed_comments").insert({
              project_id: projectId,
              original_text: orig,
              /** Taxonomy only; `discipline-classifier-agent` sets from LLM. Not reviewer/org (inferPgc*). */
              discipline: null,
              code_reference: null,
              page_number: pageNumber,
              status: normalizePortalStatus(row.status),
              comment_number: row.ref ? String(row.ref).trim() : null,
              ingest_source: portalIngestSource,
            }).select("id").single();

            if (insertError) {
              console.error("Insert parsed_comment error:", insertError.message, insertError);
              insertErrorCount++;
              roundInsertFailures++;
              continue;
            }

            existingNormalized.set(key, inserted?.id ?? "");
            parsedCount++;
            commentCountThisPdf++;
            insertedRawRefCount++;
            if (row.ref) storedRefs.push(String(row.ref).trim());
          }

          if (capturePipelineEvidence && pipelineEvidence === null) {
            pipelineEvidence = {
              path: usedMontgomeryStructuredRows
                ? "montgomery_structured_rows"
                : usedMontgomeryDeterministicGrid
                  ? "montgomery_deterministic_grid"
                  : "pgc_eplan_deterministic_stacked",
              A_source_report: {
                fileName: pdf.fileName ?? "",
                text_length_raw: rawPdfText.length,
                stacked_row_count: stackedRows.length,
                montgomery_structured_rows: usedMontgomeryStructuredRows,
                structured_rows_count: hasStructuredArray ? (pdf.structuredRows?.length ?? 0) : 0,
                montgomery_deterministic: usedMontgomeryDeterministicGrid,
              },
              B_persistence: {
                inserted: commentCountThisPdf,
                skipped_duplicate: roundSkippedDuplicate,
                skipped_empty: roundSkippedEmpty,
                insert_failures: roundInsertFailures,
              },
              F_drop_analysis: usedMontgomeryStructuredRows
                ? "excel_structured_rows (portal_data structuredRows)"
                : usedMontgomeryDeterministicGrid
                  ? "montgomery_deterministic_grid (Montgomery-export grid parser)"
                  : "pgc_eplan_deterministic (no LLM split/filter/classify)",
            };
            console.log(
              "[pipeline-evidence]",
              JSON.stringify(pipelineEvidence, null, 0).slice(0, 12000),
            );
          }

          nextPdfIndex = pdfIndex + 1;
          processedPdfCount++;
          console.log(
            "[DEBUG] comment-parser: PDF",
            pdfIndex + 1,
            "deterministic inserted:",
            commentCountThisPdf,
            "inserted_raw_ref:",
            insertedRawRefCount,
            "parse_path:",
            useStructuredRowsPath ? "structured_rows" : "text_fallback",
            "structured_input:",
            hasStructuredArray ? pdf.structuredRows!.length : 0,
            "parsed_output:",
            stackedRows.length,
            "skipped_duplicate:",
            roundSkippedDuplicate,
            "skipped_empty:",
            roundSkippedEmpty,
            "running totals parsed:",
            parsedCount,
          );

          const nextCursorDet = { pdfIndex: nextPdfIndex };
          const mergedPortalDataDet = {
            ...portalData,
            meta: { ...portalData.meta, comment_parse_cursor: nextCursorDet },
          };
          const { error: updateErrDet } = await supabase
            .from("projects")
            .update({ portal_data: mergedPortalDataDet })
            .eq("id", projectId);
          if (updateErrDet) console.warn("Failed to save cursor:", updateErrDet.message);
          continue;
        }
        if (likelySourceRefRows) {
          console.warn(
            "[WARN] comment-parser: detected REF rows but deterministic row parser returned 0; skipping LLM fallback to prevent row split/drop",
            { fileName: pdf.fileName ?? "", pdfIndex },
          );
          nextPdfIndex = pdfIndex + 1;
          processedPdfCount++;
          continue;
        }
      }

      const usePgc = isPgcExportReviewCommentsPdf(pdf);
      const textForParse = usePgc
        ? normalizePgcFlattenedReviewCommentsText(rawPdfText)
        : rawPdfText;
      const splitBlocks = splitIntoCommentBlocks(textForParse, { pgcFlattened: usePgc });
      if (splitBlocks.length > 0) everHadSplitBlocks = true;
      let blocks = filterNoiseBlocks(splitBlocks, {
        allowPgcFlattenedRows: usePgc,
        allowPortalRefBlocks: deterministicPgc,
      });
      if (blocks.length > 0) everHadFilteredBlocks = true;
      const filteredCountBeforeCap = blocks.length;
      const MAX_BLOCKS_PER_PDF = 100;
      let blocksCapped = false;
      if (blocks.length > MAX_BLOCKS_PER_PDF) {
        blocksCapped = true;
        console.log(
          "[DEBUG] comment-parser: capping blocks",
          blocks.length,
          "->",
          MAX_BLOCKS_PER_PDF,
        );
        blocks = blocks.slice(0, MAX_BLOCKS_PER_PDF);
      }
      console.log("[DEBUG] comment-parser: PDF index", pdfIndex + 1, "/", totalPdfs, "blocks extracted:", blocks.length);

      if (blocks.length === 0) {
        nextPdfIndex = pdfIndex + 1;
        processedPdfCount++;
        if (capturePipelineEvidence && pipelineEvidence === null) {
          pipelineEvidence = {
            A_source_report: {
              fileName: pdf.fileName ?? "",
              text_length_raw: rawPdfText.length,
              text_length_for_parse: textForParse.length,
              use_pgc_normalization: usePgc,
            },
            B_split: {
              count: splitBlocks.length,
              first_5_block_previews: splitBlocks.slice(0, 5).map((b) => previewSnippet(b)),
            },
            C_filtered: {
              count_after_noise_filter: 0,
              count_after_cap: 0,
              blocks_capped: blocksCapped,
            },
            D_classified: { count: 0, item_previews: [] as { preview: string; length: number }[] },
            E_persistence: {
              inserted: 0,
              skipped_duplicate: 0,
              skipped_post_llm_noise: 0,
              skipped_empty: 0,
              insert_failures: 0,
            },
            F_drop_analysis: "filter_stage: all blocks removed (or empty before classify)",
          };
        }
        continue;
      }

      const classified = await classifyCommentBlocksBatched(openai, blocks, {
        portalPreservationMode: deterministicPgc,
      });
      fallbackParsedRowCount += classified.length;

      const SKIP_PHRASES = [
        "Created in ProjectDox version",
        "Report Generated:",
        "Report date:",
        "Project Name:",
        "Workflow Started:",
      ];
      const DATE_ONLY_PATTERN = /^\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}/;

      let commentCountThisPdf = 0;
      let roundSkippedPostLlmNoise = 0;
      let roundSkippedDuplicate = 0;
      let roundSkippedEmpty = 0;
      let roundInsertFailures = 0;

      for (const c of classified) {
        if (maxComments != null && parsedCount + totalSkips() + insertErrorCount >= maxComments) break;
        const orig = c.original_text.trim();
        if (!orig) {
          roundSkippedEmpty++;
          skippedEmpty++;
          continue;
        }

        const origTrimmed = orig.trim();
        if (
          SKIP_PHRASES.some((phrase) => origTrimmed.includes(phrase)) ||
          (origTrimmed.length < 30 && DATE_ONLY_PATTERN.test(origTrimmed))
        ) {
          roundSkippedPostLlmNoise++;
          skippedPostLlmNoise++;
          continue;
        }

        const key = normalizeText(orig);
        if (existingNormalized.has(key)) {
          roundSkippedDuplicate++;
          skippedDuplicate++;
          continue;
        }

        const { data: inserted, error: insertError } = await supabase.from("parsed_comments").insert({
          project_id: projectId,
          original_text: orig,
          discipline: null,
          code_reference: c.code_reference ?? null,
          page_number: pageNumber,
          status: "Pending",
          ingest_source: fullRefresh ? "raw_ref_staging" : ("fallback_llm" as ParsedCommentIngestSource),
        }).select("id").single();

        if (insertError) {
          console.error("Insert parsed_comment error:", insertError.message, insertError);
          insertErrorCount++;
          roundInsertFailures++;
          continue;
        }

        existingNormalized.set(key, inserted?.id ?? "");
        parsedCount++;
        commentCountThisPdf++;
        insertedFallbackCount++;
      }

      if (capturePipelineEvidence && pipelineEvidence === null) {
        const itemPreviews = classified.map((c) => ({
          preview: previewSnippet(c.original_text, 200),
          length: String(c.original_text ?? "").length,
        }));
        pipelineEvidence = {
          A_source_report: {
            fileName: pdf.fileName ?? "",
            text_length_raw: rawPdfText.length,
            text_length_for_parse: textForParse.length,
            use_pgc_normalization: usePgc,
          },
          B_split: {
            count: splitBlocks.length,
            first_5_block_previews: splitBlocks.slice(0, 5).map((b) => previewSnippet(b)),
          },
          C_filtered: {
            count_after_noise_filter: filteredCountBeforeCap,
            count_after_cap: blocks.length,
            blocks_capped: blocksCapped,
          },
          D_classified: {
            count: classified.length,
            item_previews: itemPreviews,
          },
          E_persistence: {
            inserted: commentCountThisPdf,
            skipped_duplicate: roundSkippedDuplicate,
            skipped_post_llm_noise: roundSkippedPostLlmNoise,
            skipped_empty: roundSkippedEmpty,
            insert_failures: roundInsertFailures,
          },
          F_drop_analysis: computeDropStageHint({
            split: splitBlocks.length,
            afterNoiseFilter: filteredCountBeforeCap,
            llmInputBlockCount: blocks.length,
            classified: classified.length,
            inserted: commentCountThisPdf,
            skippedDuplicate: roundSkippedDuplicate,
            skippedPostLlmNoise: roundSkippedPostLlmNoise,
          }),
        };
        console.log(
          "[pipeline-evidence]",
          JSON.stringify(pipelineEvidence, null, 0).slice(0, 12000),
        );
      }

      nextPdfIndex = pdfIndex + 1;
      processedPdfCount++;
      console.log("[DEBUG] comment-parser: PDF", pdfIndex + 1, "inserted:", commentCountThisPdf, "running totals parsed:", parsedCount, "skipped (all):", totalSkips());

      const nextCursor = { pdfIndex: nextPdfIndex };
      const mergedPortalData = {
        ...portalData,
        meta: { ...portalData.meta, comment_parse_cursor: nextCursor },
      };
      const { error: updateErr } = await supabase
        .from("projects")
        .update({ portal_data: mergedPortalData })
        .eq("id", projectId);
      if (updateErr) console.warn("Failed to save cursor:", updateErr.message);
    }

    const done = nextPdfIndex >= totalPdfs;
    if (done) {
      const mergedPortalData = {
        ...portalData,
        meta: { ...portalData.meta, comment_parse_cursor: null },
      };
      await supabase.from("projects").update({ portal_data: mergedPortalData }).eq("id", projectId);
    }

    const nextCursor = { pdfIndex: nextPdfIndex };
    const skippedTotal =
      skippedPostLlmNoise + skippedDuplicate + skippedEmpty;
    console.log(
      "[DEBUG] comment-parser: chunk done parsed:",
      parsedCount,
      "skipped:",
      skippedTotal,
      "insert_error:",
      insertErrorCount,
      "next_cursor:",
      nextCursor,
      "done:",
      done,
    );

    let doneReason: string | undefined;
    let doneMessage: string | undefined;
    if (done && parsedCount === 0) {
      if (!everHadSplitBlocks) {
        doneReason = "no_comment_blocks";
        doneMessage =
          "Review Comments text did not yield candidate line blocks after split.";
      } else if (!everHadFilteredBlocks) {
        doneReason = "no_comment_blocks";
        doneMessage =
          "Split produced lines but all were removed by the noise filter (headers/metadata).";
      } else {
        doneReason = "no_new_inserts";
        doneMessage =
          "Classifier ran on blocks but no new parsed_comments rows were inserted (empty LLM output, post-filters, or duplicates).";
      }
    }

    const uniqueParsedRefs = Array.from(new Set(parsedRefs.filter(Boolean)));
    const uniqueExtractedRefs = toUniqueOrdered(extractedRefs.filter(Boolean));
    const uniqueNormalizedRefs = toUniqueOrdered(normalizedRefs.filter(Boolean));
    const uniqueStoredRefs = Array.from(new Set(storedRefs.filter(Boolean)));
    const disappearedAfterParse = diffRefs(uniqueExtractedRefs, uniqueParsedRefs);
    const disappearedAfterNormalize = diffRefs(uniqueParsedRefs, uniqueNormalizedRefs);
    const disappearedAfterStore = diffRefs(uniqueNormalizedRefs, uniqueStoredRefs);
    const missingRefs = diffRefs(uniqueExtractedRefs, uniqueStoredRefs);
    const reconciliationWarnings: string[] = [];
    if (extractedSourceRefCount !== parsedSourceRefCount) {
      reconciliationWarnings.push(
        `count_mismatch: extracted_ref_count=${extractedSourceRefCount}, parsed_ref_count=${parsedSourceRefCount}`,
      );
    }
    if (parsedSourceRefCount !== normalizedRawCommentCount) {
      reconciliationWarnings.push(
        `count_mismatch: parsed_ref_count=${parsedSourceRefCount}, normalized_count=${normalizedRawCommentCount}`,
      );
    }
    if (normalizedRawCommentCount !== insertedRawRefCount) {
      reconciliationWarnings.push(
        `count_mismatch: normalized_count=${normalizedRawCommentCount}, inserted_raw_ref_count=${insertedRawRefCount}`,
      );
    }
    if (missingRefs.length > 0) {
      reconciliationWarnings.push(`missing_refs: ${missingRefs.join(", ")}`);
    }
    const storedCounts = await fetchStoredCountsBySource(supabase, projectId);

    let portalRefresh: Record<string, number> | undefined;
    let portalRefreshFailed = false;
    let portalRefreshError: string | undefined;

    if (fullRefresh && done) {
      const stagingTotal = storedCounts.raw_ref_staging;
      const hadSourceComments =
        extractedSourceRefCount > 0 ||
        insertedRawRefCount > 0 ||
        insertedFallbackCount > 0 ||
        deterministicParsedRowCount > 0;

      if (hadSourceComments && stagingTotal === 0) {
        portalRefreshFailed = true;
        portalRefreshError =
          "Portal refresh failed: source contained comments but parser produced no staging rows. Previous portal comments preserved.";
        await supabase
          .from("parsed_comments")
          .delete()
          .eq("project_id", projectId)
          .eq("ingest_source", "raw_ref_staging");
      } else if (stagingTotal > 0) {
        try {
          portalRefresh = await finalizePortalCommentRefresh(supabase, projectId);
          console.log("[comment-parser] portal refresh finalized", portalRefresh);
        } catch (finalizeErr) {
          portalRefreshFailed = true;
          portalRefreshError = finalizeErr instanceof Error
            ? finalizeErr.message
            : "Portal refresh finalize failed";
          await supabase
            .from("parsed_comments")
            .delete()
            .eq("project_id", projectId)
            .eq("ingest_source", "raw_ref_staging");
        }
      }
    }

    const countsAfterRefresh = portalRefresh
      ? await fetchStoredCountsBySource(supabase, projectId)
      : storedCounts;

    const reconciliation = {
      extracted_ref_count: extractedSourceRefCount,
      parsed_source_ref_count: parsedSourceRefCount,
      normalized_count: normalizedRawCommentCount,
      deterministic_parsed_row_count: deterministicParsedRowCount,
      fallback_parsed_row_count: fallbackParsedRowCount,
      inserted_raw_ref_count: insertedRawRefCount,
      inserted_fallback_count: insertedFallbackCount,
      stored_raw_ref_count: countsAfterRefresh.raw_ref,
      stored_raw_ref_staging_count: countsAfterRefresh.raw_ref_staging,
      stored_fallback_count: countsAfterRefresh.fallback_llm,
      total_stored_count: countsAfterRefresh.total,
      ...(portalRefresh
        ? {
          portal_refresh: portalRefresh,
        }
        : {}),
      extracted_refs: uniqueExtractedRefs,
      parsed_refs: uniqueParsedRefs,
      normalized_refs: uniqueNormalizedRefs,
      stored_refs: uniqueStoredRefs,
      disappeared_after_parse: disappearedAfterParse,
      disappeared_after_normalize: disappearedAfterNormalize,
      disappeared_after_store: disappearedAfterStore,
      missing_refs: missingRefs,
      warning:
        reconciliationWarnings.length > 0
          ? reconciliationWarnings.join(" | ")
          : null,
    };
    if (reconciliation.warning) {
      console.warn("[WARN] comment-parser reconciliation", reconciliation);
    }
    console.log("[DEBUG] comment-parser ref stages", {
      extracted_refs: uniqueExtractedRefs,
      parsed_refs: uniqueParsedRefs,
      normalized_refs: uniqueNormalizedRefs,
      extracted_ref_count: extractedSourceRefCount,
      parsed_ref_count: parsedSourceRefCount,
      normalized_count: normalizedRawCommentCount,
      deterministic_parsed_row_count: deterministicParsedRowCount,
      fallback_parsed_row_count: fallbackParsedRowCount,
      inserted_raw_ref_count: insertedRawRefCount,
      inserted_fallback_count: insertedFallbackCount,
      stored_raw_ref_count: countsAfterRefresh.raw_ref,
      stored_fallback_count: countsAfterRefresh.fallback_llm,
      stored_total_count: countsAfterRefresh.total,
      disappeared_after_parse: disappearedAfterParse,
      disappeared_after_normalize: disappearedAfterNormalize,
      disappeared_after_store: disappearedAfterStore,
    });

    if (portalRefreshFailed) {
      return new Response(
        JSON.stringify({
          code: 500,
          message: portalRefreshError,
          parsed_count: parsedCount,
          inserted_raw_ref_count: insertedRawRefCount,
          inserted_fallback_count: insertedFallbackCount,
          skipped_count: skippedTotal,
          insert_error_count: insertErrorCount,
          next_cursor: nextCursor,
          done: true,
          total_pdfs: totalPdfs,
          portal_refresh_failed: true,
          reconciliation,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        parsed_count: parsedCount,
        deterministic_parsed_row_count: deterministicParsedRowCount,
        fallback_parsed_row_count: fallbackParsedRowCount,
        inserted_raw_ref_count: insertedRawRefCount,
        inserted_fallback_count: insertedFallbackCount,
        skipped_count: skippedTotal,
        skipped_breakdown: {
          post_llm_noise: skippedPostLlmNoise,
          duplicate: skippedDuplicate,
          empty_original_text: skippedEmpty,
        },
        insert_error_count: insertErrorCount,
        next_cursor: nextCursor,
        done,
        total_pdfs: totalPdfs,
        reconciliation,
        ...(portalRefresh ? { portal_refresh: portalRefresh } : {}),
        ...(doneReason ? { reason: doneReason, message: doneMessage } : {}),
        ...(capturePipelineEvidence && pipelineEvidence
          ? { pipeline_evidence: pipelineEvidence }
          : {}),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in comment-parser-agent:", error);
    return new Response(
      JSON.stringify({ code: 500, message: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
