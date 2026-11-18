/**
 * Permit-level downstream matrix rows.
 *
 * One row per active permit_review_comments record (removed_at null). Response cells are the
 * portal thread on permit_review_responses (comment_key, seq), not a project working copy.
 * Discipline, code reference and preliminary guidance come only from a ready, current
 * permit_comment_insights row whose input_hash still matches — the same rule as
 * permit_central_current_insights, which the project link merge reads.
 */

type Row = Record<string, unknown>;

const text = (v: unknown): string => (v == null ? "" : String(v));

export interface PermitDownstreamResponse {
  id: string;
  seq: number;
  role: string;
  body: string;
  respondedAt: string;
}

export interface PermitDownstreamRow {
  id: string;
  refNumber: string;
  cycle: string;
  department: string;
  commentType: string;
  fileName: string;
  reviewedAt: string;
  body: string;
  /** Portal status word, unchanged. */
  status: string;
  responses: PermitDownstreamResponse[];
  discipline: string;
  codeReference: string;
  guidance: string;
}

/**
 * public._permit_comment_input_hash: btrim of the ASCII space only, then collapse whitespace.
 * Department, comment type and jurisdiction are lower-cased. Nothing is trimmed after the collapse,
 * so a trailing newline becomes a trailing space.
 */
export function normalizePermitCommentInputPart(value: unknown, lower: boolean): string {
  const collapsed = text(value).replace(/^ +/, "").replace(/ +$/, "").replace(/\s+/g, " ");
  return lower ? collapsed.toLowerCase() : collapsed;
}

export function permitCommentInputMaterial(input: {
  body: unknown;
  department: unknown;
  commentType: unknown;
  jurisdiction: unknown;
}): string {
  return [
    normalizePermitCommentInputPart(input.body, false),
    normalizePermitCommentInputPart(input.department, true),
    normalizePermitCommentInputPart(input.commentType, true),
    normalizePermitCommentInputPart(input.jurisdiction, true),
  ].join("\u001f");
}

export async function permitCommentInputHash(input: {
  body: unknown;
  department: unknown;
  commentType: unknown;
  jurisdiction: unknown;
}): Promise<string> {
  const bytes = new TextEncoder().encode(permitCommentInputMaterial(input));
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("SHA-256 is not available in this runtime");
  const digest = await subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function cycleRank(cycle: string): number {
  if (!cycle) return Number.NEGATIVE_INFINITY;
  const n = Number(cycle);
  return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
}

function refRank(value: unknown): number {
  if (value == null || value === "") return Number.POSITIVE_INFINITY;
  const n = Number(value);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

function filled(value: unknown): string {
  return text(value).trim();
}

function matchingInsight(commentId: string, hash: string | undefined, insights: Row[]): Row | null {
  if (!hash) return null;
  const found = insights.filter(
    (i) =>
      text(i.comment_id) === commentId &&
      text(i.status) === "ready" &&
      i.is_current === true &&
      text(i.input_hash) === hash,
  );
  found.sort((a, b) => text(a.id).localeCompare(text(b.id)));
  return found[0] ?? null;
}

/** Active comments, portal responses in seq order, and ready insights whose hash still matches. */
export function mapPermitDownstreamRows(input: {
  comments: Row[];
  responses: Row[];
  insights: Row[];
  inputHashes: ReadonlyMap<string, string>;
}): PermitDownstreamRow[] {
  const threads = new Map<string, Row[]>();
  for (const response of input.responses) {
    if (response.removed_at) continue;
    const key = text(response.comment_key);
    const list = threads.get(key) ?? [];
    list.push(response);
    threads.set(key, list);
  }
  for (const list of threads.values()) {
    list.sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0) || text(a.id).localeCompare(text(b.id)));
  }

  const active = input.comments.filter((c) => !c.removed_at);
  active.sort((a, b) => {
    const byCycle = cycleRank(text(b.cycle)) - cycleRank(text(a.cycle));
    if (byCycle) return byCycle;
    const byRef = refRank(a.ref_number) - refRank(b.ref_number);
    if (byRef) return byRef;
    return text(a.id).localeCompare(text(b.id));
  });

  return active.map((comment) => {
    const id = text(comment.id);
    const insight = matchingInsight(id, input.inputHashes.get(id), input.insights);
    const thread = threads.get(text(comment.portal_comment_key)) ?? [];
    return {
      id,
      refNumber: text(comment.ref_number),
      cycle: text(comment.cycle),
      department: text(comment.department),
      commentType: text(comment.comment_type),
      fileName: text(comment.file_name),
      reviewedAt: text(comment.reviewed_at),
      body: text(comment.body),
      status: text(comment.status),
      responses: thread.map((r) => ({
        id: text(r.id),
        seq: Number(r.seq ?? 0),
        role: text(r.responder_role),
        body: text(r.body),
        respondedAt: text(r.responded_at),
      })),
      discipline: filled(insight?.discipline),
      codeReference: filled(insight?.code_reference),
      guidance: filled(insight?.guidance_text),
    };
  });
}

export async function buildPermitDownstreamRows(input: {
  comments: Row[];
  responses: Row[];
  insights: Row[];
  jurisdiction: unknown;
}): Promise<PermitDownstreamRow[]> {
  const hashes = new Map<string, string>();
  await Promise.all(
    input.comments.filter((c) => !c.removed_at).map(async (comment) => {
      const id = text(comment.id);
      hashes.set(
        id,
        await permitCommentInputHash({
          body: comment.body,
          department: comment.department,
          commentType: comment.comment_type,
          jurisdiction: input.jurisdiction,
        }),
      );
    }),
  );
  return mapPermitDownstreamRows({ ...input, inputHashes: hashes });
}
