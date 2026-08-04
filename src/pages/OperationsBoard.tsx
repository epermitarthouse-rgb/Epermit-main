import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  Banknote,
  CheckCircle2,
  Clock,
  Download,
  FileQuestion,
  Filter,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Sun,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DataSourceBadge } from "@/components/operations/DataSourceBadge";
import { OperationsReimbursablesPanel } from "@/components/operations/OperationsReimbursablesPanel";
import { OperationsScopePanel } from "@/components/operations/OperationsScopePanel";
import { OperationsWorkflowPanel } from "@/components/operations/OperationsWorkflowPanel";
import { DemoDataBadge } from "@/components/permitpilot/DemoDataBadge";
import { useResolvedProjectId } from "@/hooks/useResolvedProjectId";
import {
  allMockReimbursables,
  filterMockReimbursables,
  filterMockScopeLines,
  filterMockWorkflowGroups,
  mockCriticalPathTaskCount,
  mockReimbursableTotals,
  mockScopeLines,
  mockScopeTotals,
  mockWorkflowGroups,
} from "@/lib/operations/operations-demo-data";
import { exportRealReimbursablesCsv } from "@/lib/operations/operations-csv";
import { formatUsd } from "@/lib/operations/operations-format";
import {
  filterRealRows,
  loadOperationsRealBundle,
} from "@/lib/operations/operations-real-data";
import type {
  DataSourceKind,
  OperationsRealBundle,
  OperationsTab,
} from "@/lib/operations/operations-types";

