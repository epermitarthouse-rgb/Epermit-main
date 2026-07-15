"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const {
  isPepcoLiveSubmissionEnabled,
  preparePepcoSubmissionContext,
  runPepcoValidationDryRun,
  runPepcoPortalSubmissionOnPage,
} = require("../app/services/uci/uci-pepco-submission.service.js");
const {
  buildSubmissionContext,
  extractPepcoConfirmation,
} = require("../scrapers/pepco/submit-flow.js");

const FORM_FIXTURE = fs.readFileSync(
  path.join(__dirname, "fixtures/pepco/submission-form.html"),
  "utf8",
);
const CONFIRMATION_FIXTURE = fs.readFileSync(
  path.join(__dirname, "fixtures/pepco/submission-confirmation.html"),
  "utf8",
);

const BASE_PROJECT = {
  id: "proj-1",
  name: "QSR Fit-out",
  project_type: "tenant_improvement",
  description: "Restaurant tenant improvement",
  address: "100 Main St",
  city: "Washington",
  state: "DC",
  zip_code: "20001",
};

function verifiedLoadSummary(overrides = {}) {
  return {
    calculated_values: {},
    verified_values: {
      connected_load_kw: {
        field_key: "connected_load_kw",
        value: 120,
        unit: "kW",
        method: "source_extracted_and_human_verified",
        approved_by: "user-1",
        approved_at: "2026-07-15T12:00:00.000Z",
        source_document_name: "panel.pdf",
        source_document_id: null,
        source_storage_path: "p",
        page_number: 1,
        evidence_text: "connected load 120 KW",
        extraction_method: "pdf_text",
        edited: false,
        review_note: null,
        original_candidate_id: "c1",
        source_content_hash: "hash",
      },
      service_voltage: {
        field_key: "service_voltage",
        value: 480,
        unit: "V",
        method: "source_extracted_and_human_verified",
        approved_by: "user-1",
        approved_at: "2026-07-15T12:00:00.000Z",
        source_document_name: "panel.pdf",
        source_document_id: null,
        source_storage_path: "p",
        page_number: 1,
        evidence_text: "480 V",
        extraction_method: "pdf_text",
        edited: false,
        review_note: null,
        original_candidate_id: "c2",
        source_content_hash: "hash",
      },
    },
    ...overrides,
  };
}

function reviewedPepcoApplication(overrides = {}) {
  return {
    id: "app-pkg-pepco",
    application_type: "new_service",
    provider_slug: "pepco",
    package_documents: [
      {
        key: "site_plan",
        label: "Site plan",
        status: "attached",
        project_document_id: "doc-1",
        file_name: "site.pdf",
        document_type: "site_plan",
      },
      {
        key: "single_line_diagram",
        label: "Single-line diagram",
        status: "attached",
        project_document_id: "doc-2",
        file_name: "single-line.pdf",
        document_type: "single_line_diagram",
      },
      {
        key: "equipment_cut_sheets",
        label: "Equipment cut sheets",
        status: "attached",
        project_document_id: "doc-3",
        file_name: "cuts.pdf",
        document_type: "equipment_cut_sheet",
      },
      {
        key: "letter_of_authorization",
        label: "Letter of authorization",
        status: "attached",
        project_document_id: "doc-4",
        file_name: "loa.pdf",
        document_type: "letter_of_authorization",
      },
    ],
    load_summary: verifiedLoadSummary(),
    ...overrides,
  };
}

