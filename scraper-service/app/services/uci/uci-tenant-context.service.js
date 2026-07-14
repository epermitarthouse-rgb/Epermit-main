"use strict";

const { getCoordinationRecordById } = require("./uci-records.service.js");
const { getProjectTenantId } = require("./uci-access.service.js");

const DEMO_TENANT_ID = "00000000-0000-4000-8000-000000000001";
const UCI_TENANT_NAMESPACE_UNCONFIGURED = "unconfigured";

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} coordinationRecordId
 * @returns {Promise<{
 *   projectId: string;
 *   coordinationRecordId: string;
 *   tenantId: string | null;
 *   tenantSource: "project" | "unconfigured";
 *   tenantNamespace: string;
 *   isDemoTenant: boolean;
 *   ownershipSource: "project_team";
 *   coordinationRecord: Record<string, unknown>;
 * }>}
 */
async function loadTenantContextForCoordination(supabase, coordinationRecordId) {
  const record = await getCoordinationRecordById(supabase, coordinationRecordId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const projectId = String(record.project_id);
  let tenantId =
    record.tenant_id != null ? String(record.tenant_id) : null;

  if (!tenantId) {
    const project = await getProjectTenantId(supabase, projectId);
    tenantId = project?.tenant_id ? String(project.tenant_id) : null;
  }

  const tenantNamespace = tenantId || UCI_TENANT_NAMESPACE_UNCONFIGURED;

  return {
    projectId,
    coordinationRecordId: String(record.id),
    tenantId,
    tenantSource: tenantId ? "project" : "unconfigured",
    tenantNamespace,
    isDemoTenant: tenantId === DEMO_TENANT_ID,
    ownershipSource: "project_team",
    coordinationRecord: record,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} projectId
 * @returns {Promise<{
 *   projectId: string;
 *   tenantId: string | null;
 *   tenantNamespace: string;
 *   isDemoTenant: boolean;
 * }>}
 */
async function loadTenantContextForProject(supabase, projectId) {
  const project = await getProjectTenantId(supabase, projectId);
  const tenantId = project?.tenant_id ? String(project.tenant_id) : null;
  return {
    projectId,
    tenantId,
    tenantNamespace: tenantId || UCI_TENANT_NAMESPACE_UNCONFIGURED,
    isDemoTenant: tenantId === DEMO_TENANT_ID,
  };
}

/**
 * @param {Record<string, unknown>} coordinationRecord
 * @returns {string | null}
 */
function resolveProviderSlugFromRecord(coordinationRecord) {
  const providers = coordinationRecord.utility_providers;
  if (Array.isArray(providers) && providers[0] && typeof providers[0] === "object") {
    const slug = /** @type {{ slug?: unknown }} */ (providers[0]).slug;
    return typeof slug === "string" && slug.trim() ? slug.trim().toLowerCase() : null;
  }
  if (providers && typeof providers === "object" && !Array.isArray(providers)) {
    const slug = /** @type {{ slug?: unknown }} */ (providers).slug;
    return typeof slug === "string" && slug.trim() ? slug.trim().toLowerCase() : null;
  }
  return null;
}

module.exports = {
  DEMO_TENANT_ID,
  UCI_TENANT_NAMESPACE_UNCONFIGURED,
  loadTenantContextForCoordination,
  loadTenantContextForProject,
  resolveProviderSlugFromRecord,
};
