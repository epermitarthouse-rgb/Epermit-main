/**
 * Commun-ET branded "Severity-Ordered Architect Review" PDF.
 * Renders only what the architect review model carries: stored findings, stored severity,
 * reviewer decisions and run metadata. Output is deterministic for a given input.
 */
import jsPDF from "jspdf";
import type { PersistedAnalysisScope } from "@/lib/supabaseAnalyzer/analysisMode";
import { displayAnalysisMode } from "@/lib/supabaseAnalyzer/analysisMode";
import type {
  ArchitectReviewFingerprint,
  ArchitectReviewModel,
  ReportCoverageOutcome,
  ReportFinding,
} from "@/lib/supabaseAnalyzer/architectReview";
import { ARCHITECT_REVIEW_MODEL_VERSION } from "@/lib/supabaseAnalyzer/architectReview";
import type { AnalyzerRunDataset } from "@/lib/supabaseAnalyzer/client";
import {
  DISCLAIMER_HEADING,
  DISCLAIMER_PARAGRAPHS,
  DISCLAIMER_VERSION,
  FOOTER_NOTICE,
  REPORT_COLORS,
  REPORT_COMPANY,
  REPORT_PRODUCT,
  REPORT_TITLE,
  RUNNING_HEADER,
  VERIFICATION_RESTATEMENT,
  type Rgb,
} from "@/lib/supabaseAnalyzer/reportBranding";
import { reviewDecisionLabel } from "@/lib/supabaseAnalyzer/reviewDecisions";
import { reportIdentityKeywords } from "../../../supabase/functions/_shared/analyzerExportAudit.ts";

export const BRANDED_REPORT_LAYOUT_VERSION = "architect-review-pdf.v1";

export interface ReportLogo {
  /** Data URL or base64 JPEG/PNG. */
  data: string;
  format: "JPEG" | "PNG";
  width: number;
  height: number;
}

export interface ArchitectReviewPdfInput {
  dataset: AnalyzerRunDataset;
  model: ArchitectReviewModel;
  fingerprint: ArchitectReviewFingerprint;
  projectName?: string | null;
  generatedAt: Date;
  logo?: ReportLogo | null;
}

export type ReportSectionKey =
  | "cover"
  | "summary"
  | "inventory"
  | "guide"
  | "critical"
  | "warning"
  | "advisory"
  | "other"
  | "coverage"
  | "withdrawn"
  | "record";

export interface ArchitectReviewPdfLayout {
  pageCount: number;
  sections: Array<{ key: ReportSectionKey; title: string; page: number }>;
  /** First page of each finding block, by report ID. */
  findingPages: Map<string, number>;
  /** Characters outside the PDF font's character set that were replaced. */
  substitutedCharacters: number;
}

interface TextRun {
  text: string;
  bold?: boolean;
  color?: Rgb;
}

const PAGE_MARGIN = 54;
const BODY_TOP = 72;
const BODY_BOTTOM_GAP = 64;

const SEVERITY_SECTIONS = [
  { key: "critical", label: "Critical", intro: "Source-assigned critical priority. Findings remain in original sheet order within this severity group." },
  { key: "warning", label: "Warning", intro: "Source-assigned warning priority. Findings remain in original sheet order within this severity group." },
  { key: "advisory", label: "Advisory", intro: "Source-assigned advisory priority. Findings remain in original sheet order within this severity group." },
] as const;

const OUTCOME_LABEL: Record<ReportCoverageOutcome, string> = {
  findings: "Analyzed",
  no_findings: "Analyzed, no findings",
  failed: "Not analyzed (processing failed)",
  cancelled: "Cancelled",
  pending: "In progress",
};

// Windows-1252 code points above 0x7F that the standard PDF fonts can draw.
const WIN_ANSI_EXTRA = new Set(
  "\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178",
);
const SUBSTITUTIONS: Record<string, string> = {
  "\u2265": ">=",
  "\u2264": "<=",
  "\u2260": "!=",
  "\u2248": "~",
  "\u2212": "-",
  "\u2010": "-",
  "\u2011": "-",
  "\u2012": "-",
  "\u2015": "-",
  "\u2192": "->",
  "\u2190": "<-",
  "\u2194": "<->",
  "\u2032": "'",
  "\u2033": "\"",
  "\u2044": "/",
  "\u2009": " ",
  "\u202f": " ",
  "\u2007": " ",
  "\u200b": "",
  "\ufeff": "",
  "\t": " ",
};

function isDrawable(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  if (code === 0x0a) return true;
  if (code >= 0x20 && code <= 0x7e) return true;
  if (code >= 0xa0 && code <= 0xff) return true;
  return WIN_ANSI_EXTRA.has(char);
}

function formatDateTime(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
}

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function sheetLabel(finding: Pick<ReportFinding, "sheet">): string {
  return finding.sheet.sheetNumber || (finding.sheet.ordinal ? `Sheet ${finding.sheet.ordinal}` : "Sheet not identified");
}

