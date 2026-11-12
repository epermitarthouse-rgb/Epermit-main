"use strict";

/**
 * D-072: portalContentHash ignores the fields the manual DC scraper changes on every run. The payload shape is
 * the key structure of a real production DC project's portal_data (values are synthetic).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { portalContentHash, portalContent, normalizeReportText } = require("../lib/portal-content-hash");

function payload(run, { status = "Approved", reviewText = "Ref 1: provide stamped drawings" } = {}) {
  return {
    name: "BCIV0000001", projectNum: "BCIV0000001", portalType: "projectdox", dashboardStatus: "Approved",
    description: "Civil", location: "1 Example St NW", scrapedAt: `2026-11-${10 + run}T09:00:00.000Z`,
    meta: { comment_parse_cursor: { pdfIndex: run } },
    _permitpilot: { canonical_address: { source_timestamp: `2026-11-${10 + run}T09:00:00Z` } },
    permitRepositorySync: { permit_id: "p", section_hashes: { files: `h${run}` } },
    portalFilesScrapeStatus: "complete",
    tabs: {
      status: { keyValues: [{ key: "Status", value: status }], rawText: "Status" },
      files: {
        filesScrapeStatus: run % 2 ? "complete" : "in_progress",
        folders: [{ name: "Approved Drawings", fileCount: 1, files: [{
          fileId: "700101", name: "A-101.pdf", folderName: "Approved Drawings", status: "Approved", uploadedDate: "2/9/26 1:30 PM",
          commentCount: 0, reviewedBy: "Reviewer", downloadStatus: run % 2 ? "success" : "failed", downloadError: run % 2 ? undefined : "timeout",
          viewUrl: `https://x.supabase.co/storage/v1/object/public/project-drawings/drawings/abc/${run}/A-101.pdf`,
          storageRef: { bucket: "permit-documents", path: "p/files/700101_A-101.pdf", sha256: "a".repeat(64) },
        }] }],
      },
      reports: {
        pdfs: [{
          fileName: "Plan Review - Review Comments", pages: 2,
          text: `Plan Review - Review Comments\nGenerated:  11/${10 + run}/2026 0${run}:15 PM\n${reviewText}`,
          url: "https://washington-dc-us-projectdoxwebui.avolvecloud.com/WebForms/ReportViewer.aspx?ReportID=14&ProjectID=1",
          pdfUrl: `https://x.supabase.co/storage/v1/object/sign/r.pdf?token=${run}`, pdfPublicUrl: `https://pub/${run}.pdf`,
          pdfPath: `/var/folders/T/wa_report_${run}.pdf`, excelPath: `/tmp/${run}.xlsx`, excelPublicUrl: `https://pub/${run}.xlsx`,
          screenshot: `iVBOR${run}`, pdfValid: true, excelValid: run % 2 === 0, excelExportMethod: run % 2 ? "menu" : "url",
        }],
        reportEntries: [{ reportName: "Plan Review - Review Comments", viewerUrl: `https://v/${run}`, viewerReady: true, flags: { viewerUrlResolved: true }, pdfDownloaded: true, exportUnavailable: false }],
      },
    },
  };
}

test("same permit content with new scrape times, URLs, temp paths, screenshots and SSRS render time: same hash", () => {
  assert.equal(portalContentHash(payload(1)), portalContentHash(payload(2)));
  assert.equal(portalContentHash(payload(1)), portalContentHash(payload(7)));
});

test("a real change in status, review text or file list changes the hash", () => {
  const base = portalContentHash(payload(1));
  assert.notEqual(portalContentHash(payload(1, { status: "Resubmit" })), base);
  assert.notEqual(portalContentHash(payload(1, { reviewText: "Ref 1: resolved" })), base);
  const p = payload(1);
  p.tabs.files.folders[0].files.push({ fileId: "700102", name: "A-102.pdf", status: "Approved" });
  assert.notEqual(portalContentHash(p), base);
});

test("PermitPilot bookkeeping (parser cursor, canonical address meta, deep sync state) is not content", () => {
  const c = portalContent(payload(3));
  assert.equal(c.meta, undefined);
  assert.equal(c._permitpilot, undefined);
  assert.equal(c.permitRepositorySync, undefined);
  assert.equal(c.scrapedAt, undefined);
  assert.equal(c.tabs.files.folders[0].files[0].viewUrl, undefined);
  assert.equal(c.tabs.files.folders[0].files[0].fileId, "700101");
  assert.equal(c.tabs.reports.pdfs[0].pages, 2);
});

test("report render stamps are normalised; other dates are kept", () => {
  assert.equal(normalizeReportText("A\nGenerated:  11/11/2026 10:42 AM\nB"), "A\nGenerated: <render-time>\nB");
  assert.equal(normalizeReportText("Report date: 4/22/2026 7:57 PM"), "Report date: <render-time>");
  assert.equal(normalizeReportText("Submitted 2/9/26 1:30 PM"), "Submitted 2/9/26 1:30 PM");
});

test("a URL carrying a token or signature is treated as volatile wherever it appears", () => {
  const a = payload(1);
  const b = payload(1);
  a.tabs.status.links = [{ href: "https://h/x?token=1" }];
  b.tabs.status.links = [{ href: "https://h/x?token=2" }];
  assert.equal(portalContentHash(a), portalContentHash(b));
});

test("D-101: the Files tab page snapshot and display order do not count when the folder list is present", () => {
  const a = payload(1);
  const b = payload(1);
  a.tabs.files.rawText = "Approved Drawings (1)  A-101.pdf  2/9/26 1:30 PM";
  a.tabs.files.tables = [{ tableIndex: 0, headers: ["A-101.pdf", "2/9/26 1:30 PM"], rows: [] }];
  b.tabs.files.rawText = "Supporting Documents (0)";
  b.tabs.files.tables = [{ tableIndex: 0, headers: ["Name"], rows: [{ Col_0: "x" }] }];
  b.tabs.files.keyValues = [{ key: "Folder", value: "Supporting Documents" }];
  assert.equal(portalContentHash(a), portalContentHash(b));

  const twoFolders = (order) => {
    const p = payload(1);
    const drawings = p.tabs.files.folders[0];
    drawings.files.push({ fileId: "700099", name: "A-099.pdf", folderName: "Approved Drawings", status: "Approved" });
    const support = { name: "Approved Supporting Documents", fileCount: 1, files: [{ fileId: "700200", name: "S-1.pdf", status: "Approved" }] };
    p.tabs.files.folders = order ? [drawings, support] : [support, { ...drawings, files: [...drawings.files].reverse() }];
    return p;
  };
  assert.equal(portalContentHash(twoFolders(true)), portalContentHash(twoFolders(false)));

  const renamed = payload(1);
  renamed.tabs.files.folders[0].files[0].status = "Resubmit";
  assert.notEqual(portalContentHash(renamed), portalContentHash(a), "a file status change still counts");
});

test("D-101: a Files tab without a folder list keeps its page text as content", () => {
  const a = payload(1);
  const b = payload(1);
  delete a.tabs.files.folders;
  delete b.tabs.files.folders;
  a.tabs.files.rawText = "A-101.pdf Approved";
  b.tabs.files.rawText = "A-101.pdf Resubmit";
  assert.notEqual(portalContentHash(a), portalContentHash(b));
});
