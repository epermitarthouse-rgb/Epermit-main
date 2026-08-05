"use strict";

const { resolveUtilityAdapter } = require("./adapters/utility-adapter-registry.js");
const {
  loadTenantContextForCoordination,
  resolveProviderSlugFromRecord,
} = require("./uci-tenant-context.service.js");
const { upsertPortalApplications } = require("./uci-portal-application-sync.service.js");
const { upsertPortalCommunications } = require("./uci-communication-sync.service.js");
const { upsertPortalStatusEvents } = require("./uci-milestone-sync.service.js");
const { emptyCountBucket } = require("./uci-sync-utils.js");
const { processLifecycleMappingAfterSync } = require("./uci-lifecycle-mapping.service.js");

/**
 * @param {unknown} metadata
 * @param {string} providerSlug
 * @returns {Array<Record<string, unknown>>}
 */
function extractPortalApplicationsFromMetadata(metadata, providerSlug) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];

  if (providerSlug === "pepco") {
    const discovery = /** @type {{ applications?: unknown }} */ (metadata)
      .pepco_application_detail_discovery;
    if (
      discovery &&
      typeof discovery === "object" &&
      Array.isArray(/** @type {{ applications?: unknown }} */ (discovery).applications)
    ) {
      return /** @type {Array<Record<string, unknown>>} */ (
        /** @type {{ applications: unknown[] }} */ (discovery).applications
      );
    }
  }

  return [];
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} opts
 * @param {string} opts.coordinationRecordId
 * @param {Array<Record<string, unknown>>} [opts.rawApplications]
 * @param {string} [opts.providerSlug]
 * @returns {Promise<Record<string, unknown>>}
 */
