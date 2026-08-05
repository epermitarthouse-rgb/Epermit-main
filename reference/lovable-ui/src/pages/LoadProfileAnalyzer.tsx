import { Activity, AlertTriangle, Battery, BarChart3, ChevronDown, ChevronUp, Download, FileText, Gauge, Layers, Loader2, Printer, RefreshCw, Sparkles, TrendingUp, X, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { validateLetterInputs } from "@/lib/utility-letter-validation";
import { supabase } from "@/integrations/supabase/client";
import { useDemoMode } from "@/hooks/useDemoMode";
import communEtLogo from "@/assets/commun-et-logo-full.jpg.asset.json";
import mcdonaldsLogo from "@/assets/mcdonalds-logo.png.asset.json";

// Base 24-h weekday profile.
const baseHourly = [
  18, 16, 14, 13, 12, 14, 22, 38, 56, 71, 82, 88, 92, 95, 96, 93, 88, 80, 68, 54, 42, 32, 26, 21,
];

// McDonald's restaurant prototype presets — mutltiplier + peak / service metadata for the
// pitch. Each preset applies a per-hour shape so the chart reshapes visibly.
type Preset = {
  id: string;
  label: string;
  kicker: string;
  multiplier: number[]; // 24 length
  peaks: { label: string; value: string; delta: string }[];
  breakdown: { name: string; kw: number; note: string }[];
  // Optional declared total. When set, breakdown line items must sum to this
  // value (±0.5 kW) or letter generation is blocked. Leave undefined to let
  // the sum be authoritative.
  declaredTotalKw?: number;
};

const flat = (v: number) => Array(24).fill(v);

const presets: Preset[] = [
  {
    id: "standard",
    label: "Standard restaurant",
    kicker: "Baseline McD prototype · dine-in + single drive-thru",
    multiplier: flat(1),
    peaks: [
      { label: "Peak demand",       value: "1.42 MW",         delta: "14:00 weekday avg." },
      { label: "Load factor",       value: "0.62",            delta: "annualized" },
      { label: "Coincident peak",   value: "1.18 MW",         delta: "vs utility system peak" },
      { label: "Service entrance",  value: "1,600 A · 480 V", delta: "switchgear class" },
    ],
    breakdown: [
      { name: "Kitchen equipment",  kw: 420, note: "Grills, fryers, UHC, McCafé" },
      { name: "HVAC",               kw: 260, note: "Rooftop units + kitchen makeup air" },
      { name: "Refrigeration",      kw: 180, note: "Walk-ins, reach-ins" },
      { name: "Beverage system",    kw: 95,  note: "Ice, dispensers, shake machines" },
      { name: "Lighting + POS",     kw: 145, note: "LED interior/exterior + kiosks" },
      { name: "Drive-thru",         kw: 60,  note: "Menu boards, headset, DT signage" },
    ],
  },
  {
    id: "drivethru",
    label: "Drive-Thru forward",
    kicker: "Reduced dining room · elongated PM peak",
    multiplier: [0.9, 0.9, 0.9, 0.9, 0.9, 0.95, 1.0, 1.1, 1.15, 1.2, 1.2, 1.15, 1.15, 1.15, 1.2, 1.25, 1.3, 1.3, 1.25, 1.15, 1.05, 0.95, 0.9, 0.9],
    peaks: [
      { label: "Peak demand",       value: "1.71 MW",         delta: "18:00 dinner rush" },
      { label: "Load factor",       value: "0.68",            delta: "flatter profile" },
      { label: "Coincident peak",   value: "1.44 MW",         delta: "vs utility system peak" },
      { label: "Service entrance",  value: "1,600 A · 480 V", delta: "no upsize required" },
    ],
    breakdown: [
      { name: "Kitchen equipment",  kw: 460, note: "Higher grill duty cycle" },
      { name: "HVAC",               kw: 210, note: "Smaller dining envelope" },
      { name: "Refrigeration",      kw: 195, note: "Higher throughput" },
      { name: "Beverage system",    kw: 110, note: "DT beverage station" },
      { name: "Lighting + POS",     kw: 120, note: "Reduced interior LED" },
      { name: "Drive-thru",         kw: 145, note: "Dual-lane + digital menu" },
    ],
  },
  {
    id: "doubledt-kiosk",
    label: "Double DT + Kiosk",
    kicker: "Modern build · dual DT lanes + self-order kiosks",
    multiplier: [0.85, 0.85, 0.85, 0.85, 0.85, 0.9, 1.1, 1.35, 1.45, 1.4, 1.35, 1.4, 1.45, 1.4, 1.35, 1.3, 1.35, 1.4, 1.35, 1.2, 1.05, 0.9, 0.85, 0.85],
    peaks: [
      { label: "Peak demand",       value: "2.06 MW",         delta: "09:00 breakfast + kiosk load" },
      { label: "Load factor",       value: "0.66",            delta: "annualized" },
      { label: "Coincident peak",   value: "1.72 MW",         delta: "→ upsize transformer" },
      { label: "Service entrance",  value: "2,000 A · 480 V", delta: "recommend upsize" },
    ],
    breakdown: [
      { name: "Kitchen equipment",  kw: 510, note: "Higher throughput prep line" },
      { name: "HVAC",               kw: 245, note: "Larger vestibule + kiosk zone" },
      { name: "Refrigeration",      kw: 210, note: "Curbside + kiosk staging" },
      { name: "Beverage system",    kw: 125, note: "Second dispenser bank" },
      { name: "Lighting + POS",     kw: 190, note: "6× kiosks, digital menu boards" },
      { name: "Drive-thru",         kw: 220, note: "Dual DT lanes + escape lane" },
    ],
  },
  {
    id: "beverage-heavy",
    label: "Beverage / Refrigeration heavy",
    kicker: "McCafé + shake / dessert expansion",
    multiplier: [0.95, 0.95, 0.95, 0.95, 0.95, 1.0, 1.15, 1.3, 1.35, 1.25, 1.15, 1.15, 1.2, 1.2, 1.15, 1.2, 1.25, 1.25, 1.2, 1.1, 1.0, 0.95, 0.95, 0.95],
    peaks: [
      { label: "Peak demand",       value: "1.87 MW",         delta: "cold-side dominant" },
      { label: "Load factor",       value: "0.71",            delta: "steady daytime" },
      { label: "Coincident peak",   value: "1.55 MW",         delta: "vs utility system peak" },
      { label: "Service entrance",  value: "1,600 A · 480 V", delta: "OK with storage" },
    ],
    breakdown: [
      { name: "Kitchen equipment",  kw: 380, note: "Standard cook line" },
      { name: "HVAC",               kw: 270, note: "Increased latent load" },
      { name: "Refrigeration",      kw: 305, note: "Expanded walk-in + freezer" },
      { name: "Beverage system",    kw: 220, note: "McCafé espresso bank + shake" },
      { name: "Lighting + POS",     kw: 150, note: "Baseline" },
      { name: "Drive-thru",         kw: 65,  note: "Single lane" },
    ],
  },
  {
    id: "modernization",
    label: "Modernization retrofit",
    kicker: "Bigger Bolder Vision-style refresh · phased cutover",
    multiplier: [0.7, 0.7, 0.7, 0.7, 0.7, 0.75, 0.85, 0.95, 1.0, 1.0, 1.0, 1.0, 1.05, 1.05, 1.0, 1.0, 1.05, 1.05, 1.0, 0.95, 0.85, 0.75, 0.7, 0.7],
    peaks: [
      { label: "Peak demand",       value: "1.28 MW",         delta: "post-retrofit efficient" },
      { label: "Load factor",       value: "0.65",            delta: "improved envelope" },
      { label: "Coincident peak",   value: "1.02 MW",         delta: "vs utility system peak" },
      { label: "Service entrance",  value: "1,200 A · 480 V", delta: "reuse existing" },
    ],
    breakdown: [
      { name: "Kitchen equipment",  kw: 360, note: "Induction migration" },
      { name: "HVAC",               kw: 210, note: "New VRF" },
      { name: "Refrigeration",      kw: 165, note: "ECM condensers" },
      { name: "Beverage system",    kw: 90,  note: "Existing" },
      { name: "Lighting + POS",     kw: 110, note: "Full LED + occupancy" },
      { name: "Drive-thru",         kw: 55,  note: "Existing single lane" },
    ],
  },
];

const scenarios = [
  { name: "Base case (operating)", demand: "1.42 MW", energy: "5.8 GWh/yr", risk: "Low" },
  { name: "Phase II expansion", demand: "2.05 MW", energy: "8.4 GWh/yr", risk: "Medium" },
  { name: "EV fleet charging", demand: "2.71 MW", energy: "9.6 GWh/yr", risk: "High" },
  { name: "Phase II + solar offset", demand: "1.78 MW", energy: "6.1 GWh/yr", risk: "Low" },
];

// Module-level cache — survives navigation within the SPA session so repeat
// visits to /utility/load-profile reuse prior AI results instead of re-billing
// the gateway. Also persisted to sessionStorage so a hard refresh keeps them.
type Rec = { category: string; title: string; detail: string; citation?: string };
type RecResponse = { recommendations: Rec[]; assumptions: string[]; jurisdictionNotes: string; utilityNotes: string };
const RECS_CACHE_KEY = "uci:recs:v1";
const recsCache = new Map<string, RecResponse>();
try {
  const raw = typeof sessionStorage !== "undefined" ? sessionStorage.getItem(RECS_CACHE_KEY) : null;
  if (raw) {
    const parsed = JSON.parse(raw) as Record<string, RecResponse>;
    for (const [k, v] of Object.entries(parsed)) recsCache.set(k, v);
  }
} catch { /* ignore corrupt cache */ }
const persistCache = () => {
  try {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.setItem(RECS_CACHE_KEY, JSON.stringify(Object.fromEntries(recsCache)));
  } catch { /* quota or unavailable */ }
};

const LoadProfileAnalyzer = () => {
  const [presetId, setPresetId] = useState<string>("standard");
  const preset = presets.find((p) => p.id === presetId)!;
  const hourly = baseHourly.map((v, i) => Math.round(v * preset.multiplier[i]));
  const max = Math.max(...hourly);
  const [demoMode] = useDemoMode();

  const [recs, setRecs] = useState<RecResponse | null>(null);
  const [recStatus, setRecStatus] = useState<"idle" | "loading" | "error">("idle");
  const [recError, setRecError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [letterStatus, setLetterStatus] = useState<"idle" | "generating">("idle");
  const [inlineLetter, setInlineLetter] = useState<{ html: string; filename: string } | null>(null);
  const letterIframeRef = useRef<HTMLIFrameElement | null>(null);

  const jurisdiction = "Miami-Dade, FL (HVHZ)";
  const utility = "FPL";

  // Single source of truth for "does the letter have what it needs?" — used
  // for inline highlights and by the generate handler.
  const {
    missingFields,
    missingList,
    hasMissing,
    breakdownSumKw,
    totalKw,
    totalDelta,
    invalidBreakdownNames,
  } = validateLetterInputs({ preset, jurisdiction, utility });
  const peakEntry = preset.peaks.find((p) => p.label === "Peak demand");
  const serviceEntry = preset.peaks.find((p) => p.label === "Service entrance");
  const declaredTotalKw = preset.declaredTotalKw;
  const totalMismatch = missingFields.totalMismatch;

  // Shared letter HTML builder — one source of truth for the inline preview,
  // the popup tab, and the popup-blocked fallback modal.
  const buildLetterHtml = useCallback(
    (opts: { autoPrint: boolean; showPrintButton: boolean }) => {
      const localHourly = baseHourly.map((v, i) => Math.round(v * preset.multiplier[i]));
      const peakKw = Math.max(...localHourly);
      const loadFactor = Math.round((localHourly.reduce((s, v) => s + v, 0) / (peakKw * 24)) * 100) / 100;
      const service = serviceEntry?.value ?? "";
      const peakDisplay = peakEntry?.value ?? "";
      const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
      const rowsHtml = preset.breakdown
        .map((b) => `<tr><td>${b.name}</td><td>${b.note}</td><td style="text-align:right;font-variant-numeric:tabular-nums;">${b.kw} kW</td></tr>`)
        .join("");
      return `<!doctype html><html><head><meta charset="utf-8"/>
<title>Utility Service Letter – ${preset.label}</title>
<style>
  @page { size: Letter; margin: 0.75in; }
  * { box-sizing: border-box; }
  html, body { background:#fff; }
  body { font-family: Georgia, 'Times New Roman', serif; color:#111; margin:0; padding:32px; }
  .header { display:flex; align-items:center; justify-content:space-between; border-bottom:2px solid #0033A0; padding-bottom:16px; }
  .header img.commun { height:72px; }
  .header img.mcd { height:56px; }
  h1 { font-size:20px; margin:24px 0 4px; color:#0033A0; letter-spacing:.02em; }
  .meta { font-size:12px; color:#555; margin-bottom:24px; }
  p { font-size:13px; line-height:1.55; }
  table { width:100%; border-collapse:collapse; margin:12px 0 20px; font-size:12px; }
  th, td { border:1px solid #ccc; padding:6px 8px; text-align:left; }
  th { background:#f2f4f8; }
  .kv { display:grid; grid-template-columns:1fr 1fr; gap:6px 24px; font-size:13px; margin:12px 0 20px; }
  .kv div span { color:#555; display:inline-block; width:170px; }
  .sig { margin-top:40px; font-size:13px; }
  .footer { margin-top:36px; padding-top:12px; border-top:1px solid #ccc; font-size:10px; color:#666; text-align:center; }
  .print { position:fixed; top:12px; right:12px; }
  .print button { background:#0033A0; color:#fff; border:none; padding:8px 14px; border-radius:4px; cursor:pointer; font:600 12px system-ui; }
  @media print { .print { display:none; } body { padding:0; } }
</style></head><body>
${opts.showPrintButton ? '<div class="print"><button onclick="window.print()">Print / Save PDF</button></div>' : ""}
<div class="header">
  <img class="commun" src="${communEtLogo.url}" alt="Commun-ET LLC"/>
  <img class="mcd" src="${mcdonaldsLogo.url}" alt="McDonald's"/>
</div>
<h1>Utility Service Availability &amp; Load Letter</h1>
<div class="meta">${today} &nbsp;·&nbsp; Prepared by Commun-ET LLC &nbsp;·&nbsp; Prototype: ${preset.label}</div>

<p><strong>To:</strong> ${utility} — New Service Applications<br/>
<strong>Re:</strong> Proposed McDonald's restaurant — projected electrical load and service request<br/>
<strong>Jurisdiction:</strong> ${jurisdiction}</p>

<p>To Whom It May Concern,</p>
<p>On behalf of the McDonald's development team, Commun-ET LLC is submitting the projected
connected load and demand profile for the referenced site. The values below have been
derived from the ${preset.label.toLowerCase()} prototype (${preset.kicker}) and are
intended to support ${utility}'s service planning, transformer sizing, and coordination
of the point of delivery.</p>

<div class="kv">
  <div><span>Prototype:</span> ${preset.label}</div>
  <div><span>Utility:</span> ${utility}</div>
  <div><span>Peak demand:</span> ${peakDisplay}</div>
  <div><span>Load factor:</span> ${loadFactor.toFixed(2)}</div>
  <div><span>Service entrance:</span> ${service}</div>
  <div><span>Total connected load:</span> ${totalKw} kW</div>
</div>

<h2 style="font-size:14px;color:#0033A0;margin:16px 0 6px;">Connected load breakdown</h2>
<table>
  <thead><tr><th>System</th><th>Description</th><th style="text-align:right;">Demand</th></tr></thead>
  <tbody>${rowsHtml}
  <tr><td colspan="2" style="text-align:right;font-weight:600;">Total connected</td>
      <td style="text-align:right;font-weight:600;">${totalKw} kW</td></tr>
  </tbody>
</table>

<p>We respectfully request written confirmation of service availability at the address of
record, along with the required transformer size, point-of-delivery location, and
estimated construction lead time. Please direct any follow-up to the undersigned.</p>

<div class="sig">
  Respectfully,<br/><br/>
  <strong>Ian Swain</strong><br/>
  Utility Coordination Lead — Commun-ET LLC<br/>
  permitting · utility coordination · results
</div>

<div class="footer">Generated by Commun-ET Platform · ${today}</div>
${opts.autoPrint ? "<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),400));</script>" : ""}
</body></html>`;
       
    },
    [preset, peakEntry, serviceEntry, totalKw, jurisdiction, utility],
  );

  const previewHtml = useMemo(
    () => (hasMissing ? "" : buildLetterHtml({ autoPrint: false, showPrintButton: false })),
    [hasMissing, buildLetterHtml],
  );
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);
  const [showPreview, setShowPreview] = useState(true);

  const printPreview = () => {
    const win = previewIframeRef.current?.contentWindow;
    if (!win) {
      toast.error("Preview not ready yet — try again in a moment.");
      return;
    }
    try { win.focus(); win.print(); } catch (e) {
      toast.error("Could not open print dialog", {
        description: e instanceof Error ? e.message : "Use Generate utility letter for a printable tab.",
      });
    }
  };

  const downloadPreview = () => {
    if (!previewHtml) return;
    const blob = new Blob([previewHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `utility-letter-${preset.id}-${new Date().toISOString().slice(0, 10)}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const fetchRecs = useCallback(async (opts?: { force?: boolean }) => {
    if (demoMode) return;
    const localHourly = baseHourly.map((v, i) => Math.round(v * preset.multiplier[i]));
    const peakKw = Math.max(...localHourly);
    const loadFactor = Math.round((localHourly.reduce((s, v) => s + v, 0) / (peakKw * 24)) * 100) / 100;
    const body = {
      prototype: preset.label,
      jurisdiction,
      utility,
      peakDemandKw: Math.round(peakKw * 20),
      loadFactor,
      coincidentPeakKw: Math.round(peakKw * 17),
      serviceEntrance: preset.peaks.find((p) => p.label === "Service entrance")?.value ?? "1,600 A · 480 V",
      breakdown: preset.breakdown.map((b) => ({ name: b.name, kw: b.kw })),
      scenarios,
    };
    const cacheKey = JSON.stringify(body);
    if (!opts?.force) {
      const cached = recsCache.get(cacheKey);
      if (cached) {
        if (abortRef.current) abortRef.current.abort();
        setRecs(cached);
        setRecStatus("idle");
        setRecError(null);
        return;
      }
    }
    // Cancel any in-flight request before starting a new one.
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRecStatus("loading");
    setRecError(null);
    try {
      const { data, error } = await supabase.functions.invoke("utility-recommendations", { body });
      if (controller.signal.aborted) return;
      if (error) {
        setRecStatus("error");
        setRecError(error.message);
        return;
      }
      const payload = (data as { data?: RecResponse; fallback?: RecResponse })?.data
        ?? (data as { fallback?: RecResponse })?.fallback
        ?? null;
      if (!payload) {
        setRecStatus("error");
        setRecError("Empty response from utility-recommendations");
        return;
      }
      recsCache.set(cacheKey, payload);
      persistCache();
      setRecs(payload);
      setRecStatus("idle");
    } catch (e) {
      if (controller.signal.aborted) return;
      setRecStatus("error");
      setRecError(e instanceof Error ? e.message : "Unknown error");
    }
    // Depend on stable primitives only — otherwise this refetches every render.
     
  }, [demoMode, presetId]);

  // Debounce so rapid preset toggles collapse into a single call.
  useEffect(() => {
    if (demoMode) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void fetchRecs(); }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [fetchRecs, demoMode]);

  const handleGenerateLetter = () => {
    if (letterStatus === "generating") return;
    if (hasMissing) {
      toast.error("Missing letter data", {
        description: `Cannot generate — the ${preset.label || "selected"} prototype is missing: ${missingList.join(", ")}.`,
      });
      return;
    }
    setLetterStatus("generating");
    const toastId = toast.loading("Generating utility letter…");
    try {
    const html = buildLetterHtml({ autoPrint: true, showPrintButton: true });
    const filename = `utility-letter-${preset.id}-${new Date().toISOString().slice(0, 10)}.html`;
    // Try popup first. Detect blockers: null, undefined, or auto-closed within a tick.
    let w: Window | null = null;
    try { w = window.open("", "_blank", "noopener,width=900,height=1100"); } catch { w = null; }
    const blocked = !w || w.closed || typeof w.document === "undefined";
    if (blocked) {
      try { w?.close(); } catch { /* noop */ }
      setInlineLetter({ html, filename });
      toast.warning("Popup blocked — showing letter inline", {
        id: toastId,
        description: "Use Print / Save PDF or Download HTML from the inline preview.",
      });
      setLetterStatus("idle");
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    toast.success("Utility letter ready", {
      id: toastId,
      description: "Opened in a new tab — the print dialog will appear automatically.",
    });
    } catch (err) {
      console.error("Utility letter generation failed:", err);
      toast.error("Could not generate letter", {
        id: toastId,
        description: err instanceof Error ? err.message : "Unexpected error. Please try again.",
      });
    } finally {
      setLetterStatus("idle");
    }
  };

  const downloadInlineLetter = () => {
    if (!inlineLetter) return;
    const blob = new Blob([inlineLetter.html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = inlineLetter.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const printInlineLetter = () => {
    const win = letterIframeRef.current?.contentWindow;
    if (!win) {
      toast.error("Preview not ready yet — try again in a moment.");
      return;
    }
    try { win.focus(); win.print(); } catch (e) {
      toast.error("Could not open print dialog", {
        description: e instanceof Error ? e.message : "Use Download HTML and print from your browser.",
      });
    }
  };

  return (
  <>
  <div className="space-y-6 pb-12">
    <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="pilot-kicker text-primary">Utility Intelligence</div>
        <h1 className="mt-2 font-tight text-3xl font-black tracking-tight text-foreground md:text-4xl">Load Profile Analyzer</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Model electrical demand across day-types, seasons, and growth scenarios. Outputs feed
          directly into utility service applications, transformer sizing, and on-site generation
          studies.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button className="pilot-button-ghost"><Download className="h-4 w-4" /> Export CSV</button>
        <button
          onClick={handleGenerateLetter}
          disabled={letterStatus === "generating" || hasMissing}
          title={hasMissing ? `Missing: ${missingList.join(", ")}` : undefined}
          className="pilot-button-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          {letterStatus === "generating" ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</>
          ) : (
            <><Zap className="h-4 w-4" /> Generate utility letter</>
          )}
        </button>
      </div>
    </header>

    {hasMissing && (
      <div
        role="alert"
        className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
        <div className="space-y-1">
          <div className="font-tight font-semibold">Letter cannot be generated yet</div>
          <div className="text-xs text-destructive/90">
            The <b>{preset.label || "selected"}</b> prototype is missing:{" "}
            <span className="font-data">{missingList.join(", ")}</span>. Fields flagged below need
            values before the letter can render.
          </div>
        </div>
      </div>
    )}

    {!hasMissing && (
      <section className="pilot-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            <div>
              <div className="pilot-kicker text-primary">Letter preview</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Read-only render of the {preset.label} utility letter · updates live with the selected prototype
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={downloadPreview} className="pilot-button-ghost">
              <Download className="h-4 w-4" /> Download HTML
            </button>
            <button onClick={printPreview} className="pilot-button-ghost">
              <Printer className="h-4 w-4" /> Print / Save PDF
            </button>
            <button
              onClick={() => setShowPreview((s) => !s)}
              aria-expanded={showPreview}
              aria-label={showPreview ? "Collapse preview" : "Expand preview"}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
            >
              {showPreview ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>
        </div>
        {showPreview && (
          <iframe
            ref={previewIframeRef}
            title="Utility letter preview"
            srcDoc={previewHtml}
            sandbox="allow-same-origin allow-modals"
            className="h-[720px] w-full bg-white"
          />
        )}
      </section>
    )}

    <section className="pilot-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          <span className="pilot-kicker text-primary">McDonald's prototype template</span>
        </div>
        <span className="font-data text-[10px] uppercase tracking-wider text-muted-foreground">
          {preset.kicker}
        </span>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {presets.map((p) => (
          <button
            key={p.id}
            onClick={() => setPresetId(p.id)}
            className={cn(
              "rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
              presetId === p.id
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-muted/30 text-foreground hover:border-primary/50",
              presetId === p.id && (missingFields.label || missingFields.kicker) &&
                "ring-2 ring-destructive/60 ring-offset-2 ring-offset-background"
            )}
          >
            <div className="font-tight font-semibold">{p.label}</div>
            {presetId === p.id && (missingFields.label || missingFields.kicker) && (
              <div className="mt-1 font-data text-[10px] font-semibold uppercase tracking-wider text-destructive">
                Missing {missingFields.label ? "label" : "description"}
              </div>
            )}
          </button>
        ))}
      </div>
    </section>

    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {preset.peaks.map((p) => {
        const isMissing =
          (p.label === "Peak demand" && missingFields.peakDemand) ||
          (p.label === "Service entrance" && missingFields.serviceEntrance);
        return (
          <div
            key={p.label}
            className={cn(
              "pilot-card p-5",
              isMissing && "border-destructive/60 ring-2 ring-destructive/40"
            )}
          >
            <div className="flex items-center justify-between">
              <div className={cn("pilot-kicker", isMissing && "text-destructive")}>{p.label}</div>
              {isMissing ? (
                <AlertTriangle className="h-4 w-4 text-destructive" />
              ) : (
                <Gauge className="h-4 w-4 text-primary" />
              )}
            </div>
            <div className={cn("mt-3 font-data text-2xl font-semibold", isMissing ? "text-destructive" : "text-foreground")}>
              {p.value || "—"}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {isMissing ? "Required for utility letter" : p.delta}
            </div>
          </div>
        );
      })}
    </section>

    <section className="pilot-card p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="pilot-kicker text-primary">24-hour profile</div>
          <h2 className="mt-1 font-tight text-xl font-bold text-foreground">Weekday average · kW per hour — {preset.label}</h2>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-block h-2 w-3 rounded-sm bg-primary" /> Demand
          <span className="ml-3 inline-block h-2 w-3 rounded-sm bg-primary/30" /> Off-peak
        </div>
      </div>
      <div className="mt-6 flex h-48 items-end gap-1.5">
        {hourly.map((v, i) => {
          const h = (v / max) * 100;
          const peak = v >= 70;
          return (
            <div key={i} className="flex flex-1 flex-col items-center gap-1">
              <div
                className={`w-full rounded-t-sm ${peak ? "bg-primary" : "bg-primary/30"}`}
                style={{ height: `${h}%` }}
                title={`${i.toString().padStart(2, "0")}:00 · ${v} kW`}
              />
              {i % 3 === 0 && <span className="font-data text-[10px] text-muted-foreground">{i.toString().padStart(2, "0")}</span>}
            </div>
          );
        })}
      </div>
    </section>

    <section className="pilot-card p-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="pilot-kicker text-primary">Load breakdown</div>
          <h3 className="mt-1 font-tight text-lg font-bold text-foreground">Line items feeding utility application</h3>
        </div>
        <div className="flex flex-col items-end gap-1 font-data text-xs text-muted-foreground">
          <div>
            Sum of items: <span className="font-semibold text-foreground">{breakdownSumKw} kW</span>
            {declaredTotalKw !== undefined && (
              <> · Declared: <span className="font-semibold text-foreground">{declaredTotalKw} kW</span></>
            )}
          </div>
          {declaredTotalKw !== undefined && (
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                totalMismatch
                  ? "border-destructive/50 bg-destructive/10 text-destructive"
                  : "border-primary/40 bg-primary/10 text-primary"
              )}
              title={totalMismatch ? "Breakdown items must sum to the declared total (±0.5 kW)" : "Breakdown items match declared total"}
            >
              {totalMismatch
                ? `Sum mismatch · Δ ${totalDelta > 0 ? "+" : ""}${totalDelta} kW`
                : "Sum check: OK"}
            </span>
          )}
        </div>
      </div>
      {missingFields.breakdownEmpty ? (
        <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          No breakdown line items on this prototype. Add at least one system with a valid kW value.
        </div>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {preset.breakdown.map((b, i) => {
            const invalid = !b.name?.trim() || !Number.isFinite(b.kw) || b.kw <= 0;
            return (
              <div
                key={b.name || `row-${i}`}
                className={cn(
                  "rounded-md border p-3",
                  invalid ? "border-destructive/60 bg-destructive/10" : "border-border bg-muted/20"
                )}
              >
                <div className="flex items-center justify-between">
                  <span className={cn("font-tight text-sm font-semibold", invalid ? "text-destructive" : "text-foreground")}>
                    {b.name || "(missing name)"}
                  </span>
                  <span className={cn("font-data text-sm font-semibold", invalid ? "text-destructive" : "text-primary")}>
                    {Number.isFinite(b.kw) && b.kw > 0 ? `${b.kw} kW` : "— kW"}
                  </span>
                </div>
                <div className={cn("mt-1 text-xs", invalid ? "text-destructive/90" : "text-muted-foreground")}>
                  {invalid ? "Invalid — needs name and positive kW value" : b.note}
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-border">
                  <div
                    className={cn("h-full rounded-full", invalid ? "bg-destructive" : "bg-primary")}
                    style={{ width: `${((Number.isFinite(b.kw) ? Math.max(b.kw, 0) : 0) / Math.max(...preset.breakdown.map((x) => (Number.isFinite(x.kw) ? x.kw : 0)), 1)) * 100}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>

    <section className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <div className="pilot-card overflow-hidden">
        <div className="border-b border-border p-5">
          <div className="pilot-kicker text-primary">Scenarios</div>
          <h3 className="mt-1 font-tight text-lg font-bold text-foreground">What-if modeling</h3>
        </div>
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>{["Scenario", "Peak demand", "Annual energy", "Service risk"].map((h) => <th key={h} className="pilot-kicker px-5 py-3 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody>
            {scenarios.map((s) => (
              <tr key={s.name} className="border-t border-border hover:bg-muted/20">
                <td className="px-5 py-4 font-tight font-semibold text-foreground">{s.name}</td>
                <td className="px-5 py-4 font-data text-foreground">{s.demand}</td>
                <td className="px-5 py-4 font-data text-foreground">{s.energy}</td>
                <td className="px-5 py-4">
                  <span className={`rounded-full border px-2.5 py-1 font-data text-[11px] font-medium ${
                    s.risk === "Low" ? "border-primary/30 bg-primary/10 text-primary"
                    : s.risk === "Medium" ? "border-accent/40 bg-accent/15 text-accent-foreground"
                    : "border-destructive/40 bg-destructive/10 text-destructive"
                  }`}>{s.risk}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="pilot-card p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="pilot-kicker text-primary">Coordinator insights</div>
            <h3 className="mt-1 font-tight text-lg font-bold text-foreground">Agent recommendations</h3>
            <div className="mt-1 font-data text-[10px] uppercase tracking-wider text-muted-foreground">
              {demoMode
                ? "Presentation mode · curated McDonald's demo copy"
                : `Grounded in NEC + ${jurisdiction} + ${utility} process · Gemini 2.5 Flash`}
            </div>
          </div>
          {!demoMode && (
            <button
              onClick={() => void fetchRecs({ force: true })}
              disabled={recStatus === "loading"}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              aria-label="Regenerate recommendations"
              title="Regenerate recommendations"
            >
              <RefreshCw className={cn("h-4 w-4", recStatus === "loading" && "animate-spin")} />
            </button>
          )}
          {demoMode && (
            <span className="flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-data text-[10px] font-medium uppercase tracking-wider text-primary">
              <Sparkles className="h-3 w-3" /> Demo
            </span>
          )}
        </div>

        {demoMode ? (
          <ul className="mt-4 space-y-3 text-sm">
            <li className="flex gap-3"><TrendingUp className="mt-0.5 h-4 w-4 flex-none text-primary" /><span><b className="text-foreground">Right-size service.</b> 1,600 A is correct for base case but undersized for Double DT + Kiosk prototype — request 2,000 A / 480 V switchgear (NEC 220.87).</span></li>
            <li className="flex gap-3"><Battery className="mt-0.5 h-4 w-4 flex-none text-primary" /><span><b className="text-foreground">Add 250 kW storage.</b> Shaves 18% off coincident peak; eligible for FL SREC + Federal ITC stack.</span></li>
            <li className="flex gap-3"><Activity className="mt-0.5 h-4 w-4 flex-none text-primary" /><span><b className="text-foreground">Submit early.</b> FPL transformer lead time for 2 MW-class service in Miami-Dade is currently 34–38 weeks.</span></li>
            <li className="flex gap-3"><BarChart3 className="mt-0.5 h-4 w-4 flex-none text-primary" /><span><b className="text-foreground">Rate election.</b> GSD-1 demand tariff beats GS-1 at projected load factor by ~$31k/yr.</span></li>
          </ul>
        ) : recStatus === "loading" && !recs ? (
          <div className="mt-4 space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex gap-3">
                <div className="mt-0.5 h-4 w-4 flex-none animate-pulse rounded-sm bg-muted" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-full animate-pulse rounded bg-muted/60" />
                </div>
              </div>
            ))}
          </div>
        ) : recStatus === "error" ? (
          <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            Could not reach the UCI agent: {recError}. Try again or enable Presentation mode in Settings.
          </div>
        ) : recs ? (
          <>
            <ul className="mt-4 space-y-3 text-sm">
              {recs.recommendations.map((r, i) => {
                const Icon = r.category === "sizing" ? TrendingUp
                  : r.category === "storage" ? Battery
                  : r.category === "timing" ? Activity
                  : r.category === "rate" ? BarChart3
                  : Sparkles;
                return (
                  <li key={i} className="flex gap-3">
                    <Icon className="mt-0.5 h-4 w-4 flex-none text-primary" />
                    <span>
                      <b className="text-foreground">{r.title}.</b> {r.detail}
                      {r.citation && (
                        <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 font-data text-[10px] text-muted-foreground">
                          {r.citation}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
            {(recs.jurisdictionNotes || recs.utilityNotes) && (
              <div className="mt-4 grid gap-2 border-t border-border pt-3 text-[11px] text-muted-foreground sm:grid-cols-2">
                {recs.jurisdictionNotes && <div><span className="pilot-kicker text-primary">Jurisdiction</span><br/>{recs.jurisdictionNotes}</div>}
                {recs.utilityNotes && <div><span className="pilot-kicker text-primary">Utility</span><br/>{recs.utilityNotes}</div>}
              </div>
            )}
          </>
        ) : null}
      </div>
    </section>
  </div>
  {inlineLetter && (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Utility letter preview"
      className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border bg-card px-5 py-3">
        <div>
          <div className="pilot-kicker text-primary">Utility letter preview</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            Popup was blocked — the letter is rendered inline. Print, save as PDF, or download the HTML.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={downloadInlineLetter} className="pilot-button-ghost">
            <Download className="h-4 w-4" /> Download HTML
          </button>
          <button onClick={printInlineLetter} className="pilot-button-primary">
            <Printer className="h-4 w-4" /> Print / Save PDF
          </button>
          <button
            onClick={() => setInlineLetter(null)}
            aria-label="Close preview"
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <iframe
        ref={letterIframeRef}
        title="Utility letter preview"
        srcDoc={inlineLetter.html}
        className="flex-1 w-full bg-white"
      />
    </div>
  )}
  </>
);
};

export default LoadProfileAnalyzer;