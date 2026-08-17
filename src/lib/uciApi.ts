import { supabase } from "@/lib/supabase";
import { getScraperBaseUrl } from "@/lib/scraperBaseUrl";
import type {
  CoordinationApplication,
  LifecycleState,
  UciApplicationsListResponse,
  UciCloseoutPrepareResponse,
  UciCommunicationsListResponse,
  UciCosAnalysisResponse,
  UciDiscoveryResponse,
  UciInitResponse,
  UciLifecycleProposalActionResponse,
  UciLoadProfileAnalyzeResponse,
  UciApplicationPackageBuildResponse,
  UciApplicationReviewResponse,
  UciApplicationSubmitResponse,
  UciMeterSetPrepareResponse,
  UciMilestonesListResponse,
  UciPepcoDashboardDiscoveryResponse,
  UciPepcoApplicationDetailDiscoveryResponse,
  UciPortalSyncResponse,
  UciPortalSyncRunsResponse,
  UciPortfolioViewResponse,
  UciPortalHarvestResponse,
  UciOperationalSnapshotResponse,
  UciProjectCoordinationResponse,
  UciProviderSetupConfirmation,
  UciProviderSetupResponse,
  UciProviderResolutionActionResponse,
  UciProviderResolutionListResponse,
  UciProvidersResponse,
  UciCreateProviderInput,
  UciCreateProviderResponse,
  UtilityProvider,
  UciRecentEventsResponse,
  UciRecordDetailResponse,
  UciTransitionResponse,
  CoordinationCost,
  CoordinationEquipment,
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

/** Thrown when a UCI API returns a structured error body. */
export class UciApiError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly requestId: string | null;

  constructor(
    message: string,
    params: { code?: string; httpStatus?: number; requestId?: string | null } = {},
  ) {
    super(message);
    this.name = "UciApiError";
    this.code = String(params.code ?? "ERROR");
    this.httpStatus = typeof params.httpStatus === "number" ? params.httpStatus : 500;
    this.requestId = params.requestId ?? null;
  }
}

export function isUciApiError(err: unknown): err is UciApiError {
  return err instanceof UciApiError;
}

export type UciTransportFailureKind = "network" | "timeout";

/** A browser-to-API transport failure: Express may never have received the request. */
export class UciTransportError extends Error {
  readonly kind: UciTransportFailureKind;
  readonly requestId: string;
  readonly retryAttempted: boolean;

  constructor(params: {
    kind: UciTransportFailureKind;
    requestId: string;
    retryAttempted: boolean;
  }) {
    const reason =
      params.kind === "timeout"
        ? "The UCI service did not respond before the request timed out."
        : "The browser could not reach the UCI service.";
    const recovery = params.retryAttempted
      ? " An automatic retry also failed."
      : " The request was not automatically retried.";
    super(`${reason}${recovery} Check your connection and try again. Request ID: ${params.requestId}`);
    this.name = "UciTransportError";
    this.kind = params.kind;
    this.requestId = params.requestId;
    this.retryAttempted = params.retryAttempted;
  }
}

export function isUciTransportError(err: unknown): err is UciTransportError {
  return err instanceof UciTransportError;
}

