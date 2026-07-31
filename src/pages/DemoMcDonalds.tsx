import { Link } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  Bot,
  Cable,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Cpu,
  DollarSign,
  FileCheck2,
  FileSearch,
  FileSignature,
  GitBranch,
  Layers,
  MapPin,
  PlayCircle,
  Radio,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  Users,
  Workflow,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import mcdLogo from "@/assets/mcdonalds-logo.png";
import GuidedTour, { type TourStep } from "@/components/permitpilot/GuidedTour";
import { DemoDataBadge } from "@/components/permitpilot/DemoDataBadge";

/** Routes that exist in PermitPilot today — wire real CTAs only for these. */
const LIVE_ROUTES = new Set([
  "/onboarding/authorization",
  "/contact",
  "/demos",
  "/dashboard",
  "/uci",
]);

const tourSteps: TourStep[] = [
  {
    target: "hero",
    title: "The one-slide thesis",
    body: "Start here. Legacy permit + utility clock is 9–13 weeks. PermitPilot compresses it to under 4 by running the whole board with AI. These four stats are the deck.",
  },
  {
    target: "problem",
    title: "Where the weeks actually go",
    body: "Before showing the fix, ground the audience in the four failure modes every McDonald's rebuild hits. If they nod, they'll believe the rest.",
  },
  {
    target: "timeline",
    title: "One store · head-to-head",
    body: "This is the money bar. Same site, same AHJ, same scope — legacy vs PermitPilot. Point to the three deltas below the bars: elapsed weeks, rework loops, first-pass approval.",
  },
  {
    target: "agents",
    title: "Eight agents, three lanes",
    body: "Explain the loop: Detection senses change, Reasoning decides, Action moves. Every agent has a job and a lane — nobody's a black box.",
    cta: {
      label: "Open live AI workflow",
      to: "/matrix/ai-workflow?tenant=mcd",
      upcoming: true,
    },
  },
  {
    target: "utility",
    title: "Utility coordination — the killer app",
    body: "Walk the Leesburg ticket board. Five utilities, cleared in 11 days in parallel vs 34 sequential. This is the piece other expediters can't do.",
    cta: {
      label: "Open Conflict Hunter",
      to: "/utility/conflict-hunter?tenant=mcd",
      upcoming: true,
    },
  },
  {
    target: "portfolio",
    title: "12 stores · one board",
    body: "Zoom into two rows: one green (in review, elapsed < 24 days) and one amber (utility hold). Show how the same executive view scales portfolio-wide.",
    cta: {
      label: "Open executive portfolio",
      to: "/portfolio/executive?tenant=mcd",
      upcoming: true,
    },
  },
  {
    target: "roi",
    title: "The dollar line",
    body: "39 days sooner, $118k per store carrying cost avoided, 0.7 FTE reclaimed. Multiply by store count on the whiteboard — the math writes itself.",
  },
  {
    target: "rollout",
    title: "Four-week engagement plan",
    body: "Anchor the ask. Week 1 ingest, Week 2 baseline, Week 3 live, Week 4+ expand. No IT lift, no vendor swap.",
  },
  {
    target: "cta",
    title: "Land the ask",
    body: "One click: sign the Letter of Authorization. That's the entire close. Schedule the walkthrough as the backup.",
    cta: { label: "Open the LOA", to: "/onboarding/authorization?tenant=mcd" },
  },
];

// ---------- Data (illustrative only — see docs/data-provenance.md) ----------

const heroStats = [
  { value: "9–13 wk", label: "Legacy permit cycle", tone: "muted" as const, sub: "GC + expediter + AHJ email loops" },
  { value: "3–4 wk", label: "PermitPilot target cycle", tone: "primary" as const, sub: "AI-orchestrated, portal-native" },
  { value: "72%", label: "Median cycle-time reduction", tone: "primary" as const, sub: "Illustrative · East Coast rebuild model" },
  { value: "90%", label: "Fewer rework loops", tone: "primary" as const, sub: "DesignCheck catches comments pre-submittal" },
];

