"use strict";

const {
  isActionableNeedsAttentionCommunication,
} = require("./uci-needs-attention.util.js");

const RECORD_SELECT = `
  id,
  project_id,
  user_id,
  tenant_id,
  utility_provider_id,
  utility_type,
  scope_description,
  current_stage,
  current_stage_state,
  acknowledgment_received_at,
  class_of_service_issued_at,
  energization_target_date,
  energization_actual_date,
  last_error,
  created_at,
  updated_at,
  utility_providers (
    id,
    slug,
    name,
    display_name,
    canonical_name,
    utility_type,
    primary_portal_type,
    portal_url,
    automation_status,
    is_active
  )
`;

const APPLICATION_SELECT = `
  id,
  coordination_record_id,
  project_id,
  application_type,
  draft_status,
  portal_status,
  action_required,
  last_error,
  last_synced_at,
  agent_draft_metadata,
  idempotency_key,
  record_source,
  submitted_at,
  provider_slug,
  created_at,
  updated_at
`;

const COMMUNICATION_SELECT = `
  id,
  coordination_record_id,
  project_id,
  direction,
  channel,
  classification,
  classification_confidence,
  raw_subject,
  raw_body,
  sender,
  recipient,
  parsed_summary,
  thread_id,
  needs_human_attention,
  reviewed_at,
  reviewed_by,
  agent_processed_metadata,
  message_timestamp,
  created_at,
  updated_at
`;

function asRows(result, code, fallback) {
  if (result.error) {
    throw Object.assign(new Error(result.error.message || fallback), {
      cause: result.error,
      statusCode: 500,
      code,
    });
  }
  return Array.isArray(result.data) ? result.data : [];
}

/** @deprecated Prefer isActionableNeedsAttentionCommunication — kept for tests. */
function isAttentionCommunication(row, record) {
  return isActionableNeedsAttentionCommunication(row, record);
}

/** Shared recent-window size for Inbox + record Communications (same canonical rows). */
const RECENT_COMMUNICATIONS_LIMIT = 25;

function recentCommunicationsByRecord(rows, limit = RECENT_COMMUNICATIONS_LIMIT) {
  const byRecord = new Map();
  for (const row of rows) {
    const recordId = String(row.coordination_record_id || "");
    if (!recordId) continue;
    const existing = byRecord.get(recordId) || [];
    if (existing.length < limit) {
      existing.push(row);
      byRecord.set(recordId, existing);
    }
  }
  return byRecord;
}

function isMissingAccessRpc(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return (
    code === "PGRST202" ||
    code === "42883" ||
    message.includes("list_accessible_uci_projects")
  );
}

async function listAccessibleProjects(supabase, userId, queryDurations) {
  const accessStartedAt = Date.now();
  const accessResult = await supabase.rpc("list_accessible_uci_projects", {
    _user_id: userId,
  });
  queryDurations.access_ms = Date.now() - accessStartedAt;
  if (!accessResult.error) {
    return {
      projects: Array.isArray(accessResult.data) ? accessResult.data : [],
      queryCount: 1,
      accessMode: "rpc",
    };
  }
  if (!isMissingAccessRpc(accessResult.error)) {
    asRows(
      accessResult,
      "OPERATIONAL_ACCESS_FETCH_FAILED",
      "Failed to resolve accessible UCI projects",
    );
  }

  // Deployment-safe compatibility path while the fixed-query RPC migration is
  // pending. Project ownership/team membership is resolved in bulk; tenant
  // isolation remains authoritative through can_access_tenant.
  const fallbackStartedAt = Date.now();
  const [ownedResult, teamResult] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, tenant_id")
      .eq("user_id", userId),
    supabase
      .from("project_team_members")
      .select("project_id")
      .eq("user_id", userId),
  ]);
  const owned = asRows(
    ownedResult,
    "OPERATIONAL_OWNED_PROJECTS_FETCH_FAILED",
    "Failed to load owned projects",
  );
  const teamRows = asRows(
    teamResult,
    "OPERATIONAL_TEAM_PROJECTS_FETCH_FAILED",
    "Failed to load project memberships",
  );
  const teamIds = [...new Set(teamRows.map((row) => String(row.project_id)).filter(Boolean))];
  const teamProjectsResult = teamIds.length
    ? await supabase
        .from("projects")
        .select("id, name, tenant_id")
        .in("id", teamIds)
    : { data: [], error: null };
  const teamProjects = asRows(
    teamProjectsResult,
    "OPERATIONAL_TEAM_PROJECTS_FETCH_FAILED",
    "Failed to load team projects",
  );
  const candidatesById = new Map(
    [...owned, ...teamProjects].map((project) => [String(project.id), project]),
  );
  const tenantIds = [
    ...new Set(
      [...candidatesById.values()]
        .map((project) => (project.tenant_id ? String(project.tenant_id) : ""))
        .filter(Boolean),
    ),
  ];
  const tenantChecks = await Promise.all(
    tenantIds.map(async (tenantId) => {
      const result = await supabase.rpc("can_access_tenant", {
        _user_id: userId,
        _tenant_id: tenantId,
      });
      if (result.error) {
        throw Object.assign(new Error(result.error.message || "Tenant access check failed"), {
          statusCode: 500,
          code: "OPERATIONAL_TENANT_ACCESS_FAILED",
        });
      }
      return [tenantId, Boolean(result.data)];
    }),
  );
  const allowedTenantIds = new Set(
    tenantChecks.filter(([, allowed]) => allowed).map(([tenantId]) => tenantId),
  );
  queryDurations.access_fallback_ms = Date.now() - fallbackStartedAt;
  console.warn("[uci-operational-snapshot] access RPC unavailable; using compatibility path");
  return {
    projects: [...candidatesById.values()].filter(
      (project) => !project.tenant_id || allowedTenantIds.has(String(project.tenant_id)),
    ),
    queryCount: 3 + (teamIds.length ? 1 : 0) + tenantIds.length,
    accessMode: "compatibility",
  };
}

