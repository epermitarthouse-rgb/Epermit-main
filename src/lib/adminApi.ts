import { getScraperBaseUrl } from "@/lib/scraperBaseUrl";
import { uciAuthenticatedFetch } from "@/lib/uciApi";
import type {
  CredentialGrantLevel,
  FeatureAccessLevel,
  FeatureKey,
  ProjectRole,
} from "@/lib/governanceConstants";

export const ADMIN_API_PREFIX = "/api/admin/v1";

export type AdminOverviewMetrics = {
  total_users: number;
  active_users: number;
  deactivated_users?: number;
  platform_admins: number;
  permission_risks?: AdminPermissionRisk[];
  pending_invitations?: number;
  pending_invitations_30d?: number;
  audit_events_24h?: number;
  governance_enforce_mode?: string;
};

export type AdminPermissionRisk = {
  user_id: string;
  risk_type: string;
  detail?: string;
};

export type AdminDirectoryUser = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  company_name: string | null;
  job_title: string | null;
  access_status: "active" | "deactivated" | string;
  created_at: string;
  platform_roles: string[];
  platform_admin: boolean;
};

export type AdminUsersListResponse = {
  users: AdminDirectoryUser[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
};

export type AdminFeaturePermissionRow = {
  id?: string;
  project_id: string | null;
  feature_key: string;
  access_level: FeatureAccessLevel;
  granted_by?: string;
  updated_at?: string;
};

export type AdminScrapedDataScopeRow = {
  id?: string;
  scope_type: "project" | "jurisdiction" | "portal_source" | string;
  scope_ref: string;
  granted_by?: string;
  created_at?: string;
};

export type AdminCredentialGrantRow = {
  id?: string;
  credential_id: string;
  grant_level: CredentialGrantLevel;
  project_id?: string | null;
  jurisdiction?: string | null;
  portal_username?: string | null;
  granted_by?: string;
  updated_at?: string;
};

export type AdminEffectiveProject = {
  project_id: string;
  project_name: string | null;
  project_role: string;
  features?: Record<string, FeatureAccessLevel>;
  scraped_data_scopes?: string[];
  credentials?: Array<{ credential_id: string; grant: string }>;
};

export type AdminProjectAccessRow = {
  project_id: string;
  project_name: string | null;
  effective_access: string;
  source: string;
  control: string;
  is_owner: boolean;
};

export type AdminCredentialAccessRow = {
  credential_id: string;
  jurisdiction: string | null;
  portal_username: string | null;
  effective_access: string;
  source: string;
  control: string;
};

export type AdminAccessSummaries = {
  projects: string;
  projects_exception_count: number;
  features: string;
  features_exception_count: number;
  credentials: string;
  credentials_exception_count: number;
};

export type AdminEffectivePermissions = {
  user_id: string;
  email?: string | null;
  full_name?: string | null;
  company_name?: string | null;
  job_title?: string | null;
  access_status: string;
  platform_admin: boolean;
  platform_roles?: string[];
  /** User-level feature access independent of project membership. */
  global_features?: Record<string, FeatureAccessLevel>;
  /** All projects with effective access (default+override model). */
  project_access?: AdminProjectAccessRow[];
  /** All portal credentials with effective access. */
  credential_access?: AdminCredentialAccessRow[];
  access_summaries?: AdminAccessSummaries;
  projects?: AdminEffectiveProject[];
  feature_permissions?: AdminFeaturePermissionRow[];
  scraped_data_scope?: AdminScrapedDataScopeRow[];
  credential_grants?: AdminCredentialGrantRow[];
  risks?: string[];
  access_review?: { reviewed_by: string; reviewed_at: string } | null;
  _note?: string;
};

export type AdminAuditEvent = {
  id: string;
  correlation_id?: string | null;
  actor_id?: string | null;
  action: string;
  target_type?: string | null;
  target_id?: string | null;
  project_id?: string | null;
  feature_key?: string | null;
  before_json?: unknown;
  after_json?: unknown;
  result?: string | null;
  created_at: string;
};

export type AdminAuditEventsResponse = {
  events: AdminAuditEvent[];
  next_cursor?: { created_at: string; id: string } | null;
  pagination?: { limit: number; cursor?: string | null };
};

export type AdminMutationOk = { ok: boolean };

export type AdminUsersQuery = {
  limit?: number;
  offset?: number;
  search?: string;
};

export type AdminCreateUserRequest = {
  full_name: string;
  email: string;
  temporary_password: string;
  company_name?: string | null;
  job_title?: string | null;
  project_id?: string | null;
  project_role?: ProjectRole | null;
};

export type AdminPortalCredential = {
  id: string;
  jurisdiction: string | null;
  portal_username: string | null;
  login_url?: string | null;
  project_id?: string | null;
  user_id?: string | null;
  created_at?: string | null;
};

export type AdminPortalCredentialsResponse = {
  credentials: AdminPortalCredential[];
};

export type AdminCreateUserResponse = {
  ok: boolean;
  user_id: string;
  email: string;
  full_name: string;
  company_name: string | null;
  job_title: string | null;
  access_status: string;
  must_change_password: boolean;
  created_by_admin: boolean;
  initial_project_id: string | null;
  initial_project_role: string | null;
};

export type AdminAuditQuery = {
  limit?: number;
  cursor?: string | null;
  action?: string | null;
  actor_id?: string | null;
  from?: string | null;
  to?: string | null;
};

export type AdminFeatureUpdateItem = {
  project_id?: string | null;
  feature_key: FeatureKey | string;
  access_level?: FeatureAccessLevel;
  /** When true, remove explicit override and inherit role defaults. */
  reset?: boolean;
};

export type AdminCredentialGrantUpdateItem = {
  credential_id: string;
  grant_level: CredentialGrantLevel | "default";
  project_id?: string | null;
  jurisdiction?: string | null;
  reset?: boolean;
};

export type AdminFetchFn = (
  path: string,
  init?: RequestInit & { headers?: Record<string, string> },
) => Promise<Response>;

async function parseJsonSafe(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { message: text };
  }
}

