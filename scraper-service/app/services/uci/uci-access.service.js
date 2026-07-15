"use strict";

const { getCoordinationRecordById } = require("./uci-records.service.js");

/**
 * Reusable helpers for `/api/uci/*` routes and secured credential APIs.
 * Uses Supabase service-role client only for `.auth.getUser(jwt)` and DB checks —
 * callers must enforce project ownership / team membership explicitly.
 *
 * Ownership model (Row 2): tenants + tenant_memberships + projects.tenant_id +
 * project_team_members via has_tenant_project_access / has_uci_row_* RPCs.
 */

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} projectId
 * @returns {Promise<{ tenant_id: string | null } | null>}
 */
async function getProjectTenantId(supabase, projectId) {
  try {
    const { data, error } = await supabase
      .from("projects")
      .select("tenant_id")
      .eq("id", projectId)
      .maybeSingle();

    if (error) {
      return null;
    }

    return data ?? null;
  } catch {
    return null;
  }
}

/**
 * @param {object} p
 * @param {import("@supabase/supabase-js").SupabaseClient} p.supabase
 * @param {string} p.userId
 * @param {string} p.tenantId
 * @returns {Promise<boolean>}
 */
async function assertTenantAccess({ supabase, userId, tenantId }) {
  if (!tenantId) return true;

  const { data, error } = await supabase.rpc("can_access_tenant", {
    _user_id: userId,
    _tenant_id: tenantId,
  });

  if (error) {
    const rpcErr = new Error(
      `Tenant access check failed: ${error.message || "rpc_error"}`,
    );
    rpcErr.code = "TENANT_ACCESS_RPC_ERROR";
    throw rpcErr;
  }

  return Boolean(data);
}

/**
 * @throws {Error & { statusCode?: number, code?: string }}
 */
async function requireTenantAccess({ supabase, userId, tenantId }) {
  if (!tenantId) return;
  const ok = await assertTenantAccess({ supabase, userId, tenantId });
  if (!ok) {
    const err = new Error("Forbidden: no access to this tenant");
    err.statusCode = 403;
    err.code = "TENANT_ACCESS_DENIED";
    throw err;
  }
}

/**
 * @param {object} p
 * @param {import("@supabase/supabase-js").SupabaseClient} p.supabase
 * @param {string} p.userId
 * @param {string} p.projectId
 * @param {boolean} [p.write]
 */
async function requireTenantProjectAccess({ supabase, userId, projectId, write = false }) {
  const project = await getProjectTenantId(supabase, projectId);
  if (project?.tenant_id) {
    await requireTenantAccess({ supabase, userId, tenantId: project.tenant_id });
  }

  if (write) {
    await requireProjectEditorAccess({ supabase, userId, projectId });
  } else {
    const ok = await assertProjectAccess({ supabase, userId, projectId });
    if (!ok) {
      const err = new Error("Forbidden: no access to this project");
      err.statusCode = 403;
      err.code = "PROJECT_ACCESS_DENIED";
      throw err;
    }
  }
}

/**
 * @typedef {{ id: string, email?: string }} SupabaseAuthUserLike
 */

/**
 * @param {import("express").Request} req
 * @param {import("@supabase/supabase-js").SupabaseClient} supabaseAdmin Service-role client for auth.getUser
 * @returns {Promise<{ user: SupabaseAuthUserLike | null, token: string | null, error: { status: number, message: string, code: string } | null }>}
 */
async function getAuthenticatedUser(req, supabaseAdmin) {
  const authHeader = req.headers.authorization;
  const bearer =
    authHeader && String(authHeader).startsWith("Bearer ")
      ? String(authHeader).replace(/^Bearer\s+/i, "").trim()
      : null;

  if (!bearer) {
    return {
      user: null,
      token: null,
      error: {
        status: 401,
        message: "Authentication required",
        code: "UNAUTHENTICATED",
      },
    };
  }

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(bearer);
  if (error || !user) {
    return {
      user: null,
      token: bearer,
      error: {
        status: 401,
        message: "Invalid or expired authentication token",
        code: "INVALID_JWT",
      },
    };
  }

  return { user, token: bearer, error: null };
}

