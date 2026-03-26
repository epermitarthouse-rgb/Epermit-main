import { ReactNode } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
}

interface BaltimorePanelTableProps<T> {
  columns: Column<T>[];
  data: T[];
  emptyMessage?: string;
}

export function BaltimorePanelTable<T extends Record<string, unknown>>({
  columns,
  data,
  emptyMessage = "No records found.",
}: BaltimorePanelTableProps<T>) {
  if (!data.length) {
    return (
      <p className="py-4 text-sm text-muted-foreground">{emptyMessage}</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead key={col.key}>{col.header}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((row, i) => (
            <TableRow key={i}>
              {columns.map((col) => (
                <TableCell key={col.key} className="text-muted-foreground">
                  {col.render(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
