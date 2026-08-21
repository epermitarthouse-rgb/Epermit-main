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

export type CosApprovalActionState =
  | { status: "hidden" }
  | { status: "actionable"; label: string; disabled: boolean }
  | { status: "approved"; label: string; autoCompleted: boolean };

export type CosComparisonRowActionState = {
  canEditAccepted: boolean;
  canEditInclusion: boolean;
  showEdit: boolean;
  showResetToUtility: boolean;
  readOnly: boolean;
};

/** Stage 6 COS approve button from persisted review_status / evidence. */
export function deriveCosApprovalAction(input: {
  reviewStatus: string;
  evidenceStatus: string;
  autoCompleted: boolean;
  hasMaterial: boolean;
  busy: boolean;
  hasEvidence: boolean;
}): CosApprovalActionState {
  const isApproved = input.reviewStatus === "approved";

  if (input.autoCompleted || (isApproved && !input.hasMaterial)) {
    return {
      status: "approved",
      label: "COS matched · Stage 6 completed automatically",
      autoCompleted: true,
    };
  }

  if (isApproved) {
    return {
      status: "approved",
      label: "COS approved",
      autoCompleted: false,
    };
  }

  if (!input.hasEvidence) {
    return { status: "hidden" };
  }

  return {
    status: "actionable",
    label: "Approve COS",
    disabled: input.busy || input.evidenceStatus === "ADVISORY",
  };
}

/** Per-row accept/edit controls — read-only after approval or terminal review states. */
export function deriveCosComparisonRowAction(input: {
  row: Record<string, unknown>;
  reviewStatus: string;
  evidenceStatus: string;
  busy: boolean;
  hasUpdateHandlers: boolean;
}): CosComparisonRowActionState {
  const isClosed =
    input.reviewStatus === "approved" ||
    input.evidenceStatus === "ADVISORY" ||
    input.reviewStatus === "rejected" ||
    input.reviewStatus === "superseded";
  const canEdit = input.hasUpdateHandlers && !isClosed;

  return {
    canEditAccepted: canEdit,
    canEditInclusion: canEdit,
    showEdit: canEdit,
    showResetToUtility:
      canEdit &&
      (input.row.operator_override === true || input.row.utility_conflict === true),
    readOnly: isClosed,
  };
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