async function runPortalSync(supabase, opts) {
  const coordinationRecordId = String(opts.coordinationRecordId || "").trim();
  const tenantContext = await loadTenantContextForCoordination(
    supabase,
    coordinationRecordId,
  );

  const providerSlug =
    String(opts.providerSlug || "").trim().toLowerCase() ||
    resolveProviderSlugFromRecord(tenantContext.coordinationRecord) ||
    "";

  const { adapter, warnings: adapterWarnings } = resolveUtilityAdapter(providerSlug);

  /** @type {string[]} */
  const warnings = [...adapterWarnings];
  /** @type {string[]} */
  const errors = [];

  let rawApplications = Array.isArray(opts.rawApplications) ? opts.rawApplications : null;

  if (!rawApplications || rawApplications.length === 0) {
    const metadata = tenantContext.coordinationRecord.metadata;
    rawApplications = extractPortalApplicationsFromMetadata(metadata, providerSlug);
  }

  if (!rawApplications.length) {
    const err = new Error(
      "No usable portal application snapshot found. Run portal discovery before sync.",
    );
    err.statusCode = 422;
    err.code = "NO_PORTAL_SNAPSHOT";
    throw err;
  }

  const syncedAt = new Date().toISOString();
  /** @type {import("./adapters/utility-adapter.types.js").AdapterContext} */
  const adapterContext = {
    coordinationRecordId: tenantContext.coordinationRecordId,
    projectId: tenantContext.projectId,
    tenantId: tenantContext.tenantId,
    providerSlug: adapter.providerSlug === "generic" ? providerSlug : adapter.providerSlug,
    syncedAt,
  };

  /** @type {import("./adapters/utility-adapter.types.js").NormalizedApplication[]} */
  const normalizedApplications = [];
  /** @type {import("./adapters/utility-adapter.types.js").NormalizedCommunication[]} */
  const normalizedCommunications = [];
  /** @type {import("./adapters/utility-adapter.types.js").NormalizedStatusEvent[]} */
  const normalizedEvents = [];

  const isCancelRequested =
    typeof opts.isCancelRequested === "function" ? opts.isCancelRequested : null;
  async function cancelled() {
    if (!isCancelRequested) return false;
    try {
      const v = isCancelRequested();
      return !!(v && typeof v.then === "function" ? await v : v);
    } catch (_) {
      return false;
    }
  }

  for (const raw of rawApplications) {
    if (await cancelled()) {
      const err = new Error("Portal sync cancelled");
      err.code = "CANCELLED";
      err.statusCode = 499;
      throw err;
    }
    const app = adapter.normalizeApplication(raw, adapterContext);
    if (app) normalizedApplications.push(app);
    normalizedCommunications.push(...adapter.normalizeMessages(raw, adapterContext));
    normalizedEvents.push(...adapter.normalizeStatusEvents(raw, adapterContext));
  }
  if (await cancelled()) {
    const err = new Error("Portal sync cancelled");
    err.code = "CANCELLED";
    err.statusCode = 499;
    throw err;
  }

  if (adapter.providerSlug === "generic" && normalizedApplications.length === 0) {
    warnings.push("Generic adapter cannot normalize portal applications for this provider.");
  }

  if (await cancelled()) {
    const err = new Error("Portal sync cancelled");
    err.code = "CANCELLED";
    err.statusCode = 499;
    throw err;
  }

  const applicationResult = await upsertPortalApplications(supabase, {
    coordinationRecordId: tenantContext.coordinationRecordId,
    projectId: tenantContext.projectId,
    tenantId: tenantContext.tenantId,
    providerSlug: adapterContext.providerSlug,
    applications: normalizedApplications,
  });

  if (await cancelled()) {
    const err = new Error("Portal sync cancelled");
    err.code = "CANCELLED";
    err.statusCode = 499;
    throw err;
  }

  const communicationResult = await upsertPortalCommunications(supabase, {
    coordinationRecordId: tenantContext.coordinationRecordId,
    projectId: tenantContext.projectId,
    tenantId: tenantContext.tenantId,
    providerSlug: adapterContext.providerSlug,
    communications: normalizedCommunications,
  });

  if (await cancelled()) {
    const err = new Error("Portal sync cancelled");
    err.code = "CANCELLED";
    err.statusCode = 499;
    throw err;
  }

  const milestoneResult = await upsertPortalStatusEvents(supabase, {
    coordinationRecordId: tenantContext.coordinationRecordId,
    projectId: tenantContext.projectId,
    tenantId: tenantContext.tenantId,
    providerSlug: adapterContext.providerSlug,
    events: normalizedEvents,
  });

  errors.push(
    ...applicationResult.errors,
    ...communicationResult.errors,
    ...milestoneResult.errors,
  );

  let lifecycle = {
    status: "not_run",
    evaluated_count: 0,
    applied_count: 0,
    blocked_count: 0,
    auto_apply_enabled: false,
    proposals: [],
    errors: [],
  };

  try {
    lifecycle = await processLifecycleMappingAfterSync(supabase, {
      coordinationRecordId: tenantContext.coordinationRecordId,
      projectId: tenantContext.projectId,
      providerSlug: adapterContext.providerSlug,
      adapter,
      rawApplications,
      normalizedApplications,
      coordinationRecord: tenantContext.coordinationRecord,
    });
  } catch (lifecycleErr) {
    const message =
      lifecycleErr instanceof Error
        ? lifecycleErr.message.slice(0, 500)
        : String(lifecycleErr).slice(0, 500);
    lifecycle = {
      status: "failed",
      evaluated_count: 0,
      applied_count: 0,
      blocked_count: 0,
      auto_apply_enabled: process.env.UCI_AUTO_STAGE_TRANSITIONS === "true",
      proposals: [],
      errors: [message],
    };
    warnings.push(`Lifecycle mapping failed: ${message}`);
  }

  const summary = {
    providerSlug: adapterContext.providerSlug,
    applications: applicationResult.counts,
    communications: communicationResult.counts,
    milestones: milestoneResult.counts,
    lifecycle,
    warnings,
    errors,
    syncedAt,
  };

  try {
    const prevMeta =
      tenantContext.coordinationRecord.metadata &&
      typeof tenantContext.coordinationRecord.metadata === "object" &&
      !Array.isArray(tenantContext.coordinationRecord.metadata)
        ? /** @type {Record<string, unknown>} */ (tenantContext.coordinationRecord.metadata)
        : {};

    const nextMeta = {
      ...prevMeta,
      uci_last_portal_sync_at: syncedAt,
      uci_last_portal_sync_summary: {
        providerSlug: summary.providerSlug,
        applications: summary.applications,
        communications: summary.communications,
        milestones: summary.milestones,
        lifecycle: summary.lifecycle,
        warning_count: warnings.length,
        error_count: errors.length,
      },
    };

    await supabase
      .from("coordination_records")
      .update({ metadata: nextMeta })
      .eq("id", tenantContext.coordinationRecordId)
      .eq("project_id", tenantContext.projectId);
  } catch (metaErr) {
    warnings.push(
      metaErr instanceof Error
        ? `Sync summary metadata update failed: ${metaErr.message}`
        : "Sync summary metadata update failed",
    );
  }

  return summary;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} opts
 * @param {string} opts.coordinationRecordId
 * @param {string} opts.projectId
 * @param {Array<Record<string, unknown>>} opts.applications
 * @param {string} [opts.providerSlug]
 */
async function runPortalSyncFromPepcoApplications(supabase, opts) {
  return runPortalSync(supabase, {
    coordinationRecordId: opts.coordinationRecordId,
    rawApplications: opts.applications,
    providerSlug: opts.providerSlug || "pepco",
  });
}

module.exports = {
  runPortalSync,
  runPortalSyncFromPepcoApplications,
  extractPortalApplicationsFromMetadata,
  emptyCountBucket,
};
