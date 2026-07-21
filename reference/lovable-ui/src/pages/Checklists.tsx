import { CheckSquare, Download, Filter, Search } from "lucide-react";
import { AlertBanner, MetricCard, PageHeader, Panel, ServicePill, StatusPill } from "@/components/permitpilot/ProductPrimitives";

const checklistRows = [
  { id: "CHK-1021", project: "Ballston Envelope Package", service: "permit-expediting" as const, status: "Draft", type: "Plan review completeness", owner: "M. Torres" },
  { id: "CHK-1044", project: "South Bay Fiber Expansion", service: "utility-coordination" as const, status: "In Progress", type: "Provider account package", owner: "D. Okafor" },
  { id: "CHK-1057", project: "Downtown Transit Hub", service: "permit-expediting" as const, status: "Completed", type: "County intake packet", owner: "S. Jenkins" },
];

const ChecklistHistory = () => (
  <div className="space-y-6">
    <PageHeader
      eyebrow="Checklists"
      title="Saved operational checklists across permit and utility work."
      body="A shared checklist history keeps intake, review, and provider package quality control visible across the full client workflow."
      action={<button className="pilot-button-ghost"><Download className="h-4 w-4" /> Export All</button>}
    />

    <div className="grid gap-4 md:grid-cols-4">
      <MetricCard label="Total" value="12" detail="Saved checklists" icon={CheckSquare} />
      <MetricCard label="Draft" value="3" detail="Still being assembled" />
      <MetricCard label="In progress" value="4" detail="Actively updated" />
      <MetricCard label="Completed" value="5" detail="Ready for audit trail" />
    </div>

    <AlertBanner
      tone="info"
      title="Checklist history is now part of the same shell"
      detail="Permit intake and utility package QA both land here so operators can trace completion state without switching tools."
    />

    <Panel>
      <div className="mb-4 flex flex-wrap gap-2">
        <button className="pilot-button-ghost"><Search className="h-4 w-4" /> Search</button>
        <button className="pilot-button-ghost"><Filter className="h-4 w-4" /> Filter</button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="py-3 font-data">Checklist ID</th>
              <th className="font-data">Project</th>
              <th className="font-data">Service</th>
              <th className="font-data">Type</th>
              <th className="font-data">Status</th>
              <th className="font-data">Owner</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {checklistRows.map((row) => (
              <tr key={row.id} className="hover:bg-muted/20">
                <td className="py-4 font-data text-sm text-primary">{row.id}</td>
                <td className="font-medium text-foreground">{row.project}</td>
                <td><ServicePill service={row.service} /></td>
                <td className="text-muted-foreground">{row.type}</td>
                <td><StatusPill tone={row.status === "Completed" ? "good" : row.status === "In Progress" ? "warn" : "default"}>{row.status}</StatusPill></td>
                <td className="text-muted-foreground">{row.owner}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  </div>
);

export default ChecklistHistory;