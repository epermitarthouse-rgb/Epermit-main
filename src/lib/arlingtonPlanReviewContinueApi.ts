import { getScraperBaseUrl } from "@/lib/scraperBaseUrl";

export type ArlingtonPlanReviewContinueScope =
  | "allPending"
  | "secondary"
  | "planSet"
  | "reviewResults"
  | "approvedDocuments";

export type ArlingtonPlanReviewContinueResponse = {
  status: string;
  scope: ArlingtonPlanReviewContinueScope;
  permitNumber: string;
  projectId: string;
  planSetTotal?: number;
  planSetDownloaded?: number;
  planSetPending?: number;
  reviewResultsTotal?: number;
  reviewResultsDownloaded?: number;
  reviewResultsPending?: number;
  approvedTotal?: number;
  approvedDownloaded?: number;
  approvedPending?: number;
  downloadedThisRun?: number;
  attemptedThisRun?: number;
  skippedAlreadyDownloaded?: number;
  pendingByReason?: Record<string, number>;
  stoppedReason?: string;
  nextRecommendedScope?: string;
  error?: string;
};

export const CLIENT_MISSING_ACCELA_SESSION_MSG =
  "Active Accela session not found. Please login to Accela again from Portal Monitor, then continue downloads.";

async function parseJsonSafe(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { message: text };
  }
}

export function mapContinuePlanReviewError(
  body: Record<string, unknown>,
  status: number,
): string {
  const err = String(body.error || body.message || "").trim();
  const lower = err.toLowerCase();
  if (/userid is required/i.test(lower)) {
    return "User ID missing. Refresh the page and try again.";
  }
  if (/session not found/i.test(lower)) {
    return "Accela session not found. Please login again.";
  }
  if (
    /session expired|browser not available|browser unavailable/i.test(lower)
  ) {
    return "Accela session expired or browser unavailable. Please login again.";
  }
  if (err) return err;
  return `Continue Plan Review downloads failed (${status})`;
}

/** Clear persisted Accela browser session when backend confirms session is dead. */
export function shouldClearAccelaBrowserSessionOnError(message: string): boolean {
  const lower = `${message || ""}`.toLowerCase();
  return (
    /session not found/i.test(lower) ||
    /session expired/i.test(lower) ||
    /browser not available/i.test(lower) ||
    /browser unavailable/i.test(lower)
  );
}

export async function continueAccelaPlanReviewDownloads({
  sessionId,
  projectId,
  userId,
  permitNumber,
  scope = "allPending",
}: {
  sessionId: string;
  projectId: string;
  userId: string;
  permitNumber: string;
  scope?: ArlingtonPlanReviewContinueScope;
}): Promise<ArlingtonPlanReviewContinueResponse> {
  const base = getScraperBaseUrl();
  const res = await fetch(`${base}/api/accela/plan-review/continue-downloads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      projectId,
      userId,
      permitNumber,
      scope,
    }),
  });

  const body = await parseJsonSafe(res);
  if (!res.ok) {
    throw new Error(mapContinuePlanReviewError(body, res.status));
  }

  return body as ArlingtonPlanReviewContinueResponse;
}
