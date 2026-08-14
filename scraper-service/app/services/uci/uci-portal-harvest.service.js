"use strict";

const { assertProjectAccess, requireProjectAccess } = require("./uci-access.service.js");
const { runPortalSyncFromPepcoApplications } = require("./uci-portal-sync.service.js");

function text(value) {
  return value == null ? "" : String(value).trim();
}

function normalize(value) {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenSimilarity(left, right) {
  const a = new Set(normalize(left).split(" ").filter((token) => token.length > 1));
  const b = new Set(normalize(right).split(" ").filter((token) => token.length > 1));
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / new Set([...a, ...b]).size;
}

function projectAddress(project) {
  return [project.address, project.city, project.state, project.zip_code].map(text).filter(Boolean).join(", ");
}

function snapshotFor(row) {
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const snapshot = metadata.portal_snapshot;
  return snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot : {};
}

function providerSlugForRecord(record) {
  const utility = Array.isArray(record?.utility_providers)
    ? record.utility_providers[0]
    : record?.utility_providers;
  return text(utility?.slug).toLowerCase();
}

function legacyApplicationRow(snapshot, record, fallbackSyncedAt) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const externalApplicationId = text(
    snapshot.applicationUuid || snapshot.applicationId || snapshot.external_application_id,
  );
  if (!externalApplicationId) return null;
  const overview =
    snapshot.overview && typeof snapshot.overview === "object" && !Array.isArray(snapshot.overview)
      ? snapshot.overview
      : {};
  return {
    external_application_id: externalApplicationId,
    external_job_id: text(snapshot.external_job_id || overview.jobId) || null,
    portal_status: text(snapshot.currentStatus || snapshot.status || snapshot.portal_status) || null,
    portal_milestone:
      text(snapshot.currentMilestone || snapshot.milestone || snapshot.portal_milestone) || null,
    last_synced_at:
      text(snapshot.scrapedAt || snapshot.statusLastUpdatedAt || fallbackSyncedAt) || null,
    project_id: record.project_id,
    coordination_record_id: record.id,
    metadata: { portal_snapshot: snapshot },
    source_legacy: true,
  };
}

/**
 * Read pre-harvest PEPCO snapshots without attaching them to the coordination
 * record that happened to run the account-level scrape.
 */
function extractLegacyHarvestRows(records, providerSlug = "pepco") {
  const rows = [];
  const provider = text(providerSlug).toLowerCase();
  for (const record of records || []) {
    if (providerSlugForRecord(record) !== provider) continue;
    const metadata =
      record?.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
        ? record.metadata
        : {};

    const detail =
      metadata.pepco_application_detail_discovery &&
      typeof metadata.pepco_application_detail_discovery === "object" &&
      !Array.isArray(metadata.pepco_application_detail_discovery)
        ? metadata.pepco_application_detail_discovery
        : {};
    const detailSyncedAt = text(detail.lastScrapedAt || record.updated_at) || null;
    for (const application of Array.isArray(detail.applications) ? detail.applications : []) {
      const row = legacyApplicationRow(application, record, detailSyncedAt);
      if (row) rows.push(row);
    }

    const dashboard =
      metadata.pepco_dashboard_discovery &&
      typeof metadata.pepco_dashboard_discovery === "object" &&
      !Array.isArray(metadata.pepco_dashboard_discovery)
        ? metadata.pepco_dashboard_discovery
        : {};
    const dashboardSyncedAt =
      text(dashboard.last_discovered_at || metadata.pepco_dashboard_last_discovered_at || record.updated_at) ||
      null;
    for (const card of Array.isArray(dashboard.cards) ? dashboard.cards : []) {
      const row = legacyApplicationRow(card, record, dashboardSyncedAt);
      if (row) rows.push(row);
    }
  }
  return rows;
}

function isMissingHarvestTableError(error) {
  const code = text(error?.code).toUpperCase();
  const message = text(error?.message).toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    (message.includes("schema cache") && message.includes("uci_portal_harvest_")) ||
    (message.includes("relation") &&
      message.includes("uci_portal_harvest_") &&
      message.includes("does not exist"))
  );
}

