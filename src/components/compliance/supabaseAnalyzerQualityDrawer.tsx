import React, { useMemo, useState } from "react";
import { ChevronDown, ListChecks } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { AnalyzerRunDataset } from "@/lib/supabaseAnalyzer/client";
import {
  NOT_MEASURED,
  evaluateAnalyzerQuality,
  formatQualityMetric,
  type QualityEvaluationReport,
  type QualityMetric,
} from "@/lib/supabaseAnalyzer/qualityEvaluation";
import { cn } from "@/lib/utils";

function MetricLine({ label, metric }: { label: string; metric: QualityMetric }) {
  const value = formatQualityMetric(metric);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-foreground">{label}</span>
        <span
          className={cn("text-sm font-medium", value === NOT_MEASURED ? "text-muted-foreground" : "font-mono text-foreground")}
          data-testid={`quality-metric-${label.toLowerCase().replace(/\s+/g, "-")}`}
        >
          {value}
        </span>
      </div>
      {metric.status === "not_measured" ? (
        <p className="text-xs text-muted-foreground">{metric.reason}</p>
      ) : (
        <p className="text-xs text-muted-foreground">{metric.numerator} of {metric.denominator} verified labels</p>
      )}
    </div>
  );
}

function QualityBody({ report }: { report: QualityEvaluationReport }) {
  return (
    <div className="space-y-5 text-sm" data-testid="analyzer-quality-evaluation-body">
      <p className="text-xs leading-relaxed text-muted-foreground">{report.disclaimer}</p>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Accuracy (verified reference)</h3>
        <MetricLine label="Precision" metric={report.precision} />
        <MetricLine label="Recall" metric={report.recall} />
        <MetricLine label="False positives" metric={report.falsePositiveRate} />
        <MetricLine label="False negatives" metric={report.falseNegativeRate} />
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Known-error regression</h3>
        {report.verifiedRegression.labeled === 0 ? (
          <p className="text-xs text-muted-foreground">
            {NOT_MEASURED}. This analysis did not match the frozen known-error cases.
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {report.verifiedRegression.labeled} verified cases · {report.verifiedRegression.stillPublished} still published · {report.verifiedRegression.mitigated} mitigated
              {report.verifiedRegression.unmatched ? ` · ${report.verifiedRegression.unmatched} unmatched` : ""}. This is not an overall accuracy score.
            </p>
            <ul className="space-y-2">
              {report.cases.filter((item) => item.use === "regression").map((item) => (
                <li key={item.id} className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{item.summary}</span>
                    {item.matchedReportId ? <span className="font-mono text-xs text-muted-foreground">{item.matchedReportId}</span> : null}
                    <Badge variant="outline" className="text-[10px] uppercase">{item.outcome.replace(/_/g, " ")}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{item.rationale}</p>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Provisional examples</h3>
        <p className="text-xs text-muted-foreground">
          Not scored. These notes are not independently confirmed and are not used as precision or recall.
        </p>
        <ul className="space-y-1.5">
          {report.provisional.map((item) => (
            <li key={item.id} className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{item.summary}</span>
              {item.matchedReportId ? ` · ${item.matchedReportId}` : ""} — {item.rationale}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Review coverage</h3>
        <p className="text-xs text-muted-foreground">
          {report.coverage.completed} of {report.coverage.sheets} sheets completed · {report.coverage.withFindings} with findings · {report.coverage.failed} failed · {report.coverage.pending} in progress · {report.coverage.publishedFindings} published findings · {report.coverage.withdrawnFindings} withdrawn. Coverage is process completeness, not completeness of code issues.
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Evidence support (heuristic)</h3>
        <p className="text-xs text-muted-foreground">
          {report.evidence.present} of {report.evidence.total} findings include specific drawing evidence. {report.evidence.note}
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Persist-time rule overlay</h3>
        {report.persistRuleOverlay.status === "measured" ? (
          <p className="text-xs text-muted-foreground">
            {report.persistRuleOverlay.wouldWithhold} of {report.persistRuleOverlay.published} stored findings would be withheld if submitted under current persist-time rules. Historical rows were not rewritten.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">{NOT_MEASURED}. {report.persistRuleOverlay.reason}</p>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Breakdown</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-medium text-foreground">By discipline</p>
            <ul className="space-y-0.5 text-xs text-muted-foreground">
              {report.byDiscipline.slice(0, 8).map((row) => (
                <li key={row.key}>{row.key}: {row.findings} findings · {row.evidencePresent} with evidence{row.labeled ? ` · ${row.labeled} labeled` : ""}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-foreground">By stored severity</p>
            <ul className="space-y-0.5 text-xs text-muted-foreground">
              {report.bySeverity.map((row) => (
                <li key={row.key}>{row.key}: {row.findings} findings · {row.evidencePresent} with evidence{row.labeled ? ` · ${row.labeled} labeled` : ""}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="space-y-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Benchmark</h3>
        <p className="font-mono text-[11px] text-muted-foreground">{report.evaluationVersion} · {report.benchmarkId}</p>
        <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
          {report.limitations.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </section>
    </div>
  );
}

export function SupabaseAnalyzerQualityDrawer({ dataset }: { dataset: AnalyzerRunDataset }) {
  const [open, setOpen] = useState(false);
  const report = useMemo(() => (open ? evaluateAnalyzerQuality(dataset) : null), [open, dataset]);
  return (
    <Card className="border-border/80 bg-card/80 shadow-none" data-testid="analyzer-quality-evaluation">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
            data-testid="analyzer-quality-evaluation-trigger"
            aria-expanded={open}
          >
            <span className="flex items-center gap-2 text-sm font-medium text-foreground">
              <ListChecks className="h-4 w-4 text-muted-foreground" />
              Quality evaluation
              <Badge variant="outline" className="font-normal text-[10px] uppercase tracking-wide">Internal</Badge>
            </span>
            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {report ? (
            <CardContent className="border-t border-border/60 pt-4">
              <QualityBody report={report} />
            </CardContent>
          ) : null}
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
