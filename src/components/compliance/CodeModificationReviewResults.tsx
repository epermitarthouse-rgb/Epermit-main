import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  EVIDENCE_STATUS_LABELS,
  OVERALL_STATUS_LABELS,
  type CodeModificationReview,
  type EvidenceFinding,
  type OverallStatus,
} from "@/lib/codeModification/model";

const OVERALL_BADGE: Record<OverallStatus, "success" | "warning" | "outlineDanger" | "outlineWarning"> = {
  evidence_appears_complete: "success",
  evidence_partially_supported: "warning",
  material_evidence_missing: "outlineDanger",
  manual_review_required: "outlineWarning",
};

function sourceLabel(finding: EvidenceFinding): string {
  const source = finding.source;
  if (!source) return "—";
  return source.fileName || source.sheetLabel || source.documentId || "—";
}

function pageLabel(finding: EvidenceFinding): string {
  const source = finding.source;
  if (!source) return "—";
  if (typeof source.pageNumber === "number") {
    return source.sheetLabel
      ? `${source.sheetLabel} · p.${source.pageNumber}`
      : `p.${source.pageNumber}`;
  }
  return source.sheetLabel || "—";
}

export interface CodeModificationReviewResultsProps {
  review: Pick<
    CodeModificationReview,
    "extracted_request" | "evidence" | "overall_status" | "extraction_warnings"
  >;
  stale?: boolean;
}

export function CodeModificationReviewResults({ review, stale }: CodeModificationReviewResultsProps) {
  const request = review.extracted_request;
  const evidence = review.evidence ?? [];
  const missing = evidence.filter((f) => f.status === "not_found");
  const conflicts = evidence.filter((f) => f.status === "conflicting");
  const notes = [
    ...(review.extraction_warnings ?? []),
    ...evidence
      .filter((f) => f.status === "requires_professional_dob_review")
      .map((f) => f.note || `${f.measure}: requires professional / DOB review`),
  ].filter(Boolean);
  const overallLabel = OVERALL_STATUS_LABELS[review.overall_status] ?? "Manual review required";

  return (
    <div className="space-y-4 text-left" data-testid="code-modification-results">
      {stale && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          This Code Modification Review is stale. Drawing-set or form changes were made after it ran.
          Historical findings remain visible. Choose Update Review to create a new current review.
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Overall status</CardTitle>
          <CardDescription>
            Evidence review only. This is not a Department of Buildings approval.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Badge
            variant={OVERALL_BADGE[review.overall_status] ?? "outlineWarning"}
            data-testid="modification-overall-status"
          >
            {overallLabel}
          </Badge>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Modification Request</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {request.projectAddress && (
            <p>
              <span className="font-medium">Project / address: </span>
              {request.projectAddress}
            </p>
          )}
          <p>
            <span className="font-medium">Requested modification: </span>
            {request.requestedModification || "Not extracted"}
          </p>
          <div data-testid="applicant-cited-code">
            <p className="font-medium">Cited sections</p>
            {request.citedSections.length === 0 ? (
              <p className="text-muted-foreground">No applicant-cited code sections extracted.</p>
            ) : (
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {request.citedSections.map((section) => (
                  <li key={section.citation}>
                    <span className="text-muted-foreground">{section.label}: </span>
                    {section.citation}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {request.impracticalReason && (
            <p>
              <span className="font-medium">Applicant justification: </span>
              {request.impracticalReason}
            </p>
          )}
          {request.compliesWithIntent != null && (
            <p>
              <span className="font-medium">Complies with intent (applicant): </span>
              {request.compliesWithIntent ? "Yes" : "No"}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Proposed Alternative Measures</CardTitle>
        </CardHeader>
        <CardContent>
          {request.proposedMeasures.length === 0 ? (
            <p className="text-sm text-muted-foreground">No proposed measures extracted.</p>
          ) : (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {request.proposedMeasures.map((measure) => (
                <li key={measure.id}>{measure.description}</li>
              ))}
            </ul>
          )}
          {request.floodHazardApplicable != null && (
            <p className="mt-3 text-sm">
              <span className="font-medium">Flood hazard applicable: </span>
              {request.floodHazardApplicable ? "Yes" : "No"}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Evidence Review</CardTitle>
        </CardHeader>
        <CardContent>
          <Table data-testid="modification-evidence-table">
            <TableHeader>
              <TableRow>
                <TableHead>Measure</TableHead>
                <TableHead>Evidence status</TableHead>
                <TableHead>Drawing/document</TableHead>
                <TableHead>Sheet/page</TableHead>
                <TableHead>Review note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {evidence.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    No evidence findings yet.
                  </TableCell>
                </TableRow>
              ) : (
                evidence.map((finding) => (
                  <TableRow key={finding.id}>
                    <TableCell>{finding.measure}</TableCell>
                    <TableCell>{EVIDENCE_STATUS_LABELS[finding.status]}</TableCell>
                    <TableCell>{sourceLabel(finding)}</TableCell>
                    <TableCell>{pageLabel(finding)}</TableCell>
                    <TableCell>{finding.note || "—"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Missing / Unverified Evidence</CardTitle>
        </CardHeader>
        <CardContent>
          {missing.length === 0 ? (
            <p className="text-sm text-muted-foreground">No missing measures reported.</p>
          ) : (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {missing.map((finding) => (
                <li key={finding.id}>
                  {finding.measure}
                  {finding.note ? ` — ${finding.note}` : ""}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Conflicts</CardTitle>
        </CardHeader>
        <CardContent>
          {conflicts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No conflicts reported.</p>
          ) : (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {conflicts.map((finding) => (
                <li key={finding.id}>
                  {finding.measure}
                  {finding.note ? ` — ${finding.note}` : ""}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Review Notes</CardTitle>
        </CardHeader>
        <CardContent>
          {notes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No additional review notes.</p>
          ) : (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {notes.map((note, index) => (
                <li key={`${note}-${index}`}>{note}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
