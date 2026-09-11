"use strict";

const { isSuperAdmin, isPlatformAdmin, isUserActive } = require("./governance.service.js");

/** @typedef {"user"|"admin"|"super_admin"} PlatformRoleLevel */

/**
 * @param {string[]} roles
 * @returns {PlatformRoleLevel}
 */
function resolvePrimaryPlatformRole(roles) {
  const set = new Set((roles || []).map((r) => String(r)));
  if (set.has("super_admin")) return "super_admin";
  if (set.has("admin")) return "admin";
  return "user";
}

/**
 * Coerce RPC/JSONB role payloads into plain string role names.
 * @param {unknown} raw
 * @returns {string[]}
 */
function normalizePlatformRoles(raw) {
  if (raw == null) {
    return [];
  }

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        return normalizePlatformRoles(JSON.parse(trimmed));
      } catch {
        return trimmed ? [trimmed] : [];
      }
    }
    return trimmed ? [trimmed] : [];
  }

  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item) => {
      if (item == null) {
        return "";
      }
      if (typeof item === "string") {
        return item.trim();
      }
      if (typeof item === "object" && item !== null && "role" in item) {
        return String(/** @type {{ role: unknown }} */ (item).role).trim();
      }
      return String(item).trim();
    })
    .filter(Boolean);
}

/**
 * Attach canonical platform_role / super_admin fields for admin UI serializers.
 * @param {Record<string, unknown>} payload
 * @returns {Record<string, unknown>}
 */
function attachPlatformRoleFields(payload) {
  const platformRoles = normalizePlatformRoles(payload.platform_roles);
  const primaryRole = resolvePrimaryPlatformRole(platformRoles);

  payload.platform_roles = platformRoles;
  payload.platform_role = primaryRole;
  payload.super_admin = primaryRole === "super_admin";
  payload.platform_admin =
    primaryRole === "admin" || primaryRole === "super_admin";

  return payload;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} userId
 * @returns {Promise<PlatformRoleLevel>}
 */
async function getUserPlatformRoleLevel(supabase, userId) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);

  if (error || !Array.isArray(data)) {
    return "user";
  }

  return resolvePrimaryPlatformRole(data.map((row) => row.role));
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @returns {Promise<number>}
 */
async function countActiveSuperAdmins(supabase) {
  const { data: roleRows, error } = await supabase
    .from("user_roles")
    .select("user_id")
    .eq("role", "super_admin");

  if (error || !Array.isArray(roleRows) || roleRows.length === 0) {
    return 0;
  }

  const ids = roleRows.map((row) => String(row.user_id));
  const { data: profiles, error: profileErr } = await supabase
    .from("profiles")
    .select("user_id, access_status")
    .in("user_id", ids);

  if (profileErr || !Array.isArray(profiles) || profiles.length === 0) {
    return roleRows.length;
  }

  let count = 0;
  for (const row of profiles) {
    if (String(row.access_status || "active") === "active") {
      count += 1;
    }
  }
  return count > 0 ? count : roleRows.length;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @returns {Promise<number>}
 */
async function countPlatformAdminRoles(supabase) {
  const { count, error } = await supabase
    .from("user_roles")
    .select("*", { count: "exact", head: true })
    .eq("role", "admin");

  if (error) {
    return 0;
  }
  return count ?? 0;
}

/**
 * Platform admins may only manage normal users.
 * @param {PlatformRoleLevel} targetRole
 * @returns {boolean}
 */
function isNormalUserRole(targetRole) {
  return targetRole === "user";
}

/**
 * @param {object} p
 * @param {PlatformRoleLevel} p.actorRole
 * @param {PlatformRoleLevel} p.targetRole
 * @param {string} p.actorId
 * @param {string} p.targetId
 * @returns {{ allowed: boolean, code?: string, message?: string }}
 */
function assertCanManageUserLifecycle({ actorRole, targetRole, actorId, targetId }) {
  if (String(actorId) === String(targetId)) {
    return {
      allowed: false,
      code: "SELF_ACTION_BLOCKED",
      message: "Cannot perform this action on your own account",
    };
  }

  if (actorRole === "super_admin") {
    return { allowed: true };
  }

  if (actorRole === "admin") {
    if (isNormalUserRole(targetRole)) {
      return { allowed: true };
    }
    return {
      allowed: false,
      code: "ADMIN_HIERARCHY_DENIED",
      message: "Platform admin cannot manage another admin",
    };
  }

  return {
    allowed: false,
    code: "PLATFORM_ADMIN_REQUIRED",
    message: "Platform admin access required",
  };
}

/**
 * @param {object} p
 * @param {PlatformRoleLevel} p.actorRole
 * @returns {{ allowed: boolean, code?: string, message?: string }}
 */
function assertSuperAdminActor({ actorRole }) {
  if (actorRole !== "super_admin") {
    return {
      allowed: false,
      code: "SUPER_ADMIN_REQUIRED",
      message: "Super admin access required for this action",
    };
  }
  return { allowed: true };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} userId
 * @returns {Promise<PlatformRoleLevel>}
 */
async function getActorPlatformRoleLevel(supabase, userId) {
  if (await isSuperAdmin(supabase, userId)) {
    return "super_admin";
  }
  if (await isPlatformAdmin(supabase, userId)) {
    return "admin";
  }
  return "user";
}

module.exports = {
  resolvePrimaryPlatformRole,
  normalizePlatformRoles,
  attachPlatformRoleFields,
  getUserPlatformRoleLevel,
  getActorPlatformRoleLevel,
  countActiveSuperAdmins,
  countPlatformAdminRoles,
  isNormalUserRole,
  assertCanManageUserLifecycle,
  assertSuperAdminActor,
};
