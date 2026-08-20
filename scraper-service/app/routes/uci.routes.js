"use strict";

const crypto = require("crypto");
const { Router } = require("express");
const {
  requireAuthenticatedUser,
  requireProjectAccess,
  assertCoordinationBelongsToProject,
  sanitizeUciError,
} = require("../services/uci/uci-access.service.js");
const {
  listActiveProvidersForApi,
  resolveProviderAliasForApi,
} = require("../services/uci/uci-providers.service.js");
const {
  listActiveProvidersForTenant,
  getActiveProvidersBySlugsForTenant,
  createTenantUtilityProvider,
} = require("../services/uci/uci-providers-tenant.service.js");
const {
  requireSupportedUtilityType,
} = require("../services/uci/uci-utility-types.js");
const { getProjectTenantId, getProjectForUciAccess } = require("../services/uci/uci-access.service.js");
const {
  listCoordinationRecordsByProject,
  getCoordinationRecordById,
  getCoordinationRecordDetailById,
  getCoordinationDetailBundle,
  initCoordinationForProviders,
} = require("../services/uci/uci-records.service.js");
const {
  getProviderSetupForProject,
  buildProviderSetupAddressContext,
  buildHumanAssistedMappingMetadata,
  parseProviderSetupConfirmation,
} = require("../services/uci/uci-provider-setup.service.js");
const {
  getProviderResolutionForProject,
  resolveProviderResolutionForProject,
  confirmProviderResolutionForProject,
  overrideProviderResolutionForProject,
  configureTerritoryDatasetLoader,
} = require("../services/uci/uci-provider-resolution.service.js");
const {
  readProviderResolutionForServiceType,
} = require("../services/uci/uci-provider-resolution-persistence.js");
const {
  recordUserTransition,
  completeStage2EngineeringReview,
} = require("../services/uci/uci-transitions.service.js");
const { runLoadProfileAnalysis } = require("../services/uci/uci-load-profile.service.js");
const {
  runLoadCandidateExtraction,
  listLoadCandidates,
  resolveLoadCandidate,
  addManualVerifiedValue,
} = require("../services/uci/uci-load-candidate.service.js");
const {
  runDocumentProcessing,
  getDocumentProcessingManifest,
} = require("../services/uci/uci-document-processing.service.js");
const {
  runDocumentFallbackProcessing,
  estimateFallbackPages,
} = require("../services/uci/uci-document-fallback.service.js");
const {
  getDocumentFallbackConfig,
  fallbackProviderStatus,
} = require("../services/uci/uci-document-fallback-config.service.js");
const {
  importDocumentFindingsToLoadProfile,
} = require("../services/uci/uci-document-findings-bridge.service.js");
const {
  reprocessDocument,
} = require("../services/uci/uci-document-reprocess.service.js");
const {
  getLoadProfileDocumentScope,
  linkProjectDocumentsToCoordination,
  unlinkProjectDocumentFromCoordination,
  setDocumentIncludedInAnalysis,
} = require("../services/uci/uci-coordination-document-links.service.js");
const {
  runApplicationPackageBuild,
  getApplicationById,
} = require("../services/uci/uci-application-builder.service.js");
const {
  reviewApplicationPackage,
  updatePackageReviewItem,
  confirmAllVerifiedFields,
  getPackageReviewApplicationById,
} = require("../services/uci/uci-package-review.service.js");
const {
  listPackageDocumentCandidates,
  confirmPackageDocumentMapping,
  removePackageDocumentMapping,
} = require("../services/uci/uci-package-document-bridge.service.js");
const { submitApplicationPackage } = require("../services/uci/uci-application-submit.service.js");
const {
  validateSubmissionPackage,
  listSubmissionValidationAttempts,
} = require("../services/uci/uci-submission-validation.service.js");
const {
  prepareSubmission,
  updateSubmissionPreparation,
  confirmSubmissionPreparation,
  listSubmissionPreparations,
  getSubmissionPreparationPreview,
} = require("../services/uci/uci-submission-prepare.service.js");
const {
  transmitSubmissionPreparation,
} = require("../services/uci/uci-submission-transmission.service.js");
const {
  approveSyntheticChecklist,
  setSyntheticSignatureStatus,
  exportSyntheticChecklistPackage,
} = require("../services/uci/uci-synthetic-checklist.service.js");
const {
  loadPackageExportContext,
  buildStructuredPackageExport,
  renderPackageSummaryPdf,
  resolveMappedOriginals,
  buildCompletePackageZip,
} = require("../services/uci/uci-package-export.service.js");
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
const {
  flagCommunicationForReview,
  rejectCommunicationAsIrrelevant,
  rematchCommunication,
  confirmCommunicationReview,
  addCommunicationReviewNote,
} = require("../services/uci/uci-communication-review.service.js");
const {
  reconcileLiveTransmissionIntoStage5,
  canEnterStage6,
} = require("../services/uci/uci-stage5-entry.service.js");
const {
  canEnterStage7,
  enterStage6,
} = require("../services/uci/uci-stage6-entry.service.js");
const {
  sweepAcknowledgmentSlas,
  evaluateAcknowledgmentSla,
} = require("../services/uci/uci-ack-sla.service.js");
const {
  sweepCosSlas,
  evaluateCosSla,
} = require("../services/uci/uci-cos-sla.service.js");
const {
  pollGraphInboundForUser,
  ingestEmailInboundWebhook,
} = require("../services/uci/uci-graph-inbound.service.js");