const painPoints = [
  {
    icon: Clock,
    title: "Sequential AHJ + utility hand-offs",
    body: "Civil sits on gas. Gas waits on electric. Electric waits on the county. Every idle week compounds into a delayed opening.",
  },
  {
    icon: FileSearch,
    title: "Comment reconciliation by hand",
    body: "PDF comment letters get retyped into trackers. Half the comments are duplicates of comments from three revisions ago.",
  },
  {
    icon: Radio,
    title: "Portal blindness",
    body: "50+ jurisdictions, dozens of UI patterns, one team refreshing tabs. Status changes get discovered days late.",
  },
  {
    icon: Cable,
    title: "Utility coordination in silos",
    body: "Load letters, easement requests, meter-set scheduling — each utility runs its own workflow with no shared truth.",
  },
];

const agents = [
  { icon: FileSearch, name: "DesignCheck OCR", lane: "Detection", body: "Scans every drawing revision against the AHJ code base and prior comment history." },
  { icon: Radio, name: "Portal Monitor", lane: "Detection", body: "Polls 50+ jurisdictional portals on a 15-minute cadence, diffs status + comments." },
  { icon: Cable, name: "Utility Response Watch", lane: "Detection", body: "Tracks Dominion, Washington Gas, Loudoun Water, Fairfax DPWES ticket state changes." },
  { icon: GitBranch, name: "Comment Reconciler", lane: "Reasoning", body: "Clusters duplicate comments across reviewers and links each to a sheet + spec section." },
  { icon: Cpu, name: "Critical Path Recompute", lane: "Reasoning", body: "Rebuilds the schedule the moment any AHJ, utility, or inspector event lands." },
  { icon: ShieldCheck, name: "Code Compliance", lane: "Reasoning", body: "Runs IBC/IFC + local amendments against live sheet set, flags 8 risk classes." },
  { icon: FileCheck2, name: "Submittal Stager", lane: "Action", body: "Assembles corrected packages, indexes exhibits, and files back to each portal." },
  { icon: ClipboardCheck, name: "Deadline Enforcement", lane: "Action", body: "Escalates any permit within 7 days of a lapsed clock to the tenant PM + AHJ contact." },
];

const laneMeta: Record<string, { icon: typeof Activity; tone: string }> = {
  Detection: { icon: Activity, tone: "text-pilot-cyan" },
  Reasoning: { icon: Cpu, tone: "text-pilot-teal" },
  Action: { icon: Zap, tone: "text-primary" },
};

type WeekPhase = { label: string; weeks: number; kind: "legacy" | "pilot" | "gap" };
const legacyTrack: WeekPhase[] = [
  { label: "Prescreen", weeks: 2, kind: "legacy" },
  { label: "1st Submittal", weeks: 3, kind: "legacy" },
  { label: "AHJ Review", weeks: 4, kind: "legacy" },
  { label: "Resubmittal", weeks: 2, kind: "legacy" },
  { label: "Final Approval", weeks: 2, kind: "legacy" },
];
const pilotTrack: WeekPhase[] = [
  { label: "AI Prescreen", weeks: 0.5, kind: "pilot" },
  { label: "1st Submittal", weeks: 1, kind: "pilot" },
  { label: "AHJ Review + Live Response", weeks: 1.5, kind: "pilot" },
  { label: "Auto-Resubmit", weeks: 0.5, kind: "pilot" },
  { label: "Final Approval", weeks: 0.5, kind: "pilot" },
];

const projects = [
  { id: "MCD-231", loc: "Leesburg, VA", ahj: "Loudoun County", status: "In review", cycle: "22 days", risk: "green" },
  { id: "MCD-244", loc: "Ashburn, VA", ahj: "Loudoun County", status: "Corrections", cycle: "18 days", risk: "amber" },
  { id: "MCD-259", loc: "Reston, VA", ahj: "Fairfax DPWES", status: "Approved", cycle: "24 days", risk: "green" },
  { id: "MCD-262", loc: "Chantilly, VA", ahj: "Fairfax DPWES", status: "In review", cycle: "16 days", risk: "green" },
  { id: "MCD-271", loc: "Sterling, VA", ahj: "Loudoun County", status: "Utility hold", cycle: "31 days", risk: "amber" },
  { id: "MCD-284", loc: "Fredericksburg, VA", ahj: "Spotsylvania Co.", status: "In review", cycle: "20 days", risk: "green" },
  { id: "MCD-291", loc: "Bethesda, MD", ahj: "Montgomery Co.", status: "Corrections", cycle: "27 days", risk: "amber" },
  { id: "MCD-303", loc: "Rockville, MD", ahj: "Montgomery Co.", status: "Approved", cycle: "23 days", risk: "green" },
  { id: "MCD-311", loc: "Annapolis, MD", ahj: "Anne Arundel Co.", status: "In review", cycle: "19 days", risk: "green" },
  { id: "MCD-318", loc: "Wilmington, DE", ahj: "New Castle Co.", status: "In review", cycle: "21 days", risk: "green" },
  { id: "MCD-322", loc: "Philadelphia, PA", ahj: "Phila. L&I", status: "Prescreen", cycle: "9 days", risk: "green" },
  { id: "MCD-329", loc: "Camden, NJ", ahj: "Camden City", status: "Prescreen", cycle: "6 days", risk: "green" },
];

