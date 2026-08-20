"use strict";

/**
 * Graph inbound NDR / bounce handling for Stage 4 email submissions.
 * Bounce is not one of the 11 Agent 5 categories — it reopens the application.
 */

const BOUNCE_SENDER_RE =
  /mailer-daemon|postmaster|noreply@microsoft|microsoftexchange|notification.*delivery/i;
const BOUNCE_SUBJECT_RE =
  /undeliverable|delivery status notification|delivery failure|returned mail|failure notice/i;

function isBounceMessage(normalized) {
  const sender = String(normalized?.sender || normalized?.from?.emailAddress?.address || "");
  const subject = String(normalized?.raw_subject || normalized?.subject || "");
  const body = String(normalized?.raw_body || normalized?.bodyPreview || "");
  if (BOUNCE_SENDER_RE.test(sender)) return true;
  if (BOUNCE_SUBJECT_RE.test(subject)) return true;
  if (/wasn't delivered|could not be delivered|permanent failure/i.test(body)) return true;
  return false;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function applyEmailBounce(supabase, params) {
  const { projectId, internetMessageId, graphMessageId, communication } = params;
  const now = new Date().toISOString();

  let query = supabase
    .from("coordination_applications")
    .select("*")
    .eq("project_id", projectId)
    .not("submitted_at", "is", null)
    .order("submitted_at", { ascending: false })
    .limit(25);

  const { data } = await query;
  const apps = Array.isArray(data) ? data : [];
  const target =
    apps.find((a) => graphMessageId && String(a.graph_message_id) === String(graphMessageId)) ||
    apps.find(
      (a) => internetMessageId && String(a.graph_internet_message_id) === String(internetMessageId),
    ) ||
    apps.find((a) => String(a.draft_status) === "submitted") ||
    null;

  if (!target) {
    return { bounced: false, reason: "no_submitted_application" };
  }

  const meta =
    target.agent_draft_metadata && typeof target.agent_draft_metadata === "object"
      ? target.agent_draft_metadata
      : {};

  await supabase
    .from("coordination_applications")
    .update({
      draft_status: "failed",
      email_bounced_at: now,
      last_error: "Outbound submission email bounced",
      agent_draft_metadata: {
        ...meta,
        email_bounce: {
          at: now,
          communication_id: communication?.id || null,
          graph_message_id: graphMessageId || null,
        },
      },
    })
    .eq("id", target.id);

  return {
    bounced: true,
    application_id: target.id,
    coordination_record_id: target.coordination_record_id,
  };
}

module.exports = {
  isBounceMessage,
  applyEmailBounce,
};
