import type {
  UciNormalizedSyncCountBucket,
  UciNormalizedSyncResult,
  UciPortalSyncResponse,
} from "@/types/uci";

export function portalSyncResponseToNormalizedResult(
  summary: UciPortalSyncResponse,
): UciNormalizedSyncResult {
  const totalFailed =
    summary.applications.failed + summary.communications.failed + summary.milestones.failed;
  const totalMutations =
    summary.applications.inserted +
    summary.applications.updated +
    summary.communications.inserted +
    summary.communications.updated +
    summary.milestones.inserted +
    summary.milestones.updated;
  const totalSkipped =
    summary.applications.skipped + summary.communications.skipped + summary.milestones.skipped;

  let status: UciNormalizedSyncResult["status"] = "success";
  if (summary.errors.length > 0 || totalFailed > 0) {
    status = totalMutations > 0 || totalSkipped > 0 ? "partial" : "failed";
  }

  return {
    status,
    applications: summary.applications,
    communications: summary.communications,
    milestones: summary.milestones,
    errors: summary.errors,
    synced_at: summary.syncedAt ?? null,
  };
}

export function formatNormalizedSyncCountLine(
  label: string,
  bucket: UciNormalizedSyncCountBucket,
): string {
  const parts = [
    bucket.inserted ? `+${bucket.inserted}` : null,
    bucket.updated ? `~${bucket.updated}` : null,
    bucket.skipped ? `=${bucket.skipped}` : null,
    bucket.failed ? `!${bucket.failed}` : null,
  ].filter(Boolean);
  return `${label}: ${parts.length ? parts.join(" ") : "0 changes"}`;
}

export function formatNormalizedSyncSummary(result: UciNormalizedSyncResult): string {
  const apps = formatNormalizedSyncCountLine("apps", result.applications);
  const comms = formatNormalizedSyncCountLine("comms", result.communications);
  const milestones = formatNormalizedSyncCountLine("events", result.milestones);
  return `${apps}; ${comms}; ${milestones}`;
}

export function normalizedSyncDrawerMessage(result: UciNormalizedSyncResult): string | null {
  if (result.status === "success") {
    return `System data synced (${formatNormalizedSyncSummary(result)}).`;
  }
  if (result.status === "partial") {
    const errHint = result.errors[0] ? ` ${result.errors[0]}` : "";
    return `Portal scrape saved, but system data sync was only partial (${formatNormalizedSyncSummary(result)}).${errHint} Use Re-sync normalized data to retry.`;
  }
  if (result.status === "failed") {
    const errHint = result.errors[0] || "Normalized sync failed.";
    return `Portal scrape saved, but system data sync failed. ${errHint} Use Re-sync normalized data to retry.`;
  }
  if (result.status === "not_run" && result.reason === "disabled") {
    return "System data sync is disabled on this server.";
  }
  return null;
}

export function notifyNormalizedSyncResult(
  result: UciNormalizedSyncResult | null | undefined,
  toast: {
    success: (msg: string) => void;
    message: (msg: string) => void;
    error: (msg: string) => void;
  },
): void {
  if (!result) return;

  if (result.status === "success") {
    toast.message(`System data synced (${formatNormalizedSyncSummary(result)}).`);
    return;
  }

  if (result.status === "partial") {
    toast.message(
      `Portal data saved. System sync partial (${formatNormalizedSyncSummary(result)}). Use Re-sync normalized data to retry.`,
    );
    return;
  }

  if (result.status === "failed") {
    toast.error(
      result.errors[0]
        ? `Portal data saved, but system sync failed: ${result.errors[0]}`
        : "Portal data saved, but system sync failed. Use Re-sync normalized data to retry.",
    );
  }
}
