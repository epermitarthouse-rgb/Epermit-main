import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Building2,
  Calendar,
  Loader2,
  ScrollText,
  Shield,
  Users,
} from "lucide-react";
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
import type { AdminAuditEvent, AdminOverviewMetrics, AdminPermissionRisk } from "@/lib/adminApi";
import { supabase } from "@/lib/supabase";

export default function AdminOverview() {
  const adminApi = useAdminApi();
  const [metrics, setMetrics] = useState<AdminOverviewMetrics | null>(null);
  const [recentEvents, setRecentEvents] = useState<AdminAuditEvent[]>([]);
  const [scheduledCount, setScheduledCount] = useState(0);
  const [subscriberJurisdictions, setSubscriberJurisdictions] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [overview, audit, scheduledRes, subsRes] = await Promise.all([
          adminApi.getOverview(),
          adminApi.listAuditEvents({ limit: 15 }),
          supabase
            .from("scheduled_notifications")
            .select("*", { count: "exact", head: true })
            .in("status", ["pending", "processing"]),
          supabase.from("jurisdiction_subscriptions").select("jurisdiction_id"),
        ]);

        if (cancelled) return;

        setMetrics(overview);
        setRecentEvents(audit.events ?? []);
        setScheduledCount(scheduledRes.count ?? 0);

        const jurisdictionIds = new Set(
          (subsRes.data ?? []).map((row) => String(row.jurisdiction_id)),
        );
        setSubscriberJurisdictions(jurisdictionIds.size);
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

  const risks: AdminPermissionRisk[] = metrics?.permission_risks ?? [];
  const pendingInvitations =
    metrics?.pending_invitations_30d ?? metrics?.pending_invitations ?? 0;

  return (
    <AdminPageShell
      variant="editorial"
      title="Governance overview"
      description="Platform health, permission risks, and recent admin audit activity."
      breadcrumbs={[{ label: "Overview" }]}
      actions={
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/access/users">
              <Users className="mr-2 h-4 w-4" />
              Users & Access
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
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
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
              detail="user_roles.admin"
            />
            <MetricCard
              label="Permission risks"
              value={risks.length}
              icon={AlertTriangle}
              detail="Flagged accounts"
            />
            <MetricCard
              label="Pending invitations"
              value={pendingInvitations}
              icon={Calendar}
              detail="Stale invites (30d+)"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Permission risks" eyebrow="governance">
              {risks.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No risks detected. Last scan: {format(new Date(), "MMM d, yyyy HH:mm")}.
                </p>
              ) : (
                <ul className="space-y-2">
                  {risks.map((risk) => (
                    <li
                      key={`${risk.user_id}-${risk.risk_type}`}
                      className="flex items-start justify-between gap-3 rounded border border-border bg-muted/30 px-3 py-2 text-sm"
                    >
                      <div>
                        <p className="font-medium">{risk.risk_type.replace(/_/g, " ")}</p>
                        {risk.detail ? (
                          <p className="text-xs text-muted-foreground">{risk.detail}</p>
                        ) : null}
                      </div>
                      <Button asChild variant="link" size="sm" className="h-auto shrink-0 px-0">
                        <Link to={`/admin/access/users/${risk.user_id}`}>Review</Link>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Platform widgets" eyebrow="retained">
              <ul className="space-y-3 text-sm">
                <li className="flex items-center justify-between rounded border border-border px-3 py-2">
                  <span>Scheduled notifications</span>
                  <Badge variant="outline">{scheduledCount}</Badge>
                </li>
                <li className="flex items-center justify-between rounded border border-border px-3 py-2">
                  <span>Jurisdictions with subscribers</span>
                  <Badge variant="outline">{subscriberJurisdictions}</Badge>
                </li>
                {metrics?.audit_events_24h != null ? (
                  <li className="flex items-center justify-between rounded border border-border px-3 py-2">
                    <span>Audit events (24h)</span>
                    <Badge variant="outline">{metrics.audit_events_24h}</Badge>
                  </li>
                ) : null}
                {metrics?.governance_enforce_mode ? (
                  <li className="flex items-center justify-between rounded border border-border px-3 py-2">
                    <span>Enforce mode</span>
                    <Badge variant="secondary">{metrics.governance_enforce_mode}</Badge>
                  </li>
                ) : null}
              </ul>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link to="/admin/platform/notifications">Notifications</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link to="/admin/platform/jurisdictions">Jurisdictions</Link>
                </Button>
              </div>
            </Panel>
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
