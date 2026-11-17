/**
 * Portal comment refresh keying (comment-parser-agent finalizer). A refresh writes the new parse as
 * `raw_ref_staging` rows, then matches them to the existing portal rows so a matched row is updated in place
 * (its id, response_text and links survive).
 *
 * Rows persisted by `formatPgcDeterministicPersistedComment` start with a `ref: N` header line, and older rows
 * have `comment_number` null, so the header is part of the key; the normalised text is the last resort.
 *
 * Human work is preserved (D-111): unmatched old rows are soft-marked (`portal_removed_at`), never deleted;
 * a person's status is kept; a changed discussion on a row with a response or edit is stored beside it
 * (`portal_latest_text`) instead of replacing it.
 */

import { existingDiscussion, hasHumanWork, looseText, statusIsParserOwned, type ExistingParsedComment } from "./permitRepositoryComments.ts";

export type PortalCommentRow = ExistingParsedComment & {
  page_number?: number | null;
};

export type PortalCommentUpdate = {
  oldId: string;
  stagingId: string;
  patch: Record<string, string | number | null>;
};

export type PortalCommentRefreshPlan = {
  updates: PortalCommentUpdate[];
  /** Staging rows with no old match: promoted to `raw_ref`. */
  promotions: string[];
  /** Old portal rows no staging row matched: soft-marked removed from the portal, never deleted. */
  removals: string[];
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

function statusLine(text: string | null | undefined): string | null {
  const m = String(text ?? "").match(/(?:^|\r?\n)status:\s*([^\r\n]*)/i);
  return m ? m[1].trim() : null;
}

function protectedPatch(existing: PortalCommentRow, s: PortalCommentRow, now: string): Record<string, string | number | null> {
  const patch: Record<string, string | number | null> = {
    page_number: s.page_number ?? null,
    comment_number: s.comment_number ?? existing.comment_number ?? portalCommentRef(s),
  };
  const sameDiscussion = looseText(existingDiscussion(existing.original_text)) === looseText(existingDiscussion(s.original_text));
  if (sameDiscussion || !hasHumanWork(existing)) {
    patch.original_text = s.original_text ?? null;
    if (existing.portal_latest_text) {
      patch.portal_latest_text = null;
      patch.portal_changed_at = null;
    }
  } else {
    patch.portal_latest_text = s.original_text ?? null;
    patch.portal_changed_at = now;
  }
  if (String(existing.status ?? "") !== String(s.status ?? "") && statusIsParserOwned(existing)) {
    patch.status = s.status ?? null;
  }
  const raw = statusLine(s.original_text);
  if (raw != null) patch.portal_status_raw = raw;
  if (existing.portal_removed_at) patch.portal_removed_at = null;
  return patch;
}

export function planPortalCommentRefresh(
  old: PortalCommentRow[],
  staging: PortalCommentRow[],
  now: string = new Date().toISOString(),
): PortalCommentRefreshPlan {
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
    updates.push({ oldId: existing.id, stagingId: s.id, patch: protectedPatch(existing, s, now) });
  }
  return {
    updates,
    promotions,
    removals: old.filter((r) => !matched.has(r.id) && !r.portal_removed_at).map((r) => r.id),
  };
}
