import { useEffect, useState } from "react";
import { format } from "date-fns";
import { CircleDollarSign, Loader2 } from "lucide-react";
import { AdminPageShell } from "@/components/admin/AdminPageShell";
import { AlertBanner, MetricCard, Panel } from "@/components/design/ProductPrimitives";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ANALYZER_USAGE_ROW_LIMIT,
  formatTokenCount,
  formatUsd,
  loadAnalyzerUsage,
  summarizeAnalyzerUsage,
  type AnalyzerUsageRow,
} from "@/lib/adminAnalyzerUsage";

function versionLabel(version: AnalyzerUsageRow["analyzer_version"]): string {
  return version === "v2" ? "V2 (4×3 OCR)" : "V1";
}

export default function AdminAiUsage() {
  const [rows, setRows] = useState<AnalyzerUsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const usage = await loadAnalyzerUsage();
        if (!cancelled) setRows(usage);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load analyzer usage");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const summary = summarizeAnalyzerUsage(rows);

  return (
    <AdminPageShell
      variant="editorial"
      title="AI usage"
      description="What each Supabase Analyzer run cost. Figures are the estimated cost recorded from token usage."
      breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "AI usage" }]}
    >
      {error ? <AlertBanner tone="bad" title="Could not load AI usage" detail={error} /> : null}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-6 w-6 animate-spin" />
          Loading analyzer usage…
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Total spend" value={formatUsd(summary.totalCostUsd)} icon={CircleDollarSign} detail="All loaded runs" />
            <MetricCard label="This month" value={formatUsd(summary.monthCostUsd)} icon={CircleDollarSign} detail="UTC month" />
            <MetricCard label="Runs" value={summary.runs} detail="Supabase Analyzer" />
            <MetricCard label="Sheets completed" value={formatTokenCount(summary.completedSheets)} detail="Across loaded runs" />
          </div>

          <Panel title="Run cost" eyebrow="supabase_analyzer_runs">
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No analyzer runs yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead>Version</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Sheets</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead className="text-right">Tokens</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="text-right">Budget</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.run_id}>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {format(new Date(row.created_at), "MMM d, yyyy HH:mm")}
                        </TableCell>
                        <TableCell className="text-sm">
                          <div>{row.project_name || "Untitled project"}</div>
                          <div className="text-xs text-muted-foreground">{row.run_id.slice(0, 8)}</div>
                        </TableCell>
                        <TableCell className="text-sm">{versionLabel(row.analyzer_version)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">{row.status.replaceAll("_", " ")}</Badge>
                        </TableCell>
                        <TableCell className="text-sm tabular-nums">
                          {row.completed_sheets}/{row.total_sheets}
                          {row.failed_sheets > 0 ? <span className="text-destructive"> · {row.failed_sheets} failed</span> : null}
                        </TableCell>
                        <TableCell className="text-sm">{row.ai_model}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                          {formatTokenCount(Number(row.total_input_tokens) + Number(row.total_output_tokens))}
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium tabular-nums">{formatUsd(Number(row.estimated_cost_usd))}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums text-muted-foreground">{formatUsd(Number(row.budget_limit_usd))}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {rows.length >= ANALYZER_USAGE_ROW_LIMIT ? (
              <p className="mt-4 text-xs text-muted-foreground">Showing the latest {ANALYZER_USAGE_ROW_LIMIT} runs.</p>
            ) : null}
          </Panel>
        </div>
      )}
    </AdminPageShell>
  );
}
