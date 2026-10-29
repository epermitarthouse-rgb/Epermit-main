/**
 * Commun-ET branded Excel findings register.
 * Built from the architect review model so IDs, order, counts and the fingerprint
 * match the M2 PDF. Reserved lookup/qualification columns stay empty until later phases.
 */
import type { Workbook, Worksheet } from "exceljs";
import type { PersistedAnalysisScope } from "@/lib/supabaseAnalyzer/analysisMode";
import { displayAnalysisMode } from "@/lib/supabaseAnalyzer/analysisMode";
import {
  ARCHITECT_REVIEW_MODEL_VERSION,
  type ArchitectReviewFingerprint,
  type ArchitectReviewModel,
  type ReportFinding,
} from "@/lib/supabaseAnalyzer/architectReview";
import type { AnalyzerRunDataset } from "@/lib/supabaseAnalyzer/client";
import {
  DISCLAIMER_SHORT,
  DISCLAIMER_VERSION,
  REPORT_COLORS,
  REPORT_COMPANY,
  REPORT_PRODUCT,
  type Rgb,
} from "@/lib/supabaseAnalyzer/reportBranding";
import { reviewDecisionLabel } from "@/lib/supabaseAnalyzer/reviewDecisions";
import { reportIdentityKeywords } from "../../../supabase/functions/_shared/analyzerExportAudit.ts";

export const FINDINGS_REGISTER_LAYOUT_VERSION = "findings-register-xlsx.v1";

export const FINDINGS_REGISTER_SHEETS = {
  register: "Findings Register",
  summary: "Summary",
  withdrawn: "Withdrawn",
  record: "Report record",
} as const;

export const REGISTER_STATUS_OPTIONS = [
  "Open",
  "In progress",
  "Resolved",
  "Not applicable",
  "Disputed",
] as const;

export const REFERENCE_BASIS = {
  cited: "Cited by PermitPilot",
  suggested: "Suggested starting point - verify",
  coordination: "Coordination item - no code provision",
} as const;

export const REGISTER_HEADER_ROW = 5;
export const REGISTER_FIRST_DATA_ROW = 6;

const NAVY = "FF1A5276";
const TITLE = "FF0E2F47";
const MUTED = "FF5A5A5A";
const WHITE = "FFFFFFFF";
const DISCLAIMER_RED = "FFC00000";
const THIN = { style: "thin" as const, color: { argb: "FFD0D7DE" } };

type ExcelJSModule = typeof import("exceljs");

/** exceljs CJS/ESM/Vite each surface Workbook in a different place. */
export function resolveExcelJS(mod: unknown): ExcelJSModule {
  const candidate = mod as { Workbook?: unknown; default?: { Workbook?: unknown } };
  if (typeof candidate.Workbook === "function") return candidate as ExcelJSModule;
  if (typeof candidate.default?.Workbook === "function") return candidate.default as ExcelJSModule;
  throw new Error("exceljs did not load.");
}

export interface FindingsRegisterInput {
  dataset: AnalyzerRunDataset;
  model: ArchitectReviewModel;
  fingerprint: ArchitectReviewFingerprint;
  projectName?: string | null;
  generatedAt: Date;
  /** JPEG base64 without a data-URL prefix. Optional; the register still builds without it. */
  logoBase64?: string | null;
}

export interface FindingsRegisterColumn {
  key: string;
  header: string;
  width: number;
  hidden?: boolean;
  reserved?: boolean;
}

/** Stable column map. Reserved keys stay empty so later lookup/qualification work does not reshape the file. */
export const REGISTER_COLUMNS: readonly FindingsRegisterColumn[] = [
  { key: "id", header: "ID", width: 10 },
  { key: "severity", header: "Severity", width: 11 },
  { key: "discipline", header: "Discipline", width: 16 },
  { key: "sheet", header: "Sheet", width: 12 },
  { key: "sheetTitle", header: "Sheet title", width: 30 },
  { key: "title", header: "Finding", width: 34 },
  { key: "observation", header: "Observation", width: 52 },
  { key: "drawingEvidence", header: "Drawing evidence", width: 44 },
  { key: "location", header: "Location", width: 30 },
  { key: "codeReference", header: "Code reference", width: 40 },
  { key: "referenceBasis", header: "Reference basis", width: 28 },
  { key: "recommendation", header: "Recommended action", width: 52 },
  { key: "status", header: "Status", width: 14 },
  { key: "owner", header: "Owner", width: 13 },
  { key: "dateClosed", header: "Date closed", width: 13 },
  { key: "notes", header: "Notes", width: 34 },
  { key: "reviewerDecision", header: "Reviewer decision", width: 18 },
  { key: "originalRecommendation", header: "Original recommendation", width: 44 },
  { key: "sourceFinding", header: "Source finding", width: 14 },
  { key: "codeLookup", header: "Code lookup / applicability review", width: 40, hidden: true, reserved: true },
  { key: "dcLookup", header: "DC lookup (supplemental)", width: 40, hidden: true, reserved: true },
  { key: "reviewQualification", header: "Review qualification", width: 40, hidden: true, reserved: true },
  { key: "permitPilotRef", header: "PermitPilot ref", width: 44, hidden: true },
  { key: "findingUuid", header: "Finding UUID", width: 40, hidden: true },
  { key: "reportVersion", header: "Report version", width: 16, hidden: true },
];

