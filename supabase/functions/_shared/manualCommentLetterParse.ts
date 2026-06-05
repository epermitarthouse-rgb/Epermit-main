/**
 * Deterministic parser for manual jurisdiction comment letters (PDF/DOCX text).
 * Hybrid flow: deterministic runs first; LLM only when zero comments found.
 */

export interface DocumentPageText {
  pageNumber: number;
  text: string;
}

export interface ManualParsedComment {
  reviewer_name: string | null;
  discipline: string;
  comment_number: string | null;
  original_comment: string;
  previous_comment_text: string | null;
  code_references: string[];
  code_reference: string | null;
  existing_response_text: string | null;
  source_page: number | null;
  confidence: number;
}

export interface ParserSummary {
  total: number;
  by_section: Record<string, number>;
  by_discipline: Record<string, number>;
}

export const METADATA_NOISE_PHRASES = [
  "Created in ProjectDox version",
  "Report Generated:",
  "Workflow Started:",
  "Report date:",
  "Project Name:",
  "Upload and Submit",
  "Workflow Routing Slip",
  "Total Review Comments:",
  "Elapsed Days:",
  "Time Elapsed:",
  "Number of Files:",
  "Plan Review - Review Comments Report",
  "No data found.",
  "Department of Buildings",
  "Plan Review Division",
  "Please contact",
  "If you have any questions",
  "Sincerely,",
  "Thank you for your",
];

const PAGE_MARKER_RE = /\[\[PAGE:(\d+)\]\]/g;

const KNOWN_SECTION_LABELS =
  "DOEE|Energy|Fire|Structural|Architecture|Zoning|MEP|Mechanical|Electrical|Plumbing|HVAC|Civil|Health|Green|Accessibility|Plans";

/** Reviewer section uses en/em dash: "Fire – Luchi Lu" */
const SECTION_HEADER_RE =
  /(?:^|\n)\s*([A-Za-z][A-Za-z0-9\s&/]{0,40}?)\s*[–—]\s*([^\n]+?)\s*(?=\n|$)/g;

/** DOCX/PDF often emit ASCII hyphen between discipline and reviewer name */
const SECTION_HEADER_ASCII_RE = new RegExp(
  `(?:^|\\n)\\s*(${KNOWN_SECTION_LABELS})\\s+-\\s+([^\\n]+?)\\s*(?=\\n|$)`,
  "gi",
);

/** Comment block opener, optional list bullet: "- Comment 1:" */
const COMMENT_BLOCK_RE =
  /(?:^|\n)\s*(?:[-•*]\s*)?Comment\s+(\d+)\s*[:\.]?\s*/gi;

const PREVIOUS_COMMENT_MARKER_RE = /\[?\s*PREVIOUS\s+COMMENTS?\s*\]?\s*:?\s*/i;

const DISCIPLINE_KEYWORDS: Array<[RegExp, string]> = [
  [/\bfire\b/i, "Fire"],
  [/\bstructural\b/i, "Structural"],
  [/\bzoning\b/i, "Zoning"],
  [/\barchitect/i, "Architecture"],
  [/\b(doee|energy|mechanical|electrical|plumbing|hvac|mep)\b/i, "MEP"],
];

export function buildFullTextWithPageMarkers(pages: DocumentPageText[]): string {
  if (pages.length === 0) return "";
  return pages
    .map((p) => `\n[[PAGE:${p.pageNumber}]]\n${p.text}`)
    .join("\n");
}

export function extractCodeReferences(text: string): string[] {
  const refs = new Set<string>();
  const patterns = [
    /\b(?:IBC|IRC|IFC|IMC|IPC|IECC)\s*(?:20\d{2})?\s*[§]?\s*\d+(?:\.\d+)*[A-Za-z]?\b/gi,
    /\bNFPA\s*(?:\d+[A-Za-z]?)?(?:\s*[§]?\s*\d+(?:\.\d+)*)?\b/gi,
    /\b(?:20\d{2}\s+)?DCBC(?:\s+\d+(?:\.\d+)*)?\b/gi,
    /\b(?:20\d{2}\s+)?DCFC(?:\s+\d+(?:\.\d+)*)?\b/gi,
    /\bDCMR(?:\s+[\d\-A]+)?(?:\s+\d+(?:\.\d+)*)?\b/gi,
    /\b§\s*\d+(?:\.\d+)+\b/g,
    /\b1704(?:\.\d+)*\b/g,
    /\b1705(?:\.\d+)*\b/g,
    /\b\d{3,4}\.\d+(?:\.\d+)*\b/g,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const v = m[0].trim().replace(/\s+/g, " ");
      if (v.length >= 3) refs.add(v);
    }
  }
  return [...refs];
}

