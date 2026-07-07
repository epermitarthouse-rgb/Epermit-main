"use strict";

const { getCoordinationRecordById } = require("./uci-records.service.js");

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} coordinationRecordId
 * @returns {Promise<{
 *   projectId: string;
 *   coordinationRecordId: string;
 *   tenantId: null;
 *   tenantSource: "unconfigured";
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

  return {
    projectId: String(record.project_id),
    coordinationRecordId: String(record.id),
    tenantId: null,
    tenantSource: "unconfigured",
    coordinationRecord: record,
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
  loadTenantContextForCoordination,
  resolveProviderSlugFromRecord,
};
