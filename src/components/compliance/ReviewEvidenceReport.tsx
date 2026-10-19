import React, { useState } from "react";
import type { ReviewReportView } from "@/lib/codeAnalyzer/reviewReport";
import { reviewEvidenceStripSummary } from "@/lib/codeAnalyzer/reviewReport";
import { AnalyzerDisclosure } from "@/components/compliance/AnalyzerDisclosure";

/** Compact strip above findings. Expanded details keep the full review record. */
export function ReviewEvidenceReport({
  view,
  sourceFileName,
  reviewState,
  overallScore,
  totalIssues,
  codeCoverageVerified,
  expanded,
  onExpandedChange,
}: {
  view: ReviewReportView;
  sourceFileName?: string | null;
  reviewState?: string | null;
  overallScore?: number | null;
  totalIssues?: number;
  codeCoverageVerified?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState(false);
  const isControlled = expanded !== undefined;
  const open = isControlled ? expanded : uncontrolledExpanded;
  const setOpen = (next: boolean) => {
    if (!isControlled) setUncontrolledExpanded(next);
    onExpandedChange?.(next);
  };
  const strip = reviewEvidenceStripSummary(view, {
    sourceFileName,
    reviewState,
    overallScore,
    totalIssues,
    codeCoverageVerified,
  });

  return (
    <AnalyzerDisclosure
      expanded={open}
      onExpandedChange={setOpen}
      testId="review-evidence-disclosure"
      className="text-xs"
      headerClassName="border-border bg-card px-2.5 py-1.5"
      header={
        <>
          <span className="truncate font-medium text-foreground" title={strip.sourceFileName}>
            {strip.sourceFileName}
          </span>
          <span className="truncate text-muted-foreground" title={strip.codeLabel}>
            {strip.codeLabel}
          </span>
          <span className="truncate text-muted-foreground" title={strip.jurisdictionLabel}>
            {strip.jurisdictionLabel}
          </span>
          <span className="shrink-0 text-foreground">{strip.reviewStateLabel}</span>
          <span className="shrink-0 text-muted-foreground" data-testid="review-evidence-count">
            {strip.countLabel}
          </span>
        </>
      }
    >
      <div
        className="space-y-2 border border-t-0 border-border/70 bg-card px-2.5 py-2 text-xs"
        data-testid="review-evidence-details"
      >
        <dl className="grid gap-1.5 sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-[11px] text-muted-foreground">Selected code scope</dt>
            <dd className="text-foreground">{view.selectedScope}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] text-muted-foreground">Detected location</dt>
            <dd className="text-foreground">
              {view.detectedLocation}
              {view.amendmentsEnforced ? "" : " · local amendments not enforced"}
            </dd>
          </div>
          {view.legalApplicability ? (
            <>
              <div className="min-w-0">
                <dt className="text-[11px] text-muted-foreground">Legal review scope</dt>
                <dd className="text-foreground">
                  {view.legalApplicability.reviewScope || "reference_only"} · {view.legalApplicability.status || "unavailable"}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[11px] text-muted-foreground">Verified adopted edition</dt>
                <dd className="text-foreground">
                  {view.legalApplicability.adoptedEdition || "Unavailable"}
                  {view.legalApplicability.adoptedBaseCode
                    ? ` · ${view.legalApplicability.adoptedBaseCode}`
                    : ""}
                </dd>
              </div>
            </>
          ) : null}
        </dl>
        {view.codeCoverage ? (
          <p className="text-muted-foreground">
            Code source coverage: {view.codeCoverage.status || "unavailable"} ·{" "}
            {view.codeCoverage.authoritativeProvisionCount ?? 0} authoritative excerpts ·{" "}
            {view.codeCoverage.enforceableProvisionCount ?? 0} enforceable provisions
          </p>
        ) : null}
        {view.legalApplicability?.officialSourceUrl ? (
          <p>
            <a
              href={view.legalApplicability.officialSourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline"
            >
              Official adoption source
            </a>
            {view.legalApplicability.verificationDate
              ? ` · verified ${view.legalApplicability.verificationDate}`
              : ""}
          </p>
        ) : null}
        {view.legalApplicability?.unresolvedReasons?.length ? (
          <p className="text-muted-foreground">
            Unresolved applicability: {view.legalApplicability.unresolvedReasons.join(" ")}
          </p>
        ) : null}
        {view.disclosure ? <p className="text-muted-foreground">{view.disclosure}</p> : null}
        {view.userEmphasis ? (
          <p className="text-foreground">
            <span className="text-muted-foreground">User emphasis: </span>
            {view.userEmphasis}
          </p>
        ) : null}
        {view.documentsReviewed.length > 0 ? (
          <p className="text-muted-foreground">Documents reviewed: {view.documentsReviewed.join(", ")}</p>
        ) : null}
        {view.disciplines.length > 0 ? (
          <p className="text-muted-foreground">Disciplines: {view.disciplines.join(", ")}</p>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-2">
          <ReportList title="Confirmed findings" items={view.confirmedFindings.map((issue) => issue.title || "Finding")} empty="None" />
          <ReportList title="Verification questions" items={view.verificationQuestions.map((issue) => issue.title || "Question")} empty="None" />
          <ReportList title="Evidence-backed checks" items={view.cleanChecks} empty="None scored" />
          <ReportList title="Unresolved checks" items={view.unresolvedChecks} empty="None" />
          <ReportList title="Why code compliance is unverified" items={view.unreviewable} empty="None" />
        </div>
        {view.evidence.length > 0 ? (
          <ul className="space-y-1 text-muted-foreground">
            {view.evidence.map((item, index) => (
              <li key={`${item.where}-${index}`}>
                {item.where}: {item.quote}
                {item.hasRegion ? " · location on sheet" : ""}
              </li>
            ))}
          </ul>
        ) : null}
        {view.withheldReasons.length > 0 ? (
          <p className="text-muted-foreground">Withheld, not shown as violations: {view.withheldReasons.join(" ")}</p>
        ) : null}
      </div>
    </AnalyzerDisclosure>
  );
}

function ReportList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  const shown = items.filter(Boolean);
  return (
    <div className="min-w-0">
      <p className="font-medium text-foreground">{title}</p>
      {shown.length === 0 ? <p className="text-muted-foreground">{empty}</p> : null}
      {shown.length > 0 ? (
        <ul className="mt-0.5 list-disc pl-4 text-muted-foreground">
          {shown.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