/**
 * @param {import("express").Request} req
 * @param {import("@supabase/supabase-js").SupabaseClient} supabaseAdmin
 * @returns {Promise<SupabaseAuthUserLike>}
 */
async function requireAuthenticatedUser(req, supabaseAdmin) {
  const out = await getAuthenticatedUser(req, supabaseAdmin);
  if (!out.user) {
    const err = new Error(out.error?.message || "Unauthorized");
    /** @type {Error & { statusCode?: number, code?: string }} */
    const e = err;
    e.statusCode = out.error?.status ?? 401;
    e.code = out.error?.code ?? "UNAUTHENTICATED";
    throw err;
  }
  return /** @type {SupabaseAuthUserLike} */ (out.user);
}

/**
 * @param {object} p
 * @param {import("@supabase/supabase-js").SupabaseClient} p.supabase Admin client
 * @param {string} p.userId
 * @param {string} p.projectId
 * @returns {Promise<boolean>}
 */
async function assertProjectAccess({ supabase, userId, projectId }) {
  if (
    !userId ||
    !projectId ||
    typeof userId !== "string" ||
    typeof projectId !== "string"
  ) {
    return false;
  }

  const { data, error } = await supabase.rpc("has_project_access", {
    _user_id: userId,
    _project_id: projectId,
  });

  if (error) {
    const rpcErr = new Error(
      `Project access check failed: ${error.message || "rpc_error"}`,
    );
    rpcErr.code = "PROJECT_ACCESS_RPC_ERROR";
    throw rpcErr;
  }

  return Boolean(data);
}

/**
 * @param {object} p
 * @param {import("@supabase/supabase-js").SupabaseClient} p.supabase Admin client
 * @param {string} p.userId
 * @param {string} p.projectId
 * @returns {Promise<boolean>}
 */
async function assertProjectEditorAccess({ supabase, userId, projectId }) {
  if (
    !userId ||
    !projectId ||
    typeof userId !== "string" ||
    typeof projectId !== "string"
  ) {
    return false;
  }

  const { data, error } = await supabase.rpc("has_project_editor_access", {
    _user_id: userId,
    _project_id: projectId,
  });

  if (error) {
    const rpcErr = new Error(
      `Project editor access check failed: ${error.message || "rpc_error"}`,
    );
    rpcErr.code = "PROJECT_EDITOR_ACCESS_RPC_ERROR";
    throw rpcErr;
  }

  return Boolean(data);
}

/**
 * @throws {Error & { statusCode?: number, code?: string }}
 */
async function requireProjectEditorAccess({ supabase, userId, projectId }) {
  const ok = await assertProjectEditorAccess({ supabase, userId, projectId });
  if (!ok) {
    const err = new Error("Forbidden: editor access required for this project");
    /** @type {Error & { statusCode?: number, code?: string }} */
    const e = err;
    e.statusCode = 403;
    e.code = "PROJECT_EDITOR_ACCESS_DENIED";
    throw err;
  }
}

/**
 * @param {object} p
 * @param {import("@supabase/supabase-js").SupabaseClient} p.supabase
 * @param {string} p.userId
 * @param {string} p.projectId
 * @param {boolean} [p.write] When true, requires owner/admin/editor (not viewer)
 * @throws {Error & { statusCode?: number, code?: string }}
 */
async function requireProjectAccess({ supabase, userId, projectId, write = false }) {
  await requireTenantProjectAccess({ supabase, userId, projectId, write });
}

/**
 * Load coordination record and enforce project access. Returns record on success.
 * @param {object} p
 * @param {import("@supabase/supabase-js").SupabaseClient} p.supabase
 * @param {string} p.userId
 * @param {string} p.coordinationRecordId
 * @param {boolean} [p.write]
 * @returns {Promise<Record<string, unknown>>}
 */
