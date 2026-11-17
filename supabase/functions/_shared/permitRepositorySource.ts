/**
 * Reads a project's linked-permit comments and applies the merge plan (D-110). Runs with a service-role
 * client because service-mode calls have no auth.uid(); access is therefore checked explicitly: only
 * permits the acting user can read (user_can_read_permit) contribute comments (D-006: a link grants nothing).
 */

import {
  planRepositoryCommentMerge,
  type ExistingParsedComment,
  type RepositoryComment,
  type RepositoryMergePlan,
  type RepositoryPermit,
} from "./permitRepositoryComments.ts";

type QueryResult<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;

/** The subset of supabase-js used here; tests pass a fake. */
// deno-lint-ignore no-explicit-any
export type ServiceClient = { from: (table: string) => any; rpc: (fn: string, args: Record<string, unknown>) => QueryResult<unknown> };

export const PARSED_COMMENT_MERGE_COLUMNS =
  "id, original_text, comment_number, status, ingest_source, response_text, response_status, approved_at, last_edited_by, " +
  "portal_permit_id, portal_comment_key, portal_content_hash, portal_status_raw, portal_removed_at, portal_latest_text, portal_changed_at";

export type RepositorySource = {
  linkedPermitIds: string[];
  permits: RepositoryPermit[];
  comments: RepositoryComment[];
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
  if (readable.length === 0) return { linkedPermitIds: linked, permits: [], comments: [] };

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

  return {
    linkedPermitIds: linked,
    permits: ((permitRows ?? []) as Array<{ id: string; permit_number: string | null }>).map((p) => ({
      id: p.id,
      permit_number: p.permit_number,
      reviews_complete: complete.has(p.id),
    })),
    comments: (commentRows ?? []) as RepositoryComment[],
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

  const plan = planRepositoryCommentMerge({ projectId, permits: source.permits, comments: source.comments, existing, now });

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
