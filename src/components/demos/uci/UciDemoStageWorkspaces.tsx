import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  CircleDashed,
  FileText,
  Loader2,
  Mail,
  MapPin,
  Package,
  Truck,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { UCI_DEMO_PROJECT, UCI_DEMO_PROVIDER, type UciDemoFacts } from "./uciDemoScenario";

export const UCI_DEMO_WORKSPACE_TITLES: Record<number, string> = {
  1: "Provider mapping workspace",
  2: "Load analysis workspace",
  3: "Application preparation workspace",
  4: "Submission workspace",
  5: "Acknowledgment inbox",
  6: "Class of Service review",
  7: "CIAC cost tracking",
  8: "Long-lead equipment tracking",
  9: "Pre-energization readiness",
  10: "Energization & closeout",
};

const AUTOMATION_NOTES: Record<number, string> = {
  1: "UCI geocodes the site, intersects utility territory layers, and asks a coordinator to confirm the match.",
  2: "UCI extracts load values from the load letter and one-line, then holds them until an engineer verifies each value.",
  3: "UCI fills the provider application from verified values and checks every required attachment slot.",
  4: "UCI records the submission channel, reference, and package snapshot so nothing is sent twice.",
  5: "UCI reads utility replies, classifies them, and matches acknowledgments to the open submission.",
  6: "UCI compares the utility's Class of Service against the requested service and flags discrepancies.",
  7: "UCI tracks estimate versus invoice, and requires client approval before payment and billing.",
  8: "UCI runs scheduled ETA check-ins and warns when a slip threatens the energization date.",
  9: "UCI assembles inspection, site readiness, and meter-set prerequisites before requesting a crew.",
  10: "UCI collects energization evidence and generates the closeout package for the client.",
};

type WorkspaceProps = {
  stage: number;
  facts: UciDemoFacts;
  reached: boolean;
  onJumpToStage: (stage: number) => void;
};

export function UciDemoStageWorkspace({ stage, facts, reached, onJumpToStage }: WorkspaceProps) {
  return (
    <section
      id="uci-demo-workspace"
      data-testid="uci-demo-workspace"
      data-stage={stage}
      className="space-y-4 rounded-xl border border-teal/30 bg-teal/[0.03] p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-teal">
            Stage {stage} workspace · simulated
          </p>
          <h3 className="font-display text-lg tracking-tight text-foreground">
            {UCI_DEMO_WORKSPACE_TITLES[stage]}
          </h3>
        </div>
        <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-300">
          Read-only demo
        </Badge>
      </div>
      <p className="flex items-start gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm text-foreground">
        <Bot className="mt-0.5 h-4 w-4 shrink-0 text-teal" />
        {AUTOMATION_NOTES[stage]}
      </p>
      {reached ? (
        <WorkspaceBody stage={stage} facts={facts} />
      ) : (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border p-4 text-sm">
          <p className="text-muted-foreground">
            The simulated timeline has not reached this stage yet.
          </p>
          <Button type="button" size="sm" onClick={() => onJumpToStage(stage)} data-testid="uci-demo-jump">
            Advance timeline to Stage {stage}
          </Button>
        </div>
      )}
    </section>
  );
}

function WorkspaceBody({ stage, facts }: { stage: number; facts: UciDemoFacts }) {
  switch (stage) {
    case 1:
      return <ProviderMapping facts={facts} />;
    case 2:
      return <LoadAnalysis facts={facts} />;
    case 3:
      return <ApplicationPrep facts={facts} />;
    case 4:
      return <Submission facts={facts} />;
    case 5:
      return <Acknowledgment facts={facts} />;
    case 6:
      return <ClassOfService facts={facts} />;
    case 7:
      return <CiacCosts facts={facts} />;
    case 8:
      return <Equipment facts={facts} />;
    case 9:
      return <PreEnergization facts={facts} />;
    case 10:
      return <Closeout facts={facts} />;
    default:
      return null;
  }
}

function Card({ title, icon, children, className }: { title: string; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <article className={cn("rounded-lg border border-border/70 bg-card p-4", className)}>
      <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        {icon}
        {title}
      </h4>
      {children}
    </article>
  );
}

