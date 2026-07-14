"use strict";

/** In-memory ring buffer for D12 — also mirrors to coordination metadata when possible. */
const MAX_EVENTS = 200;
const MAX_PERSISTED_EVENTS = 50;
/** @type {Array<{ name: string, payload: Record<string, unknown>, emitted_at: string }>} */
const recentEvents = [];

/**
 * @param {import("@supabase/supabase-js").SupabaseClient | null | undefined} supabase
 * @param {Record<string, unknown>} payload
 */
async function mirrorEventToCoordinationMetadata(supabase, payload) {
  const coordinationRecordId = payload.coordination_record_id;
  const projectId = payload.project_id;
  if (!supabase || !coordinationRecordId || !projectId) return;

  const { data: record, error } = await supabase
    .from("coordination_records")
    .select("metadata")
    .eq("id", String(coordinationRecordId))
    .eq("project_id", String(projectId))
    .maybeSingle();

  if (error || !record) return;

  const prevMeta =
    record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
      ? /** @type {Record<string, unknown>} */ (record.metadata)
      : {};

  const existing = Array.isArray(prevMeta.uci_recent_events) ? prevMeta.uci_recent_events : [];
  const entry = {
    name: String(payload.__event_name || ""),
    payload: { ...payload },
    emitted_at: String(payload.__emitted_at || new Date().toISOString()),
  };
  delete entry.payload.__event_name;
  delete entry.payload.__emitted_at;

  const nextEvents = [entry, ...existing].slice(0, MAX_PERSISTED_EVENTS);

  await supabase
    .from("coordination_records")
    .update({
      metadata: {
        ...prevMeta,
        uci_recent_events: nextEvents,
      },
    })
    .eq("id", String(coordinationRecordId))
    .eq("project_id", String(projectId));
}

/**
 * @param {string} name
 * @param {Record<string, unknown>} [payload]
 * @param {{ supabase?: import("@supabase/supabase-js").SupabaseClient | null }} [options]
 */
function emitUciEvent(name, payload = {}, options = {}) {
  const entry = {
    name: String(name),
    payload,
    emitted_at: new Date().toISOString(),
  };
  recentEvents.unshift(entry);
  if (recentEvents.length > MAX_EVENTS) {
    recentEvents.length = MAX_EVENTS;
  }

  const mirrorPayload = {
    ...payload,
    __event_name: entry.name,
    __emitted_at: entry.emitted_at,
  };

  if (options.supabase) {
    void mirrorEventToCoordinationMetadata(options.supabase, mirrorPayload).catch(() => {
      // Non-blocking — in-memory buffer remains source for process-local reads.
    });
  }

  return entry;
}

function listRecentUciEvents(limit = 50) {
  const n = Math.min(Math.max(Number(limit) || 50, 1), MAX_EVENTS);
  return recentEvents.slice(0, n);
}

/**
 * Project-scoped event list — filters in-memory buffer by payload.project_id.
 * @param {string} projectId
 * @param {number} [limit]
 */
function listRecentUciEventsForProject(projectId, limit = 50) {
  const pid = String(projectId || "").trim();
  if (!pid) return [];
  const n = Math.min(Math.max(Number(limit) || 50, 1), MAX_EVENTS);
  return recentEvents
    .filter((e) => String(e.payload?.project_id ?? "") === pid)
    .slice(0, n);
}

function clearRecentUciEventsForTests() {
  recentEvents.length = 0;
}

module.exports = {
  emitUciEvent,
  listRecentUciEvents,
  listRecentUciEventsForProject,
  clearRecentUciEventsForTests,
  MAX_PERSISTED_EVENTS,
};
