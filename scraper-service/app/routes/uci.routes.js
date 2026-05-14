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

  return router;
}

module.exports = {
  createUciRouter,
};
