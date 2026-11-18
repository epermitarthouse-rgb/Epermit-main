/**
 * Permit-repository comment source for comment-parser-agent (D-110, D-111).
 *
 * A project linked to permits (project_permits) takes its portal comments from permit_review_comments
 * instead of portal_data report exports. The merge is keyed by portal identity (permit id + portal
 * comment key) and never removes or overwrites human work:
 *   - rows are never deleted; a comment that left the portal is soft-marked (portal_removed_at);
 *   - status is updated only while it still equals what the portal status mapped to last time;
 *   - comment text is replaced only on rows without a response or human edit; otherwise the new text is
 *     kept beside it (portal_latest_text, portal_changed_at) for a person to accept;
 *   - assignment, sheet reference, approvals and human-written values are never written;
 *   - central results (permit_comment_insights, D-121) fill discipline, code reference and a draft response on new
 *     rows and on empty fields, and refresh fields still sourced from central; a field a person set is never
 *     overwritten, only flagged (central_update_at) when a newer central result differs (D-122).
 *
 * Pure module: no Deno globals or network imports, so Node tests exercise every rule.
 */

import { isClassified } from "./commentPrompts.ts";

export type RepositoryPermit = {
  id: string;
  permit_number: string | null;
  /** Reviews section captured as a full listing (permit_section_state.status = 'ok'): removals are trusted. */
  reviews_complete: boolean;
};

export type RepositoryComment = {
  permit_id: string;
  portal_comment_key: string;
  ref_number: number | null;
  cycle: number | null;
  department: string | null;
  comment_type: string | null;
  file_name: string | null;
  body: string | null;
  status: string | null;
  reviewed_at: string | null;
  /**
   * Responses on this comment in the repository (permit_review_responses, not removed). When known and 0,
   * the stored discussion is not split at response headers. Undefined = not loaded (headers alone decide).
   */
  response_count?: number;
};

export type ExistingParsedComment = {
  id: string;
  original_text: string | null;
  comment_number?: string | null;
  status?: string | null;
  ingest_source?: string | null;
  response_text?: string | null;
  response_status?: string | null;
  approved_at?: string | null;
  last_edited_by?: string | null;
  assigned_to?: string | null;
  portal_permit_id?: string | null;
  portal_comment_key?: string | null;
  portal_content_hash?: string | null;
  portal_status_raw?: string | null;
  portal_removed_at?: string | null;
  portal_latest_text?: string | null;
  portal_changed_at?: string | null;
  discipline?: string | null;
  code_reference?: string | null;
  discipline_source?: FieldSource | null;
  code_reference_source?: FieldSource | null;
  response_text_source?: FieldSource | null;
  assigned_to_source?: FieldSource | null;
  central_insight_id?: string | null;
  central_update_at?: string | null;
  processing_status?: string | null;
};

/** Who wrote a parsed_comments field. NULL (rows from before D-122) is unknown and treated like a person. */
export type FieldSource = "central" | "project_ai" | "human";

/** The current central result of a repository comment (permit_central_current_insights). */
export type CentralInsight = {
  permit_id: string;
  portal_comment_key: string;
  insight_id: string;
  discipline: string | null;
  code_reference: string | null;
  guidance_text: string | null;
};

export type ParsedCommentPatch = Record<string, string | number | null>;

export type RepositoryMergePlan = {
  inserts: ParsedCommentPatch[];
  updates: Array<{ id: string; patch: ParsedCommentPatch }>;
  softRemovals: string[];
  stats: {
    incoming: number;
    matched: number;
    inserted: number;
    updated: number;
    text_replaced: number;
    text_change_flagged: number;
    status_updated: number;
    status_kept_human: number;
    restored: number;
    soft_removed: number;
    central_applied: number;
    central_refreshed: number;
    central_flagged: number;
  };
};

/** Rows the parser owns; manual letters and staging rows are never touched by this merge. */
const PORTAL_SOURCES = new Set(["raw_ref", "fallback_llm"]);

