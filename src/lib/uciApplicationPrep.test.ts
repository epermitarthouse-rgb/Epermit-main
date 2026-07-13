import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applicationPackageStatusTone,
  canSubmitApplication,
  formatApplicationPackageStatus,
  formatDraftStatus,
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
});
