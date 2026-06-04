import { supabase } from "@/lib/supabase";
import { getScraperBaseUrl } from "@/lib/scraperBaseUrl";
import type {
  LifecycleState,
  UciApplicationsListResponse,
  UciDiscoveryResponse,
  UciInitResponse,
  UciPepcoDashboardDiscoveryResponse,
  UciProjectCoordinationResponse,
  UciProvidersResponse,
  UciRecordDetailResponse,
  UciTransitionResponse,
} from "@/types/uci";

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

export async function listUciProviders(): Promise<UciProvidersResponse> {
  const base = getScraperBaseUrl();
  const headers = await getBearerHeader();
  const res = await fetch(`${base}/api/uci/providers`, { headers });
  if (!res.ok) {
    const err = await parseJsonSafe(res);
    throw new Error(
      String(err.message || err.error || `Failed to load providers (${res.status})`),
    );
  }
  return (await res.json()) as UciProvidersResponse;
}

export async function listProjectCoordination(
  projectId: string,
): Promise<UciProjectCoordinationResponse> {
  const base = getScraperBaseUrl();
  const headers = await getBearerHeader();
  const res = await fetch(
    `${base}/api/uci/projects/${encodeURIComponent(projectId)}/coordination`,
    { headers },
  );
  if (!res.ok) {
    const err = await parseJsonSafe(res);
    throw new Error(
      String(err.message || err.error || `Failed to load coordination (${res.status})`),
    );
  }
  return (await res.json()) as UciProjectCoordinationResponse;
}

export async function initProjectCoordination(
  projectId: string,
  providers: string[],
): Promise<UciInitResponse> {
  const base = getScraperBaseUrl();
  const headers = { ...(await getBearerHeader()), "Content-Type": "application/json" };
  const res = await fetch(
    `${base}/api/uci/projects/${encodeURIComponent(projectId)}/coordination/init`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ providers }),
    },
  );
  if (!res.ok) {
    const err = await parseJsonSafe(res);
    throw new Error(
      String(err.message || err.error || `Failed to initialize coordination (${res.status})`),
    );
  }
  return (await res.json()) as UciInitResponse;
}

export async function getCoordinationDetail(
  coordinationId: string,
): Promise<UciRecordDetailResponse> {
  const base = getScraperBaseUrl();
  const headers = await getBearerHeader();
  const res = await fetch(
    `${base}/api/uci/coordination/${encodeURIComponent(coordinationId)}`,
    { headers },
  );
  if (!res.ok) {
    const err = await parseJsonSafe(res);
    throw new Error(
      String(err.message || err.error || `Failed to load coordination detail (${res.status})`),
    );
  }
  return (await res.json()) as UciRecordDetailResponse;
}

export async function transitionCoordination(
  coordinationId: string,
  payload: { to_stage: number; to_state: LifecycleState; reason?: string },
): Promise<UciTransitionResponse> {
  const base = getScraperBaseUrl();
  const headers = { ...(await getBearerHeader()), "Content-Type": "application/json" };
  const res = await fetch(
    `${base}/api/uci/coordination/${encodeURIComponent(coordinationId)}/transition`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    const err = await parseJsonSafe(res);
    throw new Error(
      String(err.message || err.error || `Failed to update stage (${res.status})`),
    );
  }
  return (await res.json()) as UciTransitionResponse;
}

export async function listCoordinationApplications(
  coordinationId: string,
): Promise<UciApplicationsListResponse> {
  const base = getScraperBaseUrl();
  const headers = await getBearerHeader();
  const res = await fetch(
    `${base}/api/uci/coordination/${encodeURIComponent(coordinationId)}/applications`,
    { headers },
  );
  if (!res.ok) {
    const err = await parseJsonSafe(res);
    throw new Error(
      String(err.message || err.error || `Failed to load applications (${res.status})`),
    );
  }
  return (await res.json()) as UciApplicationsListResponse;
}

export async function postPepcoDiscovery(
  coordinationId: string,
  body?: { credential_id?: string; headed?: boolean; auto_email_mfa?: boolean },
): Promise<UciDiscoveryResponse> {
  const base = getScraperBaseUrl();
  const headers = {
    ...(await getBearerHeader()),
    "Content-Type": "application/json",
  };
  const res = await fetch(
    `${base}/api/uci/coordination/${encodeURIComponent(coordinationId)}/discovery/pepco`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body ?? {}),
    },
  );
  if (!res.ok) {
    const err = await parseJsonSafe(res);
    throw new Error(
      String(err.message || err.error || `PEPCO discovery failed (${res.status})`),
    );
  }
  return (await res.json()) as UciDiscoveryResponse;
}

export async function resumePepcoDiscovery(
  coordinationId: string,
  body: { session_id: string },
): Promise<UciDiscoveryResponse> {
  const base = getScraperBaseUrl();
  const headers = {
    ...(await getBearerHeader()),
    "Content-Type": "application/json",
  };
  const res = await fetch(
    `${base}/api/uci/coordination/${encodeURIComponent(coordinationId)}/discovery/pepco/resume`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const err = await parseJsonSafe(res);
    throw new Error(
      String(err.message || err.error || `PEPCO discovery resume failed (${res.status})`),
    );
  }
  return (await res.json()) as UciDiscoveryResponse;
}

export async function postPepcoDashboardDiscovery(
  coordinationId: string,
  body?: {
    credential_id?: string;
    headed?: boolean;
    auto_email_mfa?: boolean;
    capture_application_ids?: boolean;
  },
): Promise<UciPepcoDashboardDiscoveryResponse> {
  const base = getScraperBaseUrl();
  const headers = {
    ...(await getBearerHeader()),
    "Content-Type": "application/json",
  };
  const res = await fetch(
    `${base}/api/uci/coordination/${encodeURIComponent(coordinationId)}/discovery/pepco/dashboard`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body ?? {}),
    },
  );
  if (!res.ok) {
    const err = await parseJsonSafe(res);
    throw new Error(
      String(err.message || err.error || `PEPCO dashboard discovery failed (${res.status})`),
    );
  }
  return (await res.json()) as UciPepcoDashboardDiscoveryResponse;
}

export async function submitPepcoMfaCode(
  coordinationId: string,
  body: {
    session_id: string;
    code: string;
    continue_action?: "discover_dashboard";
    capture_application_ids?: boolean;
  },
): Promise<UciPepcoDashboardDiscoveryResponse> {
  const base = getScraperBaseUrl();
  const headers = {
    ...(await getBearerHeader()),
    "Content-Type": "application/json",
  };
  const res = await fetch(
    `${base}/api/uci/coordination/${encodeURIComponent(coordinationId)}/discovery/pepco/submit-code`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const err = await parseJsonSafe(res);
    throw new Error(
      String(err.message || err.error || `PEPCO submit code failed (${res.status})`),
    );
  }
  return (await res.json()) as UciPepcoDashboardDiscoveryResponse;
}
