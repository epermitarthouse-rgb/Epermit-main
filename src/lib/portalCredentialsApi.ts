import { supabase } from "@/lib/supabase";
import { getScraperBaseUrl } from "@/lib/scraperBaseUrl";

/** Never includes stored password — use `password_configured` for UI status. */
export interface PortalCredentialSafe {
  id: string;
  user_id: string;
  jurisdiction: string;
  portal_username: string;
  login_url: string | null;
  permit_number: string | null;
  project_id: string | null;
  created_at: string;
  password_configured?: boolean;
}

async function getBearerHeader(): Promise<Record<string, string>> {
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

export async function fetchPortalCredentialsList(): Promise<PortalCredentialSafe[]> {
  const base = getScraperBaseUrl();
  const headers = await getBearerHeader();
  const res = await fetch(`${base}/api/portal-credentials`, { headers });
  if (!res.ok) {
    const err = await parseJsonSafe(res);
    throw new Error(
      String(err.message || err.error || `Failed to load credentials (${res.status})`),
    );
  }
  return (await res.json()) as PortalCredentialSafe[];
}

export async function createPortalCredentialViaApi(payload: {
  jurisdiction: string;
  portal_username: string;
  portal_password: string;
  login_url?: string;
  permit_number?: string;
  project_id?: string | null;
}): Promise<PortalCredentialSafe> {
  const base = getScraperBaseUrl();
  const auth = await getBearerHeader();
  const res = await fetch(`${base}/api/portal-credentials`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await parseJsonSafe(res);
    throw new Error(
      String(err.message || err.error || `Failed to create credential (${res.status})`),
    );
  }
  return (await res.json()) as PortalCredentialSafe;
}

export async function updatePortalCredentialViaApi(
  id: string,
  payload: {
    jurisdiction?: string;
    portal_username?: string;
    login_url?: string;
    permit_number?: string;
    project_id?: string | null;
    /** Omit or leave empty string to preserve existing stored password server-side */
    portal_password?: string;
  },
): Promise<PortalCredentialSafe> {
  const base = getScraperBaseUrl();
  const auth = await getBearerHeader();
  const body: Record<string, string | null> = {};
  if (payload.jurisdiction != null) body.jurisdiction = payload.jurisdiction;
  if (payload.portal_username != null) body.portal_username = payload.portal_username;
  if (payload.login_url != null) body.login_url = payload.login_url;
  if (payload.permit_number != null) body.permit_number = payload.permit_number;
  if (payload.project_id !== undefined) body.project_id = payload.project_id;
  if (
    payload.portal_password !== undefined &&
    String(payload.portal_password).trim() !== ""
  ) {
    body.portal_password = String(payload.portal_password).trim();
  }

  const res = await fetch(`${base}/api/portal-credentials/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await parseJsonSafe(res);
    throw new Error(
      String(err.message || err.error || `Failed to update credential (${res.status})`),
    );
  }
  return (await res.json()) as PortalCredentialSafe;
}

export async function deletePortalCredentialViaApi(id: string): Promise<void> {
  const base = getScraperBaseUrl();
  const auth = await getBearerHeader();
  const res = await fetch(`${base}/api/portal-credentials/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: auth,
  });
  if (!res.ok && res.status !== 204) {
    const err = await parseJsonSafe(res);
    throw new Error(
      String(err.message || err.error || `Failed to delete credential (${res.status})`),
    );
  }
}
