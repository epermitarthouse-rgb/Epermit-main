import { AlertTriangle, ArrowDownRight, ArrowUpRight, Check, ChevronRight, Filter, GitCompare, Home, Link2, Maximize2, Minus, QrCode, Sparkles, Timer, TrendingUp, Zap, X } from "lucide-react";
import { Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Siren, FileSignature, Gauge as GaugeIcon, Radio, Plug, Cable, Package, Brain } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { QRCodeSVG } from "qrcode.react";

const hubTiles = [
  { key: "conflict",   label: "Conflict Hunter",  desc: "Cross-utility clash detection",  path: "/utility/conflict-hunter",       icon: Siren },
  { key: "easement",   label: "Easement / ROW",   desc: "Right-of-way manager",           path: "/utility/easements",             icon: FileSignature },
  { key: "load",       label: "Load Profile",     desc: "kVA + power factor modeling",    path: "/utility/load-profile",          icon: GaugeIcon },
  { key: "provider",   label: "Provider Map",     desc: "PEPCO · BGE · WGL · Verizon",    path: "/utility/provider-map",          icon: Radio },
  { key: "meter",      label: "Meter-Set",        desc: "Day-of choreography",            path: "/utility/meter-set",             icon: Plug },
  { key: "builder",    label: "UCI Builder",      desc: "AI-drafted applications",        path: "/uci/application-builder",       icon: Cable },
  { key: "longlead",   label: "Long-Lead",        desc: "Transformer ETA + P50/P90",      path: "/scheduling/long-lead",          icon: Package },
  { key: "predictive", label: "Predictive Impact", desc: "Schedule confidence bands",     path: "/scheduling/predictive-impact",  icon: Brain },
] as const;

type TileKey = typeof hubTiles[number]["key"];

// Per-metric mapping to tile keys with an explicit reason each tile is relevant.
// A tile is highlighted iff a reason exists for the active metric. This keeps the
// UI, tooltip copy, and analytics story in lockstep.
const metricTileReasons: Record<string, Partial<Record<TileKey, string>>> = {
  "sites": {
    provider: "One utility provider record per site — 12 rows sync here.",
    builder:  "One AI-drafted application filed per site.",
    easement: "Parcel ROW / easement docs tracked per site.",
    load:     "Load model computed per site before submission.",
  },
  "blocked": {
    longlead: "Transformer procurement is the primary blocker driver (3 of 3).",
    conflict: "All blocked sites have unresolved cross-utility conflicts.",
    provider: "PEPCO · BGE · WGL are the three blocked providers.",
    load:     "Load spec must be re-verified before re-ordering transformers.",
  },
  "slip": {
    predictive: "Owns the P50/P90 confidence bands driving the 14d slip.",
    longlead:   "Vendor slip on padmount transformers contributes ~9d.",
    meter:      "Slip manifests as missed PEPCO meter-set windows.",
    conflict:   "Unresolved conflicts add 3–5d each to the critical path.",
  },
  "on-track": {
    meter:      "9 of 12 sites inside the 6-week meter-set window.",
    predictive: "On-track ratio derived from schedule confidence bands.",
    builder:    "Applications filed on first-pass drive on-track sites.",
  },
};

const metricMeta: Record<string, { label: string; value: string; tone: string }> = {
  "sites":      { label: "Active Sites",        value: "12",   tone: "text-primary" },
  "blocked":    { label: "Transformer-Blocked", value: "3",    tone: "text-destructive" },
  "slip":       { label: "P90 Slip",            value: "14d",  tone: "text-warning" },
  "on-track":   { label: "On-Track",            value: "9/12", tone: "text-success" },
};

const VALID_METRICS = Object.keys(metricMeta);
const VALID_QUARTERS = ["Q4-2025", "Q1-2026", "Q2-2026", "Q3-2026"];
const DEFAULT_QUARTER = "Q3-2026";
const QUARTER_LABEL = "Q3 2026 · East Coast pilot";
const STORAGE_KEY = "commun-et:uci-filter";
const COMPARE_KEY = "commun-et:uci-compare";

