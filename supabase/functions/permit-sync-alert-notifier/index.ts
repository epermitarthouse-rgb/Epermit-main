/**
 * permit-sync-alert-notifier (D-099). Invoked by pg_cron through invoke_permit_sync_alert_notifier() with the
 * service-role key. Reads open/resolved permit_sync_alerts, emails one digest through Resend and marks the
 * alerts notified. Never reads credentials, sessions or permit content. Not deployed automatically.
 *
 * Env: RESEND_API_KEY, RESEND_FROM_EMAIL, PERMIT_SYNC_ALERT_EMAILS (comma separated), APP_BASE_URL,
 *      PERMIT_SYNC_ALERT_INCLUDE_PERMIT_NUMBERS ("true" to show permit numbers; default masked).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyProcessorRequest } from "../_shared/processorAuth.ts";
import { buildAlertEmail, parseRecipients, selectAlertsToNotify, type PermitSyncAlert } from "../_shared/permitSyncAlertEmail.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const auth = verifyProcessorRequest(req);
  if (!auth.authorized) return json({ error: auth.error }, 401);

  const resendKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM_EMAIL");
  const recipients = parseRecipients(Deno.env.get("PERMIT_SYNC_ALERT_EMAILS"));
  const baseUrl = (Deno.env.get("APP_BASE_URL") ?? "").replace(/\/+$/, "");
  if (!resendKey || !from || !recipients.length || !baseUrl) {
    console.log(JSON.stringify({ event: "alert_notifier_skipped", reason: "not_configured" }));
    return json({ skipped: "not_configured" });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const { data, error } = await supabase
    .from("permit_sync_alerts")
    .select("id, alert_key, category, severity, title, detail, occurrences, first_seen_at, last_seen_at, resolved_at, notified_at, notify_count, resolution_notified_at")
    .or(`resolved_at.is.null,resolved_at.gte.${since}`)
    .order("last_seen_at", { ascending: false })
    .limit(200);
  if (error) {
    console.error(JSON.stringify({ event: "alert_notifier_read_failed", code: error.code }));
    return json({ error: "read_failed" }, 500);
  }

  const selection = selectAlertsToNotify((data ?? []) as PermitSyncAlert[], new Date());
  const email = buildAlertEmail(selection, {
    adminUrl: `${baseUrl}/admin/permit-sync`,
    includePermitNumbers: Deno.env.get("PERMIT_SYNC_ALERT_INCLUDE_PERMIT_NUMBERS") === "true",
  });
  if (!email) return json({ sent: 0 });

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: recipients, subject: email.subject, text: email.text, html: email.html }),
  });
  if (!res.ok) {
    console.error(JSON.stringify({ event: "alert_notifier_send_failed", status: res.status }));
    return json({ error: "send_failed", status: res.status }, 502);
  }

  for (const [kind, list] of [["open", selection.open], ["resolved", selection.resolved]] as const) {
    if (!list.length) continue;
    const { error: markError } = await supabase.rpc("mark_permit_sync_alerts_notified", { p_ids: list.map((a) => a.id), p_kind: kind });
    if (markError) console.error(JSON.stringify({ event: "alert_notifier_mark_failed", kind, code: markError.code }));
  }
  console.log(JSON.stringify({ event: "alert_notifier_sent", open: selection.open.length, resolved: selection.resolved.length, recipients: recipients.length }));
  return json({ sent: selection.open.length + selection.resolved.length });
});
