"use strict";

/**
 * Reusable helpers for future `/api/uci/*` routes and secured credential APIs.
 * Uses Supabase service-role client only for `.auth.getUser(jwt)` and DB checks —
 * callers must enforce project ownership / team membership explicitly.
 */

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
 * @throws {Error & { statusCode?: number, code?: string }}
 */
async function requireProjectAccess({ supabase, userId, projectId }) {
  const ok = await assertProjectAccess({ supabase, userId, projectId });
  if (!ok) {
    const err = new Error("Forbidden: no access to this project");
    /** @type {Error & { statusCode?: number, code?: string }} */
    const e = err;
    e.statusCode = 403;
    e.code = "PROJECT_ACCESS_DENIED";
    throw err;
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

  return {
    httpStatus: status,
    body: {
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
    },
  };
}

module.exports = {
  getAuthenticatedUser,
  requireAuthenticatedUser,
  assertProjectAccess,
  requireProjectAccess,
  getProjectForUciAccess,
  sanitizeUciError,
};