function Step({ done, label, detail, warn }: { done: boolean; label: string; detail?: string; warn?: boolean }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {done ? (
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
      ) : warn ? (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      ) : (
        <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      )}
      <span>
        <span className={cn("font-medium", done ? "text-foreground" : "text-muted-foreground")}>{label}</span>
        {detail ? <span className="block text-xs text-muted-foreground">{detail}</span> : null}
      </span>
    </li>
  );
}

function ProviderMapping({ facts }: { facts: UciDemoFacts }) {
  const [running, setRunning] = useState(false);
  const [runs, setRuns] = useState(1);
  const rerun = () => {
    setRunning(true);
    window.setTimeout(() => {
      setRunning(false);
      setRuns((count) => count + 1);
    }, 900);
  };
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card title="Territory check" icon={<MapPin className="h-4 w-4 text-teal" />}>
        <p className="text-sm text-foreground">{UCI_DEMO_PROJECT.address}</p>
        <p className="text-xs text-muted-foreground">Geocoded · rooftop accuracy · simulated territory layer</p>
        <ul className="mt-3 space-y-2 text-sm">
          <li className="flex items-center justify-between rounded-md border border-success/30 bg-success/5 px-3 py-2">
            <span className="font-medium">{UCI_DEMO_PROVIDER}</span>
            <span className="text-xs text-success">Inside territory · high confidence</span>
          </li>
          <li className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2 text-muted-foreground">
            <span>Neighboring utility boundary</span>
            <span className="text-xs">0.4 mi away · excluded</span>
          </li>
        </ul>
        <Button type="button" variant="outline" size="sm" className="mt-3" onClick={rerun} disabled={running} data-testid="uci-demo-rerun-territory">
          {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {running ? "Checking territory layers" : "Re-run territory check"}
        </Button>
        <p className="mt-2 text-[11px] text-muted-foreground">Simulated check run {runs} time{runs === 1 ? "" : "s"} · same result</p>
      </Card>
      <Card title="Coordinator confirmation">
        <ul className="space-y-2">
          <Step done label="Electric provider matched" detail="Point-in-polygon match against the territory layer" />
          <Step done={facts.providerConfirmed} label="Provider confirmed by coordinator" detail={facts.providerConfirmed ? "Jan 5, 2026 · demo coordinator" : "Awaiting human confirmation"} />
          <Step done={facts.providerConfirmed} label="Coordination record opened" detail="Electric · new service · 1000 A" />
        </ul>
      </Card>
    </div>
  );
}

const LOAD_ROWS = [
  { category: "Kitchen equipment", connected: 168, factor: 0.65 },
  { category: "HVAC / rooftop units", connected: 112, factor: 1 },
  { category: "Refrigeration & freezers", connected: 64, factor: 0.9 },
  { category: "Lighting (interior & site)", connected: 38, factor: 1 },
  { category: "Receptacles & misc.", connected: 28, factor: 0.5 },
];

function LoadAnalysis({ facts }: { facts: UciDemoFacts }) {
  const [showEvidence, setShowEvidence] = useState(false);
  const connected = LOAD_ROWS.reduce((sum, row) => sum + row.connected, 0);
  const demand = Math.round(LOAD_ROWS.reduce((sum, row) => sum + row.connected * row.factor, 0));
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <Card title="Load calculation" icon={<Zap className="h-4 w-4 text-teal" />}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="pb-2 font-medium">Category</th>
              <th className="pb-2 text-right font-medium">Connected</th>
              <th className="pb-2 text-right font-medium">Factor</th>
              <th className="pb-2 text-right font-medium">Demand</th>
            </tr>
          </thead>
          <tbody>
            {LOAD_ROWS.map((row) => (
              <tr key={row.category} className="border-t border-border/50">
                <td className="py-1.5">{row.category}</td>
                <td className="py-1.5 text-right font-data">{row.connected} kVA</td>
                <td className="py-1.5 text-right font-data">{row.factor.toFixed(2)}</td>
                <td className="py-1.5 text-right font-data">{Math.round(row.connected * row.factor)} kVA</td>
              </tr>
            ))}
            <tr className="border-t border-border font-semibold">
              <td className="py-1.5">Total</td>
              <td className="py-1.5 text-right font-data">{connected} kVA</td>
              <td />
              <td className="py-1.5 text-right font-data">{demand} kVA</td>
            </tr>
          </tbody>
        </table>
        <Button type="button" variant="ghost" size="sm" className="mt-2 px-0" onClick={() => setShowEvidence((v) => !v)}>
          {showEvidence ? "Hide source evidence" : "Show source evidence"}
        </Button>
        {showEvidence ? (
          <blockquote className="mt-1 rounded-md border-l-2 border-teal bg-muted/40 px-3 py-2 text-xs text-foreground">
            “Total connected load 410 kVA; calculated demand 315 kVA at 120/208 V, 3Ø.” — Highland Springs Load Letter.pdf, page 1
          </blockquote>
        ) : null}
      </Card>
      <Card title="Engineer verification">
        <ul className="space-y-2">
          <Step done label="Values extracted from load letter" detail="Connected and demand load, with page references" />
          <Step done={facts.loadVerified} label="Connected load 410 kVA verified" detail={facts.loadVerified ? "Verified Jan 8 · demo engineer" : "Pending engineer review"} />
          <Step done={facts.loadVerified} label="Demand load 315 kVA verified" />
          <Step done={facts.loadVerified} label="Service size recommendation" detail="1000 A at 120/208 V three-phase" />
        </ul>
      </Card>
    </div>
  );
}

