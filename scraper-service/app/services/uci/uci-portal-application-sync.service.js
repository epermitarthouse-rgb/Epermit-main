"use strict";

const { emptyCountBucket } = require("./uci-sync-utils.js");

/**
 * @param {Record<string, unknown> | null | undefined} existing
 * @param {Record<string, unknown>} next
 * @returns {boolean}
 */
function applicationRowChanged(existing, next) {
  if (!existing) return true;
  const fields = [
    "external_job_id",
    "portal_status",
    "portal_milestone",
    "portal_last_updated_at",
    "portal_submitted_at",
    "action_required",
  ];
  for (const field of fields) {
    if (String(existing[field] ?? "") !== String(next[field] ?? "")) return true;
  }

  const existingMeta =
    existing.metadata && typeof existing.metadata === "object"
      ? /** @type {{ portal_snapshot?: unknown }} */ (existing.metadata).portal_snapshot
      : null;
  const nextMeta =
    next.metadata && typeof next.metadata === "object"
      ? /** @type {{ portal_snapshot?: unknown }} */ (next.metadata).portal_snapshot
      : null;

  return JSON.stringify(existingMeta ?? {}) !== JSON.stringify(nextMeta ?? {});
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} opts
 * @param {string} opts.coordinationRecordId
 * @param {string} opts.projectId
 * @param {string | null} opts.tenantId
 * @param {string} opts.providerSlug
 * @param {Array<import("../adapters/utility-adapter.types.js").NormalizedApplication>} opts.applications
 * @returns {Promise<{ counts: ReturnType<typeof emptyCountBucket>, errors: string[] }>}
 */
async function upsertPortalApplications(supabase, opts) {
  const counts = emptyCountBucket();
  /** @type {string[]} */
  const errors = [];

  counts.discovered = opts.applications.length;

  for (const app of opts.applications) {
    try {
      const externalId = String(app.external_application_id || "").trim();
      if (!externalId) {
        counts.failed += 1;
        errors.push("Application missing external_application_id");
        continue;
      }

      const { data: existing, error: fetchErr } = await supabase
        .from("coordination_applications")
        .select("*")
        .eq("coordination_record_id", opts.coordinationRecordId)
        .eq("provider_slug", opts.providerSlug)
        .eq("external_application_id", externalId)
        .maybeSingle();

      if (fetchErr) {
        counts.failed += 1;
        errors.push(fetchErr.message || "application_fetch_failed");
        continue;
      }

      if (existing && String(existing.record_source) === "agent_draft") {
        counts.skipped += 1;
        continue;
      }

      const now = new Date().toISOString();
      const row = {
        coordination_record_id: opts.coordinationRecordId,
        project_id: opts.projectId,
        tenant_id: opts.tenantId,
        provider_slug: opts.providerSlug,
        external_application_id: externalId,
        external_job_id: app.external_job_id ?? null,
        portal_status: app.portal_status ?? null,
        portal_milestone: app.portal_milestone ?? null,
        portal_last_updated_at: app.portal_last_updated_at ?? null,
        portal_submitted_at: app.portal_submitted_at ?? null,
        action_required: app.action_required === true,
        last_synced_at: now,
        record_source: "portal_sync",
        metadata: app.metadata ?? {},
      };

      if (!existing) {
        const { error: insErr } = await supabase
          .from("coordination_applications")
          .insert(row);
        if (insErr) {
          counts.failed += 1;
          errors.push(insErr.message || "application_insert_failed");
        } else {
          counts.inserted += 1;
        }
        continue;
      }

      if (!applicationRowChanged(existing, row)) {
        counts.skipped += 1;
        continue;
      }

      const { error: upErr } = await supabase
        .from("coordination_applications")
        .update(row)
        .eq("id", existing.id);

      if (upErr) {
        counts.failed += 1;
        errors.push(upErr.message || "application_update_failed");
      } else {
        counts.updated += 1;
      }
    } catch (e) {
      counts.failed += 1;
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  return { counts, errors };
}

module.exports = {
  upsertPortalApplications,
  applicationRowChanged,
};
