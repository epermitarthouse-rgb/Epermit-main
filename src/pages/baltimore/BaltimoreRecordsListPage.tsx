import { useState } from "react";
import { BaltimoreLayout } from "@/components/baltimore/BaltimoreLayout";
import { BaltimoreRecordsTable } from "@/components/baltimore/BaltimoreRecordsTable";
import { getBaltimoreRecordsList } from "@/data/baltimorePortalMock";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

const PAGE_SIZE = 10;

export default function BaltimoreRecordsListPage() {
  const [page, setPage] = useState(1);
  const { records, total, pageSize } = getBaltimoreRecordsList(page, PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <BaltimoreLayout activeModule="permits" permitsSubActive="search">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Search Results</CardTitle>
            <CardDescription>
              {total} record(s) found. Click a record number to view details.
            </CardDescription>
          </CardHeader>
        </Card>

        <BaltimoreRecordsTable records={records} />

        {totalPages > 1 && (
          <Card>
            <CardContent className="flex justify-center py-4">
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        if (page > 1) setPage(page - 1);
                      }}
                      className={
                        page <= 1 ? "pointer-events-none opacity-50" : ""
                      }
                    />
                  </PaginationItem>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(
                    (p) => (
                      <PaginationItem key={p}>
                        <PaginationLink
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            setPage(p);
                          }}
                          isActive={p === page}
                        >
                          {p}
                        </PaginationLink>
                      </PaginationItem>
                    )
                  )}
                  <PaginationItem>
                    <PaginationNext
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        if (page < totalPages) setPage(page + 1);
                      }}
                      className={
                        page >= totalPages
                          ? "pointer-events-none opacity-50"
                          : ""
                      }
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </CardContent>
          </Card>
        )}
      </div>
    </BaltimoreLayout>
  );
}
