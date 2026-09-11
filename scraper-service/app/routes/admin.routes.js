"use strict";

const express = require("express");
const { sanitizeUciError } = require("../services/uci/uci-access.service.js");
const { createRequirePlatformAdmin } = require("../services/governance/require-platform-admin.js");
const {
  computeEffectivePermissions,
  appendAuditEvent,
  groupPortalCredentialsByCanonical,
  pickCanonicalPortalCredential,
} = require("../services/governance/governance.service.js");
const {
  getActorPlatformRoleLevel,
  getUserPlatformRoleLevel,
  countActiveSuperAdmins,
  countPlatformAdminRoles,
  assertCanManageUserLifecycle,
  assertSuperAdminActor,
  resolvePrimaryPlatformRole,
} = require("../services/governance/admin-role.service.js");
const {
  fetchEmailsForUserIds,
  fetchEmailForUserId,
  findUserIdsByEmailSearch,
} = require("../services/governance/admin-auth-emails.service.js");
const { adminCreateUser } = require("../services/governance/admin-create-user.service.js");

/**
 * @param {unknown[]} rows
 * @param {string[]} columns
 * @returns {string}
 */
function toCsv(rows, columns) {
  const escape = (val) => {
    const s = val == null ? "" : String(val);
    if (/[",\n\r]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const lines = [columns.join(",")];
  for (const row of rows) {
    const obj = row && typeof row === "object" ? row : {};
    lines.push(columns.map((col) => escape(/** @type {Record<string, unknown>} */ (obj)[col])).join(","));
  }
  return lines.join("\n");
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} userId
 * @returns {Promise<string[]>}
 */
async function fetchUserRoleNames(supabase, userId) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);

  if (error || !Array.isArray(data)) {
    return [];
  }
  return data.map((row) => String(row.role));
}

/**
 * @param {{ supabase: import("@supabase/supabase-js").SupabaseClient }} opts
 */
function createAdminRouter(opts) {
  const { supabase } = opts;
  const router = express.Router();
  const requirePlatformAdmin = createRequirePlatformAdmin({ supabase });

  router.use("/api/admin/v1", requirePlatformAdmin);

  router.get("/api/admin/v1/overview", async (req, res) => {
    try {
      const { data, error } = await supabase.rpc("admin_overview_metrics");
      if (!error && data) {
        return res.json(data);
      }

      const { count: totalUsers } = await supabase
        .from("profiles")
        .select("*", { count: "exact", head: true });

      const { count: activeUsers } = await supabase
        .from("profiles")
        .select("*", { count: "exact", head: true })
        .eq("access_status", "active");

      const adminCount = await countPlatformAdminRoles(supabase);
      const superAdminCount = await countActiveSuperAdmins(supabase);

      res.json({
        total_users: totalUsers ?? 0,
        active_users: activeUsers ?? 0,
        platform_admins: adminCount + superAdminCount,
        platform_admin_roles: adminCount,
        super_admins: superAdminCount,
        permission_risks: [],
        pending_invitations: 0,
      });
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.get("/api/admin/v1/portal-credentials", async (_req, res) => {
    try {
      const { data, error } = await supabase
        .from("portal_credentials")
        .select("id, jurisdiction, portal_username, login_url, project_id, user_id, created_at")
        .order("jurisdiction", { ascending: true })
        .order("portal_username", { ascending: true });

      if (error) {
        throw Object.assign(new Error(error.message), { statusCode: 500 });
      }

      const credentials = [...groupPortalCredentialsByCanonical(data || []).values()].map(
        (group) => {
          const row = pickCanonicalPortalCredential(group);
          return {
            id: String(row.id),
            jurisdiction: row.jurisdiction ?? null,
            portal_username: row.portal_username ?? null,
            login_url: row.login_url ?? null,
            project_id: row.project_id ?? null,
            user_id: row.user_id ? String(row.user_id) : null,
            created_at: row.created_at ?? null,
          };
        },
      );

      res.json({ credentials });
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/api/admin/v1/access/users", async (req, res) => {
    try {
      const actor = req.platformAdminUser;
      const body = req.body && typeof req.body === "object" ? req.body : {};

      const result = await adminCreateUser(supabase, {
        actorId: actor.id,
        email: body.email,
        temporaryPassword: body.temporary_password,
        fullName: body.full_name,
        companyName: body.company_name ?? null,
        jobTitle: body.job_title ?? null,
        projectId: body.project_id ?? null,
        projectRole: body.project_role ?? null,
      });

      res.status(201).json(result);
    } catch (err) {
      const statusCode = Number(err?.statusCode) || 500;
      const code = err?.code || "CREATE_USER_FAILED";
      res.status(statusCode).json({
        error: code,
        message: err instanceof Error ? err.message : "Failed to create user",
      });
    }
  });

  router.get("/api/admin/v1/access/users", async (req, res) => {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
      const offset = Math.max(Number(req.query.offset) || 0, 0);
      const search = String(req.query.search || "").trim();

      const profileSelect =
        "user_id, full_name, company_name, job_title, access_status, created_at";

      /** @type {Array<Record<string, unknown>>} */
      let profiles = [];
      let total = 0;

      if (search) {
        const searchLower = search.toLowerCase();
        const emailUserIds = await findUserIdsByEmailSearch(supabase, searchLower);

        const [nameRes, emailRes] = await Promise.all([
          supabase
            .from("profiles")
            .select(profileSelect)
            .or(`full_name.ilike.%${search}%,company_name.ilike.%${search}%`)
            .order("created_at", { ascending: false }),
          emailUserIds.length
            ? supabase
                .from("profiles")
                .select(profileSelect)
                .in("user_id", emailUserIds)
                .order("created_at", { ascending: false })
            : Promise.resolve({ data: [], error: null }),
        ]);

        if (nameRes.error) {
          throw Object.assign(new Error(nameRes.error.message), { statusCode: 500 });
        }
        if (emailRes.error) {
          throw Object.assign(new Error(emailRes.error.message), { statusCode: 500 });
        }

        /** @type {Map<string, Record<string, unknown>>} */
        const merged = new Map();
        for (const row of [...(nameRes.data || []), ...(emailRes.data || [])]) {
          merged.set(String(row.user_id), row);
        }

        profiles = [...merged.values()].sort((a, b) => {
          const aTime = new Date(String(a.created_at || 0)).getTime();
          const bTime = new Date(String(b.created_at || 0)).getTime();
          return bTime - aTime;
        });
        total = profiles.length;
        profiles = profiles.slice(offset, offset + limit);
      } else {
        const { data, error, count } = await supabase
          .from("profiles")
          .select(profileSelect, { count: "exact" })
          .order("created_at", { ascending: false })
          .range(offset, offset + limit - 1);

        if (error) {
          throw Object.assign(new Error(error.message), { statusCode: 500 });
        }

        profiles = data || [];
        total = count ?? profiles.length;
      }

      const userIds = profiles.map((p) => String(p.user_id));

      const [{ data: roles }, emailById] = await Promise.all([
        supabase
          .from("user_roles")
          .select("user_id, role")
          .in(
            "user_id",
            userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"],
          ),
        fetchEmailsForUserIds(supabase, userIds),
      ]);

      /** @type {Map<string, string[]>} */
      const rolesByUser = new Map();
      for (const row of roles || []) {
        const uid = String(row.user_id);
        const list = rolesByUser.get(uid) || [];
        list.push(String(row.role));
        rolesByUser.set(uid, list);
      }

      const users = profiles.map((p) => {
        const uid = String(p.user_id);
        const platformRoles = rolesByUser.get(uid) || [];
        const primaryRole = resolvePrimaryPlatformRole(platformRoles);
        return {
          user_id: uid,
          email: emailById.get(uid) ?? null,
          full_name: p.full_name ?? null,
          company_name: p.company_name ?? null,
          job_title: p.job_title ?? null,
          access_status: p.access_status ?? "active",
          created_at: p.created_at,
          platform_roles: platformRoles,
          platform_role: primaryRole,
          platform_admin:
            primaryRole === "admin" || primaryRole === "super_admin",
          super_admin: primaryRole === "super_admin",
        };
      });

      res.json({
        users,
        pagination: {
          limit,
          offset,
          total,
        },
      });
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.get("/api/admin/v1/access/users/:id/effective", async (req, res) => {
    try {
      const userId = String(req.params.id || "").trim();
      if (!userId) {
        return res.status(400).json({
          error: "INVALID_ID",
          message: "User id required",
        });
      }

      const [effective, email, profileRes] = await Promise.all([
        computeEffectivePermissions(supabase, userId),
        fetchEmailForUserId(supabase, userId),
        supabase
          .from("profiles")
          .select("full_name, company_name, job_title")
          .eq("user_id", userId)
          .maybeSingle(),
      ]);

      const profile = profileRes.data ?? null;

      /** @type {Array<{ credential_id?: string }>} */
      const grantRows = Array.isArray(effective.credential_grants)
        ? effective.credential_grants
        : [];
      const credentialIds = grantRows
        .map((row) => (row?.credential_id != null ? String(row.credential_id) : ""))
        .filter(Boolean);

      /** @type {Map<string, { jurisdiction: string | null, portal_username: string | null }>} */
      const credentialMetaById = new Map();
      if (credentialIds.length > 0) {
        const { data: credentialRows } = await supabase
          .from("portal_credentials")
          .select("id, jurisdiction, portal_username")
          .in("id", credentialIds);

        for (const row of credentialRows || []) {
          credentialMetaById.set(String(row.id), {
            jurisdiction: row.jurisdiction ?? null,
            portal_username: row.portal_username ?? null,
          });
        }
      }

      const credential_grants = grantRows.map((row) => {
        const credentialId = String(row.credential_id || "");
        const meta = credentialMetaById.get(credentialId);
        return {
          ...row,
          jurisdiction: row.jurisdiction ?? meta?.jurisdiction ?? null,
          portal_username: meta?.portal_username ?? null,
        };
      });

      res.json({
        ...effective,
        email,
        full_name: profile?.full_name ?? null,
        company_name: profile?.company_name ?? null,
        job_title: profile?.job_title ?? null,
        credential_grants,
      });
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/api/admin/v1/access/users/:id/activate", async (req, res) => {
    try {
      const actor = req.platformAdminUser;
      const userId = String(req.params.id || "").trim();
      const reason = String(req.body?.reason || "").trim() || null;

      if (!userId) {
        return res.status(400).json({ error: "INVALID_ID", message: "User id required" });
      }

      const [actorRole, targetRole] = await Promise.all([
        getActorPlatformRoleLevel(supabase, actor.id),
        getUserPlatformRoleLevel(supabase, userId),
      ]);
      const lifecycle = assertCanManageUserLifecycle({
        actorRole,
        targetRole,
        actorId: actor.id,
        targetId: userId,
      });
      if (!lifecycle.allowed) {
        return res.status(403).json({
          error: lifecycle.code,
          message: lifecycle.message,
        });
      }

      const { error: authErr } = await supabase.auth.admin.updateUserById(userId, {
        ban_duration: "none",
      });

      if (authErr) {
        throw Object.assign(new Error(authErr.message), { statusCode: 500 });
      }

      const { error: rpcErr } = await supabase.rpc("admin_activate_user", {
        p_user_id: userId,
        p_reason: reason,
      });

      if (rpcErr) {
        const { error: profileErr } = await supabase
          .from("profiles")
          .update({ access_status: "active" })
          .eq("user_id", userId);

        if (profileErr) {
          throw Object.assign(new Error(rpcErr.message || profileErr.message), {
            statusCode: 500,
          });
        }

        await appendAuditEvent(supabase, {
          actor_id: actor.id,
          action: "admin.user.reactivated",
          target_type: "user",
          target_id: userId,
          after_json: { access_status: "active", reason },
        });
      }

      res.json({ ok: true, user_id: userId, access_status: "active" });
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/api/admin/v1/access/users/:id/deactivate", async (req, res) => {
    try {
      const actor = req.platformAdminUser;
      const userId = String(req.params.id || "").trim();
      const reason = String(req.body?.reason || "").trim() || null;

      if (!userId) {
        return res.status(400).json({ error: "INVALID_ID", message: "User id required" });
      }

      const [actorRole, targetRole] = await Promise.all([
        getActorPlatformRoleLevel(supabase, actor.id),
        getUserPlatformRoleLevel(supabase, userId),
      ]);
      const lifecycle = assertCanManageUserLifecycle({
        actorRole,
        targetRole,
        actorId: actor.id,
        targetId: userId,
      });
      if (!lifecycle.allowed) {
        const statusCode =
          lifecycle.code === "SELF_ACTION_BLOCKED" ? 400 : 403;
        return res.status(statusCode).json({
          error: lifecycle.code,
          message: lifecycle.message,
        });
      }

      if (targetRole === "super_admin") {
        const superCount = await countActiveSuperAdmins(supabase);
        if (superCount <= 1) {
          return res.status(409).json({
            error: "LAST_SUPER_ADMIN_BLOCKED",
            message: "Cannot deactivate the last super admin",
          });
        }
      }

      const { error: authErr } = await supabase.auth.admin.updateUserById(userId, {
        ban_duration: "876000h",
      });

      if (authErr) {
        throw Object.assign(new Error(authErr.message), { statusCode: 500 });
      }

      const { error: rpcErr } = await supabase.rpc("admin_deactivate_user", {
        p_user_id: userId,
        p_reason: reason,
      });

      if (rpcErr) {
        await supabase
          .from("profiles")
          .update({ access_status: "deactivated" })
          .eq("user_id", userId);

        await supabase
          .from("user_portal_credential_grants")
          .update({ grant_level: "none" })
          .eq("user_id", userId);

        await appendAuditEvent(supabase, {
          actor_id: actor.id,
          action: "admin.user.deactivated",
          target_type: "user",
          target_id: userId,
          after_json: { access_status: "deactivated", reason },
        });
      }

      res.json({ ok: true, user_id: userId, access_status: "deactivated" });
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/api/admin/v1/access/users/:id/platform-role", async (req, res) => {
    try {
      const actor = req.platformAdminUser;
      const userId = String(req.params.id || "").trim();
      const action = String(req.body?.action || "").trim().toLowerCase();

      if (!userId) {
        return res.status(400).json({ error: "INVALID_ID", message: "User id required" });
      }

      const allowedActions = new Set([
        "grant",
        "revoke",
        "revoke-admin",
        "promote-to-admin",
        "promote-to-super-admin",
        "demote-super-admin",
      ]);
      if (!allowedActions.has(action)) {
        return res.status(400).json({
          error: "INVALID_ACTION",
          message:
            "action must be grant, revoke, revoke-admin, promote-to-admin, promote-to-super-admin, or demote-super-admin",
        });
      }

      const normalizedAction =
        action === "grant" || action === "promote-to-admin"
          ? "promote-to-admin"
          : action === "revoke" || action === "revoke-admin"
            ? "revoke-admin"
            : action;

      const [actorRole, targetRoles] = await Promise.all([
        getActorPlatformRoleLevel(supabase, actor.id),
        fetchUserRoleNames(supabase, userId),
      ]);
      const previousRole = resolvePrimaryPlatformRole(targetRoles);

      if (String(actor.id) === userId) {
        return res.status(400).json({
          error: "SELF_ROLE_CHANGE_BLOCKED",
          message: "Cannot change your own admin role",
        });
      }

      const superRequired = assertSuperAdminActor({ actorRole });
      if (!superRequired.allowed) {
        return res.status(403).json({
          error: superRequired.code,
          message: superRequired.message,
        });
      }

      if (normalizedAction === "promote-to-admin") {
        if (previousRole !== "user") {
          return res.status(400).json({
            error: "INVALID_TARGET_ROLE",
            message: "Target user is already an admin",
          });
        }

        const { error } = await supabase.from("user_roles").upsert(
          { user_id: userId, role: "admin" },
          { onConflict: "user_id,role" },
        );
        if (error) {
          throw Object.assign(new Error(error.message), { statusCode: 500 });
        }

        await appendAuditEvent(supabase, {
          actor_id: actor.id,
          action: "admin.role.granted",
          target_type: "user",
          target_id: userId,
          before_json: { previous_role: previousRole },
          after_json: { new_role: "admin" },
        });

        return res.json({
          ok: true,
          user_id: userId,
          platform_role: "admin",
          platform_admin: true,
        });
      }

      if (normalizedAction === "promote-to-super-admin") {
        if (previousRole === "super_admin") {
          return res.status(400).json({
            error: "INVALID_TARGET_ROLE",
            message: "Target user is already a super admin",
          });
        }

        const { error } = await supabase.from("user_roles").upsert(
          { user_id: userId, role: "super_admin" },
          { onConflict: "user_id,role" },
        );
        if (error) {
          throw Object.assign(new Error(error.message), { statusCode: 500 });
        }

        await appendAuditEvent(supabase, {
          actor_id: actor.id,
          action: "super_admin.granted",
          target_type: "user",
          target_id: userId,
          before_json: { previous_role: previousRole },
          after_json: { new_role: "super_admin" },
        });

        return res.json({
          ok: true,
          user_id: userId,
          platform_role: "super_admin",
          platform_admin: true,
          super_admin: true,
        });
      }

      if (normalizedAction === "demote-super-admin") {
        if (previousRole !== "super_admin") {
          return res.status(400).json({
            error: "INVALID_TARGET_ROLE",
            message: "Target user is not a super admin",
          });
        }

        const superCount = await countActiveSuperAdmins(supabase);
        if (superCount <= 1) {
          return res.status(409).json({
            error: "LAST_SUPER_ADMIN_BLOCKED",
            message: "Cannot demote the last super admin",
          });
        }

        const { error } = await supabase
          .from("user_roles")
          .delete()
          .eq("user_id", userId)
          .eq("role", "super_admin");

        if (error) {
          throw Object.assign(new Error(error.message), { statusCode: 500 });
        }

        const newRole = targetRoles.includes("admin") ? "admin" : "user";

        await appendAuditEvent(supabase, {
          actor_id: actor.id,
          action: "super_admin.revoked",
          target_type: "user",
          target_id: userId,
          before_json: { previous_role: "super_admin" },
          after_json: { new_role: newRole },
        });

        return res.json({
          ok: true,
          user_id: userId,
          platform_role: newRole,
          platform_admin: newRole !== "user",
          super_admin: false,
        });
      }

      // revoke-admin
      if (previousRole === "user") {
        return res.status(400).json({
          error: "INVALID_TARGET_ROLE",
          message: "Target user is not a platform admin",
        });
      }

      if (previousRole === "super_admin") {
        return res.status(400).json({
          error: "INVALID_TARGET_ROLE",
          message: "Use demote-super-admin for super admins",
        });
      }

      const { error } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", userId)
        .eq("role", "admin");

      if (error) {
        throw Object.assign(new Error(error.message), { statusCode: 500 });
      }

      await appendAuditEvent(supabase, {
        actor_id: actor.id,
        action: "admin.role.revoked",
        target_type: "user",
        target_id: userId,
        before_json: { previous_role: "admin" },
        after_json: { new_role: "user" },
      });

      return res.json({
        ok: true,
        user_id: userId,
        platform_role: "user",
        platform_admin: false,
      });
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.put(
    "/api/admin/v1/access/users/:id/projects/:projectId/role",
    async (req, res) => {
      try {
        const actor = req.platformAdminUser;
        const userId = String(req.params.id || "").trim();
        const projectId = String(req.params.projectId || "").trim();

        if (!userId || !projectId) {
          return res.status(400).json({
            error: "INVALID_PARAMS",
            message: "User id and project id required",
          });
        }

        const accessLevelRaw = String(req.body?.access_level || "").trim().toLowerCase();
        const role = String(req.body?.role || "").trim().toLowerCase();

        /** @type {"default"|"none"|"read"|"write"} */
        let accessLevel = "default";

        if (accessLevelRaw) {
          const allowed = new Set(["default", "none", "read", "write"]);
          if (!allowed.has(accessLevelRaw)) {
            return res.status(400).json({
              error: "INVALID_ACCESS_LEVEL",
              message: "access_level must be default, none, read, or write",
            });
          }
          accessLevel = /** @type {"default"|"none"|"read"|"write"} */ (accessLevelRaw);
        } else if (role) {
          const legacyMap = {
            none: "none",
            viewer: "read",
            editor: "write",
            admin: "write",
            default: "default",
            inherit: "default",
          };
          if (!(role in legacyMap)) {
            return res.status(400).json({
              error: "INVALID_ROLE",
              message: "role must be none, viewer, editor, admin, default, or inherit",
            });
          }
          accessLevel = /** @type {"default"|"none"|"read"|"write"} */ (legacyMap[role]);
        } else {
          return res.status(400).json({
            error: "INVALID_BODY",
            message: "access_level or role required",
          });
        }

        if (accessLevel === "default") {
          const { error } = await supabase
            .from("user_project_access_overrides")
            .delete()
            .eq("user_id", userId)
            .eq("project_id", projectId);

          if (error) {
            throw Object.assign(new Error(error.message), { statusCode: 500 });
          }
        } else {
          const { error } = await supabase.from("user_project_access_overrides").upsert(
            {
              user_id: userId,
              project_id: projectId,
              access_level: accessLevel,
              granted_by: actor.id,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id,project_id" },
          );

          if (error) {
            throw Object.assign(new Error(error.message), { statusCode: 500 });
          }
        }

        await appendAuditEvent(supabase, {
          actor_id: actor.id,
          action: "project_access.changed",
          target_type: "user",
          target_id: userId,
          project_id: projectId,
          after_json: { access_level: accessLevel },
        });

        res.json({ ok: true, user_id: userId, project_id: projectId, access_level: accessLevel });
      } catch (err) {
        const s = sanitizeUciError(err);
        res.status(s.httpStatus).json(s.body);
      }
    },
  );

  router.put("/api/admin/v1/access/users/:id/features", async (req, res) => {
    try {
      const actor = req.platformAdminUser;
      const userId = String(req.params.id || "").trim();
      const items = Array.isArray(req.body?.features) ? req.body.features : req.body;

      if (!userId) {
        return res.status(400).json({ error: "INVALID_ID", message: "User id required" });
      }

      if (!Array.isArray(items)) {
        return res.status(400).json({
          error: "INVALID_BODY",
          message: "features array required",
        });
      }

      /** @type {unknown[]} */
      const results = [];

      for (const item of items) {
        const row = item && typeof item === "object" ? item : {};
        const projectId = row.project_id ?? null;
        const featureKey = String(row.feature_key || "").trim();
        const accessLevel = String(row.access_level || "").trim();
        const reset =
          row.reset === true || accessLevel === "inherit" || accessLevel === "default";

        if (!featureKey) {
          results.push({ feature_key: featureKey, ok: false, error: "invalid_row" });
          continue;
        }

        if (reset) {
          const { error: rpcErr } = await supabase.rpc("admin_delete_feature_permission", {
            p_user_id: userId,
            p_project_id: projectId,
            p_feature_key: featureKey,
          });

          if (rpcErr) {
            let deleteQuery = supabase
              .from("user_feature_permissions")
              .delete()
              .eq("user_id", userId)
              .eq("feature_key", featureKey);
            deleteQuery =
              projectId == null
                ? deleteQuery.is("project_id", null)
                : deleteQuery.eq("project_id", projectId);
            const { error } = await deleteQuery;

            if (error) {
              results.push({ feature_key: featureKey, ok: false, error: error.message });
              continue;
            }

            await appendAuditEvent(supabase, {
              actor_id: actor.id,
              action: "feature_permission.changed",
              target_type: "user",
              target_id: userId,
              project_id: projectId,
              feature_key: featureKey,
              after_json: { reset: true },
            });
          }

          results.push({ feature_key: featureKey, ok: true, reset: true });
          continue;
        }

        if (!["none", "read", "write"].includes(accessLevel)) {
          results.push({ feature_key: featureKey, ok: false, error: "invalid_row" });
          continue;
        }

        const { error: rpcErr } = await supabase.rpc("admin_set_feature_permission", {
          p_user_id: userId,
          p_project_id: projectId,
          p_feature_key: featureKey,
          p_access_level: accessLevel,
        });

        if (rpcErr) {
          const { error } = await supabase.from("user_feature_permissions").upsert(
            {
              user_id: userId,
              project_id: projectId,
              feature_key: featureKey,
              access_level: accessLevel,
              granted_by: actor.id,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id,project_id,feature_key" },
          );

          if (error) {
            results.push({ feature_key: featureKey, ok: false, error: error.message });
            continue;
          }

          await appendAuditEvent(supabase, {
            actor_id: actor.id,
            action: "feature_permission.changed",
            target_type: "user",
            target_id: userId,
            project_id: projectId,
            feature_key: featureKey,
            after_json: { access_level: accessLevel },
          });
        }

        results.push({ feature_key: featureKey, ok: true, access_level: accessLevel });
      }

      res.json({ ok: true, user_id: userId, results });
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.put(
    "/api/admin/v1/access/users/:id/scraped-data-scope",
    async (req, res) => {
      try {
        const actor = req.platformAdminUser;
        const userId = String(req.params.id || "").trim();
        const scopes = Array.isArray(req.body?.scopes) ? req.body.scopes : req.body;

        if (!userId) {
          return res.status(400).json({ error: "INVALID_ID", message: "User id required" });
        }

        if (!Array.isArray(scopes)) {
          return res.status(400).json({
            error: "INVALID_BODY",
            message: "scopes array required",
          });
        }

        await supabase.from("user_scraped_data_scope").delete().eq("user_id", userId);

        /** @type {unknown[]} */
        const inserted = [];
        let usedFallback = false;

        for (const item of scopes) {
          const row = item && typeof item === "object" ? item : {};
          const scopeType = String(row.scope_type || "").trim();
          const scopeRef = String(row.scope_ref || "").trim();

          if (!scopeType || !scopeRef) {
            continue;
          }

          const { error: rpcErr } = await supabase.rpc("admin_set_scraped_data_scope", {
            p_user_id: userId,
            p_scope_type: scopeType,
            p_scope_ref: scopeRef,
          });

          if (rpcErr) {
            usedFallback = true;
            const { data, error } = await supabase
              .from("user_scraped_data_scope")
              .insert({
                user_id: userId,
                scope_type: scopeType,
                scope_ref: scopeRef,
                granted_by: actor.id,
              })
              .select("*")
              .single();

            if (error) {
              continue;
            }
            inserted.push(data);
          } else {
            inserted.push({ scope_type: scopeType, scope_ref: scopeRef });
          }
        }

        if (usedFallback) {
          await appendAuditEvent(supabase, {
            actor_id: actor.id,
            action: "scraped_data_scope.changed",
            target_type: "user",
            target_id: userId,
            after_json: { scopes: inserted },
          });
        }

        res.json({ ok: true, user_id: userId, scopes: inserted });
      } catch (err) {
        const s = sanitizeUciError(err);
        res.status(s.httpStatus).json(s.body);
      }
    },
  );

  router.put(
    "/api/admin/v1/access/users/:id/credential-grants",
    async (req, res) => {
      try {
        const actor = req.platformAdminUser;
        const userId = String(req.params.id || "").trim();
        const grants = Array.isArray(req.body?.grants) ? req.body.grants : req.body;

        if (!userId) {
          return res.status(400).json({ error: "INVALID_ID", message: "User id required" });
        }

        if (!Array.isArray(grants)) {
          return res.status(400).json({
            error: "INVALID_BODY",
            message: "grants array required",
          });
        }

        /** @type {unknown[]} */
        const results = [];

        for (const item of grants) {
          const row = item && typeof item === "object" ? item : {};
          const credentialId = String(row.credential_id || "").trim();
          const grantLevelRaw = String(row.grant_level || "").trim().toLowerCase();
          const reset =
            row.reset === true ||
            grantLevelRaw === "default" ||
            grantLevelRaw === "inherit";

          if (!credentialId) {
            results.push({ credential_id: credentialId, ok: false });
            continue;
          }

          if (reset) {
            const { error } = await supabase
              .from("user_portal_credential_grants")
              .delete()
              .eq("user_id", userId)
              .eq("credential_id", credentialId);

            if (error) {
              results.push({ credential_id: credentialId, ok: false, error: error.message });
              continue;
            }

            await appendAuditEvent(supabase, {
              actor_id: actor.id,
              action: "credential_grant.revoked",
              target_type: "user",
              target_id: userId,
              after_json: { credential_id: credentialId, grant_level: "default" },
            });

            results.push({ credential_id: credentialId, ok: true, grant_level: "default" });
            continue;
          }

          const grantLevel = grantLevelRaw;

          if (!["none", "use", "manage"].includes(grantLevel)) {
            results.push({ credential_id: credentialId, ok: false });
            continue;
          }

          const { error: rpcErr } = await supabase.rpc("admin_set_credential_grant", {
            p_user_id: userId,
            p_credential_id: credentialId,
            p_grant_level: grantLevel,
            p_project_id: row.project_id ?? null,
            p_jurisdiction: row.jurisdiction ?? null,
          });

          if (rpcErr) {
            const { error } = await supabase
              .from("user_portal_credential_grants")
              .upsert(
                {
                  user_id: userId,
                  credential_id: credentialId,
                  grant_level: grantLevel,
                  project_id: row.project_id ?? null,
                  jurisdiction: row.jurisdiction ?? null,
                  granted_by: actor.id,
                  updated_at: new Date().toISOString(),
                },
                { onConflict: "user_id,credential_id" },
              );

            if (error) {
              results.push({
                credential_id: credentialId,
                ok: false,
                error: error.message,
              });
              continue;
            }

            await appendAuditEvent(supabase, {
              actor_id: actor.id,
              action:
                grantLevel === "none"
                  ? "credential_grant.revoked"
                  : "credential_grant.changed",
              target_type: "user",
              target_id: userId,
              after_json: {
                credential_id: credentialId,
                grant_level: grantLevel,
              },
            });
          }

          results.push({
            credential_id: credentialId,
            ok: true,
            grant_level: grantLevel,
          });
        }

        res.json({ ok: true, user_id: userId, results });
      } catch (err) {
        const s = sanitizeUciError(err);
        res.status(s.httpStatus).json(s.body);
      }
    },
  );

  router.post(
    "/api/admin/v1/access/users/:id/copy-from/:sourceId",
    async (req, res) => {
      try {
        const actor = req.platformAdminUser;
        const userId = String(req.params.id || "").trim();
        const sourceId = String(req.params.sourceId || "").trim();

        if (!userId || !sourceId) {
          return res.status(400).json({
            error: "INVALID_PARAMS",
            message: "Target and source user ids required",
          });
        }

        const { error: rpcErr } = await supabase.rpc("admin_copy_permissions", {
          p_from_user_id: sourceId,
          p_to_user_id: userId,
        });

        if (rpcErr) {
          throw Object.assign(new Error(rpcErr.message), { statusCode: 500 });
        }

        res.json({ ok: true, user_id: userId, source_user_id: sourceId });
      } catch (err) {
        const s = sanitizeUciError(err);
        res.status(s.httpStatus).json(s.body);
      }
    },
  );

  router.get("/api/admin/v1/access/export", async (req, res) => {
    try {
      const { data: profiles, error } = await supabase
        .from("profiles")
        .select("user_id, full_name, company_name, access_status, created_at")
        .order("created_at", { ascending: false });

      if (error) {
        throw Object.assign(new Error(error.message), { statusCode: 500 });
      }

      const rows = (profiles || []).map((p) => ({
        user_id: String(p.user_id),
        full_name: p.full_name ?? "",
        company_name: p.company_name ?? "",
        access_status: p.access_status ?? "active",
        created_at: p.created_at ?? "",
      }));

      const csv = toCsv(rows, [
        "user_id",
        "full_name",
        "company_name",
        "access_status",
        "created_at",
      ]);

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="access-export.csv"',
      );
      res.send(csv);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.get("/api/admin/v1/audit/events", async (req, res) => {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
      const cursor = req.query.cursor ? String(req.query.cursor) : null;
      const action = req.query.action ? String(req.query.action) : null;

      const { data, error } = await supabase.rpc("admin_list_audit_events", {
        p_limit: limit,
        p_action: action || null,
      });

      if (!error && data) {
        return res.json(data);
      }

      let query = supabase
        .from("platform_audit_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (action) {
        query = query.eq("action", action);
      }

      if (cursor) {
        query = query.lt("created_at", cursor);
      }

      const { data: events, error: listErr } = await query;

      if (listErr) {
        throw Object.assign(new Error(listErr.message), { statusCode: 500 });
      }

      res.json({ events: events || [], pagination: { limit, cursor } });
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.get("/api/admin/v1/audit/export", async (req, res) => {
    try {
      const from = req.query.from ? String(req.query.from) : null;
      const to = req.query.to ? String(req.query.to) : null;

      let query = supabase
        .from("platform_audit_events")
        .select(
          "id, created_at, actor_id, action, target_type, target_id, project_id, feature_key, result",
        )
        .order("created_at", { ascending: false })
        .limit(5000);

      if (from) {
        query = query.gte("created_at", from);
      }
      if (to) {
        query = query.lte("created_at", to);
      }

      const { data: events, error } = await query;

      if (error) {
        throw Object.assign(new Error(error.message), { statusCode: 500 });
      }

      const rows = (events || []).map((e) => ({
        id: String(e.id),
        created_at: e.created_at ?? "",
        actor_id: e.actor_id ?? "",
        action: e.action ?? "",
        target_type: e.target_type ?? "",
        target_id: e.target_id ?? "",
        project_id: e.project_id ?? "",
        feature_key: e.feature_key ?? "",
        result: e.result ?? "",
      }));

      const csv = toCsv(rows, [
        "id",
        "created_at",
        "actor_id",
        "action",
        "target_type",
        "target_id",
        "project_id",
        "feature_key",
        "result",
      ]);

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="audit-export.csv"',
      );
      res.send(csv);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  return router;
}

module.exports = {
  createAdminRouter,
};