// Per-quarter, per-metric raw values driving compare mode.
// Direction: "up" = higher is better (sites, on-track); "down" = lower is better (blocked, slip).
const metricSeries: Record<string, { format: (n: number) => string; direction: "up" | "down"; byQuarter: Record<string, number> }> = {
  sites:      { format: (n) => `${n}`,      direction: "up",   byQuarter: { "Q4-2025": 6,  "Q1-2026": 8,  "Q2-2026": 8,  "Q3-2026": 12 } },
  blocked:    { format: (n) => `${n}`,      direction: "down", byQuarter: { "Q4-2025": 6,  "Q1-2026": 5,  "Q2-2026": 5,  "Q3-2026": 3  } },
  slip:       { format: (n) => `${n}d`,     direction: "down", byQuarter: { "Q4-2025": 32, "Q1-2026": 26, "Q2-2026": 20, "Q3-2026": 14 } },
  "on-track": { format: (n) => `${n}/12`,   direction: "up",   byQuarter: { "Q4-2025": 3,  "Q1-2026": 5,  "Q2-2026": 6,  "Q3-2026": 9  } },
};

const previousQuarter = (q: string): string | null => {
  const i = VALID_QUARTERS.indexOf(q);
  return i > 0 ? VALID_QUARTERS[i - 1] : null;
};

type PersistedFilter = { quarter?: string; metric?: string };

const readPersisted = (): PersistedFilter => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PersistedFilter;
    const out: PersistedFilter = {};
    if (parsed.quarter && VALID_QUARTERS.includes(parsed.quarter)) out.quarter = parsed.quarter;
    if (parsed.metric && VALID_METRICS.includes(parsed.metric)) out.metric = parsed.metric;
    return out;
  } catch {
    return {};
  }
};

const writePersisted = (f: PersistedFilter) => {
  if (typeof window === "undefined") return;
  try {
    if (!f.quarter && !f.metric) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(f));
  } catch {
    /* ignore quota / disabled storage */
  }
};

const stages = [
  "Load Planning", "Application", "Engineering", "Class of Service",
  "Cost Proposal", "Contracting", "Scheduling", "Construction", "Inspection", "Energization",
];
const activeIndex = 3; // Class of Service

const mappings = [
  { provider: "PEPCO", type: "Electric", sr: "2024-U771", stage: "Engineering", days: 14, risk: "good" as const, stageTone: "primary" as const },
  { provider: "BGE", type: "Gas", sr: "BGE-X9920", stage: "Field Survey", days: 32, risk: "bad" as const, stageTone: "info" as const },
  { provider: "Verizon", type: "Fiber", sr: "VZ-8812L", stage: "Contracting", days: 8, risk: "warn" as const, stageTone: "accent" as const },
  { provider: "Washington Gas", type: "Gas", sr: "WG-0021A", stage: "Pending", days: 45, risk: "bad" as const, stageTone: "muted" as const },
];

const stageStyles = {
  primary: "bg-primary/10 text-primary",
  info: "bg-pilot-cyan/10 text-pilot-cyan",
  accent: "bg-pilot-teal/10 text-pilot-teal",
  muted: "bg-muted text-muted-foreground",
} as const;

const riskDot = {
  good: "bg-success",
  warn: "bg-warning",
  bad: "bg-destructive",
} as const;

const loadBars = [30, 45, 60, 40, 85, 100, 55, 35];

const feed = [
  { time: "14:22:01", actor: "PROVIDER_MAPPER", body: "Analyzing spatial data for SR# 2024-U771. Alignment confirmed.", tone: "accent" },
  { time: "14:23:45", actor: "LOAD_PROFILE_ANALYZER", body: "New peak load calculation detected: 3.2MW. Updating PEPCO engineering request.", tone: "accent" },
  { time: "14:25:12", actor: "CONFLICT_ENGINE", body: "Detected conflict between Verizon duct bank and Washington Gas main at Node G-12.", tone: "bad" },
  { time: "14:26:30", actor: "UCI_CORE", body: "Auto-generating mitigation request for Project Architect. Escalating to Priority 2.", tone: "good" },
  { time: "14:28:05", actor: "DOC_SCANNER", body: 'Parsing "BGE-X9920_Survey_Report.pdf". Field survey data mapped to BIM model.', tone: "accent" },
];

