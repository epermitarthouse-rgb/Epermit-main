"use strict";

/**
 * Outbound Graph mail wrapper for UCI lifecycle templates.
 * Idempotency is stored on coordination_communications.agent_processed_metadata.idempotency_key.
 */

const { graphSendMail } = require("./uci-email-submission.service.js");
const { getValidAccessTokenForUser } = require("../microsoft/microsoft-graph-auth.service.js");
const { EMAIL_TEMPLATES } = require("./uci-lifecycle-constants.js");

function asMeta(row) {
  if (row?.agent_processed_metadata && typeof row.agent_processed_metadata === "object") {
    return /** @type {Record<string, unknown>} */ (row.agent_processed_metadata);
  }
  return {};
}

function templateContent(templateId, vars) {
  if (templateId === EMAIL_TEMPLATES.EQUIPMENT_ETA_CHECKIN) {
    return {
      subject: `Equipment ETA check-in — ${vars.project_name || "project"} / ${vars.equipment_type || "equipment"}`,
      body: [
        `Hello ${vars.utility_contact_name || "Utility project manager"},`,
        "",
        `Please confirm the current delivery ETA for ${vars.equipment_type || "long-lead equipment"}${
          vars.equipment_size ? ` (${vars.equipment_size})` : ""
        }.`,
        vars.current_eta ? `Last recorded ETA: ${vars.current_eta}.` : "No ETA is on file yet.",
        "",
        "Reply with the updated date and any change in status (on order / shipped / delivered).",
        "",
        "Thank you,",
        "Commun-ET Utility Coordination",
      ].join("\n"),
    };
  }
  if (templateId === EMAIL_TEMPLATES.METER_SET_REQUEST) {
    return {
      subject: `Meter set request — ${vars.project_name || "project"}`,
      body: [
        `Hello ${vars.utility_contact_name || "Utility project manager"},`,
        "",
        "Inspection release is on file. Please schedule the meter set and reply with the confirmed date.",
        vars.site_contact_name
          ? `Site contact: ${vars.site_contact_name} ${vars.site_contact_phone || ""} ${vars.site_contact_email || ""}`.trim()
          : "Site contact will be confirmed separately.",
        "",
        "Thank you,",
        "Commun-ET Utility Coordination",
      ].join("\n"),
    };
  }
  if (templateId === EMAIL_TEMPLATES.METER_SET_48H_CHECKLIST) {
    return {
      subject: `Meter set in 48 hours — site readiness checklist — ${vars.project_name || "project"}`,
      body: [
        `Hello ${vars.site_contact_name || "site contact"},`,
        "",
        `A meter set is scheduled for ${vars.scheduled_date || "the confirmed date"}.`,
        "Please confirm the following before the crew arrives:",
        "- Gates are open or access is arranged",
        "- The panel is accessible",
        "- Dummy meter is removed if temporary power is in place",
        "",
        "Reply to confirm site readiness.",
        "",
        "Commun-ET Utility Coordination",
      ].join("\n"),
    };
  }
  return {
    subject: String(vars.subject || "Utility coordination"),
    body: String(vars.body || ""),
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function findOutboundByIdempotencyKey(supabase, params) {
  const { coordinationRecordId, projectId, idempotencyKey } = params;
  const { data, error } = await supabase
    .from("coordination_communications")
    .select("*")
    .eq("coordination_record_id", coordinationRecordId)
    .eq("project_id", projectId)
    .eq("direction", "outbound")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error || !Array.isArray(data)) return null;
  return (
    data.find((row) => String(asMeta(row).idempotency_key || "") === String(idempotencyKey)) ||
    null
  );
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function sendUciOutboundEmail(supabase, params) {
  const {
    coordinationRecordId,
    projectId,
    userId = null,
    templateId,
    idempotencyKey,
    toEmail,
    vars = {},
    sendMailFn = null,
    getTokenFn = null,
    channel = "email",
  } = params;

  if (!toEmail) {
    return { sent: false, reason: "missing_recipient", idempotency_key: idempotencyKey };
  }

  const existing = await findOutboundByIdempotencyKey(supabase, {
    coordinationRecordId,
    projectId,
    idempotencyKey,
  });
  if (existing) {
    return { sent: false, reason: "already_sent", communication: existing, idempotency_key: idempotencyKey };
  }

  const content = templateContent(templateId, vars);
  /** @type {{ ok: boolean, error?: string, message_id?: string }} */
  let sendResult = { ok: false, error: "send_not_attempted" };

  const mailer = typeof sendMailFn === "function" ? sendMailFn : graphSendMail;
  try {
    let token = params.accessToken || null;
    if (!token && typeof getTokenFn === "function" && userId) {
      token = await getTokenFn(supabase, userId);
    } else if (!token && userId && sendMailFn == null) {
      token = await getValidAccessTokenForUser(supabase, userId);
    }
    if (!token && typeof sendMailFn !== "function") {
      sendResult = { ok: false, error: "mailbox_token_unavailable" };
    } else {
      sendResult = await mailer(token || "test-token", {
        subject: content.subject,
        body: content.body,
        toRecipients: [toEmail],
      });
    }
  } catch (err) {
    sendResult = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const row = {
    coordination_record_id: coordinationRecordId,
    project_id: projectId,
    direction: "outbound",
    channel,
    classification: templateId,
    classification_confidence: 1,
    raw_subject: content.subject,
    raw_body: content.body,
    raw_attachments: [],
    parsed_summary: content.subject,
    parsed_action_items: [],
    needs_human_attention: sendResult.ok !== true,
    agent_processed_metadata: {
      idempotency_key: idempotencyKey,
      template_id: templateId,
      send_ok: sendResult.ok === true,
      send_error: sendResult.error || null,
      message_id: sendResult.message_id || null,
    },
    sender: vars.from_email || null,
    recipient: toEmail,
    message_timestamp: new Date().toISOString(),
  };

  const { data: inserted, error } = await supabase
    .from("coordination_communications")
    .insert(row)
    .select("*")
    .single();

  if (error) {
    return {
      sent: sendResult.ok === true,
      reason: sendResult.ok ? "sent_persist_failed" : "send_failed",
      error: error.message,
      send: sendResult,
      idempotency_key: idempotencyKey,
    };
  }

  return {
    sent: sendResult.ok === true,
    reason: sendResult.ok ? "sent" : "send_failed",
    communication: inserted,
    send: sendResult,
    idempotency_key: idempotencyKey,
    template_id: templateId,
  };
}

module.exports = {
  EMAIL_TEMPLATES,
  templateContent,
  findOutboundByIdempotencyKey,
  sendUciOutboundEmail,
};
