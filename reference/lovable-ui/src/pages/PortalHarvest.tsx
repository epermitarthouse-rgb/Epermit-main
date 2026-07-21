import { useState } from "react";
import { CheckCircle2, Cloud, Download, Filter, FolderUp, Inbox, RefreshCw, ShieldAlert, Sparkles, TriangleAlert, XCircle } from "lucide-react";
import { CsvExportDialog, type CsvColumn } from "@/components/CsvExportDialog";
import { AlertBanner, MetricCard, PageHeader, Panel, ServicePill, StatusPill } from "@/components/permitpilot/ProductPrimitives";

type PortalRun = {
  id: string;
  portal: string;
  jurisdiction: string;
  service: "permit-expediting" | "utility-coordination";
  project: string;
  lastRun: string;
  status: "ok" | "auth" | "queued" | "degraded";
  newItems: number;
};

const runs: PortalRun[] = [
  { id: "P-01", portal: "Arlington County Plus", jurisdiction: "Arlington, VA", service: "permit-expediting", project: "Ballston Envelope Package", lastRun: "2 min ago", status: "degraded", newItems: 4 },
  { id: "P-02", portal: "Dominion Energy Work Center", jurisdiction: "Northern Virginia", service: "utility-coordination", project: "Ballston Envelope Package", lastRun: "5 min ago", status: "ok", newItems: 1 },
  { id: "P-03", portal: "Seattle Intake Portal", jurisdiction: "Seattle, WA", service: "permit-expediting", project: "Downtown Transit Hub", lastRun: "7 min ago", status: "ok", newItems: 2 },
  { id: "P-04", portal: "Austin Water Tracker", jurisdiction: "Austin, TX", service: "utility-coordination", project: "Riverside Park Utilities", lastRun: "12 min ago", status: "auth", newItems: 0 },
  { id: "P-05", portal: "PG&E Engineering Queue", jurisdiction: "Santa Clara, CA", service: "utility-coordination", project: "South Bay Fiber Expansion", lastRun: "queued", status: "queued", newItems: 0 },
];

const harvested = [
  { time: "10:42", source: "Arlington County Plus", title: "Comments issued", body: "4 comments attached to PP-2419-ARL. Response package export available." },
  { time: "10:35", source: "Dominion Energy", title: "Provider update", body: "Engineering markup posted for service release review." },
  { time: "10:11", source: "Austin Water", title: "Credential warning", body: "Session expired before receipt ingest; operator re-auth required." },
];

const cols: CsvColumn<PortalRun>[] = [
  { key: "portal", label: "Portal", value: (r) => r.portal },
  { key: "project", label: "Project", value: (r) => r.project },
  { key: "service", label: "Service", value: (r) => r.service },
  { key: "jurisdiction", label: "Jurisdiction", value: (r) => r.jurisdiction },
  { key: "last", label: "Last Run", value: (r) => r.lastRun },
  { key: "status", label: "Status", value: (r) => r.status },
  { key: "new", label: "New Items", value: (r) => r.newItems },
];

