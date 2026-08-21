"use strict";

/**
 * Authoritative UCI document role → stage consumer rules.
 * Frontend displays stage usage derived from these rules; do not duplicate in UI-only logic.
 */

/** @type {ReadonlySet<string>} */
const NORMALIZED_ROLES = new Set([
  "load_letter",
  "load_calculation_worksheet",
  "single_line_diagram",
  "equipment_schedule",
  "construction_schedule",
  "equipment_cut_sheet",
  "site_plan",
  "letter_of_authorization",
  "class_of_service",
  "ciac",
  "equipment_evidence",
  "meter_regulator",
  "closeout",
  "panel_schedule",
  "electrical_plan",
  "comcheck",
  "service_plan",
  "load_profile",
  "supporting_document",
  "correspondence",
  "other",
]);

/**
 * Maps classified document types (from uci-document-classification) to normalized registry roles.
 * @type {Record<string, string>}
 */
const DOCUMENT_TYPE_TO_ROLE = {
  load_profile: "load_letter",
  electric_load_letter: "load_letter",
  electric_load_calc: "load_calculation_worksheet",
  load_calculation_worksheet: "load_calculation_worksheet",
  one_line_diagram: "single_line_diagram",
  equipment_schedule: "equipment_schedule",
  construction_schedule: "construction_schedule",
  cut_sheet: "equipment_cut_sheet",
  site_plan: "site_plan",
  civil_plan: "site_plan",
  letter_of_authorization: "letter_of_authorization",
  class_of_service: "class_of_service",
  meter_regulator: "meter_regulator",
  panel_schedule: "panel_schedule",
  electrical_plan: "electrical_plan",
  electrical_specification: "equipment_evidence",
  comcheck: "comcheck",
  service_plan: "service_plan",
  correspondence: "correspondence",
  supporting_document: "supporting_document",
  other: "other",
};

/**
 * Role → UCI stage numbers that consume this document.
 * @type {Record<string, number[]>}
 */
const ROLE_STAGE_CONSUMERS = {
  load_letter: [2],
  load_calculation_worksheet: [2, 3],
  single_line_diagram: [2, 3, 6],
  equipment_schedule: [2, 3],
  construction_schedule: [2, 3],
  equipment_cut_sheet: [2, 3],
  site_plan: [2, 3, 6],
  letter_of_authorization: [3, 4],
  class_of_service: [6],
  ciac: [6, 7],
  equipment_evidence: [2, 3],
  meter_regulator: [2, 8],
  closeout: [9, 10],
  panel_schedule: [2, 6],
  electrical_plan: [2, 6],
  comcheck: [2],
  service_plan: [2],
  load_profile: [2],
  correspondence: [5],
  supporting_document: [2],
  other: [],
};

/**
 * Normalized role → provider template slot key aliases.
 * @type {Record<string, string[]>}
 */
const ROLE_PROVIDER_SLOT_KEYS = {
  load_letter: ["load_letter", "load_profile_letter", "electric_load_letter"],
  load_calculation_worksheet: [
    "load_calculation_worksheet",
    "load_worksheet",
    "load_calc",
    "load_calculation",
  ],
  single_line_diagram: [
    "single_line_diagram",
    "single_line",
    "one_line",
    "one_line_diagram",
    "electrical_single_line",
  ],
  equipment_schedule: ["equipment_schedule", "equipment_utility_schedule"],
  construction_schedule: ["construction_schedule", "construction_service_schedule"],
  equipment_cut_sheet: [
    "equipment_cut_sheet",
    "equipment_cut_sheets",
    "cut_sheet",
    "equipment_spec",
    "equipment_specs",
  ],
  site_plan: ["site_plan", "site_utility_plan", "civil_plan", "site", "plot_plan"],
  letter_of_authorization: ["letter_of_authorization", "authorization", "loa"],
  class_of_service: ["class_of_service", "cos"],
  meter_regulator: ["meter", "meter_regulator"],
  closeout: ["closeout", "closeout_package"],
  panel_schedule: ["panel_schedule"],
  ciac: ["ciac"],
  equipment_evidence: ["equipment_evidence"],
};

/**
 * @param {string | null | undefined} documentType
 * @returns {string}
 */
function normalizeDocumentTypeToRole(documentType) {
  const key = String(documentType ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!key || key === "unknown") return "other";
  return DOCUMENT_TYPE_TO_ROLE[key] ?? key;
}

/**
 * @param {string | null | undefined} role
 * @returns {number[]}
 */
function resolveStageConsumersForRole(role) {
  const normalized = String(role ?? "").trim().toLowerCase();
  return ROLE_STAGE_CONSUMERS[normalized] ?? [];
}

/**
 * @param {string | null | undefined} role
 * @returns {string[]}
 */
function resolveProviderSlotKeysForRole(role) {
  const normalized = String(role ?? "").trim().toLowerCase();
  return ROLE_PROVIDER_SLOT_KEYS[normalized] ?? (normalized && normalized !== "other" ? [normalized] : []);
}

/**
 * Match a registry role against provider template slot aliases.
 *
 * @param {string | null | undefined} role
 * @param {Array<{ key?: string, aliases?: string[] }>} requiredDocuments
 * @returns {string[]}
 */
function matchProviderSlotsForRole(role, requiredDocuments) {
  const roleKeys = resolveProviderSlotKeysForRole(role);
  if (!roleKeys.length) return [];
  /** @type {string[]} */
  const matched = [];
  for (const req of requiredDocuments) {
    const slotKey = String(req.key ?? "").trim();
    if (!slotKey) continue;
    const aliases = [
      slotKey,
      ...(Array.isArray(req.aliases) ? req.aliases.map((a) => String(a)) : []),
    ].map((a) =>
      String(a)
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_"),
    );
    if (roleKeys.some((rk) => aliases.includes(rk))) {
      matched.push(slotKey);
    }
  }
  return matched;
}

/**
 * @param {string} confidence
 * @returns {"auto_accepted" | "review_recommended" | "needs_classification"}
 */
function resolveClassificationReview(confidence, effectiveRole) {
  if (!effectiveRole || effectiveRole === "other" || effectiveRole === "supporting_document") {
    return "needs_classification";
  }
  if (confidence === "high") return "auto_accepted";
  if (confidence === "medium") return "review_recommended";
  return "needs_classification";
}

module.exports = {
  NORMALIZED_ROLES,
  DOCUMENT_TYPE_TO_ROLE,
  ROLE_STAGE_CONSUMERS,
  ROLE_PROVIDER_SLOT_KEYS,
  normalizeDocumentTypeToRole,
  resolveStageConsumersForRole,
  resolveProviderSlotKeysForRole,
  matchProviderSlotsForRole,
  resolveClassificationReview,
};
