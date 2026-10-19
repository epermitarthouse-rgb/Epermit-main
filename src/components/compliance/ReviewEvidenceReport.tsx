import type { ReviewReportView } from "@/lib/codeAnalyzer/reviewReport";

/** Read-only. Accept, reject, and correct stay off until review_status is applied. */
export function ReviewEvidenceReport({ view }: { view: ReviewReportView }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 text-sm">
      <p className="font-medium text-foreground">Review evidence</p>
      <dl className="mt-3 grid gap-2 md:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Selected code scope</dt>
          <dd className="text-foreground">{view.selectedScope}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Detected location</dt>
          <dd className="text-foreground">
            {view.detectedLocation}
            {view.amendmentsEnforced ? "" : " · local amendments not enforced"}
          </dd>
        </div>
      </dl>
      {view.disclosure ? <p className="mt-2 text-muted-foreground">{view.disclosure}</p> : null}
      {view.userEmphasis ? (
        <p className="mt-2 text-foreground">
          <span className="text-muted-foreground">User emphasis: </span>
          {view.userEmphasis}
        </p>
      ) : null}
      {view.documentsReviewed.length > 0 ? (
        <p className="mt-2 text-muted-foreground">Documents reviewed: {view.documentsReviewed.join(", ")}</p>
      ) : null}
      {view.disciplines.length > 0 ? (
        <p className="mt-1 text-muted-foreground">Disciplines: {view.disciplines.join(", ")}</p>
      ) : null}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <ReportList title="Confirmed findings" items={view.confirmedFindings.map((issue) => issue.title || "Finding")} empty="None" />
        <ReportList title="Verification questions" items={view.verificationQuestions.map((issue) => issue.title || "Question")} empty="None" />
        <ReportList title="Evidence-backed checks" items={view.cleanChecks} empty="None scored" />
        <ReportList title="Not fully reviewable" items={view.unreviewable} empty="None" />
      </div>
      {view.evidence.length > 0 ? (
        <ul className="mt-3 space-y-1 text-muted-foreground">
          {view.evidence.map((item, index) => (
            <li key={`${item.where}-${index}`}>
              {item.where}: {item.quote}
              {item.hasRegion ? " · location on sheet" : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {view.withheldReasons.length > 0 ? (
        <p className="mt-2 text-muted-foreground">Withheld, not shown as violations: {view.withheldReasons.join(" ")}</p>
      ) : null}
    </div>
  );
}

function ReportList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  const shown = items.filter(Boolean).slice(0, 8);
  return (
    <div>
      <p className="font-medium text-foreground">{title}</p>
      {shown.length === 0 ? <p className="text-muted-foreground">{empty}</p> : null}
      {shown.length > 0 ? (
        <ul className="mt-1 list-disc pl-4 text-muted-foreground">
          {shown.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
