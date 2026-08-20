"use strict";

/**
 * Stage 4 P1 — Prepare → Preview → Confirm (email).
 * Never calls Graph sendMail. Never sets submitted_at / Stage 5.
 * From = per-user connected Microsoft mailbox (not hardcoded Permitting@).
 */

const crypto = require("crypto");
const {
  getApplicationById,
} = require("./uci-application-builder.service.js");
const {
  validateSubmissionValidationEligibility,
  collectAttachments,
  isDominionSyntheticPackage,
  NO_SIDE_EFFECTS,
  validateAttachmentDocumentReferences,
  assertAttachmentDocumentReferences,
} = require("./uci-submission-validation.service.js");
const {
  getMailboxStatusForUser,
  scopesIncludeMailSend,
} = require("../microsoft/microsoft-mailbox.service.js");
const {
  getValidAccessTokenForUser,
  fetchGraphMe,
  primaryMailboxFromMe,
} = require("../microsoft/microsoft-graph-auth.service.js");
const { buildUtilitySubmissionEmailContent, isSyntheticOutboundPackage } = require("./uci-email-submission.service.js");

const PREPARE_VERSION = "stage4-prepare-p1-v1";
const CAPABILITY = "Submission and Confirmation Tracker";
const CONFIRMATION_MESSAGE = "Confirmed for transmission — sending not enabled";
const CONFIRMATION_READY_MESSAGE = "Confirmed for transmission — ready to send";
const MAIL_SEND_PERMISSION_BLOCKER =
  "Email sending unavailable — Microsoft Mail.Send permission required";
const LIVE_EMAIL_DISABLED_BLOCKER =
  "Live email submission is disabled — set UCI_EMAIL_LIVE_SUBMISSION_ENABLED=true after explicit approval";

/**
 * Live Graph email send gate. Default OFF.
 * Prepare/confirm never call sendMail — transmission uses a separate explicit path.
 */
function isUciEmailLiveSubmissionEnabled() {
  return process.env.UCI_EMAIL_LIVE_SUBMISSION_ENABLED === "true";
}

/**
 * Build readiness from live flag + real Mail.Send capability (not hardcoded).
 * @param {{ liveFlag?: boolean, mailSendConfigured?: boolean }} parts
 */
function emailProductionReadinessFromParts(parts = {}) {
  const liveFlag =
    typeof parts.liveFlag === "boolean" ? parts.liveFlag : isUciEmailLiveSubmissionEnabled();
  const mailSendConfigured = parts.mailSendConfigured === true;
  const readyToSend = liveFlag === true && mailSendConfigured === true;
  let productionReadinessBlocker = null;
  if (!readyToSend) {
    productionReadinessBlocker = !mailSendConfigured
      ? MAIL_SEND_PERMISSION_BLOCKER
      : LIVE_EMAIL_DISABLED_BLOCKER;
  }
  return {
    live_email_flag_enabled: liveFlag,
    mail_send_permission_configured: mailSendConfigured,
    ready_to_send: readyToSend,
    production_readiness_blocker: productionReadinessBlocker,
    sending_enabled: readyToSend,
  };
}

/**
 * Resolve Mail.Send from microsoft_mailbox_connections.scopes (or deps override).
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string | null | undefined} userId
 * @param {Record<string, unknown>} [deps]
 */
async function resolveMailSendPermissionConfigured(supabase, userId, deps = {}) {
  if (typeof deps.mailSendPermissionConfigured === "boolean") {
    return deps.mailSendPermissionConfigured;
  }
  if (typeof deps.getMailSendPermissionConfigured === "function") {
    return Boolean(await deps.getMailSendPermissionConfigured(supabase, userId));
  }
  if (!userId) return false;
  const getStatus =
    typeof deps.getMailboxStatusForUser === "function"
      ? deps.getMailboxStatusForUser
      : getMailboxStatusForUser;
  try {
    const status = await getStatus(supabase, String(userId));
    if (typeof status?.mail_send_permission_configured === "boolean") {
      return status.mail_send_permission_configured === true && status.connected === true;
    }
    return status?.connected === true && scopesIncludeMailSend(status?.scopes);
  } catch {
    return false;
  }
}

/**
 * Real mailbox capability + separate live-send safety gate.
 * @param {import("@supabase/supabase-js").SupabaseClient | null} [supabase]
 * @param {string | null} [userId]
 * @param {Record<string, unknown>} [deps]
 */
async function emailProductionReadiness(supabase = null, userId = null, deps = {}) {
  const liveFlag = isUciEmailLiveSubmissionEnabled();
  const mailSendConfigured =
    supabase && userId
      ? await resolveMailSendPermissionConfigured(supabase, userId, deps)
      : typeof deps.mailSendPermissionConfigured === "boolean"
        ? deps.mailSendPermissionConfigured
        : false;
  return emailProductionReadinessFromParts({ liveFlag, mailSendConfigured });
}

function isPostgrestSchemaCacheMiss(error) {
  const msg = String(error?.message || error || "");
  return /schema cache|Could not find the table/i.test(msg);
}

function isMissingRelationError(error) {
  const msg = String(error?.message || error || "");
  const code = String(error?.code || "");
  return (
    code === "42P01" ||
    /does not exist|relation .* not found|Could not find the table/i.test(msg)
  );
}

/**
 * Insert into submission_preparations; retry once on PostgREST schema-cache lag.
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {Record<string, unknown>} insertRow
 */
