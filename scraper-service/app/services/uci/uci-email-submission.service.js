"use strict";

const { getValidAccessTokenForUser } = require("../microsoft/microsoft-graph-auth.service.js");
const { resolveAddressFromApplicationPackageSnapshot } = require("./uci-provider-setup.service.js");
const { formatUciPackageVersionLabel } = require("./uci-capability-labels.js");

const EMAIL_SUBMIT_VERSION = "d4-email-v1";
const EMAIL_TEMPLATE_VERSION = "uci-outbound-email-v2";
const SYNTHETIC_BODY_WARNING =
  "This package contains synthetic test documents and is not for construction or utility submission.";
const SYNTHETIC_NO_EXTERNAL_BANNER = "SYNTHETIC TEST — NO EXTERNAL SUBMISSION";
const SYNTHETIC_SUBJECT_PREFIX = "[TEST]";

/**
 * @param {Record<string, unknown> | null | undefined} application
 */
function packageMetaFromApplication(application) {
  const draft =
    application &&
    application.agent_draft_metadata &&
    typeof application.agent_draft_metadata === "object" &&
    !Array.isArray(application.agent_draft_metadata)
      ? application.agent_draft_metadata
      : null;
  const pkg = draft && draft.application_package;
  return pkg && typeof pkg === "object" && !Array.isArray(pkg) ? pkg : null;
}

/**
 * Recipient-facing synthetic flag (checklist_mode), not Highland-hardcoded.
 * @param {Record<string, unknown> | null | undefined} application
 */
function isSyntheticOutboundPackage(application) {
  const pkg = packageMetaFromApplication(application);
  return String(pkg?.checklist_mode ?? "") === "synthetic_test";
}

/**
 * @param {unknown} raw
 */
