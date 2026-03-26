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
import type { BaltimoreRecordSummary } from "@/data/baltimorePortalMock";

interface BaltimoreRecordsTableProps {
  records: BaltimoreRecordSummary[];
  loading?: boolean;
}

export function BaltimoreRecordsTable({ records, loading }: BaltimoreRecordsTableProps) {
  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          Loading records...
        </CardContent>
      </Card>
    );
  }

  if (!records.length) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No records found.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
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
                  className="font-medium text-primary hover:underline"
                >
                  {rec.recordNumber}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">{rec.permitType}</TableCell>
              <TableCell className="text-muted-foreground">{rec.status}</TableCell>
              <TableCell className="text-muted-foreground">{rec.address ?? "—"}</TableCell>
              <TableCell className="text-muted-foreground">{rec.openedDate ?? "—"}</TableCell>
              <TableCell className="text-muted-foreground">{rec.closedDate || "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