const APPLICATION_FIELDS = [
  ["Service address", UCI_DEMO_PROJECT.address, "Project record"],
  ["Connected load", "410 kVA", "Verified load profile"],
  ["Demand load", "315 kVA", "Verified load profile"],
  ["Service voltage", "120/208 V, 3Ø", "Electrical one-line"],
  ["Service amperage", "1000 A", "Load profile"],
  ["Meter location", "East wall, exterior", "Site plan"],
  ["Requested in-service date", "Apr 22, 2026", "Project schedule"],
] as const;

function ApplicationPrep({ facts }: { facts: UciDemoFacts }) {
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <Card title="Provider application fields" icon={<FileText className="h-4 w-4 text-teal" />}>
        <ul className="divide-y divide-border/50 text-sm">
          {APPLICATION_FIELDS.map(([label, value, source]) => (
            <li key={label} className="flex items-center justify-between gap-3 py-1.5">
              <span className="text-muted-foreground">{label}</span>
              <span className="text-right">
                <span className="font-medium text-foreground">{value}</span>
                <span className="block text-[10px] text-muted-foreground">{source}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs font-medium text-success">7 of 7 required fields filled from verified sources</p>
      </Card>
      <Card title="Attachments & review">
        <ul className="space-y-2">
          <Step done label="Load letter attached" />
          <Step done label="Electrical one-line attached" />
          <Step done label="Site plan attached" />
          <Step done={facts.packageReviewed} label="Coordinator review" detail={facts.packageReviewed ? "Approved for submission Jan 10" : "Awaiting human review"} />
        </ul>
      </Card>
    </div>
  );
}

function Submission({ facts }: { facts: UciDemoFacts }) {
  const [showPackage, setShowPackage] = useState(false);
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card title="Submission receipt" icon={<Package className="h-4 w-4 text-teal" />}>
        {facts.submitted ? (
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-muted-foreground">Reference</dt>
            <dd className="font-data font-semibold">SEC-2026-0001</dd>
            <dt className="text-muted-foreground">Recorded</dt>
            <dd>Jan 12, 2026</dd>
            <dt className="text-muted-foreground">Channel</dt>
            <dd>Simulated demo record</dd>
            <dt className="text-muted-foreground">Package</dt>
            <dd>3 attachments · 7 fields</dd>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">Package approved; submission not yet recorded.</p>
        )}
        <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setShowPackage((v) => !v)}>
          {showPackage ? "Hide package snapshot" : "Preview package snapshot"}
        </Button>
        {showPackage ? (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-foreground">
            <li>New service application form (7 fields)</li>
            <li>Highland Springs Load Letter.pdf</li>
            <li>Highland Springs Electrical One-Line.pdf</li>
            <li>Highland Springs Site Plan.pdf</li>
          </ul>
        ) : null}
      </Card>
      <Card title="Safeguards">
        <ul className="space-y-2">
          <Step done label="Human approval required before sending" />
          <Step done label="Duplicate-submission protection" detail="One submission per package snapshot" />
          <Step done={facts.submitted} label="Submission evidence saved" />
        </ul>
        <p className="mt-3 text-[11px] text-muted-foreground">In this demo nothing is transmitted to a utility.</p>
      </Card>
    </div>
  );
}

