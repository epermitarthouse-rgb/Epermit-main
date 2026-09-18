import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { dispatchJurisdictionNotification } from "../_shared/dispatchJurisdictionNotification.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface NotificationRequest {
  jurisdictionId: string;
  jurisdictionName: string;
  title: string;
  message: string;
  sendEmail?: boolean;
  scheduled?: boolean;
  adminUserId?: string;
  adminEmail?: string;
  actionType?: "notification_sent" | "scheduled_notification_sent";
  logActivity?: boolean;
}

async function isPlatformAdmin(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<boolean> {
  const { data: roleRows, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "super_admin"]);

  return !error && !!roleRows?.length;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const token = authHeader.replace("Bearer ", "");

    const isServiceRole = token === serviceRoleKey;
    let adminUserId: string | undefined;
    let adminEmail: string | undefined;

    const supabaseService = createClient(supabaseUrl, serviceRoleKey);

    if (isServiceRole) {
      // Internal/cron invocation — no JWT required
    } else {
      const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });

      const { data: claimsData, error: claimsError } = await supabaseUser.auth.getClaims(token);
      if (claimsError || !claimsData?.claims?.sub) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      adminUserId = claimsData.claims.sub as string;
      const isAdmin = await isPlatformAdmin(supabaseUser, adminUserId);
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: "Admin access required" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: userData } = await supabaseService.auth.admin.getUserById(adminUserId);
      adminEmail = userData.user?.email ?? "unknown";
    }

    const body: NotificationRequest = await req.json();
    const {
      jurisdictionId,
      jurisdictionName,
      title,
      message,
      sendEmail = true,
      scheduled = false,
      actionType = scheduled ? "scheduled_notification_sent" : "notification_sent",
      logActivity = true,
    } = body;

    if (body.adminUserId) adminUserId = body.adminUserId;
    if (body.adminEmail) adminEmail = body.adminEmail;

    if (!jurisdictionId || !title || !message) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const resend = resendApiKey ? new Resend(resendApiKey) : null;
    const appBaseUrl =
      Deno.env.get("APP_BASE_URL") ||
      Deno.env.get("SITE_URL") ||
      "https://app.permitpilot.com";

    const result = await dispatchJurisdictionNotification(
      supabaseService,
      resend,
      {
        jurisdictionId,
        jurisdictionName,
        title,
        message,
        sendEmail,
        scheduled,
      },
      {
        appBaseUrl,
        fromEmailEnv:
          Deno.env.get("NOTIFICATIONS_FROM_EMAIL") ||
          Deno.env.get("REPORTS_FROM_EMAIL") ||
          Deno.env.get("RESEND_FROM_EMAIL"),
      },
    );

    if (logActivity && adminUserId && adminEmail) {
      await supabaseService.from("admin_activity_log").insert({
        admin_user_id: adminUserId,
        admin_email: adminEmail,
        action_type: actionType,
        jurisdiction_id: jurisdictionId,
        jurisdiction_name: jurisdictionName,
        notification_title: title,
        notification_message: message,
        subscriber_count: result.totalSubscribers,
        email_sent: sendEmail,
        delivery_status: result.deliveryStatus,
        inapp_sent: result.inappSent,
        emails_sent_count: result.emailsSent,
        emails_failed_count: result.emailsFailed,
        error_message:
          result.deliveryStatus === "failed" || result.deliveryStatus === "partial"
            ? `in-app: ${result.inappSent}, emails sent: ${result.emailsSent}, failed: ${result.emailsFailed}`
            : null,
      });
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Error in send-jurisdiction-notification:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
