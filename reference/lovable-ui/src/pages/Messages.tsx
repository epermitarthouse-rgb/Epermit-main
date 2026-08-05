import { useSearchParams } from "react-router-dom";
import { useState } from "react";
import { AlertTriangle, AtSign, Check, CheckCheck, Inbox, Paperclip, Search, Send, Sparkles, Star } from "lucide-react";
import { cn } from "@/lib/utils";

type Thread = {
  id: string;
  subject: string;
  preview: string;
  from: string;
  project: string;
  priority: "high" | "normal";
  unread?: boolean;
  at: string;
  aiSummary?: string;
  mentions?: string[];
  readReceipt?: "sent" | "delivered" | "read";
};

const threads: Thread[] = [
  { id: "M-1", subject: "Environmental Impact Report Delay", preview: "DOEE flagged stormwater calc on sheet C-501…", from: "DOEE · J. Hill", project: "PRJ-2023-089A", priority: "high", unread: true, at: "10:42", aiSummary: "Action: revise SWM calc; deadline Oct 18; affects critical path by +3d.", mentions: ["@sjenkins", "@dokafor"], readReceipt: "delivered" },
  { id: "M-2", subject: "Zoning Variance Application", preview: "Confirming hearing slot Nov 04 @ 9:30am…", from: "DCRA · M. Patel", project: "PRJ-2023-112C", priority: "normal", at: "09:15", aiSummary: "Awaiting your confirmation. No deadline impact.", mentions: ["@ian"], readReceipt: "read" },
  { id: "M-3", subject: "Weekly Coordination Sync", preview: "Agenda + last week's notes attached.", from: "Internal · S. Jenkins", project: "Internal Ops", priority: "normal", at: "Yesterday", readReceipt: "read" },
  { id: "M-4", subject: "Final Inspection Scheduled", preview: "FEMS inspector confirmed Oct 30, 10am.", from: "FEMS · A. Brown", project: "PRJ-2023-045B", priority: "normal", at: "Oct 12", aiSummary: "Inspection confirmed; pre-inspect checklist auto-added to your tasks.", mentions: ["@charlotte", "@franchisee-4471"], readReceipt: "sent" },
];

const ReadReceipt = ({ state }: { state?: Thread["readReceipt"] }) => {
  if (!state) return null;
  if (state === "read") return <span title="Read" className="inline-flex items-center text-primary"><CheckCheck className="h-3 w-3" /></span>;
  if (state === "delivered") return <span title="Delivered" className="inline-flex items-center text-muted-foreground"><CheckCheck className="h-3 w-3" /></span>;
  return <span title="Sent" className="inline-flex items-center text-muted-foreground"><Check className="h-3 w-3" /></span>;
};

const Messages = () => {
  const [params, setParams] = useSearchParams();
  const enhanced = params.get("view") === "enhanced";
  const [activeId, setActiveId] = useState<string>(threads[0].id);
  const active = threads.find((t) => t.id === activeId)!;

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="pilot-kicker text-primary">Messaging Portal</div>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Inbox</h1>
          <p className="mt-1 text-sm text-muted-foreground">{threads.filter((t) => t.unread).length} unread · 4 threads</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border bg-card p-0.5 text-xs">
            {(["v3", "enhanced"] as const).map((v) => {
              const active = (v === "enhanced") === enhanced;
              return (
                <button key={v} onClick={() => setParams(v === "enhanced" ? { view: "enhanced" } : {}, { replace: true })} className={cn("rounded px-3 py-1.5 transition-colors", active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                  {v === "enhanced" ? "Enhanced + AI" : "v3"}
                </button>
              );
            })}
          </div>
          <button className="pilot-button-primary"><Sparkles className="h-4 w-4" /> Compose</button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <aside className="pilot-card overflow-hidden">
          <div className="border-b border-border p-3">
            <label className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1.5">
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
              <input className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground" placeholder="Search threads" />
            </label>
          </div>
          <ul className="divide-y divide-border">
            {threads.map((t) => (
              <li key={t.id}>
                <button onClick={() => setActiveId(t.id)} className={cn("flex w-full items-start gap-2 p-3 text-left transition-colors hover:bg-muted/40", activeId === t.id && "bg-muted/50")}>
                  {t.priority === "high" ? <AlertTriangle className="mt-1 h-4 w-4 text-destructive" /> : <Inbox className="mt-1 h-4 w-4 text-muted-foreground" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn("truncate text-sm", t.unread ? "font-bold text-foreground" : "font-medium text-foreground/80")}>{t.subject}</span>
                      <span className="inline-flex items-center gap-1 font-data text-[10px] text-muted-foreground">
                        <ReadReceipt state={t.readReceipt} />
                        {t.at}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{t.from}</p>
                    <p className="truncate text-xs text-muted-foreground">{t.preview}</p>
                    {t.mentions && t.mentions.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {t.mentions.map((m) => (
                          <span key={m} className="inline-flex items-center gap-0.5 rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-data text-[9px] font-semibold text-primary">
                            <AtSign className="h-2.5 w-2.5" /> {m.replace("@", "")}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="pilot-card flex flex-col">
          <header className="flex items-start justify-between border-b border-border p-5">
            <div>
              <div className="pilot-kicker text-muted-foreground">{active.project}</div>
              <h2 className="mt-1 font-tight text-lg font-bold">{active.subject}</h2>
              <p className="text-xs text-muted-foreground">From {active.from} · {active.at}</p>
            </div>
            <button className="pilot-button-ghost"><Star className="h-4 w-4" /> Star</button>
          </header>

          {enhanced && active.aiSummary && (
            <div className="mx-5 mt-4 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
              <div className="flex items-center gap-2 pilot-kicker text-primary"><Sparkles className="h-3.5 w-3.5" /> AI Summary</div>
              <p className="mt-1 text-foreground">{active.aiSummary}</p>
            </div>
          )}

          <div className="flex-1 space-y-3 p-5 text-sm text-foreground">
            <p>{active.preview}</p>
            <p className="text-muted-foreground">
              Full thread body lorem ipsum dolor sit amet, consectetur adipiscing elit. Please advise on next steps so we can keep the schedule.
            </p>
          </div>

          <footer className="border-t border-border p-3">
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1.5">
              <Paperclip className="h-4 w-4 text-muted-foreground" />
              <input className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground" placeholder="Reply…" />
              <button className="pilot-button-primary"><Send className="h-4 w-4" /> Send</button>
            </div>
          </footer>
        </section>
      </div>
    </div>
  );
};

export default Messages;