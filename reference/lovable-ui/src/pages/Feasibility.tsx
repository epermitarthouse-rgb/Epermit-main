import { AlertTriangle, CalendarClock, CheckCircle2, Gavel, MapPin, Play, Ruler, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

const constraints = [
  { icon: CheckCircle2, tone: "text-success", body: "Drive-thru permitted with queue lane for 6+ vehicles." },
  { icon: AlertTriangle, tone: "text-warning", body: "Grease trap installation requires secondary public works review." },
  { icon: CheckCircle2, tone: "text-success", body: "Outdoor seating allowed up to 15% of interior GFA." },
];

const timeline = [
  { phase: "Site Plan Review", duration: "4-6 Months", tone: "bg-success" },
  { phase: "Utility Tap Approvals", duration: "6-8 Months", tone: "bg-warning" },
  { phase: "Building Permit Issuance", duration: "2-4 Months", tone: "bg-border" },
];

const risks = [
  { icon: MapPin, factor: "High-Load Utility Needs", severity: "HIGH", tone: "destructive", note: "Water line on Westheimer is undersized for commercial kitchen demand.", action: "Request Flow Test" },
  { icon: Ruler, factor: "Existing Easements", severity: "MEDIUM", tone: "warning", note: "15' utility easement at rear limits potential drive-thru turning radius.", action: "View Survey Overlay" },
  { icon: Users, factor: "Neighborhood Opposition", severity: "LOW", tone: "success", note: "Area association generally supportive of commercial infill.", action: "Monitor" },
];

const sevTone: Record<string, string> = {
  destructive: "bg-destructive/10 text-destructive border-destructive/20",
  warning: "bg-warning/10 text-warning border-warning/20",
  success: "bg-success/10 text-success border-success/20",
};

const Feasibility = () => (
  <div className="space-y-6">
    <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="pilot-kicker text-primary">Phase 0 Entitlement</div>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-foreground">AI Feasibility Analyzer</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Pre-purchase intelligence for zoning, utility readiness, and entitlement risk.</p>
      </div>
      <div className="flex gap-2">
        <Link to="/feasibility/site" className="pilot-button-ghost">Site-level analyzer</Link>
        <button className="pilot-button-primary"><Play className="h-4 w-4" /> Run Site Investigation</button>
      </div>
    </header>

    {/* Input bar */}
    <section className="pilot-card flex flex-col gap-4 p-5 md:flex-row md:items-end">
      <div className="flex-1">
        <label className="pilot-kicker mb-2 block">Project Address</label>
        <div className="relative">
          <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input className="pilot-input pl-10 font-data" defaultValue="1200 Westheimer Rd, Houston, TX 77006" />
        </div>
      </div>
      <div className="md:w-72">
        <label className="pilot-kicker mb-2 block">Construction Type</label>
        <select className="pilot-input">
          <option>Quick-Service Restaurant (QSR)</option>
          <option>Retail Multi-Tenant</option>
          <option>Industrial Warehouse</option>
          <option>Medical Office</option>
        </select>
      </div>
      <button className="pilot-button-ghost whitespace-nowrap">Update Analysis</button>
    </section>

    {/* Dashboard grid */}
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Zoning summary */}
      <section className="pilot-card overflow-hidden lg:col-span-2">
        <header className="flex items-center justify-between border-b border-border bg-muted/40 p-5">
          <h3 className="flex items-center gap-2 font-tight text-lg font-bold">
            <Gavel className="h-5 w-5 text-primary" /> Zoning &amp; Use Summary
          </h3>
          <span className="rounded-full border border-success/20 bg-success/10 px-3 py-1 pilot-kicker text-success">
            Permitted by Right
          </span>
        </header>
        <div className="grid gap-6 p-5 md:grid-cols-2">
          <div>
            <p className="pilot-kicker">Current Zoning District</p>
            <p className="mt-1 font-data text-lg">C-2 (Commercial)</p>
            <dl className="mt-5 space-y-3 text-sm">
              {[
                ["Max Building Height", "45 ft"],
                ["Setbacks (F/S/R)", "20' / 10' / 15'"],
                ["Parking Req.", "1 per 100 SF"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-border pb-2">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="font-data">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="rounded-lg border border-border bg-muted/40 p-4">
            <h4 className="pilot-kicker">QSR Specific Constraints</h4>
            <ul className="mt-3 space-y-3 text-sm">
              {constraints.map((c, i) => (
                <li key={i} className="flex items-start gap-2">
                  <c.icon className={cn("mt-0.5 h-4 w-4 shrink-0", c.tone)} />
                  <span>{c.body}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Predicted timeline */}
      <section className="pilot-card overflow-hidden">
        <header className="flex items-center gap-2 border-b border-border bg-muted/40 p-5">
          <CalendarClock className="h-5 w-5 text-pilot-cyan" />
          <h3 className="font-tight text-lg font-bold">Predicted Timeline</h3>
        </header>
        <div className="flex flex-col p-5">
          <div className="mb-6 text-center">
            <p className="font-display text-5xl font-semibold text-foreground">14-18</p>
            <p className="pilot-kicker mt-1">Estimated Months to NTP</p>
          </div>
          <ol className="ml-3 space-y-5 border-l-2 border-border pl-5">
            {timeline.map((t) => (
              <li key={t.phase} className="relative">
                <span className={cn("absolute -left-[27px] h-3.5 w-3.5 rounded-full ring-4 ring-background", t.tone)} />
                <h4 className="text-sm font-semibold">{t.phase}</h4>
                <p className="font-data text-xs text-muted-foreground">{t.duration}</p>
              </li>
            ))}
          </ol>
          <p className="mt-5 border-t border-border pt-4 text-center pilot-kicker text-muted-foreground">
            Based on 42 similar QSR projects in Houston
          </p>
        </div>
      </section>

      {/* Risk heatmap */}
      <section className="pilot-card overflow-hidden lg:col-span-3">
        <header className="flex items-center gap-2 border-b border-border bg-muted/40 p-5">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <h3 className="font-tight text-lg font-bold">Jurisdictional Risk Heatmap</h3>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/40">
              <tr className="pilot-kicker">
                <th className="px-5 py-3 font-medium">Risk Factor</th>
                <th className="px-5 py-3 font-medium">Severity</th>
                <th className="px-5 py-3 font-medium">Intelligence Note</th>
                <th className="px-5 py-3 font-medium">Mitigation Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {risks.map((r) => (
                <tr key={r.factor} className="transition-colors hover:bg-muted/40">
                  <td className="px-5 py-4 font-medium text-foreground">
                    <span className="flex items-center gap-2">
                      <r.icon className="h-4 w-4 text-muted-foreground" />
                      {r.factor}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span className={cn("rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", sevTone[r.tone])}>
                      {r.severity}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-muted-foreground">{r.note}</td>
                  <td className="px-5 py-4">
                    <button className="pilot-kicker text-primary hover:underline">{r.action}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </div>
);

export default Feasibility;