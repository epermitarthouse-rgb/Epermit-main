import { supabase } from "@/lib/supabase";
import { getScraperBaseUrl } from "@/lib/scraperBaseUrl";

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

async function bearer(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Not authenticated");
  return { Authorization: `Bearer ${token}` };
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

/** GET /api/quickbooks/status — authenticated callers receive environment metadata. */
export async function getQuickBooksStatus(): Promise<QuickBooksAuthenticatedStatus> {
  const base = getScraperBaseUrl();
  let headers: Record<string, string> = {};
  try {
    headers = await bearer();
  } catch {
    /* unauthenticated public-safe probe */
  }
  const res = await fetch(`${base}/api/quickbooks/status`, { headers });
  if (!res.ok) {
    const err = await parseJsonSafe(res);
    throw new Error(String(err.message || err.error || `QuickBooks status failed (${res.status})`));
  }
  return (await res.json()) as QuickBooksAuthenticatedStatus;
}

/** GET /api/quickbooks/oauth/start?format=json */
export async function getQuickBooksAuthorizeUrl(): Promise<string> {
  const base = getScraperBaseUrl();
  const headers = await bearer();
  const q = new URLSearchParams({ format: "json" });
  const res = await fetch(`${base}/api/quickbooks/oauth/start?${q.toString()}`, { headers });
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
  const base = getScraperBaseUrl();
  const headers = {
    ...(await bearer()),
    "Content-Type": "application/json",
  };
  const res = await fetch(`${base}/api/quickbooks/invoice/trigger`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
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