function UpcomingControl({
  label,
  icon,
  variant = "outline",
}: {
  label: string;
  icon: ReactNode;
  variant?: "outline" | "primary";
}) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            disabled
            className={
              variant === "primary"
                ? "inline-flex cursor-not-allowed items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground opacity-60"
                : "inline-flex cursor-not-allowed items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm opacity-60"
            }
          >
            {icon} {label}
            <DataSourceBadge kind="upcoming" className="ml-1" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">
          Upcoming — visible for IA parity. Not operational; does not write to PermitPilot backends.
          Financial AI reconcile is not wired to /matrix/ai-workflow.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function KpiCard({
  icon,
  label,
  value,
  sub,
  source,
  sourceDetail,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub: string;
  source: DataSourceKind;
  sourceDetail?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          {icon} {label}
        </div>
        <DataSourceBadge kind={source} detail={sourceDetail} />
      </div>
      <div className="mt-1 font-mono text-2xl">{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

export default function OperationsBoard() {
  const navigate = useNavigate();
  const { projectId } = useResolvedProjectId();
  const [tab, setTab] = useState<OperationsTab>("reimbursables");
  const [realQuery, setRealQuery] = useState("");
  const [mockQuery, setMockQuery] = useState("");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(mockWorkflowGroups.map((g) => [g.name, true])),
  );
  const [bundle, setBundle] = useState<OperationsRealBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reload real sections + reset local filters/tab UI when project changes
  useEffect(() => {
    setRealQuery("");
    setMockQuery("");
    setTab("reimbursables");
    setOpenGroups(Object.fromEntries(mockWorkflowGroups.map((g) => [g.name, true])));
    setBundle(null);
    setError(null);

    if (!projectId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    void loadOperationsRealBundle(projectId).then((result) => {
      if (cancelled) return;
      if (result.error) {
        setError(result.error);
        setBundle(null);
      } else {
        setBundle(result.bundle);
        setError(null);
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const filteredSummary = useMemo(
    () => filterRealRows(bundle?.summaryRows ?? [], realQuery),
    [bundle?.summaryRows, realQuery],
  );
  const filteredUtility = useMemo(
    () => filterRealRows(bundle?.utilityCostRows ?? [], realQuery),
    [bundle?.utilityCostRows, realQuery],
  );

  const filteredMockReimbursables = useMemo(
    () => filterMockReimbursables(allMockReimbursables, mockQuery),
    [mockQuery],
  );
  const filteredMockScope = useMemo(
    () => filterMockScopeLines(mockScopeLines, mockQuery),
    [mockQuery],
  );
  const filteredMockWorkflow = useMemo(
    () => filterMockWorkflowGroups(mockWorkflowGroups, mockQuery),
    [mockQuery],
  );

  const mockTotals = mockReimbursableTotals(allMockReimbursables);
  const scopeTotals = mockScopeTotals(mockScopeLines);
  const cpCount = mockCriticalPathTaskCount();

  const searchPlaceholder =
    tab === "reimbursables"
      ? "Search real or demo items…"
      : tab === "scope"
        ? "Search demo scope…"
        : "Search demo workflow…";

  const onSearchChange = (value: string) => {
    // Real search only affects real sections; mock search only mock sections.
    // Both inputs share the chrome field but write to separate state by tab.
    if (tab === "reimbursables") {
      setRealQuery(value);
      setMockQuery(value);
    } else {
      setMockQuery(value);
    }
  };

  const searchValue = tab === "reimbursables" ? realQuery : mockQuery;

  const handleExportCsv = () => {
    if (!projectId || !bundle) return;
    if (tab === "reimbursables") {
      const rows = [...filteredSummary, ...filteredUtility];
      if (rows.length === 0) return;
      exportRealReimbursablesCsv(rows, `operations-real-${projectId.slice(0, 8)}.csv`);
      return;
    }
    // Scope / workflow: use in-panel Demo export only (no mixed real CSV).
  };

  if (!projectId) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <div className="mx-auto max-w-[1600px] px-6 py-10">
          <div className="mb-4 flex items-center gap-2">
            <DemoDataBadge detail="Operations Board mixes partial live project finance with illustrative Lovable fixtures. Mock rows are not persisted." />
          </div>
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 px-4 py-16">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted/50">
              <FileQuestion className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-lg font-medium text-foreground">No project selected</p>
            <p className="mt-1 max-w-sm text-center text-sm text-muted-foreground">
              Select a project from the sidebar to load live/partial finance fields for Operations
              Board.
            </p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => navigate("/dashboard")}>
              Go to Dashboard
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="border-b border-border bg-gradient-to-b from-muted/40 to-background">
        <div className="mx-auto max-w-[1600px] px-6 py-6">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <DemoDataBadge detail="Some project/finance fields are live or partial; Scope line table and PM Workflow are illustrative mock fixtures. Mock data is not persisted and is never included in real totals or real CSV exports." />
          </div>

          <div className="rounded-lg border border-border/80 bg-card/60 px-4 py-3 text-sm text-muted-foreground">
            Some project and finance fields are live or partial for the selected project. Reimbursable
            line ledgers, full scope pricing lines, and PM workflow remain illustrative. Mock data is
            not persisted, not written to Supabase/QuickBooks/UCI, and never merged into real totals
            or real CSV exports.
          </div>

          <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                Operations Board · Monday.com replacement
              </p>
              {loading ? (
                <div className="mt-2 flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" /> Loading project…
                </div>
              ) : error ? (
                <div className="mt-2">
                  <h1 className="font-serif text-2xl leading-tight text-destructive">
                    Unable to load project
                  </h1>
                  <p className="mt-1 text-sm text-muted-foreground">{error}</p>
                </div>
              ) : (
                <>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <h1 className="font-serif text-3xl leading-tight">
                      {bundle?.header.name ?? "Project"}
                      {bundle?.header.permitNumber
                        ? ` · ${bundle.header.permitNumber}`
                        : ""}
                    </h1>
                    <DataSourceBadge
                      kind="partial"
                      detail="Header fields from the selected projects row (RLS / has_project_access)."
                    />
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {[
                      bundle?.header.addressLine,
                      bundle?.header.jurisdiction,
                      bundle?.header.clientName,
                      bundle?.header.clientEmail,
                      bundle?.header.serviceType,
                      bundle?.header.contractValue != null
                        ? `Contract ${formatUsd(bundle.header.contractValue)}`
                        : null,
                      bundle?.header.reimbursementAmount != null
                        ? `Reimbursement ${formatUsd(bundle.header.reimbursementAmount)}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Daily permitting, reimbursables, scope pricing and workflow."}
                  </p>
                  {bundle?.header.reimbursementDescription ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Reimbursement: {bundle.header.reimbursementDescription}
                    </p>
                  ) : null}
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <UpcomingControl label="Filter" icon={<Filter className="h-3.5 w-3.5" />} />
              <UpcomingControl label="Person" icon={<Users className="h-3.5 w-3.5" />} />
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={handleExportCsv}
                      disabled={
                        tab !== "reimbursables" ||
                        !bundle ||
                        filteredSummary.length + filteredUtility.length === 0
                      }
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Download className="h-3.5 w-3.5" /> Export CSV
                      <DataSourceBadge kind="partial" className="ml-1" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">
                    Exports real/partial reimbursable summary + utility coordination costs only. Use
                    in-panel Demo export for mock tables. Disabled on Scope/Workflow (demo-only
                    exports live in those panels).
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <UpcomingControl
                label="Auto-reconcile with AI"
                icon={<Sparkles className="h-3.5 w-3.5" />}
                variant="primary"
              />
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiCard
              icon={<Banknote className="h-4 w-4" />}
              label="Reimbursables tracked"
              value={String(bundle?.realTrackedCount ?? 0)}
              sub={`${formatUsd(bundle?.realTrackedAmount ?? 0)} real/partial summed`}
              source="partial"
              sourceDetail="Count of project finance scalars + UCI coordination_costs for the selected project. Mock Langston/Rockville rows are excluded."
            />
            <KpiCard
              icon={<CheckCircle2 className="h-4 w-4" />}
              label="Invoiced line items"
              value={String(bundle?.realInvoiceRefCount ?? 0)}
              sub="QB milestone + UCI invoice refs (not reimbursable ledger)"
              source="partial"
              sourceDetail="Counts non-null qb_invoice_id_m1–m3 and coordination_costs.quickbooks_invoice_id. Not Monday reimbursable invoice rows."
            />
            <KpiCard
              icon={<Clock className="h-4 w-4" />}
              label="Scope hours"
              value={scopeTotals.hours.toLocaleString()}
              sub={`${formatUsd(scopeTotals.dollars)} demo sum`}
              source="mock"
              sourceDetail="Lovable fixture scope hours only. No project_scope_lines table exists."
            />
            <KpiCard
              icon={<Sun className="h-4 w-4" />}
              label="Critical-path tasks"
              value={String(cpCount)}
              sub="Illustrative status — not live"
              source="mock"
              sourceDetail="Lovable PM workflow fixtures. Not mapped from filings, comments, scrape jobs, agents, or UCI milestones."
            />
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-1 border-b border-border">
            {(
              [
                { id: "reimbursables" as const, label: "Reimbursables" },
                { id: "scope" as const, label: "Scope & Pricing" },
                { id: "workflow" as const, label: "PM Workflow" },
              ] as { id: OperationsTab; label: string }[]
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`-mb-px border-b-2 px-4 py-2 text-sm transition-colors ${
                  tab === t.id
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2 pb-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={searchValue}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="w-56 rounded-md border border-border bg-card py-1.5 pl-7 pr-3 text-sm outline-none focus:border-primary"
                />
              </div>
              <UpcomingControl label="New item" icon={<Plus className="h-3.5 w-3.5" />} />
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1600px] px-6 py-6">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : error || !bundle ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-12 text-center">
            <p className="text-lg font-medium">Could not load operations data</p>
            <p className="mt-1 text-sm text-muted-foreground">{error ?? "Unknown error"}</p>
          </div>
        ) : (
          <>
            {tab === "reimbursables" && (
              <OperationsReimbursablesPanel
                bundle={bundle}
                filteredSummary={filteredSummary}
                filteredUtility={filteredUtility}
                mockRows={filteredMockReimbursables}
                projectId={projectId}
              />
            )}
            {tab === "scope" && (
              <OperationsScopePanel header={bundle.header} mockRows={filteredMockScope} />
            )}
            {tab === "workflow" && (
              <OperationsWorkflowPanel
                groups={filteredMockWorkflow}
                openGroups={openGroups}
                onToggleGroup={(g) =>
                  setOpenGroups((prev) => ({ ...prev, [g]: !(prev[g] !== false) }))
                }
              />
            )}
            {/* Keep mock KPI reference available for verification that totals stay separate */}
            <p className="sr-only">
              Mock reimbursable count {mockTotals.count} sum {mockTotals.sum} excluded from real KPI{" "}
              {bundle.realTrackedCount}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