/** Map API/auth failures to user-safe UCI messages (never raw INVALID_JWT text). */
export function formatUciUserError(err: unknown, fallback: string): string {
  if (isUciSessionExpiredError(err)) return UCI_SESSION_EXPIRED_MESSAGE;
  if (isUciTransportError(err)) return err.message;
  if (err instanceof UciApiError) {
    return err.requestId ? `${err.message} Request ID: ${err.requestId}` : err.message;
  }
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

const DOCUMENT_PROCESSING_ERROR_MESSAGES: Record<string, string> = {
  NO_DOWNLOADED_DOCUMENTS:
    "No downloaded documents were found for the selected utility application.",
  APPLICATION_NOT_FOUND: "The selected utility application could not be resolved.",
  EXTERNAL_APPLICATION_REQUIRED: "Select a utility application before processing documents.",
  PDF_PARSER_UNAVAILABLE:
    "Document processing could not start because the backend PDF parser is unavailable.",
  INTERNAL_ERROR: "An unexpected server error occurred.",
};

export function formatDocumentProcessingUserError(err: unknown, fallback: string): string {
  if (isUciApiError(err)) {
    const mapped = DOCUMENT_PROCESSING_ERROR_MESSAGES[err.code];
    if (mapped) return mapped;
    if (err.message.trim()) return err.message;
  }
  return formatUciUserError(err, fallback);
}

export function logDocumentProcessingErrorDev(err: unknown): void {
  if (!import.meta.env?.DEV) return;
  if (isUciApiError(err)) {
    console.error("[uci-document-processing]", {
      code: err.code,
      httpStatus: err.httpStatus,
      message: err.message,
    });
    return;
  }
  if (err && typeof err === "object") {
    const rec = err as { stage?: string; code?: string; message?: string };
    if (rec.code || rec.stage) {
      console.error("[uci-document-processing]", rec);
    }
  }
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
  requestId?: string | null,
): Error {
  if (
    status === 401 &&
    (isInvalidJwtResponse(status, body) ||
      body.error === "UNAUTHENTICATED" ||
      body.message === "Authentication required")
  ) {
    return new UciSessionExpiredError();
  }
  return new UciApiError(String(body.message || body.error || fallback), {
    code: typeof body.error === "string" ? body.error : undefined,
    httpStatus: status,
    requestId,
  });
}

type UciFetchDiagnostics = {
  endpoint: string;
  requestId: string;
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
    requestId: diag.requestId,
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
  /**
   * Retry one browser transport failure. Only set this for operations whose
   * server-side result is idempotent; ordinary POST mutations must remain false.
   */
  retryOnTransportFailure?: boolean;
  /** Per-attempt timeout. Omit to preserve the existing fetch timeout behavior. */
  timeoutMs?: number;
};

const UCI_REQUEST_ID_HEADER = "x-request-id";
const UCI_OPERATIONAL_READ_OPTIONS: UciAuthenticatedFetchOptions = {
  retryOnTransportFailure: false,
  timeoutMs: 10_000,
};
const UCI_REVIEW_MUTATION_OPTIONS: UciAuthenticatedFetchOptions = {
  retryOnTransportFailure: false,
  timeoutMs: 20_000,
};

function createUciRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ??
    `uci-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function transportFailureKind(err: unknown): UciTransportFailureKind {
  return err instanceof Error && err.name === "AbortError" ? "timeout" : "network";
}

/**
 * Perform an authenticated UCI HTTP request using the current session token.
 * On confirmed 401 INVALID_JWT only, performs one coordinated refresh and retries once.
 */
export async function uciAuthenticatedFetch(
  path: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
  options: UciAuthenticatedFetchOptions = {},
): Promise<Response> {
  const requestId = createUciRequestId();
  let refreshAttempted = false;
  let retryAttempted = false;
  let transportRetryAttempted = false;

  const runOnce = async (token: string, attempt: number) => {
    // Resolve the base URL for every attempt so runtime config/proxy recovery is
    // not hidden by a value captured before a transient failure.
    const base = getUciRequestBaseUrl();
    const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${token}`,
      [UCI_REQUEST_ID_HEADER]: requestId,
      "x-uci-request-attempt": String(attempt),
    };
    const controller = new AbortController();
    let timedOut = false;
    const onCallerAbort = () => controller.abort(init.signal?.reason);
    if (init.signal) {
      if (init.signal.aborted) onCallerAbort();
      else init.signal.addEventListener("abort", onCallerAbort, { once: true });
    }
    const timeout =
      options.timeoutMs && options.timeoutMs > 0
        ? globalThis.setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, options.timeoutMs)
        : null;
    try {
      return await fetch(url, { ...init, headers, signal: controller.signal });
    } catch (err) {
      if (init.signal?.aborted && !timedOut) throw err;
      if (timedOut && err instanceof Error && err.name !== "AbortError") {
        const timeoutError = new Error(err.message);
        timeoutError.name = "AbortError";
        throw timeoutError;
      }
      throw err;
    } finally {
      if (timeout != null) globalThis.clearTimeout(timeout);
      init.signal?.removeEventListener("abort", onCallerAbort);
    }
  };

  let tokenState = await getValidUciAccessToken();

  const runWithSafeTransportRetry = async (initialToken: string): Promise<Response> => {
    try {
      return await runOnce(initialToken, 1);
    } catch (err) {
      if (init.signal?.aborted) throw err;
      if (!options.retryOnTransportFailure || transportRetryAttempted) {
        throw new UciTransportError({
          kind: transportFailureKind(err),
          requestId,
          retryAttempted: transportRetryAttempted,
        });
      }
      transportRetryAttempted = true;
      retryAttempted = true;
      await new Promise((resolve) => globalThis.setTimeout(resolve, 250));
      // Re-read both auth and API configuration immediately before retrying.
      tokenState = await getValidUciAccessToken();
      try {
        return await runOnce(tokenState.token, 2);
      } catch (retryErr) {
        throw new UciTransportError({
          kind: transportFailureKind(retryErr),
          requestId,
          retryAttempted: true,
        });
      }
    }
  };

  let res: Response;
  try {
    res = await runWithSafeTransportRetry(tokenState.token);
  } catch (err) {
    logUciFetchDiagnostics({
      endpoint: path,
      requestId,
      tokenExpiry: tokenState.expiry,
      refreshAttempted,
      retryAttempted,
      finalStatus: 0,
    });
    throw err;
  }

  if (res.status === 401 && !refreshAttempted) {
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
        res = await runWithSafeTransportRetry(refreshedToken);
      } catch (err) {
        logUciFetchDiagnostics({
          endpoint: path,
          requestId,
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
    requestId,
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
    throw mapUciHttpError(
      res.status,
      err,
      errorFallback,
      res.headers.get(UCI_REQUEST_ID_HEADER),
    );
  }
  return (await res.json()) as T;
}

export async function listUciProviders(
  projectId?: string,
  options?: { utilityType?: string },
): Promise<UciProvidersResponse> {
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  if (options?.utilityType) params.set("utilityType", options.utilityType);
  const query = params.toString() ? `?${params.toString()}` : "";
  return uciFetchJson<UciProvidersResponse>(
    `/api/uci/providers${query}`,
    {},
    "Failed to load providers",
    UCI_OPERATIONAL_READ_OPTIONS,
  );
}

export interface UciOperationalRequestTiming {
  requestId: string | null;
  startedAt: string;
  ttfbMs: number;
  backendDurationMs: number | null;
  jsonParseMs: number;
  requestTotalMs: number;
}

export async function getUciOperationalSnapshot(): Promise<{
  snapshot: UciOperationalSnapshotResponse;
  timing: UciOperationalRequestTiming;
}> {
  const now = () => globalThis.performance?.now?.() ?? Date.now();
  const startedAt = new Date().toISOString();
  const requestStarted = now();
  const res = await uciAuthenticatedFetch(
    "/api/uci/operations/snapshot",
    {},
    UCI_OPERATIONAL_READ_OPTIONS,
  );
  const headersReceived = now();
  if (!res.ok) {
    const err = await parseJsonSafe(res);
    throw mapUciHttpError(
      res.status,
      err,
      "Failed to load UCI operational snapshot",
      res.headers.get(UCI_REQUEST_ID_HEADER),
    );
  }
  const parseStarted = now();
  const snapshot = (await res.json()) as UciOperationalSnapshotResponse;
  const completed = now();
  const rawBackendDuration = Number(res.headers.get("x-backend-duration-ms"));
  return {
    snapshot,
    timing: {
      requestId: res.headers.get(UCI_REQUEST_ID_HEADER),
      startedAt,
      ttfbMs: Math.round((headersReceived - requestStarted) * 10) / 10,
      backendDurationMs: Number.isFinite(rawBackendDuration) ? rawBackendDuration : null,
      jsonParseMs: Math.round((completed - parseStarted) * 10) / 10,
      requestTotalMs: Math.round((completed - requestStarted) * 10) / 10,
    },
  };
}

export async function createUciProvider(
  projectId: string,
  input: UciCreateProviderInput,
): Promise<UciCreateProviderResponse> {
  return uciFetchJson<UciCreateProviderResponse>(
    `/api/uci/projects/${encodeURIComponent(projectId)}/providers`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    "Failed to create utility provider",
  );
}

export async function getUciPortalHarvest(
  providerSlug = "pepco",
  options?: { signal?: AbortSignal },
): Promise<UciPortalHarvestResponse> {
  return uciFetchJson<UciPortalHarvestResponse>(
    `/api/uci/portal-harvest/${encodeURIComponent(providerSlug)}`,
    options?.signal ? { signal: options.signal } : {},
    "Failed to load provider harvest",
    UCI_OPERATIONAL_READ_OPTIONS,
  );
}

export async function linkUciPortalHarvestApplication(
  providerSlug: string,
  externalApplicationId: string,
  payload: { project_id: string; coordination_record_id: string },
): Promise<{ link: Record<string, unknown> }> {
  return uciFetchJson<{ link: Record<string, unknown> }>(
    `/api/uci/portal-harvest/${encodeURIComponent(providerSlug)}/applications/${encodeURIComponent(externalApplicationId)}/link`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "Failed to link harvested application",
  );
}

export async function refreshUciPortalHarvest(
  providerSlug = "pepco",
): Promise<{ refreshed: number; skipped_unmatched: number }> {
  return uciFetchJson<{ refreshed: number; skipped_unmatched: number }>(
    `/api/uci/portal-harvest/${encodeURIComponent(providerSlug)}/refresh`,
    { method: "POST" },
    "Failed to refresh linked provider data",
  );
}

export async function resolveUciProviderAlias(
  alias: string,
  options?: { utilityType?: string },
): Promise<{
  status: "found" | "not_found" | "ambiguous";
  slug: string | null;
  provider_id: string | null;
  reason: string | null;
  candidate_slugs?: string[];
  normalized_input?: string;
  provider?: UtilityProvider | null;
}> {
  const params = new URLSearchParams({ alias });
  if (options?.utilityType) params.set("utilityType", options.utilityType);
  return uciFetchJson(
    `/api/uci/providers/resolve?${params.toString()}`,
    {},
    "Failed to resolve provider alias",
  );
}

export async function listProjectCoordination(
  projectId: string,
): Promise<UciProjectCoordinationResponse> {
  return uciFetchJson<UciProjectCoordinationResponse>(
    `/api/uci/projects/${encodeURIComponent(projectId)}/coordination`,
    {},
    "Failed to load coordination",
    UCI_OPERATIONAL_READ_OPTIONS,
  );
}

export async function getProjectProviderSetup(
  projectId: string,
): Promise<UciProviderSetupResponse> {
  return uciFetchJson<UciProviderSetupResponse>(
    `/api/uci/projects/${encodeURIComponent(projectId)}/provider-setup`,
    {},
    "Failed to load provider setup guidance",
  );
}

export async function getProjectProviderResolution(
  projectId: string,
  options?: { serviceType?: string },
): Promise<UciProviderResolutionListResponse> {
  const params = new URLSearchParams();
  if (options?.serviceType) params.set("service_type", options.serviceType);
  const query = params.toString() ? `?${params.toString()}` : "";
  return uciFetchJson<UciProviderResolutionListResponse>(
    `/api/uci/projects/${encodeURIComponent(projectId)}/provider-resolution${query}`,
    {},
    "Failed to load provider resolution",
    UCI_OPERATIONAL_READ_OPTIONS,
  );
}

export async function resolveProjectProviderResolution(
  projectId: string,
  params: { serviceType: string; addressSourceAcknowledged?: string },
): Promise<UciProviderResolutionActionResponse> {
  return uciFetchJson<UciProviderResolutionActionResponse>(
    `/api/uci/projects/${encodeURIComponent(projectId)}/provider-resolution/resolve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_type: params.serviceType,
        ...(params.addressSourceAcknowledged
          ? { address_source_acknowledged: params.addressSourceAcknowledged }
          : {}),
      }),
    },
    "Failed to run provider resolution",
  );
}

export async function confirmProjectProviderResolution(
  projectId: string,
  params: { serviceType: string; providerId: string; notes?: string },
): Promise<UciProviderResolutionActionResponse> {
  return uciFetchJson<UciProviderResolutionActionResponse>(
    `/api/uci/projects/${encodeURIComponent(projectId)}/provider-resolution/confirm`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_type: params.serviceType,
        provider_id: params.providerId,
        ...(params.notes ? { notes: params.notes } : {}),
      }),
    },
    "Failed to confirm provider resolution",
  );
}

export async function overrideProjectProviderResolution(
  projectId: string,
  params: {
    serviceType: string;
    providerId: string;
    overrideReason: string;
    notes?: string;
  },
): Promise<UciProviderResolutionActionResponse> {
  return uciFetchJson<UciProviderResolutionActionResponse>(
    `/api/uci/projects/${encodeURIComponent(projectId)}/provider-resolution/override`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_type: params.serviceType,
        provider_id: params.providerId,
        override_reason: params.overrideReason,
        ...(params.notes ? { notes: params.notes } : {}),
      }),
    },
    "Failed to override provider resolution",
  );
}

export async function initProjectCoordination(
  projectId: string,
  providers: string[],
  providerSetup?: UciProviderSetupConfirmation,
): Promise<UciInitResponse> {
  return uciFetchJson<UciInitResponse>(
    `/api/uci/projects/${encodeURIComponent(projectId)}/coordination/init`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providers,
        ...(providerSetup ? { provider_setup: providerSetup } : {}),
      }),
    },
    "Failed to initialize coordination",
  );
}

export function formatLoadCandidateExtractionError(err: unknown, fallback: string): string {
  if (err && typeof err === "object") {
    const rec = err as {
      stage?: string;
      document_name?: string | null;
      message?: string;
      requestId?: string | null;
    };
    const requestSuffix = rec.requestId ? ` Request ID: ${rec.requestId}` : "";
    if (rec.stage) {
      const doc = rec.document_name ? ` (${rec.document_name})` : "";
      return `${rec.message || fallback} [${rec.stage}${doc}]${requestSuffix}`;
    }
    if (typeof rec.message === "string" && rec.message.trim()) {
      return `${rec.message}${requestSuffix}`;
    }
  }
  return formatUciUserError(err, fallback);
}

export async function analyzeCoordinationLoadProfile(
  coordinationId: string,
): Promise<UciLoadProfileAnalyzeResponse> {
  return uciFetchJson<UciLoadProfileAnalyzeResponse>(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/load-profile/analyze`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
    "Load profile analysis failed",
    // Safe retry: analysis replaces the same Agent 2 draft using a stable
    // idempotency key and does not append candidate/import mutations.
    { retryOnTransportFailure: true, timeoutMs: 60_000 },
  );
}

export async function importCoordinationDocumentFindings(
  coordinationId: string,
  params: { external_application_id?: string | null; refresh?: boolean },
): Promise<{
  status: "complete" | "partial";
  findings_considered: number;
  findings_imported: number;
  findings_skipped: number;
  candidates_created: number;
  candidates_reused: number;
  candidates_superseded: number;
  skipped_reasons: string[];
  failed_findings: Array<{ finding_id: string | null; message: string }>;
  connected_load_satisfied: boolean;
}> {
  return uciFetchJson(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/load-profile/import-document-findings`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    },
    "Failed to import document findings",
    // No automatic retry: despite deterministic candidate IDs/deduplication,
    // this mutation may already be running when the browser loses the response.
    { timeoutMs: 120_000 },
  );
}

export async function runCoordinationDocumentProcessing(
  coordinationId: string,
  params: {
    external_application_id?: string | null;
    refresh?: boolean;
    document_ids?: string[];
  },
): Promise<import("@/lib/uciDocumentProcessing").UciDocumentProcessingRunResponse> {
  return uciFetchJson(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/document-processing/run`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    },
    "Document processing failed",
  );
}

