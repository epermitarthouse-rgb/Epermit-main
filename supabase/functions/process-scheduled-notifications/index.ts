import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resendApiKey = Deno.env.get("RESEND_API_KEY");

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    console.log("Processing scheduled notifications...");

    // Fetch pending notifications that are due
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

    if (!pendingNotifications || pendingNotifications.length === 0) {
      console.log("No pending notifications to process");
      return new Response(
        JSON.stringify({ message: "No pending notifications", processed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${pendingNotifications.length} notifications to process`);

    let processedCount = 0;
    let failedCount = 0;

    for (const notification of pendingNotifications) {
      try {
        // Mark as processing
        await supabase
          .from("scheduled_notifications")
          .update({ status: "processing" })
          .eq("id", notification.id);

        // Get subscribers for this jurisdiction
        const { data: subscribers, error: subError } = await supabase
          .from("jurisdiction_subscriptions")
          .select("user_id")
          .eq("jurisdiction_id", notification.jurisdiction_id);

        if (subError) throw subError;

        if (!subscribers || subscribers.length === 0) {
          await supabase
            .from("scheduled_notifications")
            .update({
              status: "completed",
              processed_at: new Date().toISOString(),
              error_message: "No subscribers found",
            })
            .eq("id", notification.id);
          continue;
        }

        // Create in-app notifications
        const notifications = subscribers.map((sub: { user_id: string }) => ({
          user_id: sub.user_id,
          title: notification.notification_title,
          message: notification.notification_message,
          jurisdiction_id: notification.jurisdiction_id,
          jurisdiction_name: notification.jurisdiction_name,
        }));

        const { error: insertError } = await supabase
          .from("jurisdiction_notifications")
          .insert(notifications);

        if (insertError) throw insertError;

        // Send emails if enabled
        let emailsSent = 0;
        let emailsFailed = 0;

        if (notification.send_email && resendApiKey) {
          const resend = new Resend(resendApiKey);

          // Fetch branding settings
          const { data: brandingData } = await supabase
            .from("email_branding_settings")
            .select("*")
            .limit(1)
            .maybeSingle();

          const branding = brandingData || {
            header_text: "PermitPilot",
            primary_color: "#0f766e",
            footer_text: "© 2024 PermitPilot. All rights reserved.",
            unsubscribe_text: "Unsubscribe from these notifications",
            logo_url: null,
          };

          // Fetch user emails
          const userIds = subscribers.map((s: { user_id: string }) => s.user_id);
          const { data: usersData } = await supabase.auth.admin.listUsers();
          const userEmails = usersData?.users
            ?.filter((u) => userIds.includes(u.id))
            ?.map((u) => u.email)
            ?.filter(Boolean) as string[];

          for (const email of userEmails || []) {
            try {
              await resend.emails.send({
                from: `${branding.header_text} <onboarding@resend.dev>`,
                to: email,
                subject: `${notification.notification_title} - ${notification.jurisdiction_name}`,
                html: `
                  <!DOCTYPE html>
                  <html>
                  <head>
                    <meta charset="utf-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                  </head>
                  <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f4f5;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 20px;">
                      <tr>
                        <td align="center">
                          <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                            <tr>
                              <td style="background-color: ${branding.primary_color}; padding: 24px; text-align: center;">
                                ${branding.logo_url ? `<img src="${branding.logo_url}" alt="${branding.header_text}" style="max-height: 48px; margin-bottom: 8px;">` : ""}
                                <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: bold;">${branding.header_text}</h1>
                              </td>
                            </tr>
                            <tr>
                              <td style="padding: 32px;">
                                <p style="color: #6b7280; font-size: 14px; margin: 0 0 8px 0;">[Scheduled] Jurisdiction Code Update Notification</p>
                                <h2 style="color: #111827; font-size: 24px; font-weight: bold; margin: 0 0 16px 0;">${notification.notification_title}</h2>
                                <span style="display: inline-block; background-color: ${branding.primary_color}20; color: ${branding.primary_color}; padding: 6px 12px; border-radius: 9999px; font-size: 14px; font-weight: 500;">${notification.jurisdiction_name}</span>
                                <div style="background-color: #f7fafc; border-left: 4px solid ${branding.primary_color}; padding: 16px; margin: 24px 0;">
                                  <p style="color: #374151; margin: 0; line-height: 1.6;">${notification.notification_message}</p>
                                </div>
                                <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
                                <p style="color: #6b7280; font-size: 14px; margin: 0;">You are receiving this email because you subscribed to updates for this jurisdiction on ${branding.header_text}.</p>
                              </td>
                            </tr>
                            <tr>
                              <td style="background-color: #f9fafb; padding: 24px; text-align: center;">
                                <p style="color: #6b7280; font-size: 14px; margin: 0 0 8px 0;">${branding.footer_text}</p>
                                <a href="#" style="color: ${branding.primary_color}; font-size: 14px; text-decoration: none;">${branding.unsubscribe_text}</a>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </body>
                  </html>
                `,
              });
              emailsSent++;
            } catch (emailErr) {
              console.error(`Failed to send email to ${email}:`, emailErr);
              emailsFailed++;
            }
          }
        }

        // Log activity
        await supabase.from("admin_activity_log").insert({
          admin_user_id: notification.admin_user_id,
          admin_email: notification.admin_email,
          action_type: "scheduled_notification_sent",
          jurisdiction_id: notification.jurisdiction_id,
          jurisdiction_name: notification.jurisdiction_name,
          notification_title: notification.notification_title,
          notification_message: notification.notification_message,
          subscriber_count: subscribers.length,
          email_sent: notification.send_email,
          delivery_status: "success",
        });

        // Mark as completed
        await supabase
          .from("scheduled_notifications")
          .update({
            status: "completed",
            processed_at: new Date().toISOString(),
          })
          .eq("id", notification.id);

        processedCount++;
        console.log(`Processed notification ${notification.id} - ${subscribers.length} subscribers, ${emailsSent} emails sent`);
      } catch (err) {
        console.error(`Error processing notification ${notification.id}:`, err);
        
        await supabase
          .from("scheduled_notifications")
          .update({
            status: "failed",
            processed_at: new Date().toISOString(),
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
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in process-scheduled-notifications:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
