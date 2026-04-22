/**
 * View-layer only: parse deterministic PGC `original_text` saved by `formatPgcDeterministicPersistedComment`
 * (comment-parser-agent). Does not read DB differently — display helper for Comment Review.
 */
export type PgcRawRefDisplayFields = {
  /** Main text for the Comment cell */
  discussion: string;
  ref?: string;
  cycle?: string;
  reviewedBy?: string;
  statusInBlob?: string;
  dateTime?: string;
};

function lineField(header: string, label: string): string {
  const m = header.match(new RegExp(`(?:^|\\n)${label}:\\s*([^\\n]*)`, "i"));
  return (m?.[1] ?? "").trim();
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
  const discussion = (discM?.[1] ?? "").trim() || "—";
  const header = raw.split(/full_discussion_text:\s*\r?\n/i)[0] ?? "";
  const statusM = raw.match(/\r?\nstatus:\s*([^\r\n]*)/i);
  const dateM = raw.match(/\r?\ndate_time:\s*([^\r\n]*)/i);
  const ref = lineField(header, "ref");
  const cycle = lineField(header, "cycle");
  const reviewedBy = lineField(header, "reviewed_by");
  return {
    discussion,
    ref: ref || undefined,
    cycle: cycle || undefined,
    reviewedBy: reviewedBy || undefined,
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
