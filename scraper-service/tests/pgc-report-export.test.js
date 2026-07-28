"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const pgc = require("../pgc-eplan-scraper.js");

describe("pgcValidateReportExportBuffer", () => {
  it("accepts PDF magic bytes", () => {
    const buf = Buffer.concat([
      Buffer.from("%PDF-1.4\n"),
      Buffer.alloc(80, 0x20),
    ]);
    const v = pgc.pgcValidateReportExportBuffer(buf, "PDF");
    assert.equal(v.ok, true);
  });

  it("accepts XLSX ZIP magic bytes", () => {
    const buf = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.alloc(80, 0x20),
    ]);
    const v = pgc.pgcValidateReportExportBuffer(buf, "EXCELOPENXML");
    assert.equal(v.ok, true);
  });

  it("rejects HTML login pages", () => {
    const html = Buffer.from(
      "<!DOCTYPE html><html><body><form>login password</form></body></html>" +
        "x".repeat(80),
    );
    assert.equal(pgc.pgcValidateReportExportBuffer(html, "PDF").ok, false);
    assert.equal(
      pgc.pgcValidateReportExportBuffer(html, "EXCELOPENXML").error,
      "export_rejected_html_or_login_page",
    );
  });

  it("rejects empty / tiny payloads", () => {
    const v = pgc.pgcValidateReportExportBuffer(Buffer.from("tiny"), "PDF");
    assert.equal(v.ok, false);
    assert.equal(v.error, "export_empty_or_too_small");
  });

  it("rejects PDF-labeled Excel and Excel-labeled PDF", () => {
    const pdf = Buffer.concat([
      Buffer.from("%PDF-1.4\n"),
      Buffer.alloc(80, 0x20),
    ]);
    const xlsx = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.alloc(80, 0x20),
    ]);
    assert.equal(
      pgc.pgcValidateReportExportBuffer(pdf, "EXCELOPENXML").ok,
      false,
    );
    assert.equal(pgc.pgcValidateReportExportBuffer(xlsx, "PDF").ok, false);
  });
});

describe("pgcValidateReportExportFile", () => {
  it("deletes invalid on-disk exports", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pgc-report-"));
    const dest = path.join(dir, "bad.xlsx");
    fs.writeFileSync(
      dest,
      "<html><form>login password</form></html>" + "x".repeat(80),
    );
    const v = await pgc.pgcValidateReportExportFile(dest, "EXCELOPENXML");
    assert.equal(v.ok, false);
    assert.equal(fs.existsSync(dest), false);
  });
});

describe("pgcComputeReportFormatStatus / logical status", () => {
  it("marks storage-backed URL as success", () => {
    assert.equal(
      pgc.pgcComputeReportFormatStatus({
        downloaded: true,
        publicUrl:
          "https://eeqxyjrcldivtpikcpvk.supabase.co/storage/v1/object/public/portal/a.xlsx",
      }),
      "success",
    );
  });

  it("never treats ReportViewer URL as success", () => {
    assert.equal(
      pgc.pgcComputeReportFormatStatus({
        downloaded: false,
        publicUrl:
          "https://eplans.princegeorgescountymd.gov/ProjectDox/ReportViewer.aspx?ReportPath=/x",
        attempted: true,
      }),
      "failed",
    );
  });

  it("keeps local download without upload as pending", () => {
    assert.equal(
      pgc.pgcComputeReportFormatStatus({
        downloaded: true,
        publicUrl: null,
        attempted: true,
      }),
      "pending",
    );
  });

  it("marks attempted failure as failed", () => {
    assert.equal(
      pgc.pgcComputeReportFormatStatus({
        downloaded: false,
        attempted: true,
        error: "export_rejected_html_or_login_page",
      }),
      "failed",
    );
  });

  it("computes Complete / Partial / Failed / Pending", () => {
    assert.equal(
      pgc.pgcComputeLogicalReportStatus("success", "success"),
      "Complete",
    );
    assert.equal(
      pgc.pgcComputeLogicalReportStatus("success", "failed"),
      "Partial",
    );
    assert.equal(
      pgc.pgcComputeLogicalReportStatus("failed", "failed"),
      "Failed",
    );
    assert.equal(
      pgc.pgcComputeLogicalReportStatus("pending", "pending"),
      "Pending",
    );
  });
});

describe("PGC scrape mode vs reports", () => {
  it("documents three target logical reports", () => {
    assert.equal(pgc.PGC_TARGET_REPORT_NAMES.length, 3);
    assert.ok(
      pgc.PGC_TARGET_REPORT_NAMES.some((n) =>
        /review comments/i.test(n),
      ),
    );
  });

  it("pgcIsFilesOnlyScrapeMode matches scrape_files_only", () => {
    assert.equal(pgc.pgcIsFilesOnlyScrapeMode("scrape_files_only"), true);
    assert.equal(pgc.pgcIsFilesOnlyScrapeMode("scrape_all"), false);
    assert.equal(pgc.pgcIsFilesOnlyScrapeMode("scrape_comments_only"), false);
  });
});

describe("COM-00317 viewer-only shape", () => {
  it("viewer URLs with false download flags are Pending not Complete", () => {
    const pdfStatus = pgc.pgcComputeReportFormatStatus({
      downloaded: false,
      publicUrl: null,
      attempted: false,
    });
    const excelStatus = pgc.pgcComputeReportFormatStatus({
      downloaded: false,
      publicUrl: null,
      attempted: false,
    });
    assert.equal(pdfStatus, "pending");
    assert.equal(excelStatus, "pending");
    assert.equal(
      pgc.pgcComputeLogicalReportStatus(pdfStatus, excelStatus),
      "Pending",
    );
  });

  it("attempted export failure becomes Failed for both formats", () => {
    const pdfStatus = pgc.pgcComputeReportFormatStatus({
      downloaded: false,
      attempted: true,
      error: "report viewer not ready",
    });
    const excelStatus = pgc.pgcComputeReportFormatStatus({
      downloaded: false,
      attempted: true,
      error: "export_rejected_html_or_login_page",
    });
    assert.equal(
      pgc.pgcComputeLogicalReportStatus(pdfStatus, excelStatus),
      "Failed",
    );
  });
});