function inferDiscipline(sectionLabel: string, _reviewerName: string | null): string {
  const label = sectionLabel.trim();
  if (/^doee$/i.test(label)) return "DOEE";
  if (/^energy$/i.test(label)) return "Energy";
  for (const [re, discipline] of DISCIPLINE_KEYWORDS) {
    if (re.test(label)) return discipline;
  }
  return label || "Architecture";
}

function sectionSummaryKey(label: string): string {
  return label.trim() || "General";
}

export function buildParserSummary(comments: ManualParsedComment[]): ParserSummary {
  const by_section: Record<string, number> = {};
  const by_discipline: Record<string, number> = {};
  for (const c of comments) {
    const key = c.reviewer_name
      ? `${c.discipline} (${c.reviewer_name})`
      : c.discipline;
    by_section[key] = (by_section[key] ?? 0) + 1;
    by_discipline[c.discipline] = (by_discipline[c.discipline] ?? 0) + 1;
  }
  return { total: comments.length, by_section, by_discipline };
}

function pageAtOffset(fullText: string, offset: number): number | null {
  const before = fullText.slice(0, Math.max(0, offset));
  const matches = [...before.matchAll(PAGE_MARKER_RE)];
  if (matches.length === 0) return null;
  const last = matches[matches.length - 1];
  return last ? parseInt(last[1], 10) : null;
}

function isMetadataNoise(text: string): boolean {
  const t = text.trim();
  if (t.length < 8) return true;
  if (METADATA_NOISE_PHRASES.some((p) => t.includes(p))) return true;
  if (/^(dear|to whom|re:|subject:|date:|cc:)/i.test(t)) return true;
  return false;
}

/** Short active reviewer requests that appear after [PREVIOUS COMMENT] blocks. */
const ACTIVE_COMMENT_SUFFIX_RE =
  /(?:^|\n)\s*(Please\s+(?:cloud\s+corrections|answer\s+all\s+the\s+review\s+comments(?:\/questions)?)\.?)\s*$/i;

function resolveOriginalComment(activeComment: string, _previous: string | null): string {
  return activeComment.trim();
}

function hasUsableCommentContent(activeComment: string, previous: string | null): boolean {
  if (activeComment.trim().length > 0) return !isMetadataNoise(activeComment);
  return Boolean(previous && previous.trim().length >= 12);
}

function stripPageMarkers(text: string): string {
  return text.replace(PAGE_MARKER_RE, "").trim();
}

function isFormalResponseHeaderLine(line: string): boolean {
  const t = line.trim();
  if (/^Response\s+reads\b/i.test(t)) return false;
  return /^Response\s+\d+\s*[:\.]?\s*/i.test(t);
}

function splitResponseSection(body: string): { commentBody: string; response: string | null } {
  const lines = body.split("\n");
  let responseLineIdx = -1;

  for (let i = lines.length - 1; i >= 0; i--) {
    if (isFormalResponseHeaderLine(lines[i])) {
      responseLineIdx = i;
      break;
    }
  }

  if (responseLineIdx === -1) {
    return { commentBody: body.trim(), response: null };
  }

  const respLine = lines[responseLineIdx];
  const m = respLine.match(/^Response\s+\d+\s*[:\.]?\s*(.*)$/i);
  const respOnSameLine = (m?.[1] ?? "").trim();
  const respAfter = lines.slice(responseLineIdx + 1).join("\n").trim();
  const combined = [respOnSameLine, respAfter].filter(Boolean).join("\n").trim();
  const commentBody = lines.slice(0, responseLineIdx).join("\n").trim();

  return {
    commentBody,
    response: combined.length > 0 ? combined : null,
  };
}

function extractPreviousCommentBlock(body: string): {
  previous: string | null;
  remainder: string;
} {
  const match = PREVIOUS_COMMENT_MARKER_RE.exec(body);
  if (!match || match.index == null) {
    return { previous: null, remainder: body.trim() };
  }

  const before = body.slice(0, match.index).trim();
  const afterMarker = body.slice(match.index + match[0].length).trim();

  const suffixMatch = ACTIVE_COMMENT_SUFFIX_RE.exec(afterMarker);
  if (suffixMatch && suffixMatch.index != null) {
    const previous = afterMarker.slice(0, suffixMatch.index).trim() || null;
    const suffix = (suffixMatch[1] ?? suffixMatch[0]).trim();
    const remainder = [before, suffix].filter(Boolean).join("\n\n").trim();
    return { previous, remainder };
  }

  return {
    previous: afterMarker || null,
    remainder: before,
  };
}

