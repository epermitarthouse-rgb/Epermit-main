import {
  Archive, ArrowDown, Bot, Building2, CheckCheck, ClipboardCheck, FileCheck,
  FileSearch, Home, Layers, Loader, MapPin, Power, ShieldAlert,
  Signpost, Smartphone, Sparkles, Stethoscope,
} from "lucide-react";
import { cn } from "@/lib/utils";
const FlowDot = ({ className }: { className?: string }) => (
  <span className={cn("absolute -bottom-1 left-1/2 -translate-x-1/2 h-2 w-2 rounded-full bg-primary", className)} />
);

const TierHeader = ({ n, title }: { n: string; title: string }) => (
  <div className="mb-4 flex items-center gap-2">
    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted pilot-kicker text-primary">{n}</span>
    <h3 className="font-tight text-xl font-bold">{title}</h3>
  </div>
);

const FlowConnector = () => (
  <div className="relative flex h-8 items-center justify-center">
    <div className="h-full w-px border-l-2 border-dashed border-primary" />
    <ArrowDown className="absolute -bottom-1 h-4 w-4 text-primary" />
  </div>
);

const tier1 = [
  { icon: Home, title: "Home Hero", body: "Initial landing and value proposition." },
  { icon: Layers, title: "Service Pages", body: "Strategy, UCI, and PM details." },
  { icon: FileSearch, title: "Case Study", body: "Proven past performance metrics." },
  { icon: Sparkles, title: "Conversational Quote", body: "Lead capture & initial assessment.", highlight: true },
];

const tier2 = [
  { icon: Bot, title: "AI Feasibility Analyzer", body: "Initial automated viability check.", agent: true },
  { icon: FileSearch, title: "Site Investigation Report", body: "Deep dive data gathering (SIR).", tag: "Data Collection", tagTone: "info" as const },
  { icon: FileCheck, title: "Executive Summary", body: "Synthesized ESIR output.", tag: "Client Deliverable", tagTone: "accent" as const },
];

const tier3 = [
  { icon: Building2, label: "Building Permits" },
  { icon: Power, label: "Utility Coordination", active: true },
  { icon: Signpost, label: "Signage" },
  { icon: Stethoscope, label: "Health" },
  { icon: ShieldAlert, label: "Special Inspections" },
  { icon: MapPin, label: "Raze" },
  { icon: ClipboardCheck, label: "Final Inspections" },
  { icon: CheckCheck, label: "Closeout" },
];

const tier4 = [
  { icon: Smartphone, title: "Mobile Companion", body: "Field sync and on-site updates." },
  { icon: FileCheck, title: "Occupancy Cert", body: "Final certificate generation." },
  { icon: Archive, title: "Archiving", body: "Secure vault storage." },
  { icon: Loader, title: "Post-Mortem Loop", body: "Feeds intelligence back to agents.", agent: true },
];

const tagTones = {
  info: "bg-pilot-cyan/15 text-pilot-cyan",
  accent: "bg-pilot-teal/15 text-pilot-teal",
} as const;

