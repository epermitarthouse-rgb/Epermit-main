/**
 * Montgomery County `montgomery-export` Review Comments — normalize flattened PDF text
 * before shared PGC `parsePgcReviewComments` / header-aligned row parsing.
 *
 * Scoped to Plan Review – Review Comments only; caller must gate on `info.source === "montgomery-export"`.
 */

import {
  PGC_REVIEW_COMMENTS_HEADER_LINE_RE,
  type PgcReviewCommentsRow,
} from "./pgcReviewCommentsStackedParse.ts";

const BOILERPLATE_LINE_RES: RegExp[] = [
  /^Created in ProjectDox[^\n]*$/gim,
  /^Plan\s+Review\s*-\s*Review\s+Comments\s+Report\s*$/gim,
  /^Project\s+Name:\s*[^\n]*$/gim,
  /^Workflow\s+Started:\s*[^\n]*$/gim,
  /^Report\s+Generated:\s*[^\n]*$/gim,
  /^REVIEW\s+COMMENTS\s*$/gim,
];

/**
 * Row anchors must be **line starts only** so internal text like `REF #17-#19` or `17 1 …` mid-paragraph
 * does not create false ref boundaries.
 *
 * - With cycle: `17 1 Health…`
 * - Blank cycle (Permit Tech, etc.): `1 Permit Tech Comment …` — no `\d{1,2}` between ref and reviewer text
 */
