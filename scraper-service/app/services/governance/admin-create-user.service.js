"use strict";

const { appendAuditEvent } = require("./governance.service.js");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const MIN_PASSWORD_LENGTH = 8;
const ASSIGNABLE_PROJECT_ROLES = new Set(["viewer", "editor", "admin"]);

/**
 * @param {unknown} value
 * @returns {string}
 */
function trimString(value) {
  return value == null ? "" : String(value).trim();
}

/**
 * @param {unknown} email
 * @returns {{ ok: true, email: string } | { ok: false, message: string }}
 */
function validateEmail(email) {
  const normalized = trimString(email).toLowerCase();
  if (!normalized) {
    return { ok: false, message: "Email is required" };
  }
  if (!EMAIL_PATTERN.test(normalized)) {
    return { ok: false, message: "Invalid email address" };
  }
  return { ok: true, email: normalized };
}

/**
 * @param {unknown} password
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
function validateTemporaryPassword(password) {
  const value = String(password ?? "");
  if (!value) {
    return { ok: false, message: "Temporary password is required" };
  }
  if (value.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      message: `Temporary password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    };
  }
  return { ok: true };
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function isDuplicateEmailError(err) {
  const message = String(err?.message || err || "").toLowerCase();
  return (
    message.includes("already registered") ||
    message.includes("already exists") ||
    message.includes("duplicate") ||
    message.includes("users_email_partial_key")
  );
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} userId
 */
async function deleteAuthUserSafe(supabase, userId) {
  try {
    await supabase.auth.admin.deleteUser(userId);
  } catch {
    // Best-effort rollback; caller surfaces primary failure.
  }
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {{
 *   actorId: string,
 *   email: string,
 *   temporaryPassword: string,
 *   fullName: string,
 *   companyName?: string | null,
 *   jobTitle?: string | null,
 *   projectId?: string | null,
 *   projectRole?: string | null,
 * }} input
 */
async function adminCreateUser(supabase, input) {
  const emailCheck = validateEmail(input.email);
  if (!emailCheck.ok) {
    throw Object.assign(new Error(emailCheck.message), {
      statusCode: 400,
      code: "INVALID_EMAIL",
    });
  }

  const passwordCheck = validateTemporaryPassword(input.temporaryPassword);
  if (!passwordCheck.ok) {
    throw Object.assign(new Error(passwordCheck.message), {
      statusCode: 400,
      code: "INVALID_PASSWORD",
    });
  }

  const fullName = trimString(input.fullName);
  if (!fullName) {
    throw Object.assign(new Error("Full name is required"), {
      statusCode: 400,
      code: "INVALID_NAME",
    });
  }

  const companyName = trimString(input.companyName) || null;
  const jobTitle = trimString(input.jobTitle) || null;
  const projectId = trimString(input.projectId) || null;
  const projectRole = trimString(input.projectRole).toLowerCase() || null;

  if (projectId && !ASSIGNABLE_PROJECT_ROLES.has(projectRole || "")) {
    throw Object.assign(new Error("project_role must be viewer, editor, or admin"), {
      statusCode: 400,
      code: "INVALID_PROJECT_ROLE",
    });
  }

  if (!projectId && projectRole) {
    throw Object.assign(new Error("project_id is required when project_role is set"), {
      statusCode: 400,
      code: "INVALID_PROJECT",
    });
  }

  if (projectId) {
    const { data: projectRow, error: projectErr } = await supabase
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .maybeSingle();

    if (projectErr) {
      throw Object.assign(new Error(projectErr.message), { statusCode: 500 });
    }
    if (!projectRow) {
      throw Object.assign(new Error("Project not found"), {
        statusCode: 404,
        code: "PROJECT_NOT_FOUND",
      });
    }
  }

  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email: emailCheck.email,
    password: input.temporaryPassword,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      company_name: companyName ?? "",
      job_title: jobTitle ?? "",
    },
  });

  if (createErr) {
    if (isDuplicateEmailError(createErr)) {
      throw Object.assign(new Error("A user with this email already exists"), {
        statusCode: 409,
        code: "DUPLICATE_EMAIL",
      });
    }
    throw Object.assign(new Error(createErr.message), { statusCode: 500 });
  }

  const userId = created?.user?.id ? String(created.user.id) : "";
  if (!userId) {
    throw Object.assign(new Error("Auth user creation did not return a user id"), {
      statusCode: 500,
    });
  }

  const { error: profileErr } = await supabase.from("profiles").upsert(
    {
      user_id: userId,
      full_name: fullName,
      company_name: companyName,
      job_title: jobTitle,
      access_status: "active",
      must_change_password: true,
      created_by_admin: true,
    },
    { onConflict: "user_id" },
  );

  if (profileErr) {
    await deleteAuthUserSafe(supabase, userId);
    throw Object.assign(
      new Error(`Profile setup failed; auth user rolled back: ${profileErr.message}`),
      { statusCode: 500, code: "PROFILE_SETUP_FAILED" },
    );
  }

  if (projectId && projectRole) {
    const { error: teamErr } = await supabase.from("project_team_members").upsert(
      {
        user_id: userId,
        project_id: projectId,
        role: projectRole,
      },
      { onConflict: "project_id,user_id" },
    );

    if (teamErr) {
      await deleteAuthUserSafe(supabase, userId);
      throw Object.assign(
        new Error(`Project access setup failed; auth user rolled back: ${teamErr.message}`),
        { statusCode: 500, code: "PROJECT_ACCESS_SETUP_FAILED" },
      );
    }

    await appendAuditEvent(supabase, {
      actor_id: input.actorId,
      action: "project_access.changed",
      target_type: "user",
      target_id: userId,
      project_id: projectId,
      after_json: { role: projectRole, source: "admin.user.created" },
    });
  }

  await appendAuditEvent(supabase, {
    actor_id: input.actorId,
    action: "admin.user.created",
    target_type: "user",
    target_id: userId,
    after_json: {
      email: emailCheck.email,
      full_name: fullName,
      company_name: companyName,
      job_title: jobTitle,
      must_change_password: true,
      created_by_admin: true,
      initial_project_id: projectId,
      initial_project_role: projectRole,
    },
  });

  return {
    ok: true,
    user_id: userId,
    email: emailCheck.email,
    full_name: fullName,
    company_name: companyName,
    job_title: jobTitle,
    access_status: "active",
    must_change_password: true,
    created_by_admin: true,
    initial_project_id: projectId,
    initial_project_role: projectRole,
  };
}

module.exports = {
  adminCreateUser,
  validateEmail,
  validateTemporaryPassword,
  MIN_PASSWORD_LENGTH,
  ASSIGNABLE_PROJECT_ROLES,
};
