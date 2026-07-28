import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "path";
import { fileURLToPath } from "node:url";
import {
  buildPortalHarvestRow,
  deriveHarvestQueueStatus,
  deriveLogicalReports,
  fileCompletionFromCounts,
  formatFileCompletionCaption,
  formatReportCompletionCaption,
  normalizeReportIdentity,
  reportDedupeKey,
  summarizePortalHarvestMetrics,
  summarizeReportCompletion,
  type PortalHarvestProjectInput,
} from "./portalHarvestMetrics.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NOW = new Date("2026-07-28T12:00:00.000Z").getTime();
const HOURS = 60 * 60 * 1000;
const DAYS = 24 * HOURS;

function project(partial: Partial<PortalHarvestProjectInput> & { id: string }): PortalHarvestProjectInput {
  return {
    credential_id: "cred-1",
    ...partial,
  };
}

describe("portal harvest summary metrics", () => {
  it("uses mutually exclusive current-state cards and reconciles connected total", () => {
    const rows = [
      buildPortalHarvestRow(
        project({
          id: "a",
          hasPortalData: true,
          last_checked_at: new Date(NOW - 2 * HOURS).toISOString(),
        }),
        NOW,
      ),
      buildPortalHarvestRow(
        project({
          id: "b",
          hasPortalData: false,
        }),
        NOW,
      ),
      buildPortalHarvestRow(
        project({
          id: "c",
          hasPortalData: true,
          last_checked_at: new Date(NOW - 10 * DAYS).toISOString(),
        }),
        NOW,
      ),
      buildPortalHarvestRow(
        project({
          id: "d",
          credential_id: "cred-2",
          hasPortalData: true,
          last_checked_at: new Date(NOW - HOURS).toISOString(),
          latestJob: {
            id: "j1",
            project_id: "d",
            status: "failed",
            updated_at: new Date(NOW - HOURS).toISOString(),
          },
        }),
        NOW,
      ),
      buildPortalHarvestRow(
        project({
          id: "p",
          credential_id: "cred-2",
          hasPortalData: true,
          last_checked_at: new Date(NOW - HOURS).toISOString(),
          hasPartialArtifacts: true,
        }),
        NOW,
      ),
      buildPortalHarvestRow(
        project({
          id: "q",
          hasPortalData: true,
          last_checked_at: new Date(NOW - HOURS).toISOString(),
          latestJob: {
            id: "jq",
            project_id: "q",
            status: "queued",
          },
        }),
        NOW,
      ),
      buildPortalHarvestRow(
        project({
          id: "e",
          credential_id: null,
          hasPortalData: false,
        }),
        NOW,
      ),
    ];

    const metrics = summarizePortalHarvestMetrics(rows);
    assert.equal(metrics.connectedProjects, 6);
    assert.equal(metrics.uniqueCredentials, 2);
    assert.equal(metrics.upToDate, 1); // a only
    assert.equal(metrics.awaitingFirstHarvest, 1); // b
    assert.equal(metrics.needsAttention, 3); // c stale, d failed, p partial
    assert.equal(metrics.activeJobs, 1); // q queued
    assert.equal(metrics.attentionBreakdown.stale, 1);
    assert.equal(metrics.attentionBreakdown.failed, 1);
    assert.equal(metrics.attentionBreakdown.partial, 1);
    assert.equal(metrics.attentionBreakdown.queued, 1);
    assert.equal(metrics.reconciles, true);
    assert.equal(
      metrics.connectedProjects,
      metrics.upToDate +
        metrics.awaitingFirstHarvest +
        metrics.needsAttention +
        metrics.activeJobs,
    );

    const attentionIds = rows.filter((r) => r.linked && r.needsAttention).map((r) => r.projectId);
    assert.deepEqual(attentionIds.sort(), ["c", "d", "p"]);
    assert.equal(new Set(attentionIds).size, attentionIds.length);
    assert.ok(!attentionIds.includes("b"), "awaiting is not in Needs Attention");
    assert.ok(!attentionIds.includes("a"), "up-to-date is not in Needs Attention");
  });

  it("does not count stale, failed-after-success, or partial-after-success as Up to Date", () => {
    const stale = buildPortalHarvestRow(
      project({
        id: "stale",
        hasPortalData: true,
        last_checked_at: new Date(NOW - 10 * DAYS).toISOString(),
      }),
      NOW,
    );
    const failedAfterSuccess = buildPortalHarvestRow(
      project({
        id: "failed",
        hasPortalData: true,
        last_checked_at: new Date(NOW - HOURS).toISOString(),
        latestJob: {
          id: "jf",
          project_id: "failed",
          status: "failed",
          updated_at: new Date(NOW - HOURS).toISOString(),
        },
      }),
      NOW,
    );
    const partialAfterSuccess = buildPortalHarvestRow(
      project({
        id: "partial",
        hasPortalData: true,
        last_checked_at: new Date(NOW - HOURS).toISOString(),
        hasPartialArtifacts: true,
      }),
      NOW,
    );

    assert.equal(stale.harvestStatus, "Stale");
    assert.equal(failedAfterSuccess.harvestStatus, "Failed");
    assert.equal(partialAfterSuccess.harvestStatus, "Partial");

    const metrics = summarizePortalHarvestMetrics([
      stale,
      failedAfterSuccess,
      partialAfterSuccess,
    ]);
    assert.equal(metrics.upToDate, 0);
    assert.equal(metrics.needsAttention, 3);
    assert.equal(metrics.reconciles, true);
  });
});

