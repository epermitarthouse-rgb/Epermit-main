import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertTriangle,
  Ban,
  Boxes,
  CheckCircle2,
  ClipboardCopy,
  Download,
  ExternalLink,
  Eye,
  Filter,
  Hourglass,
  LayoutList,
  ListChecks,
  Plug,
  ShieldCheck,
  UserCheck,
  X,
} from "lucide-react";

import matrixDataRaw from "@/data/architectureReplicationMatrix.json";
import type { ArchitectureMatrixPayload } from "@/types/architectureReplication";
import { VERIFICATION_STATUSES } from "@/types/architectureReplication";
import {
  SIMPLE_WORK_STATUSES,
  buildImplementationBrief,
  computeCompletionState,
  exportRowsToCsv,
  fromSimpleWorkStatus,
  mergeOverlay,
  resolveRowPageHref,
  toSimpleWorkStatus,
  truncate,
  type SimpleWorkStatus,
} from "@/lib/architectureReplication";
import { useArchitectureReplicationOverlay } from "@/hooks/useArchitectureReplicationOverlay";
import { AlertBanner, StatCard } from "@/components/design/ProductPrimitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import {
  ArchitectureReplicationDetailSheet,
  type MergedRow,
} from "./ArchitectureReplicationDetailSheet";
import {
  ALL,
  CHIP_DEFS,
  countActiveFilters,
  defaultFilters,
  matchesFilters,
  type ChipKey,
  type FilterState,
} from "./filterUtils";
import {
  priorityBadgeVariant,
  riskBadgeVariant,
  simpleWorkStatusBadgeVariant,
  verificationBadgeVariant,
} from "./statusStyles";

const matrix = matrixDataRaw as ArchitectureMatrixPayload;

