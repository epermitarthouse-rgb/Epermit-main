"use strict";

const {
  listApplicationsForCoordinationDetail,
} = require("./uci-applications.service.js");
const {
  mergeProviderResolutionIntoCoordinationMetadata,
} = require("./uci-provider-resolution-persistence.js");
const { requireSupportedUtilityType } = require("./uci-utility-types.js");

const RECORD_WITH_PROVIDER_SELECT = `
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
`;

const DETAIL_RECORD_SELECT = `
  id,
  project_id,
  user_id,
  tenant_id,
  utility_provider_id,
  utility_type,
  scope_description,
  current_stage,
  current_stage_state,
  utility_account_number,
  utility_contact_name,
  utility_contact_email,
  utility_contact_phone,
  application_submitted_at,
  acknowledgment_received_at,
  class_of_service_issued_at,
  energization_target_date,
  energization_actual_date,
  predicted_p50_date,
  predicted_p90_date,
  agent_monitored,
  last_error,
  created_at,
  updated_at,
  utility_providers (
    id,
    slug,
    name,
    utility_type,
    primary_portal_type,
    portal_url,
    automation_status,
    is_active
  ),
  uci_provider_mapping:metadata->uci_provider_mapping,
  uci_provider_resolution:metadata->uci_provider_resolution,
  uci_lifecycle_proposals:metadata->uci_lifecycle_proposals,
  uci_last_portal_sync_summary:metadata->uci_last_portal_sync_summary,
  uci_last_portal_sync_at:metadata->uci_last_portal_sync_at,
  pepco_application_detail_discovery:metadata->pepco_application_detail_discovery,
  pepco_dashboard_discovery:metadata->pepco_dashboard_discovery,
  pepco_dashboard_discovery_status:metadata->pepco_dashboard_discovery_status,
  pepco_dashboard_last_discovered_at:metadata->pepco_dashboard_last_discovered_at,
  pepco_dashboard_cards_found:metadata->pepco_dashboard_cards_found,
  pepco_dashboard_application_ids_found:metadata->pepco_dashboard_application_ids_found,
  pepco_dashboard_discovery_source:metadata->pepco_dashboard_discovery_source,
  pepco_dashboard_list_api_warning:metadata->pepco_dashboard_list_api_warning,
  pepco_discovery_last_attempt_at:metadata->pepco_discovery_last_attempt_at,
  pepco_discovery_last_status:metadata->pepco_discovery_last_status,
  pepco_discovery_session_status:metadata->pepco_discovery_session_status,
  pepco_mfa_mode:metadata->pepco_mfa_mode,
  pepco_overview_project_name:metadata->pepco_overview_project_name,
  pepco_overview_job_id:metadata->pepco_overview_job_id,
  pepco_current_milestone:metadata->pepco_current_milestone,
  pepco_current_status:metadata->pepco_current_status,
  pepco_status_last_updated_at:metadata->pepco_status_last_updated_at,
  pepco_latest_message_at:metadata->pepco_latest_message_at,
  pepco_document_count:metadata->pepco_document_count,
  pepco_message_count:metadata->pepco_message_count
`;

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} projectId
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
async function listCoordinationRecordsByProject(supabase, projectId) {
  const { data, error } = await supabase
    .from("coordination_records")
    .select(RECORD_WITH_PROVIDER_SELECT)
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to load coordination records"), {
      cause: error,
      statusCode: 500,
      code: "COORDINATION_LIST_FAILED",
    });
  }

  return Array.isArray(data) ? data : [];
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} id
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function getCoordinationRecordById(supabase, id) {
  const { data, error } = await supabase
    .from("coordination_records")
    .select(RECORD_WITH_PROVIDER_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to load coordination record"), {
      cause: error,
      statusCode: 500,
      code: "COORDINATION_FETCH_FAILED",
    });
  }

  return data ?? null;
}

