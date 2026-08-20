"use strict";

/**
 * Stage 4 controlled live email transmission.
 * Requires UCI_EMAIL_LIVE_SUBMISSION_ENABLED=true.
 * Claims an append-only transmission attempt BEFORE Graph /me/sendMail.
 * Never advances Stage 5. Never calls legacy submitViaEmail.
 */

const crypto = require("crypto");
const {
  getApplicationById,
} = require("./uci-application-builder.service.js");
const {
  isDominionSyntheticPackage,
  assertAttachmentDocumentReferences,
} = require("./uci-submission-validation.service.js");
const {
  resolveConnectedSenderMailbox,
  parseRecipientList,
  getSubmissionPreparationPreview,
  isUciEmailLiveSubmissionEnabled,
  resolveMailSendPermissionConfigured,
  assertLiveEmailAllowlists,
  MAIL_SEND_PERMISSION_BLOCKER,
} = require("./uci-submission-prepare.service.js");
const {
  getValidAccessTokenForUser,
} = require("../microsoft/microsoft-graph-auth.service.js");
const { graphSendMail, SYNTHETIC_BODY_WARNING, SYNTHETIC_NO_EXTERNAL_BANNER, SYNTHETIC_SUBJECT_PREFIX } = require("./uci-email-submission.service.js");
const { UCI_DOCUMENTS_STORAGE_BUCKET } = require("./uci-document-storage.service.js");

const TRANSMIT_VERSION = "stage4-transmit-p1-v1";
const DEFAULT_GRAPH_TIMEOUT_MS = 60_000;

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
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

function isUniqueViolation(error) {
  const code = String(error?.code || "");
  const msg = String(error?.message || error || "");
  return code === "23505" || /duplicate key|unique constraint/i.test(msg);
}

function ensureSyntheticSubject(subject, application) {
  const base = String(subject || "").trim();
  if (!isDominionSyntheticPackage(application)) return base;
  if (/^\[TEST\]/i.test(base) || /SYNTHETIC TEST/i.test(base)) return base;
  return `${SYNTHETIC_SUBJECT_PREFIX} ${base}`.trim();
}

