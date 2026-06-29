import { supabase } from "@/lib/supabase";
import type { ArlingtonScrapeTabOpts } from "@/lib/arlingtonPlanReviewScrapeScope";
import {
  ARLINGTON_ACTIVE_JOB_STATUSES,
  buildArlingtonScopeKey,
  normalizeArlingtonPermitNumber,
  normalizeArlingtonRequestedScope,
  type ArlingtonScrapeJobRow,
} from "@/lib/arlingtonScrapeJobIdentity";

export async function findActiveArlingtonScrapeJob(
  projectId: string,
  permitNumber: string,
  arlingtonOpts?: ArlingtonScrapeTabOpts | null,
): Promise<ArlingtonScrapeJobRow | null> {
  const pid = `${projectId || ""}`.trim();
  const permit = normalizeArlingtonPermitNumber(permitNumber);
  if (!pid || !permit) return null;

  const scope = normalizeArlingtonRequestedScope({
    tabs: arlingtonOpts?.tabs,
    planReviewScope: arlingtonOpts?.planReviewScope,
    autoContinueDownloads: arlingtonOpts?.autoContinueDownloads,
  });
  const scopeKey = buildArlingtonScopeKey(scope);

  const { data, error } = await supabase
    .from("scrape_jobs")
    .select(
      "id, status, phase, project_id, permit_number, normalized_permit_number, normalized_scope_key, requested_scope",
    )
    .eq("project_id", pid)
    .eq("normalized_permit_number", permit)
    .eq("normalized_scope_key", scopeKey)
    .in("status", [...ARLINGTON_ACTIVE_JOB_STATUSES])
    .is("completed_at", null)
    .order("checkpoint_version", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as ArlingtonScrapeJobRow) || null;
}

export async function findActiveArlingtonScrapeJobForProject(
  projectId: string,
): Promise<ArlingtonScrapeJobRow | null> {
  const pid = `${projectId || ""}`.trim();
  if (!pid) return null;

  const { data, error } = await supabase
    .from("scrape_jobs")
    .select(
      "id, status, phase, project_id, permit_number, normalized_permit_number, normalized_scope_key, requested_scope",
    )
    .eq("project_id", pid)
    .ilike("jurisdiction", "%arlington%")
    .in("status", [...ARLINGTON_ACTIVE_JOB_STATUSES])
    .is("completed_at", null)
    .order("checkpoint_version", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as ArlingtonScrapeJobRow) || null;
}
