"use strict";

const { emptyCountBucket } = require("./uci-sync-utils.js");

/**
 * @param {Record<string, unknown> | null | undefined} existing
 * @param {Record<string, unknown>} next
 * @returns {boolean}
 */
function communicationRowChanged(existing, next) {
  if (!existing) return true;
  const fields = [
    "direction",
    "channel",
    "raw_subject",
    "raw_body",
    "sender",
    "recipient",
    "message_timestamp",
    "needs_human_attention",
  ];
  for (const field of fields) {
    if (String(existing[field] ?? "") !== String(next[field] ?? "")) return true;
  }
  return (
    JSON.stringify(existing.agent_processed_metadata ?? {}) !==
    JSON.stringify(next.agent_processed_metadata ?? {})
  );
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} opts
 * @param {string} opts.coordinationRecordId
 * @param {string} opts.projectId
 * @param {string | null} opts.tenantId
 * @param {string} opts.providerSlug
 * @param {Array<import("../adapters/utility-adapter.types.js").NormalizedCommunication>} opts.communications
 * @returns {Promise<{ counts: ReturnType<typeof emptyCountBucket>, errors: string[] }>}
 */
async function upsertPortalCommunications(supabase, opts) {
  const counts = emptyCountBucket();
  /** @type {string[]} */
  const errors = [];

  counts.discovered = opts.communications.length;

  for (const comm of opts.communications) {
    try {
      const idempotencyKey = String(comm.idempotency_key || "").trim();
      if (!idempotencyKey) {
        counts.failed += 1;
        errors.push("Communication missing idempotency_key");
        continue;
      }

      const { data: existing, error: fetchErr } = await supabase
        .from("coordination_communications")
        .select("*")
        .eq("coordination_record_id", opts.coordinationRecordId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();

      if (fetchErr) {
        counts.failed += 1;
        errors.push(fetchErr.message || "communication_fetch_failed");
        continue;
      }

      const portalMeta =
        comm.agent_processed_metadata &&
        typeof comm.agent_processed_metadata === "object" &&
        !Array.isArray(comm.agent_processed_metadata)
          ? comm.agent_processed_metadata
          : {};

      const row = {
        coordination_record_id: opts.coordinationRecordId,
        project_id: opts.projectId,
        tenant_id: opts.tenantId,
        provider_slug: opts.providerSlug,
        external_application_id: comm.external_application_id,
        external_message_id: comm.external_message_id ?? null,
        idempotency_key: idempotencyKey,
        direction: comm.direction ?? null,
        channel: comm.channel,
        // New portal rows start unclassified; never wipe Agent 5 results on re-sync.
        classification: null,
        classification_confidence: null,
        raw_subject: comm.raw_subject ?? null,
        raw_body: comm.raw_body ?? null,
        raw_attachments: [],
        parsed_summary: null,
        parsed_action_items: [],
        thread_id: comm.thread_id ?? comm.external_application_id,
        needs_human_attention: comm.needs_human_attention === true,
        agent_processed_metadata: {
          ...portalMeta,
          source: portalMeta.source || "portal_sync",
          channel_model: "shared_coordination_communications",
        },
        message_timestamp: comm.message_timestamp ?? null,
      };

      if (!existing) {
        const { error: insErr } = await supabase
          .from("coordination_communications")
          .insert(row);
        if (insErr) {
          counts.failed += 1;
          errors.push(insErr.message || "communication_insert_failed");
        } else {
          counts.inserted += 1;
        }
        continue;
      }

      // Preserve classification / review state; only refresh transport fields.
      // Never overwrite Graph/outbound direction with portal heuristics.
      const existingMeta =
        existing.agent_processed_metadata &&
        typeof existing.agent_processed_metadata === "object" &&
        !Array.isArray(existing.agent_processed_metadata)
          ? /** @type {Record<string, unknown>} */ (existing.agent_processed_metadata)
          : {};
      const preserveDirection =
        existingMeta.source === "graph_inbound" ||
        existingMeta.source === "stage4_live_transmit" ||
        existingMeta.inbound_echo != null ||
        String(existing.direction || "") === "outbound";

      const updateRow = {
        direction: preserveDirection ? existing.direction : row.direction,
        channel: row.channel,
        raw_subject: row.raw_subject,
        raw_body: row.raw_body,
        sender: existing.sender ?? null,
        recipient: existing.recipient ?? null,
        message_timestamp: row.message_timestamp,
        thread_id: row.thread_id ?? existing.thread_id,
        external_message_id: row.external_message_id ?? existing.external_message_id,
        needs_human_attention:
          existing.needs_human_attention === true || row.needs_human_attention === true,
        agent_processed_metadata: {
          ...existingMeta,
          ...portalMeta,
          source: preserveDirection
            ? existingMeta.source || "portal_sync"
            : "portal_sync",
          channel_model: "shared_coordination_communications",
        },
      };

      if (!communicationRowChanged(existing, { ...existing, ...updateRow })) {
        counts.skipped += 1;
        continue;
      }

      const { error: upErr } = await supabase
        .from("coordination_communications")
        .update(updateRow)
        .eq("id", existing.id);

      if (upErr) {
        counts.failed += 1;
        errors.push(upErr.message || "communication_update_failed");
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
  upsertPortalCommunications,
  communicationRowChanged,
};