const PARSED_COMMENTS_ALLOWED_STATUSES = new Set([
  "Pending Review",
  "Pending",
  "Approved",
  "Rejected",
  "Draft",
  "Ready for Review",
]);

/** Same mapping as comment-parser-agent normalizePortalStatus (parsed_comments_status_check). */
export function normalizePortalStatus(raw: string | null | undefined): string {
  const trimmed = String(raw ?? "").trim();
  if (PARSED_COMMENTS_ALLOWED_STATUSES.has(trimmed)) return trimmed;
  const t = trimmed.toLowerCase().replace(/\s+/g, " ");
  if (!t) return "Pending";
  if (t === "resolved") return "Approved";
  if (t === "unresolved" || t === "un resolved") return "Pending Review";
  if (t === "info only" || t === "infoonly") return "Pending";
  if (t === "pending review") return "Pending Review";
  if (t === "rejected") return "Rejected";
  if (t === "approved") return "Approved";
  if (t === "draft") return "Draft";
  if (t === "ready for review") return "Ready for Review";
  return "Pending";
}

function oneLine(v: unknown): string {
  return String(v ?? "").replace(/\r\n|\r|\n/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeSpace(v: unknown): string {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

/** Comparison that ignores case, punctuation, whitespace and e-mail redaction differences between sources. */
export function looseText(v: unknown): string {
  return String(v ?? "")
    .replace(/\[email\]/gi, " ")
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** cyrb53: deterministic 53-bit string hash, hex. Change detection only, not a security boundary. */
export function stableHash(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

/** Hash of the comment's text-bearing fields. Status is tracked separately (portal_status_raw). */
export function repositoryCommentHash(c: RepositoryComment): string {
  return stableHash(
    [normalizeSpace(c.body), oneLine(c.cycle), oneLine(c.comment_type), oneLine(c.department), oneLine(c.file_name)].join("\u241f"),
  );
}

/**
 * Persisted text in the deterministic `ref: N` layout the Response Matrix already parses
 * (parsePgcRawRefDisplayText) and portalCommentRefresh keys on.
 */
export function formatRepositoryComment(c: RepositoryComment, permitNumber: string | null): string {
  const body = String(c.body ?? "").trim();
  return [
    `ref: ${oneLine(c.ref_number ?? c.portal_comment_key.replace(/^ref:/, ""))}`,
    `cycle: ${oneLine(c.cycle)}`,
    `reviewed_by: ${oneLine(c.department)}`,
    `type: ${oneLine(c.comment_type)}`,
    `filename: ${oneLine(c.file_name)}`,
    "full_discussion_text:",
    body,
    `status: ${oneLine(c.status)}`,
    `source_report: ${oneLine(permitNumber ? `Permit ${permitNumber}` : "Permit record")}`,
    `date_time: ${oneLine(c.reviewed_at)}`,
  ]
    .join("\n")
    .trim();
}

const PERSISTED_REF_HEADER = /^\s*ref:\s*#?\s*(\d{1,4})\s*$/im;
const INLINE_REF = /\bREF\s*#?\s*(\d{1,4})\b/i;

/** The ref of an existing row: comment_number, then the `ref: N` header, then an inline `REF #N`. */
export function existingRef(row: Pick<ExistingParsedComment, "comment_number" | "original_text">): string | null {
  const num = String(row.comment_number ?? "").trim();
  if (/^\d+$/.test(num)) return String(Number(num));
  const text = String(row.original_text ?? "");
  const header = PERSISTED_REF_HEADER.exec(text);
  if (header) return String(Number(header[1]));
  const inline = INLINE_REF.exec(text);
  return inline ? String(Number(inline[1])) : null;
}

/** The discussion of a persisted row (between `full_discussion_text:` and `status:`), else the whole text. */
export function existingDiscussion(text: string | null | undefined): string {
  const raw = String(text ?? "");
  const m = raw.match(/full_discussion_text:\s*\r?\n([\s\S]*?)(?=\r?\nstatus:\s*)/i);
  return (m ? m[1] : raw).trim();
}

/**
 * A response header line in the Review Comments report thread: "<Label>: <who> - <m/d/yyyy h:mm AM>".
 * The report writes the reviewer comment first and then, for each response, a header line, the response text
 * and a dashed rule. Matching is by shape (a label, a colon, a dash and a date-time), never by a name or label.
 * The same rule is applied in SQL by scripts/permit-repo/repairs/d118-false-portal-change-marks.sql.
 */
export const RESPONSE_HEADER_LINE =
  /(?:^|\r?\n)[ \t]*[A-Za-z][A-Za-z .'-]{0,40}:[^\r\n]{0,200} - \d{1,2}\/\d{1,2}\/\d{2,4}[ ,]+\d{1,2}:\d{2}(?::\d{2})?[ \t]*(?:[AaPp][Mm])?[ \t]*(?=\r?\n|$)/;

/**
 * The reviewer-comment part of a persisted discussion: everything before the first response header.
 * `hasResponses = false` (the repository says the comment has no responses) keeps the whole text, so a
 * header-looking line inside a comment is never treated as the start of a response.
 */
export function commentPortionOf(discussion: string | null | undefined, hasResponses = true): string {
  const text = String(discussion ?? "");
  if (!hasResponses) return text;
  const m = RESPONSE_HEADER_LINE.exec(text);
  return m ? text.slice(0, m.index) : text;
}

/**
 * Whether a persisted discussion still shows this portal comment. Report-parsed rows hold the whole thread
 * (the reviewer comment, then each response behind a header line), while the repository `body` is the
 * reviewer comment alone. The comment part of the thread must equal the body (case, punctuation, spacing,
 * line breaks and e-mail redaction ignored). A shortened, truncated, extended or reworded comment differs,
 * and so does one that only lost trailing sentences, because those stay in the part before the first response.
 */
export function discussionMatchesComment(
  discussion: string | null | undefined,
  body: string | null | undefined,
  hasResponses = true,
): boolean {
  return looseText(commentPortionOf(discussion, hasResponses)) === looseText(body);
}

function statusLineOf(text: string | null | undefined): string | null {
  const m = String(text ?? "").match(/(?:^|\r?\n)status:\s*([^\r\n]*)/i);
  return m ? m[1].trim() : null;
}

function aiOwned(source: FieldSource | null | undefined): boolean {
  return source === "central" || source === "project_ai";
}

/**
 * A person wrote or reviewed something on the row: a response or assignment not written by AI (an unknown source
 * counts as a person, D-122), a response status, an approval or a human edit. AI drafts and rule-based routing
 * labels with a recorded AI source are not work, so portal text updates can replace them.
 */
export function hasHumanWork(row: ExistingParsedComment): boolean {
  return Boolean(
    (String(row.response_text ?? "").trim() && !aiOwned(row.response_text_source)) ||
      row.response_status ||
      row.approved_at ||
      row.last_edited_by ||
      (String(row.assigned_to ?? "").trim() && !aiOwned(row.assigned_to_source)),
  );
}

type CentralField = { field: "discipline" | "code_reference" | "response_text"; source: "discipline_source" | "code_reference_source" | "response_text_source" };
const CENTRAL_FIELDS: CentralField[] = [
  { field: "discipline", source: "discipline_source" },
  { field: "code_reference", source: "code_reference_source" },
  { field: "response_text", source: "response_text_source" },
];

function centralValue(ins: CentralInsight, field: CentralField["field"]): string | null {
  const v = field === "response_text" ? ins.guidance_text : ins[field];
  const s = String(v ?? "").trim();
  return s ? s : null;
}

function blank(v: unknown, field?: CentralField["field"]): boolean {
  if (field === "discipline") return !isClassified(v as string | null);
  return !String(v ?? "").trim();
}

/** Values a new row takes from its central result: zero AI calls for classification and enrichment. */
export function centralInsertFields(ins: CentralInsight | undefined): ParsedCommentPatch {
  if (!ins) return { processing_status: "pending" };
  const out: ParsedCommentPatch = { central_insight_id: ins.insight_id, processing_status: "pending" };
  for (const f of CENTRAL_FIELDS) {
    const v = centralValue(ins, f.field);
    if (v != null) {
      out[f.field] = v;
      out[f.source] = "central";
    }
  }
  return out;
}

/**
 * Applies the current central result to an existing row, field by field:
 *   source central            → refreshed to the new value (a response only while unreviewed and unapproved);
 *   empty and unknown source  → filled, source central;
 *   anything else             → kept; when a newer central result differs from a value a person set (or one of
 *                               unknown origin), central_update_at is set so the Response Matrix can say so.
 * project_ai values are left alone: the project agents own them.
 */
export function planCentralFields(row: ExistingParsedComment, ins: CentralInsight, now: string): { patch: ParsedCommentPatch; applied: number; refreshed: number; flagged: boolean } {
  const patch: ParsedCommentPatch = {};
  let applied = 0;
  let refreshed = 0;
  let differs = false;
  const newer = Boolean(row.central_insight_id) && row.central_insight_id !== ins.insight_id;
  const r = row as Record<string, unknown>;
  for (const f of CENTRAL_FIELDS) {
    const next = centralValue(ins, f.field);
    const current = r[f.field] as string | null | undefined;
    const source = r[f.source] as FieldSource | null | undefined;
    const responseLocked = f.field === "response_text" && Boolean(row.response_status || row.approved_at);
    if (source === "central" && !responseLocked) {
      if ((current ?? null) !== next) {
        patch[f.field] = next;
        refreshed++;
      }
      continue;
    }
    if (source == null && blank(current, f.field) && next != null && !responseLocked) {
      patch[f.field] = next;
      patch[f.source] = "central";
      applied++;
      continue;
    }
    if (newer && source !== "project_ai" && next != null && looseText(current) !== looseText(next)) differs = true;
  }
  if (row.central_insight_id !== ins.insight_id) patch.central_insight_id = ins.insight_id;
  if (differs) patch.central_update_at = now;
  else if (row.central_update_at && newer) patch.central_update_at = null;
  return { patch, applied, refreshed, flagged: differs };
}

/**
 * After a portal text replacement, AI values derived from the old text (central or project_ai) are cleared so they
 * are re-derived: from the new text's central result when there is one, otherwise by the project agents.
 * Values a person set (or of unknown origin) stay.
 */
function clearAiFields(row: ExistingParsedComment, set: (k: string, v: string | number | null) => void) {
  const r = row as Record<string, unknown>;
  for (const [field, source] of [
    ["discipline", "discipline_source"],
    ["code_reference", "code_reference_source"],
    ["response_text", "response_text_source"],
    ["assigned_to", "assigned_to_source"],
  ] as const) {
    if (aiOwned(r[source] as FieldSource | null | undefined)) {
      set(field, null);
      set(source, null);
    }
  }
  set("central_insight_id", null);
  set("processing_status", "pending");
  set("processing_attempts", 0);
}

/**
 * True when the row's status is still the value the parser derived from the last portal status it saw,
 * so updating it cannot overwrite a person's choice. Unknown history counts as a human choice.
 */
export function statusIsParserOwned(row: ExistingParsedComment): boolean {
  const lastPortal = row.portal_status_raw ?? statusLineOf(row.original_text);
  if (lastPortal == null) return false;
  return normalizePortalStatus(lastPortal) === String(row.status ?? "");
}

function identityKey(permitId: string, key: string): string {
  return `${permitId}\u241f${key}`;
}

export function planRepositoryCommentMerge(input: {
  projectId: string;
  permits: RepositoryPermit[];
  comments: RepositoryComment[];
  existing: ExistingParsedComment[];
  now: string;
  /** Current central results of these permits; absent or empty = project agents do the work as before. */
  insights?: CentralInsight[];
}): RepositoryMergePlan {
  const { projectId, permits, now } = input;
  const permitById = new Map(permits.map((p) => [p.id, p]));
  const insightByKey = new Map((input.insights ?? []).map((i) => [identityKey(i.permit_id, i.portal_comment_key), i]));
  const comments = input.comments
    .filter((c) => permitById.has(c.permit_id) && c.portal_comment_key)
    .slice()
    .sort((a, b) =>
      a.permit_id === b.permit_id
        ? (a.ref_number ?? Number.MAX_SAFE_INTEGER) - (b.ref_number ?? Number.MAX_SAFE_INTEGER) ||
          a.portal_comment_key.localeCompare(b.portal_comment_key)
        : a.permit_id.localeCompare(b.permit_id),
    );
  const existing = input.existing.filter((r) => PORTAL_SOURCES.has(String(r.ingest_source ?? "")));

  const byIdentity = new Map<string, ExistingParsedComment>();
  const legacy: ExistingParsedComment[] = [];
  for (const r of existing) {
    if (r.portal_permit_id && r.portal_comment_key) {
      const k = identityKey(r.portal_permit_id, r.portal_comment_key);
      if (!byIdentity.has(k)) byIdentity.set(k, r);
    } else {
      legacy.push(r);
    }
  }
  // Ref numbers are unique per permit only, so a legacy row (no permit id) is matched by ref only when
  // the project has exactly one linked permit. Text matching is safe for any number of permits.
  const singlePermit = permits.length === 1;
  const legacyByRef = new Map<string, ExistingParsedComment>();
  const legacyByText = new Map<string, ExistingParsedComment>();
  for (const r of legacy) {
    const ref = existingRef(r);
    if (singlePermit && ref && !legacyByRef.has(ref)) legacyByRef.set(ref, r);
    const t = looseText(existingDiscussion(r.original_text));
    if (t && !legacyByText.has(t)) legacyByText.set(t, r);
  }

  const matched = new Set<string>();
  const plan: RepositoryMergePlan = {
    inserts: [],
    updates: [],
    softRemovals: [],
    stats: {
      incoming: comments.length,
      matched: 0,
      inserted: 0,
      updated: 0,
      text_replaced: 0,
      text_change_flagged: 0,
      status_updated: 0,
      status_kept_human: 0,
      restored: 0,
      soft_removed: 0,
      central_applied: 0,
      central_refreshed: 0,
      central_flagged: 0,
    },
  };

  for (const c of comments) {
    const permit = permitById.get(c.permit_id)!;
    const ref = c.ref_number != null ? String(c.ref_number) : null;
    let row = byIdentity.get(identityKey(c.permit_id, c.portal_comment_key));
    if (row && matched.has(row.id)) row = undefined;
    if (!row && ref) {
      const r = legacyByRef.get(ref);
      if (r && !matched.has(r.id)) row = r;
    }
    if (!row) {
      const r = legacyByText.get(looseText(c.body));
      if (r && !matched.has(r.id) && looseText(c.body)) row = r;
    }

    const hash = repositoryCommentHash(c);
    const text = formatRepositoryComment(c, permit.permit_number);
    const portalStatus = normalizePortalStatus(c.status);
    const insight = insightByKey.get(identityKey(c.permit_id, c.portal_comment_key));

    if (!row) {
      plan.inserts.push({
        project_id: projectId,
        original_text: text,
        discipline: null,
        code_reference: null,
        page_number: null,
        status: portalStatus,
        comment_number: ref,
        ingest_source: "raw_ref",
        portal_permit_id: c.permit_id,
        portal_comment_key: c.portal_comment_key,
        portal_content_hash: hash,
        portal_status_raw: c.status ?? null,
        portal_last_seen_at: now,
        ...centralInsertFields(insight),
      });
      plan.stats.inserted++;
      if (insight) plan.stats.central_applied++;
      continue;
    }

    matched.add(row.id);
    plan.stats.matched++;
    const patch: ParsedCommentPatch = {};
    const set = (k: string, v: string | number | null) => {
      if ((row as Record<string, unknown>)[k] !== v) patch[k] = v;
      else delete patch[k];
    };
    set("portal_permit_id", c.permit_id);
    set("portal_comment_key", c.portal_comment_key);
    if (!String(row.comment_number ?? "").trim() && ref) set("comment_number", ref);
    if (row.portal_removed_at) {
      patch.portal_removed_at = null;
      plan.stats.restored++;
    }

    // The stored hash (over the source comment and its metadata, never the thread or any drafted text) is the
    // fast path. A different hash is only a change when the comment the row shows differs from the portal's
    // comment; a formatting-only difference in the source (spacing, punctuation, e-mail redaction) is not.
    // A row without a hash (first adoption) is compared with the text it shows.
    const hasResponses = c.response_count === undefined ? true : c.response_count > 0;
    const showsPortalComment = discussionMatchesComment(existingDiscussion(row.original_text), c.body, hasResponses);
    const textChanged = row.portal_content_hash
      ? row.portal_content_hash !== hash && !showsPortalComment
      : !showsPortalComment;
    // A row whose new portal text was only flagged still shows the old text: the central result (of the new text)
    // does not describe it, so it is not applied until a person accepts the change.
    let showsCurrentText = true;
    if (textChanged) {
      if (hasHumanWork(row)) {
        showsCurrentText = false;
        set("portal_latest_text", text);
        set("portal_changed_at", now);
        plan.stats.text_change_flagged++;
      } else {
        set("original_text", text);
        set("portal_latest_text", null);
        set("portal_changed_at", null);
        clearAiFields(row, set);
        plan.stats.text_replaced++;
      }
    } else if (row.portal_latest_text && showsPortalComment) {
      // The portal went back to the text the row already shows: the pending notice no longer applies.
      set("portal_latest_text", null);
      set("portal_changed_at", null);
    }
    set("portal_content_hash", hash);

    if (String(row.status ?? "") !== portalStatus) {
      if (statusIsParserOwned(row)) {
        set("status", portalStatus);
        plan.stats.status_updated++;
      } else {
        plan.stats.status_kept_human++;
      }
    }
    set("portal_status_raw", c.status ?? null);
    if (insight && showsCurrentText) {
      // Evaluated on the row as it will be after this patch (a replaced text cleared AI values), against the
      // central result the row had before, so a person's value that differs from a newer result is flagged.
      const central = planCentralFields({ ...row, ...patch, central_insight_id: row.central_insight_id } as ExistingParsedComment, insight, now);
      for (const [k, v] of Object.entries(central.patch)) set(k, v);
      plan.stats.central_applied += central.applied;
      plan.stats.central_refreshed += central.refreshed;
      if (central.flagged) plan.stats.central_flagged++;
    }
    // Bookkeeping only; written with the other fields so an unchanged row is not touched.
    if (Object.keys(patch).length > 0) {
      patch.portal_last_seen_at = now;
      plan.updates.push({ id: row.id, patch });
      plan.stats.updated++;
    }
  }

  // Removals are trusted only for permits whose Reviews listing was complete. A legacy row without a
  // permit id belongs to the single linked permit; with several permits its origin is unknown and it stays.
  const onlyPermit = singlePermit ? permits[0] : null;
  for (const r of existing) {
    if (matched.has(r.id) || r.portal_removed_at) continue;
    const owner = r.portal_permit_id ? permitById.get(r.portal_permit_id) : onlyPermit;
    if (!owner || !owner.reviews_complete) continue;
    plan.softRemovals.push(r.id);
    plan.stats.soft_removed++;
  }
  return plan;
}
