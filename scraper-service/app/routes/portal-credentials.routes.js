"use strict";

const express = require("express");
const {
  requireAuthenticatedUser,
  sanitizeUciError,
} = require("../services/uci/uci-access.service.js");
const {
  encryptPortalPasswordIfConfigured,
  passwordFieldIsConfigured,
} = require("../services/portal-credentials/portal-credentials-crypto.js");
const {
  assertCredentialGrant,
  appendAuditEvent,
  isUserActive,
  isPlatformAdmin,
  portalCredentialCanonicalKey,
  pickCanonicalPortalCredential,
  groupPortalCredentialsByCanonical,
  resolveExplicitGrantForCredentialGroup,
} = require("../services/governance/governance.service.js");
const {
  resolveDefaultCredentialGrantLevel,
} = require("../services/governance/governance.constants.js");

/** DB requires permit_number NOT NULL — Settings-created rows use this sentinel. */
const SETTINGS_PERMIT_SENTINEL = "SETTINGS";

/**
 * Find an existing credential matching jurisdiction + username (case-insensitive).
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} jurisdiction
 * @param {string} portalUsername
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function findExistingPortalCredential(supabase, jurisdiction, portalUsername) {
  const canonicalKey = portalCredentialCanonicalKey(jurisdiction, portalUsername);
  const { data, error } = await supabase
    .from("portal_credentials")
    .select("id, jurisdiction, portal_username, created_at, user_id, login_url, permit_number, project_id")
    .order("created_at", { ascending: true });

  if (error || !Array.isArray(data)) {
    return null;
  }

  const groups = groupPortalCredentialsByCanonical(data);
  const group = groups.get(canonicalKey);
  if (!group || group.length === 0) {
    return null;
  }

  return pickCanonicalPortalCredential(group);
}

function sanitizeRow(row) {
  const r = row && typeof row === "object" ? row : {};
  return {
    id: String(r.id),
    user_id: String(r.user_id),
    jurisdiction: r.jurisdiction,
    portal_username: r.portal_username,
    login_url: r.login_url ?? null,
    permit_number: r.permit_number ?? null,
    project_id: r.project_id ?? null,
    created_at: r.created_at,
    password_configured: passwordFieldIsConfigured(r.portal_password),
    grant_level: r.grant_level ?? null,
  };
}

/**
 * Effective level for one canonical credential group.
 * Same rules as resolveCredentialGrant, applied to the explicit grant
 * resolveExplicitGrantForCredentialGroup finds anywhere in the group
 * (including a newer duplicate). Missing grant uses resolveDefaultCredentialGrantLevel.
 *
 * @param {string | null} explicitLevel
 * @param {"use"|"manage"|"none"} defaultLevel
 * @returns {"use"|"manage"|"none"}
 */
function effectiveGrantForCanonicalGroup(explicitLevel, defaultLevel) {
  if (!explicitLevel) {
    return defaultLevel;
  }
  if (
    explicitLevel === "use" ||
    explicitLevel === "manage" ||
    explicitLevel === "none"
  ) {
    return explicitLevel;
  }
  return "none";
}

/**
 * Settings list: canonical credentials the caller can use under the
 * default-plus-override model. Does not insert grant rows.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} userId
 * @returns {Promise<Array<ReturnType<typeof sanitizeRow>>>}
 */
