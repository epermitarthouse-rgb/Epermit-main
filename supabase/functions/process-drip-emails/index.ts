import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";
import {
  processorUnauthorizedResponse,
  verifyDripProcessorRequest,
} from "../_shared/processorAuth.ts";
import {
  daysSinceEnrollment,
  isDripCampaignComplete,
  resolveNextDripEmailIndex,
} from "../_shared/dripCampaignLogic.ts";
import {
  DEFAULT_BRANDING,
  ONBOARDING_DRIP_TEMPLATES,
  resolveDripFromEmail,
  wrapDripEmailHtml,
  type BrandingSettings,
} from "../_shared/dripOnboardingEmail.ts";

const resendApiKey = Deno.env.get("RESEND_API_KEY");
const resend = resendApiKey ? new Resend(resendApiKey) : null;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  console.log("Processing drip email campaign...");

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await verifyDripProcessorRequest(req);
  if (!auth.authorized) {
    return processorUnauthorizedResponse(auth, corsHeaders);
  }

  if (!resend) {
    return new Response(
      JSON.stringify({ error: "Email provider not configured" }),
      { status: 503, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: brandingData } = await supabase
      .from("email_branding_settings")
      .select("*")
      .limit(1)
      .maybeSingle();

    const branding: BrandingSettings = brandingData ?? DEFAULT_BRANDING;
    const fromAddress = resolveDripFromEmail(branding.header_text);

    const { data: campaigns, error: fetchError } = await supabase
      .from("user_drip_campaigns")
      .select("*")
      .eq("is_active", true)
      .eq("campaign_type", "onboarding");

    if (fetchError) {
      console.error("Error fetching campaigns:", fetchError);
      throw fetchError;
    }

    console.log(`Found ${campaigns?.length || 0} active campaigns`);

    let emailsSent = 0;
    let campaignsCompleted = 0;
    const now = new Date();

    for (const campaign of campaigns || []) {
      const daysEnrolled = daysSinceEnrollment(campaign.enrolled_at, now);
      const nextIndex = resolveNextDripEmailIndex(daysEnrolled, campaign.emails_sent);

      if (nextIndex === null) {
        continue;
      }

      const template = ONBOARDING_DRIP_TEMPLATES[nextIndex];
      if (!template) {
        continue;
      }

      console.log(`Sending day ${template.day} email to ${campaign.email}`);

      try {
        const bodyHtml = template.getBodyHtml(campaign.user_name || "there");
        const html = wrapDripEmailHtml({ branding, bodyHtml });

        const { error: emailError } = await resend.emails.send({
          from: fromAddress,
          to: [campaign.email],
          subject: template.subject,
          html,
        });

        if (emailError) {
          console.error(`Error sending email to ${campaign.email}:`, emailError);
          continue;
        }

        console.log(`Successfully sent day ${template.day} email to ${campaign.email}`);
        emailsSent++;

        const newEmailsSent = campaign.emails_sent + 1;
        const isComplete = isDripCampaignComplete(newEmailsSent);

        const { error: updateError } = await supabase
          .from("user_drip_campaigns")
          .update({
            emails_sent: newEmailsSent,
            last_email_sent_at: now.toISOString(),
            is_active: !isComplete,
            completed_at: isComplete ? now.toISOString() : null,
          })
          .eq("id", campaign.id);

        if (updateError) {
          console.error(`Error updating campaign ${campaign.id}:`, updateError);
        }

        if (isComplete) {
          campaignsCompleted++;
          console.log(`Campaign ${campaign.id} completed`);
        }
      } catch (emailError) {
        console.error(`Failed to send email for campaign ${campaign.id}:`, emailError);
      }
    }

    console.log(
      `Drip campaign processing complete: ${emailsSent} emails sent, ${campaignsCompleted} campaigns completed`,
    );

    return new Response(
      JSON.stringify({
        success: true,
        emailsSent,
        campaignsCompleted,
        totalCampaigns: campaigns?.length || 0,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Error in process-drip-emails function:", error);
    return new Response(
      JSON.stringify({ error: message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      },
    );
  }
});
