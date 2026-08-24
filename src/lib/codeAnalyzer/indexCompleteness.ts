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
  /** When false, excluded from missing/extra/duplicate comparison. */
  comparable?: boolean;
}

/** Normalize sheet numbers so A-101, A101, and A 101 compare equal. */
export function normalizeSheetNumber(label: string | null | undefined): string {
  if (typeof label !== "string") return "";
  return label.trim().toUpperCase().replace(/[\s\-_.]/g, "");
}

const INDEX_TITLE_PATTERN =
  /\b(drawing\s+index|sheet\s+index|index\s+of\s+drawings|drawings?\s+index|sheet\s+list)\b/i;

/** Cover / general index sheet numbers (G000, G-000, G001, etc.). */
const INDEX_COVER_SHEET_PATTERN = /^G[-.]?0{2,3}\d?$/i;

function normalizeIndexText(value: string): string {
  return value
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]page\d+$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textLooksLikeIndexTitle(value: string): boolean {
  const normalized = normalizeIndexText(value);
  if (!normalized) return false;
  if (/^index$/i.test(normalized)) return true;
  return INDEX_TITLE_PATTERN.test(normalized);
}

function sheetLabelLooksLikeIndexCover(label: string | null | undefined): boolean {
  if (typeof label !== "string" || !label.trim()) return false;
  const normalized = normalizeSheetNumber(label);
  return INDEX_COVER_SHEET_PATTERN.test(normalized);
}

function indexCoverEntryFromText(text: string | null | undefined): IndexSheetEntry | null {
  for (const entry of parseIndexEntriesFromText(text)) {
    if (
      sheetLabelLooksLikeIndexCover(entry.rawLabel) ||
      sheetLabelLooksLikeIndexCover(entry.sheetNumber)
    ) {
      return entry;
    }
  }
  return null;
}

