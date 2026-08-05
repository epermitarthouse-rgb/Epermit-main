import { Bot, SlidersHorizontal } from "lucide-react";
import { permits } from "@/components/permitpilot/data";
import { MetricCard, PageHeader, Panel, ServicePill, StatusPill } from "@/components/permitpilot/ProductPrimitives";

const PermitQueue = () => (
  <div className="space-y-6">
    <PageHeader
      eyebrow="Queue management"
      title="Permit and utility work queue."
      body="Prioritize filings, provider reviews, and portal-driven follow-ups by service line, age, risk, and next required action."
      action={<button className="pilot-button-ghost"><SlidersHorizontal className="h-4 w-4" />Filters</button>}
    />

    <div className="grid gap-4 md:grid-cols-4">
      <MetricCard label="Average queue age" value="12.4d" detail="Across both service lines" />
      <MetricCard label="Critical items" value="5" detail="Need operator action today" />
      <MetricCard label="Provider reviews" value="4" detail="Utility coordination items in queue" />
      <MetricCard label="AI escalations" value="7" detail="Automatically prioritized" icon={Bot} />
    </div>

    <Panel>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] text-left">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
              <th className="py-3 font-data">Permit ID</th>
              <th className="font-data">Project</th>
              <th className="font-data">Service</th>
              <th className="font-data">Type</th>
              <th className="font-data">Agency</th>
              <th className="font-data">Age</th>
              <th className="font-data">Status</th>
              <th className="font-data">Risk</th>
              <th className="font-data">Next step</th>
              <th className="font-data">Agent</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {permits.map((permit) => (
              <tr key={permit.id} className="hover:bg-muted/20">
                <td className="py-4 font-data text-sm text-primary">{permit.id}</td>
                <td className="font-tight font-semibold text-foreground">{permit.project}</td>
                <td><ServicePill service={permit.service === "Permit expediting" ? "permit-expediting" : "utility-coordination"} /></td>
                <td className="text-sm text-muted-foreground">{permit.type}</td>
                <td className="text-sm text-muted-foreground">{permit.agency}</td>
                <td className="font-data text-sm text-foreground">{permit.age}</td>
                <td><StatusPill tone={permit.status.includes("Cleared") ? "good" : permit.status.includes("Comments") ? "bad" : "warn"}>{permit.status}</StatusPill></td>
                <td><StatusPill tone={permit.risk === "High" ? "bad" : permit.risk === "Medium" ? "warn" : "good"}>{permit.risk}</StatusPill></td>
                <td className="text-sm text-muted-foreground">{permit.nextStep}</td>
                <td>
                  <button className="rounded-md border border-border p-2 text-primary hover:border-primary" aria-label="Run operator agent">
                    <Bot className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  </div>
);

export default PermitQueue;