/** Parse and display helpers for D2.1 load profile `load_summary` JSON. */

export type UciLoadProfileAnalysisStatus =
  | "preliminary"
  | "missing_inputs"
  | "blocked";

export interface UciLoadProfileInputUsed {
  key: string;
  source: string;
  value?: unknown;
}

export interface UciLoadProfileSourceDocument {
  id?: string;
  document_type?: string;
  file_name?: string;
}

export interface UciLoadProfileSummary {
  version: string;
  utility_type: string;
  analysis_status: UciLoadProfileAnalysisStatus;
  inputs_used: UciLoadProfileInputUsed[];
  missing_inputs: string[];
  needs_verification: string[];
  assumptions: {
    template_id: string | null;
    template_version: string | null;
    notes: string[];
  };
  calculated_values: Record<string, unknown>;
  source_documents: UciLoadProfileSourceDocument[];
  generated_at: string;
  generated_by: string;
  generated_by_user_id?: string;
  requires_human_review: boolean;
}

const ENGINEERING_NUMERIC_KEYS = new Set([
  "kw",
  "kilowatts",
  "amperage",
  "amps",
  "amperes",
  "service_voltage",
  "voltage",
  "phase",
  "meter_count",
  "btu",
  "btu_h",
  "btuh",
  "gpm",
  "dfu",
  "service_size",
]);

export function isUciLoadProfileSummary(value: unknown): value is UciLoadProfileSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.version === "string" &&
    typeof rec.utility_type === "string" &&
    typeof rec.analysis_status === "string" &&
    Array.isArray(rec.missing_inputs)
  );
}

export function getLoadProfileDraftApplication<
  T extends { record_source?: string | null; idempotency_key?: string | null; load_summary?: unknown },
>(applications: T[] | null | undefined): T | null {
  if (!applications?.length) return null;
  return (
    applications.find(
      (app) =>
        app.record_source === "agent_draft" &&
        String(app.idempotency_key || "").startsWith("agent_2_load_profile:"),
    ) ?? null
  );
}

export function parseLoadProfileSummary(loadSummary: unknown): UciLoadProfileSummary | null {
  if (!isUciLoadProfileSummary(loadSummary)) return null;
  return loadSummary;
}

export function formatLoadProfileAnalysisStatus(status: string | undefined): string {
  switch (status) {
    case "missing_inputs":
      return "Missing inputs";
    case "blocked":
      return "Blocked";
    case "preliminary":
      return "Preliminary — human review required";
    default:
      return status || "Not analyzed";
  }
}

export function loadProfileStatusTone(
  status: string | undefined,
): "neutral" | "warning" | "blocked" | "info" {
  if (status === "blocked") return "blocked";
  if (status === "missing_inputs") return "warning";
  if (status === "preliminary") return "info";
  return "neutral";
}

/** Returns verified numeric entries only — empty when none supplied. */
export function getVerifiedCalculatedValues(
  summary: UciLoadProfileSummary | null,
): Array<{ key: string; value: unknown }> {
  if (!summary?.calculated_values || typeof summary.calculated_values !== "object") {
    return [];
  }
  return Object.entries(summary.calculated_values).filter(([key, value]) => {
    if (value == null || value === "") return false;
    return !ENGINEERING_NUMERIC_KEYS.has(key.toLowerCase()) || typeof value === "number" || typeof value === "string";
  }).map(([key, value]) => ({ key, value }));
}

export function hasInventedEngineeringValues(summary: UciLoadProfileSummary | null): boolean {
  if (!summary?.calculated_values) return false;
  return Object.keys(summary.calculated_values).some((key) =>
    ENGINEERING_NUMERIC_KEYS.has(key.toLowerCase()),
  );
}
