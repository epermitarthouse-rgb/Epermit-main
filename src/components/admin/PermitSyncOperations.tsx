import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { AlertBanner, Panel, StatusPill, type StatusTone } from "@/components/design/ProductPrimitives";
import { formatTimestamp } from "@/components/permits/PermitRepositoryViews";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { listSyncAlerts, loadSchedulerStatus, setPermitSyncSchedule, type SchedulerStatus } from "@/lib/centralPermits";
import { describeSchedule, type SyncSchedule, type SyncSourceOverview } from "@/lib/permitSync";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MIB = 1024 * 1024;

export const OPS_QUERY_KEY = ["permit-sync", "ops"] as const;

/** Worker liveness is judged from the heartbeat age (the worker beats every 30 s by default). */
export function workerHealth(w: SchedulerStatus["workers"][number], now = Date.now()): { tone: StatusTone; label: string } {
  const age = now - new Date(w.last_seen_at).getTime();
  if (w.status === "stopped") return { tone: "default", label: "Stopped" };
  if (age > 5 * 60 * 1000) return { tone: "bad", label: "Offline" };
  if (age > 2 * 60 * 1000) return { tone: "warn", label: "Late heartbeat" };
  return { tone: w.status === "busy" ? "info" : "good", label: w.status === "busy" ? "Working" : w.status === "idle" ? "Idle" : w.status };
}

export function useSchedulerStatus() {
  return useQuery({ queryKey: [...OPS_QUERY_KEY, "scheduler"], queryFn: loadSchedulerStatus, refetchInterval: 30000 });
}

export function SchedulerNotice({ status }: { status?: SchedulerStatus }) {
  if (!status) return null;
  const enqueue = status.cron_jobs.find((j) => j.name === "permit-sync-enqueue");
  const monitor = status.cron_jobs.find((j) => j.name === "permit-sync-monitor");
  return (
    <div className="space-y-2">
      {!enqueue?.active ? (
        <AlertBanner
          tone="default"
          title="Scheduled refreshes are not running"
          detail="The scheduler (pg_cron job permit-sync-enqueue) is not installed, so enabled schedules do not start any refresh. It is turned on separately, after the first full refresh has been verified."
        />
      ) : null}
      {!monitor?.active ? (
        <AlertBanner tone="warn" title="Sync monitor is not running" detail="Alerts for offline workers, stuck jobs and repeated failures are only raised once the permit-sync-monitor job is installed." />
      ) : null}
    </div>
  );
}