/**
 * Fetch a record for the interactive detail workspace without the large
 * uci_document_processing snapshot. Load Profile obtains that snapshot from
 * its dedicated manifest endpoint only when the tab is opened.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} id
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function getCoordinationRecordDetailById(supabase, id) {
  const { data, error } = await supabase
    .from("coordination_records")
    .select(DETAIL_RECORD_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    throw Object.assign(new Error(error.message || "Failed to load coordination record"), {
      cause: error,
      statusCode: 500,
      code: "COORDINATION_FETCH_FAILED",
    });
  }
  if (!data) return null;

  const metadataKeys = [
    "uci_provider_mapping",
    "uci_provider_resolution",
    "uci_lifecycle_proposals",
    "uci_last_portal_sync_summary",
    "uci_last_portal_sync_at",
    "pepco_application_detail_discovery",
    "pepco_dashboard_discovery",
    "pepco_dashboard_discovery_status",
    "pepco_dashboard_last_discovered_at",
    "pepco_dashboard_cards_found",
    "pepco_dashboard_application_ids_found",
    "pepco_dashboard_discovery_source",
    "pepco_dashboard_list_api_warning",
    "pepco_discovery_last_attempt_at",
    "pepco_discovery_last_status",
    "pepco_discovery_session_status",
    "pepco_mfa_mode",
    "pepco_overview_project_name",
    "pepco_overview_job_id",
    "pepco_current_milestone",
    "pepco_current_status",
    "pepco_status_last_updated_at",
    "pepco_latest_message_at",
    "pepco_document_count",
    "pepco_message_count",
  ];
  const record = { ...data, metadata: {} };
  for (const key of metadataKeys) {
    if (record[key] != null) record.metadata[key] = record[key];
    delete record[key];
  }
  return record;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} coordinationRecordId
 * @param {string} projectId
 * @returns {Promise<Record<string, unknown>>}
 */
async function getCoordinationDetailBundle(
  supabase,
  coordinationRecordId,
  projectId,
  opts = {},
) {
  const record =
    opts.record ?? (await getCoordinationRecordDetailById(supabase, coordinationRecordId));
  if (!record || String(record.project_id) !== projectId) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const hydrate = async (step, task) => {
    const startedAt = Date.now();
    try {
      const result = await task();
      if (result?.error) {
        throw Object.assign(
          new Error(result.error.message || `Failed to load ${step}`),
          { cause: result.error },
        );
      }
      return {
        data: result?.data ?? result ?? [],
        timing: {
          step,
          duration_ms: Date.now() - startedAt,
          success: true,
          blocking: false,
          request_id: opts.requestId ?? null,
        },
        error: null,
      };
    } catch (error) {
      return {
        data: [],
        timing: {
          step,
          duration_ms: Date.now() - startedAt,
          success: false,
          blocking: false,
          request_id: opts.requestId ?? null,
          error: error instanceof Error ? error.message : String(error),
        },
        error: {
          code:
            error && typeof error === "object" && "code" in error
              ? String(error.code)
              : `${step.toUpperCase()}_FETCH_FAILED`,
          message: error instanceof Error ? error.message : `Failed to load ${step}`,
        },
      };
    }
  };

  const [
    transitions,
    applications,
    costs,
    equipment,
    milestones,
    communications,
  ] = await Promise.all([
    hydrate("transitions", () =>
      supabase
      .from("coordination_stage_transitions")
      .select("*")
      .eq("coordination_record_id", coordinationRecordId)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),
    ),
    hydrate("applications", () =>
      listApplicationsForCoordinationDetail(supabase, coordinationRecordId, projectId),
    ),
    hydrate("costs", () =>
      supabase
      .from("coordination_costs")
      .select("*")
      .eq("coordination_record_id", coordinationRecordId)
      .eq("project_id", projectId)
      .order("created_at", { ascending: true }),
    ),
    hydrate("equipment", () =>
      supabase
      .from("coordination_equipment")
      .select("*")
      .eq("coordination_record_id", coordinationRecordId)
      .eq("project_id", projectId)
      .order("created_at", { ascending: true }),
    ),
    hydrate("milestones", () =>
      supabase
      .from("coordination_milestones")
      .select("*")
      .eq("coordination_record_id", coordinationRecordId)
      .eq("project_id", projectId)
      .order("created_at", { ascending: true }),
    ),
    hydrate("communications", () =>
      supabase
      .from("coordination_communications")
      .select("*")
      .eq("coordination_record_id", coordinationRecordId)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(5),
    ),
  ]);

  const children = [transitions, applications, costs, equipment, milestones, communications];
  return {
    record,
    transitions: transitions.data,
    applications: applications.data,
    costs: costs.data,
    equipment: equipment.data,
    milestones: milestones.data,
    communications_recent: communications.data,
    hydration: {
      request_id: opts.requestId ?? null,
      steps: children.map((child) => child.timing),
      errors: Object.fromEntries(
        children
          .filter((child) => child.error)
          .map((child) => [child.timing.step, child.error]),
      ),
    },
  };
}

