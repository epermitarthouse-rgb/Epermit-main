import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyPortalFileArtifactStatus,
  deriveLogicalReports,
  harvestArtifactsIndicatePartial,
  summarizePortalFilesFromFolders,
  summarizeReportCompletion,
} from "./portalHarvestMetrics.ts";

describe("PGC portal file status classification", () => {
  it("marks ok/storage as success", () => {
    assert.equal(
      classifyPortalFileArtifactStatus({
        downloadStatus: "ok",
        publicUrl: "https://x.supabase.co/storage/v1/object/public/a.pdf",
      }),
      "success",
    );
  });

  it("marks failed statuses as failed", () => {
    assert.equal(
      classifyPortalFileArtifactStatus({
        downloadStatus: "failed",
        downloadError: "viewer_tab_missing",
      }),
      "failed",
    );
  });

  it("marks missing status without storage as pending (not success)", () => {
    assert.equal(
      classifyPortalFileArtifactStatus({
        name: "plan.pdf",
        fileId: "5113096",
      }),
      "pending",
    );
  });

  it("marks activation_skipped as skipped", () => {
    assert.equal(
      classifyPortalFileArtifactStatus({ downloadStatus: "activation_skipped" }),
      "skipped",
    );
  });
});

describe("PGC folder file summarization", () => {
  it("reconciles discovered = downloaded + failed + pending + skipped", () => {
    const summary = summarizePortalFilesFromFolders([
      {
        parentFolder: "3rd Party",
        folderName: "3rd Party Architectural",
        files: [
          { name: "a.pdf", downloadStatus: "ok", publicUrl: "https://x.supabase.co/storage/v1/object/public/a.pdf" },
          { name: "b.pdf", downloadStatus: "failed", downloadError: "viewer_tab_missing" },
          { name: "c.pdf" },
          { name: "d.pdf", downloadStatus: "activation_skipped" },
        ],
      },
      {
        parentFolder: "Architectural",
        folderName: "Drawings",
        files: [],
      },
    ]);
    assert.equal(summary.discovered, 4);
    assert.equal(summary.downloaded, 1);
    assert.equal(summary.failed, 1);
    assert.equal(summary.pending, 1);
    assert.equal(summary.skipped, 1);
    assert.equal(summary.reconciles, true);
    assert.equal(summary.populatedFolders, 1);
    assert.equal(summary.parentFolders, 2);
    assert.equal(summary.foldersTotal, 2);
    assert.equal(summary.isPartial, true);
  });

  it("keeps same filename in different folders distinct", () => {
    const summary = summarizePortalFilesFromFolders([
      {
        parentFolder: "A",
        folderName: "Drawings",
        folderID: "1",
        files: [{ name: "same.pdf", fileId: "1", downloadStatus: "ok", publicUrl: "https://x.supabase.co/storage/v1/object/public/1.pdf" }],
      },
      {
        parentFolder: "B",
        folderName: "Drawings",
        folderID: "2",
        files: [{ name: "same.pdf", fileId: "2" }],
      },
    ]);
    assert.equal(summary.discovered, 2);
    assert.equal(summary.downloaded, 1);
    assert.equal(summary.pending, 1);
  });

  it("does not invent success from bare discovery rows (COM-00317 shape)", () => {
    const files = Array.from({ length: 410 }, (_, i) =>
      i < 36
        ? {
            name: `ok-${i}.pdf`,
            fileId: String(i),
            downloadStatus: "ok",
            publicUrl: `https://x.supabase.co/storage/v1/object/public/${i}.pdf`,
          }
        : i < 38
          ? { name: `fail-${i}.pdf`, fileId: String(i), downloadStatus: "failed" }
          : { name: `pending-${i}.pdf`, fileId: String(i) },
    );
    const summary = summarizePortalFilesFromFolders([
      { parentFolder: "3rd Party", folderName: "3rd Party Architectural", files },
    ]);
    assert.equal(summary.discovered, 410);
    assert.equal(summary.downloaded, 36);
    assert.equal(summary.failed, 2);
    assert.equal(summary.pending, 372);
    assert.equal(summary.reconciles, true);
    assert.equal(summary.isPartial, true);
  });
});