function formatApplicationTypeLabel(raw) {
  const s = String(raw ?? "new_service")
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
  if (!s) return "New service";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Canonical recipient-facing Stage 4 email subject + body.
 * Shared by prepare/preview and Graph sendMail payload builders.
 * Never includes internal agent IDs, Graph/API jargon, or live-send authorization copy.
 *
 * @param {Record<string, unknown>} application
 * @param {Record<string, unknown>} project
 * @param {string} [_providerSlug] unused — kept for call-site compatibility
 * @param {{
 *   attachmentCount?: number,
 *   synthetic?: boolean,
 *   packageSnapshotVersion?: string | null,
 * }} [options]
 */
function buildUtilitySubmissionEmailContent(application, project, _providerSlug, options = {}) {
  const address = resolveAddressFromApplicationPackageSnapshot(application, project);
  const projectLabel =
    (project && project.name != null && String(project.name).trim()) ||
    (address.formatted && String(address.formatted).trim()) ||
    "project";
  const applicationType = formatApplicationTypeLabel(application.application_type);
  const synthetic =
    typeof options.synthetic === "boolean"
      ? options.synthetic
      : isSyntheticOutboundPackage(application);

  const attachedDocs = Array.isArray(application.package_documents)
    ? /** @type {Array<Record<string, unknown>>} */ (application.package_documents).filter(
        (d) => String(d.status) === "attached",
      )
    : [];
  const attachmentCount =
    typeof options.attachmentCount === "number" && Number.isFinite(options.attachmentCount)
      ? Math.max(0, Math.floor(options.attachmentCount))
      : attachedDocs.length;

  const subjectBase = `Utility Coordination Application Package — ${projectLabel}`;
  const subject = synthetic ? `${SYNTHETIC_SUBJECT_PREFIX} ${subjectBase}` : subjectBase;

  /** @type {string[]} */
  const bodyLines = [
    "Hello,",
    "",
    `Please find attached the utility coordination application package for ${projectLabel}.`,
    "",
    `Project: ${projectLabel}`,
    `Address: ${address.formatted || "(not set)"}`,
    `Application type: ${applicationType}`,
    "",
    `Attachments: ${attachmentCount}`,
  ];

  if (synthetic) {
    bodyLines.push("", SYNTHETIC_NO_EXTERNAL_BANNER);
    bodyLines.push(SYNTHETIC_BODY_WARNING);
  }

  bodyLines.push("", "Regards,", "Commun-ET");

  const body = bodyLines.join("\n");

  // Audit-only humanized package label (not placed in recipient body).
  const packageSnapshotVersion =
    options.packageSnapshotVersion != null
      ? String(options.packageSnapshotVersion)
      : null;
  const packageVersionLabel = packageSnapshotVersion
    ? formatUciPackageVersionLabel(packageSnapshotVersion)
    : null;

  return {
    subject,
    body,
    attachedDocs,
    attachment_count: attachmentCount,
    synthetic_test: synthetic,
    template_version: EMAIL_TEMPLATE_VERSION,
    // Metadata for Tracker/audit — never required in MIME body.
    audit: {
      package_snapshot_version: packageSnapshotVersion,
      package_version_label: packageVersionLabel,
      generator: "Submission and Confirmation Tracker",
    },
  };
}

/**
 * @param {unknown} list
 * @returns {Array<{ emailAddress: { address: string } }>}
 */
function toGraphRecipients(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const email =
      typeof item === "string"
        ? item.trim()
        : item && typeof item === "object" && item.email
          ? String(item.email).trim()
          : item && typeof item === "object" && item.address
            ? String(item.address).trim()
            : "";
    const normalized = email.toLowerCase();
    if (!normalized || !normalized.includes("@") || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push({ emailAddress: { address: email } });
  }
  return out;
}

/**
 * @param {string} accessToken
 * @param {object} message
 * @param {string} message.subject
 * @param {string} message.body
 * @param {Array<string|{email?: string, address?: string}>} [message.toRecipients]
 * @param {Array<string|{email?: string, address?: string}>} [message.ccRecipients]
 * @param {Array<{ file_name?: string, content_base64?: string, content_type?: string }>} [message.attachments]
 * @param {AbortSignal} [message.signal]
 */
async function graphSendMail(accessToken, message) {
  const graphAttachments = (message.attachments || [])
    .filter((a) => a.content_base64)
    .map((a) => ({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: a.file_name || "attachment.pdf",
      contentType: a.content_type || "application/pdf",
      contentBytes: a.content_base64,
    }));

  const toRecipients = toGraphRecipients(message.toRecipients);
  const ccRecipients = toGraphRecipients(message.ccRecipients);
  if (toRecipients.length === 0) {
    return { ok: false, status: 400, error: "toRecipients is required for Graph sendMail" };
  }

  const payload = {
    message: {
      subject: message.subject,
      body: {
        contentType: "Text",
        content: message.body,
      },
      toRecipients,
      ccRecipients: ccRecipients.length ? ccRecipients : undefined,
      attachments: graphAttachments.length ? graphAttachments : undefined,
    },
    saveToSentItems: true,
  };

  let r;
  try {
    r = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: message.signal,
    });
  } catch (err) {
    const name = err && typeof err === "object" && "name" in err ? String(err.name) : "";
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      uncertain: true,
      status: 0,
      error: name === "AbortError" ? `Graph sendMail timed out: ${msg}` : `Graph sendMail network error: ${msg}`,
    };
  }

  if (!r.ok) {
    const text = await r.text();
    let detail = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text);
      if (parsed?.error?.message) detail = String(parsed.error.message);
    } catch {
      /* ignore */
    }
    return { ok: false, status: r.status, error: detail, uncertain: false };
  }

  const sentAfter = new Date(Date.now() - 15 * 1000);
  const to = (message.toRecipients || []).map((item) =>
    typeof item === "string" ? item : item?.email || item?.address || "",
  );
  let reconciled = { ok: true, reconciled: false, message_id: null, internet_message_id: null };
  try {
    const { reconcileSentItemsMessage } = require("./uci-graph-sent-items.service.js");
    reconciled = await reconcileSentItemsMessage(accessToken, {
      subject: message.subject,
      to,
      sentAfter,
      fetchFn: message.fetchFn,
      attempts: message.reconcileAttempts,
      delayMs: message.reconcileDelayMs,
    });
  } catch (err) {
    reconciled = {
      ok: true,
      reconciled: false,
      message_id: null,
      internet_message_id: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return {
    ok: true,
    status: r.status,
    message_id: reconciled.message_id || null,
    internet_message_id: reconciled.internet_message_id || null,
    reconciled: reconciled.reconciled === true,
    unreconciled: reconciled.reconciled !== true,
    uncertain: reconciled.reconciled !== true,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 * @param {Record<string, unknown>} params.application
 * @param {Record<string, unknown>} params.project
 * @param {string} params.userId
 * @param {string} params.providerSlug
 * @param {(accessToken: string, message: object) => Promise<{ ok: boolean, message_id?: string, error?: string }>} [params.sendMailFn]
 * @param {() => Promise<Array<{ file_name: string, content_base64: string, content_type?: string }>>} [params.resolveAttachmentsFn]
 * @param {() => Promise<string>} [params.getAccessTokenFn]
 */
async function sendUtilitySubmissionEmail(supabase, params) {
  const {
    application,
    project,
    userId,
    providerSlug,
    sendMailFn = graphSendMail,
    resolveAttachmentsFn,
    getAccessTokenFn,
  } = params;

  let accessToken = "";
  if (typeof getAccessTokenFn === "function") {
    try {
      accessToken = await getAccessTokenFn();
    } catch (err) {
      return {
        ok: false,
        code: "MAILBOX_NOT_CONNECTED",
        message: err instanceof Error ? err.message : "Mailbox unavailable",
        status: "human_required",
      };
    }
  } else {
    const tokenResult = await getValidAccessTokenForUser(supabase, userId).catch((err) => {
      const code =
        err && typeof err === "object" && "code" in err
          ? String(/** @type {{ code?: unknown }} */ (err).code)
          : "MAILBOX_NOT_CONNECTED";
      return { ok: false, code, message: err instanceof Error ? err.message : "Mailbox unavailable" };
    });

    if (
      typeof tokenResult === "object" &&
      tokenResult &&
      "ok" in tokenResult &&
      tokenResult.ok === false
    ) {
      return {
        ok: false,
        code: tokenResult.code || "MAILBOX_NOT_CONNECTED",
        message:
          tokenResult.message ||
          "Microsoft mailbox is not connected — connect mailbox in Settings before email submission",
        status: "human_required",
      };
    }

    accessToken = typeof tokenResult === "string" ? tokenResult : "";
  }

  if (!accessToken) {
    return {
      ok: false,
      code: "MAILBOX_NOT_CONNECTED",
      message: "Microsoft mailbox is not connected — connect mailbox in Settings before email submission",
      status: "human_required",
    };
  }

  const emailContent = buildUtilitySubmissionEmailContent(application, project, providerSlug);
  /** @type {Array<{ file_name: string, content_base64: string, content_type?: string }>} */
  let binaryAttachments = [];
  if (resolveAttachmentsFn) {
    try {
      binaryAttachments = await resolveAttachmentsFn();
    } catch (err) {
      return {
        ok: false,
        code: "ATTACHMENT_RESOLVE_FAILED",
        message: err instanceof Error ? err.message : "Failed to resolve email attachments",
        status: "failed",
      };
    }
  }

  const sendResult = await sendMailFn(accessToken, {
    subject: emailContent.subject,
    body: emailContent.body,
    attachments: binaryAttachments,
  });

  if (!sendResult.ok) {
    return {
      ok: false,
      code: "EMAIL_SEND_FAILED",
      message: sendResult.error || "Outbound email delivery failed",
      status: "failed",
      retryable: true,
    };
  }

  return {
    ok: true,
    status: "confirmed",
    version: EMAIL_SUBMIT_VERSION,
    message_id: sendResult.message_id ?? null,
    internet_message_id: sendResult.internet_message_id ?? null,
    reconciled: sendResult.reconciled === true,
    unreconciled: sendResult.unreconciled === true,
    subject: emailContent.subject,
    attachment_count: binaryAttachments.length,
    referenced_documents: emailContent.attachedDocs.map((d) => ({
      key: d.key != null ? String(d.key) : null,
      file_name: d.file_name != null ? String(d.file_name) : null,
      project_document_id:
        d.project_document_id != null ? String(d.project_document_id) : null,
    })),
  };
}

module.exports = {
  EMAIL_SUBMIT_VERSION,
  EMAIL_TEMPLATE_VERSION,
  SYNTHETIC_BODY_WARNING,
  SYNTHETIC_NO_EXTERNAL_BANNER,
  SYNTHETIC_SUBJECT_PREFIX,
  isSyntheticOutboundPackage,
  formatApplicationTypeLabel,
  buildUtilitySubmissionEmailContent,
  graphSendMail,
  sendUtilitySubmissionEmail,
};