const PlatformArchitecture = () => (
  <div className="space-y-6">
    <header>
      <div className="pilot-kicker text-primary">Internal Reference</div>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-foreground">
        Platform Architecture & User Flow Review
      </h1>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
        End-to-end system flow & architecture mapped across the project lifecycle — from public marketing surfaces to
        closeout intelligence.
      </p>
    </header>

    <div className="pilot-card relative overflow-x-auto p-6">
      {/* Intelligence layer rail */}
      <div className="pointer-events-none absolute inset-y-6 left-2 hidden w-12 flex-col items-center justify-center border-r border-dashed border-border opacity-50 lg:flex">
        <Bot className="h-24 w-24 rotate-90 text-primary/30" />
        <span className="mt-4 -rotate-90 whitespace-nowrap pilot-kicker text-muted-foreground">
          Agent Intelligence Layer
        </span>
      </div>

      <div className="space-y-2 lg:pl-20">
        {/* Tier 1 */}
        <section>
          <TierHeader n="01" title="Public Awareness (Marketing Site)" />
          <div className="grid gap-4 md:grid-cols-4">
            {tier1.map((c) => (
              <div
                key={c.title}
                className={cn(
                  "group relative overflow-hidden rounded-md border bg-muted/40 p-4 transition-shadow hover:shadow-md",
                  c.highlight ? "border-primary/40 shadow-[inset_0_0_15px_hsl(var(--primary)/0.05)]" : "border-border",
                )}
              >
                <c.icon className={cn("mb-2 h-5 w-5", c.highlight ? "text-primary" : "text-muted-foreground")} />
                <h4 className="font-tight text-base font-bold">{c.title}</h4>
                <p className="mt-1 text-xs text-muted-foreground">{c.body}</p>
                {c.highlight && <FlowDot />}
              </div>
            ))}
          </div>
        </section>

        <FlowConnector />

        {/* Tier 2 */}
        <section>
          <TierHeader n="02" title="Strategic Initiation (Phase 0)" />
          <div className="grid gap-4 rounded-md border border-border bg-muted/30 p-4 md:grid-cols-3">
            {tier2.map((c) => (
              <div key={c.title} className="relative rounded-md border border-border bg-background p-4 shadow-sm">
                {c.agent && <Bot className="absolute right-3 top-3 h-8 w-8 text-primary/20" />}
                <c.icon className="mb-2 h-5 w-5 text-muted-foreground" />
                <h4 className="font-tight text-base font-bold">{c.title}</h4>
                <p className="mt-1 text-xs text-muted-foreground">{c.body}</p>
                {c.tag && (
                  <span className={cn("mt-3 inline-flex rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", tagTones[c.tagTone!])}>
                    {c.tag}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>

        <FlowConnector />

        {/* Tier 3 */}
        <section>
          <TierHeader n="03" title="Technical Mission Control (Unified Matrix)" />
          <div className="rounded-lg border border-border bg-muted/30 p-5">
            <div className="grid gap-2 md:grid-cols-4">
              {tier3.map((t) => (
                <div
                  key={t.label}
                  className={cn(
                    "flex items-center gap-2 rounded border bg-background p-2.5",
                    t.active ? "border-primary/40 shadow-[inset_4px_0_0_hsl(var(--primary))]" : "border-border",
                  )}
                >
                  <t.icon className={cn("h-4 w-4", t.active ? "text-primary" : "text-muted-foreground")} />
                  <span className="font-data text-sm">{t.label}</span>
                </div>
              ))}
            </div>
            <div className="relative mt-6 flex h-px items-center justify-between bg-primary/30 px-12">
              {[0, 1, 2].map((i) => (
                <span key={i} className="h-3 w-3 rounded-full bg-primary ring-4 ring-background" />
              ))}
            </div>
            <div className="mt-2 flex justify-between px-12 pilot-kicker text-muted-foreground">
              <span>SIR Data Input</span>
              <span>Matrix Sync</span>
              <span>Final CO Logic</span>
            </div>
          </div>
        </section>

        <FlowConnector />

        {/* Tier 4 */}
        <section>
          <TierHeader n="04" title="Field & Conclusion" />
          <div className="grid gap-4 md:grid-cols-4">
            {tier4.map((c) => (
              <div
                key={c.title}
                className={cn(
                  "relative rounded-md border bg-background p-4 shadow-sm",
                  c.agent ? "border-primary/40 bg-muted/40" : "border-border",
                )}
              >
                {c.agent && <Bot className="absolute right-3 top-3 h-8 w-8 text-primary/20" />}
                <c.icon className={cn("mb-2 h-5 w-5", c.agent ? "text-primary" : "text-pilot-cyan")} />
                <h4 className="font-tight text-base font-bold">{c.title}</h4>
                <p className="mt-1 text-xs text-muted-foreground">{c.body}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  </div>
);

export default PlatformArchitecture;