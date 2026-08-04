import { Fragment, useMemo } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataSourceBadge } from "@/components/operations/DataSourceBadge";
import { invoiceStyles, ProgressBar, SectionShell } from "@/components/operations/OperationsShared";
import { exportMockReimbursablesCsv, exportRealReimbursablesCsv } from "@/lib/operations/operations-csv";
import { mockReimbursableTotals } from "@/lib/operations/operations-demo-data";
import { formatUsd } from "@/lib/operations/operations-format";
import type {
  MockReimbursable,
  OperationsRealBundle,
  RealQbMilestone,
  RealReimbursableSummaryRow,
} from "@/lib/operations/operations-types";
import { MOCK_WORKFLOW_NOTICE } from "@/lib/operations/operations-types";

function RealSummaryTable({ rows }: { rows: RealReimbursableSummaryRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-muted-foreground">
        No project reimbursement, permit fee, or expeditor cost values set for this project.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-2 font-medium">Item</th>
            <th className="px-3 py-2 font-medium">Description</th>
            <th className="px-3 py-2 font-medium">Permit No.</th>
            <th className="px-3 py-2 font-medium text-right">Amount</th>
            <th className="px-3 py-2 font-medium">Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border/50 hover:bg-muted/30">
              <td className="px-4 py-2 font-medium">{r.label}</td>
              <td className="px-3 py-2 text-muted-foreground">{r.description || "—"}</td>
              <td className="px-3 py-2 font-mono text-xs">{r.permitNumber || "—"}</td>
              <td className="px-3 py-2 text-right font-mono">{formatUsd(r.amount)}</td>
              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{r.sourceTable}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-muted/40 font-semibold">
            <td className="px-4 py-3" colSpan={3}>
              Real sum (project scalars only)
            </td>
            <td className="px-3 py-3 text-right font-mono">
              {formatUsd(rows.reduce((a, r) => a + (r.amount ?? 0), 0))}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function UtilityCostsTable({ rows }: { rows: RealReimbursableSummaryRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-muted-foreground">
        No utility coordination costs for this project. These are UCI cost lines only — not general
        permit reimbursables.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-2 font-medium">Cost type</th>
            <th className="px-3 py-2 font-medium">Notes</th>
            <th className="px-3 py-2 font-medium text-right">Amount</th>
            <th className="px-3 py-2 font-medium">QB invoice</th>
            <th className="px-3 py-2 font-medium">Paid</th>
            <th className="px-3 py-2 font-medium">Client billed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border/50 hover:bg-muted/30">
              <td className="px-4 py-2 font-medium">{r.label}</td>
              <td className="px-3 py-2 text-muted-foreground">{r.description || "—"}</td>
              <td className="px-3 py-2 text-right font-mono">{formatUsd(r.amount)}</td>
              <td className="px-3 py-2 font-mono text-xs">{r.invoiceRef || "—"}</td>
              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                {r.paidAt ? new Date(r.paidAt).toLocaleDateString() : "—"}
              </td>
              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                {r.billedAt ? new Date(r.billedAt).toLocaleDateString() : "—"}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-muted/40 font-semibold">
            <td className="px-4 py-3" colSpan={2}>
              Utility coordination sum
            </td>
            <td className="px-3 py-3 text-right font-mono">
              {formatUsd(rows.reduce((a, r) => a + (r.amount ?? 0), 0))}
            </td>
            <td colSpan={3} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function QbMilestonesStrip({ milestones }: { milestones: RealQbMilestone[] }) {
  return (
    <div className="flex flex-wrap gap-2 px-4 py-3">
      {milestones.map((m) => (
        <div
          key={m.key}
          className="rounded-md border border-border bg-muted/30 px-3 py-1.5 text-xs"
        >
          <span className="font-semibold">{m.label}</span>
          <span className="ml-2 text-muted-foreground">
            {m.invoiceId
              ? `Invoice ${m.invoiceId}`
              : m.triggered
                ? "Triggered (no invoice id)"
                : "Not triggered"}
          </span>
        </div>
      ))}
      <p className="w-full text-[11px] text-muted-foreground">
        QB milestones are contract invoice triggers — not reimbursable line-item invoices.
      </p>
    </div>
  );
}

function MockReimbursablesTable({
  rows,
  totals,
}: {
  rows: MockReimbursable[];
  totals: { sum: number; invoiced: number; paidByGc: number; count: number };
}) {
  const grouped = useMemo(() => {
    const g = new Map<string, MockReimbursable[]>();
    rows.forEach((r) => {
      const arr = g.get(r.project) ?? [];
      arr.push(r);
      g.set(r.project, arr);
    });
    return Array.from(g.entries());
  }, [rows]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-2 font-medium">Item</th>
            <th className="px-3 py-2 font-medium">Date Logged</th>
            <th className="px-3 py-2 font-medium">Project</th>
            <th className="px-3 py-2 font-medium">Permit No.</th>
            <th className="px-3 py-2 font-medium">Description</th>
            <th className="px-3 py-2 font-medium text-right">Amount</th>
            <th className="px-3 py-2 font-medium">Team</th>
            <th className="px-3 py-2 font-medium">Invoiced</th>
            <th className="px-3 py-2 font-medium">Invoice #</th>
            <th className="px-3 py-2 font-medium">Payment</th>
            <th className="px-3 py-2 font-medium w-32">Progress</th>
          </tr>
        </thead>
        <tbody>
          {grouped.map(([project, list]) => (
            <Fragment key={project}>
              <tr className="bg-muted/20">
                <td
                  colSpan={11}
                  className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400"
                >
                  ↳ {project} · {list.length} items ·{" "}
                  {formatUsd(list.reduce((a, r) => a + r.amount, 0))}
                </td>
              </tr>
              {list.map((r, i) => (
                <tr key={`${project}-${i}`} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="px-4 py-2 font-medium">{r.item}</td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{r.logged}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.project}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.permitNo}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.description}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    {r.amount ? formatUsd(r.amount) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/20 text-[10px] font-semibold text-primary">
                      {r.team}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] ${invoiceStyles[r.invoiced]}`}
                    >
                      {r.invoiced}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.invoice}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] ${
                        r.payment === "Done"
                          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                          : r.payment === "Paid by GC"
                            ? "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30"
                            : "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30"
                      }`}
                    >
                      {r.payment}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <ProgressBar value={r.progress} />
                  </td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-muted/40 font-semibold">
            <td className="px-4 py-3" colSpan={5}>
              Demo sum ({totals.count} items) — not included in real totals
            </td>
            <td className="px-3 py-3 text-right font-mono">{formatUsd(totals.sum)}</td>
            <td colSpan={5} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function OperationsReimbursablesPanel({
  bundle,
  filteredSummary,
  filteredUtility,
  mockRows,
  projectId,
}: {
  bundle: OperationsRealBundle;
  filteredSummary: RealReimbursableSummaryRow[];
  filteredUtility: RealReimbursableSummaryRow[];
  mockRows: MockReimbursable[];
  projectId: string;
}) {
  const mockTotals = mockReimbursableTotals(mockRows);
  const realExportRows = [...filteredSummary, ...filteredUtility];

  return (
    <div className="space-y-6">
      <SectionShell
        title={`Project finance summary · ${filteredSummary.length} rows · ${formatUsd(
          filteredSummary.reduce((a, r) => a + (r.amount ?? 0), 0),
        )}`}
        accentClass="text-emerald-600 dark:text-emerald-400"
        source="partial"
        sourceDetail="Project reimbursement / permit fee / expeditor cost scalars from projects. Not a reimbursable line ledger."
        actions={
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={realExportRows.length === 0}
            onClick={() =>
              exportRealReimbursablesCsv(
                realExportRows,
                `operations-real-${projectId.slice(0, 8)}.csv`,
              )
            }
          >
            <Download className="mr-1 h-3.5 w-3.5" /> Export real CSV
          </Button>
        }
      >
        <RealSummaryTable rows={filteredSummary} />
        <div className="border-t border-border">
          <div className="flex items-center gap-2 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            QuickBooks milestones <DataSourceBadge kind="partial" />
          </div>
          <QbMilestonesStrip milestones={bundle.header.qbMilestones} />
        </div>
      </SectionShell>

      <SectionShell
        title={`Utility Coordination Costs · ${filteredUtility.length} items · ${formatUsd(
          filteredUtility.reduce((a, r) => a + (r.amount ?? 0), 0),
        )}`}
        accentClass="text-sky-600 dark:text-sky-400"
        source="partial"
        sourceDetail="UCI coordination_costs for the selected project only. Not general permit reimbursables."
      >
        <UtilityCostsTable rows={filteredUtility} />
      </SectionShell>

      <SectionShell
        title={`Illustrative reimbursables · ${mockTotals.count} items · ${formatUsd(mockTotals.sum)}`}
        accentClass="text-violet-600 dark:text-violet-300"
        source="mock"
        sourceDetail={MOCK_WORKFLOW_NOTICE}
        actions={
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => exportMockReimbursablesCsv(mockRows)}
          >
            <Download className="mr-1 h-3.5 w-3.5" /> Demo export
          </Button>
        }
      >
        <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
          Fixture projects Langston Blvd / Rockville Pike — illustrative only. Does not inherit the
          selected project. Edits are not persisted and amounts are excluded from real totals/CSV.
        </p>
        <MockReimbursablesTable rows={mockRows} totals={mockTotals} />
      </SectionShell>
    </div>
  );
}