/** Remove project/spec number tokens (e.g. SPEC #24-070, Project 24-070) before sheet-number inference. */
function stripProjectSpecNumberFragments(label: string): string {
  return label
    .replace(/#\d{1,4}-\d{2,4}\b/gi, " ")
    .replace(/\b(?:SPEC|PROJECT|JOB(?:\s+NO\.?)?)\s*#?\d{1,4}-\d{2,4}\b/gi, " ")
    .replace(/\b\d{1,4}-\d{2,4}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when a normalized token is a drawing sheet number, not a project/spec id fragment. */
export function isCredibleDrawingSheetNumber(normalized: string | null | undefined): boolean {
  if (typeof normalized !== "string" || !normalized.trim()) return false;
  const token = normalized.trim().toUpperCase();
  if (/^[A-Z]{1,3}\d{1,4}(?:\.\d+)?$/.test(token)) return true;
  if (/^G\d{2,4}$/.test(token)) return true;
  if (/^\d{2,4}$/.test(token)) return true;
  return false;
}

/** Detect whether a sheet is likely the drawing index. */
export function isLikelyIndexSheet(input: {
  sheetLabel?: string | null;
  fileName?: string | null;
  pageText?: string | null;
}): boolean {
  const parts = [input.sheetLabel, input.fileName, input.pageText].filter(Boolean) as string[];
  for (const part of parts) {
    if (textLooksLikeIndexTitle(part)) return true;
  }

  const fileName = input.fileName ?? "";
  const label = input.sheetLabel ?? "";
  const pageText = input.pageText ?? "";
  const filenameHintsIndex =
    /drawing[\s_-]*index|sheet[\s_-]*index|index[\s_-]*of[\s_-]*drawings?/i.test(fileName);
  if (filenameHintsIndex && (sheetLabelLooksLikeIndexCover(label) || INDEX_TITLE_PATTERN.test(pageText))) {
    return true;
  }
  if (sheetLabelLooksLikeIndexCover(label) && filenameHintsIndex) {
    return true;
  }

  return false;
}

/** Discipline prefix + number (A101) or numeric-only index rows (001, G000). */
const SHEET_NUMBER_PATTERN =
  /\b((?:[A-Z]{1,3}[-.]?\d{1,4}(?:\.\d+)?)|(?:G[-.]?\d{2,4})|(?:\d{2,4}))\b/gi;

function pickBestSheetNumberToken(label: string): string | null {
  const matches = [...label.matchAll(SHEET_NUMBER_PATTERN)];
  if (matches.length === 0) return null;
  // Prefer tokens at the start of the label (e.g. "001-COVER SHEET" → 001).
  const leading = matches.find((m) => (m.index ?? 0) <= 2);
  const token = (leading ?? matches[0])?.[1];
  if (!token) return null;
  const normalized = normalizeSheetNumber(token);
  return normalized || null;
}

/** Pull the first plausible sheet number token from a filename or label. */
export function inferSheetNumberFromLabel(label: string | null | undefined): string | null {
  if (typeof label !== "string" || !label.trim()) return null;
  const base = label.replace(/\.[^.]+$/, "").replace(/-page\d+$/i, "");
  const stripped = stripProjectSpecNumberFragments(base);
  if (!stripped) return null;
  return pickBestSheetNumberToken(stripped);
}

/** True when a token is a sheet number (A101, G000, 001), not a title fragment. */
function looksLikeSheetNumberToken(token: string | null | undefined): boolean {
  if (typeof token !== "string" || !token.trim()) return false;
  const trimmed = token.trim();
  if (/^(?:[A-Z]{1,3}[-.]?\d{1,4}(?:\.\d+)?|G[-.]?\d{2,4}|\d{2,4})$/i.test(trimmed)) {
    return true;
  }
  return Boolean(inferSheetNumberFromLabel(trimmed));
}

/** Parse index table rows from plain text (deterministic). */
export function parseIndexEntriesFromText(text: string | null | undefined): IndexSheetEntry[] {
  if (typeof text !== "string" || !text.trim()) return [];
  const entries: IndexSheetEntry[] = [];
  const seen = new Set<string>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || INDEX_TITLE_PATTERN.test(line)) continue;

    const sheetTokenPattern = String.raw`((?:[A-Z]{1,3}[-.]?\d{1,4}(?:\.\d+)?)|(?:G[-.]?\d{2,4})|(?:\d{2,4}))`;
    const rowMatch =
      line.match(new RegExp(`^${sheetTokenPattern}\\s*[-–—:\\t|]\\s*(.+)$`, "i")) ||
      line.match(new RegExp(`^${sheetTokenPattern}\\s{2,}(.+)$`, "i")) ||
      line.match(new RegExp(`^(.+?)\\s{2,}${sheetTokenPattern}\\s*$`, "i"));

    let sheetToken: string | null = null;
    let title: string | null = null;
    if (rowMatch) {
      const first = rowMatch[1]?.trim() ?? "";
      const second = rowMatch[2]?.trim() ?? "";
      if (looksLikeSheetNumberToken(first) && !looksLikeSheetNumberToken(second)) {
        sheetToken = first;
        title = second || null;
      } else if (looksLikeSheetNumberToken(second) && !looksLikeSheetNumberToken(first)) {
        title = first || null;
        sheetToken = second;
      } else if (/^[A-Z]/i.test(first)) {
        sheetToken = first;
        title = second || null;
      } else {
        sheetToken = inferSheetNumberFromLabel(line);
        if (sheetToken) {
          title = line.replace(new RegExp(sheetToken, "i"), "").replace(/^[\s\-–—:|]+/, "").trim() || null;
        }
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
  opts?: { pageTextBySheetId?: Record<string, string>; indexSheetId?: string | null },
): ActualSheetLabel[] {
  const included = sheets.filter((s) => !s.excluded);
  const indexSheetId =
    opts?.indexSheetId ?? detectIndexSheet(sheets, opts)?.id ?? null;
  return included.map((sheet) => {
    const pageText = opts?.pageTextBySheetId?.[sheet.id];
    const isIndexSheet =
      sheet.id === indexSheetId ||
      isLikelyIndexSheet({
        sheetLabel: sheet.sheet_label,
        fileName: sheet.file_name,
        pageText,
      });
    const indexCoverEntry =
      isIndexSheet && pageText ? indexCoverEntryFromText(pageText) : null;

    const inferredFromFile = inferSheetNumberFromLabel(sheet.file_name);
    const inferredFromLabel = sheet.sheet_label?.trim()
      ? normalizeSheetNumber(sheet.sheet_label)
      : null;
    const indexCoverNumber = indexCoverEntry?.sheetNumber ?? null;
    const sheetNumberCandidate =
      inferredFromLabel ||
      indexCoverNumber ||
      (inferredFromFile ? normalizeSheetNumber(inferredFromFile) : null);
    const comparable = Boolean(
      sheetNumberCandidate && isCredibleDrawingSheetNumber(sheetNumberCandidate),
    );

    const rawLabel =
      sheet.sheet_label?.trim() ||
      indexCoverEntry?.rawLabel ||
      inferredFromFile ||
      sheet.file_name?.replace(/\.[^.]+$/, "").trim() ||
      `page-${sheet.page_number}`;

    return {
      sheetId: sheet.id,
      sheetNumber: comparable ? sheetNumberCandidate! : "",
      rawLabel,
      title: pageText?.trim() || null,
      sourceDocumentId: sheet.source_document_id,
      pageNumber: sheet.page_number,
      comparable,
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

  const indexSheetId = opts?.indexSheetId ?? null;
  const indexSheetRow =
    indexSheetId != null ? actual.find((a) => a.sheetId === indexSheetId) : undefined;
  const indexSheetNumber = indexSheetRow?.sheetNumber ?? null;

  const actualComparable = actual.filter(
    (a) => a.sheetId !== indexSheetId && a.comparable !== false && a.sheetNumber,
  );
  const expectedMap = new Map(expected.map((e) => [e.sheetNumber, e]));
  const actualByNumber = new Map<string, ActualSheetLabel[]>();

  for (const row of actualComparable) {
    const list = actualByNumber.get(row.sheetNumber) ?? [];
    list.push(row);
    actualByNumber.set(row.sheetNumber, list);
  }

  const missing: IndexSheetEntry[] = [];
  for (const entry of expected) {
    if (actualByNumber.has(entry.sheetNumber)) continue;
    // Index sheet row satisfies its own expected entry (e.g. G000 on drawing index).
    if (indexSheetId) {
      if (indexSheetNumber && entry.sheetNumber === indexSheetNumber) continue;
      if (
        sheetLabelLooksLikeIndexCover(entry.rawLabel) ||
        sheetLabelLooksLikeIndexCover(entry.sheetNumber)
      ) {
        continue;
      }
    }
    missing.push(entry);
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

  const actual = actualLabelsFromSheets(sheets, {
    ...opts,
    indexSheetId: indexSheet.id,
  });
  return compareIndexCompleteness(expected, actual, { indexSheetId: indexSheet.id });
}
