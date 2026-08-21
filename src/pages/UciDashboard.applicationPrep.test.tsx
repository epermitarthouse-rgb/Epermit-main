import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { CoordinationApplication, LifecycleState } from "@/types/uci";
import type { UciPackageDocumentCandidatesResponse } from "@/lib/uciApplicationPrep";
import { ApplicationPrepSection } from "./UciDashboard";

const coordinationId = "coordination-test";

function application(
  overrides: Partial<CoordinationApplication>,
): CoordinationApplication {
  return {
    id: "application-test",
    coordination_record_id: coordinationId,
    project_id: "project-test",
    application_type: null,
    package_documents: [],
    load_summary: {},
    submission_method: null,
    utility_ticket_number: null,
    submitted_at: null,
    submitted_by: null,
    reviewed_by: null,
    reviewed_at: null,
    draft_status: "draft",
    agent_draft_metadata: {},
    idempotency_key: null,
    last_error: null,
    provider_slug: "dominion",
    record_source: "agent_draft",
    created_at: "2026-08-17T00:00:00.000Z",
    updated_at: "2026-08-17T00:00:00.000Z",
    ...overrides,
  };
}

const loadProfile = application({
  id: "load-profile",
  idempotency_key: "agent_2_load_profile:test",
});

const packageApplication = application({
  id: "package-test",
  idempotency_key: "agent_3_application_package:test",
  package_documents: [
    {
      key: "authorization",
      label: "Authorization / LOA",
      status: "attached",
      file_name: "loa.pdf",
      source: "project_documents",
      project_document_id: "document-1",
      signature_required: true,
      signature_status: "signed_manual_verified",
      signature_review_note: "Compared with signed source",
      signature_verified_at: "2026-08-17T01:00:00.000Z",
    },
  ],
  agent_draft_metadata: {
    application_package: {
      package_status: "ready_for_review",
      checklist_mode: "synthetic_test",
      checklist_label: "SYNTHETIC TEST CHECKLIST",
      synthetic_checklist: { status: "approved" },
      field_results: [
        {
          key: "project_address",
          label: "Project address",
          status: "present",
          value: "100 Test Way",
          source: "project.address",
        },
      ],
      package_review: { items: {} },
    },
  },
});

const candidates: UciPackageDocumentCandidatesResponse = {
  coordination_record_id: coordinationId,
  project_id: "project-test",
  tenant_id: null,
  required_slots: [{ key: "authorization", label: "Authorization / LOA" }],
  candidates: [
    {
      candidate_id: "candidate-1",
      source_type: "project_document",
      project_id: "project-test",
      tenant_id: null,
      coordination_record_id: coordinationId,
      external_application_id: null,
      file_name: "replacement-loa.pdf",
      pepco_document_name: null,
      pepco_document_type: null,
      project_document_id: "document-2",
      document_type: "authorization",
      storage_bucket: null,
      storage_path: null,
      content_hash: null,
      idempotency_key: null,
      timestamp: null,
      suggested_package_slot: "authorization",
      confidence: "high",
      suggestion_reason: "Document type match",
    },
  ],
  suggestions_by_slot: {
    authorization: [
      {
        candidate_id: "candidate-1",
        source_type: "project_document",
        project_id: "project-test",
        tenant_id: null,
        coordination_record_id: coordinationId,
        external_application_id: null,
        file_name: "replacement-loa.pdf",
        pepco_document_name: null,
        pepco_document_type: null,
        project_document_id: "document-2",
        document_type: "authorization",
        storage_bucket: null,
        storage_path: null,
        content_hash: null,
        idempotency_key: null,
        timestamp: null,
        suggested_package_slot: "authorization",
        confidence: "high",
        suggestion_reason: "Document type match",
      },
    ],
  },
};

function renderApplicationPackage(options?: {
  editingDocumentSlot?: string | null;
  signatureStatus?: "unsigned" | "signed_manual_verified";
  canonicalAuthorizationStatus?: "confirmed" | "not_reviewed";
  stalePackageCorrection?: boolean;
  reviewed?: boolean;
}): string {
  const signatureStatus = options?.signatureStatus ?? "signed_manual_verified";
  const authorizationStatus = options?.canonicalAuthorizationStatus;
  const renderedPackage = {
    ...packageApplication,
    ...(options?.reviewed
      ? {
          draft_status: "reviewed" as const,
          reviewed_by: "reviewer-1",
          reviewed_at: "2026-08-17T02:00:00.000Z",
        }
      : {}),
    ...(options?.stalePackageCorrection ? { draft_status: "needs_changes" as const } : {}),
    ...(authorizationStatus
      ? {
          package_review_summary: {
            status: options?.reviewed ? "reviewed" : "ready_for_review",
            all_confirmed: authorizationStatus === "confirmed",
            ready_for_final_review: authorizationStatus === "confirmed",
            active_correction_count: 0,
            confirmed_count: authorizationStatus === "confirmed" ? 2 : 1,
            total_count: 2,
            items: [
              {
                id: "field:project_address",
                kind: "field",
                key: "project_address",
                status: "confirmed",
                ready: true,
                snapshot: {},
              },
              {
                id: "document:authorization",
                kind: "document",
                key: "authorization",
                status: authorizationStatus,
                ready: true,
                snapshot: {},
              },
            ],
          },
        }
      : {}),
    package_documents: [
      {
        ...(packageApplication.package_documents as Array<Record<string, unknown>>)[0],
        signature_status: signatureStatus,
        signature_review_note:
          signatureStatus === "signed_manual_verified"
            ? "Compared with signed source"
            : null,
        signature_verified_at:
          signatureStatus === "signed_manual_verified"
            ? "2026-08-17T01:00:00.000Z"
            : null,
      },
    ],
    agent_draft_metadata: options?.stalePackageCorrection
      ? {
          ...packageApplication.agent_draft_metadata,
          application_package: {
            ...(packageApplication.agent_draft_metadata.application_package as Record<
              string,
              unknown
            >),
            package_review: {
              items: {},
              package_correction: {
                active: true,
                note: "Historical reopen reason",
              },
            },
          },
        }
      : packageApplication.agent_draft_metadata,
  };
  return renderToStaticMarkup(
    createElement(ApplicationPrepSection, {
      coordinationId,
      coordinationRecord: {
        id: coordinationId,
        project_id: "project-test",
        current_stage: 3,
        current_stage_state: "IN_PROGRESS",
      } as import("@/types/uci").CoordinationRecord,
      selectedPepcoApplicationId: null,
      selectedPepcoApplicationTitle: null,
      applications: [loadProfile, renderedPackage],
      formatWhen: (value) => value ?? "—",
      mutedClass: "muted",
      sectionTitleClass: "",
      toolbarOutlineButtonClass: "",
      prepBusy: false,
      repairBusy: false,
      reviewBusy: false,
      submitBusy: false,
      stage2CompletionBusy: false,
      currentStage: 3,
      currentStageState: "IN_PROGRESS" as LifecycleState,
      reviewNotes: "",
      onReviewNotesChange: () => undefined,
      onBuild: () => undefined,
      onRepair: () => undefined,
      onReview: () => undefined,
      onSubmit: () => undefined,
      onCompleteStage2: () => undefined,
      onApplicationMutation: () => undefined,
      onRefreshDetail: async () => undefined,
      initialEditingDocumentSlot: options?.editingDocumentSlot ?? null,
      initialDocumentCandidates: candidates,
    }),
  );
}