export async function reprocessCoordinationDocument(
  coordinationId: string,
  params: { external_application_id?: string | null; document_id: string },
): Promise<import("@/lib/uciDocumentProcessing").UciDocumentReprocessResponse> {
  return uciFetchJson(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/document-processing/reprocess`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    },
    "Document reprocessing failed",
    { timeoutMs: 180_000 },
  );
}

export async function getCoordinationDocumentManifest(
  coordinationId: string,
  params: { external_application_id?: string | null; include_findings?: boolean },
): Promise<import("@/lib/uciDocumentProcessing").UciDocumentProcessingManifestResponse> {
  const qs = new URLSearchParams();
  if (params.external_application_id) {
    qs.set("external_application_id", params.external_application_id);
  }
  if (params.include_findings) qs.set("include_findings", "true");
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return uciFetchJson(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/document-processing/manifest${suffix}`,
    { method: "GET" },
    "Failed to load document manifest",
  );
}

export async function getCoordinationDocumentFallbackEstimate(
  coordinationId: string,
  params: { external_application_id: string; mode?: "all" | "vision" | "ocr" },
): Promise<{
  external_application_id: string;
  mode: string;
  total: number;
  vision: number;
  ocr: number;
  provider_status: import("@/lib/uciDocumentProcessing").UciFallbackProviderStatus;
  config: {
    vision_enabled: boolean;
    ocr_enabled: boolean;
    vision_max_pages_per_run: number;
    ocr_max_pages_per_run: number;
  };
}> {
  const qs = new URLSearchParams();
  qs.set("external_application_id", params.external_application_id);
  if (params.mode) qs.set("mode", params.mode);
  return uciFetchJson(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/document-processing/fallback-estimate?${qs.toString()}`,
    { method: "GET" },
    "Failed to estimate fallback pages",
  );
}

export async function runCoordinationDocumentFallback(
  coordinationId: string,
  params: {
    external_application_id: string;
    mode?: "all" | "vision" | "ocr";
    document_id?: string;
    page_numbers?: number[];
  },
): Promise<{
  status: "complete" | "partial" | "failed";
  pages_requested: number;
  pages_processed: number;
  pages_failed: number;
  findings_created: number;
  failed_pages: Array<{
    document_name: string;
    page_number: number;
    method: string;
    stage: string;
    message: string;
  }>;
  provider_status: import("@/lib/uciDocumentProcessing").UciFallbackProviderStatus;
  pages_remaining: number;
}> {
  return uciFetchJson(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/document-processing/fallback-run`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    },
    "Document fallback processing failed",
  );
}

