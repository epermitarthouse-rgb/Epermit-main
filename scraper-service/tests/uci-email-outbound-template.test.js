"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildUtilitySubmissionEmailContent,
  SYNTHETIC_BODY_WARNING,
  SYNTHETIC_SUBJECT_PREFIX,
} = require("../app/services/uci/uci-email-submission.service.js");
const {
  formatUciPackageVersionLabel,
  formatUciCapabilityLabel,
} = require("../app/services/uci/uci-capability-labels.js");
const { ensureSyntheticSubject, ensureSyntheticBody } = require("../app/services/uci/uci-submission-transmission.service.js");

function highlandApp(overrides = {}) {
  return {
    application_type: "new_service",
    provider_slug: "dominion",
    package_documents: [
      { key: "a", status: "attached", file_name: "a.pdf" },
      { key: "b", status: "attached", file_name: "b.pdf" },
      { key: "c", status: "attached", file_name: "c.pdf" },
      { key: "d", status: "attached", file_name: "d.pdf" },
      { key: "e", status: "attached", file_name: "e.pdf" },
      { key: "f", status: "attached", file_name: "f.pdf" },
    ],
    agent_draft_metadata: {
      application_package: {
        checklist_mode: "synthetic_test",
        authoritative_requirements: false,
        project_address: {
          formatted: "301 S Airport Dr, Highland Springs, VA 23075",
          complete: true,
          source: "structured",
        },
      },
    },
    ...overrides,
  };
}

const highlandProject = {
  id: "proj-1",
  name: "McDonald's Highland Springs, VA - LC 451497",
};

describe("uci outbound email template", () => {
  it("formats capability / package labels without Agent N", () => {
    assert.equal(
      formatUciPackageVersionLabel("agent-3-reviewed-package-snapshot-v1"),
      "Application Builder · Reviewed package v1",
    );
    assert.equal(formatUciCapabilityLabel("Agent 4"), "Submission and Confirmation Tracker");
  });

  it("builds a clean synthetic Highland-like body", () => {
    const content = buildUtilitySubmissionEmailContent(
      highlandApp(),
      highlandProject,
      "dominion",
      {
        attachmentCount: 6,
        packageSnapshotVersion: "agent-3-reviewed-package-snapshot-v1",
      },
    );

    assert.equal(
      content.subject,
      `${SYNTHETIC_SUBJECT_PREFIX} Utility Coordination Application Package — McDonald's Highland Springs, VA - LC 451497`,
    );
    assert.match(content.body, /^Hello,/);
    assert.match(content.body, /Please find attached the utility coordination application package/);
    assert.match(content.body, /Application type: New service/);
    assert.match(content.body, /Attachments: 6/);
    assert.match(content.body, new RegExp(SYNTHETIC_BODY_WARNING));
    assert.match(content.body, /SYNTHETIC TEST — NO EXTERNAL SUBMISSION/);
    assert.match(content.body, /Regards,\nCommun-ET$/);
    assert.doesNotMatch(content.body, /agent-3-reviewed-package-snapshot-v1/);
    assert.doesNotMatch(content.body, /Sending is not enabled/);
    assert.doesNotMatch(content.body, /prepared by the UCI/);
    assert.doesNotMatch(content.body, /Exact attachments/);
    assert.doesNotMatch(content.body, /site\.pdf|Synthetic_Load/);
    assert.equal(
      content.audit.package_version_label,
      "Application Builder · Reviewed package v1",
    );
  });

  it("omits synthetic warning for production packages", () => {
    const content = buildUtilitySubmissionEmailContent(
      highlandApp({
        agent_draft_metadata: {
          application_package: {
            checklist_mode: "production",
            authoritative_requirements: true,
            project_address: {
              formatted: "301 S Airport Dr, Highland Springs, VA 23075",
              complete: true,
              source: "structured",
            },
          },
        },
      }),
      highlandProject,
      "dominion",
      { attachmentCount: 3 },
    );
    assert.equal(
      content.subject,
      "Utility Coordination Application Package — McDonald's Highland Springs, VA - LC 451497",
    );
    assert.doesNotMatch(content.body, /synthetic test documents/i);
    assert.match(content.body, /Attachments: 3/);
  });

  it("transmission helpers do not reintroduce internal auth language", () => {
    const content = buildUtilitySubmissionEmailContent(
      highlandApp(),
      highlandProject,
      "dominion",
      { attachmentCount: 6 },
    );
    const app = highlandApp();
    const subject = ensureSyntheticSubject(content.subject, app);
    const body = ensureSyntheticBody(content.body, app);
    assert.equal(subject, content.subject);
    assert.equal(body, content.body);
    assert.doesNotMatch(body, /Internal controlled UAT/);
    assert.doesNotMatch(body, /NOT A PRODUCTION UTILITY SUBMISSION/);
  });
});
