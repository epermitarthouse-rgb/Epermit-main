import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface EmailRequest {
  recipientEmail: string;
  recipientName: string;
  projectName: string;
  checklistCount: number;
  pdfBase64: string;
  fileName: string;
  customSubject?: string;
  customIntro?: string;
}

interface BrandingSettings {
  logo_url: string | null;
  primary_color: string;
  header_text: string;
  footer_text: string;
  unsubscribe_text: string;
}

// Helper function to adjust color brightness
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
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      recipientEmail, 
      recipientName, 
      projectName, 
      checklistCount, 
      pdfBase64, 
      fileName,
      customSubject,
      customIntro,
    }: EmailRequest = await req.json();

    // Validate required fields
    if (!recipientEmail || !pdfBase64 || !fileName) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    console.log(`Sending checklist report to ${recipientEmail}`);

    // Fetch branding settings
    let branding: BrandingSettings = {
      logo_url: null,
      primary_color: '#0f4c5c',
      header_text: 'Insight|DesignCheck',
      footer_text: '© 2025 Insight|DesignCheck. All rights reserved.',
      unsubscribe_text: 'You are receiving this email because you subscribed to checklist reports.',
    };

    try {
      const supabase = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!);
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

    const emailSubject = customSubject || `Inspection Checklists Report - ${projectName}`;
    const introText = customIntro || `Please find attached your inspection checklists report for <strong>${projectName}</strong>.`;
    const primaryColor = branding.primary_color;
    const gradientEnd = adjustColor(primaryColor, 20);

    const emailHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, ${primaryColor} 0%, ${gradientEnd} 100%); padding: 32px; border-radius: 12px 12px 0 0;">
          ${branding.logo_url 
            ? `<img src="${branding.logo_url}" alt="Logo" style="max-height: 50px; max-width: 200px;" />`
            : `<h1 style="color: white; margin: 0; font-size: 24px;">${branding.header_text}</h1>`
          }
          <h2 style="color: white; margin: 16px 0 0 0; font-size: 18px; font-weight: normal; opacity: 0.9;">
            Inspection Checklists Report
          </h2>
        </div>
        <div style="background: #f8fafc; padding: 32px; border-radius: 0 0 12px 12px;">
          <div style="background: white; padding: 24px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
            <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6;">
              Hi${recipientName ? ` ${recipientName}` : ''},
            </p>
            <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6;">
              ${introText}
            </p>
            <div style="background: #f1f5f9; padding: 16px; border-radius: 8px; margin: 24px 0;">
              <p style="margin: 0; color: #64748b; font-size: 14px;">
                <strong>Report Summary:</strong><br>
                • Project: ${projectName}<br>
                • Checklists Included: ${checklistCount}<br>
                • Generated: ${new Date().toLocaleDateString('en-US', { 
                  weekday: 'long', 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric' 
                })}
              </p>
            </div>
            <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6;">
              The PDF report is attached to this email.
            </p>
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
          <p style="color: #94a3b8; font-size: 11px; margin-top: 8px; text-align: center;">
            ${branding.unsubscribe_text}
          </p>
        </div>
      </div>
    `;

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: `${branding.header_text} <onboarding@resend.dev>`,
        to: [recipientEmail],
        subject: emailSubject,
        html: emailHtml,
        attachments: [
          {
            filename: fileName,
            content: pdfBase64,
          },
        ],
      }),
    });

    if (!emailRes.ok) {
      const errorData = await emailRes.json();
      console.error("Email sending error:", errorData);
      throw new Error(errorData.message || "Failed to send email");
    }

    const responseData = await emailRes.json();
    console.log("Email sent successfully:", responseData);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Report sent successfully",
        id: responseData.id,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error("Error in send-checklist-report function:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
