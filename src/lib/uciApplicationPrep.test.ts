import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applicationPackageStatusTone,
  canSubmitApplication,
  formatApplicationPackageStatus,
  formatDraftStatus,
  formatPackageFieldProvenance,
  formatPackageDocumentSource,
  formatSuggestionConfidence,
  getApplicationPackageDraftApplication,
  getPackageFieldSourceHref,
  parseApplicationPackageMetadata,
  parsePackageDocuments,
  summarizePackageReview,
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
    assert.equal(
      formatPackageFieldProvenance({
        key: "project_address",
        label: "Project address",
        status: "present",
        source: "project.address",
      }),
      "Project record",
    );
    assert.equal(
      formatPackageFieldProvenance({
        key: "connected_load_kva",
        label: "Connected load",
        status: "present",
        source: "load_summary.verified_values.connected_load_kva",
        value: {
          value: 410,
          unit: "kVA",
          source_document_name: "01_Synthetic_Load_Letter.pdf",
          page_number: 1,
        },
      }),
      "Load Profile Analyzer — Verified Input · 01_Synthetic_Load_Letter.pdf · page 1",
    );
  });

  it("builds an exact verified-input deep link with return context", () => {
    const href = getPackageFieldSourceHref(
      {
        key: "connected_load_kw",
        label: "Connected load",
        status: "present",
        source: "load_summary.verified_values.connected_load_kw",
        value: {
          original_candidate_id: "candidate-7",
          source_document_id: "document-4",
          value: 125,
        },
      },
      {
        coordinationId: "coord-1",
        applicationId: "package-1",
        projectId: "project-1",
      },
    );
    assert.ok(href);
    assert.match(href, /section=verified_inputs/);
    assert.match(href, /field_key=connected_load_kw/);
    assert.match(href, /verified_value_id=candidate-7/);
    assert.match(href, /source_document_id=document-4/);
    assert.match(href, /return_to=/);
    assert.match(href, /#verified-input-connected_load_kw$/);
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

  it("derives ready for final review only from matching item snapshots", () => {
    const fieldSnapshot = {
      key: "connected_load_kva",
      label: "Connected load",
      status: "present",
      value: { value: 410, unit: "kVA" },
      source: "load_summary.verified_values.connected_load_kva",
      address_source: null,
    };
    const documentSnapshot = {
      key: "load_letter",
      label: "Load letter",
      status: "attached",
      file_name: "load.pdf",
      source: "project_documents",
      project_document_id: "doc-1",
      external_application_id: null,
      storage_path: null,
      content_hash: null,
      signature_required: false,
      signature_status: null,
      signature_verified_at: null,
    };
    const metadata = {
      package_status: "ready_for_review" as const,
      field_results: [fieldSnapshot],
      package_review: {
        items: {
          "field:connected_load_kva": {
            status: "confirmed" as const,
            mapping_snapshot: Object.fromEntries(
              Object.entries(fieldSnapshot).sort(([left], [right]) =>
                right.localeCompare(left),
              ),
            ),
          },
          "document:load_letter": {
            status: "confirmed" as const,
            mapping_snapshot: Object.fromEntries(
              Object.entries(documentSnapshot).sort(([left], [right]) =>
                right.localeCompare(left),
              ),
            ),
          },
        },
        package_correction: {
          active: false,
          note: null as string | null,
        },
      },
    };
    const documents = parsePackageDocuments([
      {
        key: "load_letter",
        label: "Load letter",
        status: "attached",
        file_name: "load.pdf",
        source: "project_documents",
        project_document_id: "doc-1",
      },
    ]);
    const readySummary = summarizePackageReview(metadata, documents, "draft");
    assert.equal(readySummary.status, "ready_for_review");
    assert.equal(readySummary.readyForFinalReview, true);
    metadata.package_review.package_correction = {
      active: true,
      note: "Historical reopen reason",
    };
    const staleFlagSummary = summarizePackageReview(metadata, documents, "needs_changes");
    assert.equal(staleFlagSummary.activeCorrectionCount, 0);
    assert.equal(staleFlagSummary.status, "ready_for_review");
    assert.equal(staleFlagSummary.readyForFinalReview, true);
    documents[0].file_name = "replacement.pdf";
    const changedSummary = summarizePackageReview(metadata, documents, "draft");
    assert.equal(changedSummary.status, "needs_changes");
    assert.equal(changedSummary.readyForFinalReview, false);
    assert.equal(changedSummary.documents[0].reviewStatus, "ready_for_re_review");
  });
});