const UciDashboard = () => {
  const [params, setParams] = useSearchParams();
  const rawQuarter = params.get("quarter");
  const rawMetric = params.get("metric");
  const hasQuarterParam = rawQuarter !== null;
  const hasMetricParam = rawMetric !== null;
  const quarterValid = hasQuarterParam && VALID_QUARTERS.includes(rawQuarter);
  const metricValid = hasMetricParam && VALID_METRICS.includes(rawMetric ?? "");
  const quarter = quarterValid ? rawQuarter : DEFAULT_QUARTER;
  const metric = metricValid ? rawMetric : null;
  const meta = metric ? metricMeta[metric] : null;
  const invalidParams = [
    hasQuarterParam && !quarterValid ? `quarter="${rawQuarter}"` : null,
    hasMetricParam && !metricValid ? `metric="${rawMetric}"` : null,
  ].filter(Boolean) as string[];

  // Hydrate from localStorage when URL is bare (first visit or refresh to /uci).
  useEffect(() => {
    if (hasQuarterParam || hasMetricParam) return;
    const persisted = readPersisted();
    if (!persisted.quarter && !persisted.metric) return;
    const next = new URLSearchParams(params);
    if (persisted.quarter) next.set("quarter", persisted.quarter);
    if (persisted.metric) next.set("metric", persisted.metric);
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist valid state so a bare /uci load restores it.
  useEffect(() => {
    writePersisted({
      quarter: quarterValid ? rawQuarter ?? undefined : undefined,
      metric: metricValid ? rawMetric ?? undefined : undefined,
    });
  }, [quarterValid, metricValid, rawQuarter, rawMetric]);

  const clearFilter = () => {
    writePersisted({});
    const next = new URLSearchParams(params);
    next.delete("quarter");
    next.delete("metric");
    setParams(next, { replace: true });
  };
  const resetToDefaults = () => {
    writePersisted({ quarter: DEFAULT_QUARTER });
    const next = new URLSearchParams(params);
    next.set("quarter", DEFAULT_QUARTER);
    next.delete("metric");
    setParams(next, { replace: true });
  };

  const [copied, setCopied] = useState(false);
  const [compare, setCompare] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try { return window.localStorage.getItem(COMPARE_KEY) === "1"; } catch { return false; }
  });
  useEffect(() => {
    try {
      if (compare) window.localStorage.setItem(COMPARE_KEY, "1");
      else window.localStorage.removeItem(COMPARE_KEY);
    } catch { /* ignore */ }
  }, [compare]);

  const prevQuarter = previousQuarter(quarter);

  // Build a comparison summary for the active metric (or all metrics if none picked).
  const compareRows = (() => {
    if (!compare || !prevQuarter) return [];
    const keys = metric ? [metric] : VALID_METRICS;
    return keys.map((k) => {
      const s = metricSeries[k];
      const cur = s.byQuarter[quarter];
      const prev = s.byQuarter[prevQuarter];
      const diff = cur - prev;
      const improved = s.direction === "up" ? diff > 0 : diff < 0;
      const worsened = s.direction === "up" ? diff < 0 : diff > 0;
      const sign = diff > 0 ? "+" : diff < 0 ? "−" : "±";
      const absStr = s.format(Math.abs(diff));
      return {
        key: k,
        label: metricMeta[k].label,
        current: s.format(cur),
        previous: s.format(prev),
        delta: `${sign}${absStr}`,
        tone: diff === 0 ? "text-muted-foreground" : improved ? "text-success" : "text-destructive",
        Arrow: diff === 0 ? Minus : diff > 0 ? ArrowUpRight : ArrowDownRight,
      };
    });
  })();
  const shareLink = async () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        // Fallback for insecure contexts / older browsers.
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.setAttribute("readonly", "");
        ta.style.position = "absolute";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      toast.success("Share link copied", {
        description: meta ? `${meta.label} · ${quarter}` : quarter,
      });
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy link", { description: "Copy the URL from the address bar." });
    }
  };

  const shareUrl = typeof window !== "undefined" ? window.location.href : "";
  const qrCaption = meta ? `${meta.label} · ${quarter}` : `${quarter} · portfolio-wide`;
  const [qrFullscreen, setQrFullscreen] = useState(false);
  useEffect(() => {
    if (!qrFullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setQrFullscreen(false); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [qrFullscreen]);
  const QrButton = ({ tone }: { tone: "primary" | "muted" }) => (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Show QR code for this view"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors",
            tone === "primary"
              ? "border-primary/40 bg-background text-primary hover:bg-primary hover:text-primary-foreground"
              : "border-border bg-background text-foreground hover:border-primary/50 hover:text-primary",
          )}
        >
          <QrCode className="h-3 w-3" /> QR
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-3">
        <div className="flex flex-col items-center gap-2">
          <div className="rounded-md bg-white p-2">
            <QRCodeSVG value={shareUrl || "about:blank"} size={160} level="M" includeMargin={false} />
          </div>
          <div className="max-w-[180px] text-center">
            <div className="pilot-kicker text-primary">Scan to open</div>
            <div className="mt-0.5 font-tight text-xs font-bold text-foreground">{qrCaption}</div>
            <div className="mt-1 break-all font-data text-[9px] text-muted-foreground">{shareUrl}</div>
          </div>
          <button
            type="button"
            onClick={() => setQrFullscreen(true)}
            className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-background px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
          >
            <Maximize2 className="h-3 w-3" /> Fullscreen
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );

  return (
  <div className="space-y-6">
    {qrFullscreen && (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="QR code fullscreen"
        className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur-sm p-6"
        onClick={() => setQrFullscreen(false)}
      >
        <button
          type="button"
          aria-label="Close QR fullscreen"
          onClick={() => setQrFullscreen(false)}
          className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background text-foreground transition-colors hover:border-primary hover:text-primary"
        >
          <X className="h-5 w-5" />
        </button>
        <div
          onClick={(e) => e.stopPropagation()}
          className="flex flex-col items-center gap-5 rounded-xl border border-border bg-card p-8 shadow-2xl"
        >
          <div className="pilot-kicker text-primary">Scan to open</div>
          <div className="rounded-lg bg-white p-5">
            <QRCodeSVG value={shareUrl || "about:blank"} size={420} level="M" includeMargin={false} />
          </div>
          <div className="max-w-[420px] text-center">
            <div className="font-tight text-base font-bold text-foreground">{qrCaption}</div>
            <div className="mt-2 break-all font-data text-[10px] text-muted-foreground">{shareUrl}</div>
          </div>
          <div className="font-data text-[10px] uppercase tracking-wider text-muted-foreground">
            Press Esc or tap outside to close
          </div>
        </div>
      </div>
    )}
    {invalidParams.length > 0 && (
      <section role="alert" className="flex flex-wrap items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 text-warning" />
        <div className="flex-1 min-w-[240px]">
          <div className="pilot-kicker text-warning">Invalid filter parameters</div>
          <div className="mt-0.5 text-xs text-foreground">
            Ignored {invalidParams.join(" and ")}. Showing default view ({QUARTER_LABEL}).
          </div>
          <div className="mt-1 font-data text-[10px] uppercase tracking-wider text-muted-foreground">
            Valid metrics: {VALID_METRICS.join(" · ")} · Valid quarters: {VALID_QUARTERS.join(" · ")}
          </div>
        </div>
        <button onClick={resetToDefaults} className="rounded-md border border-warning/40 bg-background px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-warning transition-colors hover:bg-warning hover:text-warning-foreground">
          Reset URL
        </button>
      </section>
    )}

    {meta && (
      <nav aria-label="Drill breadcrumb" className="flex flex-wrap items-center gap-1.5 font-data text-[10px] uppercase tracking-wider text-muted-foreground">
        <Link to="/mission-control" className="inline-flex items-center gap-1 rounded-sm px-1 py-0.5 font-bold text-muted-foreground transition-colors hover:bg-muted hover:text-primary">
          <Home className="h-3 w-3" /> Mission Control
        </Link>
        <ChevronRight className="h-3 w-3 opacity-60" />
        <span className="font-bold text-muted-foreground">{quarter}</span>
        <ChevronRight className="h-3 w-3 opacity-60" />
        <span className={cn("font-bold", meta.tone)}>{meta.label}</span>
        <ChevronRight className="h-3 w-3 opacity-60" />
        <span className="font-bold text-foreground">UCI Hub</span>
        <button
          type="button"
          onClick={clearFilter}
          aria-label="Back to unfiltered UCI Hub"
          className="ml-2 inline-flex items-center gap-1 rounded-sm border border-border bg-background px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
        >
          <X className="h-3 w-3" /> Back to unfiltered
        </button>
      </nav>
    )}

    {meta && (
      <section className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
        <Filter className="h-4 w-4 text-primary" />
        <div className="flex-1 min-w-[240px]">
          <div className="pilot-kicker text-primary">Drilled from Mission Control</div>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-2">
            <span className="font-tight text-sm font-bold text-foreground">{meta.label}</span>
            <span className={cn("font-data text-sm font-semibold", meta.tone)}>{meta.value}</span>
            <span className="font-data text-[10px] uppercase tracking-wider text-muted-foreground">· {quarter}</span>
            {compare && prevQuarter && compareRows[0] && (() => {
              const r = compareRows[0];
              const Arrow = r.Arrow;
              return (
                <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-[10px]">
                  <span className="font-data text-muted-foreground">{prevQuarter}: {r.previous}</span>
                  <Arrow className={cn("h-3 w-3", r.tone)} />
                  <span className={cn("font-data font-semibold", r.tone)}>{r.delta}</span>
                </span>
              );
            })()}
          </div>
          {/* Confidence band + CIAC variance — surfaces proposal commitments in the drill */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-background px-2 py-0.5 font-data text-[10px]">
              <span className="pilot-kicker text-primary">P50</span>
              <span className="font-semibold text-primary">Aug 14</span>
              <span className="mx-1 text-muted-foreground">·</span>
              <span className="pilot-kicker text-accent-foreground">P90</span>
              <span className="font-semibold text-warning">Sep 28</span>
              <span className="ml-1 text-muted-foreground">± band</span>
            </span>
            <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 font-data text-[10px]">
              <Wallet className="h-3 w-3 text-primary" />
              <span className="pilot-kicker">CIAC variance</span>
              <span className="font-semibold text-success">−$4.2K vs budget</span>
            </span>
            <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 font-data text-[10px]">
              <span className="pilot-kicker">CoS gate</span>
              <span className="font-semibold text-primary">Received · 30% invoice ready</span>
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={shareLink}
          aria-label="Copy link to this drilled view"
          className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-background px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
        >
          {copied ? <Check className="h-3 w-3" /> : <Link2 className="h-3 w-3" />}
          {copied ? "Copied" : "Copy link"}
        </button>
        <QrButton tone="primary" />
        <button onClick={clearFilter} className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-primary">
          Clear filter <X className="h-3 w-3" />
        </button>
      </section>
    )}

    {!meta && hasQuarterParam && quarterValid && (
      <section className="rounded-lg border border-border bg-muted/40 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <div className="flex-1 min-w-[240px]">
            <div className="pilot-kicker">Viewing quarter</div>
            <div className="mt-0.5 font-tight text-sm font-bold text-foreground">{quarter} · portfolio-wide</div>
            <div className="text-[10px] text-muted-foreground">Pick a KPI on Mission Control to filter modules.</div>
          </div>
        <button
          type="button"
          onClick={shareLink}
          aria-label="Copy link to this quarter view"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-foreground transition-colors hover:border-primary/50 hover:text-primary"
        >
          {copied ? <Check className="h-3 w-3 text-success" /> : <Link2 className="h-3 w-3" />}
          {copied ? "Copied" : "Copy link"}
        </button>
        <QrButton tone="muted" />
        <button onClick={clearFilter} className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-primary">
          Clear <X className="h-3 w-3" />
        </button>
        </div>
        {compare && prevQuarter && compareRows.length > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-3 md:grid-cols-4">
            {compareRows.map((r) => {
              const Arrow = r.Arrow;
              return (
                <div key={r.key} className="rounded-md border border-border bg-background/60 p-2">
                  <div className="pilot-kicker">{r.label}</div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="font-data text-sm font-semibold text-foreground">{r.current}</span>
                    <span className="font-data text-[10px] text-muted-foreground">from {r.previous}</span>
                  </div>
                  <div className={cn("mt-0.5 inline-flex items-center gap-1 font-data text-[10px] font-semibold", r.tone)}>
                    <Arrow className="h-3 w-3" /> {r.delta} vs {prevQuarter}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    )}

    {/* Hub navigator */}
    <section className="pilot-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="pilot-kicker text-primary">UCI Hub</div>
          <h3 className="mt-1 font-tight text-lg font-bold">Continuous Utility Coordination Flow</h3>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-data text-[10px] uppercase tracking-wider text-muted-foreground">8 modules · 12 agents</span>
          <button
            type="button"
            onClick={() => setCompare((v) => !v)}
            disabled={!prevQuarter}
            aria-pressed={compare}
            aria-label={compare ? "Turn off quarter comparison" : `Compare vs ${prevQuarter ?? "previous quarter"}`}
            title={prevQuarter ? `Compare ${quarter} vs ${prevQuarter}` : "No previous quarter to compare"}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors",
              compare
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-foreground hover:border-primary/50 hover:text-primary",
              !prevQuarter && "opacity-50 cursor-not-allowed",
            )}
          >
            <GitCompare className="h-3.5 w-3.5" />
            {compare && prevQuarter ? `vs ${prevQuarter}` : "Compare"}
          </button>
          <button
            type="button"
            onClick={shareLink}
            aria-label="Copy shareable link to this drilled view"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-foreground transition-colors hover:border-primary/50 hover:text-primary"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Link2 className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Share link"}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {hubTiles.map((t) => {
          const reason = metric ? metricTileReasons[metric]?.[t.key] : undefined;
          const highlight = Boolean(reason);
          const dimmed = Boolean(metric) && !highlight;
          return (
            <TooltipProvider key={t.path} delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    to={t.path}
                    aria-label={`${t.label} — ${reason ?? t.desc}`}
                    className={cn(
                      "group flex items-start gap-3 rounded-lg border p-3 transition-all",
                      highlight
                        ? "border-primary bg-primary/10 ring-1 ring-primary/40"
                        : dimmed
                          ? "border-border bg-muted/20 opacity-50 hover:opacity-100"
                          : "border-border bg-muted/30 hover:border-primary/50 hover:bg-primary/5",
                    )}
                  >
                    <t.icon className="mt-0.5 h-4 w-4 text-primary" />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-foreground group-hover:text-primary">{t.label}</div>
                      <div className="text-[11px] text-muted-foreground">{t.desc}</div>
                    </div>
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[260px]">
                  {highlight ? (
                    <div className="space-y-1">
                      <div className="pilot-kicker text-primary">Highlighted — {meta?.label}</div>
                      <div className="text-xs leading-relaxed">{reason}</div>
                    </div>
                  ) : dimmed ? (
                    <div className="space-y-1">
                      <div className="pilot-kicker text-muted-foreground">Not tied to {meta?.label}</div>
                      <div className="text-xs leading-relaxed">{t.desc}</div>
                    </div>
                  ) : (
                    <div className="text-xs leading-relaxed">{t.desc}</div>
                  )}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        })}
      </div>
    </section>

    {/* Header strip */}
    <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <div className="pilot-kicker text-primary">System Status — Active Monitoring</div>
        <h2 className="mt-2 font-display text-4xl font-semibold tracking-tight text-foreground">Utility Coordination Intelligence</h2>
      </div>
      <div className="pilot-card flex items-stretch gap-6 p-5">
        <div className="flex flex-col">
          <span className="pilot-kicker">P50 Projection</span>
          <span className="mt-1 font-display text-3xl font-semibold text-primary">Aug 14</span>
          <span className="text-xs text-muted-foreground">Likely confidence</span>
        </div>
        <div className="w-px bg-border" />
        <div className="flex flex-col">
          <span className="pilot-kicker">P90 Projection</span>
          <span className="mt-1 font-display text-3xl font-semibold text-accent">Sep 28</span>
          <span className="text-xs text-muted-foreground">Upper bound</span>
        </div>
        <button className="pilot-button-primary self-center">Run Prediction</button>
      </div>
    </section>

    {/* Lifecycle tracker */}
    <section className="pilot-card p-6">
      <div className="mb-6 flex items-center justify-between">
        <h3 className="font-tight text-lg font-bold">10-Stage Utility Lifecycle Tracker</h3>
        <span className="font-data rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">Current: Class of Service</span>
      </div>
      <div className="relative">
        {/* Rails are inset so they start/end at the center of the first/last node */}
        <div className="pointer-events-none absolute inset-x-0 top-3 h-0.5" style={{ paddingLeft: `${50 / stages.length}%`, paddingRight: `${50 / stages.length}%` }}>
          <div className="relative h-full w-full bg-border">
            <div className="absolute left-0 top-0 h-full bg-primary" style={{ width: `${(activeIndex / (stages.length - 1)) * 100}%` }} />
          </div>
        </div>
        <div className="relative flex items-start">
          {stages.map((label, i) => {
            const done = i < activeIndex;
            const active = i === activeIndex;
            return (
              <div key={label} className="flex flex-1 min-w-0 flex-col items-center px-1">
                <div className="flex h-6 items-center justify-center">
                  {active ? (
                    <div className="relative z-10 flex h-6 w-6 items-center justify-center rounded-full border-2 border-primary bg-background ring-4 ring-primary/30">
                      <span className="h-2 w-2 rounded-full bg-primary" />
                    </div>
                  ) : (
                    <div className={cn("relative z-10 h-4 w-4 rounded-full", done ? "bg-primary ring-4 ring-primary/20" : "bg-border")} />
                  )}
                </div>
                <span className={cn("mt-3 block w-full break-words text-center text-[10px] font-bold uppercase leading-tight tracking-wider", active ? "text-primary" : "text-muted-foreground")}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>

    {/* Mappings + Predictive */}
    <section className="grid gap-6 xl:grid-cols-[7fr_5fr]">
      <div className="pilot-card overflow-hidden">
        <header className="flex items-center justify-between border-b border-border p-5">
          <h3 className="font-tight text-lg font-bold">Active Utility Mappings</h3>
          <button className="text-muted-foreground transition-colors hover:text-primary"><Filter className="h-4 w-4" /></button>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-muted/60">
              <tr className="pilot-kicker">
                <th className="px-5 py-3 font-medium">Provider</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">SR#</th>
                <th className="px-5 py-3 font-medium">Stage</th>
                <th className="px-5 py-3 font-medium">Days</th>
                <th className="px-5 py-3 font-medium">Risk</th>
                <th className="px-5 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-sm">
              {mappings.map((m) => (
                <tr key={m.sr} className="transition-colors hover:bg-muted/40">
                  <td className="px-5 py-4 font-semibold text-foreground">{m.provider}</td>
                  <td className="px-5 py-4 text-muted-foreground">{m.type}</td>
                  <td className="px-5 py-4 font-data text-xs text-muted-foreground">{m.sr}</td>
                  <td className="px-5 py-4">
                    <span className={cn("rounded px-2 py-0.5 text-[11px]", stageStyles[m.stageTone])}>{m.stage}</span>
                  </td>
                  <td className="px-5 py-4 font-data text-xs">{m.days}</td>
                  <td className="px-5 py-4"><div className={cn("h-2 w-2 rounded-full", riskDot[m.risk])} /></td>
                  <td className="px-5 py-4"><button className="text-[10px] font-bold uppercase tracking-wider text-primary hover:underline">View Details</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        <article className="relative overflow-hidden rounded-lg border border-border bg-[hsl(var(--deep-navy))] p-6 text-[hsl(var(--background))] shadow-[0_18px_48px_hsl(var(--deep-navy)/0.18)]">
          <div className="grid-overlay pointer-events-none absolute inset-0 opacity-20" />
          <div className="relative flex items-start justify-between">
            <h3 className="font-tight text-lg font-bold">Predictive Analysis</h3>
            <TrendingUp className="h-5 w-5 text-primary" />
          </div>
          <div className="relative mt-5 space-y-4">
            <div className="rounded-lg border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between">
                <span className="pilot-kicker text-pilot-cyan">Critical Long-Lead Item</span>
                <span className="font-data text-xs text-primary">32 Weeks</span>
              </div>
              <div className="mt-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-destructive">
                <Timer className="h-3.5 w-3.5" /> 12 Days until Schedule Impact
              </div>
              <h4 className="mt-2 font-tight text-lg">750 kVA Transformer</h4>
              <p className="mt-1 text-sm text-[hsl(var(--background)/0.7)]">Supply chain constraint detected. Estimated delivery: March 2025.</p>
            </div>
            <div className="rounded-lg border border-destructive/40 bg-destructive/15 p-4">
              <div className="flex items-center gap-2 pilot-kicker text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" /> Cross-Utility Conflict
              </div>
              <h4 className="mt-2 font-tight text-lg">Gas line depth conflict</h4>
              <p className="mt-1 text-sm text-[hsl(var(--background)/0.7)]">Segment 4A: Gas service line depth (30") conflicts with planned 13.2 kV conduit run. Redesign required.</p>
            </div>
          </div>
        </article>

        <article className="pilot-card flex-1 p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-tight text-lg font-bold">Site Load Profile</h3>
            <span className="font-data text-[10px] uppercase tracking-wider text-muted-foreground">Real-time data</span>
          </div>
          <div className="mt-4 flex h-24 items-end gap-1">
            {loadBars.map((h, i) => (
              <div key={i} className="flex-1 rounded-t-sm bg-primary" style={{ height: `${h}%`, opacity: 0.25 + (h / 100) * 0.75 }} />
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div className="text-center">
              <span className="font-data text-2xl font-semibold text-primary">3.2</span>
              <span className="pilot-kicker mt-1 block">MW Peak</span>
            </div>
            <div className="border-l border-border text-center">
              <span className="font-data text-2xl font-semibold text-primary">0.85</span>
              <span className="pilot-kicker mt-1 block">Pwr Factor</span>
            </div>
          </div>
        </article>
      </div>
    </section>

    {/* Agent live feed (dark terminal) */}
    <section className="overflow-hidden rounded-lg border border-border bg-[hsl(var(--deep-navy))] shadow-[0_18px_48px_hsl(var(--deep-navy)/0.18)]">
      <header className="flex items-center justify-between border-b border-white/10 bg-white/5 px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 animate-pulse rounded-full bg-success" />
          <span className="pilot-kicker text-[hsl(var(--background))]">UCI Agent Live Feed</span>
        </div>
        <span className="font-data text-[10px] uppercase text-[hsl(var(--background)/0.5)]">Version 4.2.1-stable</span>
      </header>
      <ul className="max-h-48 space-y-1 overflow-y-auto p-5 font-data text-sm text-[hsl(var(--background)/0.75)]">
        {feed.map((row) => (
          <li key={row.time} className="cursor-pointer rounded px-1 transition-colors hover:bg-white/5">
            <span className="text-primary">[{row.time}]</span>{" "}
            <span className={cn(row.tone === "bad" ? "text-destructive" : row.tone === "good" ? "text-success" : "text-pilot-cyan")}>
              {row.actor}:
            </span>{" "}
            {row.body}
          </li>
        ))}
      </ul>
    </section>

    {/* FAB */}
    <button
      aria-label="New action"
      className="fixed bottom-8 right-8 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-2xl transition-transform hover:scale-105"
    >
      <Sparkles className="h-6 w-6" />
    </button>
  </div>
  );
};

export default UciDashboard;