async function insertPreparationRow(supabase, insertRow) {
  let result = await supabase
    .from("submission_preparations")
    .insert(insertRow)
    .select("*")
    .single();
  if (result.error && isPostgrestSchemaCacheMiss(result.error)) {
    await new Promise((r) => setTimeout(r, 750));
    result = await supabase
      .from("submission_preparations")
      .insert(insertRow)
      .select("*")
      .single();
  }
  return result;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function parseEmailAllowlist(raw) {
  return parseRecipientList(raw).map((item) => normalizeEmail(item.email)).filter(Boolean);
}

function getAllowedSenderMailboxes() {
  return parseEmailAllowlist(process.env.UCI_EMAIL_ALLOWED_SENDERS);
}

function getAllowedRecipientAddresses() {
  return parseEmailAllowlist(process.env.UCI_EMAIL_ALLOWED_RECIPIENTS);
}

/**
 * Live send may only use documented test mailboxes. Empty allowlists fail closed.
 * @param {{ sender?: string, recipients?: Array<{ email?: string } | string> }} params
 */
function assertLiveEmailAllowlists(params = {}) {
  const sender = normalizeEmail(params.sender);
  const recipients = (Array.isArray(params.recipients) ? params.recipients : [])
    .map((item) => normalizeEmail(typeof item === "string" ? item : item?.email))
    .filter(Boolean);
  const allowedSenders = getAllowedSenderMailboxes();
  const allowedRecipients = getAllowedRecipientAddresses();

  if (allowedSenders.length === 0) {
    const err = new Error(
      "Live email send requires UCI_EMAIL_ALLOWED_SENDERS (test mailboxes only; no utility inboxes)",
    );
    err.statusCode = 403;
    err.code = "SENDER_ALLOWLIST_REQUIRED";
    throw err;
  }
  if (allowedRecipients.length === 0) {
    const err = new Error(
      "Live email send requires UCI_EMAIL_ALLOWED_RECIPIENTS (test addresses only; no utility inboxes)",
    );
    err.statusCode = 403;
    err.code = "RECIPIENT_ALLOWLIST_REQUIRED";
    throw err;
  }
  if (!sender || !allowedSenders.includes(sender)) {
    const err = new Error("Sender mailbox is not on the approved test allowlist");
    err.statusCode = 403;
    err.code = "SENDER_NOT_ALLOWED";
    throw err;
  }
  if (recipients.length === 0) {
    const err = new Error("Recipient address required for transmission");
    err.statusCode = 400;
    err.code = "RECIPIENT_REQUIRED";
    throw err;
  }
  const blocked = recipients.filter((email) => !allowedRecipients.includes(email));
  if (blocked.length) {
    const err = new Error("Recipient is not on the approved test allowlist");
    err.statusCode = 403;
    err.code = "RECIPIENT_NOT_ALLOWED";
    throw err;
  }
}

function parseRecipientList(raw) {
  if (raw == null) return [];
  const list = Array.isArray(raw)
    ? raw
    : String(raw)
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const email =
      typeof item === "string"
        ? item.trim()
        : item && typeof item === "object" && item.email
          ? String(item.email).trim()
          : "";
    const n = normalizeEmail(email);
    if (!n || !n.includes("@") || seen.has(n)) continue;
    seen.add(n);
    out.push({ email: email.includes("@") ? email.trim() : n });
  }
  return out;
}

function snapshotBindings(reviewSummary, application) {
  const snapshot = asObject(reviewSummary.reviewed_snapshot);
  const packageSnapshotId =
    snapshot.id != null
      ? String(snapshot.id)
      : snapshot.snapshot_id != null
        ? String(snapshot.snapshot_id)
        : `reviewed:${application.id}:${snapshot.captured_at ?? "unknown"}`;
  const packageSnapshotVersion =
    snapshot.snapshot_version != null
      ? String(snapshot.snapshot_version)
      : "agent-3-reviewed-package-snapshot-v1";
  const attachments = collectAttachments(application, reviewSummary);
  return {
    package_snapshot_id: packageSnapshotId,
    package_snapshot_version: packageSnapshotVersion,
    package_snapshot_captured_at: snapshot.captured_at ?? null,
    attachments,
    reviewed_by_user_id: reviewSummary.reviewed_by_user_id ?? null,
    reviewer_display: reviewSummary.reviewer_display ?? null,
    reviewed_at: reviewSummary.reviewed_at ?? null,
    field_count: Array.isArray(snapshot.fields) ? snapshot.fields.length : null,
    document_count: attachments.length,
  };
}

/**
 * Resolve From mailbox from per-user connection and verify Graph /me identity.
 * Does NOT call sendMail.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} userId
 * @param {Record<string, unknown>} [deps]
 */
