import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownUp,
  Filter,
  ListChecks,
  RotateCcw,
  Search,
} from "lucide-react";

import trackerRaw from "@/data/uciActionTracker.json";
import type { UciActionTrackerPayload, UciTrackerStatus } from "@/types/uciActionTracker";
import { UCI_TRACKER_STATUSES } from "@/types/uciActionTracker";
import { useUciActionTrackerOverlay } from "@/hooks/useUciActionTrackerOverlay";
import {
  assertTrackerPayload,
  bucketItems,
  completionRatio,
  countByStatus,
  defaultUciTrackerFilters,
  matchesUciTrackerFilters,
  mergeUciActionItem,
  pilotItems,
  sortBySequence,
  statusBadgeClass,
  type MergedUciActionItem,
  type UciTrackerFilters,
} from "@/lib/uciActionTracker";
import { UciActionTrackerDetailSheet } from "./UciActionTrackerDetailSheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
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
import { cn } from "@/lib/utils";

const payload = trackerRaw as UciActionTrackerPayload;

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5 shadow-sm">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-display text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function PhaseProgress({
  label,
  items,
  capabilityPct,
}: {
  label: string;
  items: MergedUciActionItem[];
  capabilityPct?: number;
}) {
  const ratio = completionRatio(items);
  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">
          {ratio.complete}/{ratio.total} Complete ({ratio.pct}%)
        </div>
      </div>
      {capabilityPct != null && (
        <div className="mt-1 text-xs text-muted-foreground">
          Audit-based capability estimate: ~{capabilityPct}%
        </div>
      )}
    </div>
  );
}

