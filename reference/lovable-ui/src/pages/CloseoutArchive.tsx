import { useSearchParams } from "react-router-dom";
import { Archive, CheckCircle2, FileBox, FolderArchive, Sparkles, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

const bundles = [
  { name: "Drawings (Final, signed)", size: "412 MB", items: 184, included: true },
  { name: "Permits & Approvals", size: "62 MB", items: 23, included: true },
  { name: "Inspection Reports", size: "108 MB", items: 47, included: true },
  { name: "Field Captures (photos/notes)", size: "1.4 GB", items: 1206, included: true },
  { name: "Messages (filtered Project)", size: "9 MB", items: 1872, included: false },
  { name: "AI Run Logs", size: "22 MB", items: 5113, included: false },
];

const CloseoutArchive = () => {
  const [params, setParams] = useSearchParams();
  const v31 = params.get("view") === "v3.1";

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="pilot-kicker text-primary">Archive & Closeout</div>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Bundle for Cold Storage</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border bg-card p-0.5 text-xs">
            {(["v3", "v3.1"] as const).map((v) => {
              const active = (v === "v3.1") === v31;
              return (
                <button key={v} onClick={() => setParams(v === "v3.1" ? { view: "v3.1" } : {}, { replace: true })} className={cn("rounded px-3 py-1.5 transition-colors", active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                  {v}
                </button>
              );
            })}
          </div>
          <button className="pilot-button-primary"><Archive className="h-4 w-4" /> Build Archive</button>
        </div>
      </header>

      <section className="pilot-card p-5">
        <h2 className="flex items-center gap-2 font-tight text-base font-bold"><FolderArchive className="h-4 w-4 text-primary" /> Bundle Contents</h2>
        <ul className="mt-3 divide-y divide-border">
          {bundles.map((b) => (
            <li key={b.name} className="flex items-center gap-4 py-3 text-sm">
              <input type="checkbox" defaultChecked={b.included} className="h-4 w-4 rounded border-border" />
              <FileBox className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1 font-medium">{b.name}</span>
              <span className="w-20 font-data text-xs text-muted-foreground">{b.items} items</span>
              <span className="w-24 text-right font-data text-xs">{b.size}</span>
            </li>
          ))}
        </ul>
      </section>

      {v31 && (
        <section className="pilot-card flex items-start gap-3 p-5">
          <Sparkles className="h-5 w-5 text-primary" />
          <div>
            <h3 className="font-tight font-bold">AI Bundle Assistant</h3>
            <p className="mt-1 text-sm text-muted-foreground">Detected 14 duplicate field photos and 3 superseded drawings. Exclude from archive to save 380 MB.</p>
            <button className="mt-2 pilot-button-ghost"><CheckCircle2 className="h-4 w-4" /> Apply</button>
          </div>
        </section>
      )}

      <section className="pilot-card flex items-center gap-3 p-5">
        <Lock className="h-5 w-5 text-muted-foreground" />
        <div className="flex-1 text-sm"><span className="font-medium">Archive policy:</span> immutable, AES-256 at rest, 7-year retention.</div>
      </section>
    </div>
  );
};

export default CloseoutArchive;