const PortalHarvest = () => {
  const [exportOpen, setExportOpen] = useState(false);
  const totalNewItems = runs.reduce((acc, run) => acc + run.newItems, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Portal Harvest"
        title="Operational monitoring for county and provider portals."
        body="Portal Harvest now feeds both permit expediting and utility coordination. Operators can see degraded states, credential issues, and new harvested items in one queue."
        action={
          <div className="flex gap-2">
            <button className="pilot-button-ghost"><RefreshCw className="h-4 w-4" /> Force Sync</button>
            <button className="pilot-button-primary"><Sparkles className="h-4 w-4" /> Add Portal</button>
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Connected portals" value={`${runs.length}`} detail="Permit + utility monitoring" icon={Cloud} />
        <MetricCard label="New harvested items" value={`${totalNewItems}`} detail="Across the latest sync cycle" icon={Inbox} />
        <MetricCard label="Auth issues" value={`${runs.filter((run) => run.status === "auth").length}`} detail="Needs operator intervention" icon={ShieldAlert} />
        <MetricCard label="Degraded feeds" value={`${runs.filter((run) => run.status === "degraded").length}`} detail="Fallback workflows are active" icon={TriangleAlert} />
      </div>

      <AlertBanner
        tone="bad"
        title="Portal sync degraded"
        detail="Fairfax Accela outage window until 03:30 UTC. Manual CSV export is required for IFC matrix refresh until the county feed stabilizes."
      />

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Panel title="Portal queue" eyebrow="Live monitoring">
          <div className="mb-4 flex flex-wrap gap-2">
            <button className="pilot-button-ghost"><Filter className="h-4 w-4" /> Filter</button>
            <button className="pilot-button-ghost" onClick={() => setExportOpen(true)}><Download className="h-4 w-4" /> Export</button>
            <button className="pilot-button-ghost"><FolderUp className="h-4 w-4" /> Manual upload</button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="py-3 font-data">Portal</th>
                  <th className="font-data">Project</th>
                  <th className="font-data">Service</th>
                  <th className="font-data">Jurisdiction</th>
                  <th className="font-data">Last run</th>
                  <th className="font-data">New items</th>
                  <th className="font-data">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {runs.map((run) => (
                  <tr key={run.id} className="hover:bg-muted/30">
                    <td className="py-4 font-medium text-foreground">{run.portal}</td>
                    <td className="text-muted-foreground">{run.project}</td>
                    <td><ServicePill service={run.service} /></td>
                    <td className="text-muted-foreground">{run.jurisdiction}</td>
                    <td className="font-data text-xs text-muted-foreground">{run.lastRun}</td>
                    <td className="font-data font-bold text-foreground">{run.newItems || "—"}</td>
                    <td>{renderStatus(run.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title="Recent harvest" eyebrow="Inbox">
            <ul className="space-y-4">
              {harvested.map((item) => (
                <li key={item.time + item.source} className="rounded-lg border border-border bg-muted/20 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="pilot-kicker">{item.source}</div>
                    <div className="font-data text-[11px] uppercase tracking-wider text-muted-foreground">{item.time}</div>
                  </div>
                  <div className="mt-2 text-sm font-medium text-foreground">{item.title}</div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.body}</p>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Fallback workflows" eyebrow="Operator playbook">
            <div className="space-y-3">
              <FallbackItem title="Manual CSV export" detail="Use this when county feeds degrade during comment reconciliation." state="Active" tone="warn" />
              <FallbackItem title="Credential rotation" detail="Operator re-auth is required before Austin Water receipt ingest can resume." state="Blocked" tone="bad" />
              <FallbackItem title="Weekly digest queue" detail="Next jurisdiction digest lands in the shared inbox in approximately 12 minutes." state="Queued" tone="good" />
            </div>
          </Panel>
        </div>
      </div>

      <CsvExportDialog open={exportOpen} onOpenChange={setExportOpen} title="Export Portal Runs" filename="portal-harvest" columns={cols} rows={runs} storageKey="portal-harvest" />
    </div>
  );
};

const renderStatus = (status: PortalRun["status"]) => {
  if (status === "ok") return <StatusPill tone="good"><CheckCircle2 className="h-3 w-3" />Healthy</StatusPill>;
  if (status === "auth") return <StatusPill tone="bad"><XCircle className="h-3 w-3" />Re-auth needed</StatusPill>;
  if (status === "degraded") return <StatusPill tone="warn"><TriangleAlert className="h-3 w-3" />Degraded</StatusPill>;
  return <StatusPill tone="default"><RefreshCw className="h-3 w-3" />Queued</StatusPill>;
};

const FallbackItem = ({ title, detail, state, tone }: { title: string; detail: string; state: string; tone: "good" | "warn" | "bad" }) => (
  <div className="rounded-lg border border-border bg-muted/20 p-4">
    <div className="flex items-center justify-between gap-3">
      <div className="text-sm font-medium text-foreground">{title}</div>
      <StatusPill tone={tone}>{state}</StatusPill>
    </div>
    <p className="mt-2 text-xs leading-5 text-muted-foreground">{detail}</p>
  </div>
);

export default PortalHarvest;