/**
 * @param {Record<string, unknown>} existingMetadata
 * @param {Record<string, unknown>} mappingMetadata
 * @param {string} providerSlug
 */
function mergeProviderMappingMetadata(existingMetadata, mappingMetadata, providerSlug) {
  const base =
    existingMetadata && typeof existingMetadata === "object" && !Array.isArray(existingMetadata)
      ? { ...existingMetadata }
      : {};

  return {
    ...base,
    uci_provider_mapping: {
      ...mappingMetadata,
      provider_slug: String(providerSlug).toLowerCase(),
    },
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} p
 * @param {string} p.projectId
 * @param {string} p.userId
 * @param {Array<Record<string, unknown>>} p.resolvedProviders
 * @param {Record<string, unknown> | null | undefined} [p.providerSetupMetadata]
 * @param {Record<string, Record<string, unknown>> | null | undefined} [p.providerResolutionBySlug]
 * @returns {Promise<{ created: Array<Record<string, unknown>>, existing: Array<Record<string, unknown>>, records: Array<Record<string, unknown>> }>}
 */
async function initCoordinationForProviders(supabase, p) {
  const { projectId, userId, resolvedProviders, providerSetupMetadata, providerResolutionBySlug } =
    p;

  if (!providerSetupMetadata || typeof providerSetupMetadata !== "object") {
    const err = new Error("provider_setup confirmation metadata is required");
    err.statusCode = 400;
    err.code = "PROVIDER_SETUP_REQUIRED";
    throw err;
  }

  if (!resolvedProviders.length) {
    const err = new Error("No valid providers supplied");
    err.statusCode = 400;
    err.code = "INVALID_BODY";
    throw err;
  }

  const providerIds = resolvedProviders.map((r) => r.id);

  const { data: existingRows, error: exErr } = await supabase
    .from("coordination_records")
    .select("id, utility_provider_id, utility_type")
    .eq("project_id", projectId)
    .eq("scope_description", "")
    .in("utility_provider_id", providerIds);

  if (exErr) {
    throw Object.assign(new Error(exErr.message || "Failed to query existing coordination"), {
      cause: exErr,
      statusCode: 500,
      code: "COORDINATION_QUERY_FAILED",
    });
  }

  const recordKey = (providerId, utilityType) =>
    `${String(providerId)}:${String(utilityType).trim().toLowerCase()}`;
  const existingProviderTypes = new Set(
    (Array.isArray(existingRows) ? existingRows : []).map((r) =>
      recordKey(r.utility_provider_id, r.utility_type),
    ),
  );
  const legacyExistingProviderIds = new Set(
    (Array.isArray(existingRows) ? existingRows : [])
      .filter((r) => !String(r.utility_type ?? "").trim())
      .map((r) => String(r.utility_provider_id)),
  );

  /** @type {Array<Record<string, unknown>>} */
  const created = [];

  for (const provider of resolvedProviders) {
    const pid = provider.id;
    const utilityType = requireSupportedUtilityType(provider.utility_type);
    const providerTypeKey = recordKey(pid, utilityType);
    if (
      existingProviderTypes.has(providerTypeKey) ||
      legacyExistingProviderIds.has(String(pid))
    ) {
      continue;
    }

    const providerSlug = String(provider.slug ?? "").toLowerCase();
    let metadata =
      providerSetupMetadata && providerSlug
        ? mergeProviderMappingMetadata({}, providerSetupMetadata, providerSlug)
        : {};
    const resolutionSnapshot =
      providerResolutionBySlug && providerSlug
        ? providerResolutionBySlug[providerSlug]
        : null;
    if (resolutionSnapshot && typeof resolutionSnapshot === "object") {
      metadata = mergeProviderResolutionIntoCoordinationMetadata(metadata, resolutionSnapshot);
    }

    const insertRow = {
      project_id: projectId,
      user_id: userId,
      utility_provider_id: pid,
      utility_type: utilityType,
      scope_description: "",
      current_stage: 1,
      current_stage_state: "NOT_STARTED",
      metadata,
    };

    const { data: inserted, error: insErr } = await supabase
      .from("coordination_records")
      .insert(insertRow)
      .select("*")
      .single();

    if (insErr) {
      throw Object.assign(new Error(insErr.message || "Failed to create coordination record"), {
        cause: insErr,
        statusCode: 500,
        code: "COORDINATION_INSERT_FAILED",
      });
    }

    existingProviderTypes.add(providerTypeKey);

    const { error: trErr } = await supabase.from("coordination_stage_transitions").insert({
      coordination_record_id: inserted.id,
      project_id: projectId,
      from_stage: null,
      from_state: null,
      to_stage: 1,
      to_state: "NOT_STARTED",
      triggered_by_type: "system",
      triggered_by_id: null,
      reason: "Initialization",
      metadata: providerSetupMetadata ? { uci_provider_mapping: providerSetupMetadata } : {},
    });

    if (trErr) {
      throw Object.assign(new Error(trErr.message || "Failed to insert initial transition"), {
        cause: trErr,
        statusCode: 500,
        code: "TRANSITION_INSERT_FAILED",
      });
    }

    created.push(inserted);
  }

  const records = await listCoordinationRecordsByProject(supabase, projectId);

  const createdIdSet = new Set(created.map((c) => String(c.id)));
  const requestedSet = new Set(resolvedProviders.map((p) => String(p.id)));
  const providerSlugById = new Map(
    resolvedProviders.map((provider) => [
      String(provider.id),
      String(provider.slug ?? "").toLowerCase(),
    ]),
  );

  /** Enriched coordination rows tied to requested provider ids only */
  const impacted = records.filter((r) => requestedSet.has(String(r.utility_provider_id)));

  if (providerSetupMetadata) {
    for (const record of impacted) {
      const providerSlug = providerSlugById.get(String(record.utility_provider_id)) || "";
      if (!providerSlug) continue;

      let nextMetadata = mergeProviderMappingMetadata(
        record.metadata,
        providerSetupMetadata,
        providerSlug,
      );
      const resolutionSnapshot =
        providerResolutionBySlug && providerSlug
          ? providerResolutionBySlug[providerSlug]
          : null;
      if (resolutionSnapshot && typeof resolutionSnapshot === "object") {
        nextMetadata = mergeProviderResolutionIntoCoordinationMetadata(
          nextMetadata,
          resolutionSnapshot,
        );
      }

      const { error: metaErr } = await supabase
        .from("coordination_records")
        .update({ metadata: nextMetadata })
        .eq("id", record.id);

      if (metaErr) {
        throw Object.assign(
          new Error(metaErr.message || "Failed to persist provider mapping metadata"),
          {
            cause: metaErr,
            statusCode: 500,
            code: "COORDINATION_METADATA_UPDATE_FAILED",
          },
        );
      }

      record.metadata = nextMetadata;
    }
  }

  return {
    created: impacted.filter((r) => createdIdSet.has(String(r.id))),
    already_existed: impacted.filter((r) => !createdIdSet.has(String(r.id))),
    records,
  };
}

module.exports = {
  listCoordinationRecordsByProject,
  getCoordinationRecordById,
  getCoordinationRecordDetailById,
  getCoordinationDetailBundle,
  initCoordinationForProviders,
  mergeProviderMappingMetadata,
};
