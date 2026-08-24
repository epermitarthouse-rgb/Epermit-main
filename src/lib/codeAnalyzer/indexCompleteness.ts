/**
 * Deterministic drawing-set index completeness prescreen.
 * AI may extract index rows when text is sparse; set comparison is always deterministic here.
 */
import type { CodeAnalyzerSheet } from "./model";

export interface IndexSheetEntry {
  /** Normalized sheet number key (e.g. A101). */
  sheetNumber: string;
  /** Display label as extracted or inferred. */
  rawLabel: string;
  title?: string | null;
}

export interface IndexCompletenessDuplicate {
  sheetNumber: string;
  rawLabels: string[];
  sheetIds: string[];
}

export interface IndexCompletenessInconsistency {
  sheetNumber: string;
  variants: string[];
}

export type IndexCompletenessStatus = "complete" | "incomplete" | "no_index";

export interface IndexCompletenessResult {
  status: IndexCompletenessStatus;
  hasIndex: boolean;
  indexSheetId?: string | null;
  expectedCount: number;
  actualCount: number;
  missing: IndexSheetEntry[];
  extra: IndexSheetEntry[];
  duplicates: IndexCompletenessDuplicate[];
  numberingInconsistencies: IndexCompletenessInconsistency[];
  /** Included sheets compared (excluding the index sheet itself when detected). */
  comparedSheetCount: number;
}

export interface ActualSheetLabel {
  sheetId: string;
  sheetNumber: string;
  rawLabel: string;
  title?: string | null;
  sourceDocumentId: string;
  pageNumber: number;
}

/** Normalize sheet numbers so A-101, A101, and A 101 compare equal. */
export function normalizeSheetNumber(label: string | null | undefined): string {
  if (typeof label !== "string") return "";
  return label.trim().toUpperCase().replace(/[\s\-_.]/g, "");
}

const INDEX_TITLE_PATTERN =
  /\b(drawing\s+index|sheet\s+index|index\s+of\s+drawings|drawings?\s+index|sheet\s+list)\b/i;

/** Detect whether a sheet is likely the drawing index. */
export function isLikelyIndexSheet(input: {
  sheetLabel?: string | null;
  fileName?: string | null;
  pageText?: string | null;
}): boolean {
  const parts = [input.sheetLabel, input.fileName, input.pageText].filter(Boolean) as string[];
  for (const part of parts) {
    const base = part.replace(/\.[^.]+$/, "").trim();
    if (/^index$/i.test(base)) return true;
    if (INDEX_TITLE_PATTERN.test(part)) return true;
  }
  return false;
}

const SHEET_NUMBER_PATTERN = /\b([A-Z]{1,3}[-.]?\d{1,4}(?:\.\d+)?)\b/gi;

/** Pull the first plausible sheet number token from a filename or label. */
export function inferSheetNumberFromLabel(label: string | null | undefined): string | null {
  if (typeof label !== "string" || !label.trim()) return null;
  const base = label.replace(/\.[^.]+$/, "").replace(/-page\d+\.png$/i, "");
  const matches = [...base.matchAll(SHEET_NUMBER_PATTERN)];
  if (matches.length === 0) return null;
  const token = matches[0]?.[1];
  if (!token) return null;
  const normalized = normalizeSheetNumber(token);
  return normalized || null;
}

/** Parse index table rows from plain text (deterministic). */
export function parseIndexEntriesFromText(text: string | null | undefined): IndexSheetEntry[] {
  if (typeof text !== "string" || !text.trim()) return [];
  const entries: IndexSheetEntry[] = [];
  const seen = new Set<string>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || INDEX_TITLE_PATTERN.test(line)) continue;

    const rowMatch =
      line.match(/^([A-Z]{1,3}[-.]?\d{1,4}(?:\.\d+)?)\s*[-–—:\t|]\s*(.+)$/i) ||
      line.match(/^([A-Z]{1,3}[-.]?\d{1,4}(?:\.\d+)?)\s{2,}(.+)$/i) ||
      line.match(/^(.+?)\s{2,}([A-Z]{1,3}[-.]?\d{1,4}(?:\.\d+)?)\s*$/i);

    let sheetToken: string | null = null;
    let title: string | null = null;
    if (rowMatch) {
      if (/^[A-Z]/i.test(rowMatch[1])) {
        sheetToken = rowMatch[1];
        title = rowMatch[2]?.trim() ?? null;
      } else {
        title = rowMatch[1]?.trim() ?? null;
        sheetToken = rowMatch[2];
      }
    } else {
      sheetToken = inferSheetNumberFromLabel(line);
      if (sheetToken) {
        title = line.replace(new RegExp(sheetToken, "i"), "").replace(/^[\s\-–—:|]+/, "").trim() || null;
      }
    }

    if (!sheetToken) continue;
    const sheetNumber = normalizeSheetNumber(sheetToken);
    if (!sheetNumber || seen.has(sheetNumber)) continue;
    seen.add(sheetNumber);
    entries.push({
      sheetNumber,
      rawLabel: sheetToken.trim(),
      title,
    });
  }

  return entries;
}

