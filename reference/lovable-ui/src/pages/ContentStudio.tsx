import { FileText, Image as ImageIcon, Mail, Megaphone, Newspaper, Sparkles, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";

const templates = [
  { Icon: Mail, title: "Stakeholder Email", body: "AI-drafted updates with timeline, blockers, and next steps." },
  { Icon: Newspaper, title: "Weekly Owner Report", body: "Branded PDF with KPIs, milestones, and call-outs." },
  { Icon: Megaphone, title: "Community Notice", body: "Public notice posts for jurisdictional requirements." },
  { Icon: FileText, title: "Permit Cover Letter", body: "Auto-generated cover letters per agency template." },
  { Icon: ImageIcon, title: "Hero Renderings", body: "AI-generated facade renderings from site plans." },
];

const recent = [
  { title: "Owner Weekly · Wk 41", channel: "PDF", at: "2h ago" },
  { title: "DDOT public notice — 75 NY Ave", channel: "Print + Web", at: "Yesterday" },
  { title: "Comment response — DOB cycle 2", channel: "Email", at: "Oct 12" },
];

const ContentStudio = () => (
  <div className="space-y-6">
    <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="pilot-kicker text-primary">AI Content Studio</div>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Drafts &amp; Outreach</h1>
        <p className="mt-1 text-sm text-muted-foreground">Generate, refine, and dispatch project-aware content.</p>
      </div>
      <button className="pilot-button-primary"><Wand2 className="h-4 w-4" /> New Draft</button>
    </header>

    <section className="grid gap-4 md:grid-cols-3">
      {templates.map((t) => (
        <article key={t.title} className={cn("pilot-card group flex flex-col gap-3 p-5 transition-colors hover:border-primary/50")}>
          <t.Icon className="h-6 w-6 text-primary" />
          <h2 className="font-tight text-lg font-bold">{t.title}</h2>
          <p className="text-sm text-muted-foreground">{t.body}</p>
          <button className="mt-auto self-start pilot-button-ghost"><Sparkles className="h-4 w-4" /> Generate</button>
        </article>
      ))}
    </section>

    <section className="pilot-card overflow-hidden">
      <header className="border-b border-border bg-muted/30 px-5 py-3">
        <h3 className="font-tight text-base font-bold">Recent Drafts</h3>
      </header>
      <ul className="divide-y divide-border">
        {recent.map((r) => (
          <li key={r.title} className="flex items-center justify-between px-5 py-3 text-sm">
            <span className="font-medium">{r.title}</span>
            <span className="text-xs text-muted-foreground">{r.channel} · {r.at}</span>
          </li>
        ))}
      </ul>
    </section>
  </div>
);

export default ContentStudio;