export interface FindingsRegisterLayout {
  lastDataRow: number;
  lastWithdrawnRow: number;
  columnIndex: Record<string, number>;
  presentedCount: number;
  withdrawnCount: number;
}

export function findingsRegisterFileName(runId: string, fingerprint: ArchitectReviewFingerprint): string {
  const shortId = runId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 8) || "run";
  return `PermitPilot-Findings-Register-${shortId}-${fingerprint.label}.xlsx`;
}

export function referenceBasisFor(finding: Pick<ReportFinding, "codeReference">): string {
  return finding.codeReference?.trim() ? REFERENCE_BASIS.cited : REFERENCE_BASIS.coordination;
}

export function columnIndexMap(): Record<string, number> {
  return Object.fromEntries(REGISTER_COLUMNS.map((column, index) => [column.key, index + 1]));
}

export function buildFindingsRegisterWorkbook(
  exceljs: ExcelJSModule,
  input: FindingsRegisterInput,
): { workbook: Workbook; layout: FindingsRegisterLayout } {
  const { dataset, model, fingerprint } = input;
  const { run } = dataset;
  const workbook = new exceljs.Workbook();
  workbook.creator = REPORT_COMPANY;
  workbook.lastModifiedBy = REPORT_PRODUCT;
  workbook.created = input.generatedAt;
  workbook.modified = input.generatedAt;
  workbook.title = `${REPORT_PRODUCT} - Findings Register`;
  workbook.subject = `Report version ${fingerprint.label} · Run ${run.id}`;
  workbook.keywords = reportIdentityKeywords({
    fingerprintDigest: fingerprint.digest,
    modelVersion: ARCHITECT_REVIEW_MODEL_VERSION,
    layoutVersion: FINDINGS_REGISTER_LAYOUT_VERSION,
    disclaimerVersion: DISCLAIMER_VERSION,
  });
  workbook.calcProperties.fullCalcOnLoad = true;

  const columnIndex = columnIndexMap();
  const lastDataRow = Math.max(REGISTER_FIRST_DATA_ROW, REGISTER_HEADER_ROW + model.clientFindings.length);
  const lastWithdrawnRow = Math.max(REGISTER_FIRST_DATA_ROW, REGISTER_HEADER_ROW + model.withdrawnFindings.length);

  addRegisterSheet(workbook, input, columnIndex, lastDataRow);
  addSummarySheet(workbook, input, columnIndex, lastDataRow, lastWithdrawnRow);
  addWithdrawnSheet(workbook, input, lastWithdrawnRow);
  addRecordSheet(workbook, input);

  return {
    workbook,
    layout: {
      lastDataRow,
      lastWithdrawnRow,
      columnIndex,
      presentedCount: model.clientFindings.length,
      withdrawnCount: model.withdrawnFindings.length,
    },
  };
}

