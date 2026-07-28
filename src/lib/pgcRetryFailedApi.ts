/**
 * Thin frontend client for PGC targeted failed-artifact retry.
 * Reuses login + scrape job session flow; never starts a full harvest.
 */

import { getScraperBaseUrl } from "@/lib/scraperBaseUrl";
import { buildQuickScrapeRequestIdentity } from "@/lib/quickScrapeFormState";
import type { PgcRetryArtifactPayload } from "@/lib/portalHarvestFailedItems";

export type StartPgcFailedRetryArgs = {
  accessToken: string;
  credentialId: string;
  loginUrl?: string | null;
  userId: string;
  projectId: string;
  permitNumber: string;
  artifacts: PgcRetryArtifactPayload;
};

export type StartPgcFailedRetryResult = {
  sessionId: string;
  jobId: string | null;
  message?: string;
};

function scraperUrl(path: string): string {
  const base = getScraperBaseUrl().replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export function assertPgcRetryPayloadNonEmpty(
  artifacts: PgcRetryArtifactPayload,
): void {
  const files = artifacts?.files?.length ?? 0;
  const reports = artifacts?.reports?.length ?? 0;
  if (files + reports === 0) {
    throw new Error("No retryable failed items selected");
  }
}

/**
 * Login with saved portal credentials, then start a PGC-scoped targeted retry job.
 */
export async function startPgcFailedArtifactsRetry(
  args: StartPgcFailedRetryArgs,
): Promise<StartPgcFailedRetryResult> {
  assertPgcRetryPayloadNonEmpty(args.artifacts);

  let loginRes: Response;
  try {
    loginRes = await fetch(scraperUrl("/api/login"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.accessToken}`,
      },
      body: JSON.stringify({
        credentialId: args.credentialId,
        portalUrl: args.loginUrl || undefined,
      }),
    });
  } catch {
    throw new Error("SCRAPER_OFFLINE");
  }

  if (!loginRes.ok) {
    const errData = (await loginRes.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(errData.error || `Scraper login failed (${loginRes.status})`);
  }

  const loginData = (await loginRes.json()) as { sessionId?: string };
  const sessionId = loginData.sessionId ? String(loginData.sessionId).trim() : "";
  if (!sessionId) {
    throw new Error("Login succeeded but response had no sessionId");
  }

  const body = {
    ...buildQuickScrapeRequestIdentity({
      sessionId,
      userId: args.userId,
      projectId: args.projectId,
      permitNumber: args.permitNumber,
    }),
    scrapeMode: "scrape_retry_selected",
    pgcRetryArtifacts: args.artifacts,
  };

  let scrapeRes: Response;
  try {
    scrapeRes = await fetch(scraperUrl("/api/scrape"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("SCRAPER_OFFLINE");
  }

  if (!scrapeRes.ok) {
    const errData = (await scrapeRes.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(errData.error || "Failed to start failed-items retry");
  }

  const scrapePayload = (await scrapeRes.json().catch(() => ({}))) as {
    jobId?: string | null;
    message?: string;
  };

  return {
    sessionId,
    jobId: scrapePayload.jobId ?? null,
    message: scrapePayload.message,
  };
}
