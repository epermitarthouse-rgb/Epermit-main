"use strict";

/**
 * DC HTML partial extractors, run in a real Chromium DOM (Playwright) against the redacted 11854
 * captures. Offline only: no portal access.
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { extractCorrectionRows, extractProjectInfoFields, extractReviewCommentsReport } = require("../permit-sync/adapters/dc-projectdox/dom-extract");
const dc = require("../permit-sync/adapters/dc-projectdox/normalize");

const FIX = path.join(__dirname, "fixtures", "permit-sync", "dc");
const html = (name) => fs.readFileSync(path.join(FIX, "html", name), "utf8");
const jsonRows = JSON.parse(fs.readFileSync(path.join(FIX, "corrections-resubmit.json"), "utf8")).rows;
const statusFixture = JSON.parse(fs.readFileSync(path.join(FIX, "workflow-status-resubmit.json"), "utf8"));
const correctionsJson = JSON.parse(fs.readFileSync(path.join(FIX, "corrections-json-11975.json"), "utf8"));

describe("DC DOM extractors (Chromium)", () => {
  let browser;
  let page;

  before(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
    await page.setContent("<!doctype html><title>dc-dom-test</title>");
  });

  after(async () => {
    if (browser) await browser.close();
  });

  describe("Reviews (rendered Reviews tab DOM, 11854)", () => {
    let rows;
    before(async () => {
      rows = await page.evaluate(extractCorrectionRows, html("11854-corrections.html"));
    });

    it("returns one row per comment, keyed by REF #, in document order", () => {
      assert.deepEqual(rows.map((r) => r.ref), [4, 5, 3, 1, 2]);
    });

    it("matches the verified JSON fixture for the comments it covers", () => {
      for (const want of jsonRows) {
        const got = rows.find((r) => r.ref === want.ref);
        assert.ok(got, `ref ${want.ref} present`);
        assert.equal(got.department, want.department, `ref ${want.ref} department`);
        assert.equal(got.reviewer, want.reviewer, `ref ${want.ref} reviewer role`);
        assert.equal(got.reviewedAt, want.reviewedAt, `ref ${want.ref} reviewedAt`);
        assert.equal(got.cycle, want.cycle, `ref ${want.ref} cycle`);
        assert.equal(got.status, want.status, `ref ${want.ref} status`);
        assert.equal(got.type, want.type, `ref ${want.ref} type`);
        assert.deepEqual(got.responses.map((r) => [r.by, r.at]), want.responses.map((r) => [r.by, r.at]), `ref ${want.ref} responses`);
        assert.ok(got.text.startsWith(want.text.slice(0, 40)), `ref ${want.ref} text prefix`);
      }
    });

    it("maps response column state from the class, not from the text", () => {
      const byRef = Object.fromEntries(rows.map((r) => [r.ref, r.responseColumn]));
      assert.equal(byRef[4], "none");
      assert.equal(byRef[5], "No response required.");
      assert.equal(byRef[3], "Type your response here.");
    });

    it("reads cycle blanks as null and Cycle N as N", () => {
      const byRef = Object.fromEntries(rows.map((r) => [r.ref, r.cycle]));
      assert.equal(byRef[1], null);
      assert.equal(byRef[2], null);
      assert.equal(byRef[3], 1);
      assert.equal(byRef[5], 2);
    });

    it("orders discussion entries oldest-first and assigns roles, not names", () => {
      const r3 = rows.find((r) => r.ref === 3);
      assert.deepEqual(r3.responses.map((r) => r.by), ["applicant", "reviewer"]);
      assert.ok(r3.responses[0].at < r3.responses[1].at);
      const r1 = rows.find((r) => r.ref === 1);
      assert.equal(r1.responses.length, 1);
      assert.equal(r1.responses[0].text, "The DOB Contract Agreement has been uploaded.");
    });

    it("unresolved count agrees with the status JSON (parity)", () => {
      const unresolvedRows = rows.filter((r) => r.status === "Unresolved").length;
      assert.equal(unresolvedRows, dc.statusUnresolvedTotal(statusFixture));
    });

    it("never carries a reviewer name or a contact email into the output", () => {
      const serialised = JSON.stringify(rows);
      assert.equal(serialised.includes("[REVIEWER]"), false, "reviewer placeholder is a name slot and must not appear");
      assert.equal(/[\w.+-]+@[\w-]+\.[\w.-]+/.test(serialised), false, "no email addresses");
    });

    it("feeds the normalizer without errors and keeps unresolved response_required", () => {
      const { comments, responses } = dc.reviewItems(rows);
      assert.equal(comments.length, 5);
      assert.equal(comments.find((c) => c.fields.ref_number === 3).fields.response_required, true);
      assert.equal(comments.find((c) => c.fields.ref_number === 5).fields.response_required, false);
      assert.equal(responses.length, 5, "4 responses on refs 1-4 plus 1 extra on ref 3 (two discussion entries)");
    });

    it("returns null when the partial has no corrections grid (no Reviews tab)", async () => {
      assert.equal(await page.evaluate(extractCorrectionRows, "<html><body><div>No review comments tab</div></body></html>"), null);
    });
  });

  describe("Info (ProjectInfo partial, 11854)", () => {
    let info;
    before(async () => {
      info = await page.evaluate(extractProjectInfoFields, html("11854-info.html"));
    });

    it("reads the allowlisted fields with the verified values", () => {
      const v = info.values;
      assert.ok(v.description.startsWith("INTERIOR DEMOLITION OF EXISTING PHYSICS DEPARTMENT BUILDING"));
      assert.equal(v.address, "2355 6TH ST NW WASHINGTON, DC 20059");
      assert.equal(v.contactOrg, "HOWARD UNIVERSITY");
      assert.equal(v.ownerOrg, "Building Permits");
      assert.equal(v.jobClass, "AA-C");
      assert.equal(v.statusRaw, "Resubmit");
      assert.equal(v.reviewCycle, "2");
      assert.equal(v.startDate, "2025-08-28");
      assert.equal(v.endDate, "2026-02-28");
      assert.equal(v.latitude, null);
      assert.equal(v.longitude, null);
    });

    it("never reads emails or phone numbers, and lists label names only", () => {
      const serialised = JSON.stringify(info);
      assert.equal(serialised.includes("mailto"), false);
      assert.equal(serialised.includes("[EMAIL]"), false);
      assert.equal(serialised.includes("[PHONE]"), false);
      assert.ok(info.labelsSeen.includes("Contact's Email"), "the label is seen, its value is not read");
      assert.equal(Object.keys(info.values).some((k) => /email|phone/i.test(k)), false);
    });

    it("does not map the permit-number 'Project name' to the title", () => {
      assert.equal("projectName" in info.values, false);
      assert.equal("title" in info.values, false);
    });

    it("returns null when the partial has no project info container", async () => {
      assert.equal(await page.evaluate(extractProjectInfoFields, "<html><body>nothing</body></html>"), null);
    });
  });

  describe("Review Comments report (SSRS ReportViewer, 11854 / workflow 11975)", () => {
    let report;
    let jsonRows;
    before(async () => {
      report = await page.evaluate(extractReviewCommentsReport, html("11854-review-comments-report.html"));
      jsonRows = dc.correctionRowsFromJson(correctionsJson);
    });

    it("reads the header and the single-page pager", () => {
      assert.equal(report.projectName, "D2500488");
      assert.equal(report.workflowStartedAt, "2025-08-28T14:56:11");
      assert.equal(report.generatedAt, "2026-11-05T11:19:00");
      assert.equal(report.totalPages, 1);
    });

    it("workflow start equals the JSON DateStarted wall clock (same server clock)", () => {
      assert.equal(report.workflowStartedAt, correctionsJson.WorkflowInstance.DateStarted.slice(0, 19));
    });

    it("has one row per correction, in REF order, matching the corrections JSON", () => {
      assert.deepEqual(report.rows.map((r) => r.ref), [1, 2, 3, 4, 5]);
      for (const got of report.rows) {
        const want = jsonRows.find((r) => r.ref === got.ref);
        assert.equal(got.department, want.department, `ref ${got.ref} department`);
        assert.equal(got.reviewer, "reviewer", `ref ${got.ref} reviewer role`);
        assert.equal(got.reviewedAt.slice(0, 16), want.reviewedAt.slice(0, 16), `ref ${got.ref} reviewedAt`);
        assert.equal(got.cycle, want.cycle, `ref ${got.ref} cycle`);
        assert.equal(got.status, want.status, `ref ${got.ref} status`);
        assert.equal(got.type, want.type, `ref ${got.ref} type`);
        assert.equal(got.fileName, null, `ref ${got.ref} file`);
        assert.deepEqual(got.responses.map((r) => [r.by, r.text]), want.responses.map((r) => [r.by, r.text]), `ref ${got.ref} responses`);
      }
    });

    it("comment text agrees with the JSON text apart from the report's own email placeholder", () => {
      for (const got of report.rows) {
        const want = jsonRows.find((r) => r.ref === got.ref);
        assert.equal(got.text.replace(/\[EMAIL\]/g, "[email]"), want.text, `ref ${got.ref} text`);
      }
    });

    it("response times: refs 2 and 3 match the JSON minute; refs 1 and 4 print an earlier time (observed)", () => {
      const at = (rows, ref) => rows.find((r) => r.ref === ref).responses.map((r) => r.at.slice(0, 16));
      assert.deepEqual(at(report.rows, 2), at(jsonRows, 2));
      assert.deepEqual(at(report.rows, 3), at(jsonRows, 3));
      assert.deepEqual(at(report.rows, 1), ["2025-09-04T12:27"]);
      assert.deepEqual(at(jsonRows, 1), ["2025-09-04T12:29"]);
      assert.deepEqual(at(report.rows, 4), ["2026-01-07T16:41"]);
      assert.deepEqual(at(jsonRows, 4), ["2026-01-07T16:43"]);
    });

    it("never carries a reviewer or responder name into the output", () => {
      assert.equal(JSON.stringify(report).includes("[REVIEWER]"), false);
    });

    it("feeds the normalizer as source_kind report", () => {
      const { comments, responses } = dc.reviewItems(report.rows, { sourceKind: "report" });
      assert.equal(comments.length, 5);
      assert.equal(responses.length, 5);
      assert.ok(comments.every((c) => c.fields.source_kind === "report"));
      assert.equal(comments.find((c) => c.fields.ref_number === 5).fields.response_required, false);
    });

    it("returns null for a page without the Review Comments table", async () => {
      assert.equal(await page.evaluate(extractReviewCommentsReport, "<html><body><table><tr><td>REF #</td></tr></table></body></html>"), null);
    });
  });
});
