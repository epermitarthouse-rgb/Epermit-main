"use strict";

const { Router } = require("express");
const {
  requireAuthenticatedUser,
  requireProjectAccess,
  sanitizeUciError,
} = require("../services/uci/uci-access.service.js");
const {
  listActiveProvidersForApi,
  getActiveProvidersBySlugs,
} = require("../services/uci/uci-providers.service.js");
const {
  listCoordinationRecordsByProject,
  getCoordinationRecordById,
  getCoordinationDetailBundle,
  initCoordinationForProviders,
} = require("../services/uci/uci-records.service.js");
const { recordUserTransition } = require("../services/uci/uci-transitions.service.js");
const { listApplicationsByCoordination } = require("../services/uci/uci-applications.service.js");
const { runPepcoDiscoveryLoginOnly, resumePepcoDiscoveryAfterMfa } = require("../services/uci/uci-pepco-discovery.service.js");
const {
  runPepcoDashboardDiscovery,
  submitPepcoCodeAndContinueDashboardDiscovery,
} = require("../services/uci/uci-pepco-dashboard-discovery.service.js");

/**
 * @param {{ supabase: import("@supabase/supabase-js").SupabaseClient }} opts
 */
function createUciRouter(opts) {
  const { supabase } = opts;
  const router = Router();

  router.get("/providers", async (_req, res) => {
    try {
      await requireAuthenticatedUser(_req, supabase);
      const providers = await listActiveProvidersForApi(supabase);
      res.json({ providers });
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.get("/projects/:projectId/coordination", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const projectId = String(req.params.projectId || "").trim();
      await requireProjectAccess({ supabase, userId: user.id, projectId });
      const records = await listCoordinationRecordsByProject(supabase, projectId);
      res.json({ records });
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/projects/:projectId/coordination/init", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const projectId = String(req.params.projectId || "").trim();
      await requireProjectAccess({ supabase, userId: user.id, projectId });

      const body = req.body && typeof req.body === "object" ? req.body : {};
      const providers = body.providers;

      if (!Array.isArray(providers)) {
        const err = new Error("providers must be an array");
        err.statusCode = 400;
        err.code = "INVALID_BODY";
        throw err;
      }

      const slugStrings = providers.map((x) => String(x));
      if (
        slugStrings.length === 0 ||
        slugStrings.some((s) => !String(s).trim())
      ) {
        const err = new Error(
          "providers must be a non-empty array of non-empty provider slug strings",
        );
        err.statusCode = 400;
        err.code = "INVALID_BODY";
        throw err;
      }

      const { providers: resolved, missingSlugs } =
        await getActiveProvidersBySlugs(supabase, slugStrings);

      if (missingSlugs.length > 0) {
        const err = new Error(
          `Unknown or inactive provider slug(s): ${missingSlugs.join(", ")}`,
        );
        err.statusCode = 400;
        err.code = "INVALID_PROVIDER";
        throw err;
      }

      const result = await initCoordinationForProviders(supabase, {
        projectId,
        userId: user.id,
        resolvedProviders: resolved,
      });

      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.get("/coordination/:id", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const coordinationId = String(req.params.id || "").trim();
      const record = await getCoordinationRecordById(supabase, coordinationId);
      if (!record) {
        const err = new Error("Coordination record not found");
        err.statusCode = 404;
        err.code = "NOT_FOUND";
        throw err;
      }

      const projectId = String(record.project_id);
      await requireProjectAccess({ supabase, userId: user.id, projectId });

      const detail = await getCoordinationDetailBundle(
        supabase,
        coordinationId,
        projectId,
      );

      res.json(detail);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/transition", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const coordinationId = String(req.params.id || "").trim();

      const body = req.body && typeof req.body === "object" ? req.body : {};
      const { to_stage: toStage, to_state: toState, reason } = body;

      if (toStage === undefined || toState === undefined) {
        const err = new Error("to_stage and to_state are required");
        err.statusCode = 400;
        err.code = "INVALID_BODY";
        throw err;
      }

      const record = await getCoordinationRecordById(supabase, coordinationId);
      if (!record) {
        const err = new Error("Coordination record not found");
        err.statusCode = 404;
        err.code = "NOT_FOUND";
        throw err;
      }

      await requireProjectAccess({
        supabase,
        userId: user.id,
        projectId: String(record.project_id),
      });

      const { record: updated, transition } = await recordUserTransition(
        supabase,
        {
          coordinationRecordId: coordinationId,
          userId: user.id,
          toStage,
          toState,
          reason,
        },
      );

      res.json({
        coordination: updated,
        transition,
      });
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.get("/coordination/:id/applications", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const coordinationId = String(req.params.id || "").trim();

      const record = await getCoordinationRecordById(supabase, coordinationId);
      if (!record) {
        const err = new Error("Coordination record not found");
        err.statusCode = 404;
        err.code = "NOT_FOUND";
        throw err;
      }

      const projectId = String(record.project_id);
      await requireProjectAccess({ supabase, userId: user.id, projectId });

      const applications = await listApplicationsByCoordination(
        supabase,
        coordinationId,
        projectId,
      );

      res.json({ applications });
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/discovery/pepco", async (req, res) => {
    const coordinationIdParam = String(req.params.id || "").trim();

    try {
      const user = await requireAuthenticatedUser(req, supabase);
      console.log("[uci-pepco] coordination discovery route started");

      const coordinationId = coordinationIdParam;

      const body = req.body && typeof req.body === "object" ? req.body : {};

      const credential_id =
        body.credential_id != null && String(body.credential_id).trim()
          ? String(body.credential_id).trim()
          : undefined;
      const headed = body.headed === true;
      const auto_email_mfa = body.auto_email_mfa === true;

      const result = await runPepcoDiscoveryLoginOnly({
        supabase,
        user,
        coordinationId,
        credentialId: credential_id,
        headed,
        autoEmailMfa: auto_email_mfa,
      });

      const st =
        result && typeof result === "object" && "status" in result
          ? String(/** @type {{ status?: string }} */ (result).status)
          : "unknown";
      console.log(`[uci-pepco] coordination discovery complete status=${st}`);

      res.status(200).json(result);
    } catch (err) {
      const e = /** @type {Error & { statusCode?: number, code?: string }} */ (err);
      const code = typeof e.code === "string" ? e.code : undefined;
      const statusCode = typeof e.statusCode === "number" ? e.statusCode : undefined;
      const message = err instanceof Error ? err.message : String(err);
      console.error("[uci-pepco] coordination discovery error", {
        code,
        statusCode,
        message: statusCode === 500 ? "(see INTERNAL_ERROR response)" : message,
      });
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/discovery/pepco/dashboard", async (req, res) => {
    const coordinationIdParam = String(req.params.id || "").trim();

    try {
      const user = await requireAuthenticatedUser(req, supabase);
      console.log("[uci-pepco-dashboard] coordination dashboard discovery route started");

      const coordinationId = coordinationIdParam;
      const body = req.body && typeof req.body === "object" ? req.body : {};

      const credential_id =
        body.credential_id != null && String(body.credential_id).trim()
          ? String(body.credential_id).trim()
          : undefined;
      const headed = body.headed === true;
      const auto_email_mfa = body.auto_email_mfa === true;
      const capture_application_ids = body.capture_application_ids === true;

      const result = await runPepcoDashboardDiscovery({
        supabase,
        user,
        coordinationId,
        credentialId: credential_id,
        headed,
        autoEmailMfa: auto_email_mfa,
        capture_application_ids,
      });

      const st =
        result && typeof result === "object" && "status" in result
          ? String(/** @type {{ status?: string }} */ (result).status)
          : "unknown";
      console.log(`[uci-pepco-dashboard] complete status=${st}`);

      res.status(200).json(result);
    } catch (err) {
      const e = /** @type {Error & { statusCode?: number, code?: string }} */ (err);
      const code = typeof e.code === "string" ? e.code : undefined;
      const statusCode = typeof e.statusCode === "number" ? e.statusCode : undefined;
      const message = err instanceof Error ? err.message : String(err);
      console.error("[uci-pepco-dashboard] error", {
        code,
        statusCode,
        message: statusCode === 500 ? "(see INTERNAL_ERROR response)" : message,
      });
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/discovery/pepco/submit-code", async (req, res) => {
    const coordinationIdParam = String(req.params.id || "").trim();

    try {
      const user = await requireAuthenticatedUser(req, supabase);
      console.log("[uci-pepco-dashboard] submit-code started");

      const coordinationId = coordinationIdParam;
      const body = req.body && typeof req.body === "object" ? req.body : {};

      const session_id =
        body.session_id != null && String(body.session_id).trim()
          ? String(body.session_id).trim()
          : "";

      const rawCode = body.code != null ? String(body.code) : "";
      const continue_action = body.continue_action;
      const capture_application_ids = body.capture_application_ids;

      const result = await submitPepcoCodeAndContinueDashboardDiscovery({
        supabase,
        user,
        coordinationId,
        sessionId: session_id,
        code: rawCode,
        continue_action,
        capture_application_ids,
      });

      const st =
        result && typeof result === "object" && "status" in result
          ? String(/** @type {{ status?: string }} */ (result).status)
          : "unknown";
      console.log(`[uci-pepco-dashboard] submit-code complete status=${st}`);

      res.status(200).json(result);
    } catch (err) {
      const e = /** @type {Error & { statusCode?: number, code?: string }} */ (err);
      const code = typeof e.code === "string" ? e.code : undefined;
      const statusCode = typeof e.statusCode === "number" ? e.statusCode : undefined;
      const message = err instanceof Error ? err.message : String(err);
      console.error("[uci-pepco-dashboard] submit-code error", {
        code,
        statusCode,
        message: statusCode === 500 ? "(see INTERNAL_ERROR response)" : message,
      });
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/discovery/pepco/resume", async (req, res) => {
    const coordinationIdParam = String(req.params.id || "").trim();

    try {
      const user = await requireAuthenticatedUser(req, supabase);
      console.log("[uci-pepco] coordination discovery resume started");

      const coordinationId = coordinationIdParam;
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const rawSid = body.session_id != null ? String(body.session_id).trim() : "";

      const result = await resumePepcoDiscoveryAfterMfa({
        supabase,
        user,
        coordinationId,
        sessionId: rawSid,
      });

      const st =
        result && typeof result === "object" && "status" in result
          ? String(/** @type {{ status?: string }} */ (result).status)
          : "unknown";
      console.log(`[uci-pepco] coordination discovery resume complete status=${st}`);

      res.status(200).json(result);
    } catch (err) {
      const e = /** @type {Error & { statusCode?: number, code?: string }} */ (err);
      const code = typeof e.code === "string" ? e.code : undefined;
      const statusCode = typeof e.statusCode === "number" ? e.statusCode : undefined;
      const message = err instanceof Error ? err.message : String(err);
      console.error("[uci-pepco] coordination discovery resume error", {
        code,
        statusCode,
        message: statusCode === 500 ? "(see INTERNAL_ERROR response)" : message,
      });
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  return router;
}

module.exports = {
  createUciRouter,
};