function ScheduleRow({ source, cronActive }: { source: SyncSourceOverview; cronActive: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const initial: SyncSchedule = source.schedule ?? { frequency: "daily", time: "02:00", timezone: "America/New_York" };
  const [enabled, setEnabled] = useState(source.automation_enabled);
  const [schedule, setSchedule] = useState<SyncSchedule>(initial);
  const [maxFiles, setMaxFiles] = useState("");
  const [maxMiB, setMaxMiB] = useState("");
  const [maxAttempts, setMaxAttempts] = useState("");
  const save = useMutation({
    mutationFn: () => {
      const deep: Record<string, number> = {};
      if (maxFiles.trim()) deep.max_files = Number(maxFiles);
      if (maxMiB.trim()) deep.max_bytes = Math.round(Number(maxMiB) * MIB);
      return setPermitSyncSchedule({
        credentialId: source.credential_id,
        enabled,
        schedule: schedule.frequency === "weekly" ? { ...schedule, weekday: schedule.weekday ?? 1 } : { frequency: schedule.frequency, time: schedule.time, timezone: schedule.timezone },
        deepDefaults: Object.keys(deep).length ? deep : null,
        maxAttempts: maxAttempts.trim() ? Number(maxAttempts) : null,
      });
    },
    onSuccess: (r) => {
      toast({ title: r.automation_enabled ? "Schedule saved and enabled" : "Schedule saved (disabled)", description: r.next_run_at ? `Next run ${formatTimestamp(r.next_run_at)}${cronActive ? "" : " once the scheduler is installed"}` : undefined });
      void qc.invalidateQueries({ queryKey: ["central-permits", "sync"] });
      void qc.invalidateQueries({ queryKey: OPS_QUERY_KEY });
    },
    onError: (e) => toast({ title: "Schedule not saved", description: errorText(e), variant: "destructive" }),
  });
  const neverRefreshed = !source.last_success_at;
  return (
    <div className="space-y-3 rounded-lg border p-4" data-schedule-row>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold">{source.jurisdiction} <span className="font-mono text-xs text-muted-foreground">{source.credential_id.slice(0, 8)}…</span></p>
          <p className="text-xs text-muted-foreground">
            {source.automation_enabled ? describeSchedule(source.schedule) : "Schedule disabled"} · next run {source.automation_enabled && source.next_run_at ? formatTimestamp(source.next_run_at) : "—"} ·
            last scheduled {formatTimestamp(source.last_scheduled_at)} · last successful refresh {formatTimestamp(source.last_success_at)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Switch id={`sched-${source.credential_id}`} checked={enabled} onCheckedChange={setEnabled} />
          <Label htmlFor={`sched-${source.credential_id}`}>Enabled</Label>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Select value={schedule.frequency} onValueChange={(v) => setSchedule({ ...schedule, frequency: v as SyncSchedule["frequency"] })}>
          <SelectTrigger className="w-[140px]" aria-label="Frequency"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="daily">Daily</SelectItem>
            <SelectItem value="weekdays">Weekdays</SelectItem>
            <SelectItem value="weekly">Weekly</SelectItem>
          </SelectContent>
        </Select>
        {schedule.frequency === "weekly" ? (
          <Select value={String(schedule.weekday ?? 1)} onValueChange={(v) => setSchedule({ ...schedule, weekday: Number(v) })}>
            <SelectTrigger className="w-[140px]" aria-label="Weekday"><SelectValue /></SelectTrigger>
            <SelectContent>{WEEKDAYS.map((d, i) => <SelectItem key={d} value={String(i)}>{d}</SelectItem>)}</SelectContent>
          </Select>
        ) : null}
        <Input className="w-[110px]" type="time" aria-label="Time" value={schedule.time} onChange={(e) => setSchedule({ ...schedule, time: e.target.value })} />
        <Input className="w-[200px]" aria-label="Timezone" placeholder="America/New_York" value={schedule.timezone} onChange={(e) => setSchedule({ ...schedule, timezone: e.target.value.trim() })} />
        <Input className="w-[130px]" inputMode="numeric" aria-label="Max files per run" placeholder="Max files" value={maxFiles} onChange={(e) => setMaxFiles(e.target.value)} />
        <Input className="w-[130px]" inputMode="numeric" aria-label="Max MiB per run" placeholder="Max MiB" value={maxMiB} onChange={(e) => setMaxMiB(e.target.value)} />
        <Input className="w-[120px]" inputMode="numeric" aria-label="Max attempts" placeholder="Attempts" value={maxAttempts} onChange={(e) => setMaxAttempts(e.target.value)} />
        <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>Save</Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Times are in the timezone shown. Empty limits keep the current values; the worker's own limits are the ceiling.
        A schedule never runs for a slot before it was enabled, and is skipped while a refresh is in progress.
      </p>
      {enabled && !source.automation_enabled && neverRefreshed ? (
        <AlertBanner tone="warn" title="No successful refresh yet" detail="Run and verify the first full refresh from the Permit Queue before enabling a schedule." />
      ) : null}
    </div>
  );
}

export function SchedulePanel({ sources, status }: { sources: SyncSourceOverview[]; status?: SchedulerStatus }) {
  const cronActive = !!status?.cron_jobs.find((j) => j.name === "permit-sync-enqueue")?.active;
  return (
    <Panel title="Scheduling" eyebrow="Automatic refreshes">
      <div className="space-y-3">
        <SchedulerNotice status={status} />
        {sources.filter((s) => s.can_refresh).map((s) => <ScheduleRow key={s.credential_id} source={s} cronActive={cronActive} />)}
        {!sources.length ? <p className="text-sm text-muted-foreground">No sources.</p> : null}
      </div>
    </Panel>
  );
}

type WorkerLimits = { max_files?: number; max_bytes?: number; max_file_bytes?: number; max_attempts?: number } | null;

/** "120 files · 2048 MiB per run"; the worker's ceilings, which job and schedule limits can only lower. */
export function workerLimitsLabel(limits: WorkerLimits | undefined): string {
  if (!limits) return "—";
  const parts = [];
  if (limits.max_files !== undefined) parts.push(`${limits.max_files} files`);
  if (limits.max_bytes !== undefined) parts.push(`${Math.round(limits.max_bytes / MIB)} MiB per run`);
  return parts.join(" · ") || "—";
}

export function WorkerHealthPanel({ status, loading }: { status?: SchedulerStatus; loading: boolean }) {
  const live = (status?.workers ?? []).filter((w) => w.status !== "stopped");
  const narrowed = live.filter((w) => w.details?.scope !== undefined && w.details.scope !== "all");
  return (
    <Panel title="Sync workers" eyebrow="Seen in the last day">
      {narrowed.length ? (
        <AlertBanner className="mb-3" tone="warn" title="A worker is limited to specific permits"
          detail="PERMIT_SYNC_ONLY_PORTAL_RECORD_IDS is set, so every refresh it claims covers only those permits. Unset it before a full refresh." />
      ) : null}
      {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : !status?.workers.length ? (
        <AlertBanner tone="warn" title="No worker has reported" detail="Refresh requests stay queued until a sync worker is running." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Worker</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead>Health</TableHead>
              <TableHead>Current job</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>Per-run limits</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Memory</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Last heartbeat</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {status.workers.map((w) => {
              const h = workerHealth(w);
              return (
                <TableRow key={w.worker_id}>
                  <TableCell className="font-mono text-xs">{w.worker_id}</TableCell>
                  <TableCell>{w.mode}</TableCell>
                  <TableCell><StatusPill tone={h.tone}>{h.label}</StatusPill></TableCell>
                  <TableCell className="font-mono text-xs">{w.current_job_id ? `${w.current_job_id.slice(0, 8)}…` : "—"}</TableCell>
                  <TableCell className="text-sm">{w.details?.scope === undefined ? "—" : w.details.scope === "all" ? "All permits" : `${str(w.details.scope)} permit(s) only`}</TableCell>
                  <TableCell className="text-sm">{workerLimitsLabel(w.details?.limits as WorkerLimits | undefined)}</TableCell>
                  <TableCell className="font-mono text-xs">{str(w.details?.version) || "—"}</TableCell>
                  <TableCell className="tabular-nums text-sm">{w.details?.rss_mb ? `${str(w.details.rss_mb)} MB` : "—"}</TableCell>
                  <TableCell className="text-sm">{formatTimestamp(w.started_at)}</TableCell>
                  <TableCell className="text-sm">{formatTimestamp(w.last_seen_at)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}

const SEVERITY_TONE: Record<string, StatusTone> = { critical: "bad", warning: "warn", info: "info" };

export function AlertsPanel() {
  const alerts = useQuery({ queryKey: [...OPS_QUERY_KEY, "alerts"], queryFn: () => listSyncAlerts(50), refetchInterval: 60000 });
  const rows = alerts.data ?? [];
  return (
    <Panel title="Sync alerts" eyebrow={`${rows.filter((a) => !a.resolved_at).length} open`}>
      {alerts.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : alerts.error ? (
        <AlertBanner tone="bad" title="Could not load alerts" detail={errorText(alerts.error)} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Severity</TableHead>
              <TableHead>Alert</TableHead>
              <TableHead>Occurrences</TableHead>
              <TableHead>First seen</TableHead>
              <TableHead>Last seen</TableHead>
              <TableHead>State</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((a: Row) => (
              <TableRow key={str(a.id)}>
                <TableCell><StatusPill tone={SEVERITY_TONE[str(a.severity)] ?? "default"}>{str(a.severity)}</StatusPill></TableCell>
                <TableCell className="max-w-[420px] text-sm">
                  <p className="font-medium">{str(a.title)}</p>
                  {a.detail ? <p className="text-xs text-muted-foreground">{str(a.detail)}</p> : null}
                </TableCell>
                <TableCell className="tabular-nums">{str(a.occurrences)}</TableCell>
                <TableCell className="text-sm">{formatTimestamp(a.first_seen_at)}</TableCell>
                <TableCell className="text-sm">{formatTimestamp(a.last_seen_at)}</TableCell>
                <TableCell className="text-sm">{a.resolved_at ? `Resolved ${formatTimestamp(a.resolved_at)}` : a.notified_at ? "Open · notified" : "Open"}</TableCell>
              </TableRow>
            ))}
            {!rows.length ? <TableRow><TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">No alerts.</TableCell></TableRow> : null}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}