async function resolveConnectedSenderMailbox(supabase, userId, deps = {}) {
  const getStatus =
    typeof deps.getMailboxStatusForUser === "function"
      ? deps.getMailboxStatusForUser
      : getMailboxStatusForUser;
  const getToken =
    typeof deps.getValidAccessTokenForUser === "function"
      ? deps.getValidAccessTokenForUser
      : getValidAccessTokenForUser;
  const fetchMe =
    typeof deps.fetchGraphMe === "function" ? deps.fetchGraphMe : fetchGraphMe;

  const status = await getStatus(supabase, userId);
  if (!status.connected || !status.mailbox_email) {
    const err = new Error(
      "Connect your Microsoft Outlook mailbox in Settings before preparing an email submission.",
    );
    err.statusCode = 400;
    err.code = "CONNECT_OUTLOOK";
    err.details = { connect_outlook: true, action: "Connect Outlook" };
    throw err;
  }

  const stored = normalizeEmail(status.mailbox_email);
  let liveMailbox = null;
  let graphIdentityChecked = false;

  try {
    const accessToken = await getToken(supabase, userId);
    const me = await fetchMe(accessToken);
    liveMailbox = primaryMailboxFromMe(me);
    graphIdentityChecked = true;
  } catch (inner) {
    const err = new Error(
      "Could not verify your connected Microsoft mailbox identity. Reconnect Outlook in Settings.",
    );
    err.statusCode = 400;
    err.code = "MAILBOX_IDENTITY_UNVERIFIED";
    err.details = {
      connect_outlook: true,
      action: "Connect Outlook",
      cause: inner instanceof Error ? inner.message : String(inner),
    };
    throw err;
  }

  if (!liveMailbox || normalizeEmail(liveMailbox) !== stored) {
    const err = new Error(
      "Connected mailbox does not match the signed-in Microsoft account. Reconnect Outlook in Settings.",
    );
    err.statusCode = 400;
    err.code = "MAILBOX_IDENTITY_MISMATCH";
    err.details = {
      connect_outlook: true,
      action: "Connect Outlook",
      stored_mailbox: status.mailbox_email,
      // Do not expose full live identity mismatch details beyond code for privacy in UI.
    };
    throw err;
  }

  return {
    sender_mailbox: String(status.mailbox_email).trim(),
    sender_mailbox_verified: graphIdentityChecked === true,
    graph_identity_checked: true,
    // Identity check uses Graph /me only — never sendMail.
    graph_me_called: true,
    graph_send_mail_called: false,
  };
}

function buildEmailDraft(application, project, providerSlug, bindings) {
  // Same canonical template as Graph MIME/body builder (preview === send content).
  // Prefer snapshot attachment count so we do not advertise live-only docs.
  const attachmentCount = Array.isArray(bindings.attachments) ? bindings.attachments.length : 0;
  const content = buildUtilitySubmissionEmailContent(application, project, providerSlug, {
    attachmentCount,
    synthetic:
      isDominionSyntheticPackage(application) || isSyntheticOutboundPackage(application),
    packageSnapshotVersion: bindings.package_snapshot_version ?? null,
  });

  return {
    subject: content.subject,
    body: content.body,
    template_version: content.template_version,
    audit: content.audit,
  };
}

function sideEffectsBase(extra = {}) {
  return {
    ...NO_SIDE_EFFECTS,
    graph_called: extra.graph_me_called === true,
    graph_send_mail_called: false,
    email_sent: false,
    portal_touched: false,
    live_submission_attempted: false,
    lifecycle_advanced: false,
  };
}