describe("portal harvest queue status", () => {
  it("maps recent successful harvest to Synced", () => {
    assert.equal(
      deriveHarvestQueueStatus(
        project({
          id: "1",
          hasPortalData: true,
          last_checked_at: new Date(NOW - 4 * HOURS).toISOString(),
        }),
        NOW,
      ),
      "Synced",
    );
  });

  it("maps no successful harvest to Awaiting First Harvest", () => {
    assert.equal(
      deriveHarvestQueueStatus(project({ id: "1", hasPortalData: false }), NOW),
      "Awaiting First Harvest",
    );
  });

  it("maps old successful harvest to Stale", () => {
    assert.equal(
      deriveHarvestQueueStatus(
        project({
          id: "1",
          hasPortalData: true,
          last_checked_at: new Date(NOW - 10 * DAYS).toISOString(),
        }),
        NOW,
      ),
      "Stale",
    );
  });

  it("maps partial artifact failures to Partial", () => {
    assert.equal(
      deriveHarvestQueueStatus(
        project({
          id: "1",
          hasPortalData: true,
          last_checked_at: new Date(NOW - HOURS).toISOString(),
          hasPartialArtifacts: true,
        }),
        NOW,
      ),
      "Partial",
    );
  });

  it("maps credential failure to Credentials Required", () => {
    assert.equal(
      deriveHarvestQueueStatus(
        project({
          id: "1",
          hasPortalData: false,
          latestJob: {
            id: "j",
            project_id: "1",
            status: "failed",
            error_user_message: "Login failed: invalid credentials",
          },
        }),
        NOW,
      ),
      "Credentials Required",
    );
  });

  it("keeps permit status Approved separate from harvest status", () => {
    const row = buildPortalHarvestRow(
      project({
        id: "1",
        portal_status: "Approved",
        hasPortalData: true,
        last_checked_at: new Date(NOW - HOURS).toISOString(),
      }),
      NOW,
    );
    assert.equal(row.harvestStatus, "Synced");
    assert.equal(row.portalStatus, "Approved");
    assert.notEqual(row.harvestStatus, "Approved");
  });

  it("never-harvested projects are not Stale", () => {
    assert.equal(
      deriveHarvestQueueStatus(
        project({
          id: "1",
          hasPortalData: false,
          last_checked_at: new Date(NOW - 30 * DAYS).toISOString(),
        }),
        NOW,
      ),
      "Awaiting First Harvest",
    );
  });
});

