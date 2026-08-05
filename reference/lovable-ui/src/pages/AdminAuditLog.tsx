import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  Loader2,
  LogIn,
  LogOut,
  Search,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { AccessDenied } from "@/components/AccessDenied";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type EventType = "sign_in" | "sign_in_failed" | "sign_out" | "access_denied";

type AuditRow = {
  id: string;
  user_id: string | null;
  email: string | null;
  event_type: EventType;
  role_at_event: string | null;
  path: string | null;
  reason: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

const EVENT_META: Record<EventType, { label: string; tone: string; Icon: typeof LogIn }> = {
  sign_in:        { label: "Sign-in",        tone: "bg-success/15 text-success border-success/30",             Icon: LogIn },
  sign_in_failed: { label: "Sign-in failed", tone: "bg-destructive/15 text-destructive border-destructive/30", Icon: XCircle },
  sign_out:       { label: "Sign-out",       tone: "bg-muted text-muted-foreground border-border",             Icon: LogOut },
  access_denied:  { label: "Access denied",  tone: "bg-warning/15 text-warning border-warning/30",             Icon: ShieldAlert },
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

const csvCell = (v: unknown) => {
  const s = v == null ? "" : typeof v === "string" ? v : JSON.stringify(v);
  return `"${s.replace(/"/g, '""')}"`;
};

const AdminAuditLog = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { role } = useUserRole();
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<EventType | "all">("all");
  const [scope, setScope] = useState<"all" | "members" | "non_members">("all");

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/login", { replace: true });
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();
      setIsAdmin(Boolean(data));
      setChecking(false);
    })();
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("access_audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      setRows((data as AuditRow[] | null) ?? []);
      setLoading(false);
    })();
  }, [isAdmin]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== "all" && r.event_type !== filter) return false;
      if (scope === "members" && !r.user_id) return false;
      if (scope === "non_members" && r.user_id) return false;
      if (!q) return true;
      return [r.email, r.path, r.reason, r.role_at_event]
        .some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [rows, query, filter, scope]);

  const stats = useMemo(() => {
    const s = { sign_in: 0, sign_in_failed: 0, sign_out: 0, access_denied: 0 } as Record<EventType, number>;
    rows.forEach((r) => { s[r.event_type] += 1; });
    return s;
  }, [rows]);

  const exportCsv = () => {
    const header = ["timestamp", "event", "email", "user_id", "role_at_event", "path", "reason", "user_agent"];
    const lines = [header.join(",")];
    filtered.forEach((r) => {
      lines.push([
        r.created_at, r.event_type, r.email, r.user_id, r.role_at_event, r.path, r.reason, r.user_agent,
      ].map(csvCell).join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `access-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (authLoading || checking) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <AccessDenied
        pageLabel="Access Audit Log"
        allowedRoles={["admin"]}
        currentRole={role}
        hint="Only workspace administrators can review sign-in and access-denial events."
      />
    );
  }

  const kpis: { label: string; value: number; tone: string; Icon: typeof LogIn }[] = [
    { label: "Sign-ins", value: stats.sign_in, tone: "text-success", Icon: LogIn },
    { label: "Failed attempts", value: stats.sign_in_failed, tone: "text-destructive", Icon: XCircle },
    { label: "Access denied", value: stats.access_denied, tone: "text-warning", Icon: ShieldAlert },
    { label: "Sign-outs", value: stats.sign_out, tone: "text-muted-foreground", Icon: LogOut },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="pilot-kicker text-primary">Admin · Security</div>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Access Audit Log</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign-ins, failed attempts, sign-outs, and denied access — for workspace members and non-members. Latest 500 events.
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/admin" className="pilot-button-ghost">
            <ArrowLeft className="h-4 w-4" /> Admin Console
          </Link>
          <button type="button" onClick={exportCsv} className="pilot-button-primary" disabled={filtered.length === 0}>
            <Download className="h-4 w-4" /> Export CSV
          </button>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="pilot-card p-4">
            <div className="flex items-center justify-between">
              <span className="pilot-kicker text-muted-foreground">{k.label}</span>
              <k.Icon className={cn("h-4 w-4", k.tone)} />
            </div>
            <div className="mt-1 font-display text-3xl font-semibold">{k.value}</div>
          </div>
        ))}
      </div>

      <section className="pilot-card overflow-hidden">
        <header className="flex flex-col gap-3 border-b border-border bg-muted/30 px-5 py-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border border-border bg-background p-0.5 text-xs">
              {(["all", "sign_in", "sign_in_failed", "access_denied", "sign_out"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setFilter(t)}
                  className={cn(
                    "rounded px-2.5 py-1 font-medium capitalize transition",
                    filter === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t === "all" ? "All events" : EVENT_META[t].label}
                </button>
              ))}
            </div>
            <div className="flex rounded-md border border-border bg-background p-0.5 text-xs">
              {(["all", "members", "non_members"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScope(s)}
                  className={cn(
                    "rounded px-2.5 py-1 font-medium capitalize transition",
                    scope === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {s === "all" ? "Everyone" : s === "members" ? "Members" : "Non-members"}
                </button>
              ))}
            </div>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search email, path, reason…"
              className="h-8 w-72 pl-8 text-xs"
            />
          </div>
        </header>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            <CheckCircle2 className="mx-auto mb-2 h-6 w-6 text-success" />
            No audit events match the current filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-muted/20 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-2 text-left">Timestamp</th>
                  <th className="px-5 py-2 text-left">Event</th>
                  <th className="px-5 py-2 text-left">Identity</th>
                  <th className="px-5 py-2 text-left">Path</th>
                  <th className="px-5 py-2 text-left">Reason / Role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((r) => {
                  const meta = EVENT_META[r.event_type];
                  return (
                    <tr key={r.id} className="hover:bg-muted/20">
                      <td className="px-5 py-3 font-data text-xs text-muted-foreground">{fmt(r.created_at)}</td>
                      <td className="px-5 py-3">
                        <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", meta.tone)}>
                          <meta.Icon className="h-3 w-3" /> {meta.label}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="font-medium">{r.email || <span className="text-muted-foreground">— unknown —</span>}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.user_id ? "Member" : <span className="text-warning">Non-member</span>}
                        </div>
                      </td>
                      <td className="px-5 py-3 font-data text-xs text-muted-foreground">{r.path ?? "—"}</td>
                      <td className="px-5 py-3 text-xs">
                        {r.reason ? <div className="text-foreground">{r.reason}</div> : null}
                        {r.role_at_event ? (
                          <div className="text-muted-foreground">Role at event: <span className="font-medium text-foreground">{r.role_at_event}</span></div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

export default AdminAuditLog;