export function UciActionTrackerWorkspace() {
  const { items: overlays, lastUpdatedAt, upsert, clearSequence, clearAll } =
    useUciActionTrackerOverlay();
  const [filters, setFilters] = useState<UciTrackerFilters>(defaultUciTrackerFilters);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [activeSequence, setActiveSequence] = useState<number | null>(null);

  const integrity = useMemo(() => assertTrackerPayload(payload), []);

  const allMerged = useMemo(
    () =>
      payload.items.map((item) => mergeUciActionItem(item, overlays[String(item.sequence)])),
    [overlays],
  );

  const statusCounts = useMemo(() => countByStatus(allMerged), [allMerged]);
  const pilot = useMemo(() => pilotItems(allMerged), [allMerged]);

  const phaseOptions = useMemo(
    () => Array.from(new Set(payload.items.map((i) => i.phaseWeek))),
    [],
  );
  const agentOptions = useMemo(() => {
    const agents = payload.items.map((i) => i.agent ?? "None");
    return Array.from(new Set(agents)).sort();
  }, []);

  const filtered = useMemo(() => {
    const matched = allMerged.filter((item) => matchesUciTrackerFilters(item, filters));
    return sortBySequence(matched, sortDir);
  }, [allMerged, filters, sortDir]);

  const activeItem =
    activeSequence == null
      ? null
      : (allMerged.find((i) => i.sequence === activeSequence) ?? null);

  const est = payload.capabilityEstimates;

  return (
    <div className="space-y-6">
      {!integrity.ok && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            Tracker data integrity issues: {integrity.errors.join("; ")}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-950">
        Internal development tracker only. Statuses reconciled from the 42-row spreadsheet
        against the {payload.lastAuditedAt} baseline audit and current code — not client-facing.
        Source hierarchy: {payload.sourceHierarchy.join(" → ")}.
      </div>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
          <ListChecks className="h-5 w-5" />
          Status summary
        </h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
          <MetricCard label="Total" value={allMerged.length} />
          {UCI_TRACKER_STATUSES.map((status) => (
            <MetricCard key={status} label={status} value={statusCounts[status]} />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold">Progress by scope</h2>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          <PhaseProgress
            label="Pilot scope only (excl. deferred)"
            items={pilot}
            capabilityPct={est.pilotOverallPct}
          />
          <PhaseProgress
            label="Foundation"
            items={bucketItems(allMerged, "foundation")}
            capabilityPct={est.foundationPct}
          />
          <PhaseProgress
            label="Phase 1"
            items={bucketItems(allMerged, "phase1")}
            capabilityPct={est.phase1Pct}
          />
          <PhaseProgress
            label="Phase 2"
            items={bucketItems(allMerged, "phase2")}
            capabilityPct={est.phase2Pct}
          />
          <PhaseProgress
            label="Phase 3"
            items={bucketItems(allMerged, "phase3")}
            capabilityPct={est.phase3Pct}
          />
          <PhaseProgress
            label="Production gates"
            items={bucketItems(allMerged, "production_gate")}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Row Complete counts are simple checklist tallies.{" "}
          <span className="font-medium">{est.label}</span> values (~{est.lifecyclePct}% full
          10-stage lifecycle) are from the baseline audit and are{" "}
          <span className="font-medium">not</span> derived from badge math.
        </p>
      </section>

      <section className="rounded-lg border bg-card p-4 shadow-sm">
        <h2 className="font-display text-lg font-semibold">Current Critical Path</h2>
        <dl className="mt-3 grid gap-3 text-sm md:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Furthest reliably completed lifecycle stage
            </dt>
            <dd className="mt-1 font-medium">{payload.criticalPath.furthestCompletedStage}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Current major gate
            </dt>
            <dd className="mt-1 font-medium text-orange-800">
              {payload.criticalPath.majorGate}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Also flag
            </dt>
            <dd className="mt-1">
              <ul className="list-disc space-y-1 pl-5">
                {payload.criticalPath.additionalFlags.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Extend rather than rebuild
            </dt>
            <dd className="mt-1">{payload.criticalPath.extendRatherThanRebuild}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          Critical path text is data-driven from `src/data/uciActionTracker.json` (editable without
          UI hardcoding).
        </p>
      </section>

      <section className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <h2 className="font-display text-lg font-semibold">
            Action items{" "}
            <span className="text-sm font-normal text-muted-foreground">
              ({filtered.length} shown)
            </span>
          </h2>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            >
              <ArrowDownUp className="mr-1.5 h-3.5 w-3.5" />
              Sequence {sortDir === "asc" ? "↑" : "↓"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFilters(defaultUciTrackerFilters)}
            >
              <Filter className="mr-1.5 h-3.5 w-3.5" />
              Clear filters
            </Button>
            <Button variant="ghost" size="sm" onClick={() => clearAll()}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Reset all overlays
            </Button>
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-6">
          <div className="relative xl:col-span-2">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search action items…"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            />
          </div>
          <Select
            value={filters.status}
            onValueChange={(v) =>
              setFilters((f) => ({ ...f, status: v as UciTrackerStatus | "all" }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {UCI_TRACKER_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.phaseWeek}
            onValueChange={(v) => setFilters((f) => ({ ...f, phaseWeek: v }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Phase" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All phases</SelectItem>
              {phaseOptions.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.scope}
            onValueChange={(v) =>
              setFilters((f) => ({ ...f, scope: v as UciTrackerFilters["scope"] }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Scope" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Pilot + deferred</SelectItem>
              <SelectItem value="pilot">Pilot only</SelectItem>
              <SelectItem value="deferred">Deferred only</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={filters.agent}
            onValueChange={(v) => setFilters((f) => ({ ...f, agent: v }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Agent" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All agents</SelectItem>
              {agentOptions.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={filters.criticalOnly}
            onCheckedChange={(checked) =>
              setFilters((f) => ({ ...f, criticalOnly: checked === true }))
            }
          />
          Critical path only
        </label>

        <div className="overflow-auto rounded-lg border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background/95 backdrop-blur">
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead className="min-w-[140px]">Phase</TableHead>
                <TableHead className="min-w-[220px]">Action Item</TableHead>
                <TableHead className="min-w-[160px]">Status</TableHead>
                <TableHead className="w-24">Scope</TableHead>
                <TableHead className="w-20">Critical</TableHead>
                <TableHead className="w-28">Last Verified</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((item) => (
                <TableRow
                  key={item.sequence}
                  className="cursor-pointer"
                  onClick={() => setActiveSequence(item.sequence)}
                  data-testid={`uci-tracker-row-${item.sequence}`}
                >
                  <TableCell className="font-mono text-xs">{item.sequence}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{item.phaseWeek}</TableCell>
                  <TableCell>
                    <div className="text-sm font-medium leading-snug">{item.actionItem}</div>
                    {item.subStatus && (
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {item.subStatus}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn("whitespace-normal text-left", statusBadgeClass(item.effectiveStatus))}
                    >
                      {item.effectiveStatus}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={item.scope === "deferred" ? "secondary" : "outline"}>
                      {item.scope === "pilot" ? "Pilot" : "Deferred"}
                    </Badge>
                  </TableCell>
                  <TableCell>{item.criticalPath ? "Yes" : "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {item.effectiveLastVerified}
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                    No action items match the current filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <p className="text-xs text-muted-foreground">
          Overlay last updated: {lastUpdatedAt && lastUpdatedAt !== new Date(0).toISOString()
            ? new Date(lastUpdatedAt).toLocaleString()
            : "none"}{" "}
          · Persistence: browser localStorage
        </p>
      </section>

      <UciActionTrackerDetailSheet
        item={activeItem}
        open={activeSequence != null}
        onOpenChange={(open) => {
          if (!open) setActiveSequence(null);
        }}
        onSave={upsert}
        onReset={clearSequence}
      />
    </div>
  );
}
