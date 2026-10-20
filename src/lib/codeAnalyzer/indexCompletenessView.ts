/**
 * Display model for drawing-index completeness.
 * Reclassifies a stored result for the pre-screen card. It does not rewrite the run.
 */
import type { AnalysisCoverageSnapshot, IndexCompletenessResult, IndexSheetEntry } from "./indexCompleteness";
import { canonicalSheetNumber } from "./indexCompleteness";

/** Common construction-document prefixes. Not a project filename list. */
const DISCIPLINE_PREFIX =
  "A|AD|C|CS|D|E|EL|EN|EQ|F|FA|FP|FS|G|H|I|ID|L|LA|LS|M|ME|MP|P|PL|Q|R|S|SE|SD|SP|SS|ST|T";

const STRUCTURED_SHEET = new RegExp(
  `^(?:${DISCIPLINE_PREFIX})[-.]?\\d{1,4}(?:\\.\\d{1,2})?(?:[-.]0{1,2}){0,2}$`,
  "i",
);
const CANONICAL_SHEET = new RegExp(`^(?:${DISCIPLINE_PREFIX})\\d{1,4}$`, "i");

export interface PresentedSheetRef {
  key: string;
  label: string;
  detail: string | null;
}

export interface IndexCompletenessPresentation {
  indexStatus: "detected" | "partial" | "not_detected";
  statusLabel: "Detected" | "Partial" | "Not Detected";
  headline: string;
  uploadedSheets: number;
  matchedSheets: number;
  missingSheets: number;
  /** Null when a partial index read must not be counted as extra sheets. */
  extraSheets: number | null;
  ocrUncertain: number;
  coverageUncertain: boolean;
  missing: PresentedSheetRef[];
  extra: PresentedSheetRef[];
  extraGroupTitle: string;
  extraGroupNote: string | null;
  uncertain: PresentedSheetRef[];
  matchedNote: string;
  duplicates: PresentedSheetRef[];
  inconsistencies: PresentedSheetRef[];
  note: string | null;
  coverageLine: string | null;
  coverageDisclaimer: string;
  coverageSheets: string[];
}

export function asIndexCompletenessResult(value: unknown): IndexCompletenessResult | null {
  if (!value || typeof value !== "object") return null;
  const row = value as IndexCompletenessResult;
  if (typeof row.status !== "string" || typeof row.hasIndex !== "boolean") return null;
  if (!Array.isArray(row.missing) || !Array.isArray(row.extra)) return null;
  return row;
}

/** A token is a drawing id when its letters are a discipline prefix and the rest is a sheet number. */
export function isConfidentDrawingIdentifier(rawLabel: string, sheetNumber?: string): boolean {
  const raw = rawLabel.trim();
  if (!raw) return false;
  // All-zero tokens such as A-00 are OCR fragments. G-000 remains a cover sheet number.
  if (!/[1-9]/.test(raw) && !/^G[-.]?0{2,4}$/i.test(raw)) return false;
  if (STRUCTURED_SHEET.test(raw) || /^\d{2,4}$/.test(raw) || /^G[-.]?0{2,4}$/i.test(raw)) return true;
  const key = canonicalSheetNumber(sheetNumber || raw);
  if (!key || (!/[1-9]/.test(key) && !/^G0{2,4}$/.test(key))) return false;
  return CANONICAL_SHEET.test(key) || /^G0{2,4}$/.test(key);
}

/** Human sheet id, with trailing zero revision groups removed. Original OCR text stays available. */
export function displaySheetIdentifier(rawLabel: string): string {
  const original = rawLabel.trim();
  const normalized = original.toUpperCase().replace(/(?<=\d)(?:[.-]0{1,2}){1,2}$/, "");
  if (!normalized || normalized === original.toUpperCase()) return original;
  return `${normalized} (OCR: ${original})`;
}

function shortDetail(title?: string | null): string | null {
  if (!title) return null;
  const clean = title.replace(/\s+/g, " ").trim();
  if (!clean || clean.length > 80) return null;
  return clean;
}

function presentEntry(row: IndexSheetEntry, suffix?: string | null): PresentedSheetRef {
  return {
    key: `${row.sheetNumber}:${row.rawLabel}`,
    label: displaySheetIdentifier(row.rawLabel || row.sheetNumber),
    detail: suffix ?? shortDetail(row.title),
  };
}