function processCommentBody(raw: string): {
  previous: string | null;
  comment: string;
  response: string | null;
} {
  let body = stripPageMarkers(raw.trim());

  const { commentBody, response } = splitResponseSection(body);
  body = commentBody;

  const { previous, remainder } = extractPreviousCommentBlock(body);

  return {
    previous,
    comment: remainder.trim(),
    response,
  };
}

function isValidSectionHeader(label: string, reviewer: string): boolean {
  const l = label.trim();
  const r = reviewer.trim();
  if (/^(comment|response)(\s+\d+)?$/i.test(l)) return false;
  if (/^comment\s+\d+/i.test(r)) return false;
  if (/^response\s+\d+\s*:?\s*$/i.test(l)) return false;
  if (l.length < 2 || r.length < 2) return false;
  if (/[.!?]/.test(l)) return false;
  if (/please/i.test(l)) return false;
  if (/[–—]/.test(r)) return false;
  if (l.split(/\s+/).length > 4) return false;
  if (r.split(/\s+/).length > 6) return false;
  return true;
}

interface SectionSlice {
  label: string;
  reviewerName: string | null;
  discipline: string;
  body: string;
  startOffset: number;
}

function normalizeLetterText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\u2013\u2014\u2212]/g, "–");
}

function collectSectionHeaders(
  fullText: string,
): Array<{ label: string; reviewer: string; index: number; length: number }> {
  const headers: Array<{ label: string; reviewer: string; index: number; length: number }> = [];

  const tryMatch = (re: RegExp) => {
    const copy = new RegExp(re.source, re.flags);
    let m: RegExpExecArray | null;
    while ((m = copy.exec(fullText)) !== null) {
      const label = m[1].trim();
      const reviewer = m[2].trim();
      if (/^comment\s+\d+$/i.test(label)) continue;
      if (/^response\s+\d+$/i.test(label)) continue;
      if (/^response\s+reads$/i.test(label)) continue;
      if (!isValidSectionHeader(label, reviewer)) continue;
      headers.push({ label, reviewer, index: m.index, length: m[0].length });
    }
  };

  tryMatch(SECTION_HEADER_RE);
  tryMatch(SECTION_HEADER_ASCII_RE);

  headers.sort((a, b) => a.index - b.index);
  return headers.filter((h, i, arr) => i === 0 || h.index !== arr[i - 1].index);
}

function splitSections(fullText: string): SectionSlice[] {
  const headers = collectSectionHeaders(fullText);

  if (headers.length === 0) {
    return [
      {
        label: "General",
        reviewerName: null,
        discipline: "Architecture",
        body: fullText,
        startOffset: 0,
      },
    ];
  }

  const sections: SectionSlice[] = [];
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    const start = h.index + h.length;
    const end = i + 1 < headers.length ? headers[i + 1].index : fullText.length;
    const body = fullText.slice(start, end);
    sections.push({
      label: h.label,
      reviewerName: h.reviewer || null,
      discipline: inferDiscipline(h.label, h.reviewer),
      body,
      startOffset: start,
    });
  }
  return sections;
}

function splitCommentBlocks(
  sectionBody: string,
): Array<{ number: string; raw: string; offsetInSection: number }> {
  const blocks: Array<{ number: string; raw: string; offsetInSection: number }> = [];
  const re = new RegExp(COMMENT_BLOCK_RE.source, "gi");
  const matches = [...sectionBody.matchAll(re)];
  if (matches.length === 0) return blocks;

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const num = m[1];
    const start = m.index! + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : sectionBody.length;
    const raw = sectionBody.slice(start, end).trim();
    blocks.push({ number: num, raw, offsetInSection: start });
  }
  return blocks;
}

export function parseManualCommentLetterDeterministic(
  fullText: string,
  _pages?: DocumentPageText[],
): ManualParsedComment[] {
  const normalized = normalizeLetterText(fullText);
  const sections = splitSections(normalized);
  const results: ManualParsedComment[] = [];

  for (const section of sections) {
    const blocks = splitCommentBlocks(section.body);
    for (const block of blocks) {
      const { previous, comment, response } = processCommentBody(block.raw);
      if (!hasUsableCommentContent(comment, previous)) continue;

      const combinedForCodes = [comment, previous ?? ""].filter(Boolean).join("\n");
      const code_references = extractCodeReferences(combinedForCodes);
      const absOffset = section.startOffset + block.offsetInSection;

      results.push({
        reviewer_name: section.reviewerName,
        discipline: section.discipline,
        comment_number: block.number,
        original_comment: resolveOriginalComment(comment, previous),
        previous_comment_text: previous,
        code_references,
        code_reference: code_references[0] ?? null,
        existing_response_text: response,
        source_page: pageAtOffset(normalized, absOffset),
        confidence: comment.length > 40 || (previous?.length ?? 0) > 40 ? 0.9 : 0.75,
      });
    }
  }

  if (results.length === 0) {
    const fallbackBlocks = splitCommentBlocks(normalized);
    for (const block of fallbackBlocks) {
      const { previous, comment, response } = processCommentBody(block.raw);
      if (!hasUsableCommentContent(comment, previous)) continue;
      const combinedForCodes = [comment, previous ?? ""].filter(Boolean).join("\n");
      const code_references = extractCodeReferences(combinedForCodes);
      results.push({
        reviewer_name: null,
        discipline: "Architecture",
        comment_number: block.number,
        original_comment: resolveOriginalComment(comment, previous),
        previous_comment_text: previous,
        code_references,
        code_reference: code_references[0] ?? null,
        existing_response_text: response,
        source_page: pageAtOffset(normalized, block.offsetInSection),
        confidence: 0.55,
      });
    }
  }

  return results;
}

