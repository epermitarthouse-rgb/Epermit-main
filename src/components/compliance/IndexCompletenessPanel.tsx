import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, AlertTriangle, Info } from "lucide-react";
import type { IndexCompletenessResult } from "@/lib/codeAnalyzer/indexCompleteness";

interface IndexCompletenessPanelProps {
  result: IndexCompletenessResult | null;
  loading?: boolean;
}

function statusBadge(result: IndexCompletenessResult) {
  if (result.status === "complete") {
    return (
      <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
        Complete
      </Badge>
    );
  }
  if (result.status === "no_index") {
    return <Badge variant="secondary">No index detected</Badge>;
  }
  return (
    <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
      Incomplete
    </Badge>
  );
}

export function IndexCompletenessPanel({ result, loading }: IndexCompletenessPanelProps) {
  if (loading) {
    return (
      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Pre-Screening · Drawing Set Completeness</CardTitle>
          <CardDescription>Checking index against uploaded sheets…</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!result) return null;

  return (
    <Card className="border-border" data-testid="index-completeness-panel">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">Pre-Screening · Drawing Set Completeness</CardTitle>
          {statusBadge(result)}
        </div>
        <CardDescription>
          Deterministic comparison of the drawing index (when present) against included sheets.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {result.status === "no_index" ? (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              No Drawing Index sheet was detected. Upload a sheet titled &quot;Drawing Index&quot; or
              similar to enable completeness checking ({result.actualCount} included sheet
              {result.actualCount === 1 ? "" : "s"} present).
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <div className="flex flex-wrap gap-4 text-muted-foreground">
              <span>
                Expected: <strong className="text-foreground">{result.expectedCount}</strong>
              </span>
              <span>
                Uploaded: <strong className="text-foreground">{result.comparedSheetCount}</strong>
              </span>
              <span>
                Missing: <strong className="text-foreground">{result.missing.length}</strong>
              </span>
              <span>
                Extra: <strong className="text-foreground">{result.extra.length}</strong>
              </span>
              <span>
                Duplicates: <strong className="text-foreground">{result.duplicates.length}</strong>
              </span>
            </div>

            {result.status === "complete" ? (
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>Index matches the included drawing set.</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>Index and uploaded sheets differ — review before relying on analysis.</span>
              </div>
            )}

            {result.missing.length > 0 && (
              <div>
                <p className="font-medium text-foreground mb-1">Missing from upload</p>
                <ul className="list-disc pl-5 space-y-0.5 text-muted-foreground">
                  {result.missing.map((row) => (
                    <li key={row.sheetNumber}>
                      {row.rawLabel}
                      {row.title ? ` — ${row.title}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.extra.length > 0 && (
              <div>
                <p className="font-medium text-foreground mb-1">Extra (not on index)</p>
                <ul className="list-disc pl-5 space-y-0.5 text-muted-foreground">
                  {result.extra.map((row) => (
                    <li key={`${row.sheetNumber}-${row.rawLabel}`}>
                      {row.rawLabel}
                      {row.title ? ` — ${row.title}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.duplicates.length > 0 && (
              <div>
                <p className="font-medium text-foreground mb-1">Duplicate sheet numbers</p>
                <ul className="list-disc pl-5 space-y-0.5 text-muted-foreground">
                  {result.duplicates.map((dup) => (
                    <li key={dup.sheetNumber}>
                      {dup.rawLabels.join(", ")} ({dup.sheetIds.length} sheets)
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.numberingInconsistencies.length > 0 && (
              <div>
                <p className="font-medium text-foreground mb-1">Numbering inconsistencies</p>
                <ul className="list-disc pl-5 space-y-0.5 text-muted-foreground">
                  {result.numberingInconsistencies.map((item) => (
                    <li key={item.sheetNumber}>{item.variants.join(" vs ")}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
