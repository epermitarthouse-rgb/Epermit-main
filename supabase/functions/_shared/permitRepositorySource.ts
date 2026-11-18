/**
 * Reads a project's linked-permit comments and their current central results (D-121) and applies the merge plan
 * (D-110, D-122). Runs with a service-role
 * client because service-mode calls have no auth.uid(); access is therefore checked explicitly: only
 * permits the acting user can read (user_can_read_permit) contribute comments (D-006: a link grants nothing).
 */

import {
  planRepositoryCommentMerge,
  type CentralInsight,
  type ExistingParsedComment,
  type RepositoryComment,
  type RepositoryMergePlan,
  type RepositoryPermit,
} from "./permitRepositoryComments.ts";

type QueryResult<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;

/** The subset of supabase-js used here; tests pass a fake. */
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ServiceClient = { from: (table: string) => any; rpc: (fn: string, args: Record<string, unknown>) => QueryResult<unknown> };

export const PARSED_COMMENT_MERGE_COLUMNS =
  "id, original_text, comment_number, status, ingest_source, response_text, response_status, approved_at, last_edited_by, assigned_to, " +
  "portal_permit_id, portal_comment_key, portal_content_hash, portal_status_raw, portal_removed_at, portal_latest_text, portal_changed_at, " +
  "discipline, code_reference, discipline_source, code_reference_source, response_text_source, assigned_to_source, " +
  "central_insight_id, central_update_at, processing_status";

export type RepositorySource = {
  linkedPermitIds: string[];
  permits: RepositoryPermit[];
  comments: RepositoryComment[];
  /** Current central results (D-121) of the readable permits; reused instead of project AI calls. */
  insights: CentralInsight[];
};

export async function linkedPermitIds(client: ServiceClient, projectId: string): Promise<string[]> {
  const { data, error } = await client.from("project_permits").select("permit_id").eq("project_id", projectId);
  if (error) throw new Error(`Failed to read linked permits: ${error.message}`);
  return ((data ?? []) as Array<{ permit_id: string }>).map((r) => r.permit_id);
}

export async function loadRepositorySource(client: ServiceClient, projectId: string, actingUserId: string): Promise<RepositorySource> {
  const linked = await linkedPermitIds(client, projectId);
  const readable: string[] = [];
  for (const permitId of linked) {
    const { data, error } = await client.rpc("user_can_read_permit", { p_user_id: actingUserId, p_permit_id: permitId });
    if (error) throw new Error(`Failed to check permit access: ${error.message}`);
    if (data === true) readable.push(permitId);
  }
  if (readable.length === 0) return { linkedPermitIds: linked, permits: [], comments: [], insights: [] };

  const { data: permitRows, error: permitErr } = await client.from("permits").select("id, permit_number").in("id", readable);
  if (permitErr) throw new Error(`Failed to read permits: ${permitErr.message}`);
  const { data: sectionRows, error: sectionErr } = await client
    .from("permit_section_state")
    .select("permit_id, status")
    .eq("section", "reviews")
    .in("permit_id", readable);
  if (sectionErr) throw new Error(`Failed to read review completeness: ${sectionErr.message}`);
  const complete = new Set(
    ((sectionRows ?? []) as Array<{ permit_id: string; status: string }>).filter((r) => r.status === "ok").map((r) => r.permit_id),
  );
  const { data: commentRows, error: commentErr } = await client
    .from("permit_review_comments")
    .select("permit_id, portal_comment_key, ref_number, cycle, department, comment_type, file_name, body, status, reviewed_at")
    .in("permit_id", readable)
    .is("removed_at", null);
  if (commentErr) throw new Error(`Failed to read permit comments: ${commentErr.message}`);
  const { data: responseRows, error: responseErr } = await client
    .from("permit_review_responses")
    .select("permit_id, comment_key")
    .in("permit_id", readable)
    .is("removed_at", null);
  if (responseErr) throw new Error(`Failed to read permit comment responses: ${responseErr.message}`);
  const responseCounts = new Map<string, number>();
  for (const r of (responseRows ?? []) as Array<{ permit_id: string; comment_key: string }>) {
    const k = `${r.permit_id}\u241f${r.comment_key}`;
    responseCounts.set(k, (responseCounts.get(k) ?? 0) + 1);
  }

  const { data: insightRows, error: insightErr } = await client.rpc("permit_central_current_insights", { p_permit_ids: readable });
  if (insightErr) throw new Error(`Failed to read central comment analysis: ${insightErr.message}`);

  return {
    linkedPermitIds: linked,
    insights: ((insightRows ?? []) as CentralInsight[]),
    permits: ((permitRows ?? []) as Array<{ id: string; permit_number: string | null }>).map((p) => ({
      id: p.id,
      permit_number: p.permit_number,
      reviews_complete: complete.has(p.id),
    })),
    comments: ((commentRows ?? []) as RepositoryComment[]).map((c) => ({
      ...c,
      response_count: responseCounts.get(`${c.permit_id}\u241f${c.portal_comment_key}`) ?? 0,
    })),
  };
}

export type RepositoryRefreshResult = {
  permits: number;
  stats: RepositoryMergePlan["stats"];
  final_portal_count: number;
};

export async function refreshFromRepository(
  client: ServiceClient,
  projectId: string,
  actingUserId: string,
  now: string = new Date().toISOString(),
): Promise<RepositoryRefreshResult> {
  const source = await loadRepositorySource(client, projectId, actingUserId);
  const { data: existingRows, error: existingErr } = await client
    .from("parsed_comments")
    .select(PARSED_COMMENT_MERGE_COLUMNS)
    .eq("project_id", projectId)
    .in("ingest_source", ["raw_ref", "fallback_llm"]);
  if (existingErr) throw new Error(`Failed to read existing comments: ${existingErr.message}`);
  const existing = (existingRows ?? []) as ExistingParsedComment[];

  const plan = planRepositoryCommentMerge({ projectId, permits: source.permits, comments: source.comments, existing, now, insights: source.insights });

  for (const u of plan.updates) {
    const { error } = await client.from("parsed_comments").update(u.patch).eq("id", u.id).eq("project_id", projectId);
    if (error) throw new Error(`Failed to update comment: ${error.message}`);
  }
  if (plan.inserts.length > 0) {
    const { error } = await client.from("parsed_comments").insert(plan.inserts);
    if (error) throw new Error(`Failed to add comments: ${error.message}`);
  }
  if (plan.softRemovals.length > 0) {
    const { error } = await client
      .from("parsed_comments")
      .update({ portal_removed_at: now })
      .eq("project_id", projectId)
      .in("id", plan.softRemovals);
    if (error) throw new Error(`Failed to mark removed comments: ${error.message}`);
  }

  const active = existing.filter((r) => !r.portal_removed_at).length - plan.stats.soft_removed + plan.stats.restored + plan.stats.inserted;
  return { permits: source.permits.length, stats: plan.stats, final_portal_count: active };
}
