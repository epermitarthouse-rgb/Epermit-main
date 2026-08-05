import { Check, ChevronRight, FileCheck2, FolderUp, RadioTower, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { AlertBanner, MetricCard, Panel, ServicePill, StatusPill } from "@/components/permitpilot/ProductPrimitives";

const phases = [
  { name: "Intake QC", done: true, summary: "County packet matched and required forms mapped." },
  { name: "Submission package", done: true, summary: "Plan set locked to v7 and attachments normalized." },
  { name: "Plan review completeness", current: true, summary: "Operator resolving jurisdiction comments before resubmittal." },
  { name: "County routing", summary: "Waiting on fire marshal and structural peer routing." },
  { name: "Utility readiness", summary: "Permit issuance still depends on utility release milestones." },
  { name: "Approval & issuance", summary: "Final permit record and downstream inspection scheduling." },
];

const steps = [
  { title: "Validate completeness against county packet", owner: "Permit expediting", done: true },
  { title: "Upload signed VE letter", owner: "Permit expediting", active: true },
  { title: "Submit smoke control narrative", owner: "Permit expediting" },
  { title: "Confirm Dominion service readiness", owner: "Utility coordination" },
  { title: "Prepare response package export", owner: "Permit expediting" },
];

const GuidedFlow = () => (
  <div className="space-y-6">
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <div className="pilot-kicker text-primary">Permit Filing</div>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-foreground">Phase 2 · Filing workflow</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          A working operator lane for permit expediting with utility coordination dependencies surfaced in the same flow.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <ServicePill service="permit-expediting" />
        <ServicePill service="utility-coordination" />
      </div>
    </header>

    <div className="grid gap-4 md:grid-cols-4">
      <MetricCard label="Plan review completeness" value="72%" detail="Ballston residential tower envelope" />
      <MetricCard label="Open IFC comments" value="128" detail="-12 after auto-classify sweep" icon={FileCheck2} />
      <MetricCard label="AI draft coverage" value="94%" detail="Eligible jurisdictions only" icon={Sparkles} />
      <MetricCard label="Utility dependencies" value="2" detail="Permit issuance blockers still open" icon={RadioTower} />
    </div>

    <AlertBanner
      tone="warn"
      title="Fire marshal routing is delaying the county response cycle"
      detail="Holiday staffing adds +2 days to the SLA. The signed VE letter is still the gating item for a clean resubmittal."
    />

    <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
      <aside className="pilot-card p-5">
        <h2 className="pilot-kicker mb-4">Workflow stages</h2>
        <ol className="space-y-4">
          {phases.map((phase, index) => (
            <li key={phase.name} className="flex gap-3">
              <div
                className={cn(
                  "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[10px] font-data font-bold",
                  phase.done ? "border-success bg-success/20 text-success" : phase.current ? "border-primary bg-primary/20 text-primary" : "border-border bg-muted text-muted-foreground",
                )}
              >
                {phase.done ? <Check className="h-3.5 w-3.5" /> : index + 1}
              </div>
              <div>
                <div className={cn("text-sm", phase.current ? "font-bold text-foreground" : "text-foreground/80")}>{phase.name}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{phase.summary}</div>
              </div>
            </li>
          ))}
        </ol>
      </aside>

      <section className="space-y-4">
        <Panel title="Outstanding tasks" eyebrow="Operator queue">
          <div className="grid gap-3">
            {steps.map((step) => (
              <div key={step.title} className={cn("flex flex-wrap items-center gap-3 rounded-lg border border-border px-4 py-3", step.active && "border-primary bg-primary/5")}>
                <span className={cn("flex h-7 w-7 items-center justify-center rounded-full border", step.done ? "border-success bg-success/20 text-success" : step.active ? "border-primary text-primary" : "border-border text-muted-foreground")}>
                  {step.done ? <Check className="h-3.5 w-3.5" /> : <span className="block h-1.5 w-1.5 rounded-full bg-current" />}
                </span>
                <div className="min-w-[220px] flex-1">
                  <div className={cn("text-sm font-medium", step.done && "text-muted-foreground line-through")}>{step.title}</div>
                  <div className="mt-1">
                    <ServicePill service={step.owner === "Permit expediting" ? "permit-expediting" : "utility-coordination"} />
                  </div>
                </div>
                <StatusPill tone={step.done ? "good" : step.active ? "warn" : "default"}>{step.done ? "Done" : step.active ? "In flight" : "Queued"}</StatusPill>
                <button className={step.active ? "pilot-button-primary" : "pilot-button-ghost"}>
                  {step.active ? "Run task" : "Open"} <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </Panel>

        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <Panel title="AI operator guidance" eyebrow="Co-pilot">
            <p className="text-sm leading-6 text-muted-foreground">
              The county packet is matched, but the VE letter remains unsigned. If you upload the signed PDF now, I can refresh the completeness check, regenerate the response package, and queue the resubmittal export.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="pilot-button-primary"><FolderUp className="h-4 w-4" /> Upload signed letter</button>
              <button className="pilot-button-ghost">Review response drawer</button>
            </div>
          </Panel>

          <Panel title="Cross-service dependencies" eyebrow="Utility impact">
            <div className="space-y-3">
              <Dependency title="Dominion release check" state="Awaiting utility confirmation before permit issuance package is final." tone="warn" />
              <Dependency title="Meter-set sequencing" state="No impact yet, but must be locked before final approval window." tone="default" />
              <Dependency title="Provider account package" state="All provider documents are current for this filing cycle." tone="good" />
            </div>
          </Panel>
        </div>
      </section>
    </div>
  </div>
);

const Dependency = ({ title, state, tone }: { title: string; state: string; tone: "good" | "warn" | "default" }) => (
  <div className="rounded-lg border border-border bg-muted/20 p-4">
    <div className="flex items-center justify-between gap-3">
      <div className="text-sm font-medium text-foreground">{title}</div>
      <StatusPill tone={tone === "good" ? "good" : tone === "warn" ? "warn" : "default"}>{tone === "good" ? "Clear" : tone === "warn" ? "Watching" : "Pending"}</StatusPill>
    </div>
    <p className="mt-2 text-xs leading-5 text-muted-foreground">{state}</p>
  </div>
);

export default GuidedFlow;