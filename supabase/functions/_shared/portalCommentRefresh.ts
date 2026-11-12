/**
 * Portal comment refresh keying (comment-parser-agent finalizer). A refresh writes the new parse as
 * `raw_ref_staging` rows, then matches them to the existing portal rows so a matched row is updated in place
 * (its id, response_text and links survive) and only unmatched old rows are removed.
 *
 * Rows persisted by `formatPgcDeterministicPersistedComment` start with a `ref: N` header line, and older rows
 * have `comment_number` null, so the header is part of the key; the normalised text is the last resort.
 */

export type PortalCommentRow = {
  id: string;
  original_text?: string | null;
  comment_number?: string | null;
  page_number?: number | null;
  status?: string | null;
};

export type PortalCommentUpdate = {
  oldId: string;
  stagingId: string;
  patch: { original_text: string | null; page_number: number | null; status: string | null; comment_number: string | null };
};

export type PortalCommentRefreshPlan = {
  updates: PortalCommentUpdate[];
  /** Staging rows with no old match: promoted to `raw_ref`. */
  promotions: string[];
  /** Old portal rows no staging row matched. */
  deletions: string[];
};

function normalizeText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

const PERSISTED_REF_HEADER = /^\s*ref:\s*#?\s*(\d{1,4})\s*$/im;
const INLINE_REF = /\bREF\s*#?\s*(\d{1,4})\b/i;

export function portalCommentRef(row: Pick<PortalCommentRow, "comment_number" | "original_text">): string | null {
  const num = String(row.comment_number ?? "").trim();
  if (num) return num;
  const text = String(row.original_text ?? "");
  const header = PERSISTED_REF_HEADER.exec(text);
  if (header) return String(Number(header[1]));
  const inline = INLINE_REF.exec(text);
  return inline ? String(Number(inline[1])) : null;
}

export function portalCommentKey(row: Pick<PortalCommentRow, "comment_number" | "original_text">): string {
  const ref = portalCommentRef(row);
  return ref ? `ref:${ref}` : `text:${normalizeText(String(row.original_text ?? ""))}`;
}

function textKey(row: PortalCommentRow): string {
  return normalizeText(String(row.original_text ?? ""));
}

export function planPortalCommentRefresh(old: PortalCommentRow[], staging: PortalCommentRow[]): PortalCommentRefreshPlan {
  const byKey = new Map<string, PortalCommentRow>();
  const byText = new Map<string, PortalCommentRow>();
  for (const row of old) {
    const key = portalCommentKey(row);
    if (!byKey.has(key)) byKey.set(key, row);
    const t = textKey(row);
    if (t && !byText.has(t)) byText.set(t, row);
  }

  const matched = new Set<string>();
  const updates: PortalCommentUpdate[] = [];
  const promotions: string[] = [];
  for (const s of staging) {
    let existing = byKey.get(portalCommentKey(s));
    if (!existing || matched.has(existing.id)) {
      const t = textKey(s);
      const sameText = t ? byText.get(t) : undefined;
      existing = sameText && !matched.has(sameText.id) ? sameText : undefined;
    }
    if (!existing) {
      promotions.push(s.id);
      continue;
    }
    matched.add(existing.id);
    updates.push({
      oldId: existing.id,
      stagingId: s.id,
      patch: {
        original_text: s.original_text ?? null,
        page_number: s.page_number ?? null,
        status: s.status ?? null,
        comment_number: s.comment_number ?? existing.comment_number ?? portalCommentRef(s),
      },
    });
  }
  return { updates, promotions, deletions: old.filter((r) => !matched.has(r.id)).map((r) => r.id) };
}
