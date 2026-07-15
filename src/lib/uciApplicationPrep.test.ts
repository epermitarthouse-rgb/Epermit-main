import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applicationPackageStatusTone,
  canSubmitApplication,
  formatApplicationPackageStatus,
  formatDraftStatus,
  formatPackageDocumentSource,
  formatSuggestionConfidence,
  getApplicationPackageDraftApplication,
  parseApplicationPackageMetadata,
  parsePackageDocuments,
} from "./uciApplicationPrep";

describe("uciApplicationPrep helpers", () => {
  it("returns null when no application package draft exists", () => {
    assert.equal(getApplicationPackageDraftApplication([]), null);
    assert.equal(parseApplicationPackageMetadata(null), null);
    assert.equal(applicationPackageStatusTone(undefined), "neutral");
    assert.equal(formatApplicationPackageStatus(undefined), "Not prepared");
  });

  it("parses incomplete package draft with missing documents", () => {
    const app = {
      id: "app-1",
      record_source: "agent_draft",
      idempotency_key: "agent_3_application_package:d3-v1",
      draft_status: "draft",
      package_documents: [
        { key: "site_plan", label: "Site plan", status: "attached", file_name: "site.pdf" },
        { key: "loa", label: "LOA", status: "missing" },
      ],
      agent_draft_metadata: {
        application_package: {
          package_status: "incomplete",
          missing_documents: ["letter_of_authorization"],
          missing_fields: ["connected_load_data"],
          requires_human_review: true,
        },
      },
    };

    assert.equal(getApplicationPackageDraftApplication([app])?.id, "app-1");
    const meta = parseApplicationPackageMetadata(app);
    assert.equal(meta?.package_status, "incomplete");
    assert.equal(applicationPackageStatusTone("incomplete"), "warning");
    assert.match(formatApplicationPackageStatus("incomplete"), /Incomplete/i);

    const docs = parsePackageDocuments(app.package_documents);
    assert.equal(docs.length, 2);
    assert.equal(docs[0].status, "attached");
    assert.equal(docs[1].status, "missing");
  });

  it("gates submit until reviewed and formats draft status", () => {
    assert.equal(canSubmitApplication("draft"), false);
    assert.equal(canSubmitApplication("reviewed"), true);
    assert.equal(formatDraftStatus("needs_changes"), "Needs changes");
  });

  it("formats package document source and suggestion confidence labels", () => {
    assert.equal(formatPackageDocumentSource("pepco_portal"), "PEPCO portal");
    assert.equal(formatPackageDocumentSource("project_documents"), "PermitPilot upload");
    assert.match(formatSuggestionConfidence("high"), /suggested only/i);
  });

  it("parses confirmed PEPCO portal package document fields", () => {
    const docs = parsePackageDocuments([
      {
        key: "single_line_diagram",
        status: "attached",
        source: "pepco_portal",
        user_confirmed: true,
        file_name: "E601.pdf",
        idempotency_key: "pepco:e601",
      },
    ]);
    assert.equal(docs[0].user_confirmed, true);
    assert.equal(docs[0].source, "pepco_portal");
    assert.equal(docs[0].idempotency_key, "pepco:e601");
  });

  it("parses package metadata project_address snapshot", () => {
    const app = {
      record_source: "agent_draft",
      idempotency_key: "agent_3_application_package:d3-v1",
      agent_draft_metadata: {
        application_package: {
          package_status: "incomplete",
          project_address: {
            formatted: "200 Sheridan Rd NW, Washington DC",
            source: "portal_data_location",
          },
          address_mismatch: false,
        },
      },
    };
    const meta = parseApplicationPackageMetadata(app);
    assert.equal(meta?.project_address?.formatted, "200 Sheridan Rd NW, Washington DC");
    assert.equal(meta?.project_address?.source, "portal_data_location");
  });
});
