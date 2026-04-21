/**
 * PGC ePlan "Plan Review - Review Comments" — single deterministic parser for raw PDF text.
 * Shared by comment-parser-agent and UI (via src/lib re-export).
 *
 * Fixes flattened rows like `713rd Party...` (wrongly read as ref 71 / cycle 3): the digit run
 * before the ordinal is `71` → ref=7, cycle=1. The token `3rd` is part of "3rd Party" (reviewer),
 * not the cycle — we keep it on the first line after ref/cycle so Reviewed by / discipline labels stay correct.
 */

export type PgcReviewCommentsRow = {
  ref: string;
  cycle: string;
  reviewedBy: string;
  dateTime: string;
  type: string;
  filename: string;
  discussion: string;
  /** Portal workflow status: Resolved, UnResolved, Info Only, etc. */
  status: string;
  /** Verbatim block text for this comment (audit / debug). */
  originalTextBlock: string;
};

const STATUS_LINE_RE =
  /^(Info\s*Only|UnResolved|Unresolved|Resolved|InfoOnly)$/i;

/** Type line after filename / mid-block. */
const TYPE_LINE_RE =
  /^(Comment|Changemark|Library\s+Comment|Checklist\s+Item|Question)(?:\s|$)/i;

/** Leading ref+cycle glued before English ordinal (3rd, 2nd, …). */
const FLAT_NUMERIC_HEADER_RE =
  /^(\d+)(\d+(?:st|nd|rd|th))\b\s*(.*)$/i;

function splitLeadingRefCycleOrdinalFirstLine(
  line: string,
): { ref: string; cycle: string; restOfFirstLine: string } | null {
  const t = line.trim();
  const m = t.match(FLAT_NUMERIC_HEADER_RE);
  if (!m) return null;
  const digitRun = m[1]!;
  if (digitRun.length < 2) return null;
  const ref = digitRun.slice(0, -1);
  const cycle = digitRun.slice(-1);
  /** Group 2 is e.g. `3rd` — keep it in reviewer text ("3rd Party Mechanical"). */
  const ordinalToken = (m[2] ?? "").trim();
  const afterOrdinal = (m[3] ?? "").trim();
  const restOfFirstLine = [ordinalToken, afterOrdinal].filter(Boolean).join(" ").trim();
  return { ref, cycle, restOfFirstLine };
}

/**
 * Lines that are only a comment index (`1`, `2`, …) then role/name/date on following lines
 * (common in PGC exports). Ref = that number; cycle empty.
 */
function splitIndexOnlyLine(line: string): { ref: string; cycle: string; restOfFirstLine: string } | null {
  const t = line.trim();
  if (!/^\d{1,4}$/.test(t)) return null;
  const n = parseInt(t, 10);
  if (n < 1 || n > 999) return null;
  if (n >= 1900 && n <= 2100) return null;
  return { ref: String(n), cycle: "", restOfFirstLine: "" };
}

/**
 * `1Plan Coordinator`, `2Plan Coordinator` (ref digit glued to a capital letter, no space).
 * Legacy `splitRefCycleLegacyStacked` needs ≥2 digits; index-only needs a line of only digits — both miss this.
 */
function splitSingleDigitGluedRefThenLetter(line: string): { ref: string; cycle: string; restOfFirstLine: string } | null {
  const t = line.trim();
  if (splitLeadingRefCycleOrdinalFirstLine(t)) return null;
  const m = t.match(/^([1-9])([A-Z][^\n]*)$/);
  if (!m) return null;
  return { ref: m[1]!, cycle: "", restOfFirstLine: m[2]!.trim() };
}

/**
 * `REF # 12` / `REF # 7` rows where CYCLE is blank in the export — cycle is optional (empty string).
 */
