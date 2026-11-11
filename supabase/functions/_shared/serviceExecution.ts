/**
 * Service execution mode for the agent pipeline (D-063).
 *
 * Pure module: no Deno globals, no network imports. Env, headers and the
 * service-role client are passed in so Node tests can exercise every branch.
 */

export const SERVICE_SECRET_HEADER = "x-permitpilot-service-secret";
export const ACTING_USER_HEADER = "x-permitpilot-acting-user";
export const SERVICE_EXECUTION_ACTION = "pipeline.service_execution";
export const SERVICE_EXECUTION_DENIED_ACTION = "pipeline.service_execution.denied";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface HeaderSource {
  get(name: string): string | null;
}

export interface ServiceExecutionEnv {
  serviceSecret?: string | null;
  serviceRoleKey?: string | null;
}

type DbResult<T> = { data: T | null; error: { message?: string } | null };

/** Minimal surface of a service-role SupabaseClient used here. */
export interface ServiceAdminClient {
  from(table: string): any;
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<DbResult<unknown>>;
}

export type ServiceExecutionResult =
  | { mode: "user" }
  | { mode: "service"; actingUserId: string; projectId: string }
  | { error: string; status: number };

export type ServiceDenialReason =
  | "bearer_mismatch"
  | "acting_user_invalid"
  | "project_id_missing"
  | "project_not_found"
  | "owner_mismatch"
  | "no_project_access"
  | "project_not_linked";

export interface ParsedServiceHeaders {
  present: boolean;
  secret: string | null;
  actingUser: string | null;
  bearer: string | null;
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function parseServiceHeaders(headers: HeaderSource): ParsedServiceHeaders {
  const secret = headers.get(SERVICE_SECRET_HEADER);
  const actingUser = headers.get(ACTING_USER_HEADER);
  const auth = headers.get("Authorization");
  const bearer = auth && /^\s*Bearer\s+/i.test(auth) ? auth.replace(/^\s*Bearer\s+/i, "").trim() : null;
  return {
    present: secret !== null || actingUser !== null,
    secret,
    actingUser: actingUser === null ? null : actingUser.trim(),
    bearer: bearer || null,
  };
}

/** Constant-time string comparison; empty or missing values never match. */
export function timingSafeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length === 0 || b.length === 0) return false;
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  const len = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < len; i++) {
    diff |= (x[i % x.length] ?? 0) ^ (y[i % y.length] ?? 0);
  }
  return diff === 0;
}

export function isServiceModeEnabled(env: ServiceExecutionEnv): boolean {
  return Boolean(env.serviceSecret && env.serviceSecret.trim() && env.serviceRoleKey && env.serviceRoleKey.trim());
}

export interface ServiceAuditInput {
  accepted: boolean;
  functionName: string;
  actingUserId: string | null;
  projectId: string | null;
  /** True only when the project row was read, so the project_id FK is safe. */
  projectExists?: boolean;
  reason?: ServiceDenialReason;
}

/** Builds the platform_audit_events row. Never includes secrets or tokens. */
export function buildServiceAuditRow(input: ServiceAuditInput): Record<string, unknown> {
  const actingUserId = isUuid(input.actingUserId) ? input.actingUserId : null;
  const projectId = isUuid(input.projectId) ? input.projectId : null;
  return {
    // actor_id and project_id are FKs; only set them once the rows are known to exist.
    actor_id: input.accepted ? actingUserId : null,
    action: input.accepted ? SERVICE_EXECUTION_ACTION : SERVICE_EXECUTION_DENIED_ACTION,
    target_type: "project",
    target_id: projectId,
    project_id: input.accepted || input.projectExists ? projectId : null,
    after_json: {
      function: input.functionName,
      acting_user_id: actingUserId,
      project_id: projectId,
      ...(input.reason ? { reason: input.reason } : {}),
    },
    result: input.accepted ? "success" : "failure",
  };
}