/**
 * Build one persisted-data snapshot for all cross-project operational pages.
 * No portal discovery, sync, OCR, document processing, or package rebuild occurs here.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {{ userId: string }} params
 */
async function getUciOperationalSnapshot(supabase, params) {
  const startedAt = Date.now();
  const queryDurations = {};

  const access = await listAccessibleProjects(supabase, params.userId, queryDurations);
  const projects = access.projects;
  const projectIds = projects.map((project) => String(project.id)).filter(Boolean);

  if (projectIds.length === 0) {
    return {
      records: [],
      generated_at: new Date().toISOString(),
      diagnostics: {
        project_count: 0,
        record_count: 0,
        application_count: 0,
        communication_count: 0,
        db_query_count: access.queryCount,
        access_mode: access.accessMode,
        partial_failures: [],
        query_durations_ms: queryDurations,
        service_duration_ms: Date.now() - startedAt,
      },
    };
  }

  const runTimed = async (name, query) => {
    const queryStartedAt = Date.now();
    const result = await query;
    queryDurations[`${name}_ms`] = Date.now() - queryStartedAt;
    return result;
  };

  const [recordsResult, applicationsResult, communicationsResult] = await Promise.all([
    runTimed(
      "records",
      supabase
        .from("coordination_records")
        .select(RECORD_SELECT)
        .in("project_id", projectIds)
        .order("updated_at", { ascending: false }),
    ),
    runTimed(
      "applications",
      supabase
        .from("coordination_applications")
        .select(APPLICATION_SELECT)
        .in("project_id", projectIds)
        .order("updated_at", { ascending: false }),
    ),
    runTimed(
      "communications",
      supabase
        .from("coordination_communications")
        .select(COMMUNICATION_SELECT)
        .in("project_id", projectIds)
        .order("message_timestamp", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false }),
    ),
  ]);

  const records = asRows(
    recordsResult,
    "OPERATIONAL_RECORDS_FETCH_FAILED",
    "Failed to load operational records",
  );
  const partialFailures = [];
  const applications = applicationsResult.error
    ? (partialFailures.push("applications"), [])
    : Array.isArray(applicationsResult.data)
      ? applicationsResult.data
      : [];
  const communications = communicationsResult.error
    ? (partialFailures.push("communications"), [])
    : Array.isArray(communicationsResult.data)
      ? communicationsResult.data
      : [];

  const projectNameById = new Map(
    projects.map((project) => [String(project.id), String(project.name || "Unnamed project")]),
  );
  const applicationsByRecord = new Map();
  for (const application of applications) {
    const recordId = String(application.coordination_record_id || "");
    const existing = applicationsByRecord.get(recordId) || [];
    existing.push(application);
    applicationsByRecord.set(recordId, existing);
  }
  const recentByRecord = recentCommunicationsByRecord(communications);
  const recordsById = new Map(records.map((record) => [String(record.id), record]));
  const attentionCountByRecord = new Map();
  const attentionByRecord = new Map();
  for (const communication of communications) {
    const recordId = String(communication.coordination_record_id || "");
    const record = recordsById.get(recordId) || null;
    if (!isActionableNeedsAttentionCommunication(communication, record)) continue;
    attentionCountByRecord.set(recordId, (attentionCountByRecord.get(recordId) || 0) + 1);
    const existing = attentionByRecord.get(recordId) || [];
    existing.push(communication);
    attentionByRecord.set(recordId, existing);
  }

  return {
    records: records.map((record) => {
      const provider = Array.isArray(record.utility_providers)
        ? record.utility_providers[0]
        : record.utility_providers;
      return {
        ...record,
        project_name: projectNameById.get(String(record.project_id)) || "Unnamed project",
        provider_display_name: provider?.display_name || provider?.name || null,
        applications: applicationsByRecord.get(String(record.id)) || [],
        communications_recent: recentByRecord.get(String(record.id)) || [],
        attention_communications: attentionByRecord.get(String(record.id)) || [],
        attention_count: attentionCountByRecord.get(String(record.id)) || 0,
      };
    }),
    generated_at: new Date().toISOString(),
    diagnostics: {
      project_count: projects.length,
      record_count: records.length,
      application_count: applications.length,
      communication_count: communications.length,
      db_query_count: access.queryCount + 3,
      access_mode: access.accessMode,
      partial_failures: partialFailures,
      query_durations_ms: queryDurations,
      service_duration_ms: Date.now() - startedAt,
    },
  };
}

module.exports = {
  getUciOperationalSnapshot,
  isAttentionCommunication,
  recentCommunicationsByRecord,
  listAccessibleProjects,
};