async function listVisiblePortalCredentials(supabase, userId) {
  if (!(await isUserActive(supabase, userId))) {
    return [];
  }

  const platformAdmin = await isPlatformAdmin(supabase, userId);
  const defaultLevel = resolveDefaultCredentialGrantLevel(platformAdmin);

  const { data: credentials, error: credErr } = await supabase
    .from("portal_credentials")
    .select(
      "id, user_id, jurisdiction, portal_username, login_url, permit_number, project_id, created_at, portal_password",
    )
    .order("created_at", { ascending: true });

  if (credErr) {
    throw Object.assign(new Error(credErr.message), {
      cause: credErr,
      statusCode: 500,
    });
  }

  const { data: grants, error: grantErr } = await supabase
    .from("user_portal_credential_grants")
    .select("grant_level, credential_id")
    .eq("user_id", userId);

  if (grantErr) {
    throw Object.assign(new Error(grantErr.message), {
      cause: grantErr,
      statusCode: 500,
    });
  }

  /** @type {Map<string, Record<string, unknown>>} */
  const grantByCredential = new Map();
  for (const row of grants || []) {
    if (!row || row.credential_id == null) continue;
    grantByCredential.set(String(row.credential_id), row);
  }

  const groups = groupPortalCredentialsByCanonical(credentials || []);
  /** @type {Array<ReturnType<typeof sanitizeRow>>} */
  const rows = [];

  for (const group of groups.values()) {
    const credential = pickCanonicalPortalCredential(group);
    const groupIds = group.map((row) => String(row.id));
    const explicit = resolveExplicitGrantForCredentialGroup(
      groupIds,
      grantByCredential,
    );
    const explicitLevel = explicit ? String(explicit.grant_level || "none") : null;
    const effectiveGrant = effectiveGrantForCanonicalGroup(
      explicitLevel,
      defaultLevel,
    );

    if (effectiveGrant === "none") {
      continue;
    }

    rows.push(
      sanitizeRow({
        ...credential,
        grant_level: effectiveGrant,
      }),
    );
  }

  rows.sort((a, b) => {
    const byJurisdiction = String(a.jurisdiction || "").localeCompare(
      String(b.jurisdiction || ""),
    );
    if (byJurisdiction !== 0) return byJurisdiction;
    return String(a.portal_username || "").localeCompare(
      String(b.portal_username || ""),
    );
  });

  return rows;
}

/**
 * @param {{ supabase: import("@supabase/supabase-js").SupabaseClient }} opts
 */
