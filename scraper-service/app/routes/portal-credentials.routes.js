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
} = require("../services/governance/governance.service.js");

/** DB requires permit_number NOT NULL — Settings-created rows use this sentinel. */
const SETTINGS_PERMIT_SENTINEL = "SETTINGS";

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
 * @param {{ supabase: import("@supabase/supabase-js").SupabaseClient }} opts
 */
function createPortalCredentialsRouter(opts) {
  const { supabase } = opts;
  const router = express.Router();

  router.get("/api/portal-credentials", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);

      const { data: grants, error: grantErr } = await supabase
        .from("user_portal_credential_grants")
        .select("grant_level, credential_id, portal_credentials(*)")
        .eq("user_id", user.id)
        .neq("grant_level", "none");

      if (grantErr) {
        throw Object.assign(new Error(grantErr.message), {
          cause: grantErr,
          statusCode: 500,
        });
      }

      const rows = (grants || [])
        .map((grant) => {
          const cred =
            grant.portal_credentials && typeof grant.portal_credentials === "object"
              ? grant.portal_credentials
              : null;
          if (!cred) {
            return null;
          }
          return sanitizeRow({
            ...cred,
            grant_level: grant.grant_level,
          });
        })
        .filter(Boolean);

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

      const { data, error } = await supabase
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
        action: "credential.manage.created",
        target_type: "credential",
        target_id: String(data.id),
        after_json: {
          jurisdiction: data.jurisdiction,
          portal_username: data.portal_username,
        },
      });

      res.status(201).json(sanitizeRow({ ...data, grant_level: "manage" }));
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
};