export function actualLabelsFromSheets(
  sheets: CodeAnalyzerSheet[],
  opts?: { pageTextBySheetId?: Record<string, string> },
): ActualSheetLabel[] {
  const included = sheets.filter((s) => !s.excluded);
  return included.map((sheet) => {
    const rawLabel =
      sheet.sheet_label?.trim() ||
      inferSheetNumberFromLabel(sheet.file_name) ||
      sheet.file_name?.replace(/\.[^.]+$/, "").trim() ||
      `page-${sheet.page_number}`;
    const sheetNumber =
      normalizeSheetNumber(sheet.sheet_label || inferSheetNumberFromLabel(rawLabel) || rawLabel) ||
      `${sheet.source_document_id}:${sheet.page_number}`;
    const pageText = opts?.pageTextBySheetId?.[sheet.id];
    return {
      sheetId: sheet.id,
      sheetNumber,
      rawLabel,
      title: pageText?.trim() || null,
      sourceDocumentId: sheet.source_document_id,
      pageNumber: sheet.page_number,
    };
  });
}

export function detectIndexSheet(
  sheets: CodeAnalyzerSheet[],
  opts?: { pageTextBySheetId?: Record<string, string> },
): CodeAnalyzerSheet | null {
  const included = sheets.filter((s) => !s.excluded);
  for (const sheet of included) {
    if (
      isLikelyIndexSheet({
        sheetLabel: sheet.sheet_label,
        fileName: sheet.file_name,
        pageText: opts?.pageTextBySheetId?.[sheet.id],
      })
    ) {
      return sheet;
    }
  }
  return null;
}

/** Deterministic set diff — AI output must be parsed into entries before calling this. */
export function compareIndexCompleteness(
  expected: IndexSheetEntry[],
  actual: ActualSheetLabel[],
  opts?: { indexSheetId?: string | null },
): IndexCompletenessResult {
  if (expected.length === 0) {
    return {
      status: "no_index",
      hasIndex: false,
      indexSheetId: opts?.indexSheetId ?? null,
      expectedCount: 0,
      actualCount: 0,
      missing: [],
      extra: [],
      duplicates: [],
      numberingInconsistencies: [],
      comparedSheetCount: actual.filter((a) => a.sheetId !== opts?.indexSheetId).length,
    };
  }

  const actualComparable = actual.filter((a) => a.sheetId !== opts?.indexSheetId);
  const expectedMap = new Map(expected.map((e) => [e.sheetNumber, e]));
  const actualByNumber = new Map<string, ActualSheetLabel[]>();

  for (const row of actualComparable) {
    const list = actualByNumber.get(row.sheetNumber) ?? [];
    list.push(row);
    actualByNumber.set(row.sheetNumber, list);
  }

  const missing: IndexSheetEntry[] = [];
  for (const entry of expected) {
    if (!actualByNumber.has(entry.sheetNumber)) {
      missing.push(entry);
    }
  }

  const extra: IndexSheetEntry[] = [];
  for (const [sheetNumber, rows] of actualByNumber) {
    if (!expectedMap.has(sheetNumber)) {
      for (const row of rows) {
        extra.push({
          sheetNumber,
          rawLabel: row.rawLabel,
          title: row.title,
        });
      }
    }
  }

  const duplicates: IndexCompletenessDuplicate[] = [];
  const numberingInconsistencies: IndexCompletenessInconsistency[] = [];
  for (const [sheetNumber, rows] of actualByNumber) {
    const rawLabels = [...new Set(rows.map((r) => r.rawLabel))];
    if (rows.length > 1) {
      duplicates.push({
        sheetNumber,
        rawLabels,
        sheetIds: rows.map((r) => r.sheetId),
      });
    }
    const normalizedVariants = [...new Set(rows.map((r) => normalizeSheetNumber(r.rawLabel)))];
    if (normalizedVariants.length > 1) {
      numberingInconsistencies.push({
        sheetNumber,
        variants: rawLabels,
      });
    }
  }

  const status: IndexCompletenessStatus =
    missing.length === 0 && extra.length === 0 && duplicates.length === 0 ? "complete" : "incomplete";

  return {
    status,
    hasIndex: true,
    indexSheetId: opts?.indexSheetId ?? null,
    expectedCount: expected.length,
    actualCount: actualComparable.length,
    missing,
    extra,
    duplicates,
    numberingInconsistencies,
    comparedSheetCount: actualComparable.length,
  };
}

export function runIndexCompletenessPrescreen(
  sheets: CodeAnalyzerSheet[],
  opts?: {
    pageTextBySheetId?: Record<string, string>;
    indexEntries?: IndexSheetEntry[] | null;
  },
): IndexCompletenessResult {
  const indexSheet = detectIndexSheet(sheets, opts);
  if (!indexSheet) {
    const actual = actualLabelsFromSheets(sheets, opts);
    return {
      status: "no_index",
      hasIndex: false,
      indexSheetId: null,
      expectedCount: 0,
      actualCount: actual.length,
      missing: [],
      extra: [],
      duplicates: [],
      numberingInconsistencies: [],
      comparedSheetCount: actual.length,
    };
  }

  const expected =
    opts?.indexEntries && opts.indexEntries.length > 0
      ? opts.indexEntries
      : parseIndexEntriesFromText(opts?.pageTextBySheetId?.[indexSheet.id]);

  const actual = actualLabelsFromSheets(sheets, opts);
  return compareIndexCompleteness(expected, actual, { indexSheetId: indexSheet.id });
}
