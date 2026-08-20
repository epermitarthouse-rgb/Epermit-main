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
    next_check_in_at: equipment.next_check_in_at ?? new Date().toISOString(),
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
  const { equipmentId, projectId, currentEta, status, source = "operator" } = params;
  const { appendEquipmentEta } = require("./uci-equipment-tracker.service.js");
  return appendEquipmentEta(supabase, {
    equipmentId,
    projectId,
    eta: currentEta,
    status,
    source,
    checkInMethod: "manual_recovery",
  });
}

module.exports = {
  VALID_EQUIPMENT_STATUSES,
  listEquipmentByCoordination,
  createEquipmentRecord,
  recordEquipmentCheckIn,
};
