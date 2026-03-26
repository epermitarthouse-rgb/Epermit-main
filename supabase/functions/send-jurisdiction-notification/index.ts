import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface NotificationRequest {
  jurisdictionId: string;
  jurisdictionName: string;
  title: string;
  message: string;
}

interface BrandingSettings {
  header_text: string;
  primary_color: string;
  footer_text: string;
  unsubscribe_text: string;
  logo_url: string | null;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify JWT and check admin role
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = claimsData.claims.sub;

    // Check if user is admin
    const { data: roleData, error: roleError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .single();

    if (roleError || !roleData) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { jurisdictionId, jurisdictionName, title, message }: NotificationRequest = await req.json();

    if (!jurisdictionId || !title || !message) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use service role to get subscriber emails and branding settings
    const supabaseServiceRole = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get branding settings
    const { data: brandingData } = await supabaseServiceRole
      .from("email_branding_settings")
      .select("*")
      .limit(1)
      .single();

    const branding: BrandingSettings = brandingData || {
      header_text: "PermitPilot",
      primary_color: "#0f766e",
      footer_text: "© 2024 PermitPilot. All rights reserved.",
      unsubscribe_text: "Unsubscribe from these notifications",
      logo_url: null,
    };

    // Get all subscribers for this jurisdiction
    const { data: subscriptions, error: subsError } = await supabaseServiceRole
      .from("jurisdiction_subscriptions")
      .select("user_id")
      .eq("jurisdiction_id", jurisdictionId);

    if (subsError) {
      console.error("Error fetching subscriptions:", subsError);
      return new Response(JSON.stringify({ error: "Failed to fetch subscribers" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(JSON.stringify({ 
        success: true, 
        emailsSent: 0,
        message: "No subscribers found for this jurisdiction" 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get emails for all subscriber user IDs
    const userIds = subscriptions.map(s => s.user_id);
    const { data: users, error: usersError } = await supabaseServiceRole.auth.admin.listUsers();

    if (usersError) {
      console.error("Error fetching users:", usersError);
      return new Response(JSON.stringify({ error: "Failed to fetch user emails" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Filter to only subscribed users and get their emails
    const subscriberEmails = users.users
      .filter(user => userIds.includes(user.id))
      .map(user => user.email)
      .filter((email): email is string => !!email);

    if (subscriberEmails.length === 0) {
      return new Response(JSON.stringify({ 
        success: true, 
        emailsSent: 0,
        message: "No valid email addresses found" 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Sending emails to ${subscriberEmails.length} subscribers for ${jurisdictionName}`);
    console.log(`Using branding: ${branding.header_text}, color: ${branding.primary_color}`);

    // Build logo HTML if available
    const logoHtml = branding.logo_url 
      ? `<img src="${branding.logo_url}" alt="${branding.header_text}" style="max-height: 50px; margin-bottom: 10px;" />`
      : "";

    // Send emails to all subscribers
    const emailPromises = subscriberEmails.map(email =>
      resend.emails.send({
        from: `${branding.header_text} <onboarding@resend.dev>`,
        to: [email],
        subject: `Code Update: ${title}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: ${branding.primary_color}; padding: 20px; text-align: center;">
              ${logoHtml}
              <h2 style="color: #ffffff; margin: 0;">${branding.header_text}</h2>
            </div>
            <div style="padding: 30px;">
              <p style="color: #666; font-size: 14px; margin-bottom: 10px;">Jurisdiction Code Update Notification</p>
              <h1 style="color: #1a1a1a; margin-bottom: 15px;">${title}</h1>
              <div style="background-color: ${branding.primary_color}15; color: ${branding.primary_color}; padding: 8px 16px; border-radius: 20px; display: inline-block; font-size: 14px; font-weight: 500; margin-bottom: 20px;">
                ${jurisdictionName}
              </div>
              <div style="background-color: #f7fafc; border-left: 4px solid ${branding.primary_color}; padding: 15px; margin: 20px 0;">
                <p style="color: #4a5568; margin: 0; white-space: pre-wrap;">${message}</p>
              </div>
              <p style="color: #718096; font-size: 14px; margin-top: 30px;">
                You received this email because you subscribed to updates for ${jurisdictionName} on ${branding.header_text}.
              </p>
            </div>
            <div style="background-color: #f5f5f5; padding: 20px; text-align: center;">
              <p style="color: #666; font-size: 12px; margin: 0;">${branding.footer_text}</p>
              <p style="margin-top: 10px;">
                <a href="#" style="color: ${branding.primary_color}; font-size: 12px; text-decoration: none;">${branding.unsubscribe_text}</a>
              </p>
            </div>
          </div>
        `,
      })
    );

    const results = await Promise.allSettled(emailPromises);
    
    const successCount = results.filter(r => r.status === "fulfilled").length;
    const failCount = results.filter(r => r.status === "rejected").length;

    if (failCount > 0) {
      const errors = results
        .filter((r): r is PromiseRejectedResult => r.status === "rejected")
        .map(r => r.reason);
      console.error("Some emails failed to send:", errors);
    }

    console.log(`Successfully sent ${successCount} emails, ${failCount} failed`);

    return new Response(JSON.stringify({ 
      success: true, 
      emailsSent: successCount,
      emailsFailed: failCount,
      totalSubscribers: subscriberEmails.length
    }), {
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