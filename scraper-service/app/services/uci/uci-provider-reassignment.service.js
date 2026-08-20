"use strict";

const {
  getProjectForUciAccess,
  getProjectTenantId,
  requireCoordinationRecordAccess,
} = require("./uci-access.service.js");
const { listActiveProvidersForTenant } = require("./uci-providers-tenant.service.js");
const {
  listCoordinationRecordsByProject,
  mergeProviderMappingMetadata,
} = require("./uci-records.service.js");
const {
  buildNextPortalDataWithResolution,
  mergeProviderResolutionIntoCoordinationMetadata,
  readProviderResolutionForServiceType,
} = require("./uci-provider-resolution-persistence.js");
const {
  buildTerritoryUnavailableResolution,
  providerToCandidate,
} = require("./uci-provider-resolution.service.js");
const { buildProviderSetupAddressContext } = require("./uci-provider-setup.service.js");
const { validateProviderResolutionResult } = require("./uci-provider-resolution-contract.js");
const { requireSupportedUtilityType } = require("./uci-utility-types.js");
const { LOAD_PROFILE_IDEMPOTENCY_KEY } = require("./uci-load-profile.service.js");
const { APPLICATION_PACKAGE_IDEMPOTENCY_KEY } = require("./uci-application-builder.service.js");

const PROVIDER_SPECIFIC_METADATA_PREFIXES = ["pepco_"];
const PROVIDER_SPECIFIC_METADATA_KEYS = new Set([
  "uci_last_portal_sync_summary",
  "uci_last_portal_sync_at",
  "uci_lifecycle_proposals",
]);

function asObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return /** @type {Record<string, unknown>} */ (value);
  }
  return {};
}

/**
 * Remove provider-portal and submission artifacts from coordination metadata.
 * Preserves site address, generic Stage 2 readiness, and mapping audit fields.
 *
 * @param {Record<string, unknown>} metadata
 */