function uploadedCount(result: IndexCompletenessResult): number {
  return result.comparedSheetCount || result.actualCount || 0;
}

function sourceRank(result: IndexCompletenessResult): number {
  if (result.indexSource === "text" || result.indexSource === "vision") return 3;
  if (result.indexSource === "vision+ocr") return 2;
  if (result.indexSource === "ocr") return 1;
  // Older snapshots omitted indexSource. A large recognized set is a real index read.
  if (result.hasIndex && (result.expectedCount || 0) >= 8) return 2;
  return result.hasIndex ? 1 : 0;
}

function freshness(result: IndexCompletenessResult): number {
  const stamps = [result.reconciledAt, result.analysisCoverage?.updatedAt];
  let latest = 0;
  for (const stamp of stamps) {
    const parsed = stamp ? Date.parse(stamp) : NaN;
    if (!Number.isNaN(parsed)) latest = Math.max(latest, parsed);
  }
  return latest;
}

/**
 * A sparse OCR read is not a complete index. Nine recognized tokens against a large
 * upload must not make every other sheet "extra" or every unrecognized token "missing".
 */
export function isPartialIndexRead(result: IndexCompletenessResult): boolean {
  if (!result.hasIndex || result.status === "no_index") return false;
  if (result.status === "index_unreadable") return true;
  const uploaded = uploadedCount(result);
  const recognized = result.expectedCount || 0;
  if (uploaded < 8 || recognized <= 0) return false;
  const sparse = recognized / uploaded < 0.5 && uploaded - recognized >= 8;
  if (sparse) return true;
  const ocrOnly = result.indexSource === "ocr" || result.indexSource == null;
  const extra = result.extra?.length ?? 0;
  return ocrOnly && extra >= 8 && extra / uploaded >= 0.5;
}

function newerCoverage(
  prev: AnalysisCoverageSnapshot | null | undefined,
  incoming: AnalysisCoverageSnapshot | null | undefined,
): AnalysisCoverageSnapshot | null | undefined {
  if (!prev) return incoming;
  if (!incoming) return prev;
  const prevTime = Date.parse(prev.updatedAt || "") || 0;
  const incomingTime = Date.parse(incoming.updatedAt || "") || 0;
  return incomingTime >= prevTime ? incoming : prev;
}

/**
 * Keep the fuller index read. A later poll may still carry an earlier OCR pass;
 * that pass must not replace a read that already recognized more of the index.
 * Coverage always follows the newer snapshot.
 */
export function mergeIndexCompleteness(
  prev: IndexCompletenessResult | null | undefined,
  incoming: IndexCompletenessResult | null | undefined,
): IndexCompletenessResult | null {
  if (!incoming) return prev ?? null;
  if (!prev) return incoming;

  const coverage = newerCoverage(prev.analysisCoverage, incoming.analysisCoverage);
  const withCoverage = (body: IndexCompletenessResult): IndexCompletenessResult => ({
    ...body,
    analysisCoverage: coverage ?? body.analysisCoverage,
  });

  if (prev.hasIndex && !incoming.hasIndex) return withCoverage(prev);
  if (!prev.hasIndex && incoming.hasIndex) return withCoverage(incoming);

  const prevRank = sourceRank(prev);
  const incomingRank = sourceRank(incoming);
  if (incomingRank !== prevRank) return withCoverage(incomingRank > prevRank ? incoming : prev);
  if (incoming.expectedCount !== prev.expectedCount) {
    return withCoverage(incoming.expectedCount > prev.expectedCount ? incoming : prev);
  }

  const prevTime = freshness(prev);
  const incomingTime = freshness(incoming);
  if (prevTime && (!incomingTime || incomingTime < prevTime)) return withCoverage(prev);
  return withCoverage({ ...prev, ...incoming });
}