const utilityCase = [
  { u: "Dominion Energy", ticket: "DE-88291", status: "Load letter cleared", days: 4, tone: "text-success" },
  { u: "Washington Gas", ticket: "WG-40128", status: "Meter set staged", days: 6, tone: "text-success" },
  { u: "Loudoun Water", ticket: "LW-11902", status: "Tap fee acknowledged", days: 3, tone: "text-success" },
  { u: "Verizon FiOS", ticket: "VZ-77501", status: "Backhaul confirmed", days: 2, tone: "text-success" },
  { u: "Loudoun DPW", ticket: "DPW-9902", status: "ROW permit issued", days: 5, tone: "text-success" },
];

const roi = [
  { icon: TrendingDown, kicker: "Time-to-open", value: "39 days", sub: "sooner per store · illustrative model" },
  { icon: DollarSign, kicker: "Carrying cost", value: "$118k", sub: "illustrative per store · financing + soft costs" },
  { icon: Users, kicker: "GC + expediter", value: "0.7 FTE", sub: "illustrative reclaim per active rebuild" },
  { icon: Sparkles, kicker: "First-pass rate", value: "84%", sub: "illustrative first-pass acceptance rate" },
];

const rollout = [
  { title: "Week 1 · Portfolio ingest", body: "12 East Coast rebuild sites onboarded. Portal credentials, AHJ contacts, and prior drawing sets pulled in." },
  { title: "Week 2 · Baseline", body: "AI runs against the last 24 completed permits. Comment library is fingerprinted. Baseline cycle times published." },
  { title: "Week 3 · Live orchestration", body: "Agents go live on all new submittals. Weekly executive digest to the McDonald's East Coast construction team." },
  { title: "Week 4+ · Expand", body: "Add utility coordination lane per site. Roll into Mid-Atlantic. Portfolio-wide DesignCheck learning loop turns on." },
];

const StatCard = ({ value, label, tone, sub }: (typeof heroStats)[number]) => (
  <div className="pilot-card bg-background/60 p-4 backdrop-blur">
    <div
      className={cn(
        "font-data text-2xl font-semibold md:text-3xl",
        tone === "primary" ? "text-primary" : "text-foreground",
      )}
    >
      {value}
    </div>
    <div className="pilot-kicker mt-2">{label}</div>
    <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
  </div>
);

const SectionKicker = ({ children }: { children: React.ReactNode }) => (
  <div className="pilot-kicker text-primary">{children}</div>
);

const riskDot = (r: string) =>
  r === "green" ? "bg-success" : r === "amber" ? "bg-warning" : "bg-destructive";

/** Exact package disclosure banner — top of page only, scrolls away (not sticky). */
const DemoRouteBanner = () => (
  <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-accent/30 bg-accent/5 px-3 py-2">
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <DemoDataBadge />
      <p className="text-xs leading-5 text-muted-foreground">
        Content on this page is illustrative for demonstration. See docs/data-provenance.md for the
        full audit.
      </p>
    </div>
  </div>
);

/**
 * Internal-only / brand-clearance marker. Copy from package README §7 recommended notice draft.
 * Brand/legal clearance is still missing — do not treat as public-ready.
 */
