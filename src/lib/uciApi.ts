import { supabase } from "@/lib/supabase";
import { getScraperBaseUrl } from "@/lib/scraperBaseUrl";
import type {
  LifecycleState,
  UciApplicationsListResponse,
  UciCommunicationsListResponse,
  UciDiscoveryResponse,
  UciInitResponse,
  UciMilestonesListResponse,
  UciPepcoDashboardDiscoveryResponse,
  UciPepcoApplicationDetailDiscoveryResponse,
  UciPortalSyncResponse,
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

export async function triggerCoordinationSync(
  coordinationId: string,
  body?: { provider_slug?: string },
): Promise<UciPortalSyncResponse> {
  const base = getScraperBaseUrl();
  const headers = {
    ...(await getBearerHeader()),
    "Content-Type": "application/json",
  };
  const res = await fetch(
    `${base}/api/uci/coordination/${encodeURIComponent(coordinationId)}/sync`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body ?? {}),
    },
  );
  if (!res.ok) {
    const err = await parseJsonSafe(res);
    throw new Error(
      String(err.message || err.error || `Coordination sync failed (${res.status})`),
    );
  }
  return (await res.json()) as UciPortalSyncResponse;
}

export async function listCoordinationCommunications(
  coordinationId: string,
  params?: { limit?: number; offset?: number },
): Promise<UciCommunicationsListResponse> {
  const base = getScraperBaseUrl();
  const headers = await getBearerHeader();
  const qs = new URLSearchParams();
  if (params?.limit != null) qs.set("limit", String(params.limit));
  if (params?.offset != null) qs.set("offset", String(params.offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const res = await fetch(
    `${base}/api/uci/coordination/${encodeURIComponent(coordinationId)}/communications${suffix}`,
    { headers },
  );
  if (!res.ok) {
    const err = await parseJsonSafe(res);
    throw new Error(
      String(err.message || err.error || `Failed to load communications (${res.status})`),
    );
  }
  return (await res.json()) as UciCommunicationsListResponse;
}

export async function listCoordinationMilestones(
  coordinationId: string,
  params?: { limit?: number; offset?: number },
): Promise<UciMilestonesListResponse> {
  const base = getScraperBaseUrl();
  const headers = await getBearerHeader();
  const qs = new URLSearchParams();
  if (params?.limit != null) qs.set("limit", String(params.limit));
  if (params?.offset != null) qs.set("offset", String(params.offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const res = await fetch(
    `${base}/api/uci/coordination/${encodeURIComponent(coordinationId)}/milestones${suffix}`,
    { headers },
  );
  if (!res.ok) {
    const err = await parseJsonSafe(res);
    throw new Error(
      String(err.message || err.error || `Failed to load milestones (${res.status})`),
    );
  }
  return (await res.json()) as UciMilestonesListResponse;
}

export async function postPepcoApplicationDetailDiscovery(
  coordinationId: string,
  body?: {
    credential_id?: string;
    headed?: boolean;
    auto_email_mfa?: boolean;
    application_uuids?: string[];
    download_documents?: boolean;
  },
): Promise<UciPepcoApplicationDetailDiscoveryResponse> {
  const base = getScraperBaseUrl();
  const headers = {
    ...(await getBearerHeader()),
    "Content-Type": "application/json",
  };
  const res = await fetch(
    `${base}/api/uci/coordination/${encodeURIComponent(coordinationId)}/discovery/pepco/application-details`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body ?? {}),
    },
  );
  if (!res.ok) {
    const err = await parseJsonSafe(res);
    throw new Error(
      String(err.message || err.error || `PEPCO application detail discovery failed (${res.status})`),
    );
  }
  return (await res.json()) as UciPepcoApplicationDetailDiscoveryResponse;
}

export async function resumePepcoApplicationDetailDiscovery(
  coordinationId: string,
  body: {
    session_id: string;
    code?: string;
    application_uuids?: string[];
    download_documents?: boolean;
  },
): Promise<UciPepcoApplicationDetailDiscoveryResponse> {
  const base = getScraperBaseUrl();
  const headers = {
    ...(await getBearerHeader()),
    "Content-Type": "application/json",
  };
  const res = await fetch(
    `${base}/api/uci/coordination/${encodeURIComponent(coordinationId)}/discovery/pepco/application-details/resume`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const err = await parseJsonSafe(res);
    throw new Error(
      String(err.message || err.error || `PEPCO application detail resume failed (${res.status})`),
    );
  }
  return (await res.json()) as UciPepcoApplicationDetailDiscoveryResponse;
}

/** Build the authenticated inline-view URL for a scraped PEPCO PDF document. */
export function buildPepcoApplicationDocumentViewUrl(
  coordinationId: string,
  applicationUuid: string,
  documentIndex: number,
): string {
  const base = getScraperBaseUrl();
  return `${base}/api/uci/coordination/${encodeURIComponent(coordinationId)}/discovery/pepco/application-details/${encodeURIComponent(applicationUuid)}/documents/${documentIndex}/view`;
}

export type PepcoDocumentViewFailureReason =
  | "api_error"
  | "empty_file"
  | "not_pdf"
  | "popup_blocked"
  | "copy_unavailable";

export const PEPCO_DOCUMENT_COPY_UNAVAILABLE_MESSAGE =
  "The stored document copy is no longer available. Refresh project details to save it again.";

export type PepcoDocumentViewResult =
  | { ok: true }
  | { ok: false; reason: PepcoDocumentViewFailureReason };

/** Map a view result to a user-facing toast message, or null when no toast should be shown. */
export function pepcoDocumentViewErrorMessage(result: PepcoDocumentViewResult): string | null {
  if (result.ok) return null;
  if (result.reason === "popup_blocked") {
    return "Your browser blocked the preview tab. Allow pop-ups for PermitPilot and try again.";
  }
  if (result.reason === "copy_unavailable") {
    return PEPCO_DOCUMENT_COPY_UNAVAILABLE_MESSAGE;
  }
  return "The PEPCO document could not be opened for viewing.";
}

export function pepcoDocumentDownloadErrorMessage(
  httpStatus: number,
  body: Record<string, unknown>,
): string {
  if (httpStatus === 410 && body.error === "DOCUMENT_COPY_UNAVAILABLE") {
    return String(body.message || PEPCO_DOCUMENT_COPY_UNAVAILABLE_MESSAGE);
  }
  return String(body.message || body.error || `HTTP ${httpStatus}`);
}

/**
 * Fetch a scraped PEPCO PDF and display it inline in a preview tab.
 * The preview tab must be opened synchronously from the click handler and
 * passed in so popup blockers allow navigation after the async fetch.
 */
export async function openPepcoApplicationDocumentView(
  coordinationId: string,
  applicationUuid: string,
  documentIndex: number,
  previewWindow: Window | null,
): Promise<PepcoDocumentViewResult> {
  if (!previewWindow) {
    return { ok: false, reason: "popup_blocked" };
  }

  try {
    const headers = await getBearerHeader();
    const url = buildPepcoApplicationDocumentViewUrl(
      coordinationId,
      applicationUuid,
      documentIndex,
    );
    const res = await fetch(url, { headers });
    if (!res.ok) {
      previewWindow.close();
      const err = await parseJsonSafe(res);
      if (res.status === 410 && err.error === "DOCUMENT_COPY_UNAVAILABLE") {
        return { ok: false, reason: "copy_unavailable" };
      }
      return { ok: false, reason: "api_error" };
    }

    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("application/pdf")) {
      previewWindow.close();
      return { ok: false, reason: "not_pdf" };
    }

    const blob = await res.blob();
    if (!blob.size) {
      previewWindow.close();
      return { ok: false, reason: "empty_file" };
    }

    const typedBlob = blob.type ? blob : new Blob([blob], { type: "application/pdf" });
    const objectUrl = URL.createObjectURL(typedBlob);
    previewWindow.location.href = objectUrl;
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    return { ok: true };
  } catch {
    try {
      previewWindow.close();
    } catch {
      // Ignore close failures on an already-closed preview tab.
    }
    return { ok: false, reason: "api_error" };
  }
}

/** Trigger a browser download for a scraped PEPCO document via the UCI download route. */
export async function downloadPepcoApplicationDocument(
  coordinationId: string,
  applicationUuid: string,
  documentIndex: number,
  suggestedFileName?: string | null,
): Promise<void> {
  const base = getScraperBaseUrl();
  const headers = await getBearerHeader();
  const url = `${base}/api/uci/coordination/${encodeURIComponent(coordinationId)}/discovery/pepco/application-details/${encodeURIComponent(applicationUuid)}/documents/${documentIndex}/download`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const err = await parseJsonSafe(res);
    throw new Error(pepcoDocumentDownloadErrorMessage(res.status, err));
  }
  const blob = await res.blob();
  if (!blob.size) {
    throw new Error("empty_file");
  }
  const disposition = res.headers.get("content-disposition") || "";
  const match = /filename="([^"]+)"/i.exec(disposition);
  const fileName = match?.[1] || suggestedFileName || "pepco-document";
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
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
