import { Link } from "react-router-dom";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { EDITORIAL_FORM_CARD } from "@/components/layout/editorialPageChrome";
import { cn } from "@/lib/utils";
import type { BaltimoreRecordSummary } from "@/data/baltimorePortalMock";

interface BaltimoreRecordsTableProps {
  records: BaltimoreRecordSummary[];
  loading?: boolean;
}

export function BaltimoreRecordsTable({ records, loading }: BaltimoreRecordsTableProps) {
  if (loading) {
    return (
      <Card className={EDITORIAL_FORM_CARD}>
        <CardContent className="flex items-center justify-center py-12 text-sm text-ink-secondary-light">
          Loading records...
        </CardContent>
      </Card>
    );
  }

  if (!records.length) {
    return (
      <Card className={EDITORIAL_FORM_CARD}>
        <CardContent className="py-12 text-center text-sm text-ink-secondary-light">
          No records found.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn(EDITORIAL_FORM_CARD, "overflow-hidden")}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Record Number</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Address</TableHead>
            <TableHead>Opened Date</TableHead>
            <TableHead>Closed Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((rec) => (
            <TableRow key={rec.recordId}>
              <TableCell>
                <Link
                  to={`/baltimore/records/${encodeURIComponent(rec.recordId)}`}
                  className="font-medium text-gold-deep hover:underline underline-offset-2"
                >
                  {rec.recordNumber}
                </Link>
              </TableCell>
              <TableCell className="text-ink-secondary-light">{rec.permitType}</TableCell>
              <TableCell className="text-ink-secondary-light">{rec.status}</TableCell>
              <TableCell className="text-ink-secondary-light">{rec.address ?? "—"}</TableCell>
              <TableCell className="text-ink-secondary-light">{rec.openedDate ?? "—"}</TableCell>
              <TableCell className="text-ink-secondary-light">{rec.closedDate || "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
