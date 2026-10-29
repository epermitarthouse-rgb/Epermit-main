import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { webcrypto } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import ExcelJS from "exceljs";
import { ARCHITECT_REVIEW_MODEL_VERSION, buildArchitectReviewModel, fingerprintArchitectReview } from "./architectReview.ts";
import { renderArchitectReviewPdf } from "./brandedReport.ts";
import type { AnalyzerRunDataset } from "./client.ts";
import { reportIdentityKeywords } from "./exportAudit.ts";
import { buildSupabaseAnalyzerJsonExport } from "./exportDataset.ts";
import {
  FINDINGS_REGISTER_LAYOUT_VERSION,
  FINDINGS_REGISTER_SHEETS,
  REFERENCE_BASIS,
  REGISTER_COLUMNS,
  REGISTER_FIRST_DATA_ROW,
  REGISTER_HEADER_ROW,
  REGISTER_STATUS_OPTIONS,
  buildFindingsRegisterWorkbook,
  columnIndexMap,
  findingsRegisterFileName,
  referenceBasisFor,
  resolveExcelJS,
  statusDropdownRange,
} from "./findingsRegister.ts";
import { DISCLAIMER_SHORT, DISCLAIMER_VERSION } from "./reportBranding.ts";
import { finding, fixtureDataset, job, review, run, stressDataset, uuidFor } from "./fixtures/architectReviewFixtures.ts";

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

const here = dirname(fileURLToPath(import.meta.url));
const LOGO_BASE64 = readFileSync(join(here, "../../assets/commun-et-logo.jpg")).toString("base64");
const GENERATED_AT = new Date("2026-10-28T15:00:00Z");
const COL = columnIndexMap();

function zipLocalFile(bytes: Buffer, name: string): string {
  const signature = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  let offset = 0;
  while (offset < bytes.length - 30) {
    if (bytes.readUInt32LE(offset) !== 0x04034b50) {
      const next = bytes.indexOf(signature, offset + 1);
      if (next < 0) break;
      offset = next;
      continue;
    }
    const method = bytes.readUInt16LE(offset + 8);
    const flags = bytes.readUInt16LE(offset + 6);
    const compressedSize = bytes.readUInt32LE(offset + 18);
    const nameLen = bytes.readUInt16LE(offset + 26);
    const extraLen = bytes.readUInt16LE(offset + 28);
    const entryName = bytes.subarray(offset + 30, offset + 30 + nameLen).toString("utf8");
    const dataStart = offset + 30 + nameLen + extraLen;
    if (entryName === name) {
      if (flags & 0x08) throw new Error("zip data descriptor is not supported");
      const payload = bytes.subarray(dataStart, dataStart + compressedSize);
      if (method === 0) return payload.toString("utf8");
      if (method === 8) return inflateRawSync(payload).toString("utf8");
      throw new Error(`unsupported zip method ${method}`);
    }
    offset = dataStart + compressedSize;
  }
  throw new Error(`missing ${name}`);
}