function isMontgomeryGridLineAnchor(line: string): boolean {
  const LC = line.replace(/^\s+/, "");
  if (!LC.length) return false;
  if (/^\d{1,4}\s+\d{1,2}\s+\S/.test(LC)) return true;
  if (/^\d{1,4}\s+[A-Za-z#/(\[]/.test(LC)) return true;
  return false;
}

/**
 * Second+ head on the same **physical** line (flattened PDF). Only when the line already
 * opened with `ref cycle …` so discussion lines like `… 17 1 note …` are not split.
 */
const GLUED_ROW_HEAD_AFTER_WS =
  /\s+(?:[1-9]\d{0,3})\s+\d{1,2}\s+[A-Za-z#/(\[]/g;

/** Character indices in `t` where a new ref row begins. */
export function findMontgomeryRowAnchorIndices(t: string): number[] {
  const s = t.replace(/\r\n/g, "\n");
  const starts: number[] = [];
  let offset = 0;
  for (const line of s.split("\n")) {
    const ws = line.match(/^\s*/)?.[0] ?? "";
    const contentStart = offset + ws.length;
    const logical = line.slice(ws.length);
    if (isMontgomeryGridLineAnchor(logical)) starts.push(contentStart);

    /** Glued `24 1 … 25 1 …` on one line — only after a numeric-cycle grid opener. */
    if (/^\d{1,4}\s+\d{1,2}\s+\S/.test(logical)) {
      GLUED_ROW_HEAD_AFTER_WS.lastIndex = 0;
      let gm: RegExpExecArray | null;
      while ((gm = GLUED_ROW_HEAD_AFTER_WS.exec(line)) !== null) {
        const rel = gm[0].search(/[1-9]/);
        if (rel === -1) continue;
        const i = gm.index + rel;
        const prev = i > 0 ? line[i - 1]! : "";
        if (/[0-9]/.test(prev)) continue;
        starts.push(offset + i);
      }
    }

    offset += line.length + 1;
  }
  return starts.sort((a, b) => a - b);
}

/** Physical line(s) may contain multiple `ref cycle dept…` grid rows (flattened PDF). */
export function explodeGluedMontgomeryGridRows(s: string): string {
  const str = s.replace(/\r\n/g, "\n");
  const idx = findMontgomeryRowAnchorIndices(str);
  if (idx.length <= 1) return s;

  const chunks: string[] = [];
  for (let i = 0; i < idx.length; i++) {
    chunks.push(str.slice(idx[i]!, i + 1 < idx.length ? idx[i + 1]! : str.length).trim());
  }
  return chunks.filter(Boolean).join("\n");
}

/** Normalize cycle to digits-only; never shift into reviewed_by tokens. */
function normalizeMontgomeryCycle(raw: unknown): string {
  const t = String(raw ?? "").trim();
  if (!t) return "";
  if (/^\d{1,3}$/.test(t)) return t;
  const m = t.match(/^(\d{1,3})/);
  return m?.[1] ?? "";
}

const MONTGOMERY_STATUS_END_RE = /\s+(Resolved|UnResolved|Info\s+Only|InfoOnly)\s*$/i;

/**
 * FILENAME column: sheet refs like `M.2 MECHANICAL PLANS.pdf` / `E.2 LIGHTING PLAN.pdf` (space before `LETTER.digit`).
 * Not the leading `Changemark` token.
 */
/** 7-column grid indices: ref, cycle, reviewed_by, type, filename, discussion, status */
const MONTGOMERY_GRID_COL_COUNT = 7;

function padSevenTabCells(parts: string[]): string[] {
  const a = parts.map((c) => c.replace(/\u00a0/g, " ").trim());
  while (a.length < MONTGOMERY_GRID_COL_COUNT) a.push("");
  return a.slice(0, MONTGOMERY_GRID_COL_COUNT);
}

/** Row reconstruction for portal/PDF extracts that preserved tab-separated columns across wrap lines. */
function accumulateSevenColumnMontgomeryTabRows(linesTrimmed: string[]): PgcReviewCommentsRow | null {
  if (!linesTrimmed.length) return null;

  const accCols: string[][] = Array.from({ length: MONTGOMERY_GRID_COL_COUNT }, () => []);

  let ref0 = "";

  for (const ln of linesTrimmed) {
    const cells = padSevenTabCells(ln.split("\t"));
    const col0 = cells[0]!.trim();

    if (!ref0) {
      if (!/^\d{1,4}$/.test(col0)) return null;
      ref0 = col0;
    } else if (col0.length > 0 && /^\d{1,4}$/.test(col0) && col0 !== ref0) {
      break;
    }

    for (let k = 0; k < MONTGOMERY_GRID_COL_COUNT; k++) {
      const fragment = cells[k]!.trim();
      if (!fragment.length) continue;
      /** Avoid duplicating identical ref digits on continuation rows where col0 echoes the opener. */
      if (k === 0 && fragment === ref0 && accCols[0].length > 0) continue;
      accCols[k].push(fragment);
    }
  }

  if (!accCols[0].length || !/^(\d{1,4})$/.test(accCols[0][0]!)) return null;

  const ref = accCols[0][0]!.trim();

  /** Cycle wraps rarely; concatenate fragments without injecting newlines inside a single-digit cycle. */
  const cycleFragments = accCols[1].filter(Boolean);
  const cycle = cycleFragments.length
    ? normalizeMontgomeryCycle(cycleFragments.join(cycleFragments.some((x) => /\s/.test(x)) ? " " : ""))
    : "";

  /** Multiline wraps within the same portal cell retain physical line boundaries. */
  const joinCellLines = (parts: string[], sep = "\n") => parts.filter(Boolean).join(sep).trim();

  const reviewedBy = joinCellLines(accCols[2]);
  const ty = joinCellLines(accCols[3]);
  const filename = joinCellLines(accCols[4]);
  const discussion = joinCellLines(accCols[5]);
  const status = joinCellLines(accCols[6], " ").replace(/\s+/g, " ").trim();

  if (!status.length) return null;

  return {
    ref,
    cycle,
    reviewedBy,
    type: ty,
    filename,
    discussion,
    status,
    dateTime: "",
    originalTextBlock: linesTrimmed.join("\n"),
  };
}

/** DISCUSSION overflow lines (no tab column alignment) append after the parsed leader row. */
function assembleMontgomeryDiscussionOverflow(leaderDiscussion: string, continuationLines: string[]): string {
  const parts: string[] = [];
  const h = leaderDiscussion.trim();
  if (h) parts.push(h);
  for (const ln of continuationLines) {
    const t = ln.trim();
    if (!t) continue;
    if (/^(Resolved|UnResolved|Info\s+Only|InfoOnly)$/i.test(t)) continue;
    parts.push(t);
  }
  return parts.join("\n").trim();
}

/**
 * Space-flattened PDF: find the **shortest** prefix of physical lines that forms one complete grid row
 * (trailing status), then append any further lines as DISCUSSION overflow (not re-parsed as grid cells).
 */
function parseMontgomeryRefBlockMergedSpaceLines(blockPhysicalLines: string[]): PgcReviewCommentsRow | null {
  const lines = blockPhysicalLines;
  let pdfCols: ReturnType<typeof parseMontgomerySpaceGridLeaderLine> | null = null;
  let consumed = 0;
  const max = Math.min(lines.length, 30);
  for (let n = 1; n <= max; n++) {
    const merged = lines
      .slice(0, n)
      .join(" ")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    pdfCols = parseMontgomerySpaceGridLeaderLine(merged);
    if (pdfCols) {
      consumed = n;
      break;
    }
  }
  if (!pdfCols) return null;

  const overflow = lines.slice(consumed);
  const discussion = assembleMontgomeryDiscussionOverflow(pdfCols.discussion, overflow);
  const row = {
    ...pdfCols,
    discussion,
    dateTime: "",
    originalTextBlock: lines.join("\n"),
  };
  validateMontgomeryCyclesNotShifted(row);
  return row;
}

function findMontgomeryRespondentMarkerIndex(s: string): number {
  const from = String(s ?? "");
  const idxs = [
    /\bResponded\s+by\s*:/i,
    /\bReviewer\s+Response\s*:/i,
    /\bApplicant\s+Response\s*:/i,
    /\bCoordination\s+Response\s*:/i,
  ]
    .map((re) => {
      const m = re.exec(from);
      return m?.index ?? -1;
    })
    .filter((i) => i >= 0);
  return idxs.length ? Math.min(...idxs) : -1;
}

function extractFirstMontgomeryFilenameToken(fromTypeKeyword: string): {
  filename: string;
  filenameMatchStart: number;
  filenameMatchEnd: number;
} | null {
  const s = String(fromTypeKeyword ?? "");
  const reSheet =
    /\s+\b(([A-Z]\.\d+(?:\s+[A-Za-z][A-Za-z0-9._&,/#\s-]*)+)\.(?:pdf|docx))\b/gi;
  const m = reSheet.exec(s);
  if (m) {
    return {
      filename: m[1]!.trim(),
      filenameMatchStart: m.index,
      filenameMatchEnd: m.index + m[0].length,
    };
  }
  const reCombuild = /\s+\b((?:COMBUILD|COM)[A-Za-z0-9._-]+\.(?:pdf|docx))\b/gi;
  const m2 = reCombuild.exec(s);
  if (m2) {
    return {
      filename: m2[1]!.trim(),
      filenameMatchStart: m2.index,
      filenameMatchEnd: m2.index + m2[0].length,
    };
  }
  const reDocx = /\s+\b((?:HACCP|POP)[^\n]{0,100}?\.(?:pdf|docx))\b/gi;
  const m3 = reDocx.exec(s);
  if (m3) {
    return {
      filename: m3[1]!.trim(),
      filenameMatchStart: m3.index,
      filenameMatchEnd: m3.index + m3[0].length,
    };
  }
  return null;
}

/**
 * TYPE column starts after REVIEWED BY. Prefer the keyword **after** `(AM|PM)` (PDF time stamp) so
 * `Applicant Inquiry / …` does not steal `Inquiry`; when no clock, use **last** keyword match.
 */
function findMontgomeryTypeColumnKeywordIndex(body: string): number {
  const afterClock =
    /\b(?:AM|PM)\s+(Library\s+Comment|Checklist\s+Item|Changemark|Comment|Inquiry|Question)\b/i.exec(body);
  if (afterClock && afterClock[1]) {
    return afterClock.index + afterClock[0].indexOf(afterClock[1]);
  }
  const TYPE_START_RE =
    /\b(?:Library\s+Comment|Checklist\s+Item|Changemark|Comment|Inquiry|Question)\b/gi;
  let lastIdx = -1;
  let m: RegExpExecArray | null;
  while ((m = TYPE_START_RE.exec(body)) !== null) {
    lastIdx = m.index;
  }
  return lastIdx;
}

/**
 * Parses one flattened grid leader line using PDF column semantics:
 * REF # | CYCLE | REVIEWED BY | TYPE | FILENAME | DISCUSSION | STATUS — `TYPE` is the full cell (incl.
 * `Changemark / Paolo 1 Item 1`), not a single classifier token.
 */
function parseMontgomerySpaceGridLeaderLine(trimmedLine: string): Omit<PgcReviewCommentsRow, "originalTextBlock" | "dateTime"> | null {
  let line = trimmedLine.replace(/\u00a0/g, " ").trim();
  if (!line.length) return null;

  const stm = line.match(MONTGOMERY_STATUS_END_RE);
  if (!stm || stm.index === undefined) return null;
  const status = stm[1]!.trim();
  line = line.slice(0, stm.index).trimEnd();

  let refM = line.match(/^(\d{1,4})\s+/);
  if (!refM) return null;
  const ref = refM[1]!;
  let pos = refM[0].length;

  let cycleRaw = "";
  const cycProbe = line.slice(pos).match(/^(\d{1,2})\s+/);
  if (cycProbe) {
    cycleRaw = cycProbe[1]!;
    pos += cycProbe[0].length;
  }

  const body = line.slice(pos).trim();
  if (!body.length) return null;

  const tIdx = findMontgomeryTypeColumnKeywordIndex(body);
  if (tIdx < 0) return null;

  const reviewedBy = body.slice(0, tIdx).trim();
  const fromType = body.slice(tIdx).trim();

  const fn = extractFirstMontgomeryFilenameToken(fromType);
  let typeCell = "";
  let filename = "";
  let discussionHead = "";

  if (fn !== null) {
    const beforePdf = fromType.slice(0, fn.filenameMatchStart).trim();
    filename = fn.filename;
    /** Text after `.pdf` may still be TYPE (issue detail) until `Responded by:` opens DISCUSSION. */
    const afterPdf = fromType.slice(fn.filenameMatchEnd).trim();
    const cut = findMontgomeryRespondentMarkerIndex(afterPdf);
    let mid = "";
    if (cut >= 0) {
      mid = afterPdf.slice(0, cut).trim();
      discussionHead = afterPdf.slice(cut).trim();
    } else {
      mid = afterPdf;
      discussionHead = "";
    }
    typeCell = [beforePdf, mid].filter(Boolean).join(" / ").trim();
  } else {
    const cut = findMontgomeryRespondentMarkerIndex(fromType);
    if (cut >= 0) {
      typeCell = fromType.slice(0, cut).trim();
      discussionHead = fromType.slice(cut).trim();
    } else {
      typeCell = fromType.trim();
      discussionHead = "";
    }
  }

  return {
    ref,
    cycle: cycProbe ? normalizeMontgomeryCycle(cycleRaw) : "",
    reviewedBy,
    type: typeCell,
    filename,
    discussion: discussionHead,
    status,
  };
}

function validateMontgomeryCyclesNotShifted(r: PgcReviewCommentsRow): void {
  if (/review/i.test(String(r.cycle))) {
    console.warn("[montgomery-deterministic] invalid cycle leaked text; forcing empty cycle");
    r.cycle = "";
  }
}

/** One ref block: from `24 1 …` through the line before the next ref head. */
function sliceMontgomeryRefBlocks(adapted: string): string[] {
  const t = adapted.replace(/\r\n/g, "\n").trim();
  if (!t) return [];
  const idx = findMontgomeryRowAnchorIndices(t);
  if (idx.length === 0) return [];
  const blocks: string[] = [];
  for (let i = 0; i < idx.length; i++) {
    blocks.push(t.slice(idx[i]!, i + 1 < idx.length ? idx[i + 1]! : t.length).trim());
  }
  return blocks.filter(Boolean);
}

/** Preserve leading tabs (empty grid columns); strip only trailing spaces (not trailing tab column delimiters). */
function trimEndMontgomeryPhysicalLine(ln: string): string {
  return ln.replace(/\r/g, "").replace(/[ \u00a0]+$/g, "");
}

function parseMontgomeryRefBlock(block: string): PgcReviewCommentsRow | null {
  const rawLines = block.split("\n").map(trimEndMontgomeryPhysicalLine).filter((l) => l.length > 0);
  if (rawLines.length === 0) return null;

  /** Table contract: every physical line in the row block is tab-separated (PDF column positions). */
  const allLinesTabDelimited = rawLines.every((ln) => ln.includes("\t"));
  if (allLinesTabDelimited) {
    const tabbed = accumulateSevenColumnMontgomeryTabRows(rawLines);
    if (tabbed) {
      tabbed.originalTextBlock = block.trim();
      validateMontgomeryCyclesNotShifted(tabbed);
      return tabbed;
    }
  }

  return parseMontgomeryRefBlockMergedSpaceLines(rawLines);
}

/**
 * Montgomery-only: one row per ref block (multiline discussion), **after** `preprocessMontgomeryReviewCommentsExtractText`.
 */
export function parseMontgomeryGridRowsDeterministic(adapted: string): PgcReviewCommentsRow[] {
  const rows: PgcReviewCommentsRow[] = [];
  for (const block of sliceMontgomeryRefBlocks(adapted)) {
    const row = parseMontgomeryRefBlock(block);
    if (row) rows.push(row);
  }
  return rows;
}

/**
 * Flattened rows often use single spaces; `parseHeaderAlignedRefRows` expects tabs or 2+ spaces.
 * Best-effort tab columns: ref / cycle / reviewed-by (through Reviewers) / type / filename / discussion / status.
 */
/** Space-only Montgomery rows → same 7 columns as `parseMontgomerySpaceGridLeaderLine` */
function tabifyMontgomerySparseGridLine(line: string): string {
  const t = line.trim();
  if (t.includes("\t")) return line;
  if (!/^\d{1,4}\s+/.test(t)) return line;

  const sp = parseMontgomerySpaceGridLeaderLine(t.replace(/\u00a0/g, " "));
  if (sp) {
    return [sp.ref, sp.cycle, sp.reviewedBy, sp.type, sp.filename, sp.discussion, sp.status].join("\t");
  }

  if (/^\d{1,4}\s+\d{1,2}\s+/.test(t)) return t.replace(/^(\d{1,4})\s+(\d{1,2})\s+/, "$1\t$2\t");
  return line;
}

/** Apply tabify to space-only grid rows — **preserve leading tabs** on wrapped tab-export lines. */
function tabifyMontgomeryAdaptedText(s: string): string {
  return s
    .split("\n")
    .map((ln) => {
      const raw = ln.replace(/\r/g, "");
      if (!/\S/.test(raw)) return ln;
      const condensedForHdr = raw.replace(/\s+/g, " ").trim();
      if (
        !condensedForHdr ||
        PGC_REVIEW_COMMENTS_HEADER_LINE_RE.test(condensedForHdr.replace(/\s+/g, " "))
      ) {
        return ln;
      }
      /** Real tab separators must survive preprocessing (wrapped rows start with `\t`\t`\t`). */
      if (raw.includes("\t")) return raw.replace(/[ \u00a0]+$/g, "");
      return tabifyMontgomerySparseGridLine(raw.trim());
    })
    .join("\n");
}

export function preprocessMontgomeryReviewCommentsExtractText(raw: string): string {
  let s = String(raw ?? "").replace(/\r\n/g, "\n");

  for (const re of BOILERPLATE_LINE_RES) {
    s = s.replace(re, "");
  }

  s = s.replace(
    /\n?(?:Plan\s+Review\s*-\s*Review\s+Comments\s+Report|Project\s+Name:\s*[^\n]*|Workflow\s+Started:\s*[^\n]*|Report\s+Generated:\s*[^\n]*|REVIEW\s+COMMENTS)\s*\n?/gi,
    "\n",
  );

  s = s.replace(
    /\bREF\s*#\s*CYCLE\s+REVIEWED\s+BY\s+TYPE\s+FILENAME\s+DISCUSSION\s+STATUS\s*/gi,
    "\n",
  );

  /** `241Health...` / `392Mechanical...` → `24 1 Health...`, `39 2 Mechanical...` */
  s = s.replace(
    /\b(\d{2,3})([1-9])(?=(?:Health|Mechanical|Energy|Electrical|Plumbing|Permit|Architectural|Structural|Fire|Industrial|Historic|Environmental|Commissioning)\b)/gi,
    "$1 $2 ",
  );

  s = explodeGluedMontgomeryGridRows(s);
  s = tabifyMontgomeryAdaptedText(s);

  s = s.replace(/\n{3,}/g, "\n\n").trim();

  const lines = s.split("\n");
  const hasHeader = lines.some((ln) =>
    PGC_REVIEW_COMMENTS_HEADER_LINE_RE.test(ln.replace(/\s+/g, " "))
  );
  const firstContent = lines.find((l) => l.trim().length > 0) ?? "";
  const fc = firstContent.trim();
  const looksLikeMontgomeryLeader =
    /^\d{1,4}\s+\d{1,2}\s+\S/.test(fc) || /^\d{1,4}\s+[A-Za-z#/(\[]/.test(fc);
  if (!hasHeader && looksLikeMontgomeryLeader) {
    s = `REF # CYCLE REVIEWED BY TYPE FILENAME DISCUSSION STATUS\n${s}`;
  }

  return s.replace(/\n{3,}/g, "\n\n").trim();
}

/** Ordered ref numbers from grid leader lines — used for reconciliation when `REF #` markers are absent. */
export function extractMontgomeryGridRefOrder(adapted: string): string[] {
  const out: string[] = [];
  for (const ln of String(adapted ?? "").replace(/\r\n/g, "\n").split("\n")) {
    const t = ln.trim();
    if (!isMontgomeryGridLineAnchor(t)) continue;
    const m = t.match(/^(\d{1,4})\b/);
    if (!m) continue;
    const ref = m[1]!;
    const nRef = Number.parseInt(ref, 10);
    if (Number.isNaN(nRef) || nRef <= 0 || nRef > 9999) continue;
    out.push(ref);
  }
  return out;
}