export async function extractCoordinationLoadCandidates(
  coordinationId: string,
  params: { external_application_id: string; refresh?: boolean },
): Promise<import("@/lib/uciLoadProfile").UciLoadCandidateExtractionResponse> {
  const res = await uciAuthenticatedFetch(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/load-profile/extract-candidates`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    },
    // No automatic retry: extraction mutates candidate/stale state and a
    // transport failure cannot prove whether the first request committed.
    { timeoutMs: 120_000 },
  );
  const body = await parseJsonSafe(res);
  if (!res.ok) {
    if (body.error === "LOAD_CANDIDATE_EXTRACTION_FAILED") {
      const err = new Error(
        String(body.message || "Connected load extraction failed"),
      ) as Error & {
        stage?: string;
        document_name?: string | null;
        requestId?: string | null;
      };
      err.stage = body.stage != null ? String(body.stage) : "unknown";
      err.document_name =
        body.document_name != null ? String(body.document_name) : null;
      err.requestId = res.headers.get(UCI_REQUEST_ID_HEADER);
      throw err;
    }
    throw mapUciHttpError(
      res.status,
      body,
      "Connected load extraction failed",
      res.headers.get(UCI_REQUEST_ID_HEADER),
    );
  }
  return body as import("@/lib/uciLoadProfile").UciLoadCandidateExtractionResponse;
}

export async function listCoordinationLoadCandidates(
  coordinationId: string,
  params?: { external_application_id?: string },
): Promise<import("@/lib/uciLoadProfile").UciLoadCandidatesListResponse> {
  const qs = new URLSearchParams();
  if (params?.external_application_id) {
    qs.set("external_application_id", params.external_application_id);
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return uciFetchJson(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/load-profile/candidates${suffix}`,
    {},
    "Failed to load connected load candidates",
  );
}

