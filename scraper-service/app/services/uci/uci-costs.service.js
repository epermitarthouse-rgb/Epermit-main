"use strict";

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

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 * @param {string} params.coordinationRecordId
 * @param {string} params.projectId
 * @param {Record<string, unknown>} params.cost
 */
async function upsertCostRecord(supabase, params) {
  const { coordinationRecordId, projectId, cost } = params;
  const costType = String(cost.cost_type ?? "").trim();
  if (!costType) {
    const err = new Error("cost_type is required");
    err.statusCode = 400;
    err.code = "COST_TYPE_REQUIRED";
    throw err;
  }

  const estimated = cost.estimated_amount != null ? Number(cost.estimated_amount) : null;
  const actual = cost.actual_amount != null ? Number(cost.actual_amount) : null;
  let variancePct = null;
  if (estimated != null && actual != null && estimated !== 0) {
    variancePct = Number((((actual - estimated) / estimated) * 100).toFixed(3));
  }

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

  const { data: existing } = await supabase
    .from("coordination_costs")
    .select("id")
    .eq("coordination_record_id", coordinationRecordId)
    .eq("project_id", projectId)
    .eq("cost_type", costType)
    .maybeSingle();

  if (existing?.id) {
    const { data, error } = await supabase
      .from("coordination_costs")
      .update(row)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) {
      throw Object.assign(new Error(error.message || "Failed to update cost"), {
        statusCode: 500,
        code: "COST_UPDATE_FAILED",
      });
    }
    return { cost: data, created: false };
  }

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

  return { cost: data, created: true };
}

module.exports = {
  listCostsByCoordination,
  upsertCostRecord,
};
