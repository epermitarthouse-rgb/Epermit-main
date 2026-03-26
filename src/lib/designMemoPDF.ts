import jsPDF from "jspdf";
import { format } from "date-fns";

export interface DesignMemoRow {
  number: number;
  codeRef: string;
  reviewerComment: string;
  status: string;
  designTeamResponse: string;
  location: string;
}

export interface DesignMemoOptions {
  projectName: string;
  projectNumber: string;
  revision: string;
  rows: DesignMemoRow[];
}

function safeText(text: unknown): string {
  if (text === null || text === undefined) return "";
  if (typeof text === "number") return String(text);
  if (typeof text === "string") return text;
  return String(text);
}

/**
 * Generates and downloads the Architect/Engineer Design Memo as a PDF.
 */
export function exportDesignMemoPDF(options: DesignMemoOptions): void {
  const { projectName, projectNumber, revision, rows } = options;

  const doc = new jsPDF("p", "mm", "a4");
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 18;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  const addPage = () => {
    doc.addPage();
    y = margin;
  };

  const checkPageBreak = (neededHeight: number) => {
    if (y + neededHeight > pageHeight - margin) {
      addPage();
    }
  };

  // Header
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 42, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Architect/Engineer Design Memo", margin, 22);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("AIA Standard Response to Plan Check Comments", margin, 32);
  y = 52;

  // Project info
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(margin, y, contentWidth, 32, 2, 2, "F");
  doc.setTextColor(100, 116, 139);
  doc.setFontSize(9);
  doc.text("Project Name:", margin + 6, y + 10);
  doc.text("Project Number:", margin + 6, y + 18);
  doc.text("Date:", pageWidth / 2, y + 10);
  doc.text("Revision:", pageWidth / 2, y + 18);
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(safeText(projectName), margin + 45, y + 10);
  doc.text(safeText(projectNumber), margin + 45, y + 18);
  doc.text(format(new Date(), "MM/dd/yyyy"), pageWidth / 2 + 25, y + 10);
  doc.text(safeText(revision), pageWidth / 2 + 25, y + 18);
  y += 42;

  // Table header
  doc.setFillColor(15, 23, 42);
  doc.rect(margin, y, contentWidth, 10, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  const colW = contentWidth / 12;
  doc.text("#", margin + colW * 0.5, y + 7);
  doc.text("Code Ref.", margin + colW * 1.5, y + 7);
  doc.text("Reviewer Comment", margin + colW * 3.5, y + 7);
  doc.text("Status", margin + colW * 6.5, y + 7);
  doc.text("Design Team Response", margin + colW * 7.5, y + 7);
  doc.text("Location", margin + colW * 10.5, y + 7);
  y += 12;

  if (rows.length === 0) {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(10);
    doc.text("No responses recorded yet.", margin, y + 6);
    y += 15;
  } else {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(8);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      checkPageBreak(28);

      const lineHeight = 5;
      const commentLines = doc.splitTextToSize(safeText(row.reviewerComment), colW * 3);
      const responseLines = doc.splitTextToSize(safeText(row.designTeamResponse), colW * 3);
      const cellHeight = Math.max(8, commentLines.length * lineHeight, responseLines.length * lineHeight);

      doc.setDrawColor(226, 232, 240);
      doc.line(margin, y, pageWidth - margin, y);

      doc.text(String(row.number), margin + colW * 0.5, y + 5);
      doc.text(safeText(row.codeRef), margin + colW * 1.2, y + 5);
      doc.text(commentLines, margin + colW * 2.8, y + 5);
      doc.text(safeText(row.status), margin + colW * 6.2, y + 5);
      doc.text(responseLines, margin + colW * 7.2, y + 5);
      doc.text(safeText(row.location), margin + colW * 10.2, y + 5);

      y += cellHeight + 4;
    }
  }

  y += 10;
  checkPageBreak(35);

  // Footer notes
  doc.setDrawColor(226, 232, 240);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text("Notes:", margin, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  const notes = [
    "All revisions are indicated by revision clouds per AIA standards.",
    "Cloud numbers correspond to the item numbers in this response memo.",
    "Rejected items have been reviewed and determined to be either compliant or not applicable.",
  ];
  notes.forEach((note) => {
    doc.text(note, margin, y);
    y += 5;
  });

  const filename = `design-memo-${(projectName || "memo").replace(/[^a-z0-9]/gi, "-").toLowerCase()}-${format(new Date(), "yyyy-MM-dd")}.pdf`;
  doc.save(filename);
}