function splitRefSharpFirstLine(line: string): { ref: string; cycle: string; restOfFirstLine: string } | null {
  const t = line.trim();
  const m = t.match(/^REF\s*#\s*(\d+)\s*(.*)$/i);
  if (!m) return null;
  const ref = m[1]!;
  let rest = (m[2] ?? "").trim();
  let cycle = "";
  const cycleM = rest.match(/^CYCLE\s*[:#]?\s*(\d+)\s*(.*)$/i);
  if (cycleM) {
    cycle = cycleM[1]!;
    rest = (cycleM[2] ?? "").trim();
  }
  return { ref, cycle, restOfFirstLine: rest };
}

function findFirstPdfLineIndex(lines: string[], from: number): number {
  for (let i = from; i < lines.length; i++) {
    if (/\.pdf\b/i.test(lines[i]!)) return i;
  }
  return -1;
}

/** Same glue fixes as normalizePgcFlattenedReviewCommentsText — keeps UI/server aligned. */
export function preprocessPgcReviewCommentsExtractText(raw: string): string {
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

function isBoilerplateLine(t: string): boolean {
  if (!t.trim()) return false;
  if (/^report\s+(generated\s+)?from\s+ProjectDox/i.test(t)) return true;
  if (/^Plan\s+Review\s*-\s*Review\s+Comments/i.test(t) && t.length < 120) {
    return true;
  }
  if (/^Project\s+Name:/i.test(t)) return true;
  if (/^Report\s+[Dd]ate:/i.test(t)) return true;
  if (/^Workflow\s+Started:/i.test(t)) return true;
  if (/Created\s+in\s+ProjectDox/i.test(t)) return true;
  const compact = t.replace(/\s+/g, "");
  if (/REF#?CYCLE.*REVIEWEDBY.*TYPE.*FILENAME.*DISCUSSION.*STATUS/i.test(compact)) {
    return true;
  }
  if (/^REF\s*#\s*CYCLE.*REVIEWED\s*BY.*TYPE/i.test(compact)) return true;
  return false;
}

function findFirstCommentLineIndex(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (!t || isBoilerplateLine(t)) continue;
    if (splitLeadingRefCycleOrdinalFirstLine(t)) return i;
    if (splitRefSharpFirstLine(t)) return i;
    if (splitIndexOnlyLine(t)) return i;
    if (splitSingleDigitGluedRefThenLetter(t)) return i;
    if (/^REF\s*#\s*\d+/i.test(t)) return i;
    if (/^REVIEW\s+COMMENTS\s*$/i.test(t)) {
      return i + 1 < lines.length ? i + 1 : i;
    }
  }
  return 0;
}

function findTimestampIndex(lines: string[], from: number): number {
  for (let i = from; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(t)) return i;
  }
  return -1;
}

function findStatusIndexFromEnd(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i]!.trim();
    if (!t) continue;
    if (STATUS_LINE_RE.test(t)) return i;
  }
  return -1;
}

/** Legacy stacked block: first line `digits + letter` (non-ordinal); used as fallback. */
function splitRefCycleLegacyStacked(line: string): {
  ref: string;
  cycle: string;
  reviewedByRest: string;
} | null {
  const t = line.trim();
  const m = t.match(/^(\d+)([A-Za-z].*)$/);
  if (!m) return null;
  const digits = m[1];
  const rest = m[2];
  if (digits.length < 2) return null;
  if (/\d+(?:st|nd|rd|th)\b/i.test(t)) return null;

  type Cand = { ref: string; cycle: string; score: number };
  const cands: Cand[] = [];
  for (let i = 1; i < digits.length; i++) {
    const ref = digits.slice(0, i);
    const cycle = digits.slice(i);
    const c = parseInt(cycle, 10);
    if (Number.isNaN(c) || c > 99 || cycle.length > 2) continue;
    if (ref.length > 4) continue;
    const score = cycle.length === 1 ? 100 : 50 - cycle.length;
    cands.push({ ref, cycle, score });
  }
  if (cands.length === 0) return null;
  cands.sort((a, b) => b.score - a.score);
  const best = cands[0]!;
  return { ref: best.ref, cycle: best.cycle, reviewedByRest: rest };
}

function parseBlock(trimmedLines: string[], originalBlock: string): PgcReviewCommentsRow | null {
  if (trimmedLines.length === 0) return null;
  const first = trimmedLines[0]!.trim();

  let ref = "";
  let cycle = "";
  let headRest = "";

  const flat = splitLeadingRefCycleOrdinalFirstLine(first);
  const refSharp = !flat ? splitRefSharpFirstLine(first) : null;
  const indexOnly = !flat && !refSharp ? splitIndexOnlyLine(first) : null;
  const singleGlued = !flat && !refSharp && !indexOnly ? splitSingleDigitGluedRefThenLetter(first) : null;
  if (flat) {
    ref = flat.ref;
    cycle = flat.cycle;
    headRest = flat.restOfFirstLine;
  } else if (refSharp) {
    ref = refSharp.ref;
    cycle = refSharp.cycle;
    headRest = refSharp.restOfFirstLine;
  } else if (indexOnly) {
    ref = indexOnly.ref;
    cycle = indexOnly.cycle;
    headRest = indexOnly.restOfFirstLine;
  } else if (singleGlued) {
    ref = singleGlued.ref;
    cycle = singleGlued.cycle;
    headRest = singleGlued.restOfFirstLine;
  } else {
    const legacy = splitRefCycleLegacyStacked(first);
    if (legacy) {
      ref = legacy.ref;
      cycle = legacy.cycle;
      headRest = legacy.reviewedByRest;
    } else {
      return null;
    }
  }

  const tsIdx = findTimestampIndex(trimmedLines, 1);
  let reviewedEnd: number;
  let dateTime = "";

  if (tsIdx !== -1) {
    reviewedEnd = tsIdx;
    dateTime = trimmedLines[tsIdx]!.trim();
  } else {
    /** No date line: cycle may be blank; still split reviewed-by vs filename/discussion using first .pdf line. */
    const pdfIdx = findFirstPdfLineIndex(trimmedLines, 1);
    if (pdfIdx !== -1) {
      reviewedEnd = pdfIdx;
    } else {
      reviewedEnd = Math.min(3, trimmedLines.length);
    }
  }

  const reviewedByParts = [headRest, ...trimmedLines.slice(1, reviewedEnd).map((l) => l.trim())];
  const reviewedBy = reviewedByParts.filter((p) => p.length > 0).join("\n").trim();

  let idx: number;
  if (tsIdx !== -1) {
    idx = tsIdx + 1;
    if (idx < trimmedLines.length) {
      const maybeTime = trimmedLines[idx]!.trim();
      const dateHasClock = /\d{1,2}:\d{2}/.test(dateTime);
      if (
        !dateHasClock &&
        (/^\d{1,2}:\d{2}/.test(maybeTime) || /\b(AM|PM)\b/i.test(maybeTime))
      ) {
        dateTime += " " + maybeTime;
        idx++;
      }
    }
  } else {
    idx = reviewedEnd;
  }

  let filename = "";
  if (idx < trimmedLines.length && /\.pdf\b/i.test(trimmedLines[idx]!)) {
    filename = trimmedLines[idx]!.trim();
    idx++;
  }

  let type = "";
  if (idx < trimmedLines.length) {
    const cand = trimmedLines[idx]!.trim();
    if (TYPE_LINE_RE.test(cand) || /^Comment$/i.test(cand)) {
      type = cand;
      idx++;
    }
  }

  const tail = trimmedLines.slice(idx);
  const stIdx = findStatusIndexFromEnd(tail);
  if (stIdx === -1) {
    return {
      ref,
      cycle,
      reviewedBy,
      dateTime,
      type,
      filename,
      discussion: tail.join("\n").trim(),
      status: "",
      originalTextBlock: originalBlock.trim(),
    };
  }

  const discussion = tail.slice(0, stIdx).join("\n").trim();
  const status = tail[stIdx]!.trim();

  return {
    ref,
    cycle,
    reviewedBy,
    dateTime,
    type,
    filename,
    discussion,
    status,
    originalTextBlock: originalBlock.trim(),
  };
}

/** Last tokens that usually end a discipline/role phrase, not a surname (avoid stripping "Party Mechanical"). */
const PGC_DISCIPLINE_ROLE_TAIL_WORDS = new Set(
  [
    "mechanical",
    "electrical",
    "plumbing",
    "architectural",
    "environmental",
    "structural",
    "coordinator",
    "engineering",
    "engineer",
    "inspector",
    "reviewer",
    "official",
    "party",
    "designer",
    "manager",
    "lead",
    "senior",
    "junior",
    "fire",
    "landscape",
    "grading",
    "zoning",
    "dpie",
  ].map((w) => w.toLowerCase()),
);

function isLikelyPgcPersonNameToken(w: string): boolean {
  if (!w || !/^[A-Z][a-zA-Z'-]*$/.test(w)) return false;
  return true;
}

/**
 * Grouping label for `parsed_comments.discipline`: same semantic scope as `reviewedBy` but with
 * trailing person names removed (e.g. `First Last`). Full reviewer text stays in `REVIEWED BY:` / `reviewedBy`.
 * Leading ordinals like `3rd` in `3rd Party Mechanical` are preserved (not confused with ref/cycle).
 * Strips at most one trailing `First Last` pair and skips when the tail looks like role vocabulary
 * (e.g. ends with Mechanical, Coordinator) so we do not eat "Party Mechanical" after removing names.
 */
export function inferPgcDisciplineFromReviewedBy(reviewedBy: string): string {
  const s = String(reviewedBy ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";

  const words = s.split(/\s+/);
  if (words.length < 3) return s;

  const w1 = words[words.length - 2]!;
  const w2 = words[words.length - 1]!;
  if (!isLikelyPgcPersonNameToken(w1) || !isLikelyPgcPersonNameToken(w2)) return s;

  const w1l = w1.toLowerCase();
  const w2l = w2.toLowerCase();
  if (PGC_DISCIPLINE_ROLE_TAIL_WORDS.has(w1l) || PGC_DISCIPLINE_ROLE_TAIL_WORDS.has(w2l)) {
    return s;
  }

  const cut = words.slice(0, -2).join(" ").trim();
  return cut || s;
}

export function parsePgcReviewComments(
  text: string,
): { ok: true; rows: PgcReviewCommentsRow[] } | { ok: false } {
  const raw = String(text || "").replace(/\r\n/g, "\n");
  const preprocessed = preprocessPgcReviewCommentsExtractText(raw);
  const lines = preprocessed.split("\n").map((l) => l.trimEnd());

  const dataStart = findFirstCommentLineIndex(lines);
  const sliceStart = Math.max(0, dataStart);
  const bodyLines = lines.slice(sliceStart);

  const starts: number[] = [];
  for (let i = 0; i < bodyLines.length; i++) {
    const ln = bodyLines[i]!.trim();
    if (!ln) continue;
    if (ln.includes("Created in ProjectDox")) break;
    if (isBoilerplateLine(ln)) continue;
    if (
      splitLeadingRefCycleOrdinalFirstLine(ln) ||
      splitRefSharpFirstLine(ln) ||
      splitIndexOnlyLine(ln) ||
      splitSingleDigitGluedRefThenLetter(ln) ||
      splitRefCycleLegacyStacked(ln)
    ) {
      starts.push(i);
    }
  }

  if (starts.length === 0) return { ok: false };

  const rows: PgcReviewCommentsRow[] = [];
  for (let b = 0; b < starts.length; b++) {
    const from = starts[b]!;
    const to = b + 1 < starts.length ? starts[b + 1]! : bodyLines.length;
    let chunk = bodyLines.slice(from, to);
    const cut = chunk.findIndex((l) => l.includes("Created in ProjectDox"));
    if (cut !== -1) chunk = chunk.slice(0, cut);
    const trimmed = chunk.map((l) => l.trim()).filter((l) => l.length > 0);
    const originalBlock = chunk.join("\n");
    const row = parseBlock(trimmed, originalBlock);
    if (row) rows.push(row);
  }

  if (rows.length === 0) return { ok: false };
  return { ok: true, rows };
}

/** @deprecated Use parsePgcReviewComments; kept for imports that still use the old name. */
export const parsePgcReviewCommentsStacked = parsePgcReviewComments;