describe("UCI D4 PEPCO submission adapter", () => {
  const originalLiveFlag = process.env.UCI_PEPCO_LIVE_SUBMISSION_ENABLED;

  after(() => {
    if (originalLiveFlag === undefined) {
      delete process.env.UCI_PEPCO_LIVE_SUBMISSION_ENABLED;
    } else {
      process.env.UCI_PEPCO_LIVE_SUBMISSION_ENABLED = originalLiveFlag;
    }
  });

  it("defaults live submission flag to false", () => {
    delete process.env.UCI_PEPCO_LIVE_SUBMISSION_ENABLED;
    assert.equal(isPepcoLiveSubmissionEnabled(), false);
  });

  it("maps application fields and attachments from reviewed package", () => {
    const prepared = preparePepcoSubmissionContext({
      application: reviewedPepcoApplication(),
      project: BASE_PROJECT,
    });
    assert.equal(prepared.ok, true);
    assert.equal(prepared.context.ready, true);
    assert.ok(prepared.context.fields.some((f) => f.key === "project_address" && f.present));
    assert.ok(prepared.context.attachments.every((a) => a.status === "attached"));
  });

  it("returns validation errors for missing fields and attachments", () => {
    const dryRun = runPepcoValidationDryRun({
      application: reviewedPepcoApplication({
        package_documents: [],
        load_summary: { calculated_values: {}, verified_values: {} },
      }),
      project: { ...BASE_PROJECT, address: "", project_type: null },
    });
    assert.equal(dryRun.status, "human_required");
    assert.ok(dryRun.validation_errors.length > 0);
    assert.ok(dryRun.missing_fields.includes("connected_load_data"));
    assert.ok(dryRun.missing_attachments.length > 0);
  });

  it("uses stored package address snapshot when project.address is empty", () => {
    const application = reviewedPepcoApplication({
      agent_draft_metadata: {
        application_package: {
          project_address: {
            formatted: "200 Sheridan Rd NW, Washington DC",
            source: "portal_data_location",
            complete: false,
            fallback_used: true,
          },
        },
      },
    });
    const prepared = preparePepcoSubmissionContext({
      application,
      project: { ...BASE_PROJECT, address: "", city: "", state: "", zip_code: "" },
    });
    assert.equal(prepared.ok, true);
    const addressField = prepared.context.fields.find((f) => f.key === "project_address");
    assert.equal(addressField?.present, true);
    assert.equal(addressField?.value, "200 Sheridan Rd NW, Washington DC");
  });

  it("dry run stops before final submit on mocked Playwright page", async () => {
    delete process.env.UCI_PEPCO_LIVE_SUBMISSION_ENABLED;
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.setContent(FORM_FIXTURE);
      const outcome = await runPepcoPortalSubmissionOnPage({
        page,
        application: reviewedPepcoApplication(),
        project: BASE_PROJECT,
        liveSubmissionConfirmed: false,
        uploadFn: async () => ({ ok: true }),
      });
      assert.equal(outcome.status, "human_required");
      assert.equal(outcome.final_submit_clicked, false);
      assert.ok(outcome.populated_fields.length > 0);
      assert.ok(outcome.evidence?.html?.includes("pepco-project-address"));
    } finally {
      await browser.close();
    }
  });

  it("does not click final submit when live flag is off even if user confirms", async () => {
    delete process.env.UCI_PEPCO_LIVE_SUBMISSION_ENABLED;
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.setContent(FORM_FIXTURE);
      const outcome = await runPepcoPortalSubmissionOnPage({
        page,
        application: reviewedPepcoApplication(),
        project: BASE_PROJECT,
        liveSubmissionConfirmed: true,
        uploadFn: async () => ({ ok: true }),
      });
      assert.equal(outcome.final_submit_clicked, false);
      assert.equal(outcome.status, "human_required");
    } finally {
      await browser.close();
    }
  });

  it("captures confirmation when live submit enabled on mocked confirmation page", async () => {
    process.env.UCI_PEPCO_LIVE_SUBMISSION_ENABLED = "true";
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.setContent(CONFIRMATION_FIXTURE);
      const confirmation = await extractPepcoConfirmation(page, "#pepco-confirmation-ticket");
      assert.equal(confirmation.ticket_number, "PEPCO-TKT-2026-00042");
      assert.equal(confirmation.application_reference, "APP-UUID-TEST-001");
    } finally {
      await browser.close();
    }
  });

  it("captures screenshot/HTML evidence during populate dry run", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.setContent(FORM_FIXTURE);
      const outcome = await runPepcoPortalSubmissionOnPage({
        page,
        application: reviewedPepcoApplication(),
        project: BASE_PROJECT,
        uploadFn: async () => ({ ok: true }),
      });
      assert.ok(outcome.evidence?.html);
      assert.ok(outcome.evidence?.screenshot_base64);
      assert.ok(outcome.evidence?.captured_at);
    } finally {
      await browser.close();
    }
  });
});
