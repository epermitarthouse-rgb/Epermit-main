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