/** Normalize edge/LLM output to ManualParsedComment shape. */
export function normalizeManualParsedComments(raw: unknown[]): ManualParsedComment[] {
  const out: ManualParsedComment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    const original_comment =
      typeof c.original_comment === "string"
        ? c.original_comment
        : typeof c.original_text === "string"
          ? c.original_text
          : "";
    const previous_comment_text =
      typeof c.previous_comment_text === "string"
        ? c.previous_comment_text.trim() || null
        : null;

    if (
      !original_comment.trim() &&
      !(previous_comment_text && previous_comment_text.length >= 12)
    ) {
      continue;
    }
    if (original_comment.trim() && isMetadataNoise(original_comment) && !previous_comment_text) {
      continue;
    }

    const codeRefs = Array.isArray(c.code_references)
      ? c.code_references.filter((x): x is string => typeof x === "string")
      : extractCodeReferences([original_comment, previous_comment_text ?? ""].join("\n"));
    const codeRef =
      typeof c.code_reference === "string" && c.code_reference.trim()
        ? c.code_reference.trim()
        : codeRefs[0] ?? null;

    out.push({
      reviewer_name:
        typeof c.reviewer_name === "string" ? c.reviewer_name.trim() || null : null,
      discipline:
        typeof c.discipline === "string" && c.discipline.trim()
          ? c.discipline.trim()
          : "Architecture",
      comment_number:
        c.comment_number != null ? String(c.comment_number) : null,
      original_comment: original_comment.trim(),
      previous_comment_text,
      code_references: codeRefs,
      code_reference: codeRef,
      existing_response_text:
        typeof c.existing_response_text === "string"
          ? c.existing_response_text.trim() || null
          : null,
      source_page:
        typeof c.source_page === "number"
          ? c.source_page
          : typeof c.page_number === "number"
            ? c.page_number
            : null,
      confidence:
        typeof c.confidence === "number" ? Math.min(1, Math.max(0, c.confidence)) : 0.75,
    });
  }
  return out;
}

/** Sample DOB-style letter fixture for selftests. */
export const DOB_MCDONALDS_FIXTURE = `
DOEE – Nykia Barnes
- Comment 1:
Provide stormwater documentation per 2017 DCBC 903.2.1.2.

Energy – Rafael Palomino-Ramirez
- Comment 1:
Submit updated energy model per 2017 DCBC 1018.2.

Fire – Luchi Lu
- Comment 1:
Please answer all the review comments/questions.

[PREVIOUS COMMENT]
Provide sprinkler documentation and seating placard details per NFPA 30 and DCFC 2015 5704.2.11.1.

- Comment 2:
[PREVIOUS COMMENT]
The floor layout plan doesn't include scaled and dimensioned seat count for 48. Nor is placard provided. Provide fully dimensioned floor layout and furniture plans of both floors with aisle width in inches. Provide toilet count and accessibility per 2017 DCBC 1018.2, 2902.3.6, 1029.12.1, 1004.3, and IBC 2017 1108.2.9.1.

Please cloud corrections.

- Comment 3:
Response reads "There is one new and one used cooking oil tanks on the site." Clarify tank locations per 2017 DCBC 2902.3.6.

Response 3:

Structural – Stanley Skinner
- Comment 1:
Please cloud corrections.

[PREVIOUS COMMENT]
Provide structural calculations for mezzanine per 1704.3 and 1705.3.4.

- Comment 2:
Please cloud corrections.

[PREVIOUS COMMENT]
Show connection details at grid line 4 per 1705 and 1705.2.4.

- Comment 3:
Verify parapet anchorage per 2017 DCBC 1029.12.1.

Response 3:
`;
