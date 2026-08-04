import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface TestEmailRequest {
  recipient_email: string;
  recipient_name?: string;
  report_name: string;
  project_filter: string;
  status_filter: string;
  frequency: string;
  email_subject?: string;
  email_intro?: string;
  include_summary: boolean;
  include_details: boolean;
}

interface BrandingSettings {
  logo_url: string | null;
  primary_color: string;
  header_text: string;
  footer_text: string;
  unsubscribe_text: string;
}

const DEFAULT_BRANDING: BrandingSettings = {
  logo_url: null,
  primary_color: "#0f4c5c",
  header_text: "Inspection Report",
  footer_text: "Best regards,\nThe Insight|DesignCheck Team",
  unsubscribe_text: "This is a test email. To manage your scheduled reports, visit your dashboard.",
};

function adjustColor(hex: string, amount: number): string {
  const clamp = (num: number) => Math.min(255, Math.max(0, num));
  const color = hex.replace("#", "");
  const num = parseInt(color, 16);
  const r = clamp((num >> 16) + amount);
  const g = clamp(((num >> 8) & 0x00ff) + amount);
  const b = clamp((num & 0x0000ff) + amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get user from auth header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authorization required" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    // Verify the user
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid authorization" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const body: TestEmailRequest = await req.json();
    console.log("Sending test email for report:", body.report_name);

    // Fetch branding settings
    const { data: brandingData } = await supabase
      .from("email_branding_settings")
      .select("*")
      .limit(1)
      .single();

    const branding: BrandingSettings = brandingData || DEFAULT_BRANDING;

    // Fetch sample checklists for the user
    let query = supabase
      .from("saved_inspection_checklists")
      .select("*")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(5);

    if (body.status_filter && body.status_filter !== "all") {
      query = query.eq("status", body.status_filter);
    }

    const { data: checklists } = await query;

    // Filter by project if needed
    let filteredChecklists = checklists || [];
    if (body.project_filter && body.project_filter !== "all") {
      filteredChecklists = filteredChecklists.filter(
        (c: any) => c.form_data?.projectName === body.project_filter
      );
    }

    // Generate sample summary
    const allItems = filteredChecklists.flatMap((c: any) => [
      ...(c.checklist_items || []),
      ...(c.custom_items || []),
    ]);

    const summary = {
      total: filteredChecklists.length || 3, // Use sample data if none
      passed: allItems.filter((i: any) => i.status === "pass").length || 12,
      failed: allItems.filter((i: any) => i.status === "fail").length || 2,
      pending: allItems.filter((i: any) => i.status === "pending").length || 5,
    };

    // Build email
    const projectName = body.project_filter !== "all" ? body.project_filter : "All Projects";
    const emailSubject = body.email_subject || `[TEST] ${body.frequency === "weekly" ? "Weekly" : "Monthly"} Inspection Report - ${projectName}`;
    const emailIntro = body.email_intro || `Here is your ${body.frequency} inspection checklists report.`;

    // Get first email from comma-separated list
    const testEmail = body.recipient_email.split(',')[0].trim();
    const testName = body.recipient_name?.split(',')[0]?.trim() || '';

    const emailHtml = buildEmailHtml(
      testName,
      projectName,
      emailIntro,
      filteredChecklists.length > 0 ? filteredChecklists : getSampleChecklists(),
      summary,
      body.include_summary,
      body.include_details,
      branding
    );

    // Send test email
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "Insight|DesignCheck <onboarding@resend.dev>",
        to: [testEmail],
        subject: emailSubject,
        html: emailHtml,
      }),
    });

    if (!emailRes.ok) {
      const errorData = await emailRes.json();
      console.error("Failed to send test email:", errorData);
      return new Response(
        JSON.stringify({ error: "Failed to send test email", details: errorData }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log(`Test email sent to ${testEmail}`);

    return new Response(
      JSON.stringify({ success: true, message: `Test email sent to ${testEmail}` }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in send-test-scheduled-report:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

function getSampleChecklists() {
  return [
    {
      name: "Sample Foundation Inspection",
      status: "completed",
      form_data: { inspectionType: "Foundation", projectName: "Sample Project" },
    },
    {
      name: "Sample Framing Check",
      status: "signed",
      form_data: { inspectionType: "Framing", projectName: "Sample Project" },
    },
    {
      name: "Sample Electrical Rough",
      status: "in_progress",
      form_data: { inspectionType: "Electrical Rough", projectName: "Sample Project" },
    },
  ];
}

function buildEmailHtml(
  recipientName: string,
  projectName: string,
  intro: string,
  checklists: any[],
  summary: { total: number; passed: number; failed: number; pending: number },
  includeSummary: boolean,
  includeDetails: boolean,
  branding: BrandingSettings
): string {
  const greeting = recipientName ? `Hi ${recipientName},` : "Hi,";
  const primaryColor = branding.primary_color || "#0f4c5c";
  const gradientEnd = adjustColor(primaryColor, 30);
  const headerText = branding.header_text || "Inspection Report";
  const footerText = branding.footer_text || "Best regards,\nThe Insight|DesignCheck Team";
  const unsubscribeText = branding.unsubscribe_text || "This is a test email.";

  const logoHtml = branding.logo_url
    ? `<img src="${branding.logo_url}" alt="Logo" style="max-height: 48px; margin-bottom: 16px;" />`
    : "";

  let summarySection = "";
  if (includeSummary) {
    summarySection = `
      <div style="background: #f1f5f9; padding: 20px; border-radius: 8px; margin: 24px 0;">
        <h3 style="margin: 0 0 16px 0; color: ${primaryColor};">Report Summary</h3>
        <div style="display: flex; gap: 16px; flex-wrap: wrap;">
          <div style="background: white; padding: 12px 20px; border-radius: 6px; text-align: center; flex: 1; min-width: 80px;">
            <div style="font-size: 24px; font-weight: bold; color: ${primaryColor};">${summary.total}</div>
            <div style="font-size: 12px; color: #64748b;">Checklists</div>
          </div>
          <div style="background: #dcfce7; padding: 12px 20px; border-radius: 6px; text-align: center; flex: 1; min-width: 80px;">
            <div style="font-size: 24px; font-weight: bold; color: #16a34a;">${summary.passed}</div>
            <div style="font-size: 12px; color: #16a34a;">Passed</div>
          </div>
          <div style="background: #fee2e2; padding: 12px 20px; border-radius: 6px; text-align: center; flex: 1; min-width: 80px;">
            <div style="font-size: 24px; font-weight: bold; color: #dc2626;">${summary.failed}</div>
            <div style="font-size: 12px; color: #dc2626;">Failed</div>
          </div>
          <div style="background: #fef3c7; padding: 12px 20px; border-radius: 6px; text-align: center; flex: 1; min-width: 80px;">
            <div style="font-size: 24px; font-weight: bold; color: #ca8a04;">${summary.pending}</div>
            <div style="font-size: 12px; color: #ca8a04;">Pending</div>
          </div>
        </div>
      </div>
    `;
  }

  let detailsSection = "";
  if (includeDetails && checklists.length > 0) {
    const checklistRows = checklists.slice(0, 5).map((c) => {
      const statusColor = c.status === "signed" ? "#16a34a" : c.status === "completed" ? "#2563eb" : "#ca8a04";
      return `
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #e2e8f0;">${c.name}</td>
          <td style="padding: 12px; border-bottom: 1px solid #e2e8f0;">${c.form_data?.inspectionType || "N/A"}</td>
          <td style="padding: 12px; border-bottom: 1px solid #e2e8f0;">
            <span style="background: ${statusColor}20; color: ${statusColor}; padding: 4px 8px; border-radius: 4px; font-size: 12px;">
              ${c.status}
            </span>
          </td>
        </tr>
      `;
    }).join("");

    detailsSection = `
      <div style="margin: 24px 0;">
        <h3 style="margin: 0 0 16px 0; color: ${primaryColor};">Recent Checklists</h3>
        <table style="width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden;">
          <thead>
            <tr style="background: #f8fafc;">
              <th style="padding: 12px; text-align: left; color: #64748b; font-weight: 600;">Name</th>
              <th style="padding: 12px; text-align: left; color: #64748b; font-weight: 600;">Type</th>
              <th style="padding: 12px; text-align: left; color: #64748b; font-weight: 600;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${checklistRows}
          </tbody>
        </table>
      </div>
    `;
  }

  const formattedFooter = footerText.replace(/\n/g, "<br>");

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #fef3c7; padding: 12px; text-align: center; border-radius: 8px 8px 0 0;">
        <strong style="color: #92400e;">🧪 TEST EMAIL</strong>
        <span style="color: #92400e;"> - This is a preview of your scheduled report</span>
      </div>
      <div style="background: linear-gradient(135deg, ${primaryColor} 0%, ${gradientEnd} 100%); padding: 32px; border-radius: 0;">
        ${logoHtml}
        <h1 style="color: white; margin: 0; font-size: 24px;">${headerText}</h1>
        <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0 0;">${projectName}</p>
      </div>
      <div style="background: #f8fafc; padding: 32px; border-radius: 0 0 12px 12px;">
        <div style="background: white; padding: 24px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6;">${greeting}</p>
          <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6;">${intro}</p>
          ${summarySection}
          ${detailsSection}
          <div style="border-top: 1px solid #e2e8f0; padding-top: 24px; margin-top: 24px;">
            <p style="margin: 0; color: #64748b; font-size: 14px;">
              ${formattedFooter}
            </p>
          </div>
        </div>
        <p style="color: #64748b; font-size: 12px; margin-top: 24px; text-align: center;">
          ${unsubscribeText}
        </p>
      </div>
    </div>
  `;
}

serve(handler);
