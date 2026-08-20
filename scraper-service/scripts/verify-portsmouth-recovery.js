#!/usr/bin/env node
"use strict";

/**
 * Verify Portsmouth recovery path (inspect + optional mark-reviewed / prepare).
 *
 * Usage:
 *   node scripts/verify-portsmouth-recovery.js [--mark-reviewed] [--prepare] [--application-id=<uuid>]
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 * Does NOT transmit email.
 */

const { createClient } = require("@supabase/supabase-js");
const {
  reviewApplicationPackage,
  summarizePackageReview,
} = require("../app/services/uci/uci-package-review.service.js");
const { prepareSubmission } = require("../app/services/uci/uci-submission-prepare.service.js");

const DEFAULT_APPLICATION_ID = "5c2321ce-1f29-412d-a9ca-102ee543e02e";
const STALE_PREP_ID = "015b5b94-1621-4c53-b823-ec5e5839cc23";
const OPERATOR_USER_ID = process.env.UCI_RECOVERY_OPERATOR_USER_ID || null;

function parseArgs(argv) {
  const args = {
    applicationId: DEFAULT_APPLICATION_ID,
    markReviewed: false,
    prepare: false,
  };
  for (const arg of argv) {
    if (arg === "--mark-reviewed") args.markReviewed = true;
    else if (arg === "--prepare") args.prepare = true;
    else if (arg.startsWith("--application-id=")) {
      args.applicationId = arg.slice("--application-id=".length).trim();
    }
  }
  return args;
}

function worksheetUuid(documents) {
  const doc = (documents ?? []).find((row) => String(row.key) === "load_calculation_worksheet");
  return doc?.project_document_id ?? null;
}

async function loadApplication(supabase, applicationId) {
  const { data, error } = await supabase
    .from("coordination_applications")
    .select("*")
    .eq("id", applicationId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function loadPreparation(supabase, preparationId) {
  const { data, error } = await supabase
    .from("submission_preparations")
    .select("*")
    .eq("id", preparationId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let application = await loadApplication(supabase, args.applicationId);
  if (!application) {
    console.error(`Application not found: ${args.applicationId}`);
    process.exit(1);
  }

  const report = {
    application_id: application.id,
    draft_status_before: application.draft_status,
    reviewed_snapshot_worksheet_before: worksheetUuid(
      application.agent_draft_metadata?.application_package?.package_review?.reviewed_snapshot
        ?.package_documents,
    ),
    stale_prep_id: STALE_PREP_ID,
    stale_prep_status_before: null,
    mark_reviewed: null,
    draft_status_after: null,
    reviewed_snapshot_worksheet_after: null,
    stale_prep_status_after: null,
    new_prep_id: null,
    new_prep_worksheet_uuid: null,
  };

  const stalePrepBefore = await loadPreparation(supabase, STALE_PREP_ID);
  report.stale_prep_status_before = stalePrepBefore?.status ?? null;

  if (args.markReviewed) {
    if (!OPERATOR_USER_ID) {
      console.error("Set UCI_RECOVERY_OPERATOR_USER_ID to mark reviewed");
      process.exit(1);
    }
    const summaryBefore = summarizePackageReview(application);
    if (!summaryBefore.ready_for_final_review) {
      console.error("Package is not ready_for_final_review — confirm all items first");
      process.exit(1);
    }
    const result = await reviewApplicationPackage(supabase, {
      applicationId: application.id,
      application,
      userId: OPERATOR_USER_ID,
      review: { status: "reviewed", notes: "Portsmouth recovery verification" },
    });
    application = result.application;
    report.mark_reviewed = {
      review_status: result.review_status,
      package_review_status: result.package_review?.status ?? null,
    };
  }

  report.draft_status_after = application.draft_status;
  report.reviewed_snapshot_worksheet_after = worksheetUuid(
    application.agent_draft_metadata?.application_package?.package_review?.reviewed_snapshot
      ?.package_documents,
  );

  const stalePrepAfter = await loadPreparation(supabase, STALE_PREP_ID);
  report.stale_prep_status_after = stalePrepAfter?.status ?? null;

  if (args.prepare) {
    if (!OPERATOR_USER_ID) {
      console.error("Set UCI_RECOVERY_OPERATOR_USER_ID to prepare submission");
      process.exit(1);
    }
    if (String(application.draft_status) !== "reviewed") {
      console.error("Application must be reviewed before prepare");
      process.exit(1);
    }
    const prepared = await prepareSubmission(supabase, {
      applicationId: application.id,
      userId: OPERATOR_USER_ID,
      deps: {
        getMailboxStatusForUser: async () => ({
          connected: true,
          mailbox_email: "recovery-verify@commun-et.com",
          mail_send_permission_configured: false,
        }),
        getValidAccessTokenForUser: async () => "verify-token",
        fetchGraphMe: async () => ({
          mail: "recovery-verify@commun-et.com",
          userPrincipalName: "recovery-verify@commun-et.com",
        }),
      },
    });
    report.new_prep_id = prepared.preparation_id ?? null;
    report.new_prep_worksheet_uuid = worksheetUuid(
      (prepared.attachments ?? []).map((row) => ({
        key: row.key,
        project_document_id: row.project_document_id,
      })),
    );
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
