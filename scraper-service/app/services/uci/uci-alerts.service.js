"use strict";

/**
 * P0 / P1 / P2 lifecycle alerts — persisted on the coordination record
 * and surfaced through Needs Attention.
 */

const { emitUciEvent } = require("./uci-events.service.js");
const { updateCoordinationRecordFields } = require("./uci-record-write.service.js");

const SEVERITIES = new Set(["P0", "P1", "P2"]);

function asMeta(record) {
  if (record?.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)) {
    return { ...record.metadata };
  }
  return {};
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function raiseUciAlert(supabase, params) {
  const { record, severity, code, message, details = {} } = params;
  const sev = SEVERITIES.has(String(severity)) ? String(severity) : "P2";
  if (!record?.id) return { raised: false, reason: "no_record" };

  const meta = asMeta(record);
  const existing = Array.isArray(meta.uci_alerts) ? [...meta.uci_alerts] : [];
  const already = existing.some(
    (row) =>
      row &&
      typeof row === "object" &&
      String(row.code) === String(code) &&
      row.resolved_at == null,
  );
  if (already) return { raised: false, reason: "already_open", alerts: existing };

  const alert = {
    id: `${code}:${Date.now()}`,
    severity: sev,
    code: String(code),
    message: String(message || code),
    details,
    opened_at: new Date().toISOString(),
    resolved_at: null,
  };
  existing.unshift(alert);

  const { record: updated } = await updateCoordinationRecordFields(supabase, {
    coordinationRecordId: String(record.id),
    fields: {},
    metadataPatch: { uci_alerts: existing.slice(0, 50) },
    eventName: `uci.alert.${sev.toLowerCase()}`,
    eventPayload: { code, severity: sev, message: alert.message },
    skipPrediction: true,
  });

  emitUciEvent(
    `uci.alert.${sev.toLowerCase()}`,
    {
      coordination_record_id: record.id,
      project_id: record.project_id,
      code,
      severity: sev,
      message: alert.message,
    },
    { supabase },
  );

  return { raised: true, alert, record: updated };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function resolveUciAlert(supabase, params) {
  const { record, code } = params;
  const meta = asMeta(record);
  const existing = Array.isArray(meta.uci_alerts) ? meta.uci_alerts : [];
  const now = new Date().toISOString();
  const next = existing.map((row) => {
    if (row && typeof row === "object" && String(row.code) === String(code) && !row.resolved_at) {
      return { ...row, resolved_at: now };
    }
    return row;
  });
  const { record: updated } = await updateCoordinationRecordFields(supabase, {
    coordinationRecordId: String(record.id),
    fields: {},
    metadataPatch: { uci_alerts: next },
    skipPrediction: true,
  });
  return { record: updated };
}

function listOpenAlerts(record) {
  const meta = asMeta(record);
  const existing = Array.isArray(meta.uci_alerts) ? meta.uci_alerts : [];
  return existing.filter((row) => row && typeof row === "object" && !row.resolved_at);
}

module.exports = {
  raiseUciAlert,
  resolveUciAlert,
  listOpenAlerts,
};