async function adminFetchJson<T>(
  path: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
  fetchFn: AdminFetchFn = uciAuthenticatedFetch,
): Promise<T> {
  const res = await fetchFn(path, init);
  if (!res.ok) {
    const err = await parseJsonSafe(res);
    throw new Error(String(err.message || err.error || `Admin API failed (${res.status})`));
  }
  if (res.status === 204) {
    return undefined as T;
  }
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("text/csv")) {
    return (await res.text()) as T;
  }
  return (await res.json()) as T;
}

/** Build absolute admin API URL (for tests and downloads). */
export function buildAdminApiUrl(
  path: string,
  query?: Record<string, string | number | undefined | null>,
): string {
  const base = getScraperBaseUrl();
  const normalizedPath = path.startsWith(ADMIN_API_PREFIX)
    ? path
    : `${ADMIN_API_PREFIX}${path.startsWith("/") ? path : `/${path}`}`;

  if (!query || Object.keys(query).length === 0) {
    return `${base}${normalizedPath}`;
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${base}${normalizedPath}?${qs}` : `${base}${normalizedPath}`;
}

function auditQueryString(query: AdminAuditQuery = {}): string {
  const params = new URLSearchParams();
  if (query.limit != null) params.set("limit", String(query.limit));
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.action) params.set("action", query.action);
  if (query.actor_id) params.set("actor_id", query.actor_id);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function normalizeAuditResponse(raw: AdminAuditEventsResponse): AdminAuditEventsResponse {
  if (raw.next_cursor !== undefined) {
    return raw;
  }
  const cursor = raw.pagination?.cursor;
  return {
    events: raw.events ?? [],
    next_cursor: cursor ? { created_at: cursor, id: "" } : null,
  };
}

export async function getAdminOverview(
  fetchFn?: AdminFetchFn,
): Promise<AdminOverviewMetrics> {
  return adminFetchJson<AdminOverviewMetrics>(`${ADMIN_API_PREFIX}/overview`, {}, fetchFn);
}

export async function listAdminUsers(
  query: AdminUsersQuery = {},
  fetchFn?: AdminFetchFn,
): Promise<AdminUsersListResponse> {
  const qs = new URLSearchParams();
  if (query.limit != null) qs.set("limit", String(query.limit));
  if (query.offset != null) qs.set("offset", String(query.offset));
  if (query.search) qs.set("search", query.search);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return adminFetchJson<AdminUsersListResponse>(
    `${ADMIN_API_PREFIX}/access/users${suffix}`,
    {},
    fetchFn,
  );
}

export async function listAdminPortalCredentials(
  fetchFn?: AdminFetchFn,
): Promise<AdminPortalCredential[]> {
  const res = await adminFetchJson<AdminPortalCredentialsResponse>(
    `${ADMIN_API_PREFIX}/portal-credentials`,
    {},
    fetchFn,
  );
  return res.credentials ?? [];
}

export async function createAdminUser(
  payload: AdminCreateUserRequest,
  fetchFn?: AdminFetchFn,
): Promise<AdminCreateUserResponse> {
  return adminFetchJson<AdminCreateUserResponse>(
    `${ADMIN_API_PREFIX}/access/users`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    fetchFn,
  );
}

export async function getAdminEffectivePermissions(
  userId: string,
  fetchFn?: AdminFetchFn,
): Promise<AdminEffectivePermissions> {
  return adminFetchJson<AdminEffectivePermissions>(
    `${ADMIN_API_PREFIX}/access/users/${encodeURIComponent(userId)}/effective`,
    {},
    fetchFn,
  );
}

export async function activateAdminUser(
  userId: string,
  reason?: string,
  fetchFn?: AdminFetchFn,
): Promise<AdminMutationOk & { user_id: string; access_status: string }> {
  return adminFetchJson(
    `${ADMIN_API_PREFIX}/access/users/${encodeURIComponent(userId)}/activate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason ?? null }),
    },
    fetchFn,
  );
}

