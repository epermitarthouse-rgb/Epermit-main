import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { formatTimestamp } from "@/components/permits/PermitRepositoryViews";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { loadPermitReadyInsights } from "@/lib/centralPermits";
import {
  buildPermitDownstreamRows,
  mapPermitDownstreamRows,
  type PermitDownstreamResponse,
  type PermitDownstreamRow,
} from "@/lib/permitDownstreamMatrix";
import { findExistingPermitLinks } from "@/lib/projectPermits";

type Row = Record<string, unknown>;

const EMPTY_ROWS: Row[] = [];

export interface PermitDownstreamLink {
  project_id: string;
  project_name: string | null;
}

const COLUMNS = ["Comment", "Status", "Response", "Discipline", "Code reference", "Preliminary guidance"] as const;

function metaLine(row: PermitDownstreamRow): string {
  const parts = [
    row.refNumber ? `Ref #${row.refNumber}` : "",
    row.cycle ? `Cycle ${row.cycle}` : "",
    row.department,
    row.commentType,
    row.fileName ? `File: ${row.fileName}` : "",
    row.reviewedAt ? formatTimestamp(row.reviewedAt) : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

function ResponseThread({ responses }: { responses: PermitDownstreamResponse[] }) {
  if (!responses.length) return null;
  return (
    <div className="space-y-2">
      {responses.map((r) => (
        <div key={r.id} data-downstream-response>
          <p className="text-xs text-muted-foreground">
            #{r.seq}
            {r.role ? ` · ${r.role}` : ""}
            {r.respondedAt ? ` · ${formatTimestamp(r.respondedAt)}` : ""}
          </p>
          {r.body ? <p className="whitespace-pre-wrap">{r.body}</p> : null}
        </div>
      ))}
    </div>
  );
}

/** Read-only grid of the permit record. No project edit actions. */
export function PermitDownstreamMatrixView({
  permitNumber,
  rows,
  links,
  insightsNote,
}: {
  permitNumber: string;
  rows: PermitDownstreamRow[];
  links: PermitDownstreamLink[];
  insightsNote?: string | null;
}) {
  const title = `Downstream · ${permitNumber || "permit"}`;
  return (
    <div className="space-y-3" data-testid="permit-downstream-matrix">
      <h2 className="font-tight text-xl font-bold text-foreground">{title}</h2>
      {links.map((link) => (
        <p key={link.project_id} className="text-sm" data-testid="permit-downstream-link">
          Linked to{" "}
          <Link className="font-medium text-primary underline-offset-4 hover:underline" to={`/response-matrix?projectId=${encodeURIComponent(link.project_id)}`}>
            {link.project_name?.trim() || "project"}
          </Link>
        </p>
      ))}
      {insightsNote ? <p className="text-sm text-muted-foreground">{insightsNote}</p> : null}
      {!rows.length ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No review comments are stored for this permit.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {COLUMNS.map((h) => (
                  <TableHead key={h}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} data-downstream-row={row.id}>
                  <TableCell className="align-top text-sm">
                    {metaLine(row) ? <p className="mb-1 text-xs text-muted-foreground">{metaLine(row)}</p> : null}
                    <p className="whitespace-pre-wrap">{row.body}</p>
                  </TableCell>
                  <TableCell className="align-top text-sm" data-downstream-status={row.status}>
                    {row.status}
                  </TableCell>
                  <TableCell className="align-top text-sm">
                    <ResponseThread responses={row.responses} />
                  </TableCell>
                  <TableCell className="align-top text-sm" data-downstream-discipline={row.discipline}>
                    {row.discipline}
                  </TableCell>
                  <TableCell className="align-top text-sm" data-downstream-code={row.codeReference}>
                    {row.codeReference}
                  </TableCell>
                  <TableCell className="align-top whitespace-pre-wrap text-sm" data-downstream-guidance={row.guidance}>
                    {row.guidance}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function shellRows(comments: Row[], responses: Row[]): PermitDownstreamRow[] {
  return mapPermitDownstreamRows({ comments, responses, insights: [], inputHashes: new Map() });
}

/**
 * Loads ready insights through the signed-in client (RLS: status ready and can_read_permit).
 * The browser never calls the service-only insight RPC.
 */
export function usePermitDownstreamMatrix(
  permitId: string,
  jurisdiction: unknown,
  comments: Row[] | undefined,
  responses: Row[] | undefined,
  enabled: boolean,
) {
  const commentRows = comments ?? EMPTY_ROWS;
  const responseRows = responses ?? EMPTY_ROWS;
  const insights = useQuery({
    queryKey: ["central-permits", "ready-insights", permitId],
    queryFn: () => loadPermitReadyInsights(permitId),
    enabled: enabled && !!permitId,
    staleTime: 30_000,
  });
  const linkQuery = useQuery({
    queryKey: ["project-permits", "existing-links", permitId],
    queryFn: () => findExistingPermitLinks([permitId]),
    enabled: enabled && !!permitId,
    staleTime: 30_000,
  });
  const shell = useMemo(() => shellRows(commentRows, responseRows), [commentRows, responseRows]);
  const [rows, setRows] = useState(shell);

  useEffect(() => {
    setRows(shell);
  }, [shell]);

  useEffect(() => {
    if (!insights.data) return;
    let cancel = false;
    void buildPermitDownstreamRows({
      comments: commentRows,
      responses: responseRows,
      insights: insights.data,
      jurisdiction,
    }).then((next) => {
      if (!cancel) setRows(next);
    });
    return () => {
      cancel = true;
    };
  }, [commentRows, responseRows, insights.data, jurisdiction]);

  const links = linkQuery.data?.get(permitId) ?? [];
  return {
    rows,
    links,
    insightsNote: insights.isError ? "Preliminary analysis could not be loaded." : null,
  };
}