function severityColor(severity: string): Rgb {
  if (severity === "critical") return REPORT_COLORS.critical;
  if (severity === "warning") return REPORT_COLORS.warning;
  if (severity === "advisory") return REPORT_COLORS.advisory;
  return REPORT_COLORS.other;
}

function idRange(findings: readonly ReportFinding[]): string | null {
  if (findings.length === 0) return null;
  const first = findings[0].reportId;
  const last = findings[findings.length - 1].reportId;
  return first === last ? first : `${first}\u2013${last}`;
}

export function architectReviewPdfFileName(runId: string, fingerprint: ArchitectReviewFingerprint): string {
  const shortId = runId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 8) || "run";
  return `PermitPilot-Architect-Review-${shortId}-${fingerprint.label}.pdf`;
}

export function renderArchitectReviewPdf(input: ArchitectReviewPdfInput): { doc: jsPDF; layout: ArchitectReviewPdfLayout } {
  const { dataset, model, fingerprint, logo } = input;
  const { run } = dataset;
  const doc = new jsPDF({ unit: "pt", format: "letter", compress: true });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - PAGE_MARGIN * 2;
  const bodyBottom = pageHeight - BODY_BOTTOM_GAP;

  let substituted = 0;
  const clean = (value: string | null | undefined): string => {
    const normalized = (value ?? "").normalize("NFC").replace(/\r\n?/g, "\n");
    let out = "";
    for (const char of normalized) {
      if (isDrawable(char)) {
        out += char;
      } else if (char in SUBSTITUTIONS) {
        out += SUBSTITUTIONS[char];
        if (char !== "\u200b" && char !== "\ufeff") substituted += 1;
      } else {
        out += "?";
        substituted += 1;
      }
    }
    return out;
  };

  const sections: ArchitectReviewPdfLayout["sections"] = [];
  const findingPages = new Map<string, number>();
  const sectionPage = (key: ReportSectionKey) => sections.find((section) => section.key === key)?.page ?? null;
  let currentSection = "";
  let y = BODY_TOP;
  const draft = !model.isFinal;

  const setFont = (bold: boolean, size: number, color: Rgb = REPORT_COLORS.body) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(color[0], color[1], color[2]);
  };

  const logoBox = (maxWidth: number, maxHeight: number) => {
    if (!logo) return null;
    const scale = Math.min(maxWidth / logo.width, maxHeight / logo.height);
    return { width: logo.width * scale, height: logo.height * scale };
  };

  const drawRunningHeader = () => {
    const box = logoBox(44, 26);
    if (logo && box) doc.addImage(logo.data, logo.format, PAGE_MARGIN, 16, box.width, box.height, "commun-et-logo", "FAST");
    setFont(true, 8, REPORT_COLORS.ink);
    doc.text(RUNNING_HEADER, PAGE_MARGIN + (box ? box.width + 10 : 0), 33);
    setFont(false, 8, REPORT_COLORS.muted);
    doc.text(clean(draft ? `DRAFT \u00b7 ${currentSection}` : currentSection), pageWidth - PAGE_MARGIN, 33, { align: "right" });
    doc.setDrawColor(...REPORT_COLORS.rule);
    doc.setLineWidth(0.75);
    doc.line(PAGE_MARGIN, 46, pageWidth - PAGE_MARGIN, 46);
  };

  let continuingFinding: ReportFinding | null = null;
  const newPage = () => {
    doc.addPage();
    drawRunningHeader();
    y = BODY_TOP;
    if (continuingFinding) {
      setFont(true, 8.5, REPORT_COLORS.muted);
      const label = doc.splitTextToSize(clean(`${continuingFinding.reportId} | ${continuingFinding.title} (continued)`), contentWidth) as string[];
      doc.text(label[0], PAGE_MARGIN, y + 7);
      y += 16;
    }
  };

  const ensure = (height: number) => {
    if (y + height > bodyBottom) newPage();
  };

  const startSection = (key: ReportSectionKey, title: string, bookmark = title) => {
    currentSection = title;
    newPage();
    const page = doc.getNumberOfPages();
    sections.push({ key, title, page });
    const outline = doc.outline.add(null, clean(bookmark), { pageNumber: page });
    return outline;
  };

  const widthCache = new Map<string, number>();
  /** Word-wraps mixed bold/regular runs to the given width. */
  const layoutRuns = (runs: readonly TextRun[], width: number, size: number) => {
    type Token = { text: string; bold: boolean; color?: Rgb; kind: "word" | "space" | "break" };
    const tokens: Token[] = [];
    for (const run of runs) {
      const parts = clean(run.text).split("\n");
      parts.forEach((part, index) => {
        if (index > 0) tokens.push({ text: "", bold: false, kind: "break" });
        for (const piece of part.split(/( +)/)) {
          if (!piece) continue;
          tokens.push({ text: piece.startsWith(" ") ? " " : piece, bold: Boolean(run.bold), color: run.color, kind: piece.startsWith(" ") ? "space" : "word" });
        }
      });
    }
    type Segment = { text: string; bold: boolean; color?: Rgb; x: number };
    const lines: Segment[][] = [];
    let line: Segment[] = [];
    let lineWidth = 0;
    let pendingSpace: Token | null = null;
    const measure = (text: string, bold: boolean) => {
      const key = `${bold ? "b" : "n"}${size}|${text}`;
      let width = widthCache.get(key);
      if (width === undefined) {
        doc.setFont("helvetica", bold ? "bold" : "normal");
        doc.setFontSize(size);
        width = doc.getTextWidth(text);
        widthCache.set(key, width);
      }
      return width;
    };
    const push = (token: Token, text: string, textWidth: number) => {
      const last = line[line.length - 1];
      if (last && last.bold === token.bold && last.color === token.color) {
        last.text += text;
      } else {
        line.push({ text, bold: token.bold, color: token.color, x: lineWidth });
      }
      lineWidth += textWidth;
    };
    const breakLine = () => {
      lines.push(line);
      line = [];
      lineWidth = 0;
      pendingSpace = null;
    };
    for (const token of tokens) {
      if (token.kind === "break") {
        breakLine();
        continue;
      }
      if (token.kind === "space") {
        if (line.length > 0) pendingSpace = token;
        continue;
      }
      const spaceWidth = pendingSpace ? measure(" ", pendingSpace.bold) : 0;
      let wordWidth = measure(token.text, token.bold);
      if (line.length > 0 && lineWidth + spaceWidth + wordWidth > width) breakLine();
      if (pendingSpace && line.length > 0) push(pendingSpace, " ", spaceWidth);
      pendingSpace = null;
      if (wordWidth <= width - lineWidth) {
        push(token, token.text, wordWidth);
        continue;
      }
      let rest = token.text;
      while (rest) {
        let take = rest.length;
        while (take > 1 && measure(rest.slice(0, take), token.bold) > width - lineWidth) take -= 1;
        const chunk = rest.slice(0, take);
        wordWidth = measure(chunk, token.bold);
        push(token, chunk, wordWidth);
        rest = rest.slice(take);
        if (rest) breakLine();
      }
    }
    if (line.length > 0 || lines.length === 0) lines.push(line);
    return lines;
  };

  const paragraph = (
    runs: readonly TextRun[],
    options: { size?: number; leading?: number; x?: number; width?: number; color?: Rgb; after?: number } = {},
  ) => {
    const size = options.size ?? 9;
    const leading = options.leading ?? size * 1.32;
    const x = options.x ?? PAGE_MARGIN;
    const width = options.width ?? contentWidth;
    const color = options.color ?? REPORT_COLORS.body;
    for (const line of layoutRuns(runs, width, size)) {
      ensure(leading);
      for (const segment of line) {
        setFont(segment.bold, size, segment.color ?? color);
        doc.text(segment.text, x + segment.x, y + size * 0.8);
      }
      y += leading;
    }
    y += options.after ?? 2;
  };

  const labelled = (label: string, value: string | null | undefined, size = 9) => {
    if (!value || !value.trim()) return;
    paragraph([{ text: `${label}: `, bold: true }, { text: value }], { size });
  };

  const heading = (text: string, size = 13, after = 6, color: Rgb = REPORT_COLORS.heading) => {
    ensure(size * 1.4 + 24);
    setFont(true, size, color);
    doc.text(clean(text), PAGE_MARGIN, y + size * 0.8);
    y += size * 1.3 + after;
  };

  const rule = (color: Rgb = REPORT_COLORS.rule, gap = 8) => {
    doc.setDrawColor(...color);
    doc.setLineWidth(0.6);
    doc.line(PAGE_MARGIN, y, pageWidth - PAGE_MARGIN, y);
    y += gap;
  };

  /** Simple wrapped table; repeats the header row after a page break. */
  const table = (
    columns: Array<{ title: string; width: number; align?: "left" | "right" }>,
    rows: Array<{ cells: string[]; bold?: boolean; fill?: Rgb }>,
    size = 8.5,
  ) => {
    const padX = 5;
    const padY = 4;
    const leading = size * 1.25;
    const drawHeader = () => {
      const height = leading + padY * 2;
      ensure(height + leading * 2);
      doc.setFillColor(...REPORT_COLORS.tableHeader);
      doc.rect(PAGE_MARGIN, y, contentWidth, height, "F");
      let x = PAGE_MARGIN;
      setFont(true, size, REPORT_COLORS.ink);
      for (const column of columns) {
        const textX = column.align === "right" ? x + column.width - padX : x + padX;
        doc.text(clean(column.title), textX, y + padY + size * 0.85, { align: column.align === "right" ? "right" : "left" });
        x += column.width;
      }
      y += height;
    };
    drawHeader();
    for (const row of rows) {
      const cellLines = row.cells.map((cell, index) => {
        setFont(Boolean(row.bold), size);
        return doc.splitTextToSize(clean(cell || "\u2014"), columns[index].width - padX * 2) as string[];
      });
      const height = Math.max(...cellLines.map((lines) => lines.length)) * leading + padY * 2;
      if (y + height > bodyBottom) {
        newPage();
        drawHeader();
      }
      if (row.fill) {
        doc.setFillColor(...row.fill);
        doc.rect(PAGE_MARGIN, y, contentWidth, height, "F");
      }
      let x = PAGE_MARGIN;
      setFont(Boolean(row.bold), size, REPORT_COLORS.body);
      cellLines.forEach((lines, index) => {
        const column = columns[index];
        const textX = column.align === "right" ? x + column.width - padX : x + padX;
        doc.text(lines, textX, y + padY + size * 0.85, { align: column.align === "right" ? "right" : "left", lineHeightFactor: 1.25 });
        x += column.width;
      });
      y += height;
      doc.setDrawColor(...REPORT_COLORS.rule);
      doc.setLineWidth(0.5);
      doc.line(PAGE_MARGIN, y, pageWidth - PAGE_MARGIN, y);
    }
    y += 10;
  };

  const sheetCounts = {
    completed: model.coverage.filter((sheet) => sheet.outcome === "findings" || sheet.outcome === "no_findings").length,
    failed: model.coverage.filter((sheet) => sheet.outcome === "failed").length,
    pending: model.coverage.filter((sheet) => sheet.outcome === "pending").length,
    cancelled: model.coverage.filter((sheet) => sheet.outcome === "cancelled").length,
    total: model.coverage.length,
  };
  const scopeLine = [
    `${sheetCounts.completed} completed`,
    `${sheetCounts.failed} failed`,
    sheetCounts.pending ? `${sheetCounts.pending} in progress` : null,
    sheetCounts.cancelled ? `${sheetCounts.cancelled} cancelled` : null,
    `${sheetCounts.total} total sheets`,
  ].filter(Boolean).join(", ");
  const totals = model.totals.client;
  const findingsLine = [
    `${totals.all} total`,
    `Critical ${totals.critical}`,
    `Warning ${totals.warning}`,
    `Advisory ${totals.advisory}`,
    totals.other ? `Other ${totals.other}` : null,
  ].filter(Boolean).join(" \u00b7 ");
  const projectLabel = input.projectName?.trim() || run.project_id;
  const generatedLabel = formatDateTime(input.generatedAt) || "";
  const completedLabel = formatDateTime(run.completed_at);
  const versionLabel = `${fingerprint.label}${draft ? " \u00b7 Draft, analysis in progress" : ""}`;
  const limitation = (run.analysis_scope as PersistedAnalysisScope | null | undefined)?.limitation || null;
  const bySeverity = (severity: string) => model.clientFindings.filter((finding) => finding.severity === severity);
  const otherFindings = model.clientFindings.filter(
    (finding) => !["critical", "warning", "advisory"].includes(finding.severity),
  );

  doc.setDocumentProperties({
    title: clean(`${REPORT_PRODUCT} \u00b7 ${REPORT_TITLE} \u00b7 ${projectLabel}`),
    subject: clean(`Report version ${fingerprint.label} \u00b7 Run ${run.id}`),
    author: REPORT_COMPANY,
    creator: clean(REPORT_PRODUCT),
    keywords: clean(reportIdentityKeywords({
      fingerprintDigest: fingerprint.digest,
      modelVersion: ARCHITECT_REVIEW_MODEL_VERSION,
      layoutVersion: BRANDED_REPORT_LAYOUT_VERSION,
      disclaimerVersion: DISCLAIMER_VERSION,
    })),
  });
  doc.setCreationDate(input.generatedAt);
  doc.setFileId(fingerprint.digest.slice(0, 32).toUpperCase());

  // Cover
  currentSection = "Cover";
  sections.push({ key: "cover", title: "Cover", page: 1 });
  doc.outline.add(null, "Cover", { pageNumber: 1 });
  y = 36;
  const coverLogo = logoBox(190, 114);
  if (logo && coverLogo) {
    doc.addImage(logo.data, logo.format, (pageWidth - coverLogo.width) / 2, y, coverLogo.width, coverLogo.height, "commun-et-logo", "FAST");
    y += coverLogo.height + 14;
  } else {
    setFont(true, 16, REPORT_COLORS.heading);
    doc.text(REPORT_COMPANY, pageWidth / 2, y + 20, { align: "center" });
    y += 40;
  }
  doc.setDrawColor(...REPORT_COLORS.accent);
  doc.setLineWidth(1.2);
  doc.line(PAGE_MARGIN, y, pageWidth - PAGE_MARGIN, y);
  y += 16;
  setFont(true, 22, REPORT_COLORS.ink);
  doc.text(clean(REPORT_PRODUCT), PAGE_MARGIN, y + 18);
  y += 30;
  setFont(true, 13, REPORT_COLORS.heading);
  doc.text(clean(REPORT_TITLE), PAGE_MARGIN, y + 11);
  y += 28;
  if (draft) {
    paragraph(
      [{ text: "DRAFT. ", bold: true }, { text: "The analysis has sheets that are not finished. Findings, totals and IDs will change when it completes." }],
      { size: 9.5, color: REPORT_COLORS.critical, after: 6 },
    );
  }
  const coverMeta: Array<[string, string | null]> = [
    ["Project", projectLabel],
    ["Jurisdiction", run.jurisdiction_label],
    ["Code basis", run.code_context],
    ["Review scope", scopeLine],
    ["Findings", findingsLine],
    ["Analysis completed", completedLabel],
    ["Report generated", generatedLabel],
    ["Source run", run.id],
    ["Report version", versionLabel],
  ];
  for (const [label, value] of coverMeta) labelled(label, value, 9.5);
  y += 8;

  const disclaimerWidth = contentWidth - 30;
  const disclaimerLines = DISCLAIMER_PARAGRAPHS.map((runs) => layoutRuns(runs, disclaimerWidth, 9));
  const disclaimerLeading = 9 * 1.38;
  const boxHeight = 34 + disclaimerLines.reduce((sum, lines) => sum + lines.length * disclaimerLeading + 6, 0) + 4;
  doc.setFillColor(...REPORT_COLORS.panel);
  doc.setDrawColor(...REPORT_COLORS.accent);
  doc.setLineWidth(0.8);
  doc.rect(PAGE_MARGIN, y, contentWidth, boxHeight, "FD");
  doc.setFillColor(...REPORT_COLORS.accent);
  doc.rect(PAGE_MARGIN, y, 4, boxHeight, "F");
  setFont(true, 10.5, REPORT_COLORS.ink);
  doc.text(DISCLAIMER_HEADING, PAGE_MARGIN + 16, y + 20);
  let boxY = y + 34;
  for (const lines of disclaimerLines) {
    for (const line of lines) {
      for (const segment of line) {
        setFont(segment.bold, 9, REPORT_COLORS.body);
        doc.text(segment.text, PAGE_MARGIN + 16 + segment.x, boxY + 7.2);
      }
      boxY += disclaimerLeading;
    }
    boxY += 6;
  }
  y += boxHeight + 22;
  setFont(true, 11, REPORT_COLORS.ink);
  doc.text("Report navigation", PAGE_MARGIN, y);
  const navigationTop = y + 18;
  y = navigationTop + 64;
  paragraph(
    [{
      text: `All published findings and their stored severity assignments are retained. Finding IDs belong to report version ${fingerprint.label}; they are reassigned if findings or reviewer decisions change. This report presents stored analysis results; it is not a new drawing review.`,
    }],
    { size: 8, color: REPORT_COLORS.muted },
  );

  // Summary
  startSection("summary", "Summary");
  setFont(true, 26, REPORT_COLORS.heading);
  doc.text("Summary", PAGE_MARGIN, y + 22);
  y += 36;
  paragraph([{ text: REPORT_PRODUCT, bold: true }], { size: 11, after: 0 });
  paragraph([{ text: REPORT_TITLE }], { size: 10, after: 0 });
  paragraph([{ text: projectLabel, bold: true }], { size: 10, after: 6 });
  paragraph(
    [{ text: "Severity-ordered presentation of the stored analysis. All published findings and their source severity assignments are retained." }],
    { size: 9, color: REPORT_COLORS.muted, after: 6 },
  );
  labelled("Jurisdiction", run.jurisdiction_label);
  labelled("Code edition / context", `${run.code_edition} | ${run.code_context}`);
  labelled("Analysis mode", displayAnalysisMode(run.analysis_mode));
  labelled("Sheets", scopeLine);
  labelled("Findings", findingsLine);
  labelled("Source run", run.id);
  labelled("Report version", versionLabel);
  y += 6;
  heading("Summary", 13, 4);
  const criticalFindings = bySeverity("critical");
  paragraph([
    { text: `Critical: ${criticalFindings.length}. `, bold: true },
    {
      text: criticalFindings.length
        ? "Review the items below first. These are source-assigned priorities, not verified violations."
        : "No findings in this report version carry a critical priority.",
    },
  ], { after: 6 });
  for (const finding of criticalFindings) {
    paragraph([{ text: `${finding.reportId} \u00b7 ${sheetLabel(finding)} \u00b7 ${finding.title}`, bold: true, color: REPORT_COLORS.critical }], { size: 9, after: 0, x: PAGE_MARGIN + 10, width: contentWidth - 10 });
    paragraph([{ text: finding.presentedRecommendation }], { size: 8.5, after: 5, x: PAGE_MARGIN + 10, width: contentWidth - 10, color: REPORT_COLORS.muted });
  }
  paragraph([
    { text: `Warning: ${bySeverity("warning").length}. `, bold: true },
    { text: "Source-assigned warning priority. Review after the Critical items; see the Warning section." },
  ], { after: 6 });
  paragraph([
    { text: `Advisory: ${bySeverity("advisory").length}. `, bold: true },
    { text: "Complete these documentation, coordination and verification checks after the higher-priority review." },
  ], { after: 6 });
  if (otherFindings.length) {
    paragraph([
      { text: `Other severity: ${otherFindings.length}. `, bold: true },
      { text: "These findings carry a stored severity outside Critical, Warning and Advisory. It is shown unchanged." },
    ], { after: 6 });
  }
  if (model.withdrawnFindings.length) {
    paragraph([
      { text: `Withdrawn by reviewer: ${model.withdrawnFindings.length}. `, bold: true },
      { text: "These keep their IDs and are listed in the withdrawn-findings appendix; they are not presented as findings." },
    ], { after: 6 });
  }

  // Inventory and scope
  startSection("inventory", "Review inventory and scope");
  setFont(true, 24, REPORT_COLORS.heading);
  doc.text("Review inventory and scope", PAGE_MARGIN, y + 20);
  y += 34;
  const showOther = model.inventoryTotal.other > 0;
  const inventoryColumns = showOther
    ? [
      { title: "Discipline", width: 144 },
      { title: "Sheets", width: 60 },
      { title: "Critical", width: 60 },
      { title: "Warning", width: 60 },
      { title: "Advisory", width: 60 },
      { title: "Other", width: 60 },
      { title: "Total", width: 60 },
    ]
    : [
      { title: "Discipline", width: 174 },
      { title: "Sheets", width: 66 },
      { title: "Critical", width: 66 },
      { title: "Warning", width: 66 },
      { title: "Advisory", width: 66 },
      { title: "Total", width: 66 },
    ];
  const inventoryCells = (row: ArchitectReviewModel["inventoryTotal"]) => [
    row.discipline,
    String(row.sheets),
    String(row.critical),
    String(row.warning),
    String(row.advisory),
    ...(showOther ? [String(row.other)] : []),
    String(row.total),
  ];
  table(
    inventoryColumns,
    [
      ...model.inventory.map((row) => ({ cells: inventoryCells(row) })),
      { cells: inventoryCells({ ...model.inventoryTotal, discipline: "TOTAL" }), bold: true, fill: REPORT_COLORS.tableHeader },
    ],
    9,
  );
  paragraph(
    [{ text: "Sheet counts include every sheet in the analysis. Finding counts exclude findings withdrawn by a reviewer." }],
    { size: 8, color: REPORT_COLORS.muted, after: 8 },
  );
  heading("Analysis scope", 13, 2);
  labelled("Analysis mode", displayAnalysisMode(run.analysis_mode));
  labelled("Code basis", run.code_context);
  if (limitation) labelled("Source note", limitation);
  paragraph([{
    text: `Sheet outcomes: ${model.coverage.filter((sheet) => sheet.outcome === "findings").length} analyzed with findings, ${model.coverage.filter((sheet) => sheet.outcome === "no_findings").length} analyzed with no findings, ${sheetCounts.failed} not analyzed (processing failed)${sheetCounts.pending ? `, ${sheetCounts.pending} in progress` : ""}${sheetCounts.cancelled ? `, ${sheetCounts.cancelled} cancelled` : ""}. Each sheet is listed in the sheet coverage appendix.`,
  }]);

  // Reading guide
  startSection("guide", "Reading guide and qualifications");
  setFont(true, 24, REPORT_COLORS.heading);
  doc.text("Reading guide and qualifications", PAGE_MARGIN, y + 20);
  y += 34;
  heading("How to use the findings", 12, 2);
  paragraph([{ text: "Read the source observation and evidence, then confirm the applicable provisions in the adopted code text. Close an issue only after checking the complete drawing set, adopted code text and project conditions." }], { after: 6 });
  const ranges = ["critical", "warning", "advisory"]
    .map((severity) => idRange(model.findings.filter((finding) => finding.severity === severity)))
    .filter(Boolean)
    .join(", ");
  paragraph([
    { text: "Finding IDs: ", bold: true },
    { text: `${ranges || "No findings"} identify findings in report version ${fingerprint.label}. IDs are assigned by severity, then original sheet order. They are reassigned when findings or reviewer decisions change, so quote the report version with an ID. Each finding keeps its sheet, its source finding number in original sheet order and its permanent analyzer record.` },
  ], { after: 6 });
  paragraph([
    { text: "Severity: ", bold: true },
    { text: "Severity labels are assigned by the analyzer and reproduced unchanged. They indicate review priority, not a verified violation." },
  ], { after: 6 });
  paragraph([
    { text: "Code citations: ", bold: true },
    { text: "An \u201cOriginal citation (not endorsed)\u201d is the analyzer's suggested reference. It has not been verified against the adopted text. Findings without a citation still require the applicable provisions to be identified." },
  ], { after: 6 });
  paragraph([
    { text: "Documentation versus deficiency: ", bold: true },
    { text: "Missing information on one sheet, a cross-reference, a manufacturer note or a coordination request does not establish a code violation." },
  ], { after: 6 });
  paragraph([
    { text: "Trade boundaries: ", bold: true },
    { text: "Electrical, mechanical, plumbing and fire-protection findings use their own code families." },
  ], { after: 6 });
  paragraph([
    { text: "Reviewer decisions: ", bold: true },
    { text: "Accepted findings are marked as accepted. Where a reviewer modified a recommendation, the reviewer's response is presented and the original recommendation is shown beneath it. Findings rejected by a reviewer are withdrawn from the findings sections and listed with their IDs in an appendix. Reviewer decisions record a response to the recommendation; they are not an independent code-compliance verification." },
  ], { after: 10 });
  heading("Professional verification required", 12, 2);
  for (const text of VERIFICATION_RESTATEMENT) paragraph([{ text }], { after: 6 });

  // Severity sections
  const renderFinding = (finding: ReportFinding) => {
    ensure(64);
    findingPages.set(finding.reportId, doc.getNumberOfPages());
    paragraph([{ text: `${finding.reportId} | ${finding.title}`, bold: true, color: severityColor(finding.severity) }], { size: 11, after: 1 });
    continuingFinding = finding;
    paragraph([
      { text: sheetLabel(finding), bold: true },
      ...(finding.sheet.sheetTitle ? [{ text: ` | ${finding.sheet.sheetTitle}` }] : []),
    ], { size: 8.5, after: 0, color: REPORT_COLORS.body });
    paragraph([{
      text: [
        finding.sheet.discipline,
        `Source finding ${String(finding.sourceSequence).padStart(3, "0")}`,
        knownSeverityLabel(finding.severity) ? null : `Stored severity: ${finding.severity}`,
      ].filter(Boolean).join(" \u00b7 "),
    }], { size: 8, color: REPORT_COLORS.muted, after: 3 });
    labelled("Observation (source)", finding.observation);
    labelled("Drawing evidence (source)", finding.drawingEvidence);
    labelled("Location (source)", finding.drawingLocation);
    if (finding.recommendationRevised) {
      labelled("Recommended action (reviewer revised)", finding.presentedRecommendation);
      labelled("Original recommendation (source)", finding.recommendation);
    } else {
      labelled("Recommended action (source)", finding.recommendation);
    }
    labelled("Original citation (not endorsed)", finding.codeReference);
    if (finding.review) {
      const decided = formatDate(finding.review.decidedAt);
      labelled("Reviewer decision", `${reviewDecisionLabel(finding.review.decision)}${decided ? ` \u00b7 ${decided}` : ""}`);
    }
    continuingFinding = null;
    y += 4;
    rule();
  };

  const findingBookmark = (finding: ReportFinding) => `${finding.reportId} | ${sheetLabel(finding)} | ${finding.title}`;

  for (const section of SEVERITY_SECTIONS) {
    const items = bySeverity(section.key);
    const outline = startSection(section.key, `${section.label} findings`, `${section.label} findings \u00b7 ${items.length}`);
    setFont(true, 24, REPORT_COLORS.heading);
    doc.text(clean(`${section.label} findings | ${items.length}`), PAGE_MARGIN, y + 20);
    y += 32;
    paragraph([{ text: section.intro }], { size: 8.5, color: REPORT_COLORS.muted, after: 8 });
    if (!items.length) {
      paragraph([{ text: `No ${section.label.toLowerCase()} findings in this report version.` }]);
    }
    for (const finding of items) {
      renderFinding(finding);
      doc.outline.add(outline, clean(findingBookmark(finding)), { pageNumber: findingPages.get(finding.reportId) as number });
    }
  }
  if (otherFindings.length) {
    const outline = startSection("other", "Other severity findings", `Other severity findings \u00b7 ${otherFindings.length}`);
    setFont(true, 24, REPORT_COLORS.heading);
    doc.text(clean(`Other severity findings | ${otherFindings.length}`), PAGE_MARGIN, y + 20);
    y += 32;
    paragraph([{ text: "These findings carry a stored severity outside Critical, Warning and Advisory. The stored value is shown unchanged on each finding." }], { size: 8.5, color: REPORT_COLORS.muted, after: 8 });
    for (const finding of otherFindings) {
      renderFinding(finding);
      doc.outline.add(outline, clean(findingBookmark(finding)), { pageNumber: findingPages.get(finding.reportId) as number });
    }
  }

  // Appendices
  startSection("coverage", "Appendix: Sheet coverage");
  setFont(true, 20, REPORT_COLORS.heading);
  doc.text("Appendix: Sheet coverage", PAGE_MARGIN, y + 17);
  y += 30;
  paragraph([{ text: "Every sheet in the analysis, in original order. Sheets that were not analyzed are not evidence that no issues exist." }], { size: 8.5, color: REPORT_COLORS.muted, after: 6 });
  table(
    [
      { title: "#", width: 28, align: "right" },
      { title: "Sheet", width: 76 },
      { title: "Title", width: 170 },
      { title: "Discipline", width: 82 },
      { title: "Outcome", width: 100 },
      { title: "Findings", width: 48, align: "right" },
    ],
    model.coverage.map((sheet) => ({
      cells: [
        sheet.ordinal === null ? "" : String(sheet.ordinal),
        sheet.sheetNumber || sheet.fileName || "",
        sheet.sheetTitle || "",
        sheet.discipline,
        OUTCOME_LABEL[sheet.outcome],
        sheet.outcome === "pending" || sheet.outcome === "failed" ? "\u2014" : String(sheet.findingCount),
      ],
    })),
    8,
  );

  if (model.withdrawnFindings.length) {
    startSection("withdrawn", "Appendix: Withdrawn by reviewer");
    setFont(true, 20, REPORT_COLORS.heading);
    doc.text("Appendix: Withdrawn by reviewer", PAGE_MARGIN, y + 17);
    y += 30;
    paragraph([{ text: "A reviewer rejected these findings. They are not presented as findings and keep their IDs so that the numbering in this report version has no unexplained gaps. The stored findings are unchanged." }], { size: 8.5, color: REPORT_COLORS.muted, after: 6 });
    table(
      [
        { title: "ID", width: 52 },
        { title: "Sheet", width: 76 },
        { title: "Finding", width: 236 },
        { title: "Stored severity", width: 74 },
        { title: "Decided", width: 66 },
      ],
      model.withdrawnFindings.map((finding) => ({
        cells: [
          finding.reportId,
          sheetLabel(finding),
          finding.title,
          knownSeverityLabel(finding.severity) || finding.severity,
          formatDate(finding.review?.decidedAt) || "",
        ],
      })),
      8,
    );
  }

  startSection("record", "Appendix: Report record");
  setFont(true, 20, REPORT_COLORS.heading);
  doc.text("Appendix: Report record", PAGE_MARGIN, y + 17);
  y += 30;
  labelled("Report version", fingerprint.label);
  labelled("Report fingerprint (SHA-256)", fingerprint.digest);
  paragraph([{ text: "The fingerprint covers the run settings, every sheet, every published finding and every reviewer decision. Any change to them produces a different report version." }], { size: 8.5, color: REPORT_COLORS.muted, after: 6 });
  labelled("Source run", run.id);
  labelled("Run status", run.status.replace(/_/g, " "));
  labelled("Analysis completed", completedLabel);
  labelled("Report generated", generatedLabel);
  labelled("Published findings", String(model.totals.published.all));
  labelled("Presented findings", String(model.totals.client.all));
  labelled("Withdrawn by reviewer", String(model.totals.withdrawn));
  labelled("Report model", ARCHITECT_REVIEW_MODEL_VERSION);
  labelled("Report layout", BRANDED_REPORT_LAYOUT_VERSION);
  labelled("Disclaimer text", DISCLAIMER_VERSION);
  const notes = [...model.integrityIssues];
  heading("Data notes", 12, 2);
  if (substituted > 0) {
    notes.push(`${substituted} character(s) could not be drawn in the report font and were replaced. The stored text is unchanged.`);
  }
  if (notes.length === 0) {
    paragraph([{ text: "None." }]);
  } else {
    for (const note of notes) paragraph([{ text: `\u2022 ${note}` }], { size: 8.5 });
  }

  // Cover navigation and page furniture need final page numbers.
  doc.setPage(1);
  const navigation: Array<{ label: string; key: ReportSectionKey }> = [
    { label: "Summary", key: "summary" },
    { label: `Critical \u00b7 ${bySeverity("critical").length}`, key: "critical" },
    { label: `Warning \u00b7 ${bySeverity("warning").length}`, key: "warning" },
    { label: `Advisory \u00b7 ${bySeverity("advisory").length}`, key: "advisory" },
    { label: "Inventory and scope", key: "inventory" },
    { label: "Reading guide", key: "guide" },
    { label: "Sheet coverage", key: "coverage" },
    { label: "Report record", key: "record" },
  ];
  const columnWidth = contentWidth / 4;
  navigation.forEach((item, index) => {
    const page = sectionPage(item.key);
    if (!page) return;
    const x = PAGE_MARGIN + (index % 4) * columnWidth;
    const rowY = navigationTop + Math.floor(index / 4) * 30;
    setFont(true, 9.5, REPORT_COLORS.link);
    doc.textWithLink(clean(item.label), x, rowY, { pageNumber: page });
    setFont(false, 8.5, REPORT_COLORS.muted);
    doc.textWithLink(`Page ${page}`, x, rowY + 12, { pageNumber: page });
  });

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(...REPORT_COLORS.accent);
    doc.setLineWidth(0.6);
    doc.line(PAGE_MARGIN, pageHeight - 46, pageWidth - PAGE_MARGIN, pageHeight - 46);
    setFont(false, 7.5, REPORT_COLORS.muted);
    doc.text(FOOTER_NOTICE, PAGE_MARGIN, pageHeight - 32);
    doc.text(`Report ${fingerprint.label}${draft ? " DRAFT" : ""} \u00b7 ${page} / ${pageCount}`, pageWidth - PAGE_MARGIN, pageHeight - 32, { align: "right" });
  }

  return {
    doc,
    layout: { pageCount, sections, findingPages, substitutedCharacters: substituted },
  };
}

function knownSeverityLabel(severity: string): string | null {
  if (severity === "critical") return "Critical";
  if (severity === "warning") return "Warning";
  if (severity === "advisory") return "Advisory";
  return null;
}
