"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const pgcRetry = require("../lib/pgc-retry-artifacts.js");

describe("parsePgcRetryArtifacts", () => {
  it("parses selected files and report formats only", () => {
    const parsed = pgcRetry.parsePgcRetryArtifacts({
      files: [
        { portalFileId: "111", fileName: "a.pdf" },
        { portalFileId: "111" },
        { portalFileId: "" },
      ],
      reports: [
        {
          fileSlug: "plan-review-comments",
          reportName: "Plan Review Comments",
          formats: ["pdf", "PDF", "docx"],
        },
      ],
    });
    assert.equal(parsed.files.length, 1);
    assert.equal(parsed.files[0].portalFileId, "111");
    assert.deepEqual(parsed.reports[0].formats, ["pdf"]);
  });

  it("returns null when empty (prevents silent full scrape)", () => {
    assert.equal(pgcRetry.parsePgcRetryArtifacts({ files: [], reports: [] }), null);
  });
});

describe("buildPgcRetryPipelineOpts", () => {
  it("skips files or reports when not selected", () => {
    assert.deepEqual(
      pgcRetry.buildPgcRetryPipelineOpts({
        files: [{ portalFileId: "1" }],
        reports: [],
      }),
      {
        skipDetail: true,
        skipWorkflow: true,
        skipReview: true,
        skipFiles: false,
        skipReports: true,
      },
    );
    assert.deepEqual(
      pgcRetry.buildPgcRetryPipelineOpts({
        files: [],
        reports: [{ reportName: "X", formats: ["excel"] }],
      }).skipFiles,
      true,
    );
  });
});

describe("merge helpers — duplicate prevention / preserve success", () => {
  it("preserves untargeted successful files when merging folders", () => {
    const prior = [
      {
        folderID: "f1",
        name: "Drawings",
        files: [
          {
            fileId: "111",
            name: "fail.pdf",
            downloadStatus: "failed",
            retryCount: 1,
          },
          {
            fileId: "222",
            name: "ok.pdf",
            downloadStatus: "ok",
            publicUrl: "https://x.supabase.co/storage/v1/object/public/ok.pdf",
          },
        ],
      },
    ];
    const next = [
      {
        folderID: "f1",
        name: "Drawings",
        files: [
          { fileId: "111", name: "fail.pdf", downloadStatus: "ok", publicUrl: "https://x.supabase.co/storage/v1/object/public/fail.pdf" },
          { fileId: "222", name: "ok.pdf", downloadStatus: "pending" },
        ],
      },
    ];
    const merged = pgcRetry.mergeFolderFilesPreservingUntargeted(
      prior,
      next,
      ["111"],
    );
    const byId = Object.fromEntries(
      merged[0].files.map((f) => [f.fileId, f]),
    );
    assert.equal(byId["111"].downloadStatus, "ok");
    assert.equal(byId["111"].retryCount, 2);
    assert.equal(byId["222"].downloadStatus, "ok");
    assert.match(byId["222"].publicUrl, /ok\.pdf/);
  });

  it("merges report PDF/Excel retry without wiping successful sibling format", () => {
    const prior = [
      {
        fileSlug: "plan-review-comments",
        reportName: "Plan Review Comments",
        pdfStatus: "failed",
        pdfError: "pdf_export_failed",
        excelStatus: "success",
        excelUrl: "https://x.supabase.co/storage/v1/object/public/a.xlsx",
        excelRetries: 0,
      },
    ];
    const next = [
      {
        fileSlug: "plan-review-comments",
        reportName: "Plan Review Comments",
        pdfStatus: "success",
        pdfUrl: "https://x.supabase.co/storage/v1/object/public/a.pdf",
        excelStatus: "pending",
      },
    ];
    const merged = pgcRetry.mergeReportEntriesPreservingSuccess(prior, next, [
      {
        fileSlug: "plan-review-comments",
        formats: ["pdf"],
      },
    ]);
    assert.equal(merged[0].pdfStatus, "success");
    assert.equal(merged[0].excelStatus, "success");
    assert.match(merged[0].excelUrl, /\.xlsx/);
    assert.equal(merged[0].pdfRetries, 1);
  });

  it("reuses stable report storage paths (no duplicate object keys)", () => {
    assert.equal(
      pgcRetry.pgcReportStoragePath("drawings/p/pgc/COM", "plan-review-comments", "pdf"),
      "drawings/p/pgc/COM/reports/plan-review-comments.pdf",
    );
    assert.equal(
      pgcRetry.pgcReportStoragePath("drawings/p/pgc/COM", "plan-review-comments", "excel"),
      "drawings/p/pgc/COM/reports/plan-review-comments.xlsx",
    );
  });
});

describe("shouldRetryReportFormat", () => {
  it("only retries selected formats", () => {
    const target = { formats: ["pdf"] };
    assert.equal(pgcRetry.shouldRetryReportFormat("pdf", target), true);
    assert.equal(pgcRetry.shouldRetryReportFormat("excel", target), false);
    assert.equal(pgcRetry.shouldRetryReportFormat("pdf", null), false);
  });
});
