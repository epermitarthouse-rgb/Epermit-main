import { useEffect, useState } from "react";
import { format } from "date-fns";
import { History, Loader2, ScrollText } from "lucide-react";
import { Link } from "react-router-dom";
import { AdminPageShell } from "@/components/admin/AdminPageShell";
import { AlertBanner, Panel } from "@/components/design/ProductPrimitives";
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
import { supabase } from "@/lib/supabase";

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

function actionLabel(actionType: string): string {
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
  const [logs, setLogs] = useState<ActivityLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { data, error: queryError } = await supabase
          .from("admin_activity_log")
          .select(
            "id, admin_email, action_type, jurisdiction_name, notification_title, notification_message, subscriber_count, email_sent, delivery_status, error_message, created_at",
          )
          .order("created_at", { ascending: false })
          .limit(100);

        if (queryError) throw queryError;
        if (!cancelled) setLogs((data as ActivityLogRow[]) ?? []);
      } catch (err) {
        console.error("Failed to load admin audit log:", err);
        if (!cancelled) {
          setLogs([]);
          setError(err instanceof Error ? err.message : "Failed to load audit log");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AdminPageShell
      variant="editorial"
      title="Audit"
      description="Read-only admin activity from admin_activity_log. Full access_audit_log (invites, entitlements, credential ACL) is planned for P1."
      breadcrumbs={[{ label: "Audit" }]}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link to="/admin">Overview activity tab</Link>
        </Button>
      }
    >
      <div className="space-y-6">
        <AlertBanner
          tone="info"
          title="What this log covers today"
          detail="Jurisdiction notifications, email ops, and platform role grant/revoke from Admin Members. Not yet: project team invites, feature entitlements, or credential ACL changes."
        />

        {error ? <AlertBanner tone="bad" title="Could not load audit log" detail={error} /> : null}

        <Panel title="Admin activity" eyebrow="admin_activity_log">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading activity…
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground">
              <ScrollText className="h-10 w-10 opacity-50" />
              <p>No admin activity logged yet.</p>
              <p className="max-w-md text-sm">
                Entries appear when admins send jurisdiction notifications or change platform roles on{" "}
                <Link className="text-primary underline-offset-2 hover:underline" to="/admin/members">
                  Members
                </Link>
                .
              </p>
            </div>
          ) : (
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
                  {logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {format(new Date(log.created_at), "MMM d, yyyy HH:mm")}
                      </TableCell>
                      <TableCell className="text-sm">{log.admin_email}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <History className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                          <span className="text-sm">{actionLabel(log.action_type)}</span>
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
                        {typeof log.subscriber_count === "number" && log.subscriber_count > 0 ? (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Subscribers: {log.subscriber_count}
                            {log.email_sent ? " · email sent" : null}
                          </p>
                        ) : null}
                        {log.error_message ? (
                          <p className="mt-0.5 text-xs text-destructive">{log.error_message}</p>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {log.delivery_status ? (
                          <Badge variant="outline" className="capitalize">
                            {log.delivery_status}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Panel>
      </div>
    </AdminPageShell>
  );
}
