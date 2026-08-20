"use strict";

/**
 * Agent 1 — Utility Provider Mapper.
 * Creates one coordination_record per required utility type (nullable provider).
 * Unique electric territory match may bind; missing/ambiguous never auto-binds.
 * Confirmed mapping → Stage 1 COMPLETED so Agent 2 can fire.
 */

const { getProjectForUciAccess, getProjectTenantId } = require("./uci-access.service.js");
const { listActiveProvidersForTenant } = require("./uci-providers-tenant.service.js");
const { listCoordinationRecordsByProject } = require("./uci-records.service.js");
const { UCI_SUPPORTED_UTILITY_TYPES } = require("./uci-utility-types.js");
const {
  resolveSiteAddressSnapshot,
  persistProjectSiteAddress,
  mergeRecordSiteAddress,
} = require("./uci-site-address.service.js");
const { buildProviderSetupAddressContext } = require("./uci-provider-setup.service.js");
const { resolveElectricTerritory } = require("./territory/electric-territory-resolver.service.js");
const { recordSystemTransition } = require("./uci-transitions.service.js");
const { raiseUciAlert } = require("./uci-alerts.service.js");
const { emitUciEvent } = require("./uci-events.service.js");

const DEFAULT_REQUIRED_TYPES = Object.freeze(["electric", "gas", "water", "sewer"]);
const EMPTY_SCOPE = "";

function asObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return /** @type {Record<string, unknown>} */ (value);
  }
  return {};
}

function requiredUtilityTypes(project) {
  const portal = asObject(project.portal_data);
  const fromPortal = portal.uci_required_utility_types;
  if (Array.isArray(fromPortal) && fromPortal.length) {
    return fromPortal
      .map((t) => String(t).trim().toLowerCase())
      .filter((t) => UCI_SUPPORTED_UTILITY_TYPES.includes(t));
  }
  const extra = String(project.project_type || "").toLowerCase().includes("telecom")
    ? ["telecom"]
    : [];
  return [...DEFAULT_REQUIRED_TYPES, ...extra];
}

function providersForType(providers, utilityType) {
  return providers.filter((p) => String(p.utility_type || "").toLowerCase() === utilityType);
}

async function upsertCoverageRow(supabase, params) {
  const {
    projectId,
    userId,
    tenantId,
    utilityType,
    providerId,
    stageState,
    metadata,
    reason,
  } = params;

  const { data: existing } = await supabase
    .from("coordination_records")
    .select("*")
    .eq("project_id", projectId)
    .eq("utility_type", utilityType)
    .eq("scope_description", EMPTY_SCOPE)
    .maybeSingle();

  const now = new Date().toISOString();
  if (existing) {
    const patch = {
      metadata: { ...asObject(existing.metadata), ...asObject(metadata) },
    };
    if (providerId && !existing.utility_provider_id) {
      patch.utility_provider_id = providerId;
    }
    if (tenantId && !existing.tenant_id) patch.tenant_id = tenantId;
    const { data: updated } = await supabase
      .from("coordination_records")
      .update(patch)
      .eq("id", existing.id)
      .select("*")
      .single();
    const row = updated || { ...existing, ...patch };
    if (String(row.current_stage_state) !== stageState || Number(row.current_stage) !== 1) {
      try {
        const trans = await recordSystemTransition(supabase, {
          coordinationRecordId: String(row.id),
          toStage: 1,
          toState: stageState,
          reason,
          triggeredByType: "agent",
          triggeredById: "agent_1_provider_mapper",
          metadata: { action: "agent_1_coverage" },
        });
        return { record: trans.record, created: false, transitioned: true };
      } catch {
        return { record: row, created: false, transitioned: false };
      }
    }
    return { record: row, created: false, transitioned: false };
  }

  const insertRow = {
    project_id: projectId,
    user_id: userId,
    tenant_id: tenantId,
    utility_provider_id: providerId,
    utility_type: utilityType,
    scope_description: EMPTY_SCOPE,
    current_stage: 1,
    current_stage_state: stageState,
    current_stage_entered_at: now,
    metadata: asObject(metadata),
  };

  const { data: inserted, error } = await supabase
    .from("coordination_records")
    .insert(insertRow)
    .select("*")
    .single();
  if (error) {
    throw Object.assign(new Error(error.message || "Failed to create coordination record"), {
      cause: error,
      statusCode: 500,
      code: "COORDINATION_INSERT_FAILED",
    });
  }

  await supabase.from("coordination_stage_transitions").insert({
    coordination_record_id: inserted.id,
    project_id: projectId,
    from_stage: null,
    from_state: null,
    to_stage: 1,
    to_state: stageState,
    triggered_by_type: "agent",
    triggered_by_id: null,
    reason,
    metadata: { agent: "agent_1_provider_mapper" },
  });

  emitUciEvent(
    "uci.coordination_record.created",
    {
      coordination_record_id: inserted.id,
      project_id: projectId,
      utility_type: utilityType,
      current_stage_state: stageState,
    },
    { supabase },
  );

  return { record: inserted, created: true, transitioned: true };
}

