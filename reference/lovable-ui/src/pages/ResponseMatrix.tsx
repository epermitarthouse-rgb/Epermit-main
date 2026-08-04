import { useSearchParams } from "react-router-dom";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Filter, MessageSquare, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { CsvExportDialog, type CsvColumn } from "@/components/CsvExportDialog";
import { AlertBanner, MetricCard, PageHeader, ServicePill } from "@/components/permitpilot/ProductPrimitives";

type Row = {
  id: string;
  code: string;
  agency: string;
  project: string;
  service: "permit-expediting" | "utility-coordination";
  comment: string;
  response: string;
  status: "open" | "drafted" | "accepted";
  confidence: number;
  reviewer: string;
};

const rows: Row[] = [
  { id: "C-101", code: "IBC 1006.3", agency: "Arlington County", project: "Ballston Envelope Package", service: "permit-expediting", comment: "Provide exit signage calc for assembly area.", response: "See sheet A-5 calc; meets 1006.3.1.", status: "drafted", confidence: 0.92, reviewer: "M. Torres" },
  { id: "C-102", code: "Provider markup", agency: "Dominion Energy", project: "Ballston Envelope Package", service: "utility-coordination", comment: "Clarify service equipment notation on transformer pad exhibit.", response: "Updated exhibit and one-line attached for provider review.", status: "accepted", confidence: 0.98, reviewer: "S. Jenkins" },
  { id: "C-103", code: "ADA 404.2.3", agency: "Seattle review", project: "Downtown Transit Hub", service: "permit-expediting", comment: "Door clearance < 32\" at vestibule.", response: "—", status: "open", confidence: 0.61, reviewer: "—" },
  { id: "C-104", code: "Load verification", agency: "PG&E", project: "South Bay Fiber Expansion", service: "utility-coordination", comment: "Confirm revised load schedule against engineering application.", response: "Updated load table staged for UCI builder sync.", status: "drafted", confidence: 0.85, reviewer: "D. Okafor" },
  { id: "C-105", code: "NFPA 13 6.2", agency: "Fire marshal", project: "Ballston Envelope Package", service: "permit-expediting", comment: "Sprinkler density mismatch for storage.", response: "—", status: "open", confidence: 0.44, reviewer: "—" },
];

const statusTone = {
  open: "border-destructive/30 bg-destructive/10 text-destructive",
  drafted: "border-primary/30 bg-primary/10 text-primary",
  accepted: "border-success/30 bg-success/10 text-success",
} as const;

const csvCols: CsvColumn<Row>[] = [
  { key: "id", label: "ID", value: (r) => r.id },
  { key: "project", label: "Project", value: (r) => r.project },
  { key: "service", label: "Service", value: (r) => r.service },
  { key: "code", label: "Code", value: (r) => r.code },
  { key: "agency", label: "Agency", value: (r) => r.agency },
  { key: "comment", label: "Comment", value: (r) => r.comment },
  { key: "response", label: "Response", value: (r) => r.response },
  { key: "status", label: "Status", value: (r) => r.status },
  { key: "confidence", label: "AI Confidence", value: (r) => `${Math.round(r.confidence * 100)}%` },
  { key: "reviewer", label: "Reviewer", value: (r) => r.reviewer },
];