export async function resolveCoordinationLoadCandidate(
  coordinationId: string,
  payload: {
    candidate_id: string;
    action: "approve" | "edit_approve" | "reject" | "keep_unresolved";
    edited_value?: string | number;
    edited_unit?: string;
    review_note?: string;
  },
): Promise<import("@/lib/uciLoadProfile").UciLoadCandidateResolveResponse> {
  return uciFetchJson(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/load-profile/candidates/resolve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "Failed to resolve connected load candidate",
  );
}

export async function addCoordinationManualVerifiedValue(
  coordinationId: string,
  payload: import("@/lib/uciLoadProfileWorkspace").ManualVerifiedInputPayload,
): Promise<import("@/lib/uciLoadProfile").UciLoadCandidateResolveResponse> {
  return uciFetchJson(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/load-profile/verified-values`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "Failed to add manual verified value",
  );
}

export async function buildCoordinationApplicationPackage(
  coordinationId: string,
  params?: { external_application_id?: string; checklist_mode?: "synthetic_test" },
): Promise<UciApplicationPackageBuildResponse> {
  const body: Record<string, string> = {};
  if (params?.external_application_id) {
    body.external_application_id = params.external_application_id;
  }
  if (params?.checklist_mode) {
    body.checklist_mode = params.checklist_mode;
  }
  return uciFetchJson<UciApplicationPackageBuildResponse>(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/applications`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    "Application package build failed",
  );
}

