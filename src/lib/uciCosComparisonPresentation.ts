/**
 * Stage 6 COS comparison table — operator-facing value formatting only.
 * Comparison rows may store scalars or load-profile objects `{ value, unit }`.
 */

/** Core electric COS fields required before Stage 6 can complete. */
export const COS_REQUIRED_FOR_ACCEPTANCE_FIELDS = [
  "service_amperage",
  "service_voltage",
  "phase",
  "wire_configuration",
] as const;

export function isRequiredForCosAcceptance(fieldKey: string): boolean {
  if (!fieldKey) return false;
  const optional = new Set([
    "demand_load_kw",
    "meter_count",
    "meter_location",
    "transformer_specs",
    "design_conditions",
    "ciac_estimate",
    "gas_regulator",
    "water_meter_size",
  ]);
  if (optional.has(fieldKey)) return false;
  if ((COS_REQUIRED_FOR_ACCEPTANCE_FIELDS as readonly string[]).includes(fieldKey)) return true;
  if (fieldKey === "gas_pressure") return true;
  return false;
}

/** Whether a comparison row still blocks Stage 6 completion / manual approve. */
export function isBlockingCosComparisonRow(row: Record<string, unknown>): boolean {
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

function formatScalarWithUnit(value: unknown, unit?: unknown): string {
  const unitStr =
    unit != null && String(unit).trim() !== "" ? ` ${String(unit).trim()}` : "";
  return `${String(value)}${unitStr}`;
}

/**
 * Render a submitted / utility / accepted comparison cell without `[object Object]`.
 */
export function formatCosComparisonCellValue(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (obj.value != null && obj.value !== "") {
      const inner = obj.value;
      // Calculated load-profile entries are occasionally nested when baseline picks
      // a full `{ value, unit }` object as the scalar value.
      if (
        typeof inner === "object" &&
        inner !== null &&
        !Array.isArray(inner) &&
        "value" in inner
      ) {
        const nested = inner as Record<string, unknown>;
        if (nested.value != null && nested.value !== "") {
          return formatScalarWithUnit(nested.value, nested.unit ?? obj.unit);
        }
      }
      return formatScalarWithUnit(inner, obj.unit);
    }
  }
  return String(value);
}
