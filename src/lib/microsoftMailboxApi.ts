import { supabase } from "@/lib/supabase";
import { getScraperBaseUrl } from "@/lib/scraperBaseUrl";

/** Cross-tab signal after OAuth callback so Settings can refetch without a full reload. */
export const MICROSOFT_MAILBOX_SYNC_CHANNEL = "permitpilot-microsoft-mailbox";
export const MICROSOFT_MAILBOX_SYNC_STORAGE_KEY = "permitpilot:microsoft-mailbox-connected";

export type MicrosoftMailboxSyncPayload = {
  type: "connected";
  at: number;
  mailbox_email?: string | null;
};

export function parseMicrosoftMailboxSyncStorageValue(
  raw: string | null,
): MicrosoftMailboxSyncPayload | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as Partial<MicrosoftMailboxSyncPayload>;
    if (!obj || obj.type !== "connected" || typeof obj.at !== "number") return null;
    return {
      type: "connected",
      at: obj.at,
      mailbox_email: typeof obj.mailbox_email === "string" ? obj.mailbox_email : null,
    };
  } catch {
    return null;
  }
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

/** Legacy OAuth start hint / PEPCO MFA convenience only — NOT the Stage 4 From sender.
 * Stage 4 P1 sends as the connected Graph `/me` identity stored per PermitPilot user. */
export const DEFAULT_MICROSOFT_MAILBOX = "Permitting@commun-et.com";

export type MicrosoftMailboxStatus = {
  connected: boolean;
  mailbox_email?: string | null;
  last_connected_at?: string | null;
  last_checked_at?: string | null;
  last_error?: string | null;
};

/** GET /api/microsoft/mailbox/status */
export async function getMicrosoftMailboxStatus(): Promise<MicrosoftMailboxStatus> {
  const base = getScraperBaseUrl();
  const headers = await bearer();
  const res = await fetch(`${base}/api/microsoft/mailbox/status`, { headers });
  if (!res.ok) {
    const err = await parseJsonSafe(res);
    throw new Error(String(err.message || err.error || `Mailbox status failed (${res.status})`));
  }
  return (await res.json()) as MicrosoftMailboxStatus;
}

/** GET /api/microsoft/oauth/start?format=json — returns authorize URL without top-level Bearer navigation */
export async function getMicrosoftAuthorizeUrl(mailboxEmail = DEFAULT_MICROSOFT_MAILBOX): Promise<string> {
  const base = getScraperBaseUrl();
  const headers = await bearer();
  const q = new URLSearchParams({ format: "json", mailbox_email: mailboxEmail });
  const res = await fetch(`${base}/api/microsoft/oauth/start?${q.toString()}`, { headers });
  if (!res.ok) {
    const err = await parseJsonSafe(res);
    throw new Error(String(err.message || err.error || `Microsoft OAuth prepare failed (${res.status})`));
  }
  const body = await res.json();
  const url = typeof body.authorizeUrl === "string" ? body.authorizeUrl : "";
  if (!url) throw new Error("Microsoft OAuth prepare response missing authorizeUrl");
  return url;
}

/** POST /api/microsoft/mailbox/test-read */
export async function testMicrosoftMailboxRead(): Promise<{ status: string; messages_checked?: number }> {
  const base = getScraperBaseUrl();
  const headers = {
    ...(await bearer()),
    "Content-Type": "application/json",
  };
  const res = await fetch(`${base}/api/microsoft/mailbox/test-read`, {
    method: "POST",
    headers,
    body: "{}",
  });
  const body = await parseJsonSafe(res);
  if (!res.ok) {
    throw new Error(String(body.message || body.error || `Mailbox test-read failed (${res.status})`));
  }
  return body as { status: string; messages_checked?: number };
}