function identityFor(row) {
  const snapshot = snapshotFor(row);
  const overview =
    snapshot.overview && typeof snapshot.overview === "object" && !Array.isArray(snapshot.overview)
      ? snapshot.overview
      : {};
  return {
    name: text(overview.projectName || snapshot.projectName || snapshot.title) || null,
    address:
      text(
        overview.projectAddress ||
          overview.propertyAddress ||
          snapshot.projectAddress ||
          snapshot.propertyAddress ||
          snapshot.address,
      ) || null,
    external_job_id: text(row.external_job_id || overview.jobId) || null,
  };
}

/**
 * Suggestions are evidence only. Linking always requires a separate human-confirmed PUT.
 */
function suggestProjectMatches(application, projects) {
  const identity = identityFor(application);
  const externalId = text(application.external_application_id);
  return projects
    .map((project) => {
      const reasons = [];
      let score = 0;
      if (externalId && normalize(project.permit_number) === normalize(externalId)) {
        score += 100;
        reasons.push("External application ID matches permit number");
      }
      if (
        identity.external_job_id &&
        normalize(project.permit_number) === normalize(identity.external_job_id)
      ) {
        score += 95;
        reasons.push("PEPCO job ID matches permit number");
      }
      const addressScore = tokenSimilarity(identity.address, projectAddress(project));
      if (addressScore >= 0.8) {
        score += 80;
        reasons.push("Address strongly matches");
      } else if (addressScore >= 0.55) {
        score += 45;
        reasons.push("Address partially matches");
      }
      const nameScore = tokenSimilarity(identity.name, project.name);
      if (nameScore >= 0.8) {
        score += 55;
        reasons.push("Project name strongly matches");
      } else if (nameScore >= 0.5) {
        score += 25;
        reasons.push("Project name partially matches");
      }
      return {
        project_id: project.id,
        project_name: project.name,
        score,
        confidence: score >= 95 ? "high" : score >= 70 ? "medium" : "low",
        reasons,
      };
    })
    .filter((candidate) => candidate.score >= 45)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

async function accessibleProjects(supabase, userId) {
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, address, city, state, zip_code, permit_number, tenant_id");
  if (error) throw Object.assign(new Error(error.message), { code: "HARVEST_PROJECTS_FAILED" });
  const checks = await Promise.all(
    (data || []).map(async (project) => ({
      project,
      allowed: await assertProjectAccess({ supabase, userId, projectId: String(project.id) }),
    })),
  );
  return checks.filter((entry) => entry.allowed).map((entry) => entry.project);
}

function countDocuments(row) {
  const snapshot = snapshotFor(row);
  if (Number.isFinite(Number(snapshot.documentCount))) return Number(snapshot.documentCount);
  if (Array.isArray(snapshot.downloadedFiles)) return snapshot.downloadedFiles.length;
  if (Array.isArray(snapshot.documents)) return snapshot.documents.length;
  return 0;
}

function latestRow(rows) {
  return [...rows].sort(
    (a, b) =>
      Date.parse(b.last_synced_at || b.portal_last_updated_at || b.updated_at || 0) -
      Date.parse(a.last_synced_at || a.portal_last_updated_at || a.updated_at || 0),
  )[0];
}

function mergedIdentityFor(rows) {
  const merged = { name: null, address: null, external_job_id: null };
  const ordered = [...rows].sort(
    (a, b) =>
      Date.parse(b.last_synced_at || b.portal_last_updated_at || b.updated_at || 0) -
      Date.parse(a.last_synced_at || a.portal_last_updated_at || a.updated_at || 0),
  );
  for (const row of ordered) {
    const identity = identityFor(row);
    if (!merged.name && identity.name) merged.name = identity.name;
    if (!merged.address && identity.address) merged.address = identity.address;
    if (!merged.external_job_id && identity.external_job_id) {
      merged.external_job_id = identity.external_job_id;
    }
  }
  return merged;
}

async function listProviderHarvest(supabase, { userId, providerSlug = "pepco" }) {
  const provider = text(providerSlug).toLowerCase();
  const projects = await accessibleProjects(supabase, userId);
  const projectIds = new Set(projects.map((project) => String(project.id)));

  const [inventoryResult, appsResult, commResult, milestoneResult, linkResult, recordsResult] = await Promise.all([
    supabase
      .from("uci_portal_harvest_items")
      .select("*")
      .eq("owner_user_id", userId)
      .eq("provider_slug", provider),
    supabase.from("coordination_applications").select("*").eq("provider_slug", provider),
    supabase
      .from("coordination_communications")
      .select("external_application_id, idempotency_key, id")
      .eq("provider_slug", provider),
    supabase
      .from("coordination_milestones")
      .select("external_application_id, idempotency_key, id, portal_status, portal_milestone, occurred_at")
      .eq("provider_slug", provider),
    supabase.from("uci_portal_harvest_links").select("*").eq("provider_slug", provider),
    supabase
      .from("coordination_records")
      .select("id, project_id, metadata, updated_at, utility_providers(slug)")
      .in("project_id", [...projectIds]),
  ]);
  for (const result of [appsResult, commResult, milestoneResult, recordsResult]) {
    if (result.error) throw Object.assign(new Error(result.error.message), { code: "HARVEST_LIST_FAILED" });
  }
  for (const result of [inventoryResult, linkResult]) {
    if (result.error && !isMissingHarvestTableError(result.error)) {
      throw Object.assign(new Error(result.error.message), { code: "HARVEST_LIST_FAILED" });
    }
  }

  const inventoryApps = (inventoryResult.error ? [] : inventoryResult.data || []).map((item) => ({
    external_application_id: item.external_application_id,
    external_job_id: item.external_job_id,
    portal_status: item.portal_status,
    portal_milestone: item.portal_milestone,
    last_synced_at: item.last_synced_at,
    metadata: { portal_snapshot: item.snapshot },
    source_inventory: true,
  }));
  const legacyApps = extractLegacyHarvestRows(recordsResult.data || [], provider);
  const visibleApps = [
    ...inventoryApps,
    ...(appsResult.data || []).filter((row) => projectIds.has(String(row.project_id))),
    ...legacyApps,
  ];
  const groups = new Map();
  for (const row of visibleApps) {
    const externalId = text(row.external_application_id);
    if (!externalId) continue;
    const rows = groups.get(externalId) || [];
    rows.push(row);
    groups.set(externalId, rows);
  }
  const projectById = new Map(projects.map((project) => [String(project.id), project]));
  const recordById = new Map((recordsResult.data || []).map((record) => [String(record.id), record]));
  const linkByExternalId = new Map(
    (linkResult.error ? [] : linkResult.data || [])
      .filter((link) => projectIds.has(String(link.project_id)))
      .map((link) => [String(link.external_application_id), link]),
  );

  const communications = commResult.data || [];
  const milestones = milestoneResult.data || [];
  const applications = [...groups.entries()].map(([externalId, rows]) => {
    const latest = latestRow(rows);
    const identity = mergedIdentityFor(rows);
    const link = linkByExternalId.get(externalId) || null;
    const linkedProject = link ? projectById.get(String(link.project_id)) || null : null;
    const linkedRecord = link ? recordById.get(String(link.coordination_record_id)) || null : null;
    const commKeys = new Set(
      communications
        .filter((row) => text(row.external_application_id) === externalId)
        .map((row) => text(row.idempotency_key || row.id)),
    );
    const appMilestones = milestones.filter(
      (row) => text(row.external_application_id) === externalId,
    );
    const milestoneKeys = new Set(appMilestones.map((row) => text(row.idempotency_key || row.id)));
    const latestMilestone = latestRow(appMilestones);
    const suggestions = suggestProjectMatches(latest, projects);
    const ambiguous =
      suggestions.length > 1 && suggestions[0].score - suggestions[1].score < 20;

    return {
      provider_slug: provider,
      external_application_id: externalId,
      external_job_id: identity.external_job_id,
      name: identity.name,
      address: identity.address,
      portal_status: rows.map((row) => text(row.portal_status)).find(Boolean) || null,
      portal_milestone: rows.map((row) => text(row.portal_milestone)).find(Boolean) || null,
      last_synced_at: latest.last_synced_at || latest.portal_last_updated_at || null,
      documents_count: Math.max(...rows.map(countDocuments), 0),
      communications_count: commKeys.size,
      milestones_count: milestoneKeys.size,
      latest_milestone_status:
        latestMilestone?.portal_milestone || latestMilestone?.portal_status || null,
      linked_project: linkedProject
        ? { id: linkedProject.id, name: linkedProject.name }
        : null,
      coordination_record_id: linkedRecord?.id || null,
      match_status: link ? "Linked" : ambiguous || suggestions.length > 0 ? "Needs review" : "Unmatched",
      suggestions,
      source_duplicate_count: Math.max(rows.length - 1, 0),
    };
  });

  return {
    provider: { slug: provider, name: provider === "pepco" ? "PEPCO" : provider },
    last_sync:
      applications.map((app) => app.last_synced_at).filter(Boolean).sort().reverse()[0] || null,
    applications: applications.sort((a, b) => (a.name || a.external_application_id).localeCompare(b.name || b.external_application_id)),
    projects: projects.map((project) => ({ id: project.id, name: project.name })),
  };
}

async function linkHarvestApplication(
  supabase,
  { userId, providerSlug = "pepco", externalApplicationId, projectId, coordinationRecordId },
) {
  const provider = text(providerSlug).toLowerCase();
  await requireProjectAccess({ supabase, userId, projectId, write: true });
  const { data: record, error: recordError } = await supabase
    .from("coordination_records")
    .select("id, project_id, tenant_id, utility_providers(slug)")
    .eq("id", coordinationRecordId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (recordError || !record) {
    throw Object.assign(new Error("Coordination record does not belong to the selected project."), {
      statusCode: 400,
      code: "INVALID_HARVEST_LINK",
    });
  }
  const utility = Array.isArray(record.utility_providers)
    ? record.utility_providers[0]
    : record.utility_providers;
  if (text(utility?.slug).toLowerCase() !== provider) {
    throw Object.assign(new Error("Select a coordination record for the same utility provider."), {
      statusCode: 400,
      code: "PROVIDER_MISMATCH",
    });
  }
  const row = {
    provider_slug: provider,
    external_application_id: text(externalApplicationId),
    project_id: projectId,
    coordination_record_id: coordinationRecordId,
    tenant_id: record.tenant_id || null,
    linked_by: userId,
    linked_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from("uci_portal_harvest_links")
    .upsert(row, { onConflict: "provider_slug,external_application_id" })
    .select("*")
    .single();
  if (error) throw Object.assign(new Error(error.message), { code: "HARVEST_LINK_FAILED" });
  return data;
}

async function refreshLinkedHarvestData(supabase, { userId, providerSlug = "pepco" }) {
  const harvest = await listProviderHarvest(supabase, { userId, providerSlug });
  const linked = harvest.applications.filter(
    (application) => application.coordination_record_id && application.linked_project,
  );
  const summaries = [];
  for (const application of linked) {
    const { data: inventoryRows, error: inventoryError } = await supabase
      .from("uci_portal_harvest_items")
      .select("snapshot")
      .eq("owner_user_id", userId)
      .eq("provider_slug", providerSlug)
      .eq("external_application_id", application.external_application_id)
      .limit(1);
    if (inventoryError) throw inventoryError;
    const { data: sourceRows, error } = await supabase
      .from("coordination_applications")
      .select("metadata")
      .eq("provider_slug", providerSlug)
      .eq("external_application_id", application.external_application_id)
      .order("last_synced_at", { ascending: false })
      .limit(1);
    if (error) throw error;
    const snapshot =
      inventoryRows?.[0]?.snapshot ||
      (sourceRows?.[0] ? snapshotFor(sourceRows[0]) : null);
    if (!snapshot || !Object.keys(snapshot).length) continue;
    summaries.push(
      await runPortalSyncFromPepcoApplications(supabase, {
        coordinationRecordId: application.coordination_record_id,
        projectId: application.linked_project.id,
        applications: [snapshot],
        providerSlug,
      }),
    );
  }
  return { refreshed: summaries.length, skipped_unmatched: harvest.applications.length - linked.length, summaries };
}

module.exports = {
  listProviderHarvest,
  linkHarvestApplication,
  refreshLinkedHarvestData,
  suggestProjectMatches,
  tokenSimilarity,
  identityFor,
  extractLegacyHarvestRows,
  isMissingHarvestTableError,
};