async function maybeRunAgent2(supabase, record, userId) {
  if (Number(record.current_stage) !== 1 || String(record.current_stage_state) !== "COMPLETED") {
    return { ran: false };
  }
  if (!record.utility_provider_id) return { ran: false };
  try {
    const { runLoadProfileAnalysis } = require("./uci-load-profile.service.js");
    const result = await runLoadProfileAnalysis(supabase, {
      coordinationRecordId: String(record.id),
      userId,
    });
    return { ran: true, result };
  } catch (err) {
    return { ran: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Idempotent Agent 1 run. Safe on every /uci project open.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function mapProjectUtilities(supabase, params) {
  const { projectId, userId, deps = {} } = params;
  const project = await getProjectForUciAccess({ supabase, userId, projectId });
  if (!project) {
    const err = new Error("Project not found");
    err.statusCode = 404;
    err.code = "PROJECT_NOT_FOUND";
    throw err;
  }

  const tenantRow = await getProjectTenantId(supabase, projectId);
  const tenantId = tenantRow?.tenant_id ? String(tenantRow.tenant_id) : null;
  const providers = await listActiveProvidersForTenant(supabase, tenantId);
  const types = requiredUtilityTypes(project);

  const snapshot = await resolveSiteAddressSnapshot(project, { geocodeFn: deps.geocodeFn });
  let projectAfter = project;
  try {
    projectAfter = await persistProjectSiteAddress(supabase, project, snapshot);
  } catch {
    projectAfter = project;
  }

  if (!snapshot.ok) {
    emitUciEvent(
      "uci.provider_mapping_blocked",
      { project_id: projectId, code: snapshot.code || "GEOCODING_FAILED" },
      { supabase },
    );
  }

  const addressContext = buildProviderSetupAddressContext(projectAfter);
  /** @type {Record<string, unknown> | null} */
  let electricResolution = null;
  if (types.includes("electric")) {
    try {
      electricResolution = await resolveElectricTerritory({
        projectId,
        addressContext,
        tenantProviders: providers.filter((p) => String(p.utility_type) === "electric"),
      });
    } catch {
      electricResolution = null;
    }
  }

  /** @type {Array<Record<string, unknown>>} */
  const results = [];

  for (const utilityType of types) {
    const typeProviders = providersForType(providers, utilityType);
    let providerId = null;
    let stageState = "BLOCKED";
    let reason = `No ${utilityType} provider in directory`;
    const mappingMeta = {
      uci_site_address: snapshot,
      uci_provider_mapping: {
        method: "agent_1_mapper",
        utility_type: utilityType,
        generated_at: new Date().toISOString(),
      },
    };

    if (utilityType === "electric" && electricResolution) {
      mappingMeta.uci_provider_resolution = electricResolution;
      const status = String(electricResolution.status || "");
      const suggested = electricResolution.suggested_provider_id
        ? String(electricResolution.suggested_provider_id)
        : null;
      const candidates = Array.isArray(electricResolution.candidates)
        ? electricResolution.candidates
        : [];
      const uniqueBindable =
        status === "resolved" &&
        suggested &&
        typeProviders.some((p) => String(p.id) === suggested) &&
        candidates.length === 1 &&
        electricResolution.boundary_risk !== true;

      if (uniqueBindable) {
        providerId = suggested;
        stageState = "COMPLETED";
        reason = "Electric territory uniquely matched";
      } else if (candidates.length > 1 || electricResolution.requires_human_confirmation) {
        stageState = "IN_PROGRESS";
        reason = "Electric provider mapping requires human confirmation";
      } else if (status === "geocoding_failed" || !snapshot.ok) {
        stageState = "BLOCKED";
        reason = "Address geocoding failed";
      } else {
        stageState = "BLOCKED";
        reason = "No electric provider mapped";
      }
    } else if (typeProviders.length === 1) {
      // Non-electric: never auto-bind. Placeholder stays BLOCKED until human confirm.
      mappingMeta.uci_provider_mapping.suggested_provider_id = typeProviders[0].id;
      mappingMeta.uci_provider_mapping.suggested_provider_slug = typeProviders[0].slug;
      stageState = "BLOCKED";
      reason = `${utilityType} provider must be confirmed by a human`;
    } else if (typeProviders.length > 1) {
      mappingMeta.uci_provider_mapping.ambiguous_provider_ids = typeProviders.map((p) => p.id);
      stageState = "IN_PROGRESS";
      reason = `Multiple ${utilityType} providers — human selection required`;
    }

    const upserted = await upsertCoverageRow(supabase, {
      projectId,
      userId,
      tenantId,
      utilityType,
      providerId,
      stageState,
      metadata: mappingMeta,
      reason,
    });

    if (stageState === "BLOCKED" || !snapshot.ok) {
      await raiseUciAlert(supabase, {
        record: upserted.record,
        severity: snapshot.ok ? "P2" : "P1",
        code: snapshot.ok ? "PROVIDER_MAPPING_BLOCKED" : "GEOCODING_FAILED",
        message: reason,
      }).catch(() => null);
    }

    const agent2 = await maybeRunAgent2(supabase, upserted.record, userId);
    results.push({ ...upserted, agent2, utility_type: utilityType, stage_state: stageState });
  }

  const records = await listCoordinationRecordsByProject(supabase, projectId);
  return {
    project_id: projectId,
    site_address: snapshot,
    required_utility_types: types,
    results,
    records,
  };
}

/**
 * Apply human-confirmed providers onto coverage rows (fill NULL provider_id).
 */
async function applyConfirmedProviders(supabase, params) {
  const { projectId, userId, resolvedProviders, providerSetupMetadata, providerResolutionBySlug } = params;
  const tenantRow = await getProjectTenantId(supabase, projectId);
  const tenantId = tenantRow?.tenant_id ? String(tenantRow.tenant_id) : null;
  const { mergeProviderMappingMetadata } = require("./uci-records.service.js");
  const { mergeProviderResolutionIntoCoordinationMetadata } = require("./uci-provider-resolution-persistence.js");

  const existing = await listCoordinationRecordsByProject(supabase, projectId);
  const byType = new Map(existing.map((r) => [String(r.utility_type).toLowerCase(), r]));

  /** @type {Array<Record<string, unknown>>} */
  const created = [];
  /** @type {Array<Record<string, unknown>>} */
  const updated = [];

  for (const provider of resolvedProviders) {
    const utilityType = String(provider.utility_type || "").toLowerCase();
    const slug = String(provider.slug || "").toLowerCase();
    let metadata = providerSetupMetadata && slug
      ? mergeProviderMappingMetadata({}, providerSetupMetadata, slug)
      : {};
    const resolution = providerResolutionBySlug && slug ? providerResolutionBySlug[slug] : null;
    if (resolution) metadata = mergeProviderResolutionIntoCoordinationMetadata(metadata, resolution);

    const current = byType.get(utilityType);
    if (current) {
      const nextMeta = { ...asObject(current.metadata), ...metadata };
      const { data } = await supabase
        .from("coordination_records")
        .update({
          utility_provider_id: provider.id,
          tenant_id: current.tenant_id || tenantId,
          metadata: nextMeta,
        })
        .eq("id", current.id)
        .select("*")
        .single();
      const row = data || { ...current, utility_provider_id: provider.id, metadata: nextMeta };
      try {
        const trans = await recordSystemTransition(supabase, {
          coordinationRecordId: String(row.id),
          toStage: 1,
          toState: "COMPLETED",
          reason: "Human confirmed utility provider mapping",
          triggeredByType: "user",
          triggeredById: userId,
          metadata: { action: "agent_1_human_confirm", provider_slug: slug },
        });
        updated.push(trans.record);
        await maybeRunAgent2(supabase, trans.record, userId);
      } catch {
        updated.push(row);
      }
    } else {
      const upserted = await upsertCoverageRow(supabase, {
        projectId,
        userId,
        tenantId,
        utilityType,
        providerId: provider.id,
        stageState: "COMPLETED",
        metadata,
        reason: "Human confirmed utility provider mapping",
      });
      created.push(upserted.record);
      await maybeRunAgent2(supabase, upserted.record, userId);
    }
  }

  const records = await listCoordinationRecordsByProject(supabase, projectId);
  return { created, already_existed: updated, records };
}

module.exports = {
  DEFAULT_REQUIRED_TYPES,
  requiredUtilityTypes,
  mapProjectUtilities,
  applyConfirmedProviders,
  maybeRunAgent2,
};