export async function listApplicationPackageDocumentCandidates(
  coordinationId: string,
  params?: { external_application_id?: string },
): Promise<import("@/lib/uciApplicationPrep").UciPackageDocumentCandidatesResponse> {
  const qs = new URLSearchParams();
  if (params?.external_application_id) {
    qs.set("external_application_id", params.external_application_id);
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return uciFetchJson(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/application-package/document-candidates${suffix}`,
    {},
    "Failed to load package document candidates",
  );
}

export async function confirmApplicationPackageDocumentMapping(
  applicationId: string,
  payload: {
    slot_key: string;
    candidate_id: string;
    external_application_id?: string;
  },
): Promise<{
  application: CoordinationApplication;
  package_status: string;
  missing_documents: string[];
  missing_fields: string[];
  package_documents: unknown[];
  no_change?: boolean;
  message?: string;
}> {
  return uciFetchJson(
    `/api/uci/applications/${encodeURIComponent(applicationId)}/package-documents/confirm`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "Failed to confirm document mapping",
    UCI_REVIEW_MUTATION_OPTIONS,
  );
}

export async function removeApplicationPackageDocumentMapping(
  applicationId: string,
  payload: { slot_key: string },
): Promise<{
  application: unknown;
  package_status: string;
  missing_documents: string[];
  missing_fields: string[];
  package_documents: unknown[];
}> {
  return uciFetchJson(
    `/api/uci/applications/${encodeURIComponent(applicationId)}/package-documents/remove`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "Failed to remove document mapping",
    UCI_REVIEW_MUTATION_OPTIONS,
  );
}

export async function approveSyntheticApplicationChecklist(
  applicationId: string,
  payload?: { note?: string },
): Promise<{
  application: unknown;
  package_status: string;
  checklist_status: "approved";
}> {
  return uciFetchJson(
    `/api/uci/applications/${encodeURIComponent(applicationId)}/synthetic-checklist/approve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    },
    "Failed to approve synthetic checklist",
  );
}

