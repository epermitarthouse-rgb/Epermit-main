/**
 * View-layer only: parse deterministic PGC `original_text` saved by `formatPgcDeterministicPersistedComment`
 * (comment-parser-agent). Does not read DB differently — display helper for Comment Review.
 */
export type PgcRawRefDisplayFields = {
  /**
   * Full text from the persisted `full_discussion_text:` block — matches the portal report DISCUSSION
   * column (includes applicant/reviewer response text when present in the blob).
   */
  discussion: string;
  ref?: string;
  cycle?: string;
  reviewedBy?: string;
  type?: string;
  filename?: string;
  statusInBlob?: string;
  dateTime?: string;
};

/** Montgomery parser separator; must match `montgomeryReviewCommentsExtract` compose output. */
export const RAW_REF_PORTAL_RESPONSE_SEPARATOR = "\n\n--- Portal / applicant response ---\n";

/**
 * Reads one YAML-like header field per **physical line** — avoids malformed captures when `\n`
 * slipped into persisted cell text or when substrings resemble `keyword:` elsewhere.
 */
function lineField(header: string, label: string): string {
  const want = `${label.trim().toLowerCase()}:`;
  for (const line of header.replace(/\r\n/g, "\n").split("\n")) {
    const t = line.trimStart();
    if (!t.length) continue;
    if (t.toLowerCase().startsWith(want)) {
      return t.slice(t.indexOf(":") + 1).trim();
    }
  }
  /** Legacy single-line blobs */
  const m = header.match(new RegExp(`(?:^|\\n)${escapeRegExp(label)}:\\s*([^\\n]*)`, "i"));
  return (m?.[1] ?? "").trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Split persisted `full_discussion_text` into main comment vs response (Washington + Montgomery).
 */
export function splitRawRefDiscussionAndResponse(fullDiscussion: string): {
  discussion: string;
  responseText?: string;
} {
  const full = String(fullDiscussion ?? "").replace(/\r\n/g, "\n").trimEnd();
  if (!full) return { discussion: "—" };

  const iExact = full.indexOf(RAW_REF_PORTAL_RESPONSE_SEPARATOR);
  if (iExact !== -1) {
    return {
      discussion: full.slice(0, iExact).trim() || "—",
      responseText: full.slice(iExact + RAW_REF_PORTAL_RESPONSE_SEPARATOR.length).trim() || undefined,
    };
  }

  const loose = "\n--- Portal / applicant response ---\n";
  const iLoose = full.indexOf(loose);
  if (iLoose !== -1) {
    return {
      discussion: full.slice(0, iLoose).trim() || "—",
      responseText: full.slice(iLoose + loose.length).trim() || undefined,
    };
  }

  const iResp = full.search(/\n(?=Responded\s+by\s*:)/i);
  if (iResp !== -1) {
    return {
      discussion: full.slice(0, iResp).trim() || "—",
      responseText: full.slice(iResp + 1).trim() || undefined,
    };
  }

  const iRr = full.search(/\n(?=Reviewer\s+Response\s*:)/i);
  if (iRr !== -1) {
    return {
      discussion: full.slice(0, iRr).trim() || "—",
      responseText: full.slice(iRr + 1).trim() || undefined,
    };
  }

  if (/^(Responded\s+by\s*:|Reviewer\s+Response\s*:)/im.test(full)) {
    return { discussion: "—", responseText: full.trim() };
  }

  return { discussion: full.trim() || "—" };
}

/**
 * Best-effort parse of the serialized blob. If the shape does not match, returns the full string as `discussion`.
 */
export function parsePgcRawRefDisplayText(text: string): PgcRawRefDisplayFields {
  const raw = String(text ?? "");
  const t = raw.trim();
  if (!t) {
    return { discussion: "—" };
  }
  if (!/(?:^|\n)ref:\s*/i.test(raw) || !/full_discussion_text:\s*\r?\n/i.test(raw)) {
    return { discussion: t };
  }
  const discM = raw.match(/full_discussion_text:\s*\r?\n([\s\S]*?)(?=\r?\nstatus:\s*)/i);
  const fullBlob = (discM?.[1] ?? "").trim();
  const header = raw.split(/full_discussion_text:\s*\r?\n/i)[0] ?? "";
  const statusM = raw.match(/\r?\nstatus:\s*([^\r\n]*)/i);
  const dateM = raw.match(/\r?\ndate_time:\s*([^\r\n]*)/i);
  const ref = lineField(header, "ref");
  const cycle = lineField(header, "cycle");
  const reviewedBy = lineField(header, "reviewed_by");
  const ty = lineField(header, "type");
  const fname = lineField(header, "filename");
  return {
    discussion: fullBlob || "—",
    ref: ref || undefined,
    cycle: cycle || undefined,
    reviewedBy: reviewedBy || undefined,
    type: ty || undefined,
    filename: fname || undefined,
    statusInBlob: (statusM?.[1] ?? "").trim() || undefined,
    dateTime: (dateM?.[1] ?? "").trim() || undefined,
  };
}

/** Compact one-line label for ref/cycle (optional subline in the table). */
export function formatRawRefMetaLine(f: PgcRawRefDisplayFields): string | null {
  const parts: string[] = [];
  if (f.ref) parts.push(`Ref ${f.ref}`);
  if (f.cycle) parts.push(`Cycle ${f.cycle}`);
  return parts.length ? parts.join(" · ") : null;
}
