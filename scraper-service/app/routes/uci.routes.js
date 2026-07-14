"use strict";

const { Router } = require("express");
const {
  requireAuthenticatedUser,
  requireProjectAccess,
  assertCoordinationBelongsToProject,
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
const {
  getProviderSetupForProject,
  resolveProjectAddressForProviderSetup,
  buildHumanAssistedMappingMetadata,
  parseProviderSetupConfirmation,
} = require("../services/uci/uci-provider-setup.service.js");
const { getProjectForUciAccess } = require("../services/uci/uci-access.service.js");
const { recordUserTransition } = require("../services/uci/uci-transitions.service.js");
const { runLoadProfileAnalysis } = require("../services/uci/uci-load-profile.service.js");
const {
  runApplicationPackageBuild,
  reviewApplicationPackage,
  getApplicationById,
} = require("../services/uci/uci-application-builder.service.js");
const { submitApplicationPackage } = require("../services/uci/uci-application-submit.service.js");
const { listApplicationsByCoordination } = require("../services/uci/uci-applications.service.js");
const { runPortalSync } = require("../services/uci/uci-portal-sync.service.js");
const {
  runPortalSyncWithMode,
  listPortalSyncRuns,
  getPortalSyncRun,
  cancelPortalSyncRun,
  findActiveUciPortalSyncJobForCoordination,
  isUciDurableJobsEnabled,
} = require("../services/uci/uci-portal-sync-job.service.js");
const { linkPepcoMfaSessionToPortalSyncJob } = require("../services/uci/uci-portal-sync-job-store.js");
const {
  listCommunicationsByCoordination,
  listMilestonesByCoordination,
} = require("../services/uci/uci-communications.service.js");
const {
  classifyCoordinationCommunications,
  listNeedsAttentionCommunications,
  reclassifyCommunication,
  getCommunicationById,
} = require("../services/uci/uci-communication-classifier.service.js");
const { runCosDiscrepancyAnalysis } = require("../services/uci/uci-cos-analyst.service.js");
const { listCostsByCoordination, upsertCostRecord } = require("../services/uci/uci-costs.service.js");
const {
  listEquipmentByCoordination,
  createEquipmentRecord,
  recordEquipmentCheckIn,
} = require("../services/uci/uci-equipment.service.js");
const { prepareMeterSetChecklist } = require("../services/uci/uci-meter-set.service.js");
const { prepareCloseoutPackage } = require("../services/uci/uci-closeout.service.js");
const { getProjectPortfolioView } = require("../services/uci/uci-portfolio.service.js");
const { listRecentUciEventsForProject } = require("../services/uci/uci-events.service.js");
const {
  applyLifecycleProposal,
  rejectLifecycleProposal,
} = require("../services/uci/uci-lifecycle-proposal-actions.service.js");
const { runPepcoDiscoveryLoginOnly, resumePepcoDiscoveryAfterMfa } = require("../services/uci/uci-pepco-discovery.service.js");
const {
  runPepcoDashboardDiscovery,
  submitPepcoCodeAndContinueDashboardDiscovery,
} = require("../services/uci/uci-pepco-dashboard-discovery.service.js");
const {
  runPepcoApplicationDetailDiscovery,
  resumePepcoApplicationDetailDiscovery,
  submitPepcoCodeAndContinueApplicationDetailDiscovery,
} = require("../services/uci/uci-pepco-application-detail-discovery.service.js");
const {
  sanitizeCoordinationDetailBundleForApi,
  streamPepcoDocumentForRequest,
} = require("../services/uci/uci-pepco-document-download.service.js");

/**
 * @param {string} prefix
 * @param {unknown} result
 */
function logPepcoRouteComplete(prefix, result) {
  const st =
    result && typeof result === "object" && "status" in result
      ? String(/** @type {{ status?: string }} */ (result).status)
      : "unknown";
  if (result && typeof result === "object") {
    const rec = /** @type {{ error_code?: unknown, message?: unknown, reason?: unknown }} */ (
      result
    );
    if (st === "failed") {
      const errorCode =
        rec.error_code != null && String(rec.error_code).trim()
          ? String(rec.error_code).trim()
          : "unknown";
      const message = String(rec.message || "").slice(0, 200);
      console.log(
        `[${prefix}] complete status=${st} error_code=${errorCode} message=${message}`,
      );
      return;
    }
    if (st === "human_required") {
      const reason =
        rec.reason != null && String(rec.reason).trim()
          ? String(rec.reason).trim()
          : "unknown";
      const message = String(rec.message || "").slice(0, 200);
      console.log(`[${prefix}] complete status=${st} reason=${reason} message=${message}`);
      return;
    }
  }
  console.log(`[${prefix}] complete status=${st}`);
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} coordinationId
 * @param {string} [providerSlug]
 * @returns {Promise<string | undefined>}
 */
async function resolvePortalSyncJobIdForMfa(supabase, coordinationId, providerSlug) {
  if (!isUciDurableJobsEnabled()) return undefined;
  const job = await findActiveUciPortalSyncJobForCoordination(
    supabase,
    coordinationId,
    providerSlug || "pepco",
  );
  return job?.id ? String(job.id) : undefined;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string | undefined} portalSyncJobId
 * @param {string | undefined} pepcoSessionId
 */
async function maybeLinkMfaSessionToPortalSyncJob(supabase, portalSyncJobId, pepcoSessionId) {
  if (!portalSyncJobId || !pepcoSessionId) return;
  await linkPepcoMfaSessionToPortalSyncJob(supabase, portalSyncJobId, pepcoSessionId);
}

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

  router.get("/projects/:projectId/provider-setup", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const projectId = String(req.params.projectId || "").trim();
      const setup = await getProviderSetupForProject(supabase, {
        projectId,
        userId: user.id,
      });
      res.json(setup);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/projects/:projectId/coordination/init", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const projectId = String(req.params.projectId || "").trim();
      await requireProjectAccess({ supabase, userId: user.id, projectId, write: true });

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

      /** @type {Record<string, unknown> | null} */
      let providerSetupMetadata = null;
      if (body.provider_setup != null) {
        const project = await getProjectForUciAccess({
          supabase,
          userId: user.id,
          projectId,
        });
        const address = resolveProjectAddressForProviderSetup(project);
        const { unresolvedUtilityTypes } = parseProviderSetupConfirmation(
          body.provider_setup,
          address,
        );
        providerSetupMetadata = buildHumanAssistedMappingMetadata({
          userId: user.id,
          confirmedAt: new Date().toISOString(),
          address,
          selectedProviderSlugs: slugStrings.map((slug) => String(slug).trim().toLowerCase()),
          unresolvedUtilityTypes,
        });
      }

      const result = await initCoordinationForProviders(supabase, {
        projectId,
        userId: user.id,
        resolvedProviders: resolved,
        providerSetupMetadata,
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

      res.json(sanitizeCoordinationDetailBundleForApi(detail));
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
        write: true,
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

  router.post("/coordination/:id/lifecycle-proposals/apply", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const coordinationId = String(req.params.id || "").trim();
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const externalApplicationId = String(body.external_application_id ?? "").trim();
      const proposalChecksum = String(body.proposal_checksum ?? "").trim();

      if (!externalApplicationId || !proposalChecksum) {
        const err = new Error("external_application_id and proposal_checksum are required");
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

      const projectId = String(record.project_id);
      await requireProjectAccess({ supabase, userId: user.id, projectId, write: true });

      const result = await applyLifecycleProposal(supabase, {
        coordinationRecordId: coordinationId,
        projectId,
        userId: user.id,
        externalApplicationId,
        proposalChecksum,
      });

      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/lifecycle-proposals/reject", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const coordinationId = String(req.params.id || "").trim();
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const externalApplicationId = String(body.external_application_id ?? "").trim();
      const proposalChecksum = String(body.proposal_checksum ?? "").trim();
      const reason = body.reason != null ? String(body.reason) : undefined;

      if (!externalApplicationId || !proposalChecksum) {
        const err = new Error("external_application_id and proposal_checksum are required");
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

      const projectId = String(record.project_id);
      await requireProjectAccess({ supabase, userId: user.id, projectId, write: true });

      const result = await rejectLifecycleProposal(supabase, {
        coordinationRecordId: coordinationId,
        projectId,
        userId: user.id,
        externalApplicationId,
        proposalChecksum,
        reason,
      });

      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/load-profile/analyze", async (req, res) => {
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

      await requireProjectAccess({
        supabase,
        userId: user.id,
        projectId: String(record.project_id),
        write: true,
      });

      const result = await runLoadProfileAnalysis(supabase, {
        coordinationRecordId: coordinationId,
        userId: user.id,
      });

      res.json(result);
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

  router.post("/coordination/:id/applications", async (req, res) => {
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

      await requireProjectAccess({
        supabase,
        userId: user.id,
        projectId: String(record.project_id),
        write: true,
      });

      const result = await runApplicationPackageBuild(supabase, {
        coordinationRecordId: coordinationId,
        userId: user.id,
      });

      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/applications/:id/review", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const applicationId = String(req.params.id || "").trim();
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const status = String(body.status ?? "").trim();
      const notes = body.notes != null ? String(body.notes) : undefined;

      const appRow = await getApplicationById(supabase, applicationId);
      if (!appRow) {
        const err = new Error("Application not found");
        err.statusCode = 404;
        err.code = "NOT_FOUND";
        throw err;
      }

      await requireProjectAccess({
        supabase,
        userId: user.id,
        projectId: String(appRow.project_id),
        write: true,
      });

      const result = await reviewApplicationPackage(supabase, {
        applicationId,
        userId: user.id,
        review: { status, notes },
      });

      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/applications/:id/submit", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const applicationId = String(req.params.id || "").trim();

      const appRow = await getApplicationById(supabase, applicationId);
      if (!appRow) {
        const err = new Error("Application not found");
        err.statusCode = 404;
        err.code = "NOT_FOUND";
        throw err;
      }

      await requireProjectAccess({
        supabase,
        userId: user.id,
        projectId: String(appRow.project_id),
        write: true,
      });

      const result = await submitApplicationPackage(supabase, {
        applicationId,
        userId: user.id,
      });

      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/sync", async (req, res) => {
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
      await requireProjectAccess({ supabase, userId: user.id, projectId, write: true });

      const body = req.body && typeof req.body === "object" ? req.body : {};
      const providerSlug =
        body.provider_slug != null && String(body.provider_slug).trim()
          ? String(body.provider_slug).trim().toLowerCase()
          : undefined;

      const result = await runPortalSyncWithMode(supabase, {
        projectId,
        userId: user.id,
        coordinationRecordId: coordinationId,
        providerSlug,
      });

      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.get("/coordination/:id/sync-runs", async (req, res) => {
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

      const providerSlug =
        req.query.provider_slug != null && String(req.query.provider_slug).trim()
          ? String(req.query.provider_slug).trim().toLowerCase()
          : undefined;
      const limit =
        req.query.limit != null ? Number(req.query.limit) : undefined;

      const result = await listPortalSyncRuns(supabase, {
        coordinationRecordId: coordinationId,
        projectId,
        providerSlug,
        limit,
      });

      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.get("/coordination/:id/sync-runs/:jobId", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const coordinationId = String(req.params.id || "").trim();
      const jobId = String(req.params.jobId || "").trim();

      const record = await getCoordinationRecordById(supabase, coordinationId);
      if (!record) {
        const err = new Error("Coordination record not found");
        err.statusCode = 404;
        err.code = "NOT_FOUND";
        throw err;
      }

      const projectId = String(record.project_id);
      await requireProjectAccess({ supabase, userId: user.id, projectId });

      const run = await getPortalSyncRun(supabase, {
        jobId,
        projectId,
        coordinationRecordId: coordinationId,
      });
      if (!run) {
        const err = new Error("Portal sync run not found");
        err.statusCode = 404;
        err.code = "NOT_FOUND";
        throw err;
      }

      res.json({ run });
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/sync-runs/:jobId/cancel", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const coordinationId = String(req.params.id || "").trim();
      const jobId = String(req.params.jobId || "").trim();

      const record = await getCoordinationRecordById(supabase, coordinationId);
      if (!record) {
        const err = new Error("Coordination record not found");
        err.statusCode = 404;
        err.code = "NOT_FOUND";
        throw err;
      }

      const projectId = String(record.project_id);
      await requireProjectAccess({ supabase, userId: user.id, projectId, write: true });

      const cancelled = await cancelPortalSyncRun(supabase, {
        jobId,
        projectId,
        userId: user.id,
      });
      if (!cancelled) {
        const err = new Error("Portal sync run not found");
        err.statusCode = 404;
        err.code = "NOT_FOUND";
        throw err;
      }

      res.json({ run: cancelled, status: "cancelled" });
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.get("/coordination/:id/communications", async (req, res) => {
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

      const limit = req.query.limit;
      const offset = req.query.offset;
      const result = await listCommunicationsByCoordination(
        supabase,
        coordinationId,
        projectId,
        {
          limit: limit != null ? Number(limit) : undefined,
          offset: offset != null ? Number(offset) : undefined,
        },
      );

      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/communications/classify", async (req, res) => {
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
      await requireProjectAccess({ supabase, userId: user.id, projectId, write: true });

      const result = await classifyCoordinationCommunications(supabase, {
        coordinationRecordId: coordinationId,
        projectId,
      });

      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.get("/communications/needs_attention", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const projectId = String(req.query.project_id ?? "").trim();
      if (!projectId) {
        const err = new Error("project_id query parameter is required");
        err.statusCode = 400;
        err.code = "PROJECT_ID_REQUIRED";
        throw err;
      }

      await requireProjectAccess({ supabase, userId: user.id, projectId });

      const coordinationId = req.query.coordination_id
        ? String(req.query.coordination_id).trim()
        : undefined;

      await assertCoordinationBelongsToProject({
        supabase,
        projectId,
        coordinationRecordId: coordinationId,
      });

      const result = await listNeedsAttentionCommunications(supabase, {
        projectId,
        coordinationRecordId: coordinationId,
        limit: req.query.limit != null ? Number(req.query.limit) : undefined,
        offset: req.query.offset != null ? Number(req.query.offset) : undefined,
      });

      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/communications/:id/reclassify", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const communicationId = String(req.params.id || "").trim();
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const classification = String(body.classification ?? "").trim();
      const notes = body.notes != null ? String(body.notes) : undefined;

      const comm = await getCommunicationById(supabase, communicationId);
      if (!comm) {
        const err = new Error("Communication not found");
        err.statusCode = 404;
        err.code = "NOT_FOUND";
        throw err;
      }

      await requireProjectAccess({
        supabase,
        userId: user.id,
        projectId: String(comm.project_id),
        write: true,
      });

      const result = await reclassifyCommunication(supabase, {
        communicationId,
        userId: user.id,
        review: { classification, notes },
      });

      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.get("/coordination/:id/milestones", async (req, res) => {
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

      const limit = req.query.limit;
      const offset = req.query.offset;
      const result = await listMilestonesByCoordination(
        supabase,
        coordinationId,
        projectId,
        {
          limit: limit != null ? Number(limit) : undefined,
          offset: offset != null ? Number(offset) : undefined,
        },
      );

      res.json(result);
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

      logPepcoRouteComplete("uci-pepco", result);

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

      if (
        result &&
        typeof result === "object" &&
        /** @type {{ status?: string, session_id?: string }} */ (result).status ===
          "human_required"
      ) {
        const portalSyncJobId = await resolvePortalSyncJobIdForMfa(
          supabase,
          coordinationId,
          "pepco",
        );
        await maybeLinkMfaSessionToPortalSyncJob(
          supabase,
          portalSyncJobId,
          /** @type {{ session_id?: string }} */ (result).session_id,
        );
      }

      logPepcoRouteComplete("uci-pepco-dashboard", result);

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

      logPepcoRouteComplete("uci-pepco-dashboard", result);

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

  router.post("/coordination/:id/discovery/pepco/application-details", async (req, res) => {
    const coordinationIdParam = String(req.params.id || "").trim();

    try {
      const user = await requireAuthenticatedUser(req, supabase);
      console.log("[uci-pepco-app-detail] application detail discovery started");

      const coordinationId = coordinationIdParam;
      const body = req.body && typeof req.body === "object" ? req.body : {};

      const credential_id =
        body.credential_id != null && String(body.credential_id).trim()
          ? String(body.credential_id).trim()
          : undefined;
      const headed = body.headed === true;
      const auto_email_mfa = body.auto_email_mfa === true;
      const download_documents = body.download_documents === true;
      const application_uuids = Array.isArray(body.application_uuids)
        ? body.application_uuids.map((x) => String(x))
        : undefined;

      const portalSyncJobId = await resolvePortalSyncJobIdForMfa(
        supabase,
        coordinationId,
        "pepco",
      );

      const result = await runPepcoApplicationDetailDiscovery({
        supabase,
        user,
        coordinationId,
        credentialId: credential_id,
        headed,
        autoEmailMfa: auto_email_mfa,
        application_uuids,
        download_documents,
        portalSyncJobId,
      });

      if (
        result &&
        typeof result === "object" &&
        /** @type {{ status?: string, session_id?: string }} */ (result).status ===
          "human_required"
      ) {
        await maybeLinkMfaSessionToPortalSyncJob(
          supabase,
          portalSyncJobId,
          /** @type {{ session_id?: string }} */ (result).session_id,
        );
      }

      logPepcoRouteComplete("uci-pepco-app-detail", result);

      res.status(200).json(result);
    } catch (err) {
      const e = /** @type {Error & { statusCode?: number, code?: string }} */ (err);
      console.error("[uci-pepco-app-detail] error", {
        code: typeof e.code === "string" ? e.code : undefined,
        statusCode: typeof e.statusCode === "number" ? e.statusCode : undefined,
      });
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/discovery/pepco/application-details/resume", async (req, res) => {
    const coordinationIdParam = String(req.params.id || "").trim();

    try {
      const user = await requireAuthenticatedUser(req, supabase);
      console.log("[uci-pepco-app-detail] application detail resume started");

      const coordinationId = coordinationIdParam;
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const session_id =
        body.session_id != null && String(body.session_id).trim()
          ? String(body.session_id).trim()
          : "";
      const download_documents =
        typeof body.download_documents === "boolean" ? body.download_documents : undefined;
      const application_uuids = Array.isArray(body.application_uuids)
        ? body.application_uuids.map((x) => String(x))
        : undefined;
      const rawCode = body.code != null ? String(body.code) : "";
      const codeTrim = rawCode.trim().replace(/\s+/g, "");

      const result =
        codeTrim.length > 0
          ? await submitPepcoCodeAndContinueApplicationDetailDiscovery({
              supabase,
              user,
              coordinationId,
              sessionId: session_id,
              code: codeTrim,
              application_uuids,
              download_documents,
            })
          : await resumePepcoApplicationDetailDiscovery({
              supabase,
              user,
              coordinationId,
              sessionId: session_id,
              application_uuids,
              download_documents,
            });

      logPepcoRouteComplete("uci-pepco-app-detail", result);

      res.status(200).json(result);
    } catch (err) {
      const e = /** @type {Error & { statusCode?: number, code?: string, detail?: string }} */ (err);
      console.error("[uci-pepco-app-detail] resume error", {
        code: typeof e.code === "string" ? e.code : undefined,
        statusCode: typeof e.statusCode === "number" ? e.statusCode : undefined,
        message: err instanceof Error ? err.message : String(err),
        detail: typeof e.detail === "string" ? e.detail.slice(0, 500) : undefined,
      });
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.get(
    "/coordination/:id/discovery/pepco/application-details/:applicationUuid/documents/:documentIndex/download",
    async (req, res) => {
      await streamPepcoDocumentForRequest({
        req,
        res,
        supabase,
        requireAuthenticatedUser,
        sanitizeUciError,
        disposition: "attachment",
        logLabel: "download",
      });
    },
  );

  router.get(
    "/coordination/:id/discovery/pepco/application-details/:applicationUuid/documents/:documentIndex/view",
    async (req, res) => {
      await streamPepcoDocumentForRequest({
        req,
        res,
        supabase,
        requireAuthenticatedUser,
        sanitizeUciError,
        disposition: "inline",
        logLabel: "view",
      });
    },
  );

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

      logPepcoRouteComplete("uci-pepco", result);

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

  router.post("/coordination/:id/cos/analyze", async (req, res) => {
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
      await requireProjectAccess({
        supabase,
        userId: user.id,
        projectId: String(record.project_id),
        write: true,
      });
      const result = await runCosDiscrepancyAnalysis(supabase, {
        coordinationRecordId: coordinationId,
        userId: user.id,
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.get("/coordination/:id/costs", async (req, res) => {
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
      const costs = await listCostsByCoordination(supabase, coordinationId, projectId);
      res.json({ costs });
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/costs", async (req, res) => {
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
      await requireProjectAccess({ supabase, userId: user.id, projectId, write: true });
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const result = await upsertCostRecord(supabase, {
        coordinationRecordId: coordinationId,
        projectId,
        cost: body,
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.get("/coordination/:id/equipment", async (req, res) => {
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
      const equipment = await listEquipmentByCoordination(supabase, coordinationId, projectId);
      res.json({ equipment });
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/equipment", async (req, res) => {
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
      await requireProjectAccess({ supabase, userId: user.id, projectId, write: true });
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const result = await createEquipmentRecord(supabase, {
        coordinationRecordId: coordinationId,
        projectId,
        equipment: body,
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/equipment/:id/check-in", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const equipmentId = String(req.params.id || "").trim();
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const { data: row } = await supabase
        .from("coordination_equipment")
        .select("project_id")
        .eq("id", equipmentId)
        .maybeSingle();
      if (!row) {
        const err = new Error("Equipment not found");
        err.statusCode = 404;
        err.code = "NOT_FOUND";
        throw err;
      }
      await requireProjectAccess({
        supabase,
        userId: user.id,
        projectId: String(row.project_id),
        write: true,
      });
      const result = await recordEquipmentCheckIn(supabase, {
        equipmentId,
        projectId: String(row.project_id),
        currentEta: body.current_eta,
        status: body.status,
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/meter-set/prepare", async (req, res) => {
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
      await requireProjectAccess({
        supabase,
        userId: user.id,
        projectId: String(record.project_id),
        write: true,
      });
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const result = await prepareMeterSetChecklist(supabase, {
        coordinationRecordId: coordinationId,
        userId: user.id,
        scheduledDate: body.scheduled_date,
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/closeout/prepare", async (req, res) => {
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
      await requireProjectAccess({
        supabase,
        userId: user.id,
        projectId: String(record.project_id),
        write: true,
      });
      const result = await prepareCloseoutPackage(supabase, {
        coordinationRecordId: coordinationId,
        userId: user.id,
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.get("/projects/:projectId/portfolio_view", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const projectId = String(req.params.projectId || "").trim();
      await requireProjectAccess({ supabase, userId: user.id, projectId });
      const result = await getProjectPortfolioView(supabase, projectId);
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.get("/events/recent", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const projectId = String(req.query.project_id ?? "").trim();
      if (!projectId) {
        const err = new Error("project_id query parameter is required");
        err.statusCode = 400;
        err.code = "PROJECT_ID_REQUIRED";
        throw err;
      }
      await requireProjectAccess({ supabase, userId: user.id, projectId });
      const limit = req.query.limit != null ? Number(req.query.limit) : 50;
      res.json({ events: listRecentUciEventsForProject(projectId, limit) });
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
