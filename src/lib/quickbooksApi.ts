import { getScraperBaseUrl } from "@/lib/scraperBaseUrl";
import {
  isUciSessionExpiredError,
  uciAuthenticatedFetch,
} from "@/lib/uciApi";

export type QuickBooksEnvironment = "sandbox" | "production" | string;

export type QuickBooksPublicStatus = {
  connected: boolean;
};

export type QuickBooksAuthenticatedStatus = QuickBooksPublicStatus & {
  environment?: QuickBooksEnvironment;
  realmIdMasked?: string | null;
  accessTokenExpiresAt?: string | null;
};

export interface InvoiceTriggerSuccessBody {
  dryRun: boolean;
  milestone: string;
  environment?: QuickBooksEnvironment;
  payload?: Record<string, unknown>;
  totals?: {
    baseMilestoneAmount?: number;
    reimbursementAmount?: number;
    adminFeeAmount?: number;
    totalInvoiceAmount?: number;
  };
  invoice?: { id?: string };
}

async function parseJsonSafe(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { message: text };
  }
}

function rethrowQuickBooksAuthError(err: unknown): never {
  if (isUciSessionExpiredError(err)) {
    const authErr = new Error("Your session expired. Sign in again and retry.") as Error & {
      code?: string;
    };
    authErr.code = "INVALID_JWT";
    throw authErr;
  }
  if (err instanceof Error && err.message === "Not authenticated") {
    const authErr = new Error("Not authenticated") as Error & { code?: string };
    authErr.code = "UNAUTHENTICATED";
    throw authErr;
  }
  throw err;
}

/** GET /api/quickbooks/status — authenticated callers receive environment metadata. */
export async function getQuickBooksStatus(): Promise<QuickBooksAuthenticatedStatus> {
  try {
    const res = await uciAuthenticatedFetch("/api/quickbooks/status");
    if (!res.ok) {
      const err = await parseJsonSafe(res);
      throw new Error(String(err.message || err.error || `QuickBooks status failed (${res.status})`));
    }
    return (await res.json()) as QuickBooksAuthenticatedStatus;
  } catch (err) {
    if (err instanceof Error && err.message === "Not authenticated") {
      const base = getScraperBaseUrl();
      const res = await fetch(`${base}/api/quickbooks/status`);
      if (!res.ok) {
        const body = await parseJsonSafe(res);
        throw new Error(String(body.message || body.error || `QuickBooks status failed (${res.status})`));
      }
      return (await res.json()) as QuickBooksAuthenticatedStatus;
    }
    rethrowQuickBooksAuthError(err);
  }
}

/** GET /api/quickbooks/oauth/start?format=json */
export async function getQuickBooksAuthorizeUrl(): Promise<string> {
  let res: Response;
  try {
    res = await uciAuthenticatedFetch("/api/quickbooks/oauth/start?format=json");
  } catch (err) {
    rethrowQuickBooksAuthError(err);
  }

  if (!res.ok) {
    const err = await parseJsonSafe(res);
    throw new Error(String(err.message || err.error || `QuickBooks OAuth start failed (${res.status})`));
  }
  const data = (await res.json()) as { authorizeUrl?: string };
  if (!data.authorizeUrl) throw new Error("QuickBooks OAuth start did not return authorizeUrl.");
  return data.authorizeUrl;
}

/** POST /api/quickbooks/invoice/trigger */
export async function postInvoiceTrigger(
  body: Record<string, unknown>,
): Promise<InvoiceTriggerSuccessBody> {
  let res: Response;
  try {
    res = await uciAuthenticatedFetch("/api/quickbooks/invoice/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    rethrowQuickBooksAuthError(err);
  }

  const data = await parseJsonSafe(res);
  if (!res.ok) {
    const err = new Error(String(data.message || `Request failed (${res.status})`)) as Error & {
      code?: string;
    };
    err.code = typeof data.error === "string" ? data.error : undefined;
    throw err;
  }
  return data as InvoiceTriggerSuccessBody;
}

export function quickBooksEnvironmentLabel(environment?: string | null): string {
  const env = String(environment || "").trim().toLowerCase();
  if (env === "production") return "Production";
  if (env === "sandbox") return "Sandbox";
  return env ? env : "Unknown";
}