describe("ApplicationPrepSection render regression", () => {
  it("renders the normal Agent 3 review without legacy document duplicates", () => {
    const html = renderApplicationPackage();
    assert.match(html, /Application fields/);
    assert.match(html, /Required documents/);
    assert.match(html, /Signed ✓/);
    assert.match(html, /Mark unsigned/);
    assert.match(html, /Signature history/);
    assert.match(html, /Project record/);
    assert.doesNotMatch(html, /View technical provenance/);
    assert.doesNotMatch(html, /project\.address/);
    assert.doesNotMatch(html, /Document mapping \(human confirmation required\)/);
    assert.doesNotMatch(html, /Package documents \(/);
  });

  it("routes project-backed fields to the exact project correction surface", () => {
    const html = renderApplicationPackage();
    assert.match(html, /Open project field/);
    assert.match(html, /\/projects\?project=project-test&amp;mode=edit&amp;field=address/);
    assert.match(html, /Request change/);
  });

  it("renders unsigned and signed mutation states without requiring a refetch", () => {
    const unsignedHtml = renderApplicationPackage({ signatureStatus: "unsigned" });
    assert.match(unsignedHtml, /Unsigned — action required/);
    assert.match(unsignedHtml, /Mark signed/);
    assert.doesNotMatch(unsignedHtml, /Mark unsigned/);

    const signedHtml = renderApplicationPackage({
      signatureStatus: "signed_manual_verified",
    });
    assert.match(signedHtml, /Signed ✓/);
    assert.match(signedHtml, /Mark unsigned/);
    assert.doesNotMatch(signedHtml, /Mark signed/);
  });

  it("renders the document change editor inside the required document row", () => {
    const html = renderApplicationPackage({ editingDocumentSlot: "authorization" });
    assert.match(html, /Change mapped document/);
    assert.match(html, /replacement-loa\.pdf/);
    assert.match(html, /Apply mapping/);
    assert.match(html, /Cancel/);
  });

  it("uses canonical backend readiness and names the blocking requirement", () => {
    const html = renderApplicationPackage({ canonicalAuthorizationStatus: "not_reviewed" });
    assert.match(html, /Final review blockers/);
    assert.match(html, /Authorization \/ LOA ·.*Not reviewed/);
    assert.match(html, /<button[^>]*disabled[^>]*>.*Mark package reviewed/s);
    assert.doesNotMatch(html, /All required mappings are confirmed/);
  });

  it("does not render an empty correction table or phantom blocker from stale flags", () => {
    const html = renderApplicationPackage({
      canonicalAuthorizationStatus: "confirmed",
      stalePackageCorrection: true,
    });
    assert.match(html, /Ready for review/);
    assert.doesNotMatch(html, /Package needs changes/);
    assert.doesNotMatch(html, /Resolve the active package-level correction/);
    assert.doesNotMatch(html, /Final review blockers/);
  });

  it("renders a clean reviewed state without stale or repeated actions", () => {
    const html = renderApplicationPackage({
      canonicalAuthorizationStatus: "confirmed",
      reviewed: true,
    });
    assert.match(html, /Reviewed package ✓/);
    assert.match(html, /Test checklist approved ✓/);
    assert.doesNotMatch(html, /Approve synthetic checklist/);
    assert.doesNotMatch(html, /Snapshot locked/);
    assert.match(html, /Reopen review/);
  });

  it("routes production package signature updates through the generic API", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "UciDashboard.tsx"),
      "utf8",
    );
    const start = source.indexOf("const handleSignatureStatus = async");
    assert.ok(start >= 0);
    const block = source.slice(start, start + 1800);
    assert.doesNotMatch(block, /if \(!packageApp \|\| !isDominionSynthetic\) return;/);
    assert.match(block, /setApplicationPackageSignatureStatus/);
    assert.match(block, /isDominionSynthetic/);
    assert.match(block, /setSyntheticApplicationSignatureStatus/);
  });
});