function Acknowledgment({ facts }: { facts: UciDemoFacts }) {
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <Card title="Utility reply" icon={<Mail className="h-4 w-4 text-teal" />}>
        {facts.acknowledged ? (
          <div className="space-y-2 text-sm">
            <p className="font-medium">Application received — SEC-ACK-0113</p>
            <p className="text-xs text-muted-foreground">From Dana Whitfield, Springhill Electric (fictional) · Jan 13, 2026</p>
            <p className="rounded-md bg-muted/40 px-3 py-2 text-foreground">
              “We have received your new service application for 301 S Airport Dr. I will be your project manager.
              Design review will begin within 5 business days.”
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Watching the coordination inbox for the acknowledgment.</p>
        )}
      </Card>
      <Card title="What UCI extracted">
        <ul className="space-y-2">
          <Step done={facts.acknowledged} label="Classified as acknowledgment" detail="97% confidence" />
          <Step done={facts.acknowledged} label="Matched to submission SEC-2026-0001" />
          <Step done={facts.acknowledged} label="Utility project manager saved" detail="Dana Whitfield" />
          <Step done={facts.acknowledged} label="Next step: design review in 5 business days" />
        </ul>
      </Card>
    </div>
  );
}

function ClassOfService({ facts }: { facts: UciDemoFacts }) {
  const [version, setVersion] = useState<1 | 2 | null>(null);
  const activeVersion = facts.cosApproved ? (version ?? 2) : 1;
  const issued = activeVersion === 1 ? "800 A" : "1000 A";
  const rows = [
    ["Service amperage", "1000 A", issued],
    ["Voltage", "120/208 V", "120/208 V"],
    ["Phase", "Three-phase", "Three-phase"],
    ["Transformer", "500 kVA pad-mount", activeVersion === 1 ? "300 kVA pad-mount" : "500 kVA pad-mount"],
  ];
  if (!facts.cosDiscrepancyFound) {
    return <p className="text-sm text-muted-foreground">Waiting for the utility to issue a Class of Service.</p>;
  }
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button type="button" size="sm" variant={activeVersion === 1 ? "default" : "outline"} onClick={() => setVersion(1)}>
          Version 1 · Jan 20
        </Button>
        <Button type="button" size="sm" variant={activeVersion === 2 ? "default" : "outline"} disabled={!facts.cosApproved} onClick={() => setVersion(2)}>
          Version 2 · Jan 24
        </Button>
      </div>
      <Card title="Requested vs. utility-issued">
        <table className="w-full text-sm" data-testid="uci-demo-cos-table">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="pb-2 font-medium">Field</th>
              <th className="pb-2 font-medium">Requested</th>
              <th className="pb-2 font-medium">Version {activeVersion}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([field, requested, value]) => {
              const mismatch = requested !== value;
              return (
                <tr key={field} className={cn("border-t border-border/50", mismatch && "bg-amber-500/10")}>
                  <td className="py-1.5">{field}</td>
                  <td className="py-1.5">{requested}</td>
                  <td className={cn("py-1.5 font-medium", mismatch ? "text-amber-700 dark:text-amber-300" : "text-foreground")}>
                    {value}
                    {mismatch ? " · discrepancy" : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-foreground">
          {activeVersion === 1
            ? "UCI flagged the undersized service and drafted a reply with the verified 410 kVA load calculation."
            : "Revised Class of Service matches the request and was approved by the coordinator."}
        </p>
      </Card>
    </div>
  );
}

function CiacCosts({ facts }: { facts: UciDemoFacts }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card title="CIAC reconciliation">
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted-foreground">Estimate</dt>
          <dd className="font-data">{facts.ciacEstimated ? "$12,500" : "—"}</dd>
          <dt className="text-muted-foreground">Utility invoice</dt>
          <dd className="font-data">{facts.ciacActual ? "$12,000" : "Pending"}</dd>
          <dt className="text-muted-foreground">Variance</dt>
          <dd className={cn("font-data", facts.ciacActual && "text-success")}>{facts.ciacActual ? "−$500 (−4.0%)" : "—"}</dd>
        </dl>
      </Card>
      <Card title="Approval & billing">
        <ul className="space-y-2">
          <Step done={facts.ciacEstimated} label="Estimate recorded" />
          <Step done={facts.ciacActual} label="Invoice matched to estimate" />
          <Step done={facts.ciacApproved} label="Client approval" detail="Required before any payment" />
          <Step done={facts.ciacPaid} label="Payment recorded" detail="Simulated — no payment made" />
          <Step done={facts.ciacBilled} label="Client billed" />
        </ul>
      </Card>
    </div>
  );
}

function Equipment({ facts }: { facts: UciDemoFacts }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card title="500 kVA pad-mounted transformer" icon={<Truck className="h-4 w-4 text-teal" />}>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted-foreground">Status</dt>
          <dd className="font-medium">{facts.equipmentDelivered ? "Delivered" : facts.etaSlipped ? "Shipped" : "On order"}</dd>
          <dt className="text-muted-foreground">Original ETA</dt>
          <dd>Apr 10, 2026</dd>
          <dt className="text-muted-foreground">Current ETA</dt>
          <dd className={cn(facts.etaSlipped && "text-amber-700 dark:text-amber-300")}>{facts.etaSlipped ? "Apr 15, 2026 (+5 days)" : "Apr 10, 2026"}</dd>
          <dt className="text-muted-foreground">Energization risk</dt>
          <dd>{facts.etaSlipped ? "Absorbed — still before Apr 22 target" : "None"}</dd>
        </dl>
      </Card>
      <Card title="Check-in history">
        <ul className="space-y-2">
          <Step done={facts.equipmentOrdered} label="Order confirmed" detail="Jan 28 · ETA Apr 10" />
          <Step done={facts.etaSlipped} warn={facts.equipmentOrdered && !facts.etaSlipped} label="Weekly ETA check-ins" detail={facts.etaSlipped ? "Mar 30 · manufacturer delay, ETA Apr 15" : "Next automated check-in scheduled"} />
          <Step done={facts.equipmentDelivered} label="Delivered and set on pad" detail={facts.equipmentDelivered ? "Apr 15" : undefined} />
        </ul>
      </Card>
    </div>
  );
}