const {
  runCosDiscrepancyAnalysis,
  getCurrentCosDesignRecord,
} = require("../services/uci/uci-cos-analyst.service.js");
const {
  approveCosDesign,
  updateCosAcceptedFields,
  requestCosRevision,
  rejectCosDocument,
  flagCosForReview,
  listCosDesignRecords,
} = require("../services/uci/uci-cos-review.service.js");
const { listCostsByCoordination, upsertCostRecord } = require("../services/uci/uci-costs.service.js");
const {
  listEquipmentByCoordination,
  createEquipmentRecord,
  recordEquipmentCheckIn,
} = require("../services/uci/uci-equipment.service.js");
const { prepareMeterSetChecklist } = require("../services/uci/uci-meter-set.service.js");
const { prepareCloseoutPackage } = require("../services/uci/uci-closeout.service.js");
const { getProjectPortfolioView } = require("../services/uci/uci-portfolio.service.js");
const {
  approveCoordinationCost,
  recordCostPayment,
  overrideCostBillingHold,
  maybeCompleteStage7,
} = require("../services/uci/uci-cost-tracker.service.js");
const { maybeCompleteStage8 } = require("../services/uci/uci-equipment-tracker.service.js");
const {
  recordInspectionRelease,
  updateSiteContact,
  requestMeterSet,
  confirmMeterSetDate,
  confirmSiteReadiness,
  recordMeterSetOutcome,
  completeStage9IfReady,
  meterSetStatus,
} = require("../services/uci/uci-meter-set-choreographer.service.js");
const {
  captureEnergizationDate,
  resolveEnergizationDateConflict,
  attachCloseoutArtifact,
  generateAndArchiveCloseout,
  completeStage10IfReady,
  maybeMarkProjectComplete,
  closeoutStatus,
} = require("../services/uci/uci-energization-closeout.service.js");
const { evaluateLifecycleGuards } = require("../services/uci/uci-lifecycle-guards.service.js");
const { listRecordNeedsAttention } = require("../services/uci/uci-needs-attention.util.js");
const { runOpsLifecycleSweep } = require("../services/uci/uci-lifecycle-scheduler.service.js");
const { UCI_COST_TYPES } = require("../services/uci/uci-lifecycle-constants.js");
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
const {
  listProviderHarvest,
  linkHarvestApplication,
  refreshLinkedHarvestData,
} = require("../services/uci/uci-portal-harvest.service.js");
const {
  getUciOperationalSnapshot,
} = require("../services/uci/uci-operational-snapshot.service.js");

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
  configureTerritoryDatasetLoader({ supabase });
  const router = Router();

  router.use("/operations/snapshot", (req, res, next) => {
    if (req.method !== "GET") return next();
    const suppliedRequestId = String(req.get("x-request-id") || "").trim();
    const requestId = /^[A-Za-z0-9._:-]{1,128}$/.test(suppliedRequestId)
      ? suppliedRequestId
      : crypto.randomUUID();
    const startedAt = Date.now();
    let logged = false;
    res.set("x-request-id", requestId);
    res.set(
      "Access-Control-Expose-Headers",
      "x-request-id, x-backend-duration-ms, server-timing",
    );
    res.locals.uciOperationalRequest = { requestId, startedAt };

    const logCompletion = (outcome) => {
      if (logged) return;
      logged = true;
      console.info("[uci-operational-read]", {
        request_id: requestId,
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        outcome,
        duration_ms: Date.now() - startedAt,
      });
    };
    res.once("finish", () => logCompletion("finished"));
    res.once("close", () => logCompletion(res.writableEnded ? "finished" : "client_closed"));
    next();
  });

  // Correlate the three user-triggered Load Profile actions with browser errors.
  // The client reuses the same ID for a safe transport retry, while attempt
  // distinguishes whether Express saw one or both HTTP requests.
  router.use((req, res, next) => {
    if (
      req.method !== "POST" ||
      !/^\/coordination\/[^/]+\/(?:load-profile\/(?:analyze|extract-candidates|import-document-findings)|document-processing\/reprocess)$/.test(
        req.path,
      )
    ) {
      return next();
    }

    const suppliedRequestId = String(req.get("x-request-id") || "").trim();
    const requestId = /^[A-Za-z0-9._:-]{1,128}$/.test(suppliedRequestId)
      ? suppliedRequestId
      : crypto.randomUUID();
    const attempt = String(req.get("x-uci-request-attempt") || "1").slice(0, 8);
    const startedAt = Date.now();
    let logged = false;
    res.set("x-request-id", requestId);

    const logCompletion = (outcome) => {
      if (logged) return;
      logged = true;
      console.info("[uci-load-profile-action]", {
        request_id: requestId,
        attempt,
        method: req.method,
        path: req.path,
        coordination_id: String(req.path.split("/")[2] || "").trim() || null,
        status: res.statusCode,
        outcome,
        duration_ms: Date.now() - startedAt,
      });
    };

    res.once("finish", () => logCompletion("finished"));
    res.once("close", () => logCompletion(res.writableEnded ? "finished" : "client_closed"));
    next();
  });

  router.get("/territory-dataset/health", async (req, res) => {
    try {
      await requireAuthenticatedUser(req, supabase);
      const { validateTerritoryDatasetHealth } = require("../services/uci/territory/territory-dataset-loader.service.js");
      const health = await validateTerritoryDatasetHealth();
      res.json({
        ok: Boolean(health.healthy),
        territory_dataset: {
          healthy: Boolean(health.healthy),
          code: health.code,
          source: health.source ?? null,
          storage_enabled: health.storage_enabled ?? false,
          bucket: health.bucket ?? null,
          prefix: health.prefix ?? null,
          active_dataset_version: health.active_dataset_version ?? health.dataset_version ?? null,
          source_vintage: health.source_vintage ?? null,
          states: Array.isArray(health.states) ? health.states : [],
          county_fallback_available: Boolean(health.county_fallback_available),
          checksum_status: health.checksum_status ?? null,
          cache_status: health.cache_status ?? null,
          allow_local_fallback: health.allow_local_fallback ?? null,
          error_reason: health.error_reason ?? health.last_error ?? null,
        },
      });
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.get("/providers", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const projectId = String(req.query.projectId || "").trim();
      const utilityType = String(req.query.utilityType || req.query.utility_type || "").trim();
      const utilityTypeFilter = utilityType ? requireSupportedUtilityType(utilityType) : null;
      if (projectId) {
        await requireProjectAccess({ supabase, userId: user.id, projectId });
        const project = await getProjectTenantId(supabase, projectId);
        const providers = await listActiveProvidersForTenant(
          supabase,
          project?.tenant_id ? String(project.tenant_id) : null,
          { utilityType: utilityTypeFilter },
        );
        res.json({ providers, tenant_id: project?.tenant_id ?? null });
        return;
      }
      const providers = await listActiveProvidersForApi(supabase, {
        utilityType: utilityTypeFilter,
      });
      res.json({ providers, tenant_id: null });
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.get("/operations/snapshot", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const snapshot = await getUciOperationalSnapshot(supabase, { userId: user.id });
      const requestTiming = res.locals.uciOperationalRequest;
      const backendDuration = requestTiming
        ? Date.now() - requestTiming.startedAt
        : snapshot.diagnostics.service_duration_ms;
      res.set("x-backend-duration-ms", String(backendDuration));
      res.set(
        "Server-Timing",
        `uci;dur=${backendDuration}, db;dur=${snapshot.diagnostics.service_duration_ms}`,
      );
      console.info("[uci-operational-snapshot]", {
        request_id: requestTiming?.requestId ?? null,
        backend_duration_ms: backendDuration,
        ...snapshot.diagnostics,
      });
      res.json(snapshot);
    } catch (err) {
      const requestTiming = res.locals.uciOperationalRequest;
      if (requestTiming) {
        res.set("x-backend-duration-ms", String(Date.now() - requestTiming.startedAt));
      }
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/projects/:projectId/providers", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const projectId = String(req.params.projectId || "").trim();
      await requireProjectAccess({ supabase, userId: user.id, projectId, write: true });
      const project = await getProjectTenantId(supabase, projectId);
      const tenantId = project?.tenant_id ? String(project.tenant_id) : "";
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const result = await createTenantUtilityProvider(supabase, {
        tenantId,
        name: body.name,
        utilityType: body.utility_type ?? body.utilityType,
      });
      res.status(result.created ? 201 : 200).json({
        ...result,
        tenant_id: tenantId,
      });
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.get("/providers/resolve", async (req, res) => {
    try {
      await requireAuthenticatedUser(req, supabase);
      const alias = String(req.query.alias || req.query.q || req.query.name || "").trim();
      if (!alias) {
        const err = new Error("alias query parameter is required");
        err.statusCode = 400;
        err.code = "INVALID_QUERY";
        throw err;
      }
      const utilityType = String(req.query.utilityType || req.query.utility_type || "").trim();
      const result = await resolveProviderAliasForApi(supabase, alias, {
        utilityType: utilityType ? requireSupportedUtilityType(utilityType) : null,
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.get("/portal-harvest/:providerSlug", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const providerSlug = String(req.params.providerSlug || "").trim().toLowerCase();
      const harvest = await listProviderHarvest(supabase, { userId: user.id, providerSlug });
      res.json(harvest);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.put("/portal-harvest/:providerSlug/applications/:externalApplicationId/link", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const providerSlug = String(req.params.providerSlug || "").trim().toLowerCase();
      const externalApplicationId = String(req.params.externalApplicationId || "").trim();
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const projectId = String(body.project_id || "").trim();
      const coordinationRecordId = String(body.coordination_record_id || "").trim();
      if (!providerSlug || !externalApplicationId || !projectId || !coordinationRecordId) {
        const err = new Error("provider, external application, project, and coordination record are required");
        err.statusCode = 400;
        err.code = "INVALID_HARVEST_LINK";
        throw err;
      }
      await requireProjectAccess({ supabase, userId: user.id, projectId, write: true });
      const link = await linkHarvestApplication(supabase, {
        userId: user.id,
        providerSlug,
        externalApplicationId,
        projectId,
        coordinationRecordId,
      });
      res.json({ link });
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/portal-harvest/:providerSlug/refresh", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const providerSlug = String(req.params.providerSlug || "").trim().toLowerCase();
      const result = await refreshLinkedHarvestData(supabase, { userId: user.id, providerSlug });
      res.json(result);
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
      try {
        const { mapProjectUtilities } = require("../services/uci/uci-provider-intake.service.js");
        await mapProjectUtilities(supabase, { projectId, userId: user.id });
      } catch {
        /* mapping is best-effort; list still returns whatever exists */
      }
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
      try {
        const { mapProjectUtilities } = require("../services/uci/uci-provider-intake.service.js");
        await mapProjectUtilities(supabase, { projectId, userId: user.id });
      } catch {
        /* coverage rows are best-effort */
      }
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

  router.get("/projects/:projectId/provider-resolution", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const projectId = String(req.params.projectId || "").trim();
      const serviceType = req.query.service_type
        ? String(req.query.service_type).trim()
        : req.query.serviceType
          ? String(req.query.serviceType).trim()
          : null;
      const payload = await getProviderResolutionForProject(supabase, {
        projectId,
        userId: user.id,
        serviceType,
      });
      res.json(payload);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/projects/:projectId/provider-resolution/resolve", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const projectId = String(req.params.projectId || "").trim();
      await requireProjectAccess({ supabase, userId: user.id, projectId, write: true });
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const serviceType = String(body.service_type ?? body.serviceType ?? "").trim();
      const addressSourceAcknowledged =
        body.address_source_acknowledged != null
          ? String(body.address_source_acknowledged).trim()
          : body.addressSourceAcknowledged != null
            ? String(body.addressSourceAcknowledged).trim()
            : null;
      const payload = await resolveProviderResolutionForProject(supabase, {
        projectId,
        userId: user.id,
        serviceType,
        addressSourceAcknowledged,
      });
      res.json(payload);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/projects/:projectId/provider-resolution/confirm", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const projectId = String(req.params.projectId || "").trim();
      await requireProjectAccess({ supabase, userId: user.id, projectId, write: true });
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const serviceType = String(body.service_type ?? body.serviceType ?? "").trim();
      const providerId = String(body.provider_id ?? body.providerId ?? "").trim();
      const notes = body.notes != null ? String(body.notes) : null;
      const payload = await confirmProviderResolutionForProject(supabase, {
        projectId,
        userId: user.id,
        serviceType,
        providerId,
        notes,
      });
      res.json(payload);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/projects/:projectId/provider-resolution/override", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const projectId = String(req.params.projectId || "").trim();
      await requireProjectAccess({ supabase, userId: user.id, projectId, write: true });
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const serviceType = String(body.service_type ?? body.serviceType ?? "").trim();
      const providerId = String(body.provider_id ?? body.providerId ?? "").trim();
      const overrideReason = String(
        body.override_reason ?? body.overrideReason ?? "",
      ).trim();
      const notes = body.notes != null ? String(body.notes) : null;
      const payload = await overrideProviderResolutionForProject(supabase, {
        projectId,
        userId: user.id,
        serviceType,
        providerId,
        overrideReason,
        notes,
      });
      res.json(payload);
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

      if (body.provider_setup == null) {
        const err = new Error("provider_setup is required");
        err.statusCode = 400;
        err.code = "PROVIDER_SETUP_REQUIRED";
        throw err;
      }

      const project = await getProjectForUciAccess({
        supabase,
        userId: user.id,
        projectId,
      });
      if (!project) {
        const err = new Error("Project not found");
        err.statusCode = 404;
        err.code = "PROJECT_NOT_FOUND";
        throw err;
      }

      const addressContext = buildProviderSetupAddressContext(project);
      const { address, addressSourceAcknowledged, unresolvedUtilityTypes } =
        parseProviderSetupConfirmation(body.provider_setup, addressContext);

      const tenantRow = await getProjectTenantId(supabase, projectId);
      const { providers: resolved, missingSlugs } = await getActiveProvidersBySlugsForTenant(
        supabase,
        tenantRow?.tenant_id ? String(tenantRow.tenant_id) : null,
        slugStrings,
      );

      if (missingSlugs.length > 0) {
        const err = new Error(
          `Provider slug(s) not available for this project tenant: ${missingSlugs.join(", ")}`,
        );
        err.statusCode = 400;
        err.code = "INVALID_PROVIDER";
        throw err;
      }

      const providerSetupMetadata = buildHumanAssistedMappingMetadata({
        userId: user.id,
        confirmedAt: new Date().toISOString(),
        address,
        selectedProviderSlugs: slugStrings.map((slug) => String(slug).trim().toLowerCase()),
        unresolvedUtilityTypes,
        addressSourceAcknowledged,
        addressMismatch: Boolean(addressContext.address_mismatch),
      });

      /** @type {Record<string, Record<string, unknown>>} */
      const providerResolutionBySlug = {};
      for (const provider of resolved) {
        const slug = String(provider.slug ?? "").toLowerCase();
        const utilityType = String(provider.utility_type ?? "").trim().toLowerCase();
        if (!slug || !utilityType) continue;
        const resolution = readProviderResolutionForServiceType(project, utilityType);
        if (resolution) {
          providerResolutionBySlug[slug] = resolution;
        }
      }

      const result = await initCoordinationForProviders(supabase, {
        projectId,
        userId: user.id,
        resolvedProviders: resolved,
        providerSetupMetadata,
        providerResolutionBySlug,
      });

      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.get("/coordination/:id", async (req, res) => {
    const suppliedRequestId = String(req.get("x-request-id") || "").trim();
    const requestId = /^[A-Za-z0-9._:-]{1,128}$/.test(suppliedRequestId)
      ? suppliedRequestId
      : crypto.randomUUID();
    const requestStartedAt = Date.now();
    const routeSteps = [];
    const timed = async (step, blocking, task) => {
      const startedAt = Date.now();
      try {
        const value = await task();
        routeSteps.push({
          step,
          duration_ms: Date.now() - startedAt,
          success: true,
          blocking,
          request_id: requestId,
        });
        return value;
      } catch (error) {
        routeSteps.push({
          step,
          duration_ms: Date.now() - startedAt,
          success: false,
          blocking,
          request_id: requestId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    };
    res.set("x-request-id", requestId);
    res.set(
      "Access-Control-Expose-Headers",
      "x-request-id, x-backend-duration-ms, server-timing",
    );

    try {
      const user = await timed("authentication", true, () =>
        requireAuthenticatedUser(req, supabase),
      );
      const coordinationId = String(req.params.id || "").trim();
      const record = await timed("record", true, () =>
        getCoordinationRecordDetailById(supabase, coordinationId),
      );
      if (!record) {
        const err = new Error("Coordination record not found");
        err.statusCode = 404;
        err.code = "NOT_FOUND";
        throw err;
      }

      const projectId = String(record.project_id);
      await timed("access", true, () =>
        requireProjectAccess({ supabase, userId: user.id, projectId }),
      );

      const detail = await timed("children", false, () =>
        getCoordinationDetailBundle(
          supabase,
          coordinationId,
          projectId,
          { record, requestId },
        ),
      );
      detail.hydration.steps = [
        ...routeSteps.filter((step) => step.step !== "children"),
        ...(detail.hydration?.steps ?? []),
      ];
      const response = sanitizeCoordinationDetailBundleForApi(detail);
      const durationMs = Date.now() - requestStartedAt;
      res.set("x-backend-duration-ms", String(durationMs));
      res.set("Server-Timing", `uci-detail;dur=${durationMs}`);
      console.info("[uci-coordination-detail]", {
        request_id: requestId,
        coordination_id: coordinationId,
        status: 200,
        duration_ms: durationMs,
        steps: response.hydration?.steps ?? routeSteps,
      });
      res.json(response);
    } catch (err) {
      const s = sanitizeUciError(err);
      const durationMs = Date.now() - requestStartedAt;
      res.set("x-backend-duration-ms", String(durationMs));
      console.info("[uci-coordination-detail]", {
        request_id: requestId,
        coordination_id: String(req.params.id || "").trim() || null,
        status: s.httpStatus,
        duration_ms: durationMs,
        steps: routeSteps,
      });
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

  router.post("/coordination/:id/complete-stage-2", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const coordinationId = String(req.params.id || "").trim();
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const reason = String(body.reason ?? "").trim();

      if (body.confirm_human_review !== true || !reason) {
        const err = new Error("confirm_human_review=true and a reason are required");
        err.statusCode = 400;
        err.code = "HUMAN_REVIEW_CONFIRMATION_REQUIRED";
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

      const result = await completeStage2EngineeringReview(supabase, {
        coordinationRecordId: coordinationId,
        userId: user.id,
        reason,
      });

      res.json({
        coordination: result.record,
        transition: result.transition,
        stage_2_completed: true,
        stage_3_completed: result.stage3Completed,
        ready_for_stage_4: result.stage3Completed,
        application_id: result.application?.id ?? null,
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

  router.get("/coordination/:id/load-profile/documents", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const coordinationId = String(req.params.id || "").trim();
      const externalApplicationId = String(req.query.external_application_id ?? "").trim();

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
        write: false,
      });

      const result = await getLoadProfileDocumentScope(supabase, {
        coordinationRecordId: coordinationId,
        userId: user.id,
        externalApplicationId,
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/load-profile/documents/link", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const coordinationId = String(req.params.id || "").trim();
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const projectDocumentIds = Array.isArray(body.project_document_ids)
        ? body.project_document_ids.map(String).filter(Boolean)
        : [];
      const externalApplicationId = String(body.external_application_id ?? "").trim();

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

      const result = await linkProjectDocumentsToCoordination(supabase, {
        coordinationRecordId: coordinationId,
        userId: user.id,
        projectDocumentIds,
        includedInAnalysis: body.included_in_analysis !== false,
        linkOrigin: "manual",
        externalApplicationId,
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/load-profile/documents/:documentId/unlink", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const coordinationId = String(req.params.id || "").trim();
      const projectDocumentId = String(req.params.documentId || "").trim();
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const externalApplicationId = String(body.external_application_id ?? "").trim();

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

      const result = await unlinkProjectDocumentFromCoordination(supabase, {
        coordinationRecordId: coordinationId,
        projectDocumentId,
        userId: user.id,
        removeFromAnalysisOnly: body.remove_from_analysis_only === true,
        externalApplicationId,
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/load-profile/documents/:documentId/inclusion", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const coordinationId = String(req.params.id || "").trim();
      const projectDocumentId = String(req.params.documentId || "").trim();
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const externalApplicationId = String(body.external_application_id ?? "").trim();

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

      const result = await setDocumentIncludedInAnalysis(supabase, {
        coordinationRecordId: coordinationId,
        projectDocumentId,
        includedInAnalysis: body.included_in_analysis !== false,
        userId: user.id,
        externalApplicationId,
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/load-profile/import-document-findings", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const coordinationId = String(req.params.id || "").trim();
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const externalApplicationId = String(body.external_application_id ?? "").trim();
      const refresh = body.refresh === true;

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

      const result = await importDocumentFindingsToLoadProfile(supabase, {
        coordinationRecordId: coordinationId,
        userId: user.id,
        externalApplicationId,
        refresh,
      });

      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/document-processing/run", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const coordinationId = String(req.params.id || "").trim();
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const externalApplicationId = String(body.external_application_id ?? "").trim();
      const refresh = body.refresh === true;
      const documentIds = Array.isArray(body.document_ids)
        ? body.document_ids.map(String).filter(Boolean)
        : null;

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

      const result = await runDocumentProcessing(supabase, {
        coordinationRecordId: coordinationId,
        userId: user.id,
        externalApplicationId,
        refresh,
        documentIds,
      });

      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/document-processing/reprocess", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const coordinationId = String(req.params.id || "").trim();
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const externalApplicationId = String(body.external_application_id ?? "").trim();
      const documentId = String(body.document_id ?? "").trim();

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

      const result = await reprocessDocument(supabase, {
        coordinationRecordId: coordinationId,
        userId: user.id,
        externalApplicationId,
        documentId,
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.get("/coordination/:id/document-processing/manifest", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const coordinationId = String(req.params.id || "").trim();
      const externalApplicationId =
        req.query.external_application_id != null
          ? String(req.query.external_application_id).trim()
          : "";
      const includeFindings = req.query.include_findings === "true";

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

      const result = await getDocumentProcessingManifest(supabase, {
        coordinationRecordId: coordinationId,
        externalApplicationId,
        includeFindings,
      });

      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.get("/coordination/:id/document-processing/fallback-estimate", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const coordinationId = String(req.params.id || "").trim();
      const externalApplicationId =
        req.query.external_application_id != null
          ? String(req.query.external_application_id).trim()
          : "";
      const mode = String(req.query.mode ?? "all").trim();

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

      const { getDocumentProcessingState } = require("../services/uci/uci-document-processing.service.js");
      const state = getDocumentProcessingState(record.metadata, externalApplicationId);
      const documents = Array.isArray(state?.documents) ? state.documents : [];
      const estimate = estimateFallbackPages(documents, mode);
      const config = getDocumentFallbackConfig();
      const providerStatus = fallbackProviderStatus(config);

      res.json({
        external_application_id: externalApplicationId,
        mode,
        ...estimate,
        provider_status: providerStatus,
        config: {
          vision_enabled: config.vision_enabled,
          ocr_enabled: config.ocr_enabled,
          vision_max_pages_per_run: config.vision_max_pages_per_run,
          ocr_max_pages_per_run: config.ocr_max_pages_per_run,
        },
      });
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/document-processing/fallback-run", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const coordinationId = String(req.params.id || "").trim();
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const externalApplicationId = String(body.external_application_id ?? "").trim();
      const mode = String(body.mode ?? "all").trim();
      const documentId = body.document_id != null ? String(body.document_id) : null;
      const pageNumbers = Array.isArray(body.page_numbers)
        ? body.page_numbers.map((n) => Number(n)).filter((n) => Number.isFinite(n))
        : null;

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

      const result = await runDocumentFallbackProcessing(supabase, {
        coordinationRecordId: coordinationId,
        userId: user.id,
        externalApplicationId,
        mode,
        documentId,
        pageNumbers,
      });

      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/load-profile/extract-candidates", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const coordinationId = String(req.params.id || "").trim();
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const externalApplicationId = String(body.external_application_id ?? "").trim();
      const refresh = body.refresh === true;

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

      const result = await runLoadCandidateExtraction(supabase, {
        coordinationRecordId: coordinationId,
        userId: user.id,
        externalApplicationId,
        refresh,
      });

      res.json(result);
    } catch (err) {
      console.error("[uci] load-profile/extract-candidates failed:", err);
      if (err && typeof err === "object" && err.code === "LOAD_CANDIDATE_EXTRACTION_FAILED") {
        const extractionErr = /** @type {{ stage?: string, document_name?: string | null, message?: string, statusCode?: number }} */ (
          err
        );
        return res.status(extractionErr.statusCode || 500).json({
          error: "LOAD_CANDIDATE_EXTRACTION_FAILED",
          stage: extractionErr.stage || "unknown",
          document_name: extractionErr.document_name ?? null,
          message: extractionErr.message || "Load candidate extraction failed",
        });
      }
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.get("/coordination/:id/load-profile/candidates", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const coordinationId = String(req.params.id || "").trim();
      const externalApplicationId =
        req.query.external_application_id != null
          ? String(req.query.external_application_id).trim()
          : "";

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

      const result = await listLoadCandidates(supabase, {
        coordinationRecordId: coordinationId,
        externalApplicationId: externalApplicationId || undefined,
      });

      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/load-profile/candidates/resolve", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const coordinationId = String(req.params.id || "").trim();
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const candidateId = String(body.candidate_id ?? "").trim();
      const action = String(body.action ?? "").trim();

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

      const result = await resolveLoadCandidate(supabase, {
        coordinationRecordId: coordinationId,
        userId: user.id,
        candidateId,
        action,
        edited_value: body.edited_value,
        edited_unit: body.edited_unit,
        review_note: body.review_note,
      });

      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/load-profile/verified-values", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const coordinationId = String(req.params.id || "").trim();
      const body = req.body && typeof req.body === "object" ? req.body : {};

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

      const result = await addManualVerifiedValue(supabase, {
        coordinationRecordId: coordinationId,
        userId: user.id,
        field_key: body.field_key,
        value: body.value,
        unit: body.unit,
        source_document_name: body.source_document_name,
        page_number: body.page_number,
        evidence_text: body.evidence_text,
        source_reference: body.source_reference,
        review_note: body.review_note,
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

      const body = req.body && typeof req.body === "object" ? req.body : {};
      const externalApplicationId =
        body.external_application_id != null
          ? String(body.external_application_id).trim()
          : undefined;
      const checklistMode =
        body.checklist_mode != null ? String(body.checklist_mode).trim() : undefined;

      const result = await runApplicationPackageBuild(supabase, {
        coordinationRecordId: coordinationId,
        userId: user.id,
        externalApplicationId,
        checklistMode,
      });

      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.get("/coordination/:id/application-package/document-candidates", async (req, res) => {
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

      const externalApplicationId =
        req.query.external_application_id != null
          ? String(req.query.external_application_id).trim()
          : undefined;

      const result = await listPackageDocumentCandidates(supabase, {
        coordinationRecordId: coordinationId,
        projectId,
        externalApplicationId,
      });

      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/applications/:id/package-documents/confirm", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const applicationId = String(req.params.id || "").trim();
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const slotKey = String(body.slot_key ?? "").trim();
      const candidateId = String(body.candidate_id ?? "").trim();
      const externalApplicationId =
        body.external_application_id != null
          ? String(body.external_application_id).trim()
          : undefined;

      const appRow = await getPackageReviewApplicationById(supabase, applicationId);
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

      const result = await confirmPackageDocumentMapping(supabase, {
        applicationId,
        application: appRow,
        userId: user.id,
        slotKey,
        candidateId,
        externalApplicationId,
      });

      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/applications/:id/package-documents/remove", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const applicationId = String(req.params.id || "").trim();
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const slotKey = String(body.slot_key ?? "").trim();

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

      const result = await removePackageDocumentMapping(supabase, {
        applicationId,
        userId: user.id,
        slotKey,
      });

      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/applications/:id/synthetic-checklist/approve", async (req, res) => {
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
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const result = await approveSyntheticChecklist(supabase, {
        applicationId,
        userId: user.id,
        approverDisplay: user.user_metadata?.full_name || user.email || null,
        note: body.note,
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/applications/:id/synthetic-checklist/signature", async (req, res) => {
    const suppliedRequestId = String(req.get("x-request-id") || "").trim();
    const requestId = /^[A-Za-z0-9._:-]{1,128}$/.test(suppliedRequestId)
      ? suppliedRequestId
      : crypto.randomUUID();
    const requestStartedAt = Date.now();
    const stageTimings = {};
    let responseLogged = false;
    res.set("x-request-id", requestId);
    const logResponse = (outcome) => {
      if (responseLogged) return;
      responseLogged = true;
      console.info("[uci-signature-mutation]", {
        request_id: requestId,
        application_id: String(req.params.id || "").trim() || null,
        outcome,
        status: res.statusCode,
        total_ms: Date.now() - requestStartedAt,
        ...stageTimings,
      });
    };
    res.once("finish", () => logResponse("response_sent"));
    res.once("close", () =>
      logResponse(res.writableEnded ? "response_sent" : "client_closed"),
    );
    console.info("[uci-signature-mutation]", {
      request_id: requestId,
      application_id: String(req.params.id || "").trim() || null,
      outcome: "request_received",
    });
    try {
      let stageStartedAt = Date.now();
      const user = await requireAuthenticatedUser(req, supabase);
      stageTimings.auth_ms = Date.now() - stageStartedAt;
      const applicationId = String(req.params.id || "").trim();
      stageStartedAt = Date.now();
      const appRow = await getPackageReviewApplicationById(supabase, applicationId);
      stageTimings.application_fetch_ms = Date.now() - stageStartedAt;
      if (!appRow) {
        const err = new Error("Application not found");
        err.statusCode = 404;
        err.code = "NOT_FOUND";
        throw err;
      }
      stageStartedAt = Date.now();
      await requireProjectAccess({
        supabase,
        userId: user.id,
        projectId: String(appRow.project_id),
        write: true,
      });
      stageTimings.access_check_ms = Date.now() - stageStartedAt;
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const result = await setSyntheticSignatureStatus(supabase, {
        applicationId,
        application: appRow,
        userId: user.id,
        documentKey: body.document_key,
        signatureStatus: body.signature_status,
        reviewNote: body.review_note,
      });
      Object.assign(stageTimings, result.timings);
      stageTimings.before_response_ms = Date.now() - requestStartedAt;
      res.set(
        "Server-Timing",
        [
          `auth;dur=${stageTimings.auth_ms}`,
          `application;dur=${stageTimings.application_fetch_ms}`,
          `access;dur=${stageTimings.access_check_ms}`,
          `readiness;dur=${stageTimings.readiness_recompute_ms}`,
          `db;dur=${stageTimings.db_write_ms}`,
        ].join(", "),
      );
      res.json({
        ...result,
        timings: {
          ...stageTimings,
          total_ms: Date.now() - requestStartedAt,
        },
      });
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.get("/applications/:id/synthetic-checklist/export", async (req, res) => {
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
      });
      const result = await exportSyntheticChecklistPackage(supabase, { applicationId });
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="uci-synthetic-checklist-${applicationId}.json"`,
      );
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.get("/applications/:id/package/documents/:documentKey/open", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const applicationId = String(req.params.id || "").trim();
      const documentKey = String(req.params.documentKey || "").trim();
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
      });
      const context = await loadPackageExportContext(supabase, {
        applicationId,
        application: appRow,
      });
      const originals = await resolveMappedOriginals(supabase, context);
      const original = originals.find((entry) => entry.key === documentKey);
      if (!original) {
        const err = new Error("Mapped package document not found");
        err.statusCode = 404;
        err.code = "PACKAGE_DOCUMENT_NOT_FOUND";
        throw err;
      }
      const safeName = String(original.original_file_name || "document.bin").replace(/["\r\n]/g, "_");
      const extension = safeName.split(".").pop()?.toLowerCase();
      const contentType =
        extension === "pdf"
          ? "application/pdf"
          : extension === "png"
            ? "image/png"
            : extension === "jpg" || extension === "jpeg"
              ? "image/jpeg"
              : "application/octet-stream";
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `inline; filename="${safeName}"`);
      return res.send(original.buffer);
    } catch (err) {
      const s = sanitizeUciError(err);
      return res.status(s.httpStatus).json(s.body);
    }
  });

  router.get("/applications/:id/package/export/:format", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const applicationId = String(req.params.id || "").trim();
      const format = String(req.params.format || "").trim().toLowerCase();
      if (!["structured-json", "summary.pdf", "complete.zip"].includes(format)) {
        const err = new Error("Export format must be structured-json, summary.pdf, or complete.zip");
        err.statusCode = 400;
        err.code = "INVALID_PACKAGE_EXPORT_FORMAT";
        throw err;
      }
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
      });
      const context = await loadPackageExportContext(supabase, {
        applicationId,
        application: appRow,
      });
      const generatedAt = new Date().toISOString();
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");

      if (format === "structured-json") {
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="uci-package-${applicationId}-structured.json"`,
        );
        return res.json(buildStructuredPackageExport(context, generatedAt));
      }
      if (format === "summary.pdf") {
        const pdf = await renderPackageSummaryPdf(context, generatedAt);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="uci-package-${applicationId}-summary.pdf"`,
        );
        res.setHeader("Content-Length", String(pdf.length));
        return res.send(pdf);
      }

      const zip = await buildCompletePackageZip(supabase, context, generatedAt);
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="uci-package-${applicationId}-complete.zip"`,
      );
      res.setHeader("Content-Length", String(zip.buffer.length));
      return res.send(zip.buffer);
    } catch (err) {
      const s = sanitizeUciError(err);
      return res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/applications/:id/package-review/items", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const applicationId = String(req.params.id || "").trim();
      const appRow = await getPackageReviewApplicationById(supabase, applicationId);
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
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const result = await updatePackageReviewItem(supabase, {
        applicationId,
        application: appRow,
        userId: user.id,
        kind: body.kind,
        key: body.item_key,
        status: body.status,
        note: body.note,
        issueArea: body.issue_area,
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/applications/:id/package-review/confirm-verified-fields", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const applicationId = String(req.params.id || "").trim();
      const appRow = await getPackageReviewApplicationById(supabase, applicationId);
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
      const result = await confirmAllVerifiedFields(supabase, {
        applicationId,
        application: appRow,
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

      const appRow = await getPackageReviewApplicationById(supabase, applicationId);
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
        application: appRow,
        userId: user.id,
        reviewerDisplay: user.email || user.user_metadata?.full_name || user.id,
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

      const body = req.body && typeof req.body === "object" ? req.body : {};

      const result = await submitApplicationPackage(supabase, {
        applicationId,
        userId: user.id,
        options: {
          live_submission_confirmed:
            body.live_submission_confirmed === true || body.live_submission_confirmed === "true",
          portal_populate: body.portal_populate === true || body.portal_populate === "true",
          credential_id:
            body.credential_id != null ? String(body.credential_id).trim() : undefined,
        },
      });

      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  /** Stage 4 P0 — validation_only; never Graph/portal/Stage 5. */
  router.post("/applications/:id/validation-attempts", async (req, res) => {
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

      const result = await validateSubmissionPackage(supabase, {
        applicationId,
        userId: user.id,
      });

      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.get("/applications/:id/validation-attempts", async (req, res) => {
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
        write: false,
      });

      const result = await listSubmissionValidationAttempts(supabase, applicationId);
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  /** Stage 4 P1 — Prepare → Preview → Confirm (email). Never Graph sendMail / Stage 5. */
  router.post("/applications/:id/submission-preparations", async (req, res) => {
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
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const result = await prepareSubmission(supabase, {
        applicationId,
        userId: user.id,
        options: body,
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.get("/applications/:id/submission-preparations", async (req, res) => {
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
        write: false,
      });
      const result = await listSubmissionPreparations(supabase, applicationId, {
        userId: user.id,
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.get("/applications/:id/submission-preparations/:prepId", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const applicationId = String(req.params.id || "").trim();
      const preparationId = String(req.params.prepId || "").trim();
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
        write: false,
      });
      const result = await getSubmissionPreparationPreview(supabase, {
        applicationId,
        preparationId,
        userId: user.id,
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.patch("/applications/:id/submission-preparations/:prepId", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const applicationId = String(req.params.id || "").trim();
      const preparationId = String(req.params.prepId || "").trim();
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
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const result = await updateSubmissionPreparation(supabase, {
        applicationId,
        preparationId,
        userId: user.id,
        patch: body,
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/applications/:id/submission-preparations/:prepId/confirm", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const applicationId = String(req.params.id || "").trim();
      const preparationId = String(req.params.prepId || "").trim();
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
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const result = await confirmSubmissionPreparation(supabase, {
        applicationId,
        preparationId,
        userId: user.id,
        options: body,
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  /** Stage 4 controlled live email transmission — Graph sendMail once; Stage 5 via reconcile endpoint. */
  router.post("/applications/:id/submission-preparations/:prepId/transmit", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const applicationId = String(req.params.id || "").trim();
      const preparationId = String(req.params.prepId || "").trim();
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
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const result = await transmitSubmissionPreparation(supabase, {
        applicationId,
        preparationId,
        userId: user.id,
        options: body,
      });
      const httpStatus = result.ok || result.idempotent_replay ? 200 : result.status === "outcome_unknown" ? 409 : 502;
      res.status(httpStatus).json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  /** Stage 4→5 handoff after live transmission is successfully sent/reconciled. */
  router.post("/applications/:id/reconcile-stage5", async (req, res) => {
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
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const result = await reconcileLiveTransmissionIntoStage5(supabase, {
        applicationId,
        userId: user.id,
        transmissionId: body.transmission_id ? String(body.transmission_id) : undefined,
        preparationId: body.preparation_id ? String(body.preparation_id) : undefined,
        utilityTicketNumber: body.utility_ticket_number
          ? String(body.utility_ticket_number)
          : undefined,
      });
      if (result.coordination_record) {
        // Guard: Stage 6 must not start from Stage 5 entry
        if (Number(result.coordination_record.current_stage) >= 6) {
          const err = new Error("Stage 6 must not start from Stage 5 entry");
          err.statusCode = 500;
          err.code = "STAGE_6_PREMATURE";
          throw err;
        }
      }
      res.json({ ...result, can_enter_stage_6: canEnterStage6(result.coordination_record || {}) });
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

  router.post("/communications/:id/flag-for-review", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const communicationId = String(req.params.id || "").trim();
      const body = req.body && typeof req.body === "object" ? req.body : {};
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
      const result = await flagCommunicationForReview(supabase, {
        communicationId,
        userId: user.id,
        note: body.note != null ? String(body.note) : undefined,
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/communications/:id/reject", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const communicationId = String(req.params.id || "").trim();
      const body = req.body && typeof req.body === "object" ? req.body : {};
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
      const result = await rejectCommunicationAsIrrelevant(supabase, {
        communicationId,
        userId: user.id,
        note: body.note != null ? String(body.note) : undefined,
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/communications/:id/rematch", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const communicationId = String(req.params.id || "").trim();
      const body = req.body && typeof req.body === "object" ? req.body : {};
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
      const result = await rematchCommunication(supabase, {
        communicationId,
        userId: user.id,
        coordinationRecordId: body.coordination_record_id
          ? String(body.coordination_record_id)
          : undefined,
        note: body.note != null ? String(body.note) : undefined,
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/communications/:id/confirm", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const communicationId = String(req.params.id || "").trim();
      const body = req.body && typeof req.body === "object" ? req.body : {};
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
      const result = await confirmCommunicationReview(supabase, {
        communicationId,
        userId: user.id,
        classification: body.classification ? String(body.classification) : undefined,
        extractedFields:
          body.extracted_fields && typeof body.extracted_fields === "object"
            ? body.extracted_fields
            : {},
        note: body.note != null ? String(body.note) : undefined,
        applyLifecycle: body.apply_lifecycle !== false,
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/communications/:id/notes", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const communicationId = String(req.params.id || "").trim();
      const body = req.body && typeof req.body === "object" ? req.body : {};
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
      const result = await addCommunicationReviewNote(supabase, {
        communicationId,
        userId: user.id,
        note: body.note,
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/communications/inbound/graph-poll", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const projectId = body.project_id ? String(body.project_id).trim() : null;
      if (projectId) {
        await requireProjectAccess({ supabase, userId: user.id, projectId, write: true });
      }
      const result = await pollGraphInboundForUser(supabase, {
        userId: user.id,
        projectId,
        tenantId: body.tenant_id ? String(body.tenant_id) : null,
        providerSlug: body.provider_slug ? String(body.provider_slug) : null,
        top: body.top != null ? Number(body.top) : 25,
        receivedAfterIso: body.received_after ? String(body.received_after) : null,
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/ack-sla/evaluate", async (req, res) => {
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
      });
      const result = await evaluateAcknowledgmentSla(supabase, coordinationId);
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/ack-sla/sweep", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      // Operator-scoped: only evaluates records the user can already read via RLS
      void user;
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const result = await sweepAcknowledgmentSlas(supabase, {
        limit: body.limit != null ? Number(body.limit) : 50,
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
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const projectDocumentIds = Array.isArray(body.project_document_ids)
        ? body.project_document_ids.map((id) => String(id)).filter(Boolean)
        : body.project_document_id
          ? [String(body.project_document_id)]
          : [];
      const result = await runCosDiscrepancyAnalysis(supabase, {
        coordinationRecordId: coordinationId,
        userId: user.id,
        communicationId: body.communication_id ? String(body.communication_id) : null,
        attachments: Array.isArray(body.attachments) ? body.attachments : [],
        projectDocumentIds,
        triggeredBy: body.triggered_by
          ? String(body.triggered_by)
          : projectDocumentIds.length
            ? "select_existing"
            : "manual",
        advisoryOnly: body.advisory_only === true,
        deps: {
          forceNewVersion: body.force_new_version === true || projectDocumentIds.length > 0,
        },
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.get("/coordination/:id/cos/records", async (req, res) => {
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
        write: false,
      });
      const records = await listCosDesignRecords(
        supabase,
        coordinationId,
        String(record.project_id),
      );
      const current = records.find((r) => r.is_current) || (await getCurrentCosDesignRecord(supabase, coordinationId));
      res.json({
        records,
        current,
        can_enter_stage_6: canEnterStage6(record),
        can_enter_stage_7: canEnterStage7(record),
      });
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/cos/enter", async (req, res) => {
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
      const result = await enterStage6(supabase, {
        coordinationRecordId: coordinationId,
        reason: "Manual Stage 6 entry",
        triggeredByType: "user",
        triggeredById: user.id,
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/cos/approve", async (req, res) => {
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
      const result = await approveCosDesign(supabase, {
        coordinationRecordId: coordinationId,
        userId: user.id,
        cosDesignRecordId: body.cos_design_record_id ? String(body.cos_design_record_id) : null,
        notes: body.notes != null ? String(body.notes) : null,
        acceptMaterialDeviation: body.accept_material_deviation === true,
        acceptedDeviations: Array.isArray(body.accepted_deviations)
          ? body.accepted_deviations
          : [],
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/cos/accepted-fields", async (req, res) => {
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
      const result = await updateCosAcceptedFields(supabase, {
        coordinationRecordId: coordinationId,
        userId: user.id,
        cosDesignRecordId: body.cos_design_record_id ? String(body.cos_design_record_id) : null,
        updates: Array.isArray(body.updates) ? body.updates : [],
        resetFields: Array.isArray(body.reset_fields)
          ? body.reset_fields
          : body.reset_field
            ? [String(body.reset_field)]
            : [],
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/cos/revision", async (req, res) => {
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
      const result = await requestCosRevision(supabase, {
        coordinationRecordId: coordinationId,
        userId: user.id,
        notes: body.notes != null ? String(body.notes) : "Revision requested",
        requiredDocuments: Array.isArray(body.required_documents)
          ? body.required_documents
          : [],
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/cos/reject", async (req, res) => {
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
      const result = await rejectCosDocument(supabase, {
        coordinationRecordId: coordinationId,
        userId: user.id,
        reason: body.reason != null ? String(body.reason) : "",
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/cos/flag", async (req, res) => {
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
      const result = await flagCosForReview(supabase, {
        coordinationRecordId: coordinationId,
        userId: user.id,
        reason: body.reason != null ? String(body.reason) : "Flagged for engineering review",
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/cos/sla/evaluate", async (req, res) => {
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
      res.json(await evaluateCosSla(supabase, coordinationId));
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/cos/sla/sweep", async (req, res) => {
    try {
      await requireAuthenticatedUser(req, supabase);
      res.json(
        await sweepCosSlas(supabase, {
          limit: Number(req.body?.limit) || 50,
        }),
      );
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

  router.get("/coordination/:id/lifecycle-status", async (req, res) => {
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
      await requireProjectAccess({ supabase, userId: user.id, projectId: String(record.project_id) });
      const [costs, equipment, milestones] = await Promise.all([
        listCostsByCoordination(supabase, coordinationId, String(record.project_id)),
        listEquipmentByCoordination(supabase, coordinationId, String(record.project_id)),
        supabase
          .from("coordination_milestones")
          .select("*")
          .eq("coordination_record_id", coordinationId)
          .eq("project_id", record.project_id)
          .then((r) => (Array.isArray(r.data) ? r.data : [])),
      ]);
      const guards = evaluateLifecycleGuards(record, { costs, equipment, milestones });
      const rollup = await maybeMarkProjectComplete(supabase, String(record.project_id));
      res.json({
        coordination_record_id: coordinationId,
        guards,
        meter_set: meterSetStatus(record, milestones),
        closeout: closeoutStatus(record, costs),
        record_attention: listRecordNeedsAttention(record, { costs, equipment, milestones }),
        project_rollup: rollup,
        cost_types: UCI_COST_TYPES,
        predicted: {
          typical_label: "Typical (P50)",
          conservative_label: "Conservative (P90)",
          predicted_p50_date: record.predicted_p50_date ?? null,
          predicted_p90_date: record.predicted_p90_date ?? null,
        },
      });
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/costs/:costId/approve", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const coordinationId = String(req.params.id || "").trim();
      const costId = String(req.params.costId || "").trim();
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
      const result = await approveCoordinationCost(supabase, {
        costId,
        userId: user.id,
        status: body.status,
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/costs/:costId/record-payment", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const coordinationId = String(req.params.id || "").trim();
      const costId = String(req.params.costId || "").trim();
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
      const result = await recordCostPayment(supabase, {
        costId,
        paidAt: body.paid_at,
        paymentMethod: body.payment_method,
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/costs/:costId/override-bill", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      const coordinationId = String(req.params.id || "").trim();
      const costId = String(req.params.costId || "").trim();
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
      const result = await overrideCostBillingHold(supabase, { costId, userId: user.id });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/complete-stage-7", async (req, res) => {
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
      const result = await maybeCompleteStage7(supabase, {
        coordinationRecordId: coordinationId,
        userId: user.id,
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/complete-stage-8", async (req, res) => {
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
      const result = await maybeCompleteStage8(supabase, {
        coordinationRecordId: coordinationId,
        userId: user.id,
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/inspection-release", async (req, res) => {
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
      const result = await recordInspectionRelease(supabase, {
        coordinationRecordId: coordinationId,
        userId: user.id,
        receivedAt: body.received_at,
        notes: body.notes,
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/site-contact", async (req, res) => {
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
      const result = await updateSiteContact(supabase, {
        coordinationRecordId: coordinationId,
        siteContactName: body.site_contact_name,
        siteContactEmail: body.site_contact_email,
        siteContactPhone: body.site_contact_phone,
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/meter-set/request", async (req, res) => {
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
      const result = await requestMeterSet(supabase, { coordinationRecordId: coordinationId });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/meter-set/confirm-date", async (req, res) => {
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
      const result = await confirmMeterSetDate(supabase, {
        coordinationRecordId: coordinationId,
        scheduledDate: body.scheduled_date,
        userId: user.id,
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/meter-set/confirm-site-readiness", async (req, res) => {
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
      const result = await confirmSiteReadiness(supabase, {
        coordinationRecordId: coordinationId,
        userId: user.id,
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/meter-set/outcome", async (req, res) => {
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
      const result = await recordMeterSetOutcome(supabase, {
        coordinationRecordId: coordinationId,
        outcome: body.outcome,
        actualDate: body.actual_date,
        rescheduleDate: body.reschedule_date,
        userId: user.id,
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/complete-stage-9", async (req, res) => {
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
      const result = await completeStage9IfReady(supabase, {
        coordinationRecordId: coordinationId,
        userId: user.id,
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/closeout/artifacts", async (req, res) => {
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
      const result = await attachCloseoutArtifact(supabase, {
        coordinationRecordId: coordinationId,
        kind: body.kind,
        docId: body.doc_id,
        label: body.label,
        source: body.source || "operator",
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/closeout/mark-energized", async (req, res) => {
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
      const result = await captureEnergizationDate(supabase, {
        coordinationRecordId: coordinationId,
        actualDate: body.actual_date,
        source: "operator",
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/closeout/resolve-date-conflict", async (req, res) => {
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
      const result = await resolveEnergizationDateConflict(supabase, {
        coordinationRecordId: coordinationId,
        keep: body.keep,
        userId: user.id,
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/closeout/generate", async (req, res) => {
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
      const result = await generateAndArchiveCloseout(supabase, {
        coordinationRecordId: coordinationId,
        userId: user.id,
      });
      res.json({
        coordination_record_id: coordinationId,
        document_id: result.archived.document_id,
        hash: result.pdf.hash,
        sections: result.sections,
        reused: result.archived.reused === true,
        record: result.record,
      });
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/coordination/:id/complete-stage-10", async (req, res) => {
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
      const result = await completeStage10IfReady(supabase, {
        coordinationRecordId: coordinationId,
        userId: user.id,
      });
      res.json(result);
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  });

  router.post("/ops/lifecycle/sweep", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabase);
      void user;
      const opsToken = process.env.UCI_OPS_SWEEP_TOKEN;
      const provided = String(req.headers["x-uci-ops-token"] || "").trim();
      if (opsToken && provided !== opsToken) {
        const err = new Error("Ops sweep token required");
        err.statusCode = 403;
        err.code = "OPS_ONLY";
        throw err;
      }
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const result = await runOpsLifecycleSweep(supabase, { limit: body.limit });
      res.json({ ops_only: true, happy_path: false, ...result });
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
