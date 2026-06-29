/**
 * Canonical Arlington requested_scope identity (mirrors scraper-service/lib/arlington-scope-normalize.js).
 */

const DEFAULT_TABS = ["info", "attachments", "plan_review"];

export const ARLINGTON_ACTIVE_JOB_STATUSES = [
  "queued",
  "running",
  "resuming",
  "rate_limited",
  "partial",
  "waiting_user",
] as const;

export type ArlingtonRequestedScopeInput = {
  tabs?: string[];
  planReviewScope?: string;
  autoContinueAttachments?: boolean;
  autoContinueDownloads?: boolean;
  downloadDocuments?: boolean;
};

export function normalizeArlingtonPermitNumber(permitNumber: string | null | undefined): string {
  return `${permitNumber || ""}`.trim().toUpperCase();
}

export function normalizeArlingtonRequestedScope(
  raw?: ArlingtonRequestedScopeInput | null,
): Required<ArlingtonRequestedScopeInput> & { tabs: string[] } {
  const input = raw && typeof raw === "object" ? raw : {};
  const tabSet = new Set(
    (Array.isArray(input.tabs) ? input.tabs : DEFAULT_TABS)
      .map((t) => String(t).trim())
      .filter(Boolean),
  );
  const tabs = [...tabSet].sort();
  return {
    tabs: tabs.length > 0 ? tabs : [...DEFAULT_TABS].sort(),
    planReviewScope: input.planReviewScope ? String(input.planReviewScope).trim() : "all",
    autoContinueAttachments: input.autoContinueAttachments !== false,
    autoContinueDownloads: input.autoContinueDownloads !== false,
    downloadDocuments: input.downloadDocuments !== false,
  };
}

export function buildArlingtonScopeKey(scope?: ArlingtonRequestedScopeInput | null): string {
  const norm = normalizeArlingtonRequestedScope(scope);
  return [
    `tabs=${norm.tabs.join(",")}`,
    `pr=${norm.planReviewScope}`,
    `att=${norm.autoContinueAttachments ? 1 : 0}`,
    `dl=${norm.autoContinueDownloads ? 1 : 0}`,
    `docs=${norm.downloadDocuments ? 1 : 0}`,
  ].join("|");
}

export type ArlingtonScrapeJobRow = {
  id: string;
  status: string;
  phase: string | null;
  project_id: string;
  permit_number: string | null;
  normalized_permit_number?: string | null;
  normalized_scope_key?: string | null;
  requested_scope?: ArlingtonRequestedScopeInput | null;
};