function toPreview(row, extras = {}) {
  const readiness =
    extras.email_readiness && typeof extras.email_readiness === "object"
      ? extras.email_readiness
      : emailProductionReadinessFromParts({
          liveFlag: isUciEmailLiveSubmissionEnabled(),
          mailSendConfigured: false,
        });
  const confirmed = row.status === "confirmed_for_transmission";
  const confirmationMessage = confirmed
    ? readiness.ready_to_send
      ? CONFIRMATION_READY_MESSAGE
      : row.confirmation_message || CONFIRMATION_MESSAGE
    : null;
  return {
    preparation_id: row.id,
    status: row.status,
    method: row.method || "email",
    capability: CAPABILITY,
    primary_state: "not_submitted",
    secondary_state: confirmed ? "confirmed_for_transmission" : "prepared",
    from: row.sender_mailbox,
    sender_mailbox_verified: row.sender_mailbox_verified === true,
    to: Array.isArray(row.to_recipients) ? row.to_recipients : [],
    cc: Array.isArray(row.cc_recipients) ? row.cc_recipients : [],
    subject: row.subject,
    body: row.body,
    provider: row.provider_slug,
    project_name: row.project_name,
    package_version: row.package_snapshot_version,
    package_snapshot_id: row.package_snapshot_id,
    package_snapshot_captured_at: row.package_snapshot_captured_at,
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
    sending_enabled: readiness.sending_enabled === true,
    ready_to_send: readiness.ready_to_send === true,
    live_email_flag_enabled: readiness.live_email_flag_enabled === true,
    mail_send_permission_configured: readiness.mail_send_permission_configured === true,
    production_readiness_blocker: readiness.production_readiness_blocker,
    graph_send_attempted: row.graph_send_attempted === true,
    confirmed_at: row.confirmed_at ?? null,
    confirmation_message: confirmationMessage,
    prepared_at: row.prepared_at,
    external_side_effects: row.external_side_effects || sideEffectsBase(),
    connect_outlook: extras.connect_outlook === true,
    blockers: Array.isArray(row.blockers) ? row.blockers : [],
    synthetic_test: extras.synthetic_test === true,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function prepareSubmission(supabase, params) {
  const { applicationId, userId, options = {}, deps = {} } = params;
  const application = await getApplicationById(supabase, applicationId);
  if (!application) {
    const err = new Error("Application not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const eligibility = validateSubmissionValidationEligibility(application);
  if (!eligibility.ok) {
    const err = new Error(
      eligibility.blockers.map((b) => b.message).join("; ") ||
        "Package is not ready for submission preparation",
    );
    err.statusCode = 400;
    err.code = "PREPARE_BLOCKED";
    err.details = { blockers: eligibility.blockers };
    throw err;
  }

  // Same readiness gate as validation_only — auto preflight so operators need not
  // run a separate Validate before Prepare. Does not write a validation attempt row.
  const prepMeta = asObject(application.agent_draft_metadata);
  const prepPkg = asObject(prepMeta.application_package);
  const prepValidationErrors = [
    ...(Array.isArray(prepPkg.missing_fields) ? prepPkg.missing_fields : []),
    ...(Array.isArray(prepPkg.missing_documents) ? prepPkg.missing_documents : []),
  ];
  if (prepValidationErrors.length > 0) {
    const err = new Error(
      `Package still has missing fields or documents: ${prepValidationErrors.join(", ")}`,
    );
    err.statusCode = 400;
    err.code = "PREPARE_BLOCKED";
    err.details = { validation_errors: prepValidationErrors };
    throw err;
  }
  if (String(prepPkg.package_status ?? "") !== "ready_for_review") {
    const err = new Error(
      `Package status must be ready_for_review before preparation (current: ${
        prepPkg.package_status ?? "unknown"
      })`,
    );
    err.statusCode = 400;
    err.code = "PREPARE_BLOCKED";
    throw err;
  }

  const sender = await resolveConnectedSenderMailbox(supabase, userId, deps);
  const readiness = await emailProductionReadiness(supabase, userId, deps);
  const reviewSummary = eligibility.review_summary;
  const bindings = snapshotBindings(reviewSummary, application);
  assertAttachmentDocumentReferences(bindings.attachments);

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", String(application.project_id))
    .maybeSingle();
  if (projectError || !project) {
    const err = new Error("Project not found");
    err.statusCode = 404;
    err.code = "PROJECT_NOT_FOUND";
    throw err;
  }

  const providerSlug = String(application.provider_slug ?? "");
  const draft = buildEmailDraft(application, project, providerSlug, bindings);
  const toRecipients = parseRecipientList(options.to_recipients ?? options.to);
  const ccRecipients = parseRecipientList(options.cc_recipients ?? options.cc);

  const insertRow = {
    application_id: String(application.id),
    coordination_record_id: String(application.coordination_record_id),
    project_id: String(application.project_id),
    status: "prepared",
    method: "email",
    package_snapshot_id: bindings.package_snapshot_id,
    package_snapshot_version: bindings.package_snapshot_version,
    package_snapshot_captured_at: bindings.package_snapshot_captured_at,
    provider_slug: providerSlug,
    project_name: project.name != null ? String(project.name) : null,
    sender_mailbox: sender.sender_mailbox,
    sender_mailbox_verified: sender.sender_mailbox_verified,
    operator_user_id: userId,
    to_recipients: toRecipients,
    cc_recipients: ccRecipients,
    subject: draft.subject,
    body: draft.body,
    attachments: bindings.attachments,
    reviewed_snapshot_bindings: {
      version: PREPARE_VERSION,
      ...bindings,
    },
    sending_enabled: readiness.sending_enabled === true,
    graph_send_attempted: false,
    external_side_effects: sideEffectsBase({ graph_me_called: sender.graph_me_called }),
    blockers: [],
    prepared_at: new Date().toISOString(),
  };

  const previewExtras = {
    synthetic_test: isDominionSyntheticPackage(application),
    email_readiness: readiness,
  };
  const prepareMessage =
    toRecipients.length === 0
      ? readiness.ready_to_send
        ? "Preparation ready. Enter recipient address(es) to preview, then confirm. Live send available after confirm."
        : "Preparation ready. Enter recipient address(es) to preview, then confirm. Sending is not enabled."
      : readiness.ready_to_send
        ? "Preparation ready for preview. Confirm when the outbound package looks correct. Live send available after confirm."
        : "Preparation ready for preview. Confirm when the outbound package looks correct. Sending is not enabled.";

  const { data: row, error } = await insertPreparationRow(supabase, insertRow);

  if (error) {
    // Only fall back when the relation is genuinely unavailable after schema-cache retry.
    // Do not treat transient PostgREST cache lag as "use JSONB forever".
    if (!isMissingRelationError(error) && !isPostgrestSchemaCacheMiss(error)) {
      const err = new Error(error.message || "Failed to persist submission preparation");
      err.statusCode = 500;
      err.code = "PREPARE_PERSIST_FAILED";
      err.cause = error;
      throw err;
    }
    const fallbackId = crypto.randomUUID();
    const fallbackRow = {
      id: fallbackId,
      ...insertRow,
      created_at: insertRow.prepared_at,
      updated_at: insertRow.prepared_at,
    };
    await appendPreparationPointer(supabase, application, fallbackRow, {
      table_persisted: false,
      table_error: error.message,
    });
    return {
      ...toPreview(fallbackRow, previewExtras),
      table_persisted: false,
      message: prepareMessage,
      application_id: String(application.id),
      submitted_at: null,
    };
  }

  await appendPreparationPointer(supabase, application, row, { table_persisted: true });

  return {
    ...toPreview(row, previewExtras),
    table_persisted: true,
    message: prepareMessage,
    application_id: String(application.id),
    submitted_at: null,
  };
}

async function appendPreparationPointer(supabase, application, row, meta = {}) {
  const metadata = asObject(application.agent_draft_metadata);
  const prior = Array.isArray(metadata.submission_preparations)
    ? metadata.submission_preparations
    : [];
  const entry = {
    id: row.id,
    status: row.status,
    sender_mailbox: row.sender_mailbox,
    sender_mailbox_verified: row.sender_mailbox_verified === true,
    to_recipients: row.to_recipients,
    cc_recipients: row.cc_recipients,
    subject: row.subject,
    body: row.body,
    attachments: row.attachments,
    package_snapshot_id: row.package_snapshot_id,
    package_snapshot_version: row.package_snapshot_version,
    package_snapshot_captured_at: row.package_snapshot_captured_at,
    provider_slug: row.provider_slug,
    project_name: row.project_name,
    prepared_at: row.prepared_at,
    confirmed_at: row.confirmed_at,
    confirmation_message: row.confirmation_message,
    confirmation_idempotency_key: row.confirmation_idempotency_key,
    method: "email",
    sending_enabled: false,
    graph_send_attempted: false,
    external_side_effects: row.external_side_effects,
    table_persisted: meta.table_persisted !== false,
    table_error: meta.table_error || null,
  };
  const idx = prior.findIndex((r) => String(r.id) === String(row.id));
  const nextHistory =
    idx >= 0 ? prior.map((r, i) => (i === idx ? entry : r)) : [...prior, entry];
  const nextMeta = {
    ...metadata,
    submission_preparations: nextHistory,
    latest_preparation: entry,
  };
  const { data, error } = await supabase
    .from("coordination_applications")
    .update({ agent_draft_metadata: nextMeta })
    .eq("id", String(application.id))
    .select("id, agent_draft_metadata, submitted_at")
    .single();
  if (error) {
    console.warn("[uci-submission-prepare] metadata mirror failed:", error.message);
    return null;
  }
  return data;
}

async function getPreparationOrThrow(supabase, preparationId, applicationId) {
  const { data, error } = await supabase
    .from("submission_preparations")
    .select("*")
    .eq("id", preparationId)
    .eq("application_id", applicationId)
    .maybeSingle();

  if (!error && data) {
    return { row: data, source: "table" };
  }

  const application = await getApplicationById(supabase, applicationId);
  if (!application) {
    const err = new Error("Application not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  const metadata = asObject(application.agent_draft_metadata);
  const history = Array.isArray(metadata.submission_preparations)
    ? metadata.submission_preparations
    : [];
  const found = history.find((r) => String(r.id) === String(preparationId));
  if (!found) {
    const err = new Error("Submission preparation not found");
    err.statusCode = 404;
    err.code = "PREPARATION_NOT_FOUND";
    throw err;
  }
  return {
    row: {
      ...found,
      application_id: applicationId,
      coordination_record_id: application.coordination_record_id,
      project_id: application.project_id,
    },
    source: "agent_draft_metadata",
    application,
  };
}

async function upsertMetadataPreparation(supabase, applicationId, nextRow) {
  const application = await getApplicationById(supabase, applicationId);
  if (!application) {
    const err = new Error("Application not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  const metadata = asObject(application.agent_draft_metadata);
  const prior = Array.isArray(metadata.submission_preparations)
    ? metadata.submission_preparations
    : [];
  const entry = {
    ...clone(nextRow),
    sending_enabled: false,
    graph_send_attempted: false,
    table_persisted: false,
  };
  const idx = prior.findIndex((r) => String(r.id) === String(nextRow.id));
  const nextHistory =
    idx >= 0
      ? prior.map((r, i) => (i === idx ? entry : r))
      : [...prior, entry];
  const { data, error } = await supabase
    .from("coordination_applications")
    .update({
      agent_draft_metadata: {
        ...metadata,
        submission_preparations: nextHistory,
        latest_preparation: entry,
      },
    })
    .eq("id", applicationId)
    .select("id, submitted_at, agent_draft_metadata")
    .single();
  if (error) {
    const err = new Error(error.message || "Failed to persist preparation history");
    err.statusCode = 500;
    err.code = "PREPARE_METADATA_UPDATE_FAILED";
    throw err;
  }
  return data;
}

/**
 * Update explicit recipients (and optional subject/body edits) before confirm.
 */
async function updateSubmissionPreparation(supabase, params) {
  const { applicationId, preparationId, userId, patch = {}, deps = {} } = params;
  const loaded = await getPreparationOrThrow(supabase, preparationId, applicationId);
  const row = loaded.row;
  if (row.status === "confirmed_for_transmission") {
    const err = new Error("This preparation is already confirmed and cannot be edited");
    err.statusCode = 409;
    err.code = "ALREADY_CONFIRMED";
    throw err;
  }

  const sender = await resolveConnectedSenderMailbox(supabase, userId, deps);

  const next = {
    ...row,
    sender_mailbox: sender.sender_mailbox,
    sender_mailbox_verified: sender.sender_mailbox_verified,
    external_side_effects: sideEffectsBase({ graph_me_called: true }),
    updated_at: new Date().toISOString(),
  };
  if (patch.to_recipients != null || patch.to != null) {
    next.to_recipients = parseRecipientList(patch.to_recipients ?? patch.to);
  }
  if (patch.cc_recipients != null || patch.cc != null) {
    next.cc_recipients = parseRecipientList(patch.cc_recipients ?? patch.cc);
  }
  if (patch.subject != null) next.subject = String(patch.subject);
  if (patch.body != null) next.body = String(patch.body);

  if (loaded.source === "table") {
    const { data: updated, error } = await supabase
      .from("submission_preparations")
      .update({
        sender_mailbox: next.sender_mailbox,
        sender_mailbox_verified: next.sender_mailbox_verified,
        to_recipients: next.to_recipients,
        cc_recipients: next.cc_recipients,
        subject: next.subject,
        body: next.body,
        external_side_effects: next.external_side_effects,
        updated_at: next.updated_at,
      })
      .eq("id", preparationId)
      .eq("application_id", applicationId)
      .select("*")
      .single();
    if (error) {
      const err = new Error(error.message || "Failed to update preparation");
      err.statusCode = 500;
      err.code = "PREPARE_UPDATE_FAILED";
      throw err;
    }
    await appendPreparationPointer(
      supabase,
      (await getApplicationById(supabase, applicationId)) || { id: applicationId, agent_draft_metadata: {} },
      updated,
      { table_persisted: true },
    );
    const readiness = await emailProductionReadiness(supabase, userId, deps);
    return { ...toPreview(updated, { email_readiness: readiness }), table_persisted: true };
  }

  await upsertMetadataPreparation(supabase, applicationId, next);
  const readiness = await emailProductionReadiness(supabase, userId, deps);
  return {
    ...toPreview(next, { email_readiness: readiness }),
    table_persisted: false,
  };
}

/**
 * Explicit one-use confirmation. Never calls Graph sendMail / never sets submitted_at.
 */
async function confirmSubmissionPreparation(supabase, params) {
  const { applicationId, preparationId, userId, options = {}, deps = {} } = params;
  const readiness = await emailProductionReadiness(supabase, userId, deps);
  const confirmMessage = readiness.ready_to_send
    ? CONFIRMATION_READY_MESSAGE
    : CONFIRMATION_MESSAGE;
  const previewExtras = {
    email_readiness: readiness,
    synthetic_test: false,
  };
  const application = await getApplicationById(supabase, applicationId);
  if (!application) {
    const err = new Error("Application not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  previewExtras.synthetic_test = isDominionSyntheticPackage(application);
  if (application.submitted_at) {
    const err = new Error("Application is already submitted");
    err.statusCode = 400;
    err.code = "ALREADY_SUBMITTED";
    throw err;
  }

  const eligibility = validateSubmissionValidationEligibility(application);
  if (!eligibility.ok) {
    const err = new Error("Package is no longer Reviewed / ready for confirmation");
    err.statusCode = 400;
    err.code = "CONFIRM_BLOCKED";
    err.details = { blockers: eligibility.blockers };
    throw err;
  }

  const confirmAttachments = collectAttachments(application, eligibility.review_summary);
  assertAttachmentDocumentReferences(confirmAttachments);

  const loaded = await getPreparationOrThrow(supabase, preparationId, applicationId);
  const row = loaded.row;

  const idempotencyKey =
    options.idempotency_key != null && String(options.idempotency_key).trim()
      ? String(options.idempotency_key).trim().slice(0, 128)
      : null;

  if (row.status === "confirmed_for_transmission") {
    if (
      idempotencyKey &&
      row.confirmation_idempotency_key &&
      row.confirmation_idempotency_key === idempotencyKey
    ) {
      return {
        ...toPreview(row, previewExtras),
        message: confirmMessage,
        idempotent_replay: true,
        submitted_at: null,
        table_persisted: loaded.source === "table",
      };
    }
    const err = new Error("This preparation was already confirmed");
    err.statusCode = 409;
    err.code = "ALREADY_CONFIRMED";
    throw err;
  }

  if (idempotencyKey && loaded.source === "table") {
    const { data: existing } = await supabase
      .from("submission_preparations")
      .select("*")
      .eq("application_id", applicationId)
      .eq("confirmation_idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existing && existing.status === "confirmed_for_transmission") {
      return {
        ...toPreview(existing, previewExtras),
        message: confirmMessage,
        idempotent_replay: true,
        submitted_at: null,
        table_persisted: true,
      };
    }
  }

  if (idempotencyKey && loaded.source !== "table") {
    const history = Array.isArray(asObject(application.agent_draft_metadata).submission_preparations)
      ? asObject(application.agent_draft_metadata).submission_preparations
      : [];
    const existing = history.find(
      (r) =>
        r.confirmation_idempotency_key === idempotencyKey &&
        r.status === "confirmed_for_transmission",
    );
    if (existing) {
      return {
        ...toPreview(existing, previewExtras),
        message: confirmMessage,
        idempotent_replay: true,
        submitted_at: null,
        table_persisted: false,
      };
    }
  }

  const sender = await resolveConnectedSenderMailbox(supabase, userId, deps);

  let toRecipients = Array.isArray(row.to_recipients) ? row.to_recipients : [];
  let ccRecipients = Array.isArray(row.cc_recipients) ? row.cc_recipients : [];
  if (options.to_recipients != null || options.to != null) {
    toRecipients = parseRecipientList(options.to_recipients ?? options.to);
  }
  if (options.cc_recipients != null || options.cc != null) {
    ccRecipients = parseRecipientList(options.cc_recipients ?? options.cc);
  }

  if (toRecipients.length === 0) {
    const err = new Error(
      "Enter at least one recipient address before confirming. Recipients are never guessed.",
    );
    err.statusCode = 400;
    err.code = "RECIPIENT_REQUIRED";
    throw err;
  }

  const confirmedAt = new Date().toISOString();
  const patch = {
    status: "confirmed_for_transmission",
    sender_mailbox: sender.sender_mailbox,
    sender_mailbox_verified: true,
    operator_user_id: userId,
    to_recipients: toRecipients,
    cc_recipients: ccRecipients,
    subject: options.subject != null ? String(options.subject) : row.subject,
    body: options.body != null ? String(options.body) : row.body,
    confirmation_idempotency_key:
      idempotencyKey || `confirm:${preparationId}:${crypto.randomUUID()}`,
    confirmed_at: confirmedAt,
    confirmation_message: confirmMessage,
    sending_enabled: readiness.sending_enabled === true,
    graph_send_attempted: false,
    external_side_effects: sideEffectsBase({ graph_me_called: true }),
    updated_at: confirmedAt,
  };

  /** @type {Record<string, unknown>} */
  let updated;

  if (loaded.source === "table") {
    const result = await supabase
      .from("submission_preparations")
      .update(patch)
      .eq("id", preparationId)
      .eq("application_id", applicationId)
      .eq("status", "prepared")
      .select("*")
      .single();
    if (result.error || !result.data) {
      const again = await getPreparationOrThrow(supabase, preparationId, applicationId);
      if (again.row.status === "confirmed_for_transmission") {
        return {
          ...toPreview(again.row, previewExtras),
          message: confirmMessage,
          idempotent_replay: true,
          submitted_at: null,
          table_persisted: again.source === "table",
        };
      }
      const err = new Error(result.error?.message || "Failed to confirm preparation");
      err.statusCode = 500;
      err.code = "CONFIRM_PERSIST_FAILED";
      throw err;
    }
    updated = result.data;
    await appendPreparationPointer(supabase, application, updated, { table_persisted: true });
  } else {
    updated = { ...row, ...patch };
    await upsertMetadataPreparation(supabase, applicationId, updated);
  }

  const { data: appAfter } = await supabase
    .from("coordination_applications")
    .select("id, submitted_at, submission_method, utility_ticket_number")
    .eq("id", applicationId)
    .maybeSingle();

  if (appAfter?.submitted_at) {
    const err = new Error("Invariant violated: confirm must leave submitted_at null");
    err.statusCode = 500;
    err.code = "CONFIRM_SIDE_EFFECT_INVARIANT";
    throw err;
  }

  return {
    ...toPreview(updated, previewExtras),
    message: confirmMessage,
    submitted_at: null,
    lifecycle_advanced: false,
    portal_adapter_used: false,
    transmission_send_enabled: readiness.ready_to_send === true,
    table_persisted: loaded.source === "table",
  };
}

async function listSubmissionPreparations(supabase, applicationId, opts = {}) {
  const userId = opts.userId != null ? String(opts.userId) : null;
  const deps = opts.deps && typeof opts.deps === "object" ? opts.deps : {};
  const readiness = await emailProductionReadiness(supabase, userId, deps);
  const application = await getApplicationById(supabase, applicationId);
  if (!application) {
    const err = new Error("Application not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const mapPreview = (r) => toPreview(r, { email_readiness: readiness });

  const latestTransmission = (() => {
    const meta = asObject(application.agent_draft_metadata);
    const latest = meta.latest_transmission;
    if (latest && typeof latest === "object") return clone(latest);
    const history = Array.isArray(meta.submission_transmission_attempts)
      ? meta.submission_transmission_attempts
      : [];
    return history.length > 0 ? clone(history[history.length - 1]) : null;
  })();

  const { data, error } = await supabase
    .from("submission_preparations")
    .select("*")
    .eq("application_id", applicationId)
    .order("prepared_at", { ascending: false });

  if (!error && Array.isArray(data)) {
    const rows = data;
    let transmission = latestTransmission;
    const { data: txRows } = await supabase
      .from("submission_transmission_attempts")
      .select("*")
      .eq("application_id", applicationId)
      .order("claimed_at", { ascending: false })
      .limit(1);
    if (Array.isArray(txRows) && txRows[0]) {
      transmission = txRows[0];
    }
    return {
      application_id: applicationId,
      primary_state: application.submitted_at ? "submitted" : "not_submitted",
      submitted_at: application.submitted_at ?? null,
      preparations: rows.map(mapPreview),
      latest: rows[0] ? mapPreview(rows[0]) : null,
      source: "submission_preparations",
      email_readiness: readiness,
      latest_transmission: transmission,
    };
  }

  const metadata = asObject(application.agent_draft_metadata);
  const history = Array.isArray(metadata.submission_preparations)
    ? clone(metadata.submission_preparations).reverse()
    : [];
  return {
    application_id: applicationId,
    primary_state: application.submitted_at ? "submitted" : "not_submitted",
    submitted_at: application.submitted_at ?? null,
    preparations: history.map(mapPreview),
    latest: history[0] ? mapPreview(history[0]) : null,
    source: "agent_draft_metadata",
    table_error: error?.message || null,
    email_readiness: readiness,
    latest_transmission: latestTransmission,
  };
}

async function getSubmissionPreparationPreview(supabase, params) {
  const { applicationId, preparationId, userId = null, deps = {} } = params;
  const readiness = await emailProductionReadiness(supabase, userId, deps);
  const loaded = await getPreparationOrThrow(supabase, preparationId, applicationId);
  return {
    ...toPreview(loaded.row, { email_readiness: readiness }),
    table_persisted: loaded.source === "table",
  };
}

function reviewSnapshotAttachmentIds(reviewSummary) {
  const snapshot = asObject(reviewSummary?.reviewed_snapshot);
  const docs = Array.isArray(snapshot.package_documents)
    ? snapshot.package_documents
    : Array.isArray(snapshot.documents)
      ? snapshot.documents
      : [];
  /** @type {Record<string, string | null>} */
  const attachmentIds = {};
  for (const raw of docs) {
    const doc = asObject(raw);
    const key = doc.key != null ? String(doc.key) : "";
    if (!key) continue;
    attachmentIds[key] = doc.project_document_id != null ? String(doc.project_document_id) : null;
  }
  return {
    captured_at: snapshot.captured_at != null ? String(snapshot.captured_at) : null,
    attachment_ids: attachmentIds,
  };
}

function preparationAttachmentIds(prepRow) {
  const attachments = Array.isArray(prepRow.attachments) ? prepRow.attachments : [];
  /** @type {Record<string, string | null>} */
  const attachmentIds = {};
  for (const raw of attachments) {
    const row = asObject(raw);
    const key = row.key != null ? String(row.key) : "";
    if (!key) continue;
    attachmentIds[key] =
      row.project_document_id != null ? String(row.project_document_id) : null;
  }
  return {
    captured_at:
      prepRow.package_snapshot_captured_at != null
        ? String(prepRow.package_snapshot_captured_at)
        : null,
    attachment_ids: attachmentIds,
  };
}

function preparationMatchesReviewSnapshot(prepRow, reviewSummary) {
  const current = reviewSnapshotAttachmentIds(reviewSummary);
  const prep = preparationAttachmentIds(prepRow);
  if (!reviewSummary?.reviewed_snapshot) return true;
  if (current.captured_at && prep.captured_at && current.captured_at === prep.captured_at) {
    return true;
  }
  const keys = new Set([
    ...Object.keys(current.attachment_ids),
    ...Object.keys(prep.attachment_ids),
  ]);
  if (keys.size === 0) {
    return current.captured_at === prep.captured_at;
  }
  for (const key of keys) {
    if (current.attachment_ids[key] !== prep.attachment_ids[key]) return false;
  }
  return true;
}

function preparationIsStaleForReviewSnapshot(prepRow, reviewSummary) {
  if (String(prepRow?.status ?? "") !== "confirmed_for_transmission") return false;
  if (!reviewSummary?.reviewed_snapshot) return false;
  return !preparationMatchesReviewSnapshot(prepRow, reviewSummary);
}

/**
 * Block confirmed preparations whose attachment snapshot no longer matches the
 * current reviewed snapshot (recovery after repair / re-review).
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function blockStaleConfirmedPreparations(supabase, params) {
  const applicationId = String(params.applicationId ?? "");
  const reviewSummary = params.reviewSummary;
  const userId = params.userId != null ? String(params.userId) : null;
  const reason = String(params.reason ?? "reviewed_snapshot_changed");
  const now = new Date().toISOString();
  let application = params.application ?? null;

  /** @type {Array<Record<string, unknown>>} */
  let candidates = [];
  const { data, error } = await supabase
    .from("submission_preparations")
    .select("*")
    .eq("application_id", applicationId)
    .eq("status", "confirmed_for_transmission");
  if (!error && Array.isArray(data)) {
    candidates = data;
  } else if (!application) {
    application = await getApplicationById(supabase, applicationId);
  }
  if (candidates.length === 0 && application) {
    const metadata = asObject(application.agent_draft_metadata);
    const history = Array.isArray(metadata.submission_preparations)
      ? metadata.submission_preparations
      : [];
    candidates = history.filter((row) => String(row.status) === "confirmed_for_transmission");
  }

  /** @type {Array<{ id: string, status: string }>} */
  const blocked = [];
  for (const row of candidates) {
    if (!preparationIsStaleForReviewSnapshot(row, reviewSummary)) continue;
    const blocker = {
      code: "STALE_REVIEWED_SNAPSHOT",
      message:
        "Confirmed against a prior reviewed snapshot — blocked after package re-review; prepare again",
      blocked_at: now,
      blocked_by_user_id: userId,
      reason,
      prior_package_snapshot_captured_at: row.package_snapshot_captured_at ?? null,
      current_package_snapshot_captured_at:
        reviewSummary?.reviewed_snapshot?.captured_at ?? null,
    };
    const patch = {
      status: "blocked",
      blockers: [blocker],
      updated_at: now,
    };
    if (row.id && (!error || candidates === data)) {
      const updateResult = await supabase
        .from("submission_preparations")
        .update(patch)
        .eq("id", String(row.id))
        .select("id")
        .single();
      if (updateResult.error) {
        throw Object.assign(
          new Error(updateResult.error.message || "Failed to block stale submission preparation"),
          { statusCode: 500, code: "PREPARE_STALE_BLOCK_FAILED", cause: updateResult.error },
        );
      }
    }
    if (!application) {
      application = await getApplicationById(supabase, applicationId);
    }
    if (application) {
      await appendPreparationPointer(supabase, application, { ...row, ...patch }, {
        table_persisted: !error,
      });
    }
    blocked.push({ id: String(row.id), status: "blocked" });
  }
  return { blocked_count: blocked.length, blocked };
}

module.exports = {
  PREPARE_VERSION,
  CAPABILITY,
  CONFIRMATION_MESSAGE,
  CONFIRMATION_READY_MESSAGE,
  MAIL_SEND_PERMISSION_BLOCKER,
  LIVE_EMAIL_DISABLED_BLOCKER,
  isUciEmailLiveSubmissionEnabled,
  emailProductionReadiness,
  emailProductionReadinessFromParts,
  resolveMailSendPermissionConfigured,
  prepareSubmission,
  updateSubmissionPreparation,
  confirmSubmissionPreparation,
  listSubmissionPreparations,
  getSubmissionPreparationPreview,
  resolveConnectedSenderMailbox,
  parseRecipientList,
  parseEmailAllowlist,
  getAllowedSenderMailboxes,
  getAllowedRecipientAddresses,
  assertLiveEmailAllowlists,
  toPreview,
  reviewSnapshotAttachmentIds,
  preparationAttachmentIds,
  preparationMatchesReviewSnapshot,
  preparationIsStaleForReviewSnapshot,
  blockStaleConfirmedPreparations,
};