export async function deactivateAdminUser(
  userId: string,
  reason?: string,
  fetchFn?: AdminFetchFn,
): Promise<AdminMutationOk & { user_id: string; access_status: string }> {
  return adminFetchJson(
    `${ADMIN_API_PREFIX}/access/users/${encodeURIComponent(userId)}/deactivate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason ?? null }),
    },
    fetchFn,
  );
}

export async function setAdminPlatformRole(
  userId: string,
  action: "grant" | "revoke",
  fetchFn?: AdminFetchFn,
): Promise<AdminMutationOk & { user_id: string; platform_admin: boolean }> {
  return adminFetchJson(
    `${ADMIN_API_PREFIX}/access/users/${encodeURIComponent(userId)}/platform-role`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    },
    fetchFn,
  );
}

export type ProjectAccessControl = "default" | "none" | "read" | "write";

export async function setAdminProjectRole(
  userId: string,
  projectId: string,
  role: ProjectRole,
  fetchFn?: AdminFetchFn,
): Promise<AdminMutationOk & { user_id: string; project_id: string; access_level?: string; role?: string }> {
  return adminFetchJson(
    `${ADMIN_API_PREFIX}/access/users/${encodeURIComponent(userId)}/projects/${encodeURIComponent(projectId)}/role`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    },
    fetchFn,
  );
}

export async function setAdminProjectAccess(
  userId: string,
  projectId: string,
  accessLevel: ProjectAccessControl,
  fetchFn?: AdminFetchFn,
): Promise<AdminMutationOk & { user_id: string; project_id: string; access_level: string }> {
  return adminFetchJson(
    `${ADMIN_API_PREFIX}/access/users/${encodeURIComponent(userId)}/projects/${encodeURIComponent(projectId)}/role`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_level: accessLevel }),
    },
    fetchFn,
  );
}

export async function setAdminFeaturePermissions(
  userId: string,
  features: AdminFeatureUpdateItem[],
  fetchFn?: AdminFetchFn,
): Promise<AdminMutationOk & { user_id: string; results: unknown[] }> {
  return adminFetchJson(
    `${ADMIN_API_PREFIX}/access/users/${encodeURIComponent(userId)}/features`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ features }),
    },
    fetchFn,
  );
}

export async function resetAdminFeaturePermission(
  userId: string,
  featureKey: FeatureKey | string,
  projectId: string | null = null,
  fetchFn?: AdminFetchFn,
): Promise<AdminMutationOk & { user_id: string; results: unknown[] }> {
  return setAdminFeaturePermissions(
    userId,
    [{ feature_key: featureKey, project_id: projectId, reset: true }],
    fetchFn,
  );
}

export async function setAdminScrapedDataScope(
  userId: string,
  scopes: AdminScrapedDataScopeRow[],
  fetchFn?: AdminFetchFn,
): Promise<AdminMutationOk & { user_id: string; scopes: unknown[] }> {
  return adminFetchJson(
    `${ADMIN_API_PREFIX}/access/users/${encodeURIComponent(userId)}/scraped-data-scope`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scopes }),
    },
    fetchFn,
  );
}

export async function setAdminCredentialGrants(
  userId: string,
  grants: AdminCredentialGrantUpdateItem[],
  fetchFn?: AdminFetchFn,
): Promise<AdminMutationOk & { user_id: string; results: unknown[] }> {
  return adminFetchJson(
    `${ADMIN_API_PREFIX}/access/users/${encodeURIComponent(userId)}/credential-grants`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grants }),
    },
    fetchFn,
  );
}

export async function copyAdminPermissionsFromUser(
  userId: string,
  sourceUserId: string,
  fetchFn?: AdminFetchFn,
): Promise<AdminMutationOk & { user_id: string; source_user_id: string }> {
  return adminFetchJson(
    `${ADMIN_API_PREFIX}/access/users/${encodeURIComponent(userId)}/copy-from/${encodeURIComponent(sourceUserId)}`,
    { method: "POST" },
    fetchFn,
  );
}

export async function exportAdminAccessCsv(fetchFn?: AdminFetchFn): Promise<string> {
  return adminFetchJson<string>(`${ADMIN_API_PREFIX}/access/export`, {}, fetchFn);
}

export async function listAdminAuditEvents(
  query: AdminAuditQuery = {},
  fetchFn?: AdminFetchFn,
): Promise<AdminAuditEventsResponse> {
  const raw = await adminFetchJson<AdminAuditEventsResponse>(
    `${ADMIN_API_PREFIX}/audit/events${auditQueryString(query)}`,
    {},
    fetchFn,
  );
  return normalizeAuditResponse(raw);
}

export async function exportAdminAuditCsv(
  query: Pick<AdminAuditQuery, "from" | "to"> = {},
  fetchFn?: AdminFetchFn,
): Promise<string> {
  const params = new URLSearchParams();
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return adminFetchJson<string>(`${ADMIN_API_PREFIX}/audit/export${suffix}`, {}, fetchFn);
}
