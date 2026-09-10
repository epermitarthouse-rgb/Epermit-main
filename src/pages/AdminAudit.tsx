import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Download, History, Loader2, ScrollText } from "lucide-react";
import { Link } from "react-router-dom";
import { AdminPageShell } from "@/components/admin/AdminPageShell";
import { AlertBanner, Panel } from "@/components/design/ProductPrimitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
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
import { useToast } from "@/hooks/use-toast";
import { useAdminApi } from "@/hooks/useAdminApi";
import type { AdminAuditEvent } from "@/lib/adminApi";
import { supabase } from "@/lib/supabase";

const PAGE_SIZE = 50;

type ActivityLogRow = {
  id: string;
  admin_email: string;
  action_type: string;
  jurisdiction_name: string | null;
  notification_title: string | null;
  notification_message: string | null;
  subscriber_count: number | null;
  email_sent: boolean | null;
  delivery_status: string | null;
  error_message: string | null;
  created_at: string;
};

const AUDIT_ACTIONS = [
  "admin.user.created",
  "user.activated",
  "user.deactivated",
  "platform_role.granted",
  "platform_role.revoked",
  "project_access.changed",
  "feature_permission.changed",
  "scraped_data_scope.changed",
  "credential_grant.changed",
  "credential_grant.revoked",
  "permissions.copied",
];

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function legacyActionLabel(actionType: string): string {
  switch (actionType) {
    case "platform_role_grant":
      return "Platform role grant";
    case "platform_role_revoke":
      return "Platform role revoke";
    case "notification_sent":
    case "send_notification":
      return "Notification";
    default:
      return actionType.replace(/_/g, " ");
  }
}