function createPortalCredentialsRouter(opts) {
  const { supabase } = opts;
  const router = express.Router();

  router.get("/api/portal-credentials", async (req, res) => {
    try {
      let user;
      try {
        user = await requireAuthenticatedUser(req, supabase);
      } catch (authErr) {
        if (authErr && authErr.code === "USER_DEACTIVATED") {
          res.json([]);
          return;
        }
        throw authErr;
      }

      const rows = await listVisiblePortalCredentials(supabase, user.id);
      res.json(rows);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/api/portal-credentials", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const body = req.body || {};
      const jurisdiction = String(body.jurisdiction ?? "").trim();
      const portalUsername = String(body.portal_username ?? "").trim();
      const portalPassword = String(body.portal_password ?? "");

      if (!jurisdiction || !portalUsername || !portalPassword.trim()) {
        return res.status(400).json({
          error: "INVALID_BODY",
          message:
            "jurisdiction, portal_username, and portal_password are required.",
        });
      }

      const loginUrl =
        typeof body.login_url === "string"
          ? String(body.login_url).trim()
          : "https://washington-dc-us.avolvecloud.com/User/Index";

      let permit_number = String(
        body.permit_number ?? SETTINGS_PERMIT_SENTINEL,
      ).trim();
      if (!permit_number) permit_number = SETTINGS_PERMIT_SENTINEL;

      const encryptedOrPlain = encryptPortalPasswordIfConfigured(
        portalPassword.trim(),
      );

      const existing = await findExistingPortalCredential(
        supabase,
        jurisdiction,
        portalUsername,
      );

      let data;
      let created = false;

      if (existing) {
        const { data: updated, error: updateErr } = await supabase
          .from("portal_credentials")
          .update({
            portal_password: encryptedOrPlain,
            login_url: loginUrl,
            permit_number,
          })
          .eq("id", String(existing.id))
          .select("*")
          .single();

        if (updateErr) {
          throw Object.assign(new Error(updateErr.message), {
            cause: updateErr,
            statusCode: 500,
          });
        }

        data = updated;
      } else {
        const insertPayload = {
          user_id: user.id,
          jurisdiction,
          portal_username: portalUsername,
          portal_password: encryptedOrPlain,
          login_url: loginUrl,
          permit_number,
        };

        if (body.project_id != null && String(body.project_id).trim() !== "") {
          insertPayload.project_id = String(body.project_id).trim();
        }

        const { data: inserted, error } = await supabase
          .from("portal_credentials")
          .insert(insertPayload)
          .select("*")
          .single();

        if (error) {
          throw Object.assign(new Error(error.message), {
            cause: error,
            statusCode: 500,
          });
        }

        data = inserted;
        created = true;
      }

      const { error: grantErr } = await supabase
        .from("user_portal_credential_grants")
        .upsert(
          {
            user_id: user.id,
            credential_id: data.id,
            grant_level: "manage",
            project_id: data.project_id ?? null,
            jurisdiction: data.jurisdiction ?? null,
            granted_by: user.id,
          },
          { onConflict: "user_id,credential_id" },
        );

      if (grantErr) {
        throw Object.assign(new Error(grantErr.message), {
          cause: grantErr,
          statusCode: 500,
        });
      }

      await appendAuditEvent(supabase, {
        actor_id: user.id,
        action: created ? "credential.manage.created" : "credential.manage.reused",
        target_type: "credential",
        target_id: String(data.id),
        after_json: {
          jurisdiction: data.jurisdiction,
          portal_username: data.portal_username,
          reused_existing: !created,
        },
      });

      res.status(created ? 201 : 200).json(sanitizeRow({ ...data, grant_level: "manage" }));
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.patch("/api/portal-credentials/:id", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const id = String(req.params.id || "").trim();
      if (!id) {
        return res.status(400).json({
          error: "INVALID_ID",
          message: "Credential id required.",
        });
      }

      await assertCredentialGrant({
        supabase,
        userId: user.id,
        credentialId: id,
        requiredLevel: "manage",
      });

      const { data: existing, error: exErr } = await supabase
        .from("portal_credentials")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (exErr) {
        throw Object.assign(new Error(exErr.message), { statusCode: 500 });
      }
      if (!existing) {
        return res.status(404).json({
          error: "NOT_FOUND",
          message: "Credential not found.",
        });
      }

      const body = req.body || {};

      /** @type {Record<string, unknown>} */
      const patch = {};

      if (typeof body.jurisdiction === "string" && body.jurisdiction.trim()) {
        patch.jurisdiction = body.jurisdiction.trim();
      }
      if (
        typeof body.portal_username === "string" &&
        body.portal_username.trim()
      ) {
        patch.portal_username = body.portal_username.trim();
      }
      if (typeof body.login_url === "string") {
        patch.login_url = body.login_url.trim();
      }

      if (typeof body.permit_number === "string" && body.permit_number.trim()) {
        patch.permit_number = body.permit_number.trim();
      }

      if (body.project_id === null || body.project_id === "") {
        patch.project_id = null;
      } else if (body.project_id != null) {
        patch.project_id = String(body.project_id).trim();
      }

      if (Object.prototype.hasOwnProperty.call(body, "portal_password")) {
        const raw = body.portal_password;
        if (raw != null && String(raw).trim() !== "") {
          patch.portal_password = encryptPortalPasswordIfConfigured(
            String(raw).trim(),
          );
        }
      }

      if (Object.keys(patch).length === 0) {
        return res.status(400).json({
          error: "NO_FIELDS",
          message: "Nothing to update.",
        });
      }

      const { data, error } = await supabase
        .from("portal_credentials")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single();

      if (error) {
        throw Object.assign(new Error(error.message), {
          cause: error,
          statusCode: 500,
        });
      }

      res.json(sanitizeRow(data));
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.delete("/api/portal-credentials/:id", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const id = String(req.params.id || "").trim();
      if (!id) {
        return res.status(400).json({
          error: "INVALID_ID",
          message: "Credential id required.",
        });
      }

      await assertCredentialGrant({
        supabase,
        userId: user.id,
        credentialId: id,
        requiredLevel: "manage",
      });

      const { error } = await supabase
        .from("portal_credentials")
        .delete()
        .eq("id", id);

      if (error) {
        throw Object.assign(new Error(error.message), {
          cause: error,
          statusCode: 500,
        });
      }

      await supabase
        .from("user_portal_credential_grants")
        .update({ grant_level: "none" })
        .eq("credential_id", id);

      res.status(204).send();
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  return router;
}

module.exports = {
  createPortalCredentialsRouter,
  listVisiblePortalCredentials,
};