export async function writeServiceExecutionAudit(
  admin: ServiceAdminClient,
  input: ServiceAuditInput,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await admin.from("platform_audit_events").insert(buildServiceAuditRow(input));
    if (error) return { ok: false, error: error.message ?? "insert failed" };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface AuthorizeServiceExecutionArgs {
  headers: HeaderSource;
  env: ServiceExecutionEnv;
  /** Service-role client, or a factory called only after the secret is validated. */
  admin: ServiceAdminClient | (() => ServiceAdminClient);
  /** Project id from the request body, or a lazy reader. */
  projectId: string | null | undefined | (() => Promise<unknown> | unknown);
  functionName: string;
}

const DENIED_MESSAGE = "Project not found or access denied";

/**
 * Returns {mode:'user'} when no service header is present (caller keeps its
 * existing user-JWT path). Any service header present means the call is
 * either fully valid service mode or rejected; it never falls through.
 */
export async function authorizeServiceExecution(
  args: AuthorizeServiceExecutionArgs,
): Promise<ServiceExecutionResult> {
  const parsed = parseServiceHeaders(args.headers);
  if (!parsed.present) return { mode: "user" };

  if (!isServiceModeEnabled(args.env)) {
    return { error: "Service execution disabled", status: 401 };
  }
  if (!timingSafeEqual(parsed.secret, args.env.serviceSecret!.trim())) {
    return { error: "Invalid service credentials", status: 401 };
  }

  const admin = typeof args.admin === "function" ? args.admin() : args.admin;
  const actingUserId = isUuid(parsed.actingUser) ? parsed.actingUser : null;
  let projectId: string | null = null;
  let projectExists = false;

  const deny = async (reason: ServiceDenialReason, status: number, message: string) => {
    const audit = await writeServiceExecutionAudit(admin, {
      accepted: false,
      functionName: args.functionName,
      actingUserId,
      projectId,
      projectExists,
      reason,
    });
    if (!audit.ok) console.warn("[service-execution] denial audit failed:", audit.error);
    return { error: message, status };
  };

  if (!timingSafeEqual(parsed.bearer, args.env.serviceRoleKey!.trim())) {
    return deny("bearer_mismatch", 401, "Invalid service credentials");
  }
  if (!actingUserId) {
    return deny("acting_user_invalid", 401, "Invalid service credentials");
  }

  const rawProjectId = typeof args.projectId === "function" ? await args.projectId() : args.projectId;
  if (typeof rawProjectId !== "string" || !rawProjectId.trim()) {
    return deny("project_id_missing", 400, "project_id is required");
  }
  projectId = rawProjectId.trim();
  if (!isUuid(projectId)) {
    return deny("project_not_found", 403, DENIED_MESSAGE);
  }

  const { data: project, error: projectError } = await admin
    .from("projects")
    .select("id, user_id")
    .eq("id", projectId)
    .maybeSingle();
  if (projectError || !project) {
    return deny("project_not_found", 403, DENIED_MESSAGE);
  }
  projectExists = true;
  if (project.user_id !== actingUserId) {
    return deny("owner_mismatch", 403, DENIED_MESSAGE);
  }

  const { data: hasAccess, error: accessError } = await admin.rpc("has_project_access", {
    _user_id: actingUserId,
    _project_id: projectId,
  });
  if (accessError || hasAccess !== true) {
    return deny("no_project_access", 403, DENIED_MESSAGE);
  }

  const { data: links, error: linkError } = await admin
    .from("project_permits")
    .select("project_id")
    .eq("project_id", projectId)
    .limit(1);
  if (linkError || !Array.isArray(links) || links.length === 0) {
    return deny("project_not_linked", 403, DENIED_MESSAGE);
  }

  const audit = await writeServiceExecutionAudit(admin, {
    accepted: true,
    functionName: args.functionName,
    actingUserId,
    projectId,
    projectExists,
  });
  if (!audit.ok) {
    console.error("[service-execution] audit write failed; refusing call:", audit.error);
    return { error: "Service execution audit failed", status: 500 };
  }

  return { mode: "service", actingUserId, projectId };
}

/** Headers intake-pipeline-agent sends to stage agents in service mode. */
export function serviceForwardHeaders(input: {
  serviceSecret: string;
  serviceRoleKey: string;
  actingUserId: string;
}): Record<string, string> {
  return {
    Authorization: `Bearer ${input.serviceRoleKey.trim()}`,
    [SERVICE_SECRET_HEADER]: input.serviceSecret.trim(),
    [ACTING_USER_HEADER]: input.actingUserId,
  };
}

/** Same shape as supabase.auth.getUser() so callers keep their destructuring. */
export function serviceUserResponse(actingUserId: string): {
  data: { user: { id: string } };
  error: null;
} {
  return { data: { user: { id: actingUserId } }, error: null };
}