describe("PGC reports + partial harvest signal", () => {
  it("counts PDF+Excel as one logical report and pending formats as pending/partial", () => {
    const logical = deriveLogicalReports({
      reportEntries: [
        {
          reportName: "Plan Review - Review Comments",
          pdfDownloaded: false,
          excelDownloaded: false,
          viewerUrl: "https://eplans.example/ReportViewer.aspx",
        },
        {
          reportName: "Dept Status",
          pdfUrl: "https://x.supabase.co/storage/v1/object/public/a.pdf",
          pdfDownloaded: true,
          excelDownloaded: false,
          excelError: "timeout",
        },
      ],
    });
    const reports = summarizeReportCompletion(logical);
    assert.equal(reports.logicalReports, 2);
    assert.ok(reports.partial + reports.pending + reports.failed >= 1);
  });

  it("COM-00317 viewer-only reports: 3 logical, 6 artifacts, 0 downloaded", () => {
    const names = [
      "Dynamic Review - Department Review Status",
      "Dynamic Review - Workflow Routing Slip",
      "Plan Review - Review Comments",
    ];
    const logical = deriveLogicalReports({
      reportEntries: names.map((reportName) => ({
        reportName,
        pdfDownloaded: false,
        excelDownloaded: false,
        viewerUrl: `https://eplans.princegeorgescountymd.gov/ProjectDox/ReportViewer.aspx?ReportPath=${encodeURIComponent(reportName)}`,
      })),
    });
    const reports = summarizeReportCompletion(logical);
    assert.equal(reports.logicalReports, 3);
    assert.equal(reports.reportArtifactsTotal, 6);
    assert.equal(reports.reportArtifactsDownloaded, 0);
    assert.equal(reports.pending, 3);
    assert.equal(reports.complete, 0);
  });

  it("does not count ReportViewer URL as a downloaded PDF/Excel artifact", () => {
    const logical = deriveLogicalReports({
      reportEntries: [
        {
          reportName: "Plan Review - Review Comments",
          pdfUrl:
            "https://eplans.example/ProjectDox/ReportViewer.aspx?rs:Format=PDF",
          excelUrl:
            "https://eplans.example/ProjectDox/ReportViewer.aspx?rs:Format=EXCELOPENXML",
          pdfDownloaded: true,
          excelDownloaded: true,
        },
      ],
    });
    const reports = summarizeReportCompletion(logical);
    assert.equal(reports.reportArtifactsDownloaded, 0);
  });

  it("failed export errors surface as Failed not double-counted formats", () => {
    const logical = deriveLogicalReports({
      reportEntries: [
        {
          reportName: "Plan Review - Review Comments",
          pdfDownloaded: false,
          excelDownloaded: false,
          pdfError: "export_rejected_html_or_login_page",
          excelError: "export_rejected_html_or_login_page",
          pdfStatus: "failed",
          excelStatus: "failed",
          logicalStatus: "Failed",
        },
      ],
    });
    const reports = summarizeReportCompletion(logical);
    assert.equal(reports.logicalReports, 1);
    assert.equal(reports.failed, 1);
    assert.equal(reports.reportArtifactsTotal, 2);
    assert.equal(reports.reportArtifactsFailed, 2);
  });

  it("marks harvest partial when files downloaded but many remain pending", () => {
    const filesSummary = summarizePortalFilesFromFolders([
      {
        folderName: "Docs",
        files: [
          { downloadStatus: "ok", publicUrl: "https://x.supabase.co/storage/v1/object/public/a.pdf" },
          {},
          {},
        ],
      },
    ]);
    const reportCompletion = summarizeReportCompletion(
      deriveLogicalReports({
        reportEntries: [
          { reportName: "A", pdfDownloaded: false, excelDownloaded: false },
        ],
      }),
    );
    assert.equal(
      harvestArtifactsIndicatePartial({ reportCompletion, filesSummary }),
      true,
    );
  });

  it("does not treat corrections-unavailable alone as file harvest failure", () => {
    const filesSummary = summarizePortalFilesFromFolders([
      {
        folderName: "Docs",
        files: [
          { downloadStatus: "ok", publicUrl: "https://x.supabase.co/storage/v1/object/public/a.pdf" },
        ],
      },
    ]);
    assert.equal(filesSummary.failed, 0);
    assert.equal(filesSummary.downloaded, 1);
    assert.equal(filesSummary.isPartial, false);
  });
});