export default function AdminAudit() {
  const adminApi = useAdminApi();
  const { toast } = useToast();

  const [events, setEvents] = useState<AdminAuditEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [actionFilter, setActionFilter] = useState<string>("all");
  const [actorFilter, setActorFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const [legacyLogs, setLegacyLogs] = useState<ActivityLogRow[]>([]);
  const [legacyLoading, setLegacyLoading] = useState(true);
  const [legacyError, setLegacyError] = useState<string | null>(null);
  const [legacyOffset, setLegacyOffset] = useState(0);

  const currentCursor = cursorStack[cursorStack.length - 1] ?? null;

  const loadPlatformAudit = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.listAuditEvents({
        limit: PAGE_SIZE,
        cursor: currentCursor,
        action: actionFilter === "all" ? null : actionFilter,
      });
      setEvents(res.events ?? []);
      setNextCursor(res.next_cursor?.created_at ?? null);
    } catch (err) {
      setEvents([]);
      setError(err instanceof Error ? err.message : "Failed to load audit events");
    } finally {
      setLoading(false);
    }
  }, [actionFilter, adminApi, currentCursor]);

  useEffect(() => {
    void loadPlatformAudit();
  }, [loadPlatformAudit]);

  useEffect(() => {
    let cancelled = false;
    async function loadLegacy() {
      setLegacyLoading(true);
      setLegacyError(null);
      try {
        const { data, error: queryError } = await supabase
          .from("admin_activity_log")
          .select(
            "id, admin_email, action_type, jurisdiction_name, notification_title, notification_message, subscriber_count, email_sent, delivery_status, error_message, created_at",
          )
          .order("created_at", { ascending: false })
          .range(legacyOffset, legacyOffset + PAGE_SIZE - 1);

        if (queryError) throw queryError;
        if (!cancelled) setLegacyLogs((data as ActivityLogRow[]) ?? []);
      } catch (err) {
        if (!cancelled) {
          setLegacyLogs([]);
          setLegacyError(err instanceof Error ? err.message : "Failed to load legacy log");
        }
      } finally {
        if (!cancelled) setLegacyLoading(false);
      }
    }
    void loadLegacy();
    return () => {
      cancelled = true;
    };
  }, [legacyOffset]);

  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      if (actorFilter.trim()) {
        const actor = event.actor_id ?? "";
        if (!actor.toLowerCase().includes(actorFilter.trim().toLowerCase())) {
          return false;
        }
      }
      if (fromDate) {
        const from = new Date(`${fromDate}T00:00:00`);
        if (new Date(event.created_at) < from) return false;
      }
      if (toDate) {
        const to = new Date(`${toDate}T23:59:59`);
        if (new Date(event.created_at) > to) return false;
      }
      return true;
    });
  }, [actorFilter, events, fromDate, toDate]);

  const resetFilters = () => {
    setActionFilter("all");
    setActorFilter("");
    setFromDate("");
    setToDate("");
    setCursorStack([null]);
  };

  const handleExport = async () => {
    try {
      const csv = await adminApi.exportAuditCsv({
        from: fromDate ? new Date(`${fromDate}T00:00:00`).toISOString() : undefined,
        to: toDate ? new Date(`${toDate}T23:59:59`).toISOString() : undefined,
      });
      downloadCsv("audit-export.csv", csv);
    } catch (err) {
      toast({
        title: "Export failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };

  return (
    <AdminPageShell
      variant="editorial"
      title="Audit"
      description="Platform governance audit trail plus legacy admin_activity_log."
      breadcrumbs={[{ label: "Audit" }]}
      actions={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void handleExport()}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/admin">Overview</Link>
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        <Panel title="Platform audit events" eyebrow="platform_audit_events">
          <div className="mb-4 grid gap-3 md:grid-cols-4">
            <div className="space-y-2">
              <Label>Action</Label>
              <Select value={actionFilter} onValueChange={setActionFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All actions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All actions</SelectItem>
                  {AUDIT_ACTIONS.map((action) => (
                    <SelectItem key={action} value={action}>
                      {action}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Actor user ID</Label>
              <Input
                value={actorFilter}
                onChange={(e) => setActorFilter(e.target.value)}
                placeholder="Filter by actor UUID"
              />
            </div>
            <div className="space-y-2">
              <Label>From date</Label>
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>To date</Label>
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
          </div>
          <div className="mb-4 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setCursorStack([null]);
              }}
            >
              Apply filters
            </Button>
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              Reset
            </Button>
          </div>

          {error ? (
            <AlertBanner tone="bad" title="Could not load platform audit" detail={error} />
          ) : null}

          {loading ? (
            <div className="flex justify-center py-12 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading audit events…
            </div>
          ) : filteredEvents.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
              <ScrollText className="h-10 w-10 opacity-50" />
              <p>No platform audit events match your filters.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Actor</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Target</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead>Feature</TableHead>
                      <TableHead>Result</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredEvents.map((event) => (
                      <TableRow key={event.id}>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {format(new Date(event.created_at), "MMM d, yyyy HH:mm")}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {event.actor_id ? `${event.actor_id.slice(0, 8)}…` : "—"}
                        </TableCell>
                        <TableCell className="text-sm">{event.action}</TableCell>
                        <TableCell className="text-sm">
                          {event.target_type ?? "—"}
                          {event.target_id ? (
                            <span className="block font-mono text-xs text-muted-foreground">
                              {event.target_id.slice(0, 8)}…
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {event.project_id ? `${event.project_id.slice(0, 8)}…` : "—"}
                        </TableCell>
                        <TableCell className="text-xs">{event.feature_key ?? "—"}</TableCell>
                        <TableCell>
                          {event.result ? (
                            <Badge variant="outline" className="capitalize">
                              {event.result}
                            </Badge>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="mt-4 flex justify-end">
                <Pagination>
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        href="#"
                        className={
                          cursorStack.length <= 1 ? "pointer-events-none opacity-50" : undefined
                        }
                        onClick={(e) => {
                          e.preventDefault();
                          if (cursorStack.length > 1) {
                            setCursorStack((prev) => prev.slice(0, -1));
                          }
                        }}
                      />
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationNext
                        href="#"
                        className={!nextCursor ? "pointer-events-none opacity-50" : undefined}
                        onClick={(e) => {
                          e.preventDefault();
                          if (nextCursor) {
                            setCursorStack((prev) => [...prev, nextCursor]);
                          }
                        }}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            </>
          )}
        </Panel>

        <Panel title="Legacy admin activity" eyebrow="admin_activity_log">
          <AlertBanner
            tone="info"
            title="Historical log"
            detail="Jurisdiction notifications and legacy platform role changes. New governance actions appear in platform_audit_events above."
          />

          {legacyError ? (
            <AlertBanner tone="bad" title="Legacy log unavailable" detail={legacyError} />
          ) : null}

          {legacyLoading ? (
            <div className="flex justify-center py-8 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading legacy log…
            </div>
          ) : legacyLogs.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No legacy entries.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Actor</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Detail</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {legacyLogs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {format(new Date(log.created_at), "MMM d, yyyy HH:mm")}
                        </TableCell>
                        <TableCell className="text-sm">{log.admin_email}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <History className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                            <span className="text-sm">{legacyActionLabel(log.action_type)}</span>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-md text-sm">
                          <p className="font-medium text-foreground">
                            {log.notification_title || log.jurisdiction_name || "—"}
                          </p>
                          {log.notification_message ? (
                            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                              {log.notification_message}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          {log.delivery_status ? (
                            <Badge variant="outline" className="capitalize">
                              {log.delivery_status}
                            </Badge>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={legacyOffset === 0}
                  onClick={() => setLegacyOffset(Math.max(0, legacyOffset - PAGE_SIZE))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLegacyOffset(legacyOffset + PAGE_SIZE)}
                >
                  Next
                </Button>
              </div>
            </>
          )}
        </Panel>
      </div>
    </AdminPageShell>
  );
}
