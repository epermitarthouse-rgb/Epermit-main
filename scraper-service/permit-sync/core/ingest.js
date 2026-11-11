"use strict";

/**
 * Builds the JSON batch consumed by public.apply_permit_sync_batch and applies it through an RPC
 * client. The database computes diffs and change history (D-015); this module only shapes data and
 * enforces extraction-integrity guards before anything is written:
 *
 *  - a section whose item counts disagree with an independent portal count is downgraded from
 *    'ok' to 'partial' (listed rows are upserted, nothing is removed);
 *  - permit fields contributed by a section are dropped unless that section is ok/partial, so a
 *    failed status read can never blank existing values (null fields are also ignored by the DB);
 *  - snapshots are redacted and only taken for sections that produced data.
 */

const { sha256, canonicalize } = require("./canonical");
const { redactPayload } = require("./redact");

const SECTIONS = Object.freeze(["status", "info", "reviews", "tasks", "workflows", "files", "reports"]);
const STATUSES = Object.freeze(["ok", "partial", "absent", "failed"]);
const SOURCE_KINDS = Object.freeze(["json", "html", "report", "dom"]);

function countItems(tables) {
  return Object.values(tables || {}).reduce((n, items) => n + items.length, 0);
}

/**
 * @param {object} input
 * @param {string} input.adapterKey
 * @param {string|null} input.credentialId
 * @param {string|null} input.runId
 * @param {string} [input.capturedAt] ISO timestamp
 * @param {string} input.portalRecordId
 * @param {object} [input.permitFields] identity-level fields (from discovery)
 * @param {Record<string, {
 *   status: 'ok'|'partial'|'absent'|'failed',
 *   sourceKind?: 'json'|'html'|'report'|'dom',
 *   tables?: Record<string, Array<{key:string,hash:string,fields:object}>>,
 *   fields?: object,
 *   expectedCounts?: Record<string, number>,
 *   confirmedEmpty?: boolean,
 *   raw?: unknown,
 *   error?: string,
 * }>} input.sections
 */
function buildBatch(input) {
  if (!input || !input.adapterKey) throw new Error("adapterKey is required");
  if (!input.portalRecordId) throw new Error("portalRecordId is required");

  const permitFields = { ...(input.permitFields || {}) };
  const sections = {};
  const snapshots = [];
  const warnings = [];
  const available = [];
  let anyUnknownAvailability = false;

  for (const [name, sec] of Object.entries(input.sections || {})) {
    if (!SECTIONS.includes(name)) throw new Error(`unknown section ${name}`);
    if (!STATUSES.includes(sec.status)) throw new Error(`invalid status ${sec.status} for ${name}`);
    if (sec.sourceKind && !SOURCE_KINDS.includes(sec.sourceKind)) throw new Error(`invalid sourceKind for ${name}`);

    let status = sec.status;
    let error = sec.error || null;
    const tables = sec.tables || {};

    if (status === "ok" && sec.expectedCounts) {
      for (const [table, expected] of Object.entries(sec.expectedCounts)) {
        if (expected === null || expected === undefined) continue;
        const actual = (tables[table] || []).length;
        if (actual !== expected) {
          status = "partial";
          error = `count_mismatch:${table}:${actual}/${expected}`;
          warnings.push({ section: name, error });
        }
      }
    }

    if (status === "ok" || status === "partial") {
      if (sec.fields) Object.assign(permitFields, sec.fields);
      available.push(name);
    } else if (status === "failed") {
      anyUnknownAvailability = true;
    }

    const content = sec.fields ? { fields: canonicalize(sec.fields), tables } : { tables };
    sections[name] = {
      status,
      source_kind: sec.sourceKind || null,
      hash: status === "ok" || status === "partial" ? sha256(content) : null,
      item_count: status === "ok" || status === "partial" ? countItems(tables) : null,
      confirmed_empty: Boolean(sec.confirmedEmpty),
      error,
      tables: status === "ok" || status === "partial" ? tables : {},
    };

    if ((status === "ok" || status === "partial") && sec.raw !== undefined) {
      const payload = redactPayload(sec.raw);
      snapshots.push({ section: name, source_kind: sec.sourceKind || "json", hash: sha256(payload), payload });
    }
  }

  if (!anyUnknownAvailability && available.length) {
    permitFields.available_sections = [...available].sort();
  }

  return {
    batch: {
      adapter_key: input.adapterKey,
      credential_id: input.credentialId || null,
      run_id: input.runId || null,
      captured_at: input.capturedAt || new Date().toISOString(),
      permit: { portal_record_id: String(input.portalRecordId), fields: canonicalize(permitFields) },
      sections,
      snapshots,
    },
    warnings,
  };
}

function buildDiscovery({ adapterKey, credentialId, runId, capturedAt, records, expectedTotal, complete }) {
  const seen = new Set();
  for (const r of records) {
    if (seen.has(r.portal_record_id)) throw new Error(`duplicate portal_record_id ${r.portal_record_id}`);
    seen.add(r.portal_record_id);
  }
  return {
    adapter_key: adapterKey,
    credential_id: credentialId || null,
    run_id: runId || null,
    captured_at: capturedAt || new Date().toISOString(),
    complete: Boolean(complete) && Number.isInteger(expectedTotal) && expectedTotal === records.length,
    expected_total: Number.isInteger(expectedTotal) ? expectedTotal : null,
    records,
  };
}

/** Wraps a supabase-js client (service role) as the rpc interface used by the worker. */
function supabaseRpc(client) {
  return {
    async applyBatch(batch) {
      const { data, error } = await client.rpc("apply_permit_sync_batch", { p_batch: batch });
      if (error) throw new Error(`apply_permit_sync_batch: ${error.message}`);
      return data;
    },
    async applyDiscovery(discovery) {
      const { data, error } = await client.rpc("apply_permit_discovery", { p_discovery: discovery });
      if (error) throw new Error(`apply_permit_discovery: ${error.message}`);
      return data;
    },
  };
}

module.exports = { SECTIONS, buildBatch, buildDiscovery, supabaseRpc };
