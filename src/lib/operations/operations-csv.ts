import type { MockReimbursable, MockScopeLine, RealReimbursableSummaryRow } from "./operations-types";

function escapeCsv(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Real/partial rows only — never include mock fixtures. */
export function exportRealReimbursablesCsv(
  rows: RealReimbursableSummaryRow[],
  filename: string,
): void {
  const headers = [
    "kind",
    "label",
    "description",
    "amount",
    "permit_number",
    "invoice_ref",
    "paid_at",
    "billed_at",
    "source_table",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        escapeCsv(r.kind),
        escapeCsv(r.label),
        escapeCsv(r.description),
        escapeCsv(r.amount),
        escapeCsv(r.permitNumber),
        escapeCsv(r.invoiceRef),
        escapeCsv(r.paidAt),
        escapeCsv(r.billedAt),
        escapeCsv(r.sourceTable),
      ].join(","),
    );
  }
  downloadCsv(lines.join("\n"), filename);
}

/** Explicitly labeled demo export — mock fixtures only. */
export function exportMockReimbursablesCsv(
  rows: MockReimbursable[],
  filename = "operations-demo-reimbursables.csv",
): void {
  const headers = [
    "item",
    "logged",
    "project",
    "permitNo",
    "description",
    "amount",
    "team",
    "invoiced",
    "invoice",
    "payment",
    "progress",
    "provenance",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        escapeCsv(r.item),
        escapeCsv(r.logged),
        escapeCsv(r.project),
        escapeCsv(r.permitNo),
        escapeCsv(r.description),
        escapeCsv(r.amount),
        escapeCsv(r.team),
        escapeCsv(r.invoiced),
        escapeCsv(r.invoice),
        escapeCsv(r.payment),
        escapeCsv(r.progress),
        escapeCsv("demo_fixture"),
      ].join(","),
    );
  }
  downloadCsv(lines.join("\n"), filename);
}

export function exportMockScopeCsv(
  rows: MockScopeLine[],
  filename = "operations-demo-scope.csv",
): void {
  const headers = ["item", "client", "email", "dateNeeded", "hours", "price", "provenance"];
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        escapeCsv(r.item),
        escapeCsv(r.client),
        escapeCsv(r.email),
        escapeCsv(r.dateNeeded),
        escapeCsv(r.hours),
        escapeCsv(r.price),
        escapeCsv("demo_fixture"),
      ].join(","),
    );
  }
  downloadCsv(lines.join("\n"), filename);
}
