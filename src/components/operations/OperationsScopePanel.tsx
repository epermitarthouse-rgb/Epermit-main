import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataSourceBadge } from "@/components/operations/DataSourceBadge";
import { SectionShell } from "@/components/operations/OperationsShared";
import { exportMockScopeCsv } from "@/lib/operations/operations-csv";
import { mockScopeTotals } from "@/lib/operations/operations-demo-data";
import { formatUsd } from "@/lib/operations/operations-format";
import type { MockScopeLine, OperationsProjectHeader } from "@/lib/operations/operations-types";
import { MOCK_WORKFLOW_NOTICE } from "@/lib/operations/operations-types";

export function OperationsScopePanel({
  header,
  mockRows,
}: {
  header: OperationsProjectHeader;
  mockRows: MockScopeLine[];
}) {
  const totals = mockScopeTotals(mockRows);

  return (
    <div className="space-y-6">
      <SectionShell
        title="Project client & contract"
        accentClass="text-sky-600 dark:text-sky-400"
        source="partial"
        sourceDetail="Project-level client / service / contract fields only. No scope line ledger exists yet."
      >
        <div className="grid gap-3 px-4 py-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Client</p>
            <p className="mt-0.5 text-sm font-medium">{header.clientName || "—"}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Client email</p>
            <p className="mt-0.5 font-mono text-xs text-sky-600 dark:text-sky-400">
              {header.clientEmail || "—"}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Service type</p>
            <p className="mt-0.5 text-sm">{header.serviceType || "—"}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Contract value</p>
            <p className="mt-0.5 font-mono text-sm">{formatUsd(header.contractValue)}</p>
          </div>
        </div>
        <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          Contract value is a project scalar — not the sum of the illustrative scope lines below.
        </p>
      </SectionShell>

      <SectionShell
        title={`Illustrative scope · ${mockRows.length} items`}
        accentClass="text-violet-600 dark:text-violet-300"
        source="mock"
        sourceDetail={MOCK_WORKFLOW_NOTICE}
        actions={
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => exportMockScopeCsv(mockRows)}
          >
            <Download className="mr-1 h-3.5 w-3.5" /> Demo export
          </Button>
        }
      >
        <p className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-xs text-muted-foreground">
          <DataSourceBadge kind="mock" />
          Hours and unit pricing below are Lovable fixtures. They are not derived from the selected
          project and are excluded from real financial totals.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2 font-medium">Item</th>
                <th className="px-3 py-2 font-medium">Client Name</th>
                <th className="px-3 py-2 font-medium">Client PM Email</th>
                <th className="px-3 py-2 font-medium">Date Needed</th>
                <th className="px-3 py-2 font-medium text-right">Hours</th>
                <th className="px-3 py-2 font-medium text-right">Unit Pricing</th>
              </tr>
            </thead>
            <tbody>
              {mockRows.map((r, i) => (
                <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="px-4 py-2 font-medium">{r.item}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.client}</td>
                  <td className="px-3 py-2 font-mono text-xs text-sky-600 dark:text-sky-400">
                    {r.email}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                    {r.dateNeeded}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{r.hours || "—"}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    {r.price ? formatUsd(r.price) : "$0"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-muted/40 font-semibold">
                <td className="px-4 py-3" colSpan={4}>
                  Demo sum — not real project totals
                </td>
                <td className="px-3 py-3 text-right font-mono">{totals.hours}</td>
                <td className="px-3 py-3 text-right font-mono">{formatUsd(totals.dollars)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </SectionShell>
    </div>
  );
}