function xlsxEntry(bytes: Buffer, name: string): string {
  try {
    return zipLocalFile(bytes, name);
  } catch {
    const dir = mkdtempSync(join(tmpdir(), "xlsx-audit-"));
    const file = join(dir, "book.xlsx");
    writeFileSync(file, bytes);
    try {
      return execFileSync("unzip", ["-p", file, name], { encoding: "utf8" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

function formulaOf(cell: ExcelJS.Cell): string {
  const value = cell.value as { formula?: string } | string | null;
  if (value && typeof value === "object" && value.formula) return value.formula;
  return "";
}

function textOf(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object" && "text" in value && typeof value.text === "string") return value.text;
  if (typeof value === "object" && "richText" in value && Array.isArray(value.richText)) {
    return value.richText.map((part: { text?: string }) => part.text || "").join("");
  }
  return String(value);
}

function argbOf(cell: ExcelJS.Cell): string | undefined {
  const color = cell.font?.color;
  if (!color) return undefined;
  if ("argb" in color && color.argb) return String(color.argb).toUpperCase();
  return undefined;
}

function reviewedFixture(): AnalyzerRunDataset {
  const { dataset } = fixtureDataset();
  const ids = new Map(buildArchitectReviewModel(dataset).findings.map((item) => [item.reportId, item.findingId]));
  return {
    ...dataset,
    reviews: [
      review(ids.get("C-001")!, "accepted"),
      review(ids.get("C-002")!, "modified", { modified_response: "Reconcile total demand with the full hydraulic calculation." }),
      review(ids.get("W-010")!, "rejected"),
    ],
  };
}

async function renderRegister(dataset: AnalyzerRunDataset, projectName = "Fixture project") {
  const model = buildArchitectReviewModel(dataset);
  const fingerprint = await fingerprintArchitectReview(dataset);
  const { workbook, layout } = buildFindingsRegisterWorkbook(ExcelJS, {
    dataset,
    model,
    fingerprint,
    projectName,
    generatedAt: GENERATED_AT,
    logoBase64: LOGO_BASE64,
  });
  const buffer = await workbook.xlsx.writeBuffer();
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(buffer);
  return { model, fingerprint, layout, workbook: loaded, bytes: Buffer.from(buffer) };
}

function registerRows(workbook: ExcelJS.Workbook, count: number) {
  const sheet = workbook.getWorksheet(FINDINGS_REGISTER_SHEETS.register)!;
  return Array.from({ length: count }, (_, index) => {
    const row = sheet.getRow(REGISTER_FIRST_DATA_ROW + index);
    return {
      id: textOf(row.getCell(COL.id)),
      severity: textOf(row.getCell(COL.severity)),
      discipline: textOf(row.getCell(COL.discipline)),
      sheet: textOf(row.getCell(COL.sheet)),
      sheetTitle: textOf(row.getCell(COL.sheetTitle)),
      title: textOf(row.getCell(COL.title)),
      observation: textOf(row.getCell(COL.observation)),
      drawingEvidence: textOf(row.getCell(COL.drawingEvidence)),
      location: textOf(row.getCell(COL.location)),
      codeReference: textOf(row.getCell(COL.codeReference)),
      referenceBasis: textOf(row.getCell(COL.referenceBasis)),
      recommendation: textOf(row.getCell(COL.recommendation)),
      originalRecommendation: textOf(row.getCell(COL.originalRecommendation)),
      reviewerDecision: textOf(row.getCell(COL.reviewerDecision)),
      sourceFinding: textOf(row.getCell(COL.sourceFinding)),
      findingUuid: textOf(row.getCell(COL.findingUuid)),
      codeLookup: textOf(row.getCell(COL.codeLookup)),
      dcLookup: textOf(row.getCell(COL.dcLookup)),
      reviewQualification: textOf(row.getCell(COL.reviewQualification)),
      status: textOf(row.getCell(COL.status)),
    };
  });
}

describe("Excel findings register: 252-finding fixture", () => {
  it("matches the shared model and the M2 PDF for IDs, order, counts and fingerprint", async () => {
    const dataset = reviewedFixture();
    const { model, fingerprint, layout, workbook } = await renderRegister(dataset);
    const pdf = renderArchitectReviewPdf({
      dataset,
      model,
      fingerprint,
      projectName: "Fixture project",
      generatedAt: GENERATED_AT,
      logo: null,
    });

    assert.equal(model.clientFindings.length, 251);
    assert.equal(layout.presentedCount, 251);
    assert.equal(layout.withdrawnCount, 1);
    const rows = registerRows(workbook, 251);
    assert.deepEqual(rows.map((row) => row.id), model.clientFindings.map((item) => item.reportId));
    assert.deepEqual(rows.map((row) => row.id), [...pdf.layout.findingPages.keys()]);
    assert.deepEqual(rows.slice(0, 5).map((row) => row.id), ["C-001", "C-002", "C-003", "C-004", "W-001"]);
    assert.ok(!rows.some((row) => row.id === "W-010"));

    const record = workbook.getWorksheet(FINDINGS_REGISTER_SHEETS.record)!;
    assert.equal(textOf(record.getCell("B3")), fingerprint.label);
    assert.equal(textOf(record.getCell("B4")), fingerprint.digest);
    assert.equal(textOf(record.getCell("B9")), "252");
    assert.equal(textOf(record.getCell("B10")), "251");
    assert.equal(textOf(record.getCell("B11")), "1");
    assert.equal(textOf(record.getCell("B12")), "4 / 82 / 165");
    assert.equal(textOf(record.getCell("B14")), FINDINGS_REGISTER_LAYOUT_VERSION);
    assert.equal(textOf(record.getCell("B15")), DISCLAIMER_VERSION);
    assert.equal(findingsRegisterFileName(dataset.run.id, fingerprint), `PermitPilot-Findings-Register-649fdaa6-${fingerprint.label}.xlsx`);
  });

  it("keeps source observations, evidence, citations, recommendations and reviewer decisions", async () => {
    const dataset = reviewedFixture();
    const { model, workbook } = await renderRegister(dataset);
    const rows = registerRows(workbook, model.clientFindings.length);
    const byId = new Map(model.clientFindings.map((item) => [item.reportId, item]));
    let cited = 0;
    for (const row of rows) {
      const source = byId.get(row.id)!;
      assert.equal(row.title, source.title);
      assert.equal(row.observation, source.observation);
      assert.equal(row.drawingEvidence, source.drawingEvidence);
      assert.equal(row.location, source.drawingLocation || "");
      assert.equal(row.codeReference, source.codeReference || "");
      assert.equal(row.recommendation, source.presentedRecommendation);
      assert.equal(row.discipline, source.sheet.discipline);
      assert.equal(row.findingUuid, source.findingId);
      assert.equal(row.sourceFinding, String(source.sourceSequence).padStart(3, "0"));
      assert.equal(row.referenceBasis, referenceBasisFor(source));
      assert.equal(row.codeLookup, "");
      assert.equal(row.dcLookup, "");
      assert.equal(row.reviewQualification, "");
      assert.equal(row.status, "");
      if (source.codeReference) cited += 1;
    }
    const modified = rows.find((row) => row.id === "C-002")!;
    assert.equal(modified.recommendation, "Reconcile total demand with the full hydraulic calculation.");
    assert.equal(modified.originalRecommendation, byId.get("C-002")!.recommendation);
    assert.equal(modified.reviewerDecision, "Modified");
    assert.equal(rows.find((row) => row.id === "C-001")!.reviewerDecision, "Accepted");
    assert.equal(cited, model.clientFindings.filter((item) => item.codeReference).length);
    assert.equal(cited, 23);
    assert.equal(rows.filter((row) => row.referenceBasis === REFERENCE_BASIS.cited).length, cited);
    assert.equal(rows.filter((row) => row.referenceBasis === REFERENCE_BASIS.suggested).length, 0);
  });

  it("lists withdrawn findings only on the audit sheet and keeps their IDs", async () => {
    const { model, workbook } = await renderRegister(reviewedFixture());
    const withdrawn = workbook.getWorksheet(FINDINGS_REGISTER_SHEETS.withdrawn)!;
    assert.equal(textOf(withdrawn.getRow(REGISTER_FIRST_DATA_ROW).getCell(1)), "W-010");
    assert.equal(textOf(withdrawn.getRow(REGISTER_FIRST_DATA_ROW).getCell(2)), "Warning");
    assert.equal(textOf(withdrawn.getRow(REGISTER_FIRST_DATA_ROW).getCell(12)), "Rejected");
    assert.equal(model.withdrawnFindings[0].observation, textOf(withdrawn.getRow(REGISTER_FIRST_DATA_ROW).getCell(7)));
    const register = workbook.getWorksheet(FINDINGS_REGISTER_SHEETS.register)!;
    const blob = register.getSheetValues().flat().join(" ");
    assert.ok(!String(blob).includes(model.withdrawnFindings[0].observation));
  });

  it("styles the register like the client file: freeze, filter, status dropdown, colours and short disclaimer", async () => {
    const { workbook, layout } = await renderRegister(reviewedFixture());
    const sheet = workbook.getWorksheet(FINDINGS_REGISTER_SHEETS.register)!;
    assert.equal(workbook.worksheets.map((item) => item.name).join("|"), Object.values(FINDINGS_REGISTER_SHEETS).join("|"));
    assert.equal(sheet.getCell("A3").value, DISCLAIMER_SHORT);
    const view = sheet.views[0] as ExcelJS.WorksheetViewFrozen;
    assert.equal(view.state, "frozen");
    assert.equal(view.xSplit, 5);
    assert.equal(view.ySplit, REGISTER_HEADER_ROW);
    assert.equal(sheet.autoFilter, `A${REGISTER_HEADER_ROW}:${sheet.getColumn(REGISTER_COLUMNS.length).letter}${layout.lastDataRow}`);
    const headers = REGISTER_COLUMNS.map((_, index) => textOf(sheet.getRow(REGISTER_HEADER_ROW).getCell(index + 1)));
    assert.deepEqual(headers, REGISTER_COLUMNS.map((column) => column.header));
    const headerFill = sheet.getRow(REGISTER_HEADER_ROW).getCell(1).fill;
    const headerColor = headerFill && "fgColor" in headerFill ? headerFill.fgColor?.argb : undefined;
    assert.equal(headerColor?.toUpperCase(), "FF1A5276");
    assert.equal(argbOf(sheet.getRow(REGISTER_FIRST_DATA_ROW).getCell(1)), "FFB3261E");
    const validation = sheet.getRow(REGISTER_FIRST_DATA_ROW).getCell(COL.status).dataValidation;
    assert.equal(validation.type, "list");
    assert.equal(validation.formulae[0], `"${REGISTER_STATUS_OPTIONS.join(",")}"`);
    assert.equal(sheet.getRow(REGISTER_FIRST_DATA_ROW).getCell(COL.status).dataValidation.allowBlank, true);
    assert.equal(sheet.getColumn(COL.codeLookup).hidden, true);
    assert.equal(sheet.getColumn(COL.dcLookup).hidden, true);
    assert.equal(sheet.getColumn(COL.reviewQualification).hidden, true);
    assert.equal(sheet.getColumn(COL.findingUuid).hidden, true);
    assert.ok(sheet.getImages().length >= 1);
    assert.ok(sheet.getColumn(COL.owner).width && sheet.getColumn(COL.notes).width);
  });

  it("writes a single Status dropdown covering M6 through the last presented row", async () => {
    const dataset = fixtureDataset().dataset;
    const fingerprint = await fingerprintArchitectReview(dataset);
    const inMemory = buildFindingsRegisterWorkbook(ExcelJS, {
      dataset,
      model: buildArchitectReviewModel(dataset),
      fingerprint,
      projectName: "Fixture project",
      generatedAt: GENERATED_AT,
      logoBase64: LOGO_BASE64,
    });
    const expected = statusDropdownRange(inMemory.layout.lastDataRow);
    assert.equal(inMemory.layout.lastDataRow, 257);
    assert.equal(expected, "M6:M257");
    const liveSheet = inMemory.workbook.getWorksheet(FINDINGS_REGISTER_SHEETS.register)!;
    const liveKeys = Object.keys((liveSheet as unknown as { dataValidations: { model: Record<string, unknown> } }).dataValidations.model);
    assert.deepEqual(liveKeys, [expected]);

    const { layout, bytes } = await renderRegister(dataset);
    assert.equal(layout.lastDataRow, 257);
    const xml = xlsxEntry(bytes, "xl/worksheets/sheet1.xml");
    const validations = xml.match(/<dataValidations\b[\s\S]*?<\/dataValidations>/)?.[0] || "";
    const sqrefs = [...validations.matchAll(/\bsqref="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(sqrefs, [expected]);
    assert.equal((validations.match(/<dataValidation\b/g) || []).length, 1);
    assert.equal(validations.includes("M10:M257"), false);
    const identity = reportIdentityKeywords({
      fingerprintDigest: fingerprint.digest,
      modelVersion: ARCHITECT_REVIEW_MODEL_VERSION,
      layoutVersion: FINDINGS_REGISTER_LAYOUT_VERSION,
      disclaimerVersion: DISCLAIMER_VERSION,
    });
    assert.equal(inMemory.workbook.keywords, identity);
  });

  it("builds live Summary formulas against the register, including discipline and reserved Suggested counts", async () => {
    const { model, workbook, layout } = await renderRegister(reviewedFixture());
    const summary = workbook.getWorksheet(FINDINGS_REGISTER_SHEETS.summary)!;
    const last = layout.lastDataRow;
    assert.equal(formulaOf(summary.getCell("B5")), `COUNTIF('Findings Register'!$B$${REGISTER_FIRST_DATA_ROW}:$B$${last},A5)`);
    assert.equal(formulaOf(summary.getCell("B6")), `COUNTIF('Findings Register'!$B$${REGISTER_FIRST_DATA_ROW}:$B$${last},A6)`);
    assert.equal(formulaOf(summary.getCell("B7")), `COUNTIF('Findings Register'!$B$${REGISTER_FIRST_DATA_ROW}:$B$${last},A7)`);
    assert.match(formulaOf(summary.getCell("C5")), /B5\/\$B\$9/);
    const disciplines = model.inventory.map((row) => row.discipline);
    const firstDisciplineRow = 12;
    disciplines.forEach((name, index) => {
      assert.equal(textOf(summary.getCell(firstDisciplineRow + index, 1)), name);
      assert.match(formulaOf(summary.getCell(firstDisciplineRow + index, 2)), /COUNTIFS/);
    });
    assert.deepEqual(disciplines.slice(0, 3), ["Architectural", "Structural", "Mechanical"]);
    const basisStart = firstDisciplineRow + disciplines.length + 3;
    assert.equal(textOf(summary.getCell(basisStart + 1, 1)), REFERENCE_BASIS.cited);
    assert.equal(textOf(summary.getCell(basisStart + 2, 1)), REFERENCE_BASIS.suggested);
    assert.equal(textOf(summary.getCell(basisStart + 3, 1)), REFERENCE_BASIS.coordination);
    assert.match(formulaOf(summary.getCell(basisStart + 2, 2)), /COUNTIF\('Findings Register'!\$K\$/);
    assert.match(formulaOf(summary.getCell("B9")), /SUM\(B5:B8\)/);
  });

  it("is repeatable for the same stored data and does not change when input rows are shuffled", async () => {
    const dataset = reviewedFixture();
    const first = await renderRegister(dataset);
    const second = await renderRegister({
      ...dataset,
      findings: [...dataset.findings].reverse(),
      jobs: [...dataset.jobs].reverse(),
    });
    assert.equal(second.fingerprint.digest, first.fingerprint.digest);
    assert.deepEqual(
      registerRows(second.workbook, 251).map((row) => row.id),
      registerRows(first.workbook, 251).map((row) => row.id),
    );
    const json = JSON.stringify(buildSupabaseAnalyzerJsonExport(dataset, "Fixture project", GENERATED_AT.toISOString()));
    const jsonAgain = JSON.stringify(buildSupabaseAnalyzerJsonExport({
      ...dataset,
      findings: [...dataset.findings].reverse(),
    }, "Fixture project", GENERATED_AT.toISOString()));
    assert.equal(jsonAgain, json);
  });
});

describe("Excel findings register: edge cases", () => {
  it("marks a draft analysis and keeps an unrecognized severity unchanged", async () => {
    const sheet = job({ id: "job-1", ordinal: 1, detected_sheet_number: "A-101", detected_sheet_title: "Plan" });
    const dataset: AnalyzerRunDataset = {
      run: run({ status: "processing", total_sheets: 1 }),
      jobs: [{ ...sheet, status: "processing" }],
      findings: [
        finding({ id: uuidFor(1), sheet_job_id: "job-1", finding_index: 0, severity: "warning" }),
        finding({ id: uuidFor(2), sheet_job_id: "job-1", finding_index: 1, severity: "major" as "warning" }),
      ],
    };
    const before = JSON.stringify(dataset);
    const { workbook, model } = await renderRegister(dataset);
    assert.equal(JSON.stringify(dataset), before);
    assert.equal(model.isFinal, false);
    const register = workbook.getWorksheet(FINDINGS_REGISTER_SHEETS.register)!;
    assert.match(textOf(register.getCell("A2")), /Draft/);
    const rows = registerRows(workbook, 2);
    assert.equal(rows[1].id, "U-001");
    assert.equal(rows[1].severity, "major");
    const record = workbook.getWorksheet(FINDINGS_REGISTER_SHEETS.record)!;
    assert.match(textOf(record.getCell("A22")), /draft/i);
  });

  it("renders the 1,200-finding stress fixture with every presented ID", async () => {
    const dataset = stressDataset();
    const started = performance.now();
    const { model, layout, workbook } = await renderRegister(dataset);
    const elapsed = performance.now() - started;
    assert.equal(model.clientFindings.length, 1100);
    const rows = registerRows(workbook, 1100);
    assert.equal(new Set(rows.map((row) => row.id)).size, 1100);
    assert.equal(rows.length, 1100);
    assert.equal(layout.withdrawnCount, 100);
    const withdrawn = workbook.getWorksheet(FINDINGS_REGISTER_SHEETS.withdrawn)!;
    assert.equal(textOf(withdrawn.getRow(REGISTER_FIRST_DATA_ROW + 99).getCell(1)).length > 0, true);
    assert.ok(elapsed < 30000, `register took ${elapsed.toFixed(0)} ms`);
    console.log(`stress Excel: ${rows.length} rows, ${elapsed.toFixed(0)} ms`);
  });

  it("resolves exceljs whether Workbook is on the module or its default export", () => {
    assert.equal(resolveExcelJS(ExcelJS), ExcelJS);
    assert.equal(resolveExcelJS({ default: ExcelJS }).Workbook, ExcelJS.Workbook);
    assert.throws(() => resolveExcelJS({}), /exceljs did not load/);
  });
});
