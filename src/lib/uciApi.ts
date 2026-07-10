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

export const UCI_SESSION_EXPIRED_MESSAGE =
  "Your PermitPilot session has expired. Please sign in again.";

/** Thrown when PermitPilot auth cannot be refreshed for UCI API calls. */
export class UciSessionExpiredError extends Error {
  constructor(message = UCI_SESSION_EXPIRED_MESSAGE) {
    super(message);
    this.name = "UciSessionExpiredError";
  }
}

export function isUciSessionExpiredError(err: unknown): boolean {
  return err instanceof UciSessionExpiredError;
}

/** Map API/auth failures to user-safe UCI messages (never raw INVALID_JWT text). */
export function formatUciUserError(err: unknown, fallback: string): string {
  if (isUciSessionExpiredError(err)) return UCI_SESSION_EXPIRED_MESSAGE;
  if (err instanceof Error) {
    if (err.message === "Invalid or expired authentication token") {
      return UCI_SESSION_EXPIRED_MESSAGE;
    }
    if (err.message === "Not authenticated") {
      return UCI_SESSION_EXPIRED_MESSAGE;
    }
    if (err.message.trim()) return err.message;
  }
  return fallback;
}

/** @returns Unix seconds or null when expiry cannot be determined safely. */
export function decodeAccessTokenExpiry(accessToken: string): number | null {
  try {
    const parts = accessToken.split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")),
    ) as { exp?: unknown };
    return typeof payload.exp === "number" && Number.isFinite(payload.exp)
      ? payload.exp
      : null;
  } catch {
    return null;
  }
}