describe("report deduplication", () => {
  it("counts PDF + Excel of the same report as one logical report", () => {
    const logical = deriveLogicalReports({
      reportEntries: [
        {
          reportName: "Plan Review - Review Comments",
          fileSlug: "review-comments",
          pdfUrl: "https://example.com/a.pdf",
          excelUrl: "https://example.com/a.xlsx",
          pdfDownloaded: true,
          excelDownloaded: true,
        },
      ],
    });
    assert.equal(logical.length, 1);
    assert.equal(logical[0].status, "Complete");
    assert.equal(logical[0].artifacts.length, 2);
  });

  it("five logical reports with two formats each remain five", () => {
    const names = [
      "Current Project - All Uploaded Files with Sheet Sizes",
      "Plan Review - Department Review Status",
      "Plan Review - Review Comments",
      "Plan Review - Review Details",
      "Plan Review - Workflow Routing Slip",
    ];
    const logical = deriveLogicalReports({
      reportEntries: names.map((reportName) => ({
        reportName,
        fileSlug: normalizeReportIdentity(reportName),
        pdfUrl: `https://example.com/${encodeURIComponent(reportName)}.pdf`,
        excelUrl: `https://example.com/${encodeURIComponent(reportName)}.xlsx`,
        pdfDownloaded: true,
        excelDownloaded: true,
      })),
      pdfs: names.map((fileName) => ({
        fileName,
        pdfPublicUrl: `https://example.com/${encodeURIComponent(fileName)}.pdf`,
        excelPublicUrl: `https://example.com/${encodeURIComponent(fileName)}.xlsx`,
      })),
    });
    const summary = summarizeReportCompletion(logical);
    assert.equal(summary.logicalReports, 5);
    assert.notEqual(summary.logicalReports, 10);
    assert.equal(summary.reportArtifactsDownloaded, 10);
  });

  it("keeps different report names distinct", () => {
    const logical = deriveLogicalReports({
      reportEntries: [
        { reportName: "Plan Review - Review Comments", pdfDownloaded: true, pdfUrl: "https://x/a.pdf" },
        { reportName: "Plan Review - Review Details", pdfDownloaded: true, pdfUrl: "https://x/b.pdf" },
      ],
    });
    assert.equal(logical.length, 2);
  });

  it("does not merge unrelated reports when IDs are missing", () => {
    assert.notEqual(
      reportDedupeKey({ reportName: "Review Comments" }),
      reportDedupeKey({ reportName: "Review Details" }),
    );
  });

  it("normalizes format suffixes without merging different titles", () => {
    assert.equal(
      normalizeReportIdentity("Review Comments.pdf"),
      normalizeReportIdentity("Review Comments"),
    );
    assert.notEqual(
      normalizeReportIdentity("Review Comments"),
      normalizeReportIdentity("Review Comment"),
    );
  });
});

