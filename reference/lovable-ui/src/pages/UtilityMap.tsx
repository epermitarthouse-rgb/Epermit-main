import { Layers, LocateFixed, MapPinned, RadioTower } from "lucide-react";
import { PageHeader, Panel, StatusPill } from "@/components/permitpilot/ProductPrimitives";

const UtilityMap = () => (
  <div>
    <PageHeader eyebrow="Utility coordination" title="Utility Mapping Interface" body="Layer utilities, conflicts, easements, meter sets, provider areas, and inspector release signals for the active project." />
    <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
      <Panel className="min-h-[620px] overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-border p-4"><div><div className="pilot-kicker">Project Alpha</div><h2 className="font-tight text-lg font-bold">Elm St. intersection</h2></div><StatusPill tone="bad">Gas conflict</StatusPill></div>
        <div className="relative h-[540px] bg-muted signal-grid">
          <div className="absolute left-[12%] top-[28%] h-2 w-[72%] rotate-6 rounded-full bg-pilot-cyan/80 shadow-lg shadow-pilot-cyan/20" />
          <div className="absolute left-[18%] top-[52%] h-2 w-[64%] -rotate-12 rounded-full bg-warning/80 shadow-lg shadow-warning/20" />
          <div className="absolute left-[48%] top-[14%] h-[72%] w-2 rotate-3 rounded-full bg-success/80 shadow-lg shadow-success/20" />
          <div className="absolute left-[54%] top-[44%] flex h-14 w-14 items-center justify-center rounded-full border-2 border-destructive bg-destructive/20 text-destructive"><LocateFixed className="h-7 w-7" /></div>
          <div className="absolute bottom-4 left-4 rounded-md border border-border bg-background/90 p-3 backdrop-blur"><div className="pilot-kicker">Conflict #U-118</div><div className="mt-1 text-sm">Gas line crosses proposed duct bank.</div></div>
        </div>
      </Panel>
      <div className="space-y-6">
        <Panel title="Utility layers" eyebrow="Visible"><Layer icon={RadioTower} label="Electric / Transformer" active /><Layer icon={MapPinned} label="Gas routing" active warning /><Layer icon={Layers} label="Water / Sewer" active /><Layer icon={LocateFixed} label="ROW & Easements" /></Panel>
        <Panel title="AI conflict note" eyebrow="Cross-utility hunter"><p className="text-sm leading-6 text-muted-foreground">Conflict Hunter recommends approving the re-route and notifying BGE engineer before the DDOT supplemental filing window closes.</p><button className="pilot-button-primary mt-5">Draft approval memo</button></Panel>
      </div>
    </div>
  </div>
);

const Layer = ({ icon: Icon, label, active, warning }: { icon: typeof Layers; label: string; active?: boolean; warning?: boolean }) => <div className="flex items-center justify-between border-b border-border py-3 last:border-0"><div className="flex items-center gap-3"><Icon className={warning ? "h-4 w-4 text-warning" : "h-4 w-4 text-primary"} /><span className="text-sm">{label}</span></div><StatusPill tone={warning ? "warn" : active ? "good" : "default"}>{active ? "On" : "Off"}</StatusPill></div>;

export default UtilityMap;