function ensureSyntheticBody(body, application) {
  const base = String(body || "");
  if (!isDominionSyntheticPackage(application)) return base;
  let next = base;
  if (!new RegExp(SYNTHETIC_NO_EXTERNAL_BANNER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(next)) {
    next = `${next.trimEnd()}\n\n${SYNTHETIC_NO_EXTERNAL_BANNER}`;
  }
  if (new RegExp(SYNTHETIC_BODY_WARNING.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(next)) {
    return next;
  }
  if (/synthetic test documents|not for construction or utility submission/i.test(next)) {
    return next;
  }
  return `${next.trimEnd()}\n\n${SYNTHETIC_BODY_WARNING}\n`;
}

async function downloadStorageBuffer(supabase, bucket, storagePath) {
  const { data, error } = await supabase.storage.from(bucket).download(storagePath);
  if (error || !data) {
    throw Object.assign(new Error(error?.message || "Attachment storage download failed"), {
      statusCode: 409,
      code: "ATTACHMENT_RESOLVE_FAILED",
    });
  }
  return Buffer.from(await data.arrayBuffer());
}

/**
 * Resolve binary attachments from preparation snapshot bindings + live package_documents.
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {Record<string, unknown>} application
 * @param {Array<Record<string, unknown>>} prepAttachments
 */
async function resolveTransmissionAttachments(supabase, application, prepAttachments) {
  const liveDocs = Array.isArray(application.package_documents)
    ? /** @type {Array<Record<string, unknown>>} */ (application.package_documents)
    : [];
  const liveByKey = new Map(
    liveDocs.filter((d) => d && d.key != null).map((d) => [String(d.key), d]),
  );
  const sourceList =
    Array.isArray(prepAttachments) && prepAttachments.length > 0 ? prepAttachments : liveDocs;

  /** @type {Array<{ file_name: string, content_base64: string, content_type: string, key: string | null, project_document_id: string | null, size_bytes: number }>} */
  const out = [];
  for (const raw of sourceList) {
    const prep = asObject(raw);
    const key = prep.key != null ? String(prep.key) : null;
    const live = key && liveByKey.has(key) ? liveByKey.get(key) : prep;
    const merged = { ...live, ...prep };
    const projectDocumentId =
      merged.project_document_id != null ? String(merged.project_document_id).trim() : "";
    if (!projectDocumentId) {
      throw Object.assign(
        new Error(`Attachment missing project_document_id: ${key || merged.file_name || "unknown"}`),
        { statusCode: 409, code: "ATTACHMENT_RESOLVE_FAILED" },
      );
    }
    const { data: projectDocument, error } = await supabase
      .from("project_documents")
      .select("id, project_id, file_name, file_path, file_type")
      .eq("id", projectDocumentId)
      .eq("project_id", String(application.project_id))
      .maybeSingle();
    if (error || !projectDocument) {
      throw Object.assign(
        new Error(error?.message || `Project document not found: ${projectDocumentId}`),
        { statusCode: 409, code: "ATTACHMENT_RESOLVE_FAILED" },
      );
    }
    const buffer = await downloadStorageBuffer(
      supabase,
      UCI_DOCUMENTS_STORAGE_BUCKET,
      String(projectDocument.file_path),
    );
    const fileName =
      (merged.file_name != null && String(merged.file_name).trim()) ||
      String(projectDocument.file_name || "attachment.pdf");
    out.push({
      key,
      project_document_id: projectDocumentId,
      file_name: fileName,
      content_type: String(projectDocument.file_type || "application/pdf"),
      content_base64: buffer.toString("base64"),
      size_bytes: buffer.length,
    });
  }
  return out;
}

async function mirrorTransmissionPointer(supabase, application, row, meta = {}) {
  const metadata = asObject(application.agent_draft_metadata);
  const prior = Array.isArray(metadata.submission_transmission_attempts)
    ? metadata.submission_transmission_attempts
    : [];
  const entry = {
    id: row.id,
    status: row.status,
    preparation_id: row.preparation_id,
    idempotency_key: row.idempotency_key,
    sender_mailbox: row.sender_mailbox,
    to_recipients: row.to_recipients,
    subject: row.subject,
    attachment_count: row.attachment_count,
    attachment_names: row.attachment_names,
    graph_send_attempted: row.graph_send_attempted === true,
    graph_http_status: row.graph_http_status ?? null,
    graph_message_id: row.graph_message_id ?? null,
    graph_error: row.graph_error ?? null,
    claimed_at: row.claimed_at,
    completed_at: row.completed_at ?? null,
    external_side_effects: row.external_side_effects,
    table_persisted: meta.table_persisted !== false,
    version: TRANSMIT_VERSION,
  };
  const idx = prior.findIndex((r) => String(r.id) === String(row.id));
  const nextHistory =
    idx >= 0 ? prior.map((r, i) => (i === idx ? entry : r)) : [...prior, entry];
  const nextMeta = {
    ...metadata,
    submission_transmission_attempts: nextHistory,
    latest_transmission: entry,
  };
  const { error } = await supabase
    .from("coordination_applications")
    .update({ agent_draft_metadata: nextMeta })
    .eq("id", String(application.id));
  if (error) {
    console.warn("[uci-submission-transmission] metadata mirror failed:", error.message);
  }
  return nextMeta;
}

async function findExistingAttempt(supabase, applicationId, idempotencyKey) {
  const { data, error } = await supabase
    .from("submission_transmission_attempts")
    .select("*")
    .eq("application_id", applicationId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (!error && data) return { row: data, source: "table" };

  const application = await getApplicationById(supabase, applicationId);
  const history = Array.isArray(asObject(application?.agent_draft_metadata).submission_transmission_attempts)
    ? asObject(application.agent_draft_metadata).submission_transmission_attempts
    : [];
  const existing = history.find((r) => r && r.idempotency_key === idempotencyKey);
  if (existing) return { row: existing, source: "metadata" };
  return null;
}

function replayResponse(row, source) {
  return {
    ok: row.status === "sent",
    status: row.status,
    idempotent_replay: true,
    transmission_id: row.id,
    preparation_id: row.preparation_id,
    from: row.sender_mailbox,
    to: row.to_recipients,
    subject: row.subject,
    attachment_count: row.attachment_count,
    attachment_names: row.attachment_names,
    graph_http_status: row.graph_http_status ?? null,
    graph_message_id: row.graph_message_id ?? null,
    graph_error: row.graph_error ?? null,
    graph_send_attempted: row.graph_send_attempted === true,
    submitted_at: null,
    lifecycle_advanced: false,
    stage_5_advanced: false,
    table_persisted: source === "table",
    message:
      row.status === "sent"
        ? "Transmission already recorded as sent — Graph sendMail not called again"
        : row.status === "outcome_unknown"
          ? "Prior transmission outcome is unknown — refusing blind retry"
          : row.status === "claimed"
            ? "Transmission claim already exists — refusing concurrent/retry send"
            : "Prior transmission attempt exists — not re-sending",
    external_side_effects: row.external_side_effects,
  };
}

async function claimTransmissionAttempt(supabase, insertRow) {
  let result = await supabase
    .from("submission_transmission_attempts")
    .insert(insertRow)
    .select("*")
    .single();
  if (result.error && isPostgrestSchemaCacheMiss(result.error)) {
    await new Promise((r) => setTimeout(r, 750));
    result = await supabase
      .from("submission_transmission_attempts")
      .insert(insertRow)
      .select("*")
      .single();
  }
  return result;
}

async function updateTransmissionAttempt(supabase, attemptId, applicationId, patch) {
  return supabase
    .from("submission_transmission_attempts")
    .update(patch)
    .eq("id", attemptId)
    .eq("application_id", applicationId)
    .select("*")
    .single();
}

/**
 * Transmit a confirmed preparation once via Graph /me/sendMail.
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function transmitSubmissionPreparation(supabase, params) {
  const { applicationId, preparationId, userId, options = {}, deps = {} } = params;

  if (!isUciEmailLiveSubmissionEnabled()) {
    const err = new Error(
      "Live email transmission is disabled — set UCI_EMAIL_LIVE_SUBMISSION_ENABLED=true after explicit approval",
    );
    err.statusCode = 403;
    err.code = "LIVE_EMAIL_DISABLED";
    throw err;
  }

  const mailSendOk = await resolveMailSendPermissionConfigured(supabase, userId, deps);
  if (!mailSendOk) {
    const err = new Error(MAIL_SEND_PERMISSION_BLOCKER);
    err.statusCode = 403;
    err.code = "MAIL_SEND_PERMISSION_REQUIRED";
    throw err;
  }

  const application = await getApplicationById(supabase, applicationId);
  if (!application) {
    const err = new Error("Application not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const preview = await getSubmissionPreparationPreview(supabase, {
    applicationId,
    preparationId,
  });
  if (preview.status !== "confirmed_for_transmission") {
    const err = new Error("Preparation must be confirmed_for_transmission before live send");
    err.statusCode = 400;
    err.code = "NOT_CONFIRMED";
    throw err;
  }

  const idempotencyKey =
    options.idempotency_key != null && String(options.idempotency_key).trim()
      ? String(options.idempotency_key).trim().slice(0, 128)
      : `transmit:${preparationId}`;

  const existing = await findExistingAttempt(supabase, applicationId, idempotencyKey);
  if (existing) {
    return replayResponse(existing.row, existing.source);
  }

  const { data: prepAttempts } = await supabase
    .from("submission_transmission_attempts")
    .select("*")
    .eq("application_id", applicationId)
    .eq("preparation_id", preparationId)
    .order("claimed_at", { ascending: false })
    .limit(5);
  if (Array.isArray(prepAttempts) && prepAttempts.length > 0) {
    const blocking = prepAttempts.find((r) =>
      ["sent", "claimed", "outcome_unknown"].includes(String(r.status)),
    );
    if (blocking) return replayResponse(blocking, "table");
  }

  const sender = await resolveConnectedSenderMailbox(supabase, userId, deps);
  let toRecipients = parseRecipientList(preview.to);
  let ccRecipients = parseRecipientList(preview.cc);
  if (options.to_recipients != null || options.to != null) {
    toRecipients = parseRecipientList(options.to_recipients ?? options.to);
  }
  if (options.cc_recipients != null || options.cc != null) {
    ccRecipients = parseRecipientList(options.cc_recipients ?? options.cc);
  }
  if (toRecipients.length === 0) {
    const err = new Error("Recipient address required for transmission");
    err.statusCode = 400;
    err.code = "RECIPIENT_REQUIRED";
    throw err;
  }
  assertLiveEmailAllowlists({
    sender: sender.sender_mailbox,
    recipients: [...toRecipients, ...ccRecipients],
  });

  assertAttachmentDocumentReferences(
    Array.isArray(preview.attachments) ? preview.attachments : [],
  );

  const binaries = await resolveTransmissionAttachments(
    supabase,
    application,
    Array.isArray(preview.attachments) ? preview.attachments : [],
  );
  if (binaries.length === 0) {
    const err = new Error("No binary attachments resolved for transmission");
    err.statusCode = 409;
    err.code = "ATTACHMENT_RESOLVE_FAILED";
    throw err;
  }

  const subject = ensureSyntheticSubject(
    options.subject != null ? String(options.subject) : preview.subject,
    application,
  );
  const body = ensureSyntheticBody(
    options.body != null ? String(options.body) : preview.body,
    application,
  );
  const attachmentNames = binaries.map((b) => b.file_name);
  const claimedAt = new Date().toISOString();

  const insertRow = {
    id: crypto.randomUUID(),
    application_id: String(application.id),
    coordination_record_id: String(application.coordination_record_id),
    project_id: String(application.project_id),
    preparation_id: preparationId,
    method: "email",
    status: "claimed",
    idempotency_key: idempotencyKey,
    sender_mailbox: sender.sender_mailbox,
    to_recipients: toRecipients,
    cc_recipients: ccRecipients,
    subject,
    body_preview: body.slice(0, 2000),
    attachment_names: attachmentNames,
    attachment_count: binaries.length,
    package_snapshot_id: preview.package_snapshot_id,
    package_snapshot_version: preview.package_version,
    operator_user_id: userId,
    graph_send_attempted: false,
    graph_http_status: null,
    graph_message_id: null,
    graph_error: null,
    outcome_detail: { version: TRANSMIT_VERSION, phase: "claimed" },
    external_side_effects: {
      email_sent: false,
      portal_touched: false,
      live_submission_attempted: true,
      lifecycle_advanced: false,
      graph_called: true,
      graph_send_mail_called: false,
      stage_5_advanced: false,
    },
    claimed_at: claimedAt,
    completed_at: null,
  };

  let claimSource = "table";
  let attempt = insertRow;
  const claimResult = await claimTransmissionAttempt(supabase, insertRow);
  if (claimResult.error) {
    if (isUniqueViolation(claimResult.error)) {
      const again = await findExistingAttempt(supabase, applicationId, idempotencyKey);
      if (again) return replayResponse(again.row, again.source);
    }
    if (!isMissingRelationError(claimResult.error) && !isPostgrestSchemaCacheMiss(claimResult.error)) {
      const err = new Error(claimResult.error.message || "Failed to claim transmission attempt");
      err.statusCode = 500;
      err.code = "TRANSMIT_CLAIM_FAILED";
      throw err;
    }
    claimSource = "metadata";
    const metaHistory = Array.isArray(
      asObject(application.agent_draft_metadata).submission_transmission_attempts,
    )
      ? asObject(application.agent_draft_metadata).submission_transmission_attempts
      : [];
    if (metaHistory.some((r) => r && r.idempotency_key === idempotencyKey)) {
      const existingMeta = metaHistory.find((r) => r.idempotency_key === idempotencyKey);
      return replayResponse(existingMeta, "metadata");
    }
    await mirrorTransmissionPointer(supabase, application, insertRow, { table_persisted: false });
    attempt = insertRow;
  } else {
    attempt = claimResult.data;
    await mirrorTransmissionPointer(supabase, application, attempt, { table_persisted: true });
  }

  let accessToken;
  try {
    accessToken =
      typeof deps.getValidAccessTokenForUser === "function"
        ? await deps.getValidAccessTokenForUser(supabase, userId)
        : await getValidAccessTokenForUser(supabase, userId);
  } catch (inner) {
    const completedAt = new Date().toISOString();
    const failPatch = {
      status: "failed",
      graph_send_attempted: false,
      graph_error: inner instanceof Error ? inner.message : String(inner),
      completed_at: completedAt,
      outcome_detail: { version: TRANSMIT_VERSION, phase: "token", code: "MAILBOX_NOT_CONNECTED" },
      external_side_effects: {
        ...asObject(attempt.external_side_effects),
        graph_send_mail_called: false,
        email_sent: false,
        lifecycle_advanced: false,
        stage_5_advanced: false,
      },
      updated_at: completedAt,
    };
    if (claimSource === "table") {
      const updated = await updateTransmissionAttempt(supabase, attempt.id, applicationId, failPatch);
      if (updated.data) attempt = updated.data;
      else attempt = { ...attempt, ...failPatch };
    } else {
      attempt = { ...attempt, ...failPatch };
    }
    await mirrorTransmissionPointer(supabase, application, attempt, {
      table_persisted: claimSource === "table",
    });
    return {
      ok: false,
      status: "failed",
      transmission_id: attempt.id,
      code: "MAILBOX_NOT_CONNECTED",
      message: failPatch.graph_error,
      submitted_at: null,
      lifecycle_advanced: false,
      stage_5_advanced: false,
      table_persisted: claimSource === "table",
    };
  }

  const timeoutMs =
    typeof options.graph_timeout_ms === "number" && options.graph_timeout_ms > 0
      ? options.graph_timeout_ms
      : DEFAULT_GRAPH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const sendMailFn = typeof deps.sendMailFn === "function" ? deps.sendMailFn : graphSendMail;
  /** @type {{ ok: boolean, status?: number, message_id?: string, error?: string, uncertain?: boolean }} */
  let sendResult;
  try {
    sendResult = await sendMailFn(accessToken, {
      subject,
      body,
      toRecipients,
      ccRecipients,
      attachments: binaries,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const completedAt = new Date().toISOString();
  let nextStatus = "failed";
  if (sendResult.ok && sendResult.message_id && sendResult.unreconciled !== true && sendResult.uncertain !== true) {
    nextStatus = "sent";
  } else if (sendResult.ok || sendResult.uncertain) {
    nextStatus = "outcome_unknown";
  }

  const resultPatch = {
    status: nextStatus,
    graph_send_attempted: true,
    graph_http_status: sendResult.status ?? null,
    graph_message_id: sendResult.message_id ?? null,
    graph_error: sendResult.ok ? null : sendResult.error || "Graph sendMail failed",
    completed_at: completedAt,
    outcome_detail: {
      version: TRANSMIT_VERSION,
      phase: "graph_sendMail",
      uncertain: sendResult.uncertain === true,
      http_status: sendResult.status ?? null,
    },
    external_side_effects: {
      email_sent: nextStatus === "sent",
      portal_touched: false,
      live_submission_attempted: true,
      lifecycle_advanced: false,
      graph_called: true,
      graph_send_mail_called: true,
      stage_5_advanced: false,
    },
    updated_at: completedAt,
  };

  if (claimSource === "table") {
    const updated = await updateTransmissionAttempt(supabase, attempt.id, applicationId, resultPatch);
    if (updated.data) attempt = updated.data;
    else attempt = { ...attempt, ...resultPatch };
  } else {
    attempt = { ...attempt, ...resultPatch };
  }

  await supabase
    .from("submission_preparations")
    .update({
      graph_send_attempted: true,
      external_side_effects: {
        email_sent: nextStatus === "sent",
        portal_touched: false,
        live_submission_attempted: true,
        lifecycle_advanced: false,
        graph_called: true,
        graph_send_mail_called: true,
      },
      updated_at: completedAt,
    })
    .eq("id", preparationId)
    .eq("application_id", applicationId);

  const freshApp = (await getApplicationById(supabase, applicationId)) || application;
  await mirrorTransmissionPointer(supabase, freshApp, attempt, {
    table_persisted: claimSource === "table",
  });

  const { data: appAfter } = await supabase
    .from("coordination_applications")
    .select("id, submitted_at")
    .eq("id", applicationId)
    .maybeSingle();
  if (appAfter?.submitted_at) {
    const err = new Error("Invariant violated: transmission must leave submitted_at null");
    err.statusCode = 500;
    err.code = "TRANSMIT_SIDE_EFFECT_INVARIANT";
    throw err;
  }

  return {
    ok: nextStatus === "sent",
    status: nextStatus,
    transmission_id: attempt.id,
    preparation_id: preparationId,
    from: sender.sender_mailbox,
    to: toRecipients,
    subject,
    attachment_count: binaries.length,
    attachment_names: attachmentNames,
    graph_http_status: sendResult.status ?? null,
    graph_message_id: sendResult.message_id ?? null,
    graph_error: sendResult.ok ? null : sendResult.error || null,
    graph_send_attempted: true,
    submitted_at: null,
    lifecycle_advanced: false,
    stage_5_advanced: false,
    table_persisted: claimSource === "table",
    idempotent_replay: false,
    message:
      nextStatus === "sent"
        ? "Transmission sent via Graph /me/sendMail (Stage 5 not advanced)"
        : nextStatus === "outcome_unknown"
          ? "Graph result uncertain — recorded outcome_unknown; do not blind retry"
          : sendResult.error || "Transmission failed",
    external_side_effects: resultPatch.external_side_effects,
  };
}

module.exports = {
  TRANSMIT_VERSION,
  SYNTHETIC_SUBJECT_PREFIX,
  transmitSubmissionPreparation,
  resolveTransmissionAttachments,
  ensureSyntheticSubject,
  ensureSyntheticBody,
};
