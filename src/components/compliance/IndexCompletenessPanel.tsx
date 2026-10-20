import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, ChevronDown, Loader2 } from "lucide-react";
import type { IndexCompletenessResult } from "@/lib/codeAnalyzer/indexCompleteness";
import {
  presentIndexCompleteness,
  type PresentedSheetRef,
} from "@/lib/codeAnalyzer/indexCompletenessView";

interface IndexCompletenessPanelProps {
  result: IndexCompletenessResult | null;
  loading?: boolean;
  /** Non-fatal recheck error while preserving the last good result. */
  recheckError?: string | null;
}

function statusBadge(label: "Detected" | "Partial" | "Not Detected", tone: "clear" | "attention") {
  if (label === "Not Detected") return <Badge variant="secondary">Not Detected</Badge>;
  if (label === "Detected" && tone === "clear") {
    return (
      <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
        Detected
      </Badge>
    );
  }
  return (
    <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
      {label}
    </Badge>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2 min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold text-foreground tabular-nums truncate">{value}</div>
    </div>
  );
}

function DetailGroup({
  title,
  count,
  note,
  entries,
  emptyLabel,
}: {
  title: string;
  count: number;
  note?: string | null;
  entries: PresentedSheetRef[];
  emptyLabel: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted/40"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="font-medium text-foreground">{title}</span>
        <span className="flex items-center gap-2 text-muted-foreground">
          <span className="tabular-nums">{count}</span>
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open ? (
        <div className="border-t border-border px-3 py-2">
          {note ? <p className="mb-2 text-xs text-muted-foreground">{note}</p> : null}
          {entries.length === 0 ? (
            count === 0 ? <p className="text-sm text-muted-foreground">{emptyLabel}</p> : null
          ) : (
            <ul className="max-h-48 space-y-1 overflow-y-auto text-sm text-muted-foreground">
              {entries.map((entry) => (
                <li key={entry.key}>
                  <span className="text-foreground">{entry.label}</span>
                  {entry.detail ? ` — ${entry.detail}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function IndexCompletenessPanel({ result, loading, recheckError }: IndexCompletenessPanelProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  if (!result && loading) {
    return (
      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Drawing Set Completeness</CardTitle>
          <CardDescription>Checking the drawing index against uploaded sheets…</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!result) return null;

  const view = presentIndexCompleteness(result);

  return (
    <Card className="border-border" data-testid="index-completeness-panel">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-base">Drawing Set Completeness</CardTitle>
            <CardDescription>{view.headline}</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {loading ? (
              <Badge variant="outline" className="gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                Rechecking…
              </Badge>
            ) : null}
            {statusBadge(
              view.statusLabel,
              view.missingSheets === 0 && view.extraSheets === 0 ? "clear" : "attention",
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {recheckError ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>Recheck failed — showing the last result. {recheckError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label="Index status" value={view.statusLabel} />
          <Stat label="Uploaded sheets" value={view.uploadedSheets} />
          <Stat label="Matched sheets" value={view.indexStatus === "not_detected" ? "—" : view.matchedSheets} />
          <Stat label="Missing sheets" value={view.indexStatus === "not_detected" ? "—" : view.missingSheets} />
          <Stat label="Extra sheets" value={view.extraSheets == null ? "Not assessed" : view.extraSheets} />
          <Stat label="OCR uncertain" value={view.ocrUncertain} />
        </div>

        {view.note ? <p className="text-xs text-muted-foreground">{view.note}</p> : null}

        {view.coverageLine ? (
          <div className="space-y-1">
            <p className="text-sm text-foreground">{view.coverageLine}</p>
            <p className="text-xs text-muted-foreground">{view.coverageDisclaimer}</p>
          </div>
        ) : null}

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full sm:w-auto"
          aria-expanded={detailsOpen}
          onClick={() => setDetailsOpen((open) => !open)}
        >
          {detailsOpen ? "Hide Details" : "View Details"}
        </Button>

        {detailsOpen ? (
          <div className="space-y-2">
            <DetailGroup
              title="Missing from upload"
              count={view.missing.length}
              entries={view.missing}
              emptyLabel="No confidently missing sheets."
            />
            <DetailGroup
              title={view.extraGroupTitle}
              count={view.extra.length}
              note={view.extraGroupNote}
              entries={view.extra}
              emptyLabel="No uploaded sheets are absent from the index."
            />
            <DetailGroup
              title="OCR uncertain or unrecognized"
              count={view.uncertain.length}
              note="These tokens were read from the index but are not confirmed missing drawings."
              entries={view.uncertain}
              emptyLabel="No uncertain OCR tokens."
            />
            <DetailGroup
              title="Matched sheets"
              count={view.matchedSheets}
              note={view.matchedNote}
              entries={[]}
              emptyLabel={view.matchedNote}
            />
            <DetailGroup
              title="Analysis coverage"
              count={view.coverageSheets.length}
              note={view.coverageLine ? `${view.coverageLine} ${view.coverageDisclaimer}` : view.coverageDisclaimer}
              entries={view.coverageSheets.map((name) => ({ key: name, label: name, detail: null }))}
              emptyLabel="No sheet-by-sheet coverage list is stored yet."
            />
            {view.duplicates.length > 0 ? (
              <DetailGroup
                title="Duplicate sheet numbers"
                count={view.duplicates.length}
                entries={view.duplicates}
                emptyLabel="No duplicate sheet numbers."
              />
            ) : null}
            {view.inconsistencies.length > 0 ? (
              <DetailGroup
                title="Numbering inconsistencies"
                count={view.inconsistencies.length}
                entries={view.inconsistencies}
                emptyLabel="No numbering inconsistencies."
              />
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
