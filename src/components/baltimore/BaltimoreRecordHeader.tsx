import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { BaltimoreRecordDetail } from "@/data/baltimorePortalMock";

interface BaltimoreRecordHeaderProps {
  record: BaltimoreRecordDetail;
}

export function BaltimoreRecordHeader({ record }: BaltimoreRecordHeaderProps) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-start justify-between gap-4 pt-6">
        <div>
          <p className="text-xs text-muted-foreground">Record Number</p>
          <Link
            to={`/baltimore/records/${encodeURIComponent(record.recordId)}`}
            className="text-base font-semibold text-primary hover:underline"
          >
            {record.recordNumber}
          </Link>
          <div className="mt-2 flex flex-wrap gap-4 text-sm">
            <span>
              <span className="text-muted-foreground">Type: </span>
              <span className="font-medium">{record.permitType}</span>
            </span>
            <span>
              <span className="text-muted-foreground">Status: </span>
              <span className="font-medium">{record.status}</span>
            </span>
            {record.expirationDate && (
              <span>
                <span className="text-muted-foreground">Expiration: </span>
                {record.expirationDate}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="default">
            Add to Cart
          </Button>
          <Button size="sm" variant="outline">
            Add to Collection
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
