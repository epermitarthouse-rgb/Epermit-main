"use strict";

/** Stage 6 evidence provenance — never treat ADVISORY as utility-issued. */
const COS_EVIDENCE_STATUSES = Object.freeze(["ADVISORY", "UTILITY_ISSUED", "DISCREPANCY"]);

const COS_REVIEW_STATUSES = Object.freeze([
  "pending",
  "ready_for_approval",
  "needs_attention",
  "revision_required",
  "approved",
  "rejected",
  "superseded",
]);

const COS_TRIGGER_CLASSIFICATIONS = Object.freeze([
  "class_of_service",
  "design_review_response",
]);

const COS_ANALYSIS_VERSION = "stage6-v1";
const LOW_CONFIDENCE_THRESHOLD = 0.75;
const LOW_TEXT_OCR_THRESHOLD = 80;

/**
 * Core electric COS fields required before Stage 6 can complete.
 * Optional utility omissions (demand basis, meter qty, etc.) are informational only.
 */
const COS_REQUIRED_FOR_ACCEPTANCE_KEYS = Object.freeze([
  "service_amperage",
  "service_voltage",
  "phase",
  "wire_configuration",
]);

/** Comparison field keys used in discrepancy engine + UI table */
const COS_COMPARE_FIELDS = Object.freeze([
  {
    key: "service_amperage",
    label: "Service capacity / amperage",
    aliases: [
      "service_amperage",
      "service_capacity_a",
      "service_size_a",
      "service_entrance_amperage",
      "requested_service_amperage",
      "amperage",
      "amps",
    ],
    material: true,
    required_for_acceptance: true,
  },
  {
    key: "service_voltage",
    label: "Voltage",
    aliases: [
      "service_voltage",
      "voltage",
      "requested_voltage",
      "assigned_voltage",
      "service_entrance_voltage",
    ],
    material: true,
    required_for_acceptance: true,
  },
  {
    key: "phase",
    label: "Phase",
    aliases: ["phase", "phases"],
    material: true,
    required_for_acceptance: true,
  },
  {
    key: "wire_configuration",
    label: "Wire / service configuration",
    aliases: ["wire_configuration", "service_configuration", "configuration"],
    material: true,
    required_for_acceptance: true,
  },
  {
    key: "demand_load_kw",
    label: "Demand / design basis (kW)",
    aliases: ["demand_load_kw", "design_basis_kw", "submitted_demand_kw"],
    material: true,
    required_for_acceptance: false,
  },
  {
    key: "meter_location",
    label: "Meter location",
    aliases: ["meter_location", "approved_meter_location"],
    material: true,
    required_for_acceptance: false,
  },
  {
    key: "meter_count",
    label: "Meter quantity",
    aliases: ["meter_count", "meter_qty", "number_of_meters"],
    material: true,
    required_for_acceptance: false,
  },
  {
    key: "transformer_specs",
    label: "Transformer / service equipment",
    aliases: ["transformer_specs", "transformer", "transformer_kva", "pad_mount"],
    material: true,
    required_for_acceptance: false,
  },
  {
    key: "gas_pressure",
    label: "Gas pressure class",
    aliases: ["gas_pressure", "pressure_class", "delivery_pressure"],
    material: true,
    required_for_acceptance: true,
  },
  {
    key: "gas_regulator",
    label: "Gas regulator",
    aliases: ["gas_regulator", "regulator", "service_regulator"],
    material: true,
    required_for_acceptance: false,
  },
  {
    key: "water_meter_size",
    label: "Water meter size",
    aliases: ["water_meter_size", "meter_size"],
    material: false,
    required_for_acceptance: false,
  },
  {
    key: "design_conditions",
    label: "Design conditions",
    aliases: ["design_conditions", "conditions", "easement_required"],
    material: true,
    required_for_acceptance: false,
  },
  {
    key: "ciac_estimate",
    label: "CIAC / cost implication",
    aliases: ["ciac_estimate", "additional_cost", "contribution_in_aid"],
    material: true,
    required_for_acceptance: false,
  },
]);

/**
 * @param {string} fieldKey
 */
function isRequiredForCosAcceptance(fieldKey) {
  const def = COS_COMPARE_FIELDS.find((f) => f.key === String(fieldKey || ""));
  if (def && def.required_for_acceptance === false) return false;
  if (COS_REQUIRED_FOR_ACCEPTANCE_KEYS.includes(String(fieldKey || ""))) return true;
  return def?.required_for_acceptance === true;
}

/**
 * Whether a comparison row result blocks Stage 6 completion / approval.
 * @param {Record<string, unknown> | null | undefined} row
 */
function isBlockingComparisonRow(row) {
  if (!row || typeof row !== "object") return false;
  const result = String(row.result || "");
  const field = String(row.field || "");
  if (result === "match" || result === "insufficient_data") return false;
  if (result === "utility_not_provided") return false;
  if (result === "utility_value_missing" && !isRequiredForCosAcceptance(field)) return false;
  if (row.utility_conflict === true || result === "document_conflict") {
    return row.accepted == null || row.accepted === "";
  }
  if (result === "baseline_missing") return false;
  return true;
}

module.exports = {
  COS_EVIDENCE_STATUSES,
  COS_REVIEW_STATUSES,
  COS_TRIGGER_CLASSIFICATIONS,
  COS_ANALYSIS_VERSION,
  LOW_CONFIDENCE_THRESHOLD,
  LOW_TEXT_OCR_THRESHOLD,
  COS_COMPARE_FIELDS,
  COS_REQUIRED_FOR_ACCEPTANCE_KEYS,
  isRequiredForCosAcceptance,
  isBlockingComparisonRow,
};
