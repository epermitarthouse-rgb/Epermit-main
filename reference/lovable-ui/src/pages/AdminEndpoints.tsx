import { useMemo, useState } from "react";
import { Lock, Search, Bell, Wrench, Megaphone } from "lucide-react";

type Method = "GET" | "POST";

interface Endpoint {
  method: Method;
  path: string;
  label: string;
  auth: boolean;
}

interface Group {
  key: string;
  title: string;
  subtitle: string;
  Icon: typeof Bell;
  endpoints: Endpoint[];
}

const groups: Group[] = [
  {
    key: "notifications",
    title: "Notifications",
    subtitle: "Email and in-app notifications",
    Icon: Bell,
    endpoints: [
      { method: "POST", path: "/functions/v1/send-epermit-status-email", label: "E-Permit Status Email", auth: true },
      { method: "POST", path: "/functions/v1/send-contact-email", label: "Send Contact Email", auth: true },
      { method: "POST", path: "/functions/v1/send-welcome-email", label: "Send Welcome Email", auth: true },
      { method: "POST", path: "/functions/v1/send-deadline-reminders", label: "Send Deadline Reminders", auth: true },
      { method: "POST", path: "/functions/v1/send-inspection-reminders", label: "Send Inspection Reminders", auth: true },
      { method: "POST", path: "/functions/v1/send-jurisdiction-notification", label: "Send Jurisdiction Notification", auth: true },
      { method: "POST", path: "/functions/v1/process-scheduled-notifications", label: "Process Scheduled Notifications", auth: true },
    ],
  },
  {
    key: "utilities",
    title: "Utilities",
    subtitle: "Helper and utility functions",
    Icon: Wrench,
    endpoints: [
      { method: "GET", path: "/functions/v1/get-mapbox-token", label: "Get Mapbox Token", auth: true },
      { method: "POST", path: "/functions/v1/validate-url", label: "Validate URL", auth: true },
    ],
  },
  {
    key: "admin",
    title: "Admin & Marketing",
    subtitle: "Administrative and marketing functions",
    Icon: Megaphone,
    endpoints: [
      { method: "POST", path: "/functions/v1/process-drip-emails", label: "Process Drip Emails", auth: true },
      { method: "POST", path: "/functions/v1/admin-drip-campaigns", label: "Admin Drip Campaigns", auth: true },
    ],
  },
];

const methodClass: Record<Method, string> = {
  GET: "border-pilot-teal/30 bg-pilot-teal/10 text-pilot-teal",
  POST: "border-primary/30 bg-primary/10 text-primary",
};

const AdminEndpoints = () => {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return groups;
    return groups
      .map((g) => ({
        ...g,
        endpoints: g.endpoints.filter(
          (e) => e.path.toLowerCase().includes(needle) || e.label.toLowerCase().includes(needle),
        ),
      }))
      .filter((g) => g.endpoints.length > 0);
  }, [q]);

  const total = groups.reduce((n, g) => n + g.endpoints.length, 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="pilot-kicker text-primary">Developer</div>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Platform Endpoints</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {total} edge functions grouped by domain. Read-only reference.
          </p>
        </div>
        <div className="relative w-full md:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search endpoints…"
            className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none transition focus:border-primary focus:ring-1 focus:ring-primary/40"
          />
        </div>
      </header>

      {filtered.length === 0 && (
        <div className="pilot-card p-8 text-center text-sm text-muted-foreground">No endpoints match "{q}".</div>
      )}

      {filtered.map((g) => (
        <section key={g.key} className="pilot-card overflow-hidden">
          <header className="flex items-center gap-3 border-b border-border bg-muted/30 px-5 py-3">
            <g.Icon className="h-4 w-4 text-primary" />
            <div>
              <div className="pilot-kicker text-foreground">{g.title}</div>
              <div className="text-xs text-muted-foreground">{g.subtitle}</div>
            </div>
            <span className="ml-auto pilot-kicker text-muted-foreground">{g.endpoints.length}</span>
          </header>
          <ul className="divide-y divide-border">
            {g.endpoints.map((e) => (
              <li key={e.path} className="flex items-center gap-3 px-5 py-3 text-sm">
                <span className={`inline-flex w-14 justify-center rounded-md border px-2 py-0.5 pilot-kicker ${methodClass[e.method]}`}>
                  {e.method}
                </span>
                <code className="font-data text-xs text-foreground/90">{e.path}</code>
                {e.auth && <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-label="Requires auth" />}
                <span className="ml-auto text-xs text-muted-foreground">{e.label}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
};

export default AdminEndpoints;