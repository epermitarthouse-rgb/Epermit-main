import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EDITORIAL_FORM_CARD } from "@/components/layout/editorialPageChrome";
import type { BaltimoreRecordDetail } from "@/data/baltimorePortalMock";

interface BaltimoreRecordHeaderProps {
  record: BaltimoreRecordDetail;
}

export function BaltimoreRecordHeader({ record }: BaltimoreRecordHeaderProps) {
  return (
    <Card className={EDITORIAL_FORM_CARD}>
      <CardContent className="flex flex-wrap items-start justify-between gap-4 pt-6">
        <div>
          <p className="text-xs text-ink-secondary-light">Record Number</p>
          <Link
            to={`/baltimore/records/${encodeURIComponent(record.recordId)}`}
            className="text-base font-semibold text-gold-deep hover:underline underline-offset-2"
          >
            {record.recordNumber}
          </Link>
          <div className="mt-2 flex flex-wrap gap-4 text-sm">
            <span>
              <span className="text-ink-secondary-light">Type: </span>
              <span className="font-medium text-ink-primary-light">{record.permitType}</span>
            </span>
            <span>
              <span className="text-ink-secondary-light">Status: </span>
              <span className="font-medium text-ink-primary-light">{record.status}</span>
            </span>
            {record.expirationDate && (
              <span>
                <span className="text-ink-secondary-light">Expiration: </span>
                <span className="text-ink-primary-light">{record.expirationDate}</span>
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="gold">
            Add to Cart
          </Button>
          <Button size="sm" variant="outlineGold">
            Add to Collection
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
