import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import { AdminPageShell } from "@/components/admin/AdminPageShell";
import { AlertsPanel, SchedulePanel, WorkerHealthPanel, useSchedulerStatus } from "@/components/admin/PermitSyncOperations";
import { AlertBanner, Panel, StatusPill, type StatusTone } from "@/components/design/ProductPrimitives";
import { LocalInspectionBanner } from "@/components/permits/LocalInspectionBanner";
import { formatTimestamp } from "@/components/permits/PermitRepositoryViews";
import { RefreshAllButton, SyncBatchBanner, useSyncOverview } from "@/components/permits/PermitSyncControls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  ACTIVE_JOB_STATUSES,
  cancelPermitSyncJob,
  grantPermitAccess,
  listAccessGrants,
  listSyncEvents,
  listSyncJobs,
  listSyncSources,
  resumePermitSyncSource,
  retryPermitSyncJob,
  revokePermitAccess,
  type GrantScope,
} from "@/lib/centralPermits";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const short = (v: unknown) => (str(v) ? `${str(v).slice(0, 8)}…` : "—");

const SOURCE_TONE: Record<string, StatusTone> = {
  active: "good", inactive: "default", paused: "warn", needs_encryption: "bad", waiting_user: "warn", auth_failed: "bad",
};
const JOB_TONE: Record<string, StatusTone> = {
  queued: "info", running: "info", retry_wait: "warn", waiting_user: "warn", completed: "good",
  completed_with_warnings: "warn", failed: "bad", failed_unrecoverable: "bad", cancelled: "default",
};

const RETRYABLE_JOB_STATUSES = new Set(["failed", "failed_unrecoverable", "cancelled", "completed_with_warnings"]);

function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

function JobEvents({ jobId }: { jobId: string }) {
  const events = useQuery({ queryKey: ["permit-sync", "events", jobId], queryFn: () => listSyncEvents(jobId) });
  if (events.isLoading) return <p className="text-xs text-muted-foreground">Loading events…</p>;
  if (events.error) return <p className="text-xs text-destructive">{errorText(events.error)}</p>;
  if (!events.data?.length) return <p className="text-xs text-muted-foreground">No events.</p>;
  return (
    <ul className="space-y-1 font-mono text-xs">
      {events.data.map((e) => (
        <li key={str(e.id)}>
          <span className="text-muted-foreground">{formatTimestamp(e.created_at)}</span> [{str(e.level)}] {str(e.code)} {str(e.message)}
        </li>
      ))}
    </ul>
  );
}

