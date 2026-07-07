"use strict";

const { emptyCountBucket } = require("./uci-sync-utils.js");

/**
 * @param {Record<string, unknown> | null | undefined} existing
 * @param {Record<string, unknown>} next
 * @returns {boolean}
 */
function milestoneRowChanged(existing, next) {
  if (!existing) return true;
  const fields = [
    "milestone_type",
    "status",
    "source",
    "portal_status",
    "portal_milestone",
    "occurred_at",
    "actual_date",
  ];
  for (const field of fields) {
    if (String(existing[field] ?? "") !== String(next[field] ?? "")) return true;
  }
  return JSON.stringify(existing.metadata ?? {}) !== JSON.stringify(next.metadata ?? {});
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} opts
 * @param {string} opts.coordinationRecordId
 * @param {string} opts.projectId
 * @param {string | null} opts.tenantId
 * @param {string} opts.providerSlug
 * @param {Array<import("../adapters/utility-adapter.types.js").NormalizedStatusEvent>} opts.events
 * @returns {Promise<{ counts: ReturnType<typeof emptyCountBucket>, errors: string[] }>}
 */
async function upsertPortalStatusEvents(supabase, opts) {
  const counts = emptyCountBucket();
  /** @type {string[]} */
  const errors = [];

  counts.discovered = opts.events.length;

  for (const event of opts.events) {
    try {
      const idempotencyKey = String(event.idempotency_key || "").trim();
      if (!idempotencyKey) {
        counts.failed += 1;
        errors.push("Status event missing idempotency_key");
        continue;
      }

      const { data: existing, error: fetchErr } = await supabase
        .from("coordination_milestones")
        .select("*")
        .eq("coordination_record_id", opts.coordinationRecordId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();

      if (fetchErr) {
        counts.failed += 1;
        errors.push(fetchErr.message || "milestone_fetch_failed");
        continue;
      }

      const row = {
        coordination_record_id: opts.coordinationRecordId,
        project_id: opts.projectId,
        tenant_id: opts.tenantId,
        provider_slug: opts.providerSlug,
        external_application_id: event.external_application_id,
        milestone_type: event.milestone_type,
        status: event.status,
        source: event.source,
        portal_status: event.portal_status ?? null,
        portal_milestone: event.portal_milestone ?? null,
        occurred_at: event.occurred_at ?? null,
        actual_date: event.actual_date ?? null,
        idempotency_key: idempotencyKey,
        metadata: event.metadata ?? {},
        notes: null,
        parent_stage: null,
        target_date: null,
      };

      if (!existing) {
        const { error: insErr } = await supabase.from("coordination_milestones").insert(row);
        if (insErr) {
          counts.failed += 1;
          errors.push(insErr.message || "milestone_insert_failed");
        } else {
          counts.inserted += 1;
        }
        continue;
      }

      if (!milestoneRowChanged(existing, row)) {
        counts.skipped += 1;
        continue;
      }

      const { error: upErr } = await supabase
        .from("coordination_milestones")
        .update(row)
        .eq("id", existing.id);

      if (upErr) {
        counts.failed += 1;
        errors.push(upErr.message || "milestone_update_failed");
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
  upsertPortalStatusEvents,
  milestoneRowChanged,
};
