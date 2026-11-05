import { supabase } from "@/lib/supabase";

/** One Supabase Analyzer run, as returned to platform admins. */
export interface AnalyzerUsageRow {
  run_id: string;
  project_id: string;
  project_name: string | null;
  created_at: string;
  completed_at: string | null;
  status: string;
  analyzer_version: "v1" | "v2";
  ai_model: string;
  total_sheets: number;
  completed_sheets: number;
  failed_sheets: number;
  total_input_tokens: number;
  total_output_tokens: number;
  estimated_cost_usd: number;
  budget_limit_usd: number;
}

export interface AnalyzerUsageSummary {
  runs: number;
  totalCostUsd: number;
  monthCostUsd: number;
  completedSheets: number;
}

const USAGE_LIMIT = 200;

export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value);
}

export function formatTokenCount(value: number): string {
  const n = Number(value) || 0;
  return new Intl.NumberFormat("en-US").format(n);
}

/** Totals over the rows the admin page loaded. Month is the UTC month of `now`. */
export function summarizeAnalyzerUsage(rows: readonly AnalyzerUsageRow[], now = new Date()): AnalyzerUsageSummary {
  const month = now.getUTCMonth();
  const year = now.getUTCFullYear();
  let totalCostUsd = 0;
  let monthCostUsd = 0;
  let completedSheets = 0;
  for (const row of rows) {
    const cost = Number(row.estimated_cost_usd) || 0;
    totalCostUsd += cost;
    completedSheets += Number(row.completed_sheets) || 0;
    const created = new Date(row.created_at);
    if (created.getUTCFullYear() === year && created.getUTCMonth() === month) monthCostUsd += cost;
  }
  return { runs: rows.length, totalCostUsd, monthCostUsd, completedSheets };
}

export async function loadAnalyzerUsage(): Promise<AnalyzerUsageRow[]> {
  const { data, error } = await supabase.rpc("admin_supabase_analyzer_usage", { p_limit: USAGE_LIMIT });
  if (error) throw new Error(error.message || "Could not load analyzer usage");
  return (data ?? []) as AnalyzerUsageRow[];
}

export const ANALYZER_USAGE_ROW_LIMIT = USAGE_LIMIT;
