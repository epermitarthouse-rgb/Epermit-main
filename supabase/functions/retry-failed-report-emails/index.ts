import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface RetryRequest {
  logId: string;
  failedEmails?: string[];
}

interface BrandingSettings {
  logo_url: string | null;
  primary_color: string;
  header_text: string;
  footer_text: string;
  unsubscribe_text: string;
}

function adjustColor(color: string, percent: number): string {
  const num = parseInt(color.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = (num >> 16) + amt;
  const G = (num >> 8 & 0x00FF) + amt;
  const B = (num & 0x0000FF) + amt;
  return '#' + (
    0x1000000 +
    (R < 255 ? (R < 0 ? 0 : R) : 255) * 0x10000 +
    (G < 255 ? (G < 0 ? 0 : G) : 255) * 0x100 +
    (B < 255 ? (B < 0 ? 0 : B) : 255)
  ).toString(16).slice(1);
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    
    const { logId, failedEmails }: RetryRequest = await req.json();

    if (!logId) {
      return new Response(
        JSON.stringify({ error: "Missing logId" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log(`Retrying failed emails for log: ${logId}`);

    // Fetch the delivery log
    const { data: log, error: logError } = await supabase
      .from('scheduled_report_delivery_logs')
      .select('*')
      .eq('id', logId)
      .single();

    if (logError || !log) {
      console.error('Error fetching log:', logError);
      return new Response(
        JSON.stringify({ error: "Delivery log not found" }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Determine which emails to retry
    const emailsToRetry = failedEmails && failedEmails.length > 0 
      ? failedEmails 
      : log.failed_emails || [];

    if (emailsToRetry.length === 0) {
      return new Response(
        JSON.stringify({ error: "No failed emails to retry" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Fetch the original report configuration
    const { data: report, error: reportError } = await supabase
      .from('scheduled_checklist_reports')
      .select('*')
      .eq('id', log.report_id)
      .single();

    if (reportError || !report) {
      console.error('Error fetching report:', reportError);
      return new Response(
        JSON.stringify({ error: "Original report configuration not found" }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Fetch branding settings
    let branding: BrandingSettings = {
      logo_url: null,
      primary_color: '#0f4c5c',
      header_text: 'Insight|DesignCheck',
      footer_text: '© 2025 Insight|DesignCheck. All rights reserved.',
      unsubscribe_text: 'You are receiving this email because you subscribed to checklist reports.',
    };

    try {
      const { data: brandingData } = await supabase
        .from('email_branding_settings')
        .select('*')
        .limit(1)
        .single();
      
      if (brandingData) {
        branding = brandingData;
      }
    } catch (error) {
      console.log('Using default branding settings');
    }

    // Fetch checklists based on report filters
    let checklistQuery = supabase
      .from('saved_inspection_checklists')
      .select('*, projects(name)')
      .eq('user_id', report.user_id);

    if (report.project_filter && report.project_filter !== 'all') {
      checklistQuery = checklistQuery.eq('project_id', report.project_filter);
    }

    if (report.status_filter && report.status_filter !== 'all') {
      checklistQuery = checklistQuery.eq('status', report.status_filter);
    }

    const { data: checklists, error: checklistError } = await checklistQuery;

    if (checklistError) {
      console.error('Error fetching checklists:', checklistError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch checklists" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const checklistCount = checklists?.length || 0;
    const projectName = report.project_filter === 'all' || !report.project_filter 
      ? 'All Projects' 
      : checklists?.[0]?.projects?.name || 'Unknown Project';

    // Build email content
    const primaryColor = branding.primary_color;
    const gradientEnd = adjustColor(primaryColor, 20);
    const emailSubject = report.email_subject || `Inspection Checklists Report - ${report.name}`;
    const introText = report.email_intro || `Please find your scheduled inspection checklists report.`;

    const emailHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, ${primaryColor} 0%, ${gradientEnd} 100%); padding: 32px; border-radius: 12px 12px 0 0;">
          ${branding.logo_url 
            ? `<img src="${branding.logo_url}" alt="Logo" style="max-height: 50px; max-width: 200px;" />`
            : `<h1 style="color: white; margin: 0; font-size: 24px;">${branding.header_text}</h1>`
          }
          <h2 style="color: white; margin: 16px 0 0 0; font-size: 18px; font-weight: normal; opacity: 0.9;">
            Inspection Checklists Report (Retry)
          </h2>
        </div>
        <div style="background: #f8fafc; padding: 32px; border-radius: 0 0 12px 12px;">
          <div style="background: white; padding: 24px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
            <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6;">
              Hi${report.recipient_name ? ` ${report.recipient_name}` : ''},
            </p>
            <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6;">
              ${introText}
            </p>
            <div style="background: #f1f5f9; padding: 16px; border-radius: 8px; margin: 24px 0;">
              <p style="margin: 0; color: #64748b; font-size: 14px;">
                <strong>Report Summary:</strong><br>
                • Report: ${report.name}<br>
                • Project: ${projectName}<br>
                • Checklists: ${checklistCount}<br>
                • Generated: ${new Date().toLocaleDateString('en-US', { 
                  weekday: 'long', 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric' 
                })}
              </p>
            </div>
            <div style="border-top: 1px solid #e2e8f0; padding-top: 24px; margin-top: 24px;">
              <p style="margin: 0; color: #64748b; font-size: 14px;">
                Best regards,<br>
                <strong style="color: ${primaryColor};">The ${branding.header_text} Team</strong>
              </p>
            </div>
          </div>
          <p style="color: #64748b; font-size: 12px; margin-top: 24px; text-align: center;">
            ${branding.footer_text}
          </p>
        </div>
      </div>
    `;

    // Send emails to each failed recipient
    const results: { email: string; success: boolean; error?: string }[] = [];

    for (const email of emailsToRetry) {
      try {
        console.log(`Retrying email to: ${email}`);
        
        const emailRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${RESEND_API_KEY}`,
          },
          body: JSON.stringify({
            from: `${branding.header_text} <onboarding@resend.dev>`,
            to: [email],
            subject: emailSubject,
            html: emailHtml,
          }),
        });

        if (!emailRes.ok) {
          const errorData = await emailRes.json();
          console.error(`Failed to send to ${email}:`, errorData);
          results.push({ email, success: false, error: errorData.message });
        } else {
          console.log(`Successfully sent to ${email}`);
          results.push({ email, success: true });
        }
      } catch (error: any) {
        console.error(`Error sending to ${email}:`, error);
        results.push({ email, success: false, error: error.message });
      }
    }

    const successfulEmails = results.filter(r => r.success).map(r => r.email);
    const stillFailedEmails = results.filter(r => !r.success).map(r => r.email);
    
    // Calculate new totals
    const newSuccessfulCount = log.successful_count + successfulEmails.length;
    const newFailedCount = stillFailedEmails.length;
    const newStatus = newFailedCount === 0 ? 'success' : (newSuccessfulCount > 0 ? 'partial' : 'failed');

    // Create a new delivery log for the retry
    const { error: insertError } = await supabase
      .from('scheduled_report_delivery_logs')
      .insert({
        report_id: log.report_id,
        user_id: log.user_id,
        report_name: `${log.report_name} (Retry)`,
        recipient_emails: emailsToRetry,
        recipient_count: emailsToRetry.length,
        successful_count: successfulEmails.length,
        failed_count: stillFailedEmails.length,
        failed_emails: stillFailedEmails.length > 0 ? stillFailedEmails : null,
        status: stillFailedEmails.length === 0 ? 'success' : (successfulEmails.length > 0 ? 'partial' : 'failed'),
        error_message: stillFailedEmails.length > 0 
          ? `Retry: ${stillFailedEmails.length} email(s) still failed` 
          : null,
      });

    if (insertError) {
      console.error('Error logging retry:', insertError);
    }

    console.log(`Retry complete: ${successfulEmails.length} succeeded, ${stillFailedEmails.length} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        retried: emailsToRetry.length,
        succeeded: successfulEmails.length,
        failed: stillFailedEmails.length,
        stillFailedEmails,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in retry-failed-report-emails:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
