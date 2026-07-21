import { useSearchParams } from "react-router-dom";
import { AlertOctagon, ArrowDownRight, ArrowUpRight, CheckCircle2, Download, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const SirExecutive = () => {
  const [params] = useSearchParams();
  const red = params.get("status") === "red";

  return (
    <div className="space-y-6">
      <header className={cn("rounded-2xl border p-6", red ? "border-destructive/40 bg-destructive/5" : "border-border bg-card")}>
        <div className={cn("pilot-kicker", red ? "text-destructive" : "text-primary")}>Executive SIR · for principals</div>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Go / No-Go Brief</h1>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <span className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium",
            red ? "border-destructive bg-destructive/10 text-destructive" : "border-success bg-success/10 text-success")}>
            {red ? <AlertOctagon className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            Status: {red ? "Critical" : "Conditional Go"}
          </span>
          <span className="text-sm text-muted-foreground">Decision deadline: <span className="font-data text-foreground">Oct 04</span></span>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <Stat label="Projected NTP" value={red ? "+11 weeks slip" : "Apr 18, 2024"} tone={red ? "destructive" : "primary"} Icon={red ? ArrowDownRight : ArrowUpRight} />
        <Stat label="Capital Risk" value={red ? "$1.8M exposure" : "$240k contingency OK"} tone={red ? "destructive" : "success"} Icon={red ? AlertOctagon : CheckCircle2} />
        <Stat label="Confidence" value={red ? "32%" : "78%"} tone={red ? "warning" : "success"} Icon={Sparkles} />
      </div>

      <section className="pilot-card p-5">
        <h2 className="font-tight text-lg font-bold">Why this rating?</h2>
        <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
          {(red
            ? [
              "Gas service conflict with planned column line C-6; reroute = +$640k.",
              "Historic overlay HD-MTV triggered HPRB review (typ. +12 weeks).",
              "Adjacent excavation embargo Q1 — interferes with utility tie-in.",
            ]
            : [
              "All 12 jurisdictional sources reconciled with no critical blockers.",
              "Utility coordination feasible within current schedule.",
              "Code path identified for assembly occupancy with sprinkler trade-off.",
            ]
          ).map((line) => (
            <li key={line} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />{line}</li>
          ))}
        </ul>
      </section>

      <div className="flex gap-2">
        <button className="pilot-button-ghost"><Download className="h-4 w-4" /> Export PDF</button>
        <button className="pilot-button-primary"><Sparkles className="h-4 w-4" /> Sync to ESIR</button>
      </div>
    </div>
  );
};

type IconType = typeof CheckCircle2;
const Stat = ({ label, value, tone, Icon }: { label: string; value: string; tone: "primary" | "success" | "warning" | "destructive"; Icon: IconType }) => {
  const toneClass = { primary: "text-primary", success: "text-success", warning: "text-warning", destructive: "text-destructive" }[tone];
  return (
    <div className="pilot-card p-5">
      <div className="pilot-kicker text-muted-foreground">{label}</div>
      <div className={cn("mt-1 flex items-center gap-2 font-display text-2xl font-semibold", toneClass)}>
        <Icon className="h-5 w-5" /> {value}
      </div>
    </div>
  );
};

export default SirExecutive;