const ResponseMatrix = () => {
  const [params, setParams] = useSearchParams();
  const scoring = params.get("view") === "scoring";
  const [exportOpen, setExportOpen] = useState(false);

  const setView = (v: "default" | "scoring") => {
    const next = new URLSearchParams(params);
    if (v === "scoring") next.set("view", "scoring");
    else next.delete("view");
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Response Matrix"
        title="Comment reconciliation across permitting and utility coordination."
        body="PermitPilot uses one response workspace for county comments, provider markups, and operator approvals so cross-service blockers are visible in one place."
        action={
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border border-border bg-card p-0.5 text-xs">
              {(["default", "scoring"] as const).map((v) => {
                const active = (v === "scoring") === scoring;
                return (
                  <button key={v} onClick={() => setView(v)} className={cn("rounded px-3 py-1.5 capitalize transition-colors", active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                    {v === "scoring" ? "AI scoring" : "Reconciliation"}
                  </button>
                );
              })}
            </div>
            <button className="pilot-button-ghost"><Filter className="h-4 w-4" /> Filter</button>
            <button className="pilot-button-ghost" onClick={() => setExportOpen(true)}><Download className="h-4 w-4" /> Export</button>
            <button className="pilot-button-primary"><Sparkles className="h-4 w-4" /> Auto-Draft</button>
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Open" value={`${rows.filter((r) => r.status === "open").length}`} detail="Needs operator attention" />
        <MetricCard label="Drafted" value={`${rows.filter((r) => r.status === "drafted").length}`} detail="Ready for review" icon={MessageSquare} />
        <MetricCard label="Accepted" value={`${rows.filter((r) => r.status === "accepted").length}`} detail="Ready to export" icon={CheckCircle2} />
        <MetricCard label="Cross-service" value={`${rows.filter((r) => r.service === "utility-coordination").length}`} detail="Provider-facing items in the same queue" icon={AlertTriangle} />
      </div>

      <AlertBanner
        tone="info"
        title="Utility comments now reconcile here too"
        detail="Provider markups and permit review comments share the same scoring, approval, and export workflow so filings and service requests stay aligned."
      />

      <section className="pilot-card overflow-x-auto">
        <table className="w-full min-w-[1080px] text-left text-sm">
          <thead className="bg-muted/30 pilot-kicker">
            <tr>
              <th className="px-4 py-3 font-medium">ID</th>
              <th className="px-4 py-3 font-medium">Project</th>
              <th className="px-4 py-3 font-medium">Service</th>
              <th className="px-4 py-3 font-medium">Code</th>
              <th className="px-4 py-3 font-medium">Comment</th>
              {!scoring && <th className="px-4 py-3 font-medium">Response</th>}
              {scoring && <th className="px-4 py-3 font-medium">AI Confidence</th>}
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Reviewer</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-muted/40">
                <td className="px-4 py-3 font-data text-xs text-muted-foreground">{row.id}</td>
                <td className="px-4 py-3">
                  <div className="font-medium text-foreground">{row.project}</div>
                  <div className="font-data text-[11px] uppercase tracking-wider text-muted-foreground">{row.agency}</div>
                </td>
                <td className="px-4 py-3"><ServicePill service={row.service} /></td>
                <td className="px-4 py-3 font-data text-xs text-foreground">{row.code}</td>
                <td className="px-4 py-3 max-w-[30ch] text-foreground">{row.comment}</td>
                {!scoring && <td className="px-4 py-3 text-muted-foreground">{row.response === "—" ? <span className="text-destructive">No draft</span> : row.response}</td>}
                {scoring && (
                  <td className="px-4 py-3">
                    <ConfidenceBar value={row.confidence} />
                  </td>
                )}
                <td className="px-4 py-3">
                  <span className={cn("inline-flex items-center gap-1 rounded border px-2 py-0.5 pilot-kicker", statusTone[row.status])}>
                    {row.status === "accepted" && <CheckCircle2 className="h-3 w-3" />}
                    {row.status === "open" && <AlertTriangle className="h-3 w-3" />}
                    {row.status === "drafted" && <MessageSquare className="h-3 w-3" />}
                    {row.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{row.reviewer}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <CsvExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        title="Export Response Matrix"
        filename="response-matrix"
        columns={csvCols}
        rows={rows}
        storageKey="response-matrix"
      />
    </div>
  );
};

const ConfidenceBar = ({ value }: { value: number }) => {
  const pct = Math.round(value * 100);
  const tone = value >= 0.85 ? "bg-success" : value >= 0.65 ? "bg-warning" : "bg-destructive";
  return (
    <div className="flex items-center gap-3">
      <div className="h-1.5 w-32 overflow-hidden rounded-full bg-border">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${pct}%` }} />
      </div>
      <span className="font-data text-xs text-foreground">{pct}%</span>
    </div>
  );
};

export default ResponseMatrix;