const InternalUnapprovedBanner = () => (
  <div
    role="status"
    className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-5 text-foreground"
  >
    <span className="font-semibold uppercase tracking-wide text-warning">
      Internal only · unapproved for public use
    </span>
    <p className="mt-1 text-muted-foreground">
      Concept demonstration. Not affiliated with, endorsed by, or sponsored by McDonald&apos;s
      Corporation. McDonald&apos;s and the Golden Arches logo are trademarks of McDonald&apos;s
      Corporation, used here for identification only. All project data, cycle times, and financial
      figures shown are illustrative and do not represent actual McDonald&apos;s projects or results.
      Brand clearance is not confirmed — keep private until written approval exists.
    </p>
  </div>
);

const DemoNavLink = ({
  to,
  className,
  children,
}: {
  to: string;
  className?: string;
  children: React.ReactNode;
}) => {
  const { toast } = useToast();
  const path = to.split("?")[0];
  const isLive = LIVE_ROUTES.has(path);

  if (isLive) {
    return (
      <Link to={to} className={className}>
        {children}
      </Link>
    );
  }

  return (
    <button
      type="button"
      className={cn(className, "text-left")}
      onClick={() =>
        toast({
          title: "Upcoming",
          description: `${path} is not connected in PermitPilot yet.`,
        })
      }
    >
      {children}
      <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
        Upcoming
      </span>
    </button>
  );
};