function coverageLine(coverage: AnalysisCoverageSnapshot | null | undefined): string | null {
  if (!coverage) return null;
  const pending =
    coverage.sheetsPendingOrFailed > 0 ? ` · ${coverage.sheetsPendingOrFailed} pending or failed` : "";
  return `${coverage.sheetsAnalyzed} / ${coverage.eligibleSheetCount} sheets analyzed · ${coverage.sheetsWithFindings} sheets with findings · ${coverage.sheetsWithoutFindings.length} without published findings${pending}`;
}

export function presentIndexCompleteness(result: IndexCompletenessResult): IndexCompletenessPresentation {
  const uploadedSheets = uploadedCount(result);
  const partial = isPartialIndexRead(result);
  const missing: PresentedSheetRef[] = [];
  const uncertain: PresentedSheetRef[] = [];
  const seenUncertain = new Set<string>();

  const pushUncertain = (row: IndexSheetEntry, reason: string) => {
    const key = `${row.sheetNumber}:${row.rawLabel}`;
    if (seenUncertain.has(key)) return;
    seenUncertain.add(key);
    uncertain.push(presentEntry(row, reason));
  };

  if (result.hasIndex && result.status !== "index_unreadable" && result.status !== "no_index") {
    for (const row of result.missing) {
      if (isConfidentDrawingIdentifier(row.rawLabel, row.sheetNumber)) missing.push(presentEntry(row));
      else pushUncertain(row, "Unrecognized OCR token");
    }
    for (const row of result.unmatchedIndexRows ?? []) {
      const reason =
        row.reason === "ocr_fragment"
          ? "Partial OCR read"
          : row.reason === "likely_misread"
            ? "Close to an uploaded sheet number"
            : "Unrecognized OCR token";
      pushUncertain(row, reason);
    }
  }

  const matchedSheets =
    typeof result.matchedCount === "number"
      ? result.matchedCount
      : Math.max(0, (result.expectedCount || 0) - result.missing.length - (result.unmatchedIndexRows?.length ?? 0));

  const indexStatus: IndexCompletenessPresentation["indexStatus"] = !result.hasIndex || result.status === "no_index"
    ? "not_detected"
    : partial
      ? "partial"
      : "detected";

  const extraSheets = indexStatus === "detected" ? result.extra.length : null;
  const extra = result.extra.map((row) => presentEntry(row));

  let headline = "Index matches the included drawing set.";
  if (indexStatus === "not_detected") {
    headline = "No drawing index was detected, so completeness was not compared.";
  } else if (partial) {
    headline = "Index partially recognized — completeness uncertain.";
  } else if (missing.length > 0 || result.extra.length > 0 || result.duplicates.length > 0) {
    headline = "The index and the uploaded sheets differ. Review the details before relying on this check.";
  }

  return {
    indexStatus,
    statusLabel: indexStatus === "not_detected" ? "Not Detected" : indexStatus === "partial" ? "Partial" : "Detected",
    headline,
    uploadedSheets,
    matchedSheets: indexStatus === "not_detected" ? 0 : matchedSheets,
    missingSheets: missing.length,
    extraSheets,
    ocrUncertain: uncertain.length,
    coverageUncertain: partial,
    missing,
    extra,
    extraGroupTitle: partial ? "Uploaded sheets absent from a partial index" : "Extra / not listed in index",
    extraGroupNote: partial
      ? "These uploaded sheets were not in the partial index read. They are not confirmed extra drawings."
      : null,
    uncertain,
    matchedNote:
      indexStatus === "not_detected"
        ? "No index was compared."
        : `${matchedSheets} uploaded sheet ${matchedSheets === 1 ? "number matches" : "numbers match"} the index. Matched names are not stored separately from the index result.`,
    duplicates: result.duplicates.map((dup) => ({
      key: dup.sheetNumber,
      label: dup.sheetNumber,
      detail: dup.rawLabels.join(", "),
    })),
    inconsistencies: result.numberingInconsistencies.map((item) => ({
      key: item.sheetNumber,
      label: item.sheetNumber,
      detail: item.variants.join(" vs "),
    })),
    note: result.indexReadNote?.trim() || result.indexReadError?.trim() || null,
    coverageLine: coverageLine(result.analysisCoverage),
    coverageDisclaimer: "No published findings does not mean the sheet was verified as code compliant.",
    coverageSheets: result.analysisCoverage?.sheetsWithoutFindings ?? [],
  };
}