describe("completion ratios", () => {
  it("formats 40 success + 10 failed as 40 of 50 when expected is known", () => {
    const summary = fileCompletionFromCounts({
      downloaded: 40,
      failed: 10,
      treatKnownBucketsAsExpected: true,
    });
    assert.equal(summary.downloaded, 40);
    assert.equal(summary.failed, 10);
    assert.equal(summary.expectedTotal, 50);
    const caption = formatFileCompletionCaption(summary);
    assert.equal(caption.value, "40 of 50");
  });

  it("derives Partial when one required format fails", () => {
    const logical = deriveLogicalReports({
      reportEntries: [
        {
          reportName: "Review Comments",
          pdfUrl: "https://x/a.pdf",
          pdfDownloaded: true,
          excelDownloaded: false,
          excelError: "timeout",
        },
      ],
    });
    assert.equal(logical[0].status, "Partial");
  });

  it("derives Complete when all required formats succeed", () => {
    const logical = deriveLogicalReports({
      reportEntries: [
        {
          reportName: "Review Comments",
          pdfUrl: "https://x/a.pdf",
          excelUrl: "https://x/a.xlsx",
          pdfDownloaded: true,
          excelDownloaded: true,
        },
      ],
    });
    assert.equal(logical[0].status, "Complete");
  });

  it("does not fabricate a file denominator without expected total", () => {
    const summary = fileCompletionFromCounts({
      downloaded: 4,
      failed: 0,
      treatKnownBucketsAsExpected: false,
    });
    assert.equal(summary.hasExpectedTotal, false);
    const caption = formatFileCompletionCaption(summary);
    assert.equal(caption.value, "4");
    assert.match(caption.subtitle, /4 files downloaded/);
    assert.match(caption.detail || "", /Expected total unavailable/i);
  });

  it("formats logical report caption without double-counting", () => {
    const logical = deriveLogicalReports({
      reportEntries: [
        {
          reportName: "A",
          pdfDownloaded: true,
          excelDownloaded: true,
          pdfUrl: "https://x/a.pdf",
          excelUrl: "https://x/a.xlsx",
        },
        {
          reportName: "B",
          pdfDownloaded: true,
          excelDownloaded: true,
          pdfUrl: "https://x/b.pdf",
          excelUrl: "https://x/b.xlsx",
        },
        {
          reportName: "C",
          pdfDownloaded: true,
          excelDownloaded: true,
          pdfUrl: "https://x/c.pdf",
          excelUrl: "https://x/c.xlsx",
        },
        {
          reportName: "D",
          pdfDownloaded: true,
          excelDownloaded: true,
          pdfUrl: "https://x/d.pdf",
          excelUrl: "https://x/d.xlsx",
        },
        {
          reportName: "E",
          pdfDownloaded: true,
          excelDownloaded: true,
          pdfUrl: "https://x/e.pdf",
          excelUrl: "https://x/e.xlsx",
        },
      ],
    });
    const summary = summarizeReportCompletion(logical);
    const caption = formatReportCompletionCaption(summary);
    assert.equal(caption.value, "5");
    assert.match(caption.subtitle, /5 logical reports captured/);
  });
});

describe("UI label contracts", () => {
  it("queue and detail sources use corrected labels and Upcoming controls", () => {
    const queueSrc = readFileSync(join(__dirname, "../components/portal/PortalHarvestQueue.tsx"), "utf8");
    const detailSrc = readFileSync(join(__dirname, "../pages/PortalDataViewer.tsx"), "utf8");

    assert.match(queueSrc, /Connected projects/i);
    assert.doesNotMatch(queueSrc, /Connected portals/i);
    assert.match(queueSrc, /Up to date/i);
    assert.doesNotMatch(queueSrc, /label=["']Synced["']/i);
    assert.match(queueSrc, /Awaiting first harvest/i);
    assert.doesNotMatch(queueSrc, /Awaiting first sync/i);
    assert.match(queueSrc, /Needs attention/i);
    assert.doesNotMatch(queueSrc, /label=["']Stale \(7d\+\)["']/i);
    assert.match(queueSrc, /Run Full Harvest/i);
    assert.match(queueSrc, /Upcoming/);
    assert.match(queueSrc, /button-portal-harvest-filter/);
    assert.match(queueSrc, /DropdownMenuCheckboxItem/);
    assert.doesNotMatch(queueSrc, /Filter[\s\S]{0,120}Upcoming/);
    assert.doesNotMatch(queueSrc, /Manage Project Credentials/);
    assert.doesNotMatch(queueSrc, /pilot-button-primary/);
    assert.doesNotMatch(queueSrc, />\s*Force Sync\s*</);

    assert.match(detailSrc, /label=["']Selected project["']/i);
    assert.doesNotMatch(detailSrc, /label=["']Active project["']/i);
    assert.doesNotMatch(detailSrc, /selectedProjectId \? ["']1["'] : ["']0["']/);
    assert.match(detailSrc, /Portal status:/);
    assert.match(detailSrc, /Run Full Harvest/i);
    assert.match(detailSrc, /Upcoming/);
    assert.match(detailSrc, /Retry Failed Items/i);
    // Harvest status card value must be derived harvest status, not portal Approved
    assert.match(detailSrc, /value=\{displayHarvestStatus\}/);
    assert.doesNotMatch(
      detailSrc,
      /label=["']Harvest status["']\s*\n\s*value=\{scrape\.isScraping \? ["']Live["'] : displayPortalStatus/,
    );
    assert.doesNotMatch(
      detailSrc,
      /reportEntries \?\? \[\]\)\.length \+ \(portalData\.tabs\?\.reports\?\.pdfs/,
    );
  });
});
