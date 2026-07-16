"use strict";

const { listApplicationsByCoordination } = require("./uci-applications.service.js");
const {
  mergeProviderResolutionIntoCoordinationMetadata,
} = require("./uci-provider-resolution-persistence.js");

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
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} coordinationRecordId
 * @param {string} projectId
 * @returns {Promise<Record<string, unknown>>}
 */
async function getCoordinationDetailBundle(supabase, coordinationRecordId, projectId) {
  const record = await getCoordinationRecordById(supabase, coordinationRecordId);
  if (!record || String(record.project_id) !== projectId) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const [
    transitionsResult,
    applications,
    costsResult,
    equipmentResult,
    milestonesResult,
    commResult,
  ] = await Promise.all([
    supabase
      .from("coordination_stage_transitions")
      .select("*")
      .eq("coordination_record_id", coordinationRecordId)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),
    listApplicationsByCoordination(supabase, coordinationRecordId, projectId),
    supabase
      .from("coordination_costs")
      .select("*")
      .eq("coordination_record_id", coordinationRecordId)
      .eq("project_id", projectId)
      .order("created_at", { ascending: true }),
    supabase
      .from("coordination_equipment")
      .select("*")
      .eq("coordination_record_id", coordinationRecordId)
      .eq("project_id", projectId)
      .order("created_at", { ascending: true }),
    supabase
      .from("coordination_milestones")
      .select("*")
      .eq("coordination_record_id", coordinationRecordId)
      .eq("project_id", projectId)
      .order("created_at", { ascending: true }),
    supabase
      .from("coordination_communications")
      .select("*")
      .eq("coordination_record_id", coordinationRecordId)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const tErr = transitionsResult.error;
  if (tErr) {
    throw Object.assign(new Error(tErr.message || "Failed to load transitions"), {
      cause: tErr,
      statusCode: 500,
      code: "TRANSITIONS_FETCH_FAILED",
    });
  }

  const cErr = costsResult.error;
  if (cErr) {
    throw Object.assign(new Error(cErr.message || "Failed to load costs"), {
      cause: cErr,
      statusCode: 500,
      code: "COSTS_FETCH_FAILED",
    });
  }

  const eErr = equipmentResult.error;
  if (eErr) {
    throw Object.assign(new Error(eErr.message || "Failed to load equipment"), {
      cause: eErr,
      statusCode: 500,
      code: "EQUIPMENT_FETCH_FAILED",
    });
  }

  const mErr = milestonesResult.error;
  if (mErr) {
    throw Object.assign(new Error(mErr.message || "Failed to load milestones"), {
      cause: mErr,
      statusCode: 500,
      code: "MILESTONES_FETCH_FAILED",
    });
  }

  const commErr = commResult.error;
  if (commErr) {
    throw Object.assign(new Error(commErr.message || "Failed to load communications"), {
      cause: commErr,
      statusCode: 500,
      code: "COMMUNICATIONS_FETCH_FAILED",
    });
  }

  return {
    record,
    transitions: transitionsResult.data ?? [],
    applications,
    costs: costsResult.data ?? [],
    equipment: equipmentResult.data ?? [],
    milestones: milestonesResult.data ?? [],
    communications_recent: commResult.data ?? [],
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
    .select("id, utility_provider_id")
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

  const existingPid = new Set(
    (Array.isArray(existingRows) ? existingRows : []).map((r) => r.utility_provider_id),
  );

  /** @type {Array<Record<string, unknown>>} */
  const created = [];

  for (const provider of resolvedProviders) {
    const pid = provider.id;
    if (existingPid.has(pid)) {
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
      utility_type: provider.utility_type ?? null,
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

    existingPid.add(pid);

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
  getCoordinationDetailBundle,
  initCoordinationForProviders,
  mergeProviderMappingMetadata,
};