function PreEnergization({ facts }: { facts: UciDemoFacts }) {
  const items = [
    { done: facts.equipmentDelivered, label: "Transformer on site", detail: "Apr 15" },
    { done: facts.inspectionReleased, label: "Electrical inspection release", detail: "County inspection passed · Apr 20" },
    { done: facts.siteReady, label: "Site readiness confirmed", detail: "Service entrance and meter base ready" },
    { done: facts.meterScheduled, label: "Meter set scheduled", detail: "Crew requested for Apr 22" },
  ];
  const doneCount = items.filter((item) => item.done).length;
  return (
    <Card title={`Readiness checklist · ${doneCount} of ${items.length}`}>
      <div className="mb-3 h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-teal transition-all" style={{ width: `${(doneCount / items.length) * 100}%` }} />
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <Step key={item.label} {...item} />
        ))}
      </ul>
    </Card>
  );
}

function Closeout({ facts }: { facts: UciDemoFacts }) {
  const artifacts = [
    { done: facts.energized, label: "Utility energization confirmation", detail: "SEC-ENERGIZED-0422" },
    { done: facts.energized, label: "Final meter reading", detail: "Meter 88-1042" },
    { done: facts.closeoutComplete, label: "Commissioning sign-off", detail: "COMM-0422" },
    { done: facts.closeoutComplete, label: "Closeout package generated", detail: "Energization Closeout Package.pdf" },
  ];
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card title="Closeout evidence">
        <ul className="space-y-2">
          {artifacts.map((item) => (
            <Step key={item.label} {...item} />
          ))}
        </ul>
      </Card>
      <Card title="Project result">
        {facts.closeoutComplete ? (
          <div className="space-y-2 text-sm">
            <p className="flex items-center gap-2 font-semibold text-success">
              <Zap className="h-4 w-4" /> Energized on target — Apr 22, 2026
            </p>
            <p className="text-muted-foreground">
              107 days from coordination start to energization, with one Class of Service discrepancy and one
              equipment slip resolved along the way.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Closeout evidence is still being collected.</p>
        )}
      </Card>
    </div>
  );
}
