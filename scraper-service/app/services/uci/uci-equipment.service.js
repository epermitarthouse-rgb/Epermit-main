"use strict";

const VALID_EQUIPMENT_STATUSES = new Set([
  "pending",
  "on_order",
  "shipped",
  "delivered",
  "installed",
]);

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} coordinationRecordId
 * @param {string} projectId
 */
async function listEquipmentByCoordination(supabase, coordinationRecordId, projectId) {
  const { data, error } = await supabase
    .from("coordination_equipment")
    .select("*")
    .eq("coordination_record_id", coordinationRecordId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to load equipment"), {
      statusCode: 500,
      code: "EQUIPMENT_FETCH_FAILED",
    });
  }

  return Array.isArray(data) ? data : [];
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function createEquipmentRecord(supabase, params) {
  const { coordinationRecordId, projectId, equipment } = params;
  const equipmentType = String(equipment.equipment_type ?? "").trim();
  if (!equipmentType) {
    const err = new Error("equipment_type is required");
    err.statusCode = 400;
    err.code = "EQUIPMENT_TYPE_REQUIRED";
    throw err;
  }

  const status = String(equipment.status ?? "pending").trim().toLowerCase();
  if (!VALID_EQUIPMENT_STATUSES.has(status)) {
    const err = new Error("Invalid equipment status");
    err.statusCode = 400;
    err.code = "INVALID_EQUIPMENT_STATUS";
    throw err;
  }

  const row = {
    coordination_record_id: coordinationRecordId,
    project_id: projectId,
    equipment_type: equipmentType,
    equipment_size: equipment.equipment_size ?? null,
    initial_eta: equipment.initial_eta ?? null,
    current_eta: equipment.current_eta ?? equipment.initial_eta ?? null,
    eta_history: Array.isArray(equipment.eta_history) ? equipment.eta_history : [],
    status,
    last_check_in_at: equipment.last_check_in_at ?? null,
    next_check_in_at: equipment.next_check_in_at ?? null,
    weeks_of_slip: equipment.weeks_of_slip ?? null,
  };

  const { data, error } = await supabase
    .from("coordination_equipment")
    .insert(row)
    .select("*")
    .single();

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to create equipment record"), {
      statusCode: 500,
      code: "EQUIPMENT_INSERT_FAILED",
    });
  }

  return { equipment: data };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function recordEquipmentCheckIn(supabase, params) {
  const { equipmentId, projectId, currentEta, status } = params;

  const { data: existing, error: fetchErr } = await supabase
    .from("coordination_equipment")
    .select("*")
    .eq("id", equipmentId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (fetchErr || !existing) {
    const err = new Error("Equipment record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const now = new Date().toISOString();
  const history = Array.isArray(existing.eta_history) ? [...existing.eta_history] : [];
  if (existing.current_eta) {
    history.push({ eta: existing.current_eta, recorded_at: now });
  }

  let weeksOfSlip = existing.weeks_of_slip;
  if (existing.initial_eta && currentEta) {
    const initial = new Date(existing.initial_eta);
    const current = new Date(currentEta);
    if (!Number.isNaN(initial.getTime()) && !Number.isNaN(current.getTime())) {
      weeksOfSlip = Number(((current.getTime() - initial.getTime()) / (7 * 86400000)).toFixed(2));
    }
  }

  const { data, error } = await supabase
    .from("coordination_equipment")
    .update({
      current_eta: currentEta ?? existing.current_eta,
      status: status ?? existing.status,
      eta_history: history,
      last_check_in_at: now,
      next_check_in_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      weeks_of_slip: weeksOfSlip,
    })
    .eq("id", equipmentId)
    .select("*")
    .single();

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to record equipment check-in"), {
      statusCode: 500,
      code: "EQUIPMENT_UPDATE_FAILED",
    });
  }

  return {
    equipment: data,
    slip_alert: weeksOfSlip != null && Number(weeksOfSlip) > 2,
  };
}

module.exports = {
  VALID_EQUIPMENT_STATUSES,
  listEquipmentByCoordination,
  createEquipmentRecord,
  recordEquipmentCheckIn,
};