export default function AdminPermitSync() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const sources = useQuery({ queryKey: ["permit-sync", "sources"], queryFn: listSyncSources });
  const jobs = useQuery({ queryKey: ["permit-sync", "jobs"], queryFn: () => listSyncJobs(50), refetchInterval: 15000 });
  const grants = useQuery({ queryKey: ["permit-sync", "grants"], queryFn: listAccessGrants });
  const overview = useSyncOverview();
  const scheduler = useSchedulerStatus();
  const overviewById = new Map((overview.data ?? []).map((o) => [o.credential_id, o]));
  const [openJob, setOpenJob] = useState<string | null>(null);
  const [grantScope, setGrantScope] = useState<GrantScope>("permit");
  const [grantRef, setGrantRef] = useState("");
  const [granteeKind, setGranteeKind] = useState<"user" | "tenant">("user");
  const [granteeId, setGranteeId] = useState("");
  const [grantNote, setGrantNote] = useState("");

  const action = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["permit-sync"] });
      void qc.invalidateQueries({ queryKey: ["central-permits", "sync"] });
      toast({ title: "Done" });
    },
    onError: (e) => toast({ title: "Action failed", description: errorText(e), variant: "destructive" }),
  });

  const loadError = sources.error || jobs.error || grants.error || overview.error || scheduler.error;

  return (
    <AdminPageShell
      title="Permit Sync"
      description="Portal sources, sync jobs and permit access grants for the central permit repository. Every action is audited."
      breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Permit Sync" }]}
      actions={
        <Button size="sm" variant="outline" onClick={() => { void qc.invalidateQueries({ queryKey: ["permit-sync"] }); void qc.invalidateQueries({ queryKey: ["central-permits", "sync"] }); }}>
          <RefreshCw className="mr-2 h-4 w-4" />Refresh
        </Button>
      }
    >
      <div className="space-y-6">
        <LocalInspectionBanner />
        {loadError ? <AlertBanner tone="bad" title="Could not load sync data" detail={errorText(loadError)} /> : null}
        <SyncBatchBanner sources={overview.data ?? []} />

        <Panel title="Sources" eyebrow="Portal accounts">
          {sources.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Credential</TableHead>
                  <TableHead>Adapter</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Automation</TableHead>
                  <TableHead>Last login</TableHead>
                  <TableHead>Last error</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(sources.data ?? []).map((s: Row) => {
                  const id = str(s.credential_id);
                  const st = str(s.status);
                  return (
                    <TableRow key={id}>
                      <TableCell className="font-mono text-xs">{short(id)}</TableCell>
                      <TableCell>{str(s.adapter_key)}</TableCell>
                      <TableCell><StatusPill tone={SOURCE_TONE[st] ?? "default"}>{st.replace("_", " ")}</StatusPill></TableCell>
                      <TableCell>{s.automation_enabled ? "On" : "Off"}</TableCell>
                      <TableCell className="text-sm">{formatTimestamp(s.last_login_ok_at)}</TableCell>
                      <TableCell className="max-w-[260px] truncate text-xs text-muted-foreground" title={str(s.last_error)}>{str(s.last_error) || "—"}</TableCell>
                      <TableCell className="space-x-2 text-right">
                        {overviewById.get(id) ? <RefreshAllButton sources={[overviewById.get(id)!]} /> : null}
                        {["paused", "waiting_user", "auth_failed"].includes(st) ? (
                          <Button size="sm" variant="outline" disabled={action.isPending} onClick={() => action.mutate(() => resumePermitSyncSource(id))}>
                            Resume
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!sources.data?.length ? (
                  <TableRow><TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">No sources configured.</TableCell></TableRow>
                ) : null}
              </TableBody>
            </Table>
          )}
        </Panel>

        <Panel title="Recent jobs" eyebrow="Last 50">
          {jobs.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Credential</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Attempt</TableHead>
                  <TableHead>Permits ok / failed</TableHead>
                  <TableHead>Changes</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(jobs.data ?? []).flatMap((j: Row) => {
                  const id = str(j.id);
                  const st = str(j.status);
                  const m = (j.metrics ?? {}) as Row;
                  const rows = [
                    <TableRow key={id}>
                      <TableCell className="font-mono text-xs">{short(id)}</TableCell>
                      <TableCell className="font-mono text-xs">{short(j.credential_id)}</TableCell>
                      <TableCell>{str(j.trigger)}</TableCell>
                      <TableCell>
                        <StatusPill tone={JOB_TONE[st] ?? "default"}>{st.replace(/_/g, " ")}</StatusPill>
                        {j.error_code ? <p className="mt-1 text-xs text-muted-foreground">{str(j.error_code)}</p> : null}
                        {Array.isArray(m.deep_warnings) && m.deep_warnings.length ? (
                          <p className="mt-1 text-xs text-muted-foreground">{(m.deep_warnings as unknown[]).map((w) => str(w).replace(/_/g, " ")).join(", ")}</p>
                        ) : null}
                      </TableCell>
                      <TableCell className="tabular-nums">{str(j.attempt_count)}/{str(j.max_attempts)}</TableCell>
                      <TableCell className="tabular-nums">{str(m.permits_ok) || "—"} / {str(m.permits_failed) || "—"}</TableCell>
                      <TableCell className="tabular-nums">{str(m.changes) || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{formatTimestamp(j.created_at)}</TableCell>
                      <TableCell className="space-x-2 text-right">
                        <Button size="sm" variant="ghost" onClick={() => setOpenJob(openJob === id ? null : id)}>
                          {openJob === id ? "Hide events" : "Events"}
                        </Button>
                        {RETRYABLE_JOB_STATUSES.has(st) ? (
                          <Button size="sm" variant="outline" disabled={action.isPending} onClick={() => action.mutate(() => retryPermitSyncJob(id))}>
                            Retry
                          </Button>
                        ) : null}
                        {ACTIVE_JOB_STATUSES.has(st) || st === "waiting_user" ? (
                          <Button size="sm" variant="outline" disabled={action.isPending} onClick={() => action.mutate(() => cancelPermitSyncJob(id))}>
                            Cancel
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>,
                  ];
                  if (openJob === id) {
                    rows.push(
                      <TableRow key={`${id}-events`}>
                        <TableCell colSpan={9}><JobEvents jobId={id} /></TableCell>
                      </TableRow>,
                    );
                  }
                  return rows;
                })}
                {!jobs.data?.length ? (
                  <TableRow><TableCell colSpan={9} className="py-6 text-center text-sm text-muted-foreground">No jobs yet.</TableCell></TableRow>
                ) : null}
              </TableBody>
            </Table>
          )}
        </Panel>

        <SchedulePanel sources={overview.data ?? []} status={scheduler.data} />
        <WorkerHealthPanel status={scheduler.data} loading={scheduler.isLoading} />
        <AlertsPanel />

        <Panel title="Access grants" eyebrow="Who can see which permits">
          <form
            className="mb-4 flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              action.mutate(async () => {
                await grantPermitAccess({
                  scope: grantScope,
                  scopeRef: grantRef,
                  granteeUserId: granteeKind === "user" ? granteeId.trim() : null,
                  granteeTenantId: granteeKind === "tenant" ? granteeId.trim() : null,
                  note: grantNote,
                });
                setGrantRef("");
                setGranteeId("");
                setGrantNote("");
              });
            }}
          >
            <Select value={grantScope} onValueChange={(v) => setGrantScope(v as GrantScope)}>
              <SelectTrigger className="w-[170px]" aria-label="Grant scope"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="permit">One permit (id)</SelectItem>
                <SelectItem value="adapter">Whole portal (adapter key)</SelectItem>
                <SelectItem value="source_credential">One source account (credential id)</SelectItem>
              </SelectContent>
            </Select>
            <Input className="w-[260px]" placeholder="Scope reference" value={grantRef} onChange={(e) => setGrantRef(e.target.value)} aria-label="Scope reference" />
            <Select value={granteeKind} onValueChange={(v) => setGranteeKind(v as "user" | "tenant")}>
              <SelectTrigger className="w-[120px]" aria-label="Grantee type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="user">User id</SelectItem>
                <SelectItem value="tenant">Tenant id</SelectItem>
              </SelectContent>
            </Select>
            <Input className="w-[280px]" placeholder="Grantee id" value={granteeId} onChange={(e) => setGranteeId(e.target.value)} aria-label="Grantee id" />
            <Input className="w-[200px]" placeholder="Note (optional)" value={grantNote} onChange={(e) => setGrantNote(e.target.value)} aria-label="Note" />
            <Button type="submit" size="sm" disabled={action.isPending || !grantRef.trim() || !granteeId.trim()}>Grant</Button>
          </form>
          {grants.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Scope</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Grantee</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>Granted</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(grants.data ?? []).map((g: Row) => (
                  <TableRow key={str(g.id)}>
                    <TableCell>{str(g.scope_type).replace("_", " ")}</TableCell>
                    <TableCell className="font-mono text-xs">{str(g.adapter_key) || short(g.permit_id || g.credential_id)}</TableCell>
                    <TableCell className="font-mono text-xs">{g.grantee_user_id ? `user ${short(g.grantee_user_id)}` : `tenant ${short(g.grantee_tenant_id)}`}</TableCell>
                    <TableCell className="text-sm">{str(g.note) || "—"}</TableCell>
                    <TableCell className="text-sm">{formatTimestamp(g.created_at)}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" disabled={action.isPending} onClick={() => action.mutate(() => revokePermitAccess(str(g.id)))}>
                        Revoke
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!grants.data?.length ? (
                  <TableRow><TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">No active grants. Only platform admins can see permits.</TableCell></TableRow>
                ) : null}
              </TableBody>
            </Table>
          )}
        </Panel>
      </div>
    </AdminPageShell>
  );
}
