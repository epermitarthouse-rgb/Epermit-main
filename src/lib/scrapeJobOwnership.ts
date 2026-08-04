import { isScrapeJobTerminal } from "@/lib/scrapeJobTypes";

export type ScrapeJobOwnershipFields = {
  user_id?: string | null;
  tenant_id?: string | null;
  project_id?: string | null;
  status?: string | null;
};

export type ScrapeOwnershipContext = {
  userId: string;
  tenantId?: string | null;
  /** When set, job.project_id must match. */
  projectId?: string | null;
};

/**
 * Job belongs to the current user when scrape_jobs.user_id matches.
 * Tenant is enforced when both sides have a tenant id.
 */
export function isOwnedScrapeJob(
  job: ScrapeJobOwnershipFields | null | undefined,
  ctx: ScrapeOwnershipContext,
): boolean {
  if (!job) return false;
  const userId = `${ctx.userId || ""}`.trim();
  if (!userId) return false;

  const jobUserId = `${job.user_id || ""}`.trim();
  if (!jobUserId || jobUserId !== userId) return false;

  const ctxTenant = `${ctx.tenantId || ""}`.trim();
  const jobTenant = `${job.tenant_id || ""}`.trim();
  if (ctxTenant && jobTenant && ctxTenant !== jobTenant) return false;

  const ctxProject = `${ctx.projectId || ""}`.trim();
  if (ctxProject) {
    const jobProject = `${job.project_id || ""}`.trim();
    if (!jobProject || jobProject !== ctxProject) return false;
  }

  return true;
}

/**
 * Restore is allowed only for owned, non-terminal jobs.
 */
export function canRestorePersistedScrapeJob(
  job: ScrapeJobOwnershipFields | null | undefined,
  ctx: ScrapeOwnershipContext,
): boolean {
  if (!isOwnedScrapeJob(job, ctx)) return false;
  if (isScrapeJobTerminal(job?.status)) return false;
  return true;
}