function argb(rgb: Rgb): string {
  return `FF${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function colLetter(index: number): string {
  let remaining = index;
  let letter = "";
  while (remaining > 0) {
    const offset = (remaining - 1) % 26;
    letter = String.fromCharCode(65 + offset) + letter;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return letter;
}

/** Single Status list range. exceljs must not also receive per-cell copies of this spec. */
export function statusDropdownRange(lastDataRow: number, columnIndex: Record<string, number> = columnIndexMap()): string {
  return `${colLetter(columnIndex.status)}${REGISTER_FIRST_DATA_ROW}:${colLetter(columnIndex.status)}${lastDataRow}`;
}

function applyStatusDropdown(sheet: Worksheet, lastDataRow: number, columnIndex: Record<string, number>) {
  const host = sheet as unknown as {
    dataValidations: { model: Record<string, unknown>; add: (range: string, spec: object) => void };
  };
  for (const key of Object.keys(host.dataValidations.model || {})) {
    delete host.dataValidations.model[key];
  }
  host.dataValidations.add(statusDropdownRange(lastDataRow, columnIndex), {
    type: "list",
    allowBlank: true,
    formulae: [`"${REGISTER_STATUS_OPTIONS.join(",")}"`],
    showErrorMessage: true,
    errorStyle: "warning",
    errorTitle: "Status",
    error: "Choose a value from the list.",
  });
}

function quoteSheet(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

function sheetLabel(finding: Pick<ReportFinding, "sheet">): string {
  return finding.sheet.sheetNumber || (finding.sheet.ordinal ? `Sheet ${finding.sheet.ordinal}` : "Sheet not identified");
}

function severityLabel(severity: string): string {
  if (severity === "critical") return "Critical";
  if (severity === "warning") return "Warning";
  if (severity === "advisory") return "Advisory";
  return severity;
}

function severityArgb(severity: string): string {
  if (severity === "critical") return argb(REPORT_COLORS.critical);
  if (severity === "warning") return argb(REPORT_COLORS.warning);
  if (severity === "advisory") return argb(REPORT_COLORS.advisory);
  return argb(REPORT_COLORS.other);
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

function applyFont(cell: { font: object }, options: { bold?: boolean; size?: number; color?: string; name?: string }) {
  cell.font = {
    name: options.name || "Calibri",
    bold: Boolean(options.bold),
    size: options.size ?? 9,
    color: { argb: options.color || TITLE },
  };
}

function fillNavy(cell: { fill: object }) {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
}

function wrapTop(cell: { alignment: object }) {
  cell.alignment = { wrapText: true, vertical: "top", horizontal: "left" };
}

function registerRange(columnKey: string, lastDataRow: number, columnIndex: Record<string, number>): string {
  const letter = colLetter(columnIndex[columnKey]);
  return `${quoteSheet(FINDINGS_REGISTER_SHEETS.register)}!$${letter}$${REGISTER_FIRST_DATA_ROW}:$${letter}$${lastDataRow}`;
}

function addBrandingRows(
  sheet: Worksheet,
  input: FindingsRegisterInput,
  lastCol: number,
  kind: "register" | "withdrawn",
) {
  const { dataset, model, fingerprint } = input;
  const project = input.projectName?.trim() || dataset.run.project_id;
  const generated = formatDateTime(input.generatedAt) || "";
  const draft = model.isFinal ? "" : " · Draft";
  const title = kind === "withdrawn"
    ? `${REPORT_COMPANY}  |  ${REPORT_PRODUCT} - Withdrawn findings`
    : `${REPORT_COMPANY}  |  ${REPORT_PRODUCT} - Findings Register`;
  sheet.getCell("A1").value = title;
  applyFont(sheet.getCell("A1"), { bold: true, size: 13, color: TITLE });
  sheet.getCell("A2").value = [
    project,
    dataset.run.jurisdiction_label,
    dataset.run.code_context,
    `Run ${dataset.run.id}`,
    `Report ${fingerprint.label}${draft}`,
    generated ? `Generated ${generated}` : null,
  ].filter(Boolean).join(" · ");
  applyFont(sheet.getCell("A2"), { size: 9, color: MUTED });
  sheet.getCell("A3").value = DISCLAIMER_SHORT;
  applyFont(sheet.getCell("A3"), { size: 9, color: DISCLAIMER_RED });
  sheet.mergeCells(1, 1, 1, Math.min(8, lastCol));
  sheet.mergeCells(2, 1, 2, Math.min(8, lastCol));
  sheet.mergeCells(3, 1, 3, Math.min(8, lastCol));
  sheet.getRow(1).height = 18;
  sheet.getRow(2).height = 18;
  sheet.getRow(3).height = 32;
  wrapTop(sheet.getCell("A2"));
  wrapTop(sheet.getCell("A3"));
}

function styleHeaderRow(sheet: Worksheet, headers: readonly string[], fill = NAVY) {
  const row = sheet.getRow(REGISTER_HEADER_ROW);
  row.height = 22;
  headers.forEach((header, index) => {
    const cell = row.getCell(index + 1);
    cell.value = header;
    applyFont(cell, { bold: true, size: 9, color: WHITE });
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    cell.alignment = { wrapText: true, vertical: "middle", horizontal: "left" };
    cell.border = { top: THIN, bottom: THIN, left: THIN, right: THIN };
  });
}

function permitPilotRef(finding: ReportFinding, fingerprint: ArchitectReviewFingerprint): string {
  return `${finding.runId} · ${finding.findingId} · ${fingerprint.label}`;
}

function findingCells(finding: ReportFinding, fingerprint: ArchitectReviewFingerprint): Record<string, string | number | null> {
  return {
    id: finding.reportId,
    severity: severityLabel(finding.severity),
    discipline: finding.sheet.discipline,
    sheet: sheetLabel(finding),
    sheetTitle: finding.sheet.sheetTitle || "",
    title: finding.title,
    observation: finding.observation,
    drawingEvidence: finding.drawingEvidence,
    location: finding.drawingLocation || "",
    codeReference: finding.codeReference || "",
    referenceBasis: referenceBasisFor(finding),
    recommendation: finding.presentedRecommendation,
    status: "",
    owner: "",
    dateClosed: "",
    notes: "",
    reviewerDecision: finding.review ? reviewDecisionLabel(finding.review.decision) : "",
    originalRecommendation: finding.recommendationRevised ? finding.recommendation : "",
    sourceFinding: String(finding.sourceSequence).padStart(3, "0"),
    codeLookup: "",
    dcLookup: "",
    reviewQualification: "",
    permitPilotRef: permitPilotRef(finding, fingerprint),
    findingUuid: finding.findingId,
    reportVersion: fingerprint.label,
  };
}

function writeDataRow(
  sheet: Worksheet,
  rowNumber: number,
  columns: readonly FindingsRegisterColumn[],
  values: Record<string, string | number | null>,
  severity: string,
) {
  const row = sheet.getRow(rowNumber);
  row.height = 36;
  columns.forEach((column, index) => {
    const cell = row.getCell(index + 1);
    const value = values[column.key];
    cell.value = value === "" ? null : value;
    wrapTop(cell);
    cell.border = { top: THIN, bottom: THIN, left: THIN, right: THIN };
    applyFont(cell, {
      bold: column.key === "id" || column.key === "severity",
      size: 9,
      color: column.key === "id" || column.key === "severity" ? severityArgb(severity) : TITLE,
    });
    if (column.key === "dateClosed") cell.numFmt = "yyyy-mm-dd";
  });
}

function addRegisterSheet(
  workbook: Workbook,
  input: FindingsRegisterInput,
  columnIndex: Record<string, number>,
  lastDataRow: number,
) {
  const sheet = workbook.addWorksheet(FINDINGS_REGISTER_SHEETS.register, {
    views: [{ state: "frozen", xSplit: 5, ySplit: REGISTER_HEADER_ROW, topLeftCell: "F6", activeCell: "A6" }],
    properties: { tabColor: { argb: NAVY }, defaultRowHeight: 15 },
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });
  sheet.columns = REGISTER_COLUMNS.map((column) => ({
    key: column.key,
    width: column.width,
  }));
  addBrandingRows(sheet, input, REGISTER_COLUMNS.length, "register");
  styleHeaderRow(sheet, REGISTER_COLUMNS.map((column) => column.header));
  input.model.clientFindings.forEach((finding, index) => {
    writeDataRow(
      sheet,
      REGISTER_FIRST_DATA_ROW + index,
      REGISTER_COLUMNS,
      findingCells(finding, input.fingerprint),
      finding.severity,
    );
  });
  sheet.autoFilter = {
    from: { row: REGISTER_HEADER_ROW, column: 1 },
    to: { row: lastDataRow, column: REGISTER_COLUMNS.length },
  };
  applyStatusDropdown(sheet, lastDataRow, columnIndex);
  REGISTER_COLUMNS.forEach((column, index) => {
    if (column.hidden) sheet.getColumn(index + 1).hidden = true;
  });
  if (input.logoBase64) {
    const imageId = workbook.addImage({ base64: input.logoBase64, extension: "jpeg" });
    sheet.addImage(imageId, { tl: { col: 12.2, row: 0.1 }, ext: { width: 118, height: 71 } });
  }
}

function headerFill(sheet: Worksheet, row: number, cols: number) {
  for (let col = 1; col <= cols; col += 1) {
    const cell = sheet.getCell(row, col);
    applyFont(cell, { bold: true, size: 9, color: WHITE });
    fillNavy(cell);
    cell.alignment = { wrapText: true, vertical: "middle" };
  }
}

function addSummarySheet(
  workbook: Workbook,
  input: FindingsRegisterInput,
  columnIndex: Record<string, number>,
  lastDataRow: number,
  lastWithdrawnRow: number,
) {
  const sheet = workbook.addWorksheet(FINDINGS_REGISTER_SHEETS.summary, {
    properties: { tabColor: { argb: argb(REPORT_COLORS.accent) } },
  });
  sheet.getColumn(1).width = 42;
  sheet.getColumn(2).width = 14;
  sheet.getColumn(3).width = 14;
  sheet.getColumn(4).width = 14;
  sheet.getColumn(5).width = 14;
  sheet.getColumn(6).width = 14;
  sheet.getCell("A1").value = "Summary";
  applyFont(sheet.getCell("A1"), { bold: true, size: 13, color: TITLE });
  sheet.getCell("A2").value = "Counts are live formulas against the Findings Register tab. Rejected findings are on the Withdrawn sheet and are not counted here.";
  applyFont(sheet.getCell("A2"), { size: 9, color: MUTED });
  wrapTop(sheet.getCell("A2"));
  sheet.mergeCells("A2:F2");
  sheet.getRow(2).height = 28;

  sheet.getCell("A4").value = "Severity";
  sheet.getCell("B4").value = "Count";
  sheet.getCell("C4").value = "Share";
  headerFill(sheet, 4, 3);
  const severityRows: Array<{ label: string; color: string; criterion?: string }> = [
    { label: "Critical", color: argb(REPORT_COLORS.critical), criterion: "Critical" },
    { label: "Warning", color: argb(REPORT_COLORS.warning), criterion: "Warning" },
    { label: "Advisory", color: argb(REPORT_COLORS.advisory), criterion: "Advisory" },
    { label: "Other", color: argb(REPORT_COLORS.other) },
    { label: "Total", color: TITLE },
  ];
  const severityRange = registerRange("severity", lastDataRow, columnIndex);
  severityRows.forEach((item, index) => {
    const row = 5 + index;
    sheet.getCell(row, 1).value = item.label;
    applyFont(sheet.getCell(row, 1), { bold: true, size: 9, color: item.color });
    if (item.criterion) {
      sheet.getCell(row, 2).value = { formula: `COUNTIF(${severityRange},A${row})` };
    } else if (item.label === "Other") {
      sheet.getCell(row, 2).value = { formula: `MAX(0,COUNTA(${severityRange})-B5-B6-B7)` };
    } else {
      sheet.getCell(row, 2).value = { formula: "SUM(B5:B8)" };
    }
    sheet.getCell(row, 3).value = { formula: item.label === "Total" ? "IF(B9=0,0,SUM(C5:C8))" : `IF($B$9=0,0,B${row}/$B$9)` };
    sheet.getCell(row, 3).numFmt = "0.0%";
    applyFont(sheet.getCell(row, 2), { size: 9, color: TITLE });
    applyFont(sheet.getCell(row, 3), { size: 9, color: TITLE });
  });

  const disciplineStart = 12;
  sheet.getCell(`A${disciplineStart - 1}`).value = "Discipline";
  sheet.getCell(`B${disciplineStart - 1}`).value = "Critical";
  sheet.getCell(`C${disciplineStart - 1}`).value = "Warning";
  sheet.getCell(`D${disciplineStart - 1}`).value = "Advisory";
  sheet.getCell(`E${disciplineStart - 1}`).value = "Other";
  sheet.getCell(`F${disciplineStart - 1}`).value = "Total";
  headerFill(sheet, disciplineStart - 1, 6);
  const disciplineRange = registerRange("discipline", lastDataRow, columnIndex);
  const rows = input.model.inventory.length ? input.model.inventory : [{ discipline: "(none)", critical: 0, warning: 0, advisory: 0, other: 0, total: 0, sheets: 0 }];
  rows.forEach((item, index) => {
    const row = disciplineStart + index;
    sheet.getCell(row, 1).value = item.discipline;
    applyFont(sheet.getCell(row, 1), { size: 9, color: TITLE });
    sheet.getCell(row, 2).value = { formula: `COUNTIFS(${disciplineRange},$A${row},${severityRange},"Critical")` };
    sheet.getCell(row, 3).value = { formula: `COUNTIFS(${disciplineRange},$A${row},${severityRange},"Warning")` };
    sheet.getCell(row, 4).value = { formula: `COUNTIFS(${disciplineRange},$A${row},${severityRange},"Advisory")` };
    sheet.getCell(row, 5).value = { formula: `MAX(0,COUNTIF(${disciplineRange},$A${row})-B${row}-C${row}-D${row})` };
    sheet.getCell(row, 6).value = { formula: `SUM(B${row}:E${row})` };
    for (let col = 2; col <= 6; col += 1) applyFont(sheet.getCell(row, col), { size: 9, color: TITLE });
  });
  const totalRow = disciplineStart + rows.length;
  const firstDisc = disciplineStart;
  const lastDisc = totalRow - 1;
  sheet.getCell(totalRow, 1).value = "Total";
  applyFont(sheet.getCell(totalRow, 1), { bold: true, size: 9, color: TITLE });
  for (const col of ["B", "C", "D", "E", "F"]) {
    sheet.getCell(`${col}${totalRow}`).value = { formula: `SUM(${col}${firstDisc}:${col}${lastDisc})` };
    applyFont(sheet.getCell(`${col}${totalRow}`), { bold: true, size: 9, color: TITLE });
  }

  const basisStart = totalRow + 3;
  sheet.getCell(`A${basisStart}`).value = "Reference basis";
  sheet.getCell(`B${basisStart}`).value = "Count";
  headerFill(sheet, basisStart, 2);
  const basisRange = registerRange("referenceBasis", lastDataRow, columnIndex);
  [REFERENCE_BASIS.cited, REFERENCE_BASIS.suggested, REFERENCE_BASIS.coordination].forEach((label, index) => {
    const row = basisStart + 1 + index;
    sheet.getCell(row, 1).value = label;
    sheet.getCell(row, 2).value = { formula: `COUNTIF(${basisRange},A${row})` };
    applyFont(sheet.getCell(row, 1), { size: 9, color: TITLE });
    applyFont(sheet.getCell(row, 2), { size: 9, color: TITLE });
  });
  sheet.getCell(basisStart + 4, 1).value = "The Suggested starting-point value is reserved for a later verified catalogue. This register does not invent code lookups.";
  applyFont(sheet.getCell(basisStart + 4, 1), { size: 8, color: MUTED });
  sheet.mergeCells(basisStart + 4, 1, basisStart + 4, 6);
  wrapTop(sheet.getCell(basisStart + 4, 1));

  const statusStart = basisStart + 6;
  sheet.getCell(`A${statusStart}`).value = "Resolution status";
  sheet.getCell(`B${statusStart}`).value = "Count";
  headerFill(sheet, statusStart, 2);
  const statusRange = registerRange("status", lastDataRow, columnIndex);
  REGISTER_STATUS_OPTIONS.forEach((label, index) => {
    const row = statusStart + 1 + index;
    sheet.getCell(row, 1).value = label;
    sheet.getCell(row, 2).value = { formula: `COUNTIF(${statusRange},A${row})` };
    applyFont(sheet.getCell(row, 1), { size: 9, color: TITLE });
    applyFont(sheet.getCell(row, 2), { size: 9, color: TITLE });
  });
  const blankRow = statusStart + 1 + REGISTER_STATUS_OPTIONS.length;
  sheet.getCell(blankRow, 1).value = "(blank)";
  sheet.getCell(blankRow, 2).value = { formula: `COUNTBLANK(${statusRange})` };
  applyFont(sheet.getCell(blankRow, 1), { size: 9, color: TITLE });
  applyFont(sheet.getCell(blankRow, 2), { size: 9, color: TITLE });

  const reviewStart = blankRow + 3;
  sheet.getCell(`A${reviewStart}`).value = "Reviewer decision";
  sheet.getCell(`B${reviewStart}`).value = "Count";
  headerFill(sheet, reviewStart, 2);
  const reviewRange = registerRange("reviewerDecision", lastDataRow, columnIndex);
  ["Accepted", "Modified", "(blank)"].forEach((label, index) => {
    const row = reviewStart + 1 + index;
    sheet.getCell(row, 1).value = label;
    sheet.getCell(row, 2).value = {
      formula: label === "(blank)" ? `COUNTBLANK(${reviewRange})` : `COUNTIF(${reviewRange},A${row})`,
    };
    applyFont(sheet.getCell(row, 1), { size: 9, color: TITLE });
    applyFont(sheet.getCell(row, 2), { size: 9, color: TITLE });
  });
  const withdrawnCountRow = reviewStart + 5;
  sheet.getCell(withdrawnCountRow, 1).value = "Withdrawn (rejected)";
  sheet.getCell(withdrawnCountRow, 2).value = {
    formula: `COUNTA(${quoteSheet(FINDINGS_REGISTER_SHEETS.withdrawn)}!$A$${REGISTER_FIRST_DATA_ROW}:$A$${lastWithdrawnRow})`,
  };
  applyFont(sheet.getCell(withdrawnCountRow, 1), { size: 9, color: TITLE });
  applyFont(sheet.getCell(withdrawnCountRow, 2), { size: 9, color: TITLE });
}

function addWithdrawnSheet(workbook: Workbook, input: FindingsRegisterInput, lastWithdrawnRow: number) {
  const columns: FindingsRegisterColumn[] = [
    { key: "id", header: "ID", width: 10 },
    { key: "severity", header: "Severity", width: 11 },
    { key: "discipline", header: "Discipline", width: 16 },
    { key: "sheet", header: "Sheet", width: 12 },
    { key: "sheetTitle", header: "Sheet title", width: 30 },
    { key: "title", header: "Finding", width: 34 },
    { key: "observation", header: "Observation", width: 52 },
    { key: "drawingEvidence", header: "Drawing evidence", width: 44 },
    { key: "location", header: "Location", width: 30 },
    { key: "codeReference", header: "Code reference", width: 40 },
    { key: "recommendation", header: "Original recommendation", width: 52 },
    { key: "reviewerDecision", header: "Reviewer decision", width: 16 },
    { key: "decided", header: "Decided", width: 14 },
    { key: "permitPilotRef", header: "PermitPilot ref", width: 44 },
    { key: "findingUuid", header: "Finding UUID", width: 40 },
  ];
  const sheet = workbook.addWorksheet(FINDINGS_REGISTER_SHEETS.withdrawn, {
    views: [{ state: "frozen", xSplit: 5, ySplit: REGISTER_HEADER_ROW, topLeftCell: "F6", activeCell: "A6" }],
    properties: { tabColor: { argb: "FF64748B" } },
  });
  sheet.columns = columns.map((column) => ({ key: column.key, width: column.width }));
  addBrandingRows(sheet, input, columns.length, "withdrawn");
  styleHeaderRow(sheet, columns.map((column) => column.header), "FF475569");
  input.model.withdrawnFindings.forEach((finding, index) => {
    writeDataRow(sheet, REGISTER_FIRST_DATA_ROW + index, columns, {
      ...findingCells(finding, input.fingerprint),
      recommendation: finding.recommendation,
      reviewerDecision: finding.review ? reviewDecisionLabel(finding.review.decision) : "Rejected",
      decided: formatDate(finding.review?.decidedAt) || "",
    }, finding.severity);
  });
  sheet.autoFilter = {
    from: { row: REGISTER_HEADER_ROW, column: 1 },
    to: { row: lastWithdrawnRow, column: columns.length },
  };
}

function labelled(sheet: Worksheet, row: number, label: string, value: string | number | null) {
  sheet.getCell(row, 1).value = label;
  sheet.getCell(row, 2).value = value;
  applyFont(sheet.getCell(row, 1), { bold: true, size: 9, color: TITLE });
  applyFont(sheet.getCell(row, 2), { size: 9, color: TITLE });
  wrapTop(sheet.getCell(row, 2));
}

function addRecordSheet(workbook: Workbook, input: FindingsRegisterInput) {
  const { dataset, model, fingerprint } = input;
  const sheet = workbook.addWorksheet(FINDINGS_REGISTER_SHEETS.record, {
    properties: { tabColor: { argb: argb(REPORT_COLORS.heading) } },
  });
  sheet.getColumn(1).width = 28;
  sheet.getColumn(2).width = 88;
  sheet.getColumn(3).width = 22;
  sheet.getColumn(4).width = 18;
  sheet.getColumn(5).width = 14;
  sheet.getColumn(6).width = 12;
  sheet.getCell("A1").value = "Appendix: Report record";
  applyFont(sheet.getCell("A1"), { bold: true, size: 13, color: TITLE });
  labelled(sheet, 3, "Report version", fingerprint.label);
  labelled(sheet, 4, "Report fingerprint (SHA-256)", fingerprint.digest);
  labelled(sheet, 5, "Source run", dataset.run.id);
  labelled(sheet, 6, "Run status", dataset.run.status.replace(/_/g, " "));
  labelled(sheet, 7, "Analysis completed", formatDateTime(dataset.run.completed_at));
  labelled(sheet, 8, "Report generated", formatDateTime(input.generatedAt));
  labelled(sheet, 9, "Published findings", model.totals.published.all);
  labelled(sheet, 10, "Presented findings", model.totals.client.all);
  labelled(sheet, 11, "Withdrawn by reviewer", model.totals.withdrawn);
  labelled(sheet, 12, "Critical / Warning / Advisory", `${model.totals.client.critical} / ${model.totals.client.warning} / ${model.totals.client.advisory}`);
  labelled(sheet, 13, "Report model", ARCHITECT_REVIEW_MODEL_VERSION);
  labelled(sheet, 14, "Register layout", FINDINGS_REGISTER_LAYOUT_VERSION);
  labelled(sheet, 15, "Disclaimer text", DISCLAIMER_VERSION);
  labelled(sheet, 16, "Analysis mode", displayAnalysisMode(dataset.run.analysis_mode));
  const limitation = (dataset.run.analysis_scope as PersistedAnalysisScope | null | undefined)?.limitation || null;
  labelled(sheet, 17, "Source note", limitation);
  sheet.getCell("A19").value = "Reserved columns Code lookup / applicability review, DC lookup (supplemental) and Review qualification are empty in this version. They are present so later catalogue and qualification work can fill them without changing the register layout.";
  applyFont(sheet.getCell("A19"), { size: 8, color: MUTED });
  wrapTop(sheet.getCell("A19"));
  sheet.mergeCells("A19:F19");
  sheet.getRow(19).height = 36;

  sheet.getCell("A21").value = "Data notes";
  applyFont(sheet.getCell("A21"), { bold: true, size: 12, color: TITLE });
  const notes = [...model.integrityIssues];
  if (!model.isFinal) notes.unshift("This analysis is a draft. Findings, totals and IDs will change when it completes.");
  if (notes.length === 0) {
    sheet.getCell("A22").value = "None.";
    applyFont(sheet.getCell("A22"), { size: 9, color: TITLE });
  } else {
    notes.forEach((note, index) => {
      sheet.getCell(22 + index, 1).value = `• ${note}`;
      applyFont(sheet.getCell(22 + index, 1), { size: 9, color: TITLE });
      wrapTop(sheet.getCell(22 + index, 1));
      sheet.mergeCells(22 + index, 1, 22 + index, 6);
    });
  }

  const coverageStart = 22 + Math.max(1, notes.length) + 2;
  sheet.getCell(coverageStart, 1).value = "Sheet coverage";
  applyFont(sheet.getCell(coverageStart, 1), { bold: true, size: 12, color: TITLE });
  const headers = ["#", "Sheet", "Title", "Discipline", "Outcome", "Findings"];
  headers.forEach((header, index) => {
    const cell = sheet.getCell(coverageStart + 1, index + 1);
    cell.value = header;
    applyFont(cell, { bold: true, size: 9, color: WHITE });
    fillNavy(cell);
  });
  const outcomeLabel: Record<string, string> = {
    findings: "Analyzed",
    no_findings: "Analyzed, no findings",
    failed: "Not analyzed (processing failed)",
    cancelled: "Cancelled",
    pending: "In progress",
  };
  model.coverage.forEach((item, index) => {
    const row = coverageStart + 2 + index;
    sheet.getCell(row, 1).value = item.ordinal ?? "";
    sheet.getCell(row, 2).value = item.sheetNumber || item.fileName || "";
    sheet.getCell(row, 3).value = item.sheetTitle || "";
    sheet.getCell(row, 4).value = item.discipline;
    sheet.getCell(row, 5).value = outcomeLabel[item.outcome] || item.outcome;
    sheet.getCell(row, 6).value = item.outcome === "pending" || item.outcome === "failed" ? "—" : item.findingCount;
    for (let col = 1; col <= 6; col += 1) {
      applyFont(sheet.getCell(row, col), { size: 8, color: TITLE });
      wrapTop(sheet.getCell(row, col));
    }
  });
}