async function requireCoordinationRecordAccess({
  supabase,
  userId,
  coordinationRecordId,
  write = false,
}) {
  const record = await getCoordinationRecordById(supabase, coordinationRecordId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  await requireTenantProjectAccess({
    supabase,
    userId,
    projectId: String(record.project_id),
    write,
  });

  if (record.tenant_id) {
    const project = await getProjectTenantId(supabase, String(record.project_id));
    if (
      project?.tenant_id &&
      String(record.tenant_id) !== String(project.tenant_id)
    ) {
      const err = new Error("Coordination record not found");
      err.statusCode = 404;
      err.code = "NOT_FOUND";
      throw err;
    }
  }

  return record;
}

/**
 * Verify a child entity's project_id matches the expected project (prevents cross-project IDOR).
 * @param {object} p
 * @param {string} p.expectedProjectId
 * @param {string} p.actualProjectId
 * @param {string} [p.entityLabel]
 */
function assertEntityProjectMatch({ expectedProjectId, actualProjectId, entityLabel = "Record" }) {
  if (String(expectedProjectId) !== String(actualProjectId)) {
    const err = new Error(`${entityLabel} not found`);
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
}

/**
 * When coordination_id is supplied alongside project_id, verify they belong together.
 * @param {object} p
 * @param {import("@supabase/supabase-js").SupabaseClient} p.supabase
 * @param {string} p.projectId
 * @param {string} [p.coordinationRecordId]
 */
async function assertCoordinationBelongsToProject({
  supabase,
  projectId,
  coordinationRecordId,
}) {
  if (!coordinationRecordId) return;

  const record = await getCoordinationRecordById(supabase, coordinationRecordId);
  if (!record || String(record.project_id) !== String(projectId)) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  if (record.tenant_id) {
    const project = await getProjectTenantId(supabase, projectId);
    if (
      project?.tenant_id &&
      String(record.tenant_id) !== String(project.tenant_id)
    ) {
      const err = new Error("Coordination record not found");
      err.statusCode = 404;
      err.code = "NOT_FOUND";
      throw err;
    }
  }
}

/**
 * Returns the project row if the user owns it or has team access.
 * @param {object} p
 * @param {import("@supabase/supabase-js").SupabaseClient} p.supabase Admin client (service role)
 * @param {string} p.userId
 * @param {string} p.projectId
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function getProjectForUciAccess({ supabase, userId, projectId }) {
  await requireProjectAccess({ supabase, userId, projectId });

  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .maybeSingle();

  if (error)
    throw Object.assign(
      new Error(error.message || "Failed to load project"),
      {
        cause: error,
        code: "PROJECT_FETCH_FAILED",
      },
    );

  return data ?? null;
}

/**
 * Response-safe error normalization (never include secrets).
 * @param {unknown} error
 */
function sanitizeUciError(error) {
  const err = /** @type {Error & { statusCode?: number, code?: string }} */ (
    error instanceof Error ? error : new Error(String(error))
  );

  const status =
    typeof err.statusCode === "number" &&
    err.statusCode >= 400 &&
    err.statusCode <= 599
      ? err.statusCode
      : 500;

  const rawMessage =
    typeof err.message === "string" ? err.message : "Server error";

  /** @type {Record<string, unknown>} */
  const body = {
    error:
      typeof err.code === "string" && status !== 500
        ? err.code
        : status === 500
          ? "INTERNAL_ERROR"
          : typeof err.code === "string"
            ? err.code
            : "ERROR",
    message:
      status === 500 ? "An unexpected server error occurred." : rawMessage,
  };

  if (Array.isArray(/** @type {{ available_applications?: unknown }} */ (err).available_applications)) {
    body.available_applications = /** @type {{ available_applications?: unknown }} */ (
      err
    ).available_applications;
  }

  return {
    httpStatus: status,
    body,
  };
}

function assertEntityTenantMatch({
  expectedTenantId,
  actualTenantId,
  entityLabel = "Record",
}) {
  if (
    expectedTenantId &&
    actualTenantId &&
    String(expectedTenantId) !== String(actualTenantId)
  ) {
    const err = new Error(`${entityLabel} not found`);
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
}

module.exports = {
  getAuthenticatedUser,
  requireAuthenticatedUser,
  assertProjectAccess,
  assertProjectEditorAccess,
  requireProjectAccess,
  requireProjectEditorAccess,
  requireTenantProjectAccess,
  requireTenantAccess,
  getProjectTenantId,
  assertTenantAccess,
  requireCoordinationRecordAccess,
  assertEntityProjectMatch,
  assertEntityTenantMatch,
  assertCoordinationBelongsToProject,
  getProjectForUciAccess,
  sanitizeUciError,
};
