"use strict";

const { Router } = require("express");
const {
  requireAuthenticatedUser,
  sanitizeUciError,
  getAuthenticatedUser,
} = require("../services/uci/uci-access.service.js");
const {
  createSignedOAuthState,
  verifySignedOAuthState,
  getMsOAuthConfigOrThrow,
  buildAuthorizeUrl,
  exchangeAuthCodeForTokens,
  fetchGraphMe,
  upsertEncryptedMailboxConnectionRow,
  primaryMailboxFromMe,
  assertMailboxEmailMatchesExpected,
  logOAuthUpsertDiagnostics,
  getValidAccessTokenForUser,
  markMailboxConnectionError,
} = require("../services/microsoft/microsoft-graph-auth.service.js");
const { loadKeyBytes } = require("../services/microsoft/microsoft-token-crypto.js");
const {
  countLatestMailboxMessages,
  getMailboxStatusForUser,
} = require("../services/microsoft/microsoft-mailbox.service.js");

const DEFAULT_MAILBOX_EMAIL = "Permitting@commun-et.com";

/**
 * HTML shell for OAuth callback (no redirects to SPA required).
 *
 * @param {string} bodyText
 */
function htmlShell(bodyText) {
  const safeBody = String(bodyText || "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Microsoft mailbox</title></head><body style="font-family:system-ui,sans-serif;padding:24px"><p>${safeBody}</p></body></html>`;
}

/**
 * @param {import("express").Request} req
 */
function wantsJsonStartResponse(req) {
  const f = String(req.query.format || "").trim().toLowerCase();
  if (f === "json") return true;
  const accept = String(req.headers.accept || "");
  return accept.includes("application/json");
}

/**
 * @param {{ supabase: import("@supabase/supabase-js").SupabaseClient }} opts
 */
function createMicrosoftRouter(opts) {
  const { supabase } = opts;
  const router = Router();

  router.get("/oauth/start", async (req, res) => {
    const json = wantsJsonStartResponse(req);
    try {
      getMsOAuthConfigOrThrow();
      loadKeyBytes();
    } catch (e) {
      if (json) {
        const codeGuess =
          typeof e === "object" && e !== null && "code" in e
            ? String(/** @type {{ code?: string }} */ (e).code || "")
            : "";
        return res.status(503).json({
          error:
            codeGuess.includes("encryption") ||
            codeGuess.includes("TOKEN") ||
            codeGuess.includes("crypto")
              ? "token_encryption_invalid"
              : "oauth_unconfigured",
          message: e instanceof Error ? e.message : String(e),
        });
      }
      return res
        .status(503)
        .send(
          htmlShell(
            "Microsoft Graph OAuth or token encryption key is not configured correctly on this server.",
          ),
        );
    }

    let user;
    try {
      user = await requireAuthenticatedUser(req, supabase);
    } catch (err) {
      if (json) {
        const s = sanitizeUciError(err);
        return res.status(s.httpStatus).json(s.body);
      }
      return res.status(401).send(htmlShell("Authentication required. Sign in to PermitPilot, then try again."));
    }

    const mailboxRaw =
      req.query.mailbox_email != null && String(req.query.mailbox_email).trim()
        ? String(req.query.mailbox_email).trim()
        : DEFAULT_MAILBOX_EMAIL;

    let state;
    try {
      state = createSignedOAuthState({
        userId: String(user.id),
        mailboxEmail: mailboxRaw.toLowerCase(),
      });
    } catch (e) {
      if (json) {
        return res.status(503).json({
          error: "oauth_state_failure",
          message: e instanceof Error ? e.message : String(e),
        });
      }
      return res.status(503).send(htmlShell("Could not prepare Microsoft OAuth."));
    }

    let authorizeUrl;
    try {
      authorizeUrl = buildAuthorizeUrl(state);
    } catch (e) {
      if (json) {
        return res.status(503).json({
          error: "oauth_url_failure",
          message: e instanceof Error ? e.message : String(e),
        });
      }
      return res.status(503).send(htmlShell("Could not build Microsoft authorize URL."));
    }

    if (json) return res.status(200).json({ authorizeUrl });
    return res.redirect(302, authorizeUrl);
  });

  router.get("/oauth/callback", async (_req, res) => {
    const req = _req;
    const errParam = typeof req.query.error === "string" ? req.query.error.trim() : "";
    if (errParam) {
      const safeErr = errParam.slice(0, 80);
      return res.status(400).send(htmlShell(`Microsoft OAuth was denied (${safeErr}). Close this tab and try again.`));
    }

    const codeRaw = typeof req.query.code === "string" ? req.query.code.trim() : "";
    const stateRaw = typeof req.query.state === "string" ? req.query.state.trim() : "";

    if (!codeRaw || !stateRaw) {
      return res.status(400).send(htmlShell("Missing OAuth code or state. Close this tab and try connecting again."));
    }

    const decoded = verifySignedOAuthState(stateRaw);
    if (!decoded) {
      return res.status(400).send(htmlShell("OAuth state expired or invalid. Close this tab and try connecting again."));
    }

    try {
      loadKeyBytes();
    } catch {
      return res.status(503).send(htmlShell("Microsoft token encryption is not configured on this server."));
    }

    const { tenantId, clientId } = getMsOAuthConfigOrThrow();

    let tokens;
    try {
      tokens = await exchangeAuthCodeForTokens(codeRaw);
    } catch {
      return res.status(502).send(htmlShell("Could not exchange Microsoft OAuth code."));
    }

    const accessTokenGuess =
      typeof tokens.access_token === "string" ? tokens.access_token : "";
    if (!accessTokenGuess) {
      return res.status(502).send(htmlShell("Microsoft returned an incomplete token response."));
    }

    /** @type {Record<string, unknown>} */
    let me;
    try {
      me = /** @type {Record<string, unknown>} */ await fetchGraphMe(accessTokenGuess);
    } catch {
      return res.status(502).send(htmlShell("Could not verify Microsoft mailbox identity."));
    }

    let mailboxResolved = primaryMailboxFromMe(me);
    assertMailboxEmailMatchesExpected(mailboxResolved);
    mailboxResolved =
      mailboxResolved && mailboxResolved.trim()
        ? mailboxResolved.trim()
        : decoded.mailboxEmail || DEFAULT_MAILBOX_EMAIL;

    try {
      await upsertEncryptedMailboxConnectionRow(supabase, {
        userId: decoded.userId,
        mailboxEmailHint: mailboxResolved,
        tenantIdUsed: tenantId,
        clientIdUsed: clientId,
        delegateTokenEnvelope: tokens,
      });
    } catch (e) {
      logOAuthUpsertDiagnostics(e instanceof Error ? e : new Error(String(e)));
      return res
        .status(500)
        .send(htmlShell("Microsoft mailbox tokens could not be stored. Verify server configuration and try again."));
    }

    return res.status(200).send(htmlShell("Microsoft mailbox connected. You can close this tab."));
  });

  router.get("/mailbox/status", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const out = await getMailboxStatusForUser(supabase, String(user.id));
      res.status(200).json(out);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/mailbox/test-read", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const userIdStr = String(user.id);

      const status = await getMailboxStatusForUser(supabase, userIdStr);
      if (!status.connected) {
        return res.status(400).json({
          error: "MS_GRAPH_NOT_CONNECTED",
          status: "not_connected",
          message: "Connect the Microsoft mailbox in Settings before running inbox tests.",
        });
      }

      const accessToken = await getValidAccessTokenForUser(supabase, userIdStr);
      const counted = await countLatestMailboxMessages(accessToken, { top: 3 });
      await supabase
        .from("microsoft_mailbox_connections")
        .update({
          last_checked_at: new Date().toISOString(),
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userIdStr);

      res.status(200).json({
        status: "ok",
        messages_checked: Math.min(3, counted),
      });
    } catch (err) {
      try {
        const g = await getAuthenticatedUser(req, supabase);
        if (g.user && g.user.id) {
          await markMailboxConnectionError(
            supabase,
            String(g.user.id),
            `test_read:${(err instanceof Error ? err.message : String(err)).slice(0, 300)}`,
          );
        }
      } catch (_) {
        /** ignore */
      }

      if (typeof err === "object" && err !== null && /** @type {{ code?: string }} */ (err).code === "MS_GRAPH_NOT_CONNECTED") {
        return res.status(400).json({
          error: "MS_GRAPH_NOT_CONNECTED",
          status: "failed",
          message: "Microsoft mailbox is not connected.",
        });
      }

      const s = sanitizeUciError(err);
      res.status(s.httpStatus >= 400 ? s.httpStatus : 500).json({
        ...(s.body && typeof s.body === "object" ? s.body : {}),
        status: "failed",
      });
    }
  });

  return router;
}

module.exports = {
  createMicrosoftRouter,
};