export async function setSyntheticApplicationSignatureStatus(
  applicationId: string,
  payload: {
    document_key: string;
    signature_status: "unknown" | "unsigned" | "signed_manual_verified";
    review_note?: string;
  },
): Promise<{
  application: CoordinationApplication;
  package_status: string;
  package_documents: unknown[];
  document_key: string;
  signature_status: "unknown" | "unsigned" | "signed_manual_verified";
  signature_verified_at: string | null;
  timings?: {
    auth_ms?: number;
    application_fetch_ms?: number;
    access_check_ms?: number;
    readiness_recompute_ms?: number;
    db_write_ms?: number;
    before_response_ms?: number;
    total_ms?: number;
  };
}> {
  return uciFetchJson(
    `/api/uci/applications/${encodeURIComponent(applicationId)}/synthetic-checklist/signature`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "Failed to update synthetic signature status",
    UCI_REVIEW_MUTATION_OPTIONS,
  );
}

export async function exportSyntheticApplicationChecklist(
  applicationId: string,
): Promise<Record<string, unknown>> {
  return uciFetchJson(
    `/api/uci/applications/${encodeURIComponent(applicationId)}/synthetic-checklist/export`,
    {},
    "Failed to export synthetic checklist",
  );
}

export async function updateApplicationPackageReviewItem(
  applicationId: string,
  payload: {
    kind: "field" | "document";
    item_key: string;
    status: "confirmed" | "needs_correction";
    note?: string;
  },
): Promise<{
  application: CoordinationApplication;
  package_review: Record<string, unknown>;
}> {
  return uciFetchJson(
    `/api/uci/applications/${encodeURIComponent(applicationId)}/package-review/items`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "Failed to update package review item",
    UCI_REVIEW_MUTATION_OPTIONS,
  );
}

export async function confirmAllApplicationPackageVerifiedFields(
  applicationId: string,
): Promise<{
  application: CoordinationApplication;
  package_review: Record<string, unknown>;
  confirmed_count: number;
}> {
  return uciFetchJson(
    `/api/uci/applications/${encodeURIComponent(applicationId)}/package-review/confirm-verified-fields`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
    "Failed to confirm verified package fields",
    UCI_REVIEW_MUTATION_OPTIONS,
  );
}

export async function reviewCoordinationApplication(
  applicationId: string,
  payload: { status: "reviewed" | "needs_changes"; notes?: string },
): Promise<UciApplicationReviewResponse> {
  return uciFetchJson<UciApplicationReviewResponse>(
    `/api/uci/applications/${encodeURIComponent(applicationId)}/review`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "Application review failed",
    UCI_REVIEW_MUTATION_OPTIONS,
  );
}

export async function submitCoordinationApplication(
  applicationId: string,
  options?: {
    live_submission_confirmed?: boolean;
    portal_populate?: boolean;
    credential_id?: string;
  },
): Promise<UciApplicationSubmitResponse> {
  return uciFetchJson<UciApplicationSubmitResponse>(
    `/api/uci/applications/${encodeURIComponent(applicationId)}/submit`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options ?? {}),
    },
    "Application submission failed",
  );
}