const DemoMcDonalds = () => {
  const legacyTotal = legacyTrack.reduce((a, b) => a + b.weeks, 0);
  const pilotTotal = pilotTrack.reduce((a, b) => a + b.weeks, 0);

  return (
    <div className="container-page space-y-14 pb-20">
      <div className="space-y-0">
        <DemoRouteBanner />
        <InternalUnapprovedBanner />
      </div>

      {/* HERO */}
      <section data-tour="hero" className="relative overflow-hidden rounded-2xl border border-border">
        <div className="absolute inset-0 bg-gradient-to-br from-[hsl(var(--pilot-ink))] via-background to-background/80" />
        <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute -bottom-24 -left-24 h-80 w-80 rounded-full bg-pilot-teal/20 blur-3xl" />
        <div className="relative z-10 grid gap-10 px-6 py-12 md:px-12 md:py-16 lg:grid-cols-[1.35fr_1fr] lg:items-center">
          <div className="max-w-2xl">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-md bg-[#FFC72C] p-1">
                <img
                  src={mcdLogo}
                  alt="McDonald's"
                  width={36}
                  height={36}
                  className="h-8 w-8 object-contain"
                />
              </span>
              <div>
                <SectionKicker>Executive Demo · July 2026</SectionKicker>
                <div className="mt-0.5 font-tight text-sm font-semibold text-muted-foreground">
                  McDonald&apos;s East Coast Rebuild Program · Commun-ET / PermitPilot
                </div>
              </div>
            </div>
            <h1 className="mt-6 font-tight text-4xl font-black leading-[1.05] tracking-tight md:text-6xl">
              Cutting the permit + utility clock from{" "}
              <span className="text-muted-foreground line-through decoration-primary/60">13 weeks</span>{" "}
              to <span className="text-primary">under 4</span>.
            </h1>
            <p className="mt-5 text-base leading-7 text-muted-foreground md:text-lg">
              Eight coordinated AI agents run the permit and utility lanes in parallel — reconciling
              comments, harvesting portals, and pre-clearing drawings the moment a set uploads. What
              the field team feels: openings unlocked weeks earlier, per store, at scale.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <DemoNavLink to="/portfolio/executive?tenant=mcd" className="pilot-button-primary">
                Enter live portfolio <ArrowRight className="h-4 w-4" />
              </DemoNavLink>
              <DemoNavLink to="/matrix/ai-workflow" className="pilot-button-ghost">
                See the AI workflow lanes
              </DemoNavLink>
              <Link to="/demos" className="pilot-button-ghost">
                <PlayCircle className="h-4 w-4" /> Explore Interactive Demo
              </Link>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {heroStats.map((s) => (
              <StatCard key={s.label} {...s} />
            ))}
          </div>
        </div>
      </section>

      {/* PROBLEM */}
      <section data-tour="problem" className="grid gap-6 lg:grid-cols-[1fr_1.6fr] lg:items-start">
        <div>
          <SectionKicker>The status quo</SectionKicker>
          <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight md:text-4xl">
            Where 9–13 weeks actually go.
          </h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Every legacy rebuild loses the same weeks in the same places. Permit expediters chase
            portals, utilities respond in sequence, and comment letters arrive as PDFs that nobody
            has time to reconcile against the previous revision.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {painPoints.map((p) => (
            <div key={p.title} className="pilot-card p-4">
              <div className="flex items-center gap-2">
                <p.icon className="h-4 w-4 text-pilot-rose" />
                <div className="font-tight text-sm font-bold uppercase tracking-wide">{p.title}</div>
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* HEAD TO HEAD TIMELINE */}
      <section data-tour="timeline" className="pilot-card overflow-hidden">
        <header className="flex flex-col gap-1 border-b border-border bg-muted/30 px-6 py-4 md:flex-row md:items-end md:justify-between">
          <div>
            <SectionKicker>Head-to-head cycle</SectionKicker>
            <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight md:text-3xl">
              One McDonald&apos;s store · legacy vs PermitPilot.
            </h2>
          </div>
          <div className="pilot-kicker text-muted-foreground">Scale: 1 cell ≈ ½ week</div>
        </header>
        <div className="space-y-5 px-6 py-6">
          <TimelineRow label="Legacy expediter" total={legacyTotal} phases={legacyTrack} accent="bg-muted-foreground/60" />
          <TimelineRow label="PermitPilot" total={pilotTotal} phases={pilotTrack} accent="bg-primary" highlight />
          <div className="grid gap-3 border-t border-border pt-5 md:grid-cols-3">
            <Delta
              icon={Clock}
              kicker="Elapsed"
              value={`${legacyTotal - pilotTotal} weeks saved`}
              sub={`${legacyTotal} wk → ${pilotTotal} wk end-to-end`}
            />
            <Delta
              icon={ClipboardCheck}
              kicker="Rework loops"
              value="1 → 0.2 avg"
              sub="DesignCheck resolves comments pre-file"
            />
            <Delta
              icon={CheckCircle2}
              kicker="First-pass approval"
              value="34% → 84%"
              sub="Illustrative 12-store East Coast model"
            />
          </div>
        </div>
      </section>

      {/* AI AGENT ORCHESTRATION */}
      <section data-tour="agents">
        <div className="mb-6 flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
          <div>
            <SectionKicker>How it works</SectionKicker>
            <h2 className="mt-1 font-display text-3xl font-semibold tracking-tight md:text-4xl">
              Eight agents. Three lanes. One live picture.
            </h2>
          </div>
          <div className="text-sm text-muted-foreground">
            Detect change → reason about impact → take the next action, without waiting on a human
            hop.
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {(["Detection", "Reasoning", "Action"] as const).map((lane) => {
            const Meta = laneMeta[lane];
            return (
              <div key={lane} className="pilot-card p-5">
                <div className="mb-3 flex items-center gap-2">
                  <Meta.icon className={cn("h-5 w-5", Meta.tone)} />
                  <h3 className="font-tight text-lg font-bold">{lane}</h3>
                </div>
                <ul className="space-y-2">
                  {agents
                    .filter((a) => a.lane === lane)
                    .map((a) => (
                      <li key={a.name} className="rounded border border-border bg-muted/30 p-3">
                        <div className="flex items-center gap-2">
                          <a.icon className="h-4 w-4 text-primary" />
                          <div className="font-tight text-sm font-bold">{a.name}</div>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">{a.body}</p>
                      </li>
                    ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      {/* UTILITY COORDINATION */}
      <section data-tour="utility" className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <div className="pilot-card overflow-hidden">
          <header className="flex items-center justify-between gap-2 border-b border-border bg-muted/30 px-5 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <Cable className="h-4 w-4 shrink-0 text-primary" />
              <h3 className="truncate font-tight text-base font-bold">
                MCD-231 · Leesburg VA · utility coordination
              </h3>
            </div>
            <span className="pilot-kicker shrink-0 text-success">
              All utilities cleared · 11 calendar days
            </span>
          </header>
          <ul className="divide-y divide-border">
            {utilityCase.map((u) => (
              <li key={u.ticket} className="flex items-center gap-3 px-5 py-3 text-sm">
                <span className="h-2 w-2 rounded-full bg-success" />
                <span className="w-40 font-medium">{u.u}</span>
                <span className="font-data text-xs text-muted-foreground">{u.ticket}</span>
                <span className={cn("flex-1", u.tone)}>{u.status}</span>
                <span className="font-data text-xs text-muted-foreground">{u.days}d</span>
              </li>
            ))}
          </ul>
          <div className="border-t border-border bg-muted/20 px-5 py-3 text-xs leading-5 text-muted-foreground">
            Legacy sequential path for the same store:{" "}
            <span className="font-data text-foreground">34 days</span> across five utilities.
            PermitPilot runs them in parallel with a shared ticket state so civil, gas, and electric
            never block each other.
          </div>
        </div>

        <div className="pilot-card p-5">
          <SectionKicker>Why utility coordination is the killer app</SectionKicker>
          <h3 className="mt-2 font-display text-2xl font-semibold tracking-tight">
            The permit clears, then the utility clock starts. We collapse both into one.
          </h3>
          <ul className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground">
            <li className="flex gap-3">
              <Layers className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>
                <span className="font-semibold text-foreground">Single ticket surface</span> across
                Dominion, Washington Gas, Loudoun Water, Verizon, and county DPW.
              </span>
            </li>
            <li className="flex gap-3">
              <Workflow className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>
                <span className="font-semibold text-foreground">Parallel run</span> — load letters,
                easements, and meter-set scheduling all move at once, not one after another.
              </span>
            </li>
            <li className="flex gap-3">
              <Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>
                <span className="font-semibold text-foreground">Response watcher</span> notifies the
                site PM the moment a utility ticket flips state — no more Monday-morning phone tag.
              </span>
            </li>
            <li className="flex gap-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>
                <span className="font-semibold text-foreground">Conflict hunter</span> catches gas /
                electric / civil ROW conflicts before a locate request is even filed.
              </span>
            </li>
          </ul>
          <DemoNavLink
            to="/utility/conflict-hunter?tenant=mcd"
            className="pilot-button-ghost mt-6"
          >
            Open Cross-Utility Conflict Hunter <ArrowRight className="h-4 w-4" />
          </DemoNavLink>
        </div>
      </section>

      {/* PORTFOLIO SNAPSHOT */}
      <section data-tour="portfolio" className="pilot-card overflow-hidden">
        <header className="flex flex-col gap-2 border-b border-border bg-muted/30 px-6 py-4 md:flex-row md:items-end md:justify-between">
          <div>
            <SectionKicker>Live portfolio</SectionKicker>
            <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight md:text-3xl">
              12 East Coast rebuilds · 8 jurisdictions · one board.
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-success" /> On track
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-warning" /> Watch
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-destructive" /> Escalate
            </span>
          </div>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/20 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-6 py-3 text-left font-medium">Site</th>
                <th className="px-4 py-3 text-left font-medium">Location</th>
                <th className="px-4 py-3 text-left font-medium">AHJ</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Elapsed</th>
                <th className="px-6 py-3 text-right font-medium">Risk</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {projects.map((p) => (
                <tr key={p.id} className="hover:bg-muted/20">
                  <td className="px-6 py-3 font-data text-xs">{p.id}</td>
                  <td className="px-4 py-3 font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                      {p.loc}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{p.ahj}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs">
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-data text-xs">{p.cycle}</td>
                  <td className="px-6 py-3 text-right">
                    <span
                      className={cn("ml-auto inline-block h-2.5 w-2.5 rounded-full", riskDot(p.risk))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ROI — restate disclosure near high-risk figures (package recommendation) */}
      <section data-tour="roi">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <SectionKicker>What it&apos;s worth</SectionKicker>
            <h2 className="mt-1 font-display text-3xl font-semibold tracking-tight md:text-4xl">
              Per-store impact, illustrative.
            </h2>
          </div>
          <DemoDataBadge />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {roi.map((r) => (
            <div key={r.kicker} className="pilot-card p-5">
              <r.icon className="h-5 w-5 text-primary" />
              <div className="pilot-kicker mt-4">{r.kicker}</div>
              <div className="mt-1 font-data text-3xl font-semibold text-foreground">{r.value}</div>
              <div className="mt-1 text-xs text-muted-foreground">{r.sub}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ROLLOUT */}
      <section data-tour="rollout" className="pilot-card p-6 md:p-8">
        <SectionKicker>Engagement plan</SectionKicker>
        <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight md:text-4xl">
          From kickoff to live portfolio in four weeks.
        </h2>
        <ol className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {rollout.map((r, i) => (
            <li key={r.title} className="pilot-card-raised relative overflow-hidden p-5">
              <span className="absolute -right-2 -top-4 select-none font-display text-6xl font-bold text-primary/10">
                {i + 1}
              </span>
              <div className="relative">
                <div className="font-tight text-sm font-bold uppercase tracking-wide text-primary">
                  {r.title}
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{r.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* CTA */}
      <section
        data-tour="cta"
        className="pilot-card relative overflow-hidden bg-gradient-to-br from-primary/10 via-background to-pilot-teal/10 p-8 md:p-12"
      >
        <div className="relative grid gap-6 md:grid-cols-[1.4fr_1fr] md:items-center">
          <div>
            <SectionKicker>Ready when you are</SectionKicker>
            <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight md:text-4xl">
              Every week we start earlier is a week of stores open earlier.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">
              Give us the twelve East Coast rebuild sites currently in queue and portal credentials.
              We&apos;ll return baseline cycle times and the first AI-orchestrated submittal inside two
              weeks.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <Link
              to="/onboarding/authorization?tenant=mcd"
              className="pilot-button-primary justify-center"
            >
              <FileSignature className="h-4 w-4" /> Sign Letter of Authorization
            </Link>
            <Link to="/contact" className="pilot-button-ghost justify-center">
              <Calendar className="h-4 w-4" /> Schedule live walkthrough
            </Link>
            <Link to="/demos" className="pilot-button-ghost justify-center">
              <PlayCircle className="h-4 w-4" /> Explore Interactive Demo
            </Link>
            <div className="pilot-kicker mt-2 text-center text-muted-foreground">
              Commun-ET, LLC · PermitPilot for McDonald&apos;s East Coast
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-border pt-6 text-xs leading-5 text-muted-foreground">
        <p>
          Concept demonstration. Not affiliated with, endorsed by, or sponsored by McDonald&apos;s
          Corporation. McDonald&apos;s and the Golden Arches logo are trademarks of McDonald&apos;s
          Corporation, used here for identification only. All project data, cycle times, and financial
          figures shown are illustrative and do not represent actual McDonald&apos;s projects or
          results.
        </p>
        <p className="mt-2 font-semibold uppercase tracking-wide text-warning">
          Internal only · brand clearance not confirmed
        </p>
      </footer>

      <GuidedTour steps={tourSteps} autoStart launcherLabel="Guided tour" />
    </div>
  );
};

const TimelineRow = ({
  label,
  total,
  phases,
  accent,
  highlight,
}: {
  label: string;
  total: number;
  phases: WeekPhase[];
  accent: string;
  highlight?: boolean;
}) => (
  <div>
    <div className="mb-2 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "font-tight text-sm font-bold uppercase tracking-wide",
            highlight ? "text-primary" : "text-muted-foreground",
          )}
        >
          {label}
        </span>
        {highlight && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
            Live
          </span>
        )}
      </div>
      <span className="font-data text-xs text-muted-foreground">{total} weeks total</span>
    </div>
    <div className="flex h-10 overflow-hidden rounded-md border border-border">
      {phases.map((p, i) => (
        <div
          key={`${label}-${p.label}-${i}`}
          style={{ flexGrow: p.weeks }}
          className={cn(
            "relative flex items-center justify-center border-r border-border/60 text-[11px] font-medium text-background last:border-r-0",
            accent,
            highlight ? "opacity-95" : "opacity-70",
          )}
          title={`${p.label} · ${p.weeks} wk`}
        >
          <span className="truncate px-2">{p.label}</span>
        </div>
      ))}
    </div>
  </div>
);

const Delta = ({
  icon: Icon,
  kicker,
  value,
  sub,
}: {
  icon: typeof Activity;
  kicker: string;
  value: string;
  sub: string;
}) => (
  <div className="flex items-start gap-3">
    <div className="mt-1 flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
      <Icon className="h-4 w-4" />
    </div>
    <div>
      <div className="pilot-kicker">{kicker}</div>
      <div className="mt-0.5 font-tight text-lg font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  </div>
);

export default DemoMcDonalds;
