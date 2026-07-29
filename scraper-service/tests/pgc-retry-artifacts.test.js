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

describe("merge helpers — fileId in-place update / no duplicates", () => {
  it("merges by fileId: failed→ok with storage URL and retryCount", () => {
    const prior = [
      {
        folderID: "f1",
        name: "Drawings",
        files: [
          {
            fileId: "111",
            name: "fail.pdf",
            downloadStatus: "failed",
            downloadError: "viewer_tab_missing",
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
          {
            fileId: "111",
            name: "fail.pdf",
            downloadStatus: "ok",
            publicUrl: "https://x.supabase.co/storage/v1/object/public/fail.pdf",
          },
          { fileId: "222", name: "ok.pdf", downloadStatus: "pending" },
        ],
      },
    ];
    const merged = pgcRetry.mergeFolderFilesPreservingUntargeted(
      prior,
      next,
      ["111"],
    );
    const byId = Object.fromEntries(merged[0].files.map((f) => [f.fileId, f]));
    assert.equal(merged[0].files.length, 2);
    assert.equal(byId["111"].downloadStatus, "ok");
    assert.equal(
      byId["111"].publicUrl,
      "https://x.supabase.co/storage/v1/object/public/fail.pdf",
    );
    assert.equal(byId["111"].downloadError, undefined);
    assert.equal(byId["111"].retryCount, 2);
    assert.equal(byId["222"].downloadStatus, "ok");
    assert.match(byId["222"].publicUrl, /ok\.pdf/);
  });

  it("does not keep both failed and successful rows for the same fileId", () => {
    const prior = [
      {
        folderID: "f1",
        name: "Drawings",
        files: [
          {
            fileId: "111",
            name: "a.pdf",
            downloadStatus: "failed",
            downloadError: "publish_menu_not_opened",
          },
        ],
      },
      {
        folderID: "f2",
        name: "Other",
        files: [
          {
            fileId: "111",
            name: "a.pdf",
            downloadStatus: "ok",
            publicUrl: "https://x.supabase.co/storage/v1/object/public/a.pdf",
          },
        ],
      },
    ];
    const next = [
      {
        folderID: "f1",
        name: "Drawings",
        files: [
          {
            fileId: "111",
            name: "a.pdf",
            downloadStatus: "ok",
            publicUrl: "https://x.supabase.co/storage/v1/object/public/a2.pdf",
          },
        ],
      },
    ];
    const merged = pgcRetry.mergeFolderFilesPreservingUntargeted(
      prior,
      next,
      ["111"],
    );
    const all = merged.flatMap((f) => f.files);
    const matches = all.filter((f) => f.fileId === "111");
    assert.equal(matches.length, 1);
    assert.equal(matches[0].downloadStatus, "ok");
  });

  it("keeps updated failure reason + retry count when retry fails again", () => {
    const prior = [
      {
        folderID: "f1",
        name: "Drawings",
        files: [
          {
            fileId: "5113090",
            name: "a.pdf",
            downloadStatus: "failed",
            downloadError: "viewer_tab_missing",
            retryCount: 1,
          },
        ],
      },
    ];
    const next = [
      {
        folderID: "f1",
        name: "Drawings",
        files: [
          {
            fileId: "5113090",
            name: "a.pdf",
            downloadStatus: "failed",
            downloadError: "publish_menu_not_opened",
          },
        ],
      },
    ];
    const merged = pgcRetry.mergeFolderFilesPreservingUntargeted(
      prior,
      next,
      ["5113090"],
    );
    const f = merged[0].files[0];
    assert.equal(f.downloadStatus, "failed");
    assert.equal(f.downloadError, "publish_menu_not_opened");
    assert.equal(f.retryCount, 2);
  });

  it("recalculates counts: 379 ok / 42 failed → 383 ok / 38 failed after 4 success / 1 fail", () => {
    const okFiles = Array.from({ length: 379 }, (_, i) => ({
      fileId: `ok-${i}`,
      name: `ok-${i}.pdf`,
      downloadStatus: "ok",
      publicUrl: `https://x.supabase.co/storage/v1/object/public/ok-${i}.pdf`,
    }));
    const failedFiles = Array.from({ length: 42 }, (_, i) => ({
      fileId: `fail-${i}`,
      name: `fail-${i}.pdf`,
      downloadStatus: "failed",
      downloadError: "viewer_tab_missing",
      retryCount: 0,
    }));
    const prior = [
      {
        folderID: "f1",
        name: "All",
        files: [...okFiles, ...failedFiles],
      },
    ];
    const targeted = ["fail-0", "fail-1", "fail-2", "fail-3", "fail-4"];
    const next = [
      {
        folderID: "f1",
        name: "All",
        files: [
          {
            fileId: "fail-0",
            downloadStatus: "ok",
            publicUrl: "https://x.supabase.co/storage/v1/object/public/r0.pdf",
          },
          {
            fileId: "fail-1",
            downloadStatus: "ok",
            publicUrl: "https://x.supabase.co/storage/v1/object/public/r1.pdf",
          },
          {
            fileId: "fail-2",
            downloadStatus: "ok",
            publicUrl: "https://x.supabase.co/storage/v1/object/public/r2.pdf",
          },
          {
            fileId: "fail-3",
            downloadStatus: "ok",
            publicUrl: "https://x.supabase.co/storage/v1/object/public/r3.pdf",
          },
          {
            fileId: "fail-4",
            downloadStatus: "failed",
            downloadError: "publish_menu_not_opened",
          },
        ],
      },
    ];
    const before = pgcRetry.summarizeFolderDownloadCounts(prior);
    assert.equal(before.ok, 379);
    assert.equal(before.failed, 42);
    assert.equal(before.total, 421);

    const merged = pgcRetry.mergeFolderFilesPreservingUntargeted(
      prior,
      next,
      targeted,
    );
    const after = pgcRetry.summarizeFolderDownloadCounts(merged);
    assert.equal(after.ok, 383);
    assert.equal(after.failed, 38);
    assert.equal(after.total, 421);
    assert.equal(merged[0].files.length, 421);
    assert.equal(merged[0].fileCount, 421);
    assert.equal(merged[0].filesCount, 421);

    const stillFailed = merged[0].files.find((f) => f.fileId === "fail-4");
    assert.equal(stillFailed.downloadStatus, "failed");
    assert.equal(stillFailed.downloadError, "publish_menu_not_opened");
    assert.equal(stillFailed.retryCount, 1);
  });

  it("preserves prior folders not present in next", () => {
    const prior = [
      {
        folderID: "a",
        name: "A",
        files: [{ fileId: "1", downloadStatus: "ok", publicUrl: "https://x/a" }],
      },
      {
        folderID: "b",
        name: "B",
        files: [
          {
            fileId: "2",
            downloadStatus: "failed",
            downloadError: "x",
            retryCount: 0,
          },
        ],
      },
    ];
    const next = [
      {
        folderID: "b",
        name: "B",
        files: [
          {
            fileId: "2",
            downloadStatus: "ok",
            publicUrl: "https://x.supabase.co/storage/v1/object/public/b.pdf",
          },
        ],
      },
    ];
    const merged = pgcRetry.mergeFolderFilesPreservingUntargeted(prior, next, [
      "2",
    ]);
    assert.equal(merged.length, 2);
    assert.ok(merged.some((f) => f.folderID === "a"));
    const b = merged.find((f) => f.folderID === "b");
    assert.equal(b.files[0].downloadStatus, "ok");
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

describe("filterFolderIdsForTargetedRetry", () => {
  it("only includes folders that contain selected fileIds", () => {
    const byFolder = new Map([
      ["f1", [{ file: { fileId: "111" } }, { file: { fileId: "222" } }]],
      ["f2", [{ file: { fileId: "333" } }]],
      ["f3", [{ file: { fileId: "444" } }]],
    ]);
    const filtered = pgcRetry.filterFolderIdsForTargetedRetry(
      ["f1", "f2", "f3"],
      byFolder,
      ["111", "444"],
    );
    assert.deepEqual(filtered, ["f1", "f3"]);
  });

  it("returns all folders when no targeted ids", () => {
    assert.deepEqual(
      pgcRetry.filterFolderIdsForTargetedRetry(["a", "b"], new Map(), []),
      ["a", "b"],
    );
  });
});

describe("applyFileUpdatesByFileId / portalFilePatchFromScrapeRow", () => {
  it("applies uploaded scrape row onto failed portal file", () => {
    const folders = [
      {
        folderID: "f1",
        name: "Drawings",
        files: [
          {
            fileId: "5113096",
            downloadStatus: "failed",
            downloadError: "x",
            retryCount: 0,
          },
        ],
      },
    ];
    const update = pgcRetry.portalFilePatchFromScrapeRow({
      portal_file_id: "5113096",
      status: "uploaded",
      public_url: "https://x.supabase.co/storage/v1/object/public/a.pdf",
      file_name: "a.pdf",
    });
    const merged = pgcRetry.applyFileUpdatesByFileId(folders, [update]);
    assert.equal(merged[0].files[0].downloadStatus, "ok");
    assert.match(merged[0].files[0].publicUrl, /a\.pdf/);
    assert.equal(merged[0].files[0].retryCount, 1);
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
