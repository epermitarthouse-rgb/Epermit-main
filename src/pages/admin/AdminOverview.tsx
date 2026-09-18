import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import { Building2, Loader2, ScrollText, Shield, Users } from "lucide-react";
import { AdminPageShell } from "@/components/admin/AdminPageShell";
import { AlertBanner, MetricCard, Panel } from "@/components/design/ProductPrimitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAdminApi } from "@/hooks/useAdminApi";
import type { AdminAuditEvent, AdminOverviewMetrics } from "@/lib/adminApi";

const RECENT_AUDIT_LIMIT = 8;

export default function AdminOverview() {
  const adminApi = useAdminApi();
  const [metrics, setMetrics] = useState<AdminOverviewMetrics | null>(null);
  const [recentEvents, setRecentEvents] = useState<AdminAuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [overview, audit] = await Promise.all([
          adminApi.getOverview(),
          adminApi.listAuditEvents({ limit: RECENT_AUDIT_LIMIT }),
        ]);

        if (cancelled) return;

        setMetrics(overview);
        setRecentEvents(audit.events ?? []);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load overview");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [adminApi]);

  return (
    <AdminPageShell
      variant="editorial"
      title="Governance overview"
      description="Platform health and recent admin audit activity."
      breadcrumbs={[{ label: "Overview" }]}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {metrics?.governance_enforce_mode ? (
            <Badge variant="secondary" className="font-normal">
              Enforce: {metrics.governance_enforce_mode}
            </Badge>
          ) : null}
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/access/users">
              <Users className="mr-2 h-4 w-4" />
              Authorization
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/audit">
              <ScrollText className="mr-2 h-4 w-4" />
              Audit
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/platform/jurisdictions">
              <Building2 className="mr-2 h-4 w-4" />
              Platform
            </Link>
          </Button>
        </div>
      }
    >
      {error ? <AlertBanner tone="bad" title="Could not load overview" detail={error} /> : null}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-6 w-6 animate-spin" />
          Loading governance metrics…
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <MetricCard
              label="Total users"
              value={metrics?.total_users ?? 0}
              icon={Users}
              detail="All profiles"
            />
            <MetricCard
              label="Active users"
              value={metrics?.active_users ?? 0}
              icon={Users}
              detail="access_status = active"
            />
            <MetricCard
              label="Platform admins"
              value={metrics?.platform_admins ?? 0}
              icon={Shield}
              detail="admin + super_admin"
            />
          </div>

          <Panel title="Recent audit activity" eyebrow="platform_audit_events">
            {recentEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No platform audit events yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Target</TableHead>
                      <TableHead>Result</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentEvents.map((event) => (
                      <TableRow key={event.id}>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {format(new Date(event.created_at), "MMM d, yyyy HH:mm")}
                        </TableCell>
                        <TableCell className="text-sm">{event.action}</TableCell>
                        <TableCell className="text-sm">
                          {event.target_type ?? "—"}
                          {event.target_id ? ` · ${event.target_id.slice(0, 8)}…` : null}
                        </TableCell>
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
            )}
            <div className="mt-4">
              <Button asChild variant="outline" size="sm">
                <Link to="/admin/audit">View full audit log</Link>
              </Button>
            </div>
          </Panel>
        </div>
      )}
    </AdminPageShell>
  );
}