function distinctSorted<T>(values: T[]): T[] {
  return Array.from(new Set(values)).sort((a, b) => String(a).localeCompare(String(b)));
}

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function ArchitectureReplicationWorkspace() {
  const {
    items,
    commentsByRow,
    mode,
    lastUpdatedAt,
    persistenceEnabled,
    upsertItem,
    addComment,
  } = useArchitectureReplicationOverlay();

  const [tab, setTab] = useState<"checklist" | "testing" | "completed">("checklist");
  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [activeChips, setActiveChips] = useState<Set<ChipKey>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeRowId, setActiveRowId] = useState<string | null>(null);

  const allMerged: MergedRow[] = useMemo(
    () =>
      matrix.rows.map((row) => {
        const overlay = mergeOverlay(row, items[row.rowId]);
        return { row, overlay, completion: computeCompletionState(overlay) };
      }),
    [items],
  );

  const mergedById = useMemo(() => {
    const map: Record<string, MergedRow> = {};
    for (const m of allMerged) map[m.row.rowId] = m;
    return map;
  }, [allMerged]);

  const filterOptions = useMemo(
    () => ({
      area: distinctSorted(matrix.rows.map((r) => r.lovable.area)),
      matchStatus: distinctSorted(matrix.rows.map((r) => r.permitPilot.matchStatus)),
      priority: distinctSorted(matrix.rows.map((r) => r.priority)),
      risk: distinctSorted(matrix.rows.map((r) => r.risk)),
      uiStatus: distinctSorted(matrix.rows.map((r) => r.derived.uiStatus)),
      backendStatus: distinctSorted(matrix.rows.map((r) => r.derived.backendStatus)),
      routeDecision: distinctSorted(matrix.rows.map((r) => r.decisions.routeDecision)),
    }),
    [],
  );

  const filteredRows = useMemo(
    () => allMerged.filter((m) => matchesFilters(m, filters, activeChips, commentsByRow)),
    [allMerged, filters, activeChips, commentsByRow],
  );

  const testingQueueRows = useMemo(
    () =>
      filteredRows.filter(
        (m) =>
          m.overlay.implementation_status === "Implemented" &&
          m.overlay.verification_status !== "E2E checked" &&
          m.overlay.verification_status !== "Client approved" &&
          !m.overlay.is_blocked,
      ),
    [filteredRows],
  );

  const completedRows = useMemo(
    () => filteredRows.filter((m) => m.completion === "Complete"),
    [filteredRows],
  );

  const visibleRows = tab === "checklist" ? filteredRows : tab === "testing" ? testingQueueRows : completedRows;

  const stats = useMemo(() => {
    const isVerified = (m: MergedRow) =>
      m.overlay.verification_status === "E2E checked" || m.overlay.verification_status === "Client approved";
    const isBlocked = (m: MergedRow) => m.overlay.is_blocked || m.overlay.implementation_status === "Blocked";
    return {
      totalLovable: matrix.lovableRowCount,
      totalPPOnly: matrix.permitPilotOnlyRowCount,
      readyForImplementation: allMerged.filter((m) => m.overlay.implementation_status === "Ready for implementation").length,
      inProgress: allMerged.filter((m) => m.overlay.implementation_status === "In progress").length,
      implemented: allMerged.filter((m) => m.overlay.implementation_status === "Implemented").length,
      verified: allMerged.filter(isVerified).length,
      blocked: allMerged.filter(isBlocked).length,
      clientApproved: allMerged.filter((m) => m.overlay.verification_status === "Client approved").length,
      p0: allMerged.filter((m) => m.row.priority === "P0").length,
      p1: allMerged.filter((m) => m.row.priority === "P1").length,
      missing: allMerged.filter((m) => m.row.derived.isMissing).length,
      backendConnected: allMerged.filter((m) => m.row.derived.isBackendConnected).length,
    };
  }, [allMerged]);

  const activeFilterCount = countActiveFilters(filters, activeChips);

  const toggleChip = (key: ChipKey) => {
    setActiveChips((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const clearFilters = () => {
    setFilters(defaultFilters);
    setActiveChips(new Set());
  };

  const toggleSelectAll = (rows: MergedRow[], checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const m of rows) {
        if (checked) next.add(m.row.rowId);
        else next.delete(m.row.rowId);
      }
      return next;
    });
  };

  const toggleSelectRow = (rowId: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(rowId);
      else next.delete(rowId);
      return next;
    });
  };

  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every((m) => selectedIds.has(m.row.rowId));

  const handleSetSimpleStatus = async (rowId: string, status: SimpleWorkStatus) => {
    if (!persistenceEnabled) {
      toast.error("Persistence unavailable — apply the architecture_replication migration first.");
      return;
    }
    const res = await upsertItem(rowId, {
      implementation_status: fromSimpleWorkStatus(status),
    });
    if (res.ok) toast.success(`${rowId} marked ${status}.`);
    else toast.error(res.message || "Failed to update status.");
  };

  const handleCopyBrief = async (m: MergedRow) => {
    try {
      await navigator.clipboard.writeText(buildImplementationBrief(m.row, m.overlay));
      toast.success(`Copied implementation brief for ${m.row.rowId}.`);
    } catch {
      toast.error("Copy failed — clipboard is unavailable.");
    }
  };

  const handleBulkSetStatus = async (status: SimpleWorkStatus) => {
    if (!persistenceEnabled) {
      toast.error("Persistence unavailable — apply the architecture_replication migration first.");
      return;
    }
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    let ok = 0;
    for (const id of ids) {
      const res = await upsertItem(id, {
        implementation_status: fromSimpleWorkStatus(status),
      });
      if (res.ok) ok++;
    }
    toast.success(`Updated ${ok}/${ids.length} row(s) to "${status}".`);
  };

  const handleBulkAssignOwner = async () => {
    if (!persistenceEnabled) {
      toast.error("Persistence unavailable — apply the architecture_replication migration first.");
      return;
    }
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const owner = window.prompt(`Assign owner to ${ids.length} selected row(s):`, "");
    if (owner === null) return;
    const trimmed = owner.trim();
    let ok = 0;
    for (const id of ids) {
      const res = await upsertItem(id, { assigned_owner: trimmed || null });
      if (res.ok) ok++;
    }
    toast.success(`Assigned owner on ${ok}/${ids.length} row(s).`);
  };

  const handleBulkClearBlocker = async () => {
    if (!persistenceEnabled) {
      toast.error("Persistence unavailable — apply the architecture_replication migration first.");
      return;
    }
    const ids = Array.from(selectedIds).filter((id) => mergedById[id]?.overlay.is_blocked);
    if (ids.length === 0) {
      toast.info("No blocked rows in the current selection.");
      return;
    }
    if (!window.confirm(`Clear the blocker on ${ids.length} row(s)?`)) return;
    let ok = 0;
    for (const id of ids) {
      const res = await upsertItem(id, { is_blocked: false, blocker_description: null });
      if (res.ok) ok++;
    }
    toast.success(`Cleared blocker on ${ok}/${ids.length} row(s).`);
  };

  const handleExportFiltered = () => {
    downloadCsv(
      exportRowsToCsv(filteredRows.map((m) => m.row), items),
      `architecture-replication-filtered-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  };

  const handleExportSelected = () => {
    const rows = allMerged.filter((m) => selectedIds.has(m.row.rowId)).map((m) => m.row);
    if (rows.length === 0) {
      toast.info("No rows selected.");
      return;
    }
    downloadCsv(
      exportRowsToCsv(rows, items),
      `architecture-replication-selected-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  };

  const activeMerged = activeRowId ? mergedById[activeRowId] ?? null : null;

  const renderTable = (rows: MergedRow[]) => (
    <div className="overflow-x-auto rounded-lg border border-border/60">
      <Table wrapperClassName="border-0 rounded-none overflow-visible">
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 z-20 bg-muted/90 dark:bg-elevated/70">
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={rows.length > 0 && allVisibleSelected}
                  onCheckedChange={(checked) => toggleSelectAll(rows, checked === true)}
                  aria-label="Select all visible rows"
                />
                <span>Row</span>
              </div>
            </TableHead>
            <TableHead>Kind</TableHead>
            <TableHead>Area</TableHead>
            <TableHead>Priority</TableHead>
            <TableHead>Risk</TableHead>
            <TableHead>Lovable</TableHead>
            <TableHead>PermitPilot</TableHead>
            <TableHead>UI status</TableHead>
            <TableHead>Backend status</TableHead>
            <TableHead>Route decision</TableHead>
            <TableHead>Page</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Verification</TableHead>
            <TableHead>Completion</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={16} className="py-10 text-center text-sm text-muted-foreground">
                No rows match the current filters.
              </TableCell>
            </TableRow>
          )}
          {rows.map((m) => {
            const { row, overlay, completion } = m;
            const isSelected = selectedIds.has(row.rowId);
            const pageHref = resolveRowPageHref(row);
            const simpleStatus = toSimpleWorkStatus(overlay.implementation_status);
            return (
              <TableRow
                key={row.rowId}
                data-state={isSelected ? "selected" : undefined}
                className="cursor-pointer"
                onClick={() => setActiveRowId(row.rowId)}
              >
                <TableCell
                  className={cn(
                    "sticky left-0 z-10 bg-background",
                    isSelected && "bg-muted dark:bg-elevated/80",
                  )}
                >
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={(checked) => toggleSelectRow(row.rowId, checked === true)}
                      aria-label={`Select ${row.rowId}`}
                    />
                    <span className="font-mono text-xs font-semibold">{row.rowId}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={row.rowKind === "lovable" ? "outline" : "secondary"}>
                    {row.rowKind === "lovable" ? "Lovable" : "PP-only"}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs">{row.lovable.area}</TableCell>
                <TableCell>
                  <Badge variant={priorityBadgeVariant(row.priority)}>{row.priority}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={riskBadgeVariant(row.risk)}>{row.risk}</Badge>
                </TableCell>
                <TableCell className="max-w-[220px]">
                  <p className="text-sm font-medium text-foreground">{truncate(row.lovable.name, 40)}</p>
                  <p className="text-xs text-muted-foreground">{truncate(row.lovable.route, 40)}</p>
                </TableCell>
                <TableCell className="max-w-[220px]">
                  <p className="text-sm font-medium text-foreground">{truncate(row.permitPilot.featureName, 40)}</p>
                  <p className="text-xs text-muted-foreground">{truncate(row.permitPilot.matchStatus, 40)}</p>
                </TableCell>
                <TableCell className="max-w-[220px] text-xs text-muted-foreground">
                  {truncate(row.derived.uiStatus, 70)}
                </TableCell>
                <TableCell className="max-w-[180px] text-xs text-muted-foreground">
                  {truncate(row.derived.backendStatus, 50)}
                </TableCell>
                <TableCell className="max-w-[200px] text-xs text-muted-foreground">
                  {truncate(row.decisions.routeDecision, 60)}
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  {pageHref ? (
                    <Link
                      to={pageHref}
                      className="inline-flex max-w-[180px] items-center gap-1 text-xs font-medium text-primary hover:underline"
                      title={`Open ${pageHref}`}
                    >
                      <ExternalLink className="h-3 w-3 shrink-0" />
                      <span className="truncate">{pageHref}</span>
                    </Link>
                  ) : (
                    <span className="text-xs text-muted-foreground">No page</span>
                  )}
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Select
                    value={simpleStatus}
                    onValueChange={(v) => handleSetSimpleStatus(row.rowId, v as SimpleWorkStatus)}
                    disabled={!persistenceEnabled}
                  >
                    <SelectTrigger
                      className="h-8 w-[140px]"
                      aria-label={`Status for ${row.rowId}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SIMPLE_WORK_STATUSES.map((status) => (
                        <SelectItem key={status} value={status}>
                          <span className="flex items-center gap-2">
                            <Badge variant={simpleWorkStatusBadgeVariant(status)} className="pointer-events-none">
                              {status}
                            </Badge>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Badge variant={verificationBadgeVariant(overlay.verification_status)}>
                    {overlay.verification_status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider",
                      completion === "Complete" && "border-success/30 bg-success/10 text-success",
                      completion === "Blocked" && "border-destructive/30 bg-destructive/10 text-destructive",
                      (completion === "Ready for test" || completion === "Testing") &&
                        "border-warning/30 bg-warning/10 text-warning",
                      (completion === "Building" || completion === "Planning") &&
                        "border-[hsl(var(--pilot-cyan)/0.3)] bg-[hsl(var(--pilot-cyan)/0.1)] text-[hsl(var(--pilot-cyan))]",
                      completion === "Not started" && "border-border/60 bg-muted/40 text-muted-foreground",
                    )}
                  >
                    {completion}
                  </span>
                </TableCell>
                <TableCell className="text-xs">{overlay.assigned_owner || "—"}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      title="Open detail"
                      onClick={() => setActiveRowId(row.rowId)}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      title="Copy implementation brief"
                      onClick={() => handleCopyBrief(m)}
                    >
                      <ClipboardCopy className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          Branch: <span className="font-medium text-foreground">{matrix.branch}</span>
        </span>
        <span>
          Matrix generated: <span className="font-medium text-foreground">{new Date(matrix.generatedAt).toLocaleString()}</span>
        </span>
        <span>
          Checklist updated:{" "}
          <span className="font-medium text-foreground">
            {lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleString() : "—"}
          </span>
        </span>
        <span className="flex items-center gap-1">
          <Filter className="h-3 w-3" /> Active filters:{" "}
          <span className="font-medium text-foreground">{activeFilterCount}</span>
        </span>
      </div>

      {mode === "unavailable" && (
        <AlertBanner
          tone="warn"
          title="Checklist persistence not available"
          detail={
            <span>
              The migration <code className="rounded bg-black/10 px-1 py-0.5 font-mono text-xs dark:bg-white/10">
                supabase/migrations/20260725040000_architecture_replication_checklist.sql
              </code>{" "}
              exists but has not been applied yet. Editing is disabled until it runs — the architecture matrix
              remains the source of truth for now.
            </span>
          }
        />
      )}
      {mode === "available" && (
        <p className="flex items-center gap-1.5 text-xs text-success">
          <CheckCircle2 className="h-3.5 w-3.5" /> Checklist edits persist for admins.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        <StatCard label="Total Lovable" value={stats.totalLovable} icon={LayoutList} />
        <StatCard label="Total PP-only" value={stats.totalPPOnly} icon={Boxes} />
        <StatCard label="Ready for implementation" value={stats.readyForImplementation} icon={ListChecks} />
        <StatCard label="In progress" value={stats.inProgress} icon={Hourglass} />
        <StatCard label="Implemented" value={stats.implemented} icon={CheckCircle2} />
        <StatCard label="Verified" value={stats.verified} icon={ShieldCheck} />
        <StatCard label="Blocked" value={stats.blocked} icon={Ban} />
        <StatCard label="Client approved" value={stats.clientApproved} icon={UserCheck} />
        <StatCard label="P0" value={stats.p0} icon={AlertTriangle} />
        <StatCard label="P1" value={stats.p1} icon={AlertTriangle} />
        <StatCard label="Missing" value={stats.missing} icon={X} />
        <StatCard label="Backend connected" value={stats.backendConnected} icon={Plug} />
      </div>

      <div className="pilot-card space-y-3 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            placeholder="Search by row ID, name, route, functionality, files, notes, comments…"
            className="flex-1"
          />
          <Button variant="outline" size="sm" onClick={clearFilters} disabled={activeFilterCount === 0}>
            <X className="h-3.5 w-3.5" /> Clear filters
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Select value={filters.area} onValueChange={(v) => setFilters((f) => ({ ...f, area: v }))}>
            <SelectTrigger><SelectValue placeholder="Area" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All areas</SelectItem>
              {filterOptions.area.map((v) => (
                <SelectItem key={v} value={v}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filters.matchStatus} onValueChange={(v) => setFilters((f) => ({ ...f, matchStatus: v }))}>
            <SelectTrigger><SelectValue placeholder="Match status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All match statuses</SelectItem>
              {filterOptions.matchStatus.map((v) => (
                <SelectItem key={v} value={v}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filters.priority} onValueChange={(v) => setFilters((f) => ({ ...f, priority: v }))}>
            <SelectTrigger><SelectValue placeholder="Priority" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All priorities</SelectItem>
              {filterOptions.priority.map((v) => (
                <SelectItem key={v} value={v}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filters.risk} onValueChange={(v) => setFilters((f) => ({ ...f, risk: v }))}>
            <SelectTrigger><SelectValue placeholder="Risk" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All risk levels</SelectItem>
              {filterOptions.risk.map((v) => (
                <SelectItem key={v} value={v}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filters.routeDecision} onValueChange={(v) => setFilters((f) => ({ ...f, routeDecision: v }))}>
            <SelectTrigger><SelectValue placeholder="Route decision" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All route decisions</SelectItem>
              {filterOptions.routeDecision.map((v) => (
                <SelectItem key={v} value={v}>{truncate(v, 60)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filters.uiStatus} onValueChange={(v) => setFilters((f) => ({ ...f, uiStatus: v }))}>
            <SelectTrigger><SelectValue placeholder="UI status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All UI statuses</SelectItem>
              {filterOptions.uiStatus.map((v) => (
                <SelectItem key={v} value={v}>{truncate(v, 60)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filters.backendStatus} onValueChange={(v) => setFilters((f) => ({ ...f, backendStatus: v }))}>
            <SelectTrigger><SelectValue placeholder="Backend status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All backend statuses</SelectItem>
              {filterOptions.backendStatus.map((v) => (
                <SelectItem key={v} value={v}>{truncate(v, 60)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.implementationStatus}
            onValueChange={(v) => setFilters((f) => ({ ...f, implementationStatus: v }))}
          >
            <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {SIMPLE_WORK_STATUSES.map((v) => (
                <SelectItem key={v} value={v}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.verificationStatus}
            onValueChange={(v) => setFilters((f) => ({ ...f, verificationStatus: v }))}
          >
            <SelectTrigger><SelectValue placeholder="Verification status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All verification statuses</SelectItem>
              {VERIFICATION_STATUSES.map((v) => (
                <SelectItem key={v} value={v}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-border/50 pt-3">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Checkbox
              checked={filters.blockedOnly}
              onCheckedChange={(c) => setFilters((f) => ({ ...f, blockedOnly: c === true }))}
            />
            Blocked only
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Checkbox
              checked={filters.hasComments}
              onCheckedChange={(c) => setFilters((f) => ({ ...f, hasComments: c === true }))}
            />
            Has comments
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Checkbox
              checked={filters.hasPreserve}
              onCheckedChange={(c) => setFilters((f) => ({ ...f, hasPreserve: c === true }))}
            />
            Has preserve notes
          </label>
          <div className="ml-auto flex items-center gap-1 rounded-md border border-border/60 p-0.5">
            {(["all", "lovable", "permitpilot_only"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilters((f) => ({ ...f, rowKind: k }))}
                className={cn(
                  "rounded px-2 py-1 text-xs font-medium transition-colors",
                  filters.rowKind === k
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {k === "all" ? "All" : k === "lovable" ? "Lovable" : "PP-only"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {CHIP_DEFS.map((chip) => {
            const active = activeChips.has(chip.key);
            return (
              <button
                key={chip.key}
                type="button"
                onClick={() => toggleChip(chip.key)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  active
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border/60 text-muted-foreground hover:bg-muted/60",
                )}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
          <span className="text-sm font-medium text-foreground">{selectedIds.size} selected</span>
          <Button size="sm" variant="outline" onClick={handleExportSelected}>
            <Download className="h-3.5 w-3.5" /> Export selected CSV
          </Button>
          {persistenceEnabled && (
            <>
              <Button size="sm" variant="outline" onClick={() => handleBulkSetStatus("Pending")}>
                Mark Pending
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleBulkSetStatus("In Progress")}>
                Mark In Progress
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleBulkSetStatus("Completed")}>
                Mark Completed
              </Button>
              <Button size="sm" variant="outline" onClick={handleBulkAssignOwner}>
                Assign owner
              </Button>
              <Button size="sm" variant="outline" onClick={handleBulkClearBlocker}>
                Clear blocker
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => setSelectedIds(new Set())}
          >
            Clear selection
          </Button>
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="checklist">Checklist ({filteredRows.length})</TabsTrigger>
            <TabsTrigger value="testing">Testing Queue ({testingQueueRows.length})</TabsTrigger>
            <TabsTrigger value="completed">Completed ({completedRows.length})</TabsTrigger>
          </TabsList>
          <Button size="sm" variant="outline" onClick={handleExportFiltered}>
            <Download className="h-3.5 w-3.5" /> Export filtered CSV
          </Button>
        </div>
        <TabsContent value="checklist" className="mt-3">
          {renderTable(filteredRows)}
        </TabsContent>
        <TabsContent value="testing" className="mt-3">
          {renderTable(testingQueueRows)}
        </TabsContent>
        <TabsContent value="completed" className="mt-3">
          {renderTable(completedRows)}
        </TabsContent>
      </Tabs>

      <ArchitectureReplicationDetailSheet
        merged={activeMerged}
        comments={activeRowId ? commentsByRow[activeRowId] ?? [] : []}
        open={activeRowId !== null}
        onOpenChange={(open) => {
          if (!open) setActiveRowId(null);
        }}
        persistenceEnabled={persistenceEnabled}
        onUpsert={upsertItem}
        onAddComment={addComment}
      />
    </div>
  );
}
