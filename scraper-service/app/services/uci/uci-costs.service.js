"use strict";

const { normalizeCostType, isAllowedCostType } = require("./uci-lifecycle-constants.js");

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} coordinationRecordId
 * @param {string} projectId
 */
async function listCostsByCoordination(supabase, coordinationRecordId, projectId) {
  const { data, error } = await supabase
    .from("coordination_costs")
    .select("*")
    .eq("coordination_record_id", coordinationRecordId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to load costs"), {
      cause: error,
      statusCode: 500,
      code: "COSTS_FETCH_FAILED",
    });
  }

  return Array.isArray(data) ? data : [];
}

function computeVariance(estimated, actual) {
  if (estimated != null && actual != null && estimated !== 0) {
    return Number((((actual - estimated) / estimated) * 100).toFixed(3));
  }
  return null;
}

/**
 * Persist a cost row. Does NOT upsert-overwrite by cost_type.
 * Only idempotency_key may update an existing row.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function upsertCostRecord(supabase, params) {
  const { coordinationRecordId, projectId, cost, skipLifecycle = false } = params;
  const costType = normalizeCostType(cost.cost_type);
  if (!costType || !isAllowedCostType(cost.cost_type)) {
    const err = new Error(
      cost.cost_type
        ? "cost_type must be one of CIAC, application_fee, design_review, meter, recording, courier"
        : "cost_type is required",
    );
    err.statusCode = 400;
    err.code = cost.cost_type ? "INVALID_COST_TYPE" : "COST_TYPE_REQUIRED";
    throw err;
  }

  const estimated = cost.estimated_amount != null ? Number(cost.estimated_amount) : null;
  const actual = cost.actual_amount != null ? Number(cost.actual_amount) : null;
  const variancePct = computeVariance(estimated, actual);

  const idempotencyKey =
    cost.idempotency_key != null && String(cost.idempotency_key).trim()
      ? String(cost.idempotency_key).trim()
      : null;

  /** @type {Record<string, unknown>} */
  const row = {
    coordination_record_id: coordinationRecordId,
    project_id: projectId,
    cost_type: costType,
    estimated_amount: estimated,
    estimated_at: cost.estimated_at ?? null,
    actual_amount: actual,
    actual_received_at: cost.actual_received_at ?? null,
    variance_pct: variancePct,
    invoice_received_doc_ref: cost.invoice_received_doc_ref ?? null,
    paid_at: cost.paid_at ?? null,
    payment_method: cost.payment_method ?? null,
    client_billed_at: cost.client_billed_at ?? null,
    quickbooks_invoice_id: cost.quickbooks_invoice_id ?? null,
    notes: cost.notes ?? null,
  };
  if (idempotencyKey) row.idempotency_key = idempotencyKey;
  if (cost.cos_design_record_id) row.cos_design_record_id = cost.cos_design_record_id;
  if (cost.estimated_source) row.estimated_source = cost.estimated_source;
  if (cost.actual_source) row.actual_source = cost.actual_source;
  if (cost.client_approval_status) row.client_approval_status = cost.client_approval_status;

  /** @type {Record<string, unknown> | null} */
  let previous = null;
  let created = true;

  if (idempotencyKey) {
    const { data: byKey } = await supabase
      .from("coordination_costs")
      .select("*")
      .eq("coordination_record_id", coordinationRecordId)
      .eq("project_id", projectId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (byKey?.id) {
      previous = byKey;
      created = false;
      const { data, error } = await supabase
        .from("coordination_costs")
        .update(row)
        .eq("id", byKey.id)
        .select("*")
        .single();
      if (error) {
        throw Object.assign(new Error(error.message || "Failed to update cost"), {
          statusCode: 500,
          code: "COST_UPDATE_FAILED",
        });
      }
      if (!skipLifecycle) {
        const { handleCostLifecycleEvent } = require("./uci-cost-tracker.service.js");
        await handleCostLifecycleEvent(supabase, { cost: data, previous, created: false });
      }
      return { cost: data, created: false };
    }
  }

  // Intentionally no lookup-by-cost_type. Multiple CIAC rows may coexist.
  const { data, error } = await supabase
    .from("coordination_costs")
    .insert(row)
    .select("*")
    .single();

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to create cost"), {
      statusCode: 500,
      code: "COST_INSERT_FAILED",
    });
  }

  if (!skipLifecycle) {
    const { handleCostLifecycleEvent } = require("./uci-cost-tracker.service.js");
    await handleCostLifecycleEvent(supabase, { cost: data, previous: null, created: true });
  }

  return { cost: data, created };
}

module.exports = {
  listCostsByCoordination,
  upsertCostRecord,
  computeVariance,
};
