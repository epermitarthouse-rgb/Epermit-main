import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { MergedUciActionItem } from "@/lib/uciActionTracker";
import { statusBadgeClass } from "@/lib/uciActionTracker";
import type { UciOverlayPatch } from "@/hooks/useUciActionTrackerOverlay";
import type { UciTrackerStatus } from "@/types/uciActionTracker";
import { UCI_TRACKER_STATUSES } from "@/types/uciActionTracker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type Props = {
  item: MergedUciActionItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (sequence: number, patch: UciOverlayPatch) => void;
  onReset: (sequence: number) => void;
};

function EvidenceBlock({ item }: { item: MergedUciActionItem }) {
  const e = item.evidence;
  if (!e) return <p className="text-sm text-muted-foreground">No evidence recorded.</p>;
  const sections: { label: string; values?: string[] }[] = [
    { label: "Paths", values: e.paths },
    { label: "Services", values: e.services },
    { label: "API routes", values: e.routes },
    { label: "Migrations", values: e.migrations },
    { label: "Tests", values: e.tests },
    { label: "UI routes", values: e.uiRoutes },
  ];
  return (
    <div className="space-y-3">
      {e.testResult && (
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Test result
          </div>
          <p className="mt-1 text-sm">{e.testResult}</p>
        </div>
      )}
      {sections.map((section) =>
        section.values && section.values.length > 0 ? (
          <div key={section.label}>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {section.label}
            </div>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-xs font-mono text-foreground/90">
              {section.values.map((v) => (
                <li key={v} className="break-all">
                  {v}
                </li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
    </div>
  );
}

export function UciActionTrackerDetailSheet({
  item,
  open,
  onOpenChange,
  onSave,
  onReset,
}: Props) {
  const [status, setStatus] = useState<UciTrackerStatus>("Partial");
  const [blockerGap, setBlockerGap] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [notes, setNotes] = useState("");
  const [lastVerified, setLastVerified] = useState("");

  useEffect(() => {
    if (!item) return;
    setStatus(item.effectiveStatus);
    setBlockerGap(item.effectiveBlockerGap);
    setNextAction(item.effectiveNextAction);
    setNotes(item.effectiveNotes);
    setLastVerified(item.effectiveLastVerified);
  }, [item]);

  if (!item) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="pr-8 text-left">
            #{item.sequence} · {item.actionItem}
          </SheetTitle>
          <SheetDescription className="text-left">{item.phaseWeek}</SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex flex-wrap gap-2">
          <Badge variant="outline" className={statusBadgeClass(item.effectiveStatus)}>
            {item.effectiveStatus}
          </Badge>
          <Badge variant="outline">{item.scope === "pilot" ? "Pilot" : "Deferred"}</Badge>
          {item.criticalPath && <Badge variant="destructive">Critical path</Badge>}
          {item.overlayApplied && <Badge variant="secondary">Local edit</Badge>}
          {item.subStatus && <Badge variant="outline">{item.subStatus}</Badge>}
        </div>

        <div className="mt-6 space-y-5 text-sm">
          <section>
            <h3 className="font-medium">Client requirement</h3>
            <p className="mt-1 text-muted-foreground">{item.clientRequirement}</p>
          </section>

          <section>
            <h3 className="font-medium">Actual status explanation</h3>
            <p className="mt-1 text-muted-foreground">{item.statusExplanation}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Spreadsheet baseline: {item.spreadsheetStatus}
            </p>
          </section>

          <section className="grid gap-3 rounded-lg border bg-muted/30 p-3">
            <h3 className="font-medium">Edit (local overlay)</h3>
            <div className="space-y-2">
              <Label htmlFor="uci-status">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as UciTrackerStatus)}>
                <SelectTrigger id="uci-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UCI_TRACKER_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="uci-blocker">Current blocker / gap</Label>
              <Textarea
                id="uci-blocker"
                value={blockerGap}
                onChange={(e) => setBlockerGap(e.target.value)}
                rows={4}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="uci-next">Next action</Label>
              <Textarea
                id="uci-next"
                value={nextAction}
                onChange={(e) => setNextAction(e.target.value)}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="uci-notes">Notes</Label>
              <Textarea
                id="uci-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="uci-verified">Last verified</Label>
              <Input
                id="uci-verified"
                value={lastVerified}
                onChange={(e) => setLastVerified(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => {
                  onSave(item.sequence, {
                    status,
                    blockerGap,
                    nextAction,
                    notes,
                    lastVerified,
                  });
                  toast.success(`Saved local overlay for #${item.sequence}`);
                }}
              >
                Save overlay
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  onReset(item.sequence);
                  toast.message(`Reset #${item.sequence} to baseline JSON`);
                }}
              >
                Reset to baseline
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Edits persist in this browser via localStorage. Baseline remains the
              version-controlled tracker JSON.
            </p>
          </section>

          <section>
            <h3 className="font-medium">Agent / lifecycle</h3>
            <p className="mt-1 text-muted-foreground">
              Agent: {item.agent ?? "—"} · Stage: {item.lifecycleStage ?? "—"} · Bucket:{" "}
              {item.bucket}
            </p>
          </section>

          <section>
            <h3 className="font-medium">Verification source</h3>
            <p className="mt-1 text-muted-foreground">{item.verificationSource}</p>
          </section>

          <section>
            <h3 className="font-medium">Code evidence</h3>
            <div className="mt-2">
              <EvidenceBlock item={item} />
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
