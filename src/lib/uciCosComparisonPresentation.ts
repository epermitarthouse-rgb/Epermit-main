/**
 * Stage 6 COS comparison table — operator-facing value formatting only.
 * Comparison rows may store scalars or load-profile objects `{ value, unit }`.
 */

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
