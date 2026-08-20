"use strict";

/**
 * Resolve Stage 9 meter-set predicates from durable columns with metadata/milestone fallbacks.
 * Writes must populate coordination_records columns; fallbacks cover read-after-write lag only.
 */

function asMeta(record) {
  if (record?.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)) {
    return /** @type {Record<string, unknown>} */ (record.metadata);
  }
  return {};
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

function toIsoOrNull(value) {
  if (value == null || value === "") return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * @param {Record<string, unknown> | null | undefined} record
 * @param {Array<Record<string, unknown>>} [milestones]
 */
function resolveMeterSetScheduledAt(record, milestones = []) {
  const column = toIsoOrNull(record?.meter_set_scheduled_at);
  if (column) return column;

  const meter = asRecord(asMeta(record).uci_meter_set);
  const fromMeta = toIsoOrNull(meter.scheduled_at) || toIsoOrNull(meter.scheduled_date);
  if (fromMeta) return fromMeta;

  const milestone = milestones.find((m) => {
    const type = String(m.milestone_type || "");
    const status = String(m.status || "");
    return type === "meter_set" && (status === "scheduled" || status === "completed");
  });
  return toIsoOrNull(milestone?.target_date);
}

/**
 * @param {Record<string, unknown> | null | undefined} record
 */
function resolveSiteReadinessConfirmedAt(record) {
  const column = toIsoOrNull(record?.site_readiness_confirmed_at);
  if (column) return column;
  const site = asRecord(asMeta(record).site_readiness);
  return toIsoOrNull(site.confirmed_at);
}

/**
 * @param {Record<string, unknown>} result
 * @param {string} actionLabel
 */
function rejectMeterSetSoftFailure(result, actionLabel) {
  const blocked =
    result?.scheduled === false ||
    result?.confirmed === false ||
    result?.started === false ||
    result?.recorded === false;
  if (!blocked) return;
  const reason = String(result?.reason || "preconditions_not_met");
  const err = new Error(`${actionLabel} blocked (${reason.replace(/_/g, " ")})`);
  err.statusCode = 409;
  err.code = String(result?.code || reason || "METER_SET_BLOCKED").toUpperCase();
  err.details = result;
  throw err;
}

module.exports = {
  resolveMeterSetScheduledAt,
  resolveSiteReadinessConfirmedAt,
  rejectMeterSetSoftFailure,
};