function stripProviderSpecificMetadata(metadata) {
  const next = {};
  for (const [key, value] of Object.entries(asObject(metadata))) {
    if (PROVIDER_SPECIFIC_METADATA_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    if (PROVIDER_SPECIFIC_METADATA_KEYS.has(key)) continue;
    next[key] = value;
  }
  return next;
}

/**
 * @param {Record<string, unknown>} application
 * @param {string} oldProviderSlug
 */
function isProviderSpecificApplication(application, oldProviderSlug) {
  const idempotencyKey = String(application.idempotency_key ?? "");
  if (idempotencyKey === LOAD_PROFILE_IDEMPOTENCY_KEY || idempotencyKey.startsWith("agent_2_load_profile:")) {
    return false;
  }
  if (idempotencyKey === APPLICATION_PACKAGE_IDEMPOTENCY_KEY) {
    return true;
  }
  const slug = String(application.provider_slug ?? "").trim().toLowerCase();
  if (slug && slug === oldProviderSlug) return true;
  return false;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 * @param {string} params.coordinationRecordId
 * @param {string} params.userId
 * @param {string} params.newProviderId
 * @param {string} params.reason
 * @param {string | null | undefined} [params.notes]
 */
async function reassignCoordinationProvider(supabase, params) {
  const coordinationRecordId = String(params.coordinationRecordId ?? "").trim();
  const newProviderId = String(params.newProviderId ?? "").trim();
  const reason = String(params.reason ?? "").trim();

  if (!coordinationRecordId || !newProviderId || !reason) {
    const err = new Error("coordination_record_id, provider_id, and reason are required");
    err.statusCode = 400;
    err.code = "INVALID_BODY";
    throw err;
  }

  const record = await requireCoordinationRecordAccess({
    supabase,
    userId: params.userId,
    coordinationRecordId,
    write: true,
  });

  const projectId = String(record.project_id);
  const utilityType = requireSupportedUtilityType(record.utility_type, "utility_type");
  if (!utilityType) {
    const err = new Error("Coordination record has no utility type");
    err.statusCode = 400;
    err.code = "UTILITY_TYPE_REQUIRED";
    throw err;
  }

  const project = await getProjectForUciAccess({
    supabase,
    userId: params.userId,
    projectId,
  });
  if (!project) {
    const err = new Error("Project not found");
    err.statusCode = 404;
    err.code = "PROJECT_NOT_FOUND";
    throw err;
  }

  const tenantRow = await getProjectTenantId(supabase, projectId);
  const providers = await listActiveProvidersForTenant(
    supabase,
    tenantRow?.tenant_id ? String(tenantRow.tenant_id) : null,
  );
  const newProvider = providers.find((row) => String(row.id) === newProviderId);
  if (!newProvider) {
    const err = new Error("Provider not found for this project tenant");
    err.statusCode = 400;
    err.code = "INVALID_PROVIDER";
    throw err;
  }

  const newProviderUtilityType = requireSupportedUtilityType(newProvider.utility_type);
  if (newProviderUtilityType !== utilityType) {
    const err = new Error(
      `Provider utility type (${newProviderUtilityType}) does not match coordination record (${utilityType})`,
    );
    err.statusCode = 400;
    err.code = "SERVICE_TYPE_MISMATCH";
    throw err;
  }

  const oldProviderId = record.utility_provider_id ? String(record.utility_provider_id) : null;
  if (oldProviderId === newProviderId) {
    const err = new Error("Selected provider is already assigned to this coordination record");
    err.statusCode = 400;
    err.code = "PROVIDER_UNCHANGED";
    throw err;
  }

  const embedded = record.utility_providers;
  const oldProviderSlug = Array.isArray(embedded)
    ? embedded[0] && typeof embedded[0] === "object"
      ? String(/** @type {{ slug?: unknown }} */ (embedded[0]).slug ?? "").toLowerCase()
      : ""
    : embedded && typeof embedded === "object"
      ? String(/** @type {{ slug?: unknown }} */ (embedded).slug ?? "").toLowerCase()
      : "";
  const newProviderSlug = String(newProvider.slug ?? "").toLowerCase();
  const reassignedAt = new Date().toISOString();

  const { data: applications, error: appsErr } = await supabase
    .from("coordination_applications")
    .select("id, idempotency_key, provider_slug, submitted_at")
    .eq("coordination_record_id", coordinationRecordId)
    .eq("project_id", projectId);

  if (appsErr) {
    throw Object.assign(new Error(appsErr.message || "Failed to load coordination applications"), {
      cause: appsErr,
      statusCode: 500,
      code: "APPLICATIONS_QUERY_FAILED",
    });
  }

  const appsToRemove = (Array.isArray(applications) ? applications : []).filter((app) =>
    isProviderSpecificApplication(app, oldProviderSlug),
  );
  const removedApplicationIds = appsToRemove.map((app) => String(app.id));

  if (removedApplicationIds.length) {
    const { error: deleteErr } = await supabase
      .from("coordination_applications")
      .delete()
      .in("id", removedApplicationIds);
    if (deleteErr) {
      throw Object.assign(new Error(deleteErr.message || "Failed to remove provider-specific applications"), {
        cause: deleteErr,
        statusCode: 500,
        code: "APPLICATIONS_DELETE_FAILED",
      });
    }
  }

  if (removedApplicationIds.length) {
    await supabase
      .from("submission_validation_attempts")
      .delete()
      .in("coordination_application_id", removedApplicationIds)
      .then(() => null)
      .catch(() => null);
  }

  const existingResolution =
    readProviderResolutionForServiceType(project, utilityType) ??
    buildTerritoryUnavailableResolution({
      serviceType: utilityType,
      addressContext: buildProviderSetupAddressContext(project),
    });

  const resolutionEntry = {
    ...existingResolution,
    service_type: utilityType,
    status: "overridden",
    resolution_method: "manual_selection",
    confidence: existingResolution.confidence ?? "none",
    requires_human_confirmation: false,
    confirmed_provider_id: newProviderId,
    confirmed_by: params.userId,
    confirmed_at: reassignedAt,
    override_reason: reason,
    notes: params.notes != null ? String(params.notes).trim() || null : existingResolution.notes ?? null,
    confirmed_provider_slug: newProviderSlug,
    candidates: existingResolution.candidates?.length
      ? existingResolution.candidates
      : [providerToCandidate(newProvider, "manual_selection")],
  };

  const validation = validateProviderResolutionResult(resolutionEntry);
  if (!validation.ok) {
    const err = new Error(`Invalid reassignment resolution: ${validation.errors.join("; ")}`);
    err.statusCode = 500;
    err.code = "RESOLVER_CONTRACT_VIOLATION";
    throw err;
  }

  const nextPortalData = buildNextPortalDataWithResolution(project, utilityType, resolutionEntry);
  const { error: projectErr } = await supabase
    .from("projects")
    .update({ portal_data: nextPortalData })
    .eq("id", projectId);
  if (projectErr) {
    throw Object.assign(new Error(projectErr.message || "Failed to persist provider reassignment"), {
      cause: projectErr,
      statusCode: 500,
      code: "RESOLUTION_PERSIST_FAILED",
    });
  }

  const priorMetadata = asObject(record.metadata);
  const strippedMetadata = stripProviderSpecificMetadata(priorMetadata);
  const priorHistory = Array.isArray(priorMetadata.uci_provider_reassignment_history)
    ? priorMetadata.uci_provider_reassignment_history
    : [];

  let nextMetadata = mergeProviderMappingMetadata(
    strippedMetadata,
    {
      method: "provider_reassignment",
      confirmed: true,
      confirmed_by_user_id: params.userId,
      confirmed_at: reassignedAt,
      reassignment_reason: reason,
      previous_provider_id: oldProviderId,
      previous_provider_slug: oldProviderSlug || null,
    },
    newProviderSlug,
  );
  nextMetadata = mergeProviderResolutionIntoCoordinationMetadata(nextMetadata, resolutionEntry);
  nextMetadata.uci_provider_reassignment_history = [
    ...priorHistory,
    {
      at: reassignedAt,
      by: params.userId,
      from_provider_id: oldProviderId,
      from_provider_slug: oldProviderSlug || null,
      to_provider_id: newProviderId,
      to_provider_slug: newProviderSlug,
      reason,
      notes: params.notes != null ? String(params.notes).trim() || null : null,
      removed_application_ids: removedApplicationIds,
    },
  ];

  const { data: updatedRecord, error: recordErr } = await supabase
    .from("coordination_records")
    .update({
      utility_provider_id: newProviderId,
      metadata: nextMetadata,
      last_error: null,
    })
    .eq("id", coordinationRecordId)
    .select(
      `
      *,
      utility_providers (
        id,
        slug,
        name,
        utility_type,
        primary_portal_type,
        portal_url,
        automation_status,
        is_active
      )
    `,
    )
    .single();

  if (recordErr) {
    throw Object.assign(new Error(recordErr.message || "Failed to update coordination record"), {
      cause: recordErr,
      statusCode: 500,
      code: "COORDINATION_UPDATE_FAILED",
    });
  }

  /** @type {Record<string, unknown> | null} */
  let applicationPackage = null;
  try {
    const { runApplicationPackageBuild } = require("./uci-application-builder.service.js");
    applicationPackage = await runApplicationPackageBuild(supabase, {
      coordinationRecordId,
      userId: params.userId,
    });
  } catch (buildErr) {
    applicationPackage = {
      status: "failed",
      message: buildErr instanceof Error ? buildErr.message : String(buildErr),
    };
  }

  const records = await listCoordinationRecordsByProject(supabase, projectId);

  return {
    coordination_record: updatedRecord ?? { ...record, utility_provider_id: newProviderId, metadata: nextMetadata },
    project_id: projectId,
    service_type: utilityType,
    resolution: resolutionEntry,
    removed_application_ids: removedApplicationIds,
    application_package: applicationPackage,
    records,
  };
}

module.exports = {
  stripProviderSpecificMetadata,
  isProviderSpecificApplication,
  reassignCoordinationProvider,
};
