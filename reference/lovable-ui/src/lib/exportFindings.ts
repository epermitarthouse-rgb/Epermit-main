import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export type ExportFinding = {
  id: string;
  severity: "critical" | "warn" | "info";
  code: string;
  title: string;
  page: string;
  suggestion: string;
};

export type ExportContext = {
  projectLabel: string;
  jurisdiction: string;
  projectType: string;
  codeYear: string;
  hvhz?: boolean;
  pagesReviewed: number;
  summary?: string;
  ranAt?: Date | null;
};

const SEVERITY_LABEL: Record<ExportFinding["severity"], string> = {
  critical: "Critical",
  warn: "Warning",
  info: "Info",
};

const escapeCsv = (v: string) => {
  const needs = /[",\n\r]/.test(v);
  const s = v.replace(/"/g, '""');
  return needs ? `"${s}"` : s;
};

const stamp = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
};

const download = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const exportFindingsCsv = (findings: ExportFinding[], ctx: ExportContext) => {
  const meta = [
    ["Project", ctx.projectLabel],
    ["Jurisdiction", ctx.jurisdiction],
    ["Project Type", ctx.projectType],
    ["Code Year", ctx.codeYear],
    ["HVHZ", ctx.hvhz ? "Yes" : "No"],
    ["Pages Reviewed", String(ctx.pagesReviewed)],
    ["Generated", (ctx.ranAt ?? new Date()).toISOString()],
  ];
  const metaLines = meta.map(([k, v]) => `${escapeCsv(k)},${escapeCsv(v)}`).join("\n");
  const header = ["ID", "Severity", "Code", "Sheet", "Finding", "Suggested Remediation"]
    .map(escapeCsv)
    .join(",");
  const rows = findings
    .map((f) =>
      [f.id, SEVERITY_LABEL[f.severity], f.code, f.page, f.title, f.suggestion]
        .map((v) => escapeCsv(String(v ?? "")))
        .join(","),
    )
    .join("\n");
  const csv = `${metaLines}\n\n${header}\n${rows}\n`;
  download(new Blob([csv], { type: "text/csv;charset=utf-8" }), `designcheck-findings-${stamp()}.csv`);
};

export const exportFindingsPdf = (findings: ExportFinding[], ctx: ExportContext) => {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 40;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("DesignCheck™ Compliance Report", marginX, 54);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text(
    `Generated ${(ctx.ranAt ?? new Date()).toLocaleString()}`,
    pageWidth - marginX,
    54,
    { align: "right" },
  );
  doc.setTextColor(0);

  const metaRows: [string, string][] = [
    ["Project", ctx.projectLabel],
    ["Jurisdiction", ctx.jurisdiction],
    ["Project Type", ctx.projectType],
    ["Code Year", ctx.codeYear],
    ["HVHZ", ctx.hvhz ? "Yes" : "No"],
    ["Pages Reviewed", String(ctx.pagesReviewed)],
  ];

  autoTable(doc, {
    startY: 72,
    theme: "plain",
    styles: { fontSize: 9, cellPadding: 3 },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 110, textColor: [80, 80, 80] } },
    body: metaRows,
  });

  let cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;

  if (ctx.summary) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Summary", marginX, cursorY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(60);
    const wrapped = doc.splitTextToSize(ctx.summary, pageWidth - marginX * 2);
    doc.text(wrapped, marginX, cursorY + 14);
    doc.setTextColor(0);
    cursorY += 14 + wrapped.length * 11 + 8;
  }

  const counts = {
    critical: findings.filter((f) => f.severity === "critical").length,
    warn: findings.filter((f) => f.severity === "warn").length,
    info: findings.filter((f) => f.severity === "info").length,
  };
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(
    `Findings: ${findings.length}  ·  Critical ${counts.critical}  ·  Warnings ${counts.warn}  ·  Info ${counts.info}`,
    marginX,
    cursorY,
  );

  const severityFill: Record<ExportFinding["severity"], [number, number, number]> = {
    critical: [220, 38, 38],
    warn: [217, 119, 6],
    info: [37, 99, 235],
  };

  autoTable(doc, {
    startY: cursorY + 10,
    head: [["ID", "Severity", "Code", "Sheet", "Finding & Suggested Remediation"]],
    body: findings.map((f) => [
      f.id,
      SEVERITY_LABEL[f.severity],
      f.code,
      f.page,
      `${f.title}\n${f.suggestion}`,
    ]),
    headStyles: { fillColor: [17, 24, 39], textColor: 255, fontSize: 9 },
    styles: { fontSize: 9, cellPadding: 5, valign: "top", overflow: "linebreak" },
    columnStyles: {
      0: { cellWidth: 44 },
      1: { cellWidth: 60, fontStyle: "bold" },
      2: { cellWidth: 90 },
      3: { cellWidth: 50 },
      4: { cellWidth: "auto" },
    },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 1) {
        const sev = findings[data.row.index]?.severity;
        if (sev) {
          data.cell.styles.textColor = severityFill[sev];
        }
      }
    },
    didDrawPage: () => {
      const page = doc.getNumberOfPages();
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(140);
      doc.text(
        `Commun-ET · DesignCheck Report · Page ${page}`,
        pageWidth / 2,
        doc.internal.pageSize.getHeight() - 20,
        { align: "center" },
      );
      doc.setTextColor(0);
    },
    margin: { left: marginX, right: marginX },
  });

  doc.save(`designcheck-findings-${stamp()}.pdf`);
};