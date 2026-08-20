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
  },
  {
    key: "phase",
    label: "Phase",
    aliases: ["phase", "phases"],
    material: true,
  },
  {
    key: "wire_configuration",
    label: "Wire / service configuration",
    aliases: ["wire_configuration", "service_configuration", "configuration"],
    material: true,
  },
  {
    key: "demand_load_kw",
    label: "Demand / design basis (kW)",
    aliases: ["demand_load_kw", "design_basis_kw", "submitted_demand_kw"],
    material: true,
  },
  {
    key: "meter_location",
    label: "Meter location",
    aliases: ["meter_location", "approved_meter_location"],
    material: true,
  },
  {
    key: "meter_count",
    label: "Meter quantity",
    aliases: ["meter_count", "meter_qty", "number_of_meters"],
    material: true,
  },
  {
    key: "transformer_specs",
    label: "Transformer / service equipment",
    aliases: ["transformer_specs", "transformer", "transformer_kva", "pad_mount"],
    material: true,
  },
  {
    key: "gas_pressure",
    label: "Gas pressure class",
    aliases: ["gas_pressure", "pressure_class", "delivery_pressure"],
    material: true,
  },
  {
    key: "gas_regulator",
    label: "Gas regulator",
    aliases: ["gas_regulator", "regulator", "service_regulator"],
    material: true,
  },
  {
    key: "water_meter_size",
    label: "Water meter size",
    aliases: ["water_meter_size", "meter_size"],
    material: false,
  },
  {
    key: "design_conditions",
    label: "Design conditions",
    aliases: ["design_conditions", "conditions", "easement_required"],
    material: true,
  },
  {
    key: "ciac_estimate",
    label: "CIAC / cost implication",
    aliases: ["ciac_estimate", "additional_cost", "contribution_in_aid"],
    material: true,
  },
]);

module.exports = {
  COS_EVIDENCE_STATUSES,
  COS_REVIEW_STATUSES,
  COS_TRIGGER_CLASSIFICATIONS,
  COS_ANALYSIS_VERSION,
  LOW_CONFIDENCE_THRESHOLD,
  LOW_TEXT_OCR_THRESHOLD,
  COS_COMPARE_FIELDS,
};