export function isAccessTokenExpiredOrExpiringSoon(
  expiresAtSec: number | null | undefined,
  leadSeconds = 60,
): boolean {
  if (expiresAtSec == null || !Number.isFinite(expiresAtSec)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  return expiresAtSec <= nowSec + leadSeconds;
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

function isInvalidJwtResponse(status: number, body: Record<string, unknown>): boolean {
  return (
    status === 401 &&
    (body.error === "INVALID_JWT" ||
      body.message === "Invalid or expired authentication token")
  );
}

function mapUciHttpError(
  status: number,
  body: Record<string, unknown>,
  fallback: string,
): Error {
  if (
    status === 401 &&
    (isInvalidJwtResponse(status, body) ||
      body.error === "UNAUTHENTICATED" ||
      body.message === "Authentication required")
  ) {
    return new UciSessionExpiredError();
  }
  return new Error(String(body.message || body.error || fallback));
}

type UciFetchDiagnostics = {
  endpoint: string;
  tokenExpiry: number | null;
  refreshAttempted: boolean;
  retryAttempted: boolean;
  finalStatus: number;
  mfaSensitive?: boolean;
};

function logUciFetchDiagnostics(diag: UciFetchDiagnostics): void {
  if (!import.meta.env?.DEV) return;
  console.info("[uci-api]", {
    endpoint: diag.endpoint,
    tokenExpiry: diag.tokenExpiry,
    refreshAttempted: diag.refreshAttempted,
    retryAttempted: diag.retryAttempted,
    finalStatus: diag.finalStatus,
  });
}

type UciAuthSessionResult = Awaited<ReturnType<typeof supabase.auth.getSession>>;
type UciAuthRefreshResult = Awaited<ReturnType<typeof supabase.auth.refreshSession>>;

type UciAuthDeps = {
  getSession: () => Promise<UciAuthSessionResult>;
  refreshSession: () => Promise<UciAuthRefreshResult>;
};

const defaultAuthDeps: UciAuthDeps = {
  getSession: () => supabase.auth.getSession(),
  refreshSession: () => supabase.auth.refreshSession(),
};

let authDepsOverride: Partial<UciAuthDeps> | null = null;
let scraperBaseUrlOverride: string | null = null;

function getUciRequestBaseUrl(): string {
  return scraperBaseUrlOverride ?? getScraperBaseUrl();
}

function getAuthDeps(): UciAuthDeps {
  return { ...defaultAuthDeps, ...authDepsOverride };
}

/** Shared in-flight refresh — only one refreshSession() at a time across UCI callers. */
let refreshInFlight: Promise<string> | null = null;

function coordinatedRefreshSession(): Promise<string> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const { data, error } = await getAuthDeps().refreshSession();
        const token = data.session?.access_token;
        if (error || !token) {
          throw new UciSessionExpiredError();
        }
        return token;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

/**
 * Resolve the current Supabase access token from the shared client session.
 * Supabase autoRefreshToken remains the primary refresh authority.
 */
export async function getValidUciAccessToken(): Promise<{
  token: string;
  expiry: number | null;
}> {
  const {
    data: { session },
  } = await getAuthDeps().getSession();

  if (!session?.access_token) {
    throw new Error("Not authenticated");
  }

  const expiry =
    typeof session.expires_at === "number" && Number.isFinite(session.expires_at)
      ? session.expires_at
      : decodeAccessTokenExpiry(session.access_token);

  return {
    token: session.access_token,
    expiry,
  };
}

type UciAuthenticatedFetchOptions = {
  /** Revalidate token immediately before sensitive MFA/resume calls. */
  mfaSensitive?: boolean;
};

/**
 * Perform an authenticated UCI HTTP request using the current session token.
 * On confirmed 401 INVALID_JWT only, performs one coordinated refresh and retries once.
 */
export async function uciAuthenticatedFetch(
  path: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
  options: UciAuthenticatedFetchOptions = {},
): Promise<Response> {
  const base = getUciRequestBaseUrl();
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;

  let refreshAttempted = false;
  let retryAttempted = false;

  const runOnce = async (token: string) => {
    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${token}`,
    };
    return fetch(url, { ...init, headers });
  };

  let tokenState = await getValidUciAccessToken();

  let res = await runOnce(tokenState.token);

  if (res.status === 401 && !retryAttempted) {
    const body = await parseJsonSafe(res.clone());
    if (isInvalidJwtResponse(res.status, body)) {
      retryAttempted = true;
      refreshAttempted = true;
      try {
        const refreshedToken = await coordinatedRefreshSession();
        tokenState = {
          token: refreshedToken,
          expiry: decodeAccessTokenExpiry(refreshedToken),
        };
        res = await runOnce(refreshedToken);
      } catch (err) {
        logUciFetchDiagnostics({
          endpoint: path,
          tokenExpiry: tokenState.expiry,
          refreshAttempted,
          retryAttempted,
          finalStatus: 401,
        });
        if (err instanceof UciSessionExpiredError) throw err;
        throw new UciSessionExpiredError();
      }
    }
  }

  logUciFetchDiagnostics({
    endpoint: path,
    tokenExpiry: tokenState.expiry,
    refreshAttempted,
    retryAttempted,
    finalStatus: res.status,
    ...(options.mfaSensitive ? { mfaSensitive: true } : {}),
  });

  return res;
}

/** @internal Regression-test hooks only — do not use in application code. */
export const __uciApiTestHooks = {
  setAuthDepsOverride(deps: Partial<UciAuthDeps> | null) {
    authDepsOverride = deps;
  },
  setScraperBaseUrlOverride(url: string | null) {
    scraperBaseUrlOverride = url;
  },
  resetRefreshInFlight() {
    refreshInFlight = null;
  },
};

async function uciFetchJson<T>(
  path: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
  errorFallback: string,
  options?: UciAuthenticatedFetchOptions,
): Promise<T> {
  const res = await uciAuthenticatedFetch(path, init, options);
  if (!res.ok) {
    const err = await parseJsonSafe(res);
    throw mapUciHttpError(res.status, err, errorFallback);
  }
  return (await res.json()) as T;
}

export async function listUciProviders(): Promise<UciProvidersResponse> {
  return uciFetchJson<UciProvidersResponse>(
    "/api/uci/providers",
    {},
    "Failed to load providers",
  );
}

export async function listProjectCoordination(
  projectId: string,
): Promise<UciProjectCoordinationResponse> {
  return uciFetchJson<UciProjectCoordinationResponse>(
    `/api/uci/projects/${encodeURIComponent(projectId)}/coordination`,
    {},
    "Failed to load coordination",
  );
}

export async function initProjectCoordination(
  projectId: string,
  providers: string[],
): Promise<UciInitResponse> {
  return uciFetchJson<UciInitResponse>(
    `/api/uci/projects/${encodeURIComponent(projectId)}/coordination/init`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providers }),
    },
    "Failed to initialize coordination",
  );
}

export async function getCoordinationDetail(
  coordinationId: string,
): Promise<UciRecordDetailResponse> {
  return uciFetchJson<UciRecordDetailResponse>(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}`,
    {},
    "Failed to load coordination detail",
  );
}

export async function transitionCoordination(
  coordinationId: string,
  payload: { to_stage: number; to_state: LifecycleState; reason?: string },
): Promise<UciTransitionResponse> {
  return uciFetchJson<UciTransitionResponse>(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/transition`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "Failed to update stage",
  );
}

export async function listCoordinationApplications(
  coordinationId: string,
): Promise<UciApplicationsListResponse> {
  return uciFetchJson<UciApplicationsListResponse>(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/applications`,
    {},
    "Failed to load applications",
  );
}

export async function postPepcoDiscovery(
  coordinationId: string,
  body?: { credential_id?: string; headed?: boolean; auto_email_mfa?: boolean },
): Promise<UciDiscoveryResponse> {
  return uciFetchJson<UciDiscoveryResponse>(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/discovery/pepco`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    },
    "PEPCO discovery failed",
  );
}

export async function resumePepcoDiscovery(
  coordinationId: string,
  body: { session_id: string },
): Promise<UciDiscoveryResponse> {
  return uciFetchJson<UciDiscoveryResponse>(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/discovery/pepco/resume`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    "PEPCO discovery resume failed",
    { mfaSensitive: true },
  );
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
  return uciFetchJson<UciPepcoDashboardDiscoveryResponse>(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/discovery/pepco/dashboard`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    },
    "PEPCO dashboard discovery failed",
  );
}

export async function triggerCoordinationSync(
  coordinationId: string,
  body?: { provider_slug?: string },
): Promise<UciPortalSyncResponse> {
  return uciFetchJson<UciPortalSyncResponse>(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/sync`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    },
    "Coordination sync failed",
  );
}

export async function listCoordinationCommunications(
  coordinationId: string,
  params?: { limit?: number; offset?: number },
): Promise<UciCommunicationsListResponse> {
  const qs = new URLSearchParams();
  if (params?.limit != null) qs.set("limit", String(params.limit));
  if (params?.offset != null) qs.set("offset", String(params.offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return uciFetchJson<UciCommunicationsListResponse>(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/communications${suffix}`,
    {},
    "Failed to load communications",
  );
}

export async function listCoordinationMilestones(
  coordinationId: string,
  params?: { limit?: number; offset?: number },
): Promise<UciMilestonesListResponse> {
  const qs = new URLSearchParams();
  if (params?.limit != null) qs.set("limit", String(params.limit));
  if (params?.offset != null) qs.set("offset", String(params.offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return uciFetchJson<UciMilestonesListResponse>(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/milestones${suffix}`,
    {},
    "Failed to load milestones",
  );
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
  return uciFetchJson<UciPepcoApplicationDetailDiscoveryResponse>(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/discovery/pepco/application-details`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    },
    "PEPCO application detail discovery failed",
  );
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
  return uciFetchJson<UciPepcoApplicationDetailDiscoveryResponse>(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/discovery/pepco/application-details/resume`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    "PEPCO application detail resume failed",
    { mfaSensitive: true },
  );
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
  | "copy_unavailable"
  | "session_expired";

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
  if (result.reason === "session_expired") {
    return UCI_SESSION_EXPIRED_MESSAGE;
  }
  return "The PEPCO document could not be opened for viewing.";
}

export function pepcoDocumentDownloadErrorMessage(
  httpStatus: number,
  body: Record<string, unknown>,
): string {
  if (httpStatus === 401 && isInvalidJwtResponse(httpStatus, body)) {
    return UCI_SESSION_EXPIRED_MESSAGE;
  }
  if (httpStatus === 410 && body.error === "DOCUMENT_COPY_UNAVAILABLE") {
    return String(body.message || PEPCO_DOCUMENT_COPY_UNAVAILABLE_MESSAGE);
  }
  const raw = String(body.message || body.error || `HTTP ${httpStatus}`);
  if (raw === "Invalid or expired authentication token") {
    return UCI_SESSION_EXPIRED_MESSAGE;
  }
  return raw;
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
    const path = `/api/uci/coordination/${encodeURIComponent(coordinationId)}/discovery/pepco/application-details/${encodeURIComponent(applicationUuid)}/documents/${documentIndex}/view`;
    const res = await uciAuthenticatedFetch(path, {});
    if (!res.ok) {
      previewWindow.close();
      const err = await parseJsonSafe(res);
      if (res.status === 410 && err.error === "DOCUMENT_COPY_UNAVAILABLE") {
        return { ok: false, reason: "copy_unavailable" };
      }
      if (res.status === 401 && isInvalidJwtResponse(res.status, err)) {
        return { ok: false, reason: "session_expired" };
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
  } catch (err) {
    try {
      previewWindow.close();
    } catch {
      // Ignore close failures on an already-closed preview tab.
    }
    if (isUciSessionExpiredError(err)) {
      return { ok: false, reason: "session_expired" };
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
  const path = `/api/uci/coordination/${encodeURIComponent(coordinationId)}/discovery/pepco/application-details/${encodeURIComponent(applicationUuid)}/documents/${documentIndex}/download`;
  const res = await uciAuthenticatedFetch(path, {});
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
  return uciFetchJson<UciPepcoDashboardDiscoveryResponse>(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/discovery/pepco/submit-code`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    "PEPCO submit code failed",
    { mfaSensitive: true },
  );
}
