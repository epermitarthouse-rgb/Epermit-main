import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  processorUnauthorizedResponse,
  verifyProcessorRequest,
} from "../_shared/processorAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ScheduledRow {
  id: string;
  admin_user_id: string;
  admin_email: string;
  jurisdiction_id: string;
  jurisdiction_name: string;
  notification_title: string;
  notification_message: string;
  send_email: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = verifyProcessorRequest(req);
  if (!auth.authorized) {
    return processorUnauthorizedResponse(auth, corsHeaders);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    console.log("Processing scheduled notifications...");

    const { data: pendingNotifications, error: fetchError } = await supabase
      .from("scheduled_notifications")
      .select("*")
      .eq("status", "pending")
      .lte("scheduled_for", new Date().toISOString())
      .order("scheduled_for", { ascending: true })
      .limit(10);

    if (fetchError) {
      console.error("Error fetching scheduled notifications:", fetchError);
      throw fetchError;
    }

    if (!pendingNotifications?.length) {
      return new Response(
        JSON.stringify({ message: "No pending notifications", processed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let processedCount = 0;
    let failedCount = 0;

    for (const notification of pendingNotifications as ScheduledRow[]) {
      try {
        await supabase
          .from("scheduled_notifications")
          .update({ status: "processing" })
          .eq("id", notification.id);

        const dispatchResponse = await fetch(
          `${supabaseUrl}/functions/v1/send-jurisdiction-notification`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify({
              jurisdictionId: notification.jurisdiction_id,
              jurisdictionName: notification.jurisdiction_name,
              title: notification.notification_title,
              message: notification.notification_message,
              sendEmail: notification.send_email,
              scheduled: true,
              adminUserId: notification.admin_user_id,
              adminEmail: notification.admin_email,
              actionType: "scheduled_notification_sent",
              logActivity: true,
            }),
          },
        );

        const dispatchBody = await dispatchResponse.json();

        if (!dispatchResponse.ok) {
          throw new Error(dispatchBody.error || "Dispatch failed");
        }

        await supabase
          .from("scheduled_notifications")
          .update({
            status: dispatchBody.deliveryStatus === "failed" ? "failed" : "completed",
            processed_at: new Date().toISOString(),
            delivery_status: dispatchBody.deliveryStatus,
            inapp_sent: dispatchBody.inappSent ?? 0,
            emails_sent_count: dispatchBody.emailsSent ?? 0,
            emails_failed_count: dispatchBody.emailsFailed ?? 0,
            error_message:
              dispatchBody.deliveryStatus === "no_subscribers"
                ? "No subscribers found"
                : dispatchBody.deliveryStatus === "failed" ||
                    dispatchBody.deliveryStatus === "partial"
                  ? `Delivery ${dispatchBody.deliveryStatus}: in-app ${dispatchBody.inappSent}, emails ${dispatchBody.emailsSent}/${dispatchBody.emailsFailed} failed`
                  : null,
          })
          .eq("id", notification.id);

        if (dispatchBody.deliveryStatus === "failed") {
          failedCount++;
        } else {
          processedCount++;
        }

        console.log(
          `Processed notification ${notification.id} — status ${dispatchBody.deliveryStatus}`,
        );
      } catch (err) {
        console.error(`Error processing notification ${notification.id}:`, err);

        await supabase
          .from("scheduled_notifications")
          .update({
            status: "failed",
            processed_at: new Date().toISOString(),
            delivery_status: "failed",
            error_message: err instanceof Error ? err.message : "Unknown error",
          })
          .eq("id", notification.id);

        failedCount++;
      }
    }

    return new Response(
      JSON.stringify({
        message: "Processing complete",
        processed: processedCount,
        failed: failedCount,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error in process-scheduled-notifications:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
