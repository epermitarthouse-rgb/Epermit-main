import { CheckCircle2, ShieldAlert } from "lucide-react";
import { designAgents } from "@/components/permitpilot/data";
import { PageHeader, Panel, ProgressLine, StatusPill } from "@/components/permitpilot/ProductPrimitives";

const Compliance = () => (
  <div>
    <PageHeader eyebrow="DesignCheck" title="AI Compliance Intelligence Dashboard" body="Eight specialized review agents reconcile plan sets, code requirements, municipal comments, and filing completeness." action={<button className="pilot-button-primary"><ShieldAlert className="h-4 w-4" />Run DesignCheck</button>} />
    <div className="grid gap-6 xl:grid-cols-[1fr_0.8fr]">
      <Panel title="Agent review matrix" eyebrow="8 agents"><div className="grid gap-3 md:grid-cols-2">{designAgents.map((agent, index) => <div key={agent} className="rounded-md border border-border bg-muted p-4"><div className="flex items-center justify-between"><span className="font-tight font-semibold">{agent}</span><StatusPill tone={index % 5 === 0 ? "bad" : index % 3 === 0 ? "warn" : "good"}>{index % 5 === 0 ? "Conflict" : index % 3 === 0 ? "Review" : "Clear"}</StatusPill></div><div className="mt-4"><ProgressLine value={index % 5 === 0 ? 42 : index % 3 === 0 ? 74 : 100} /></div></div>)}</div></Panel>
      <Panel title="Comment reconciliation" eyebrow="Municipal feedback"><div className="space-y-4"><Issue title="Setback note conflicts with C-104" severity="High" /><Issue title="Stormwater table missing revision date" severity="Medium" /><Issue title="Accessibility sheet requires signature block" severity="Medium" /></div><div className="mt-6 rounded-md bg-success/10 p-4 text-sm text-success"><CheckCircle2 className="mb-2 h-5 w-5" /> 37 comments reconciled from the current plan package.</div></Panel>
    </div>
  </div>
);

const Issue = ({ title, severity }: { title: string; severity: string }) => <div className="rounded-md border border-border bg-muted p-4"><div className="flex items-center justify-between gap-3"><span className="font-tight font-semibold">{title}</span><StatusPill tone={severity === "High" ? "bad" : "warn"}>{severity}</StatusPill></div><p className="mt-2 text-sm text-muted-foreground">DesignCheck has extracted source sheets and recommended response language.</p></div>;

export default Compliance;