export async function classifyCoordinationCommunications(
  coordinationId: string,
): Promise<{
  coordination_record_id: string;
  project_id: string;
  classified_count: number;
  skipped_count: number;
  classifier_version: string;
}> {
  return uciFetchJson(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/communications/classify`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
    "Communication classification failed",
  );
}

export async function getCoordinationDetail(
  coordinationId: string,
): Promise<UciRecordDetailResponse> {
  return uciFetchJson<UciRecordDetailResponse>(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}`,
    {},
    "Failed to load coordination detail",
    UCI_OPERATIONAL_READ_OPTIONS,
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

export async function completeStage2EngineeringReview(
  coordinationId: string,
  payload: { reason: string; confirm_human_review: true },
): Promise<import("@/types/uci").UciStage2CompletionResponse> {
  return uciFetchJson(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/complete-stage-2`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "Failed to complete Stage 2 engineering review",
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
    UCI_OPERATIONAL_READ_OPTIONS,
  );
}

export async function listProjectNeedsAttentionCommunications(
  projectId: string,
  params?: { coordinationId?: string; limit?: number; offset?: number },
): Promise<UciCommunicationsListResponse> {
  const qs = new URLSearchParams({ project_id: projectId });
  if (params?.coordinationId) qs.set("coordination_id", params.coordinationId);
  if (params?.limit != null) qs.set("limit", String(params.limit));
  if (params?.offset != null) qs.set("offset", String(params.offset));
  return uciFetchJson<UciCommunicationsListResponse>(
    `/api/uci/communications/needs_attention?${qs.toString()}`,
    {},
    "Failed to load needs-attention communications",
    UCI_OPERATIONAL_READ_OPTIONS,
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

export async function applyLifecycleProposal(
  coordinationId: string,
  payload: { external_application_id: string; proposal_checksum: string },
): Promise<UciLifecycleProposalActionResponse> {
  return uciFetchJson(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/lifecycle-proposals/apply`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "Failed to apply lifecycle proposal",
  );
}

export async function rejectLifecycleProposal(
  coordinationId: string,
  payload: { external_application_id: string; proposal_checksum: string; reason?: string },
): Promise<UciLifecycleProposalActionResponse> {
  return uciFetchJson(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/lifecycle-proposals/reject`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "Failed to reject lifecycle proposal",
  );
}

export async function listCoordinationSyncRuns(
  coordinationId: string,
  params?: { provider_slug?: string; limit?: number },
): Promise<UciPortalSyncRunsResponse> {
  const qs = new URLSearchParams();
  if (params?.provider_slug) qs.set("provider_slug", params.provider_slug);
  if (params?.limit != null) qs.set("limit", String(params.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return uciFetchJson(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/sync-runs${suffix}`,
    {},
    "Failed to load sync runs",
  );
}

export async function getCoordinationSyncRun(
  coordinationId: string,
  jobId: string,
): Promise<{ run: UciPortalSyncRunsResponse["runs"][number] }> {
  return uciFetchJson(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/sync-runs/${encodeURIComponent(jobId)}`,
    {},
    "Failed to load sync run",
  );
}

export async function reclassifyCommunication(
  communicationId: string,
  payload: { classification: string; notes?: string },
): Promise<{ communication: unknown; classification: string }> {
  return uciFetchJson(
    `/api/uci/communications/${encodeURIComponent(communicationId)}/reclassify`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "Failed to reclassify communication",
  );
}

export async function analyzeCoordinationCos(
  coordinationId: string,
): Promise<UciCosAnalysisResponse> {
  return uciFetchJson(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/cos/analyze`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
    "COS analysis failed",
  );
}

export async function listCoordinationCosts(
  coordinationId: string,
): Promise<{ costs: CoordinationCost[] }> {
  return uciFetchJson(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/costs`,
    {},
    "Failed to load costs",
  );
}

export async function upsertCoordinationCost(
  coordinationId: string,
  cost: Partial<CoordinationCost> & { cost_type: string },
): Promise<{ cost: CoordinationCost; created: boolean }> {
  return uciFetchJson(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/costs`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cost),
    },
    "Failed to save cost",
  );
}

export async function listCoordinationEquipment(
  coordinationId: string,
): Promise<{ equipment: CoordinationEquipment[] }> {
  return uciFetchJson(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/equipment`,
    {},
    "Failed to load equipment",
  );
}

export async function createCoordinationEquipment(
  coordinationId: string,
  equipment: Partial<CoordinationEquipment> & { equipment_type: string },
): Promise<{ equipment: CoordinationEquipment }> {
  return uciFetchJson(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/equipment`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(equipment),
    },
    "Failed to create equipment",
  );
}

export async function checkInCoordinationEquipment(
  equipmentId: string,
  payload: { current_eta?: string; status?: string },
): Promise<{ equipment: CoordinationEquipment; slip_alert?: boolean }> {
  return uciFetchJson(
    `/api/uci/equipment/${encodeURIComponent(equipmentId)}/check-in`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "Equipment check-in failed",
  );
}

export async function prepareMeterSet(
  coordinationId: string,
  payload?: { scheduled_date?: string },
): Promise<UciMeterSetPrepareResponse> {
  return uciFetchJson(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/meter-set/prepare`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    },
    "Meter set preparation failed",
  );
}

export async function prepareCloseout(
  coordinationId: string,
): Promise<UciCloseoutPrepareResponse> {
  return uciFetchJson(
    `/api/uci/coordination/${encodeURIComponent(coordinationId)}/closeout/prepare`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
    "Closeout preparation failed",
  );
}

export async function getProjectPortfolioView(
  projectId: string,
): Promise<UciPortfolioViewResponse> {
  return uciFetchJson(
    `/api/uci/projects/${encodeURIComponent(projectId)}/portfolio_view`,
    {},
    "Failed to load portfolio view",
    UCI_OPERATIONAL_READ_OPTIONS,
  );
}

export async function listRecentUciEvents(
  projectId: string,
  limit = 25,
): Promise<UciRecentEventsResponse> {
  return uciFetchJson(
    `/api/uci/events/recent?project_id=${encodeURIComponent(projectId)}&limit=${encodeURIComponent(String(limit))}`,
    {},
    "Failed to load recent UCI events",
  );
}

export const UCI_SYNC_RUN_STORAGE_PREFIX = "uci-active-sync-run:";
