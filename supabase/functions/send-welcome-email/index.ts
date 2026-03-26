import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface WelcomeEmailRequest {
  email: string;
  name: string;
  companyName?: string;
  firstProjectName?: string;
}

const handler = async (req: Request): Promise<Response> => {
  console.log("Welcome email function invoked");

  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, name, companyName, firstProjectName }: WelcomeEmailRequest = await req.json();
    
    console.log(`Sending welcome email to ${email} for user ${name}`);

    if (!email || !name) {
      throw new Error("Email and name are required");
    }

    const firstName = name.split(" ")[0];
    const currentYear = new Date().getFullYear();

    // Build the email HTML
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to Insight|DesignCheck</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #1e293b; margin: 0; padding: 0; background-color: #f8fafc;">
        <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
          <!-- Header -->
          <div style="text-align: center; margin-bottom: 40px;">
            <h1 style="color: #0ea5e9; font-size: 28px; margin: 0;">
              Insight|DesignCheck
            </h1>
            <p style="color: #64748b; margin-top: 8px;">Permit Intelligence Platform</p>
          </div>

          <!-- Welcome Card -->
          <div style="background: white; border-radius: 12px; padding: 32px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05); margin-bottom: 24px;">
            <h2 style="color: #0f172a; font-size: 24px; margin: 0 0 16px 0;">
              Welcome aboard, ${firstName}! 🚀
            </h2>
            
            <p style="color: #475569; margin-bottom: 24px;">
              ${companyName ? `We're excited to have <strong>${companyName}</strong> join our platform. ` : ""}
              You've just taken the first step toward streamlining your permit management workflow.
              ${firstProjectName ? ` Your first project <strong>"${firstProjectName}"</strong> is ready to go!` : ""}
            </p>

            <a href="https://review-resolve-ai.lovable.app/dashboard" 
               style="display: inline-block; background: linear-gradient(135deg, #0ea5e9, #0284c7); color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; margin-bottom: 16px;">
              Go to Dashboard →
            </a>
          </div>

          <!-- Quick Start Tips -->
          <div style="background: white; border-radius: 12px; padding: 32px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05); margin-bottom: 24px;">
            <h3 style="color: #0f172a; font-size: 18px; margin: 0 0 20px 0;">
              🎯 Quick Start Tips
            </h3>

            <div style="margin-bottom: 20px; padding-left: 16px; border-left: 3px solid #0ea5e9;">
              <h4 style="color: #0f172a; margin: 0 0 4px 0; font-size: 15px;">1. Upload Your Documents</h4>
              <p style="color: #64748b; margin: 0; font-size: 14px;">
                Add permit drawings, structural calculations, and site plans to your projects for easy tracking.
              </p>
            </div>

            <div style="margin-bottom: 20px; padding-left: 16px; border-left: 3px solid #22c55e;">
              <h4 style="color: #0f172a; margin: 0 0 4px 0; font-size: 15px;">2. Look Up Jurisdiction Requirements</h4>
              <p style="color: #64748b; margin: 0; font-size: 14px;">
                Use our database of 500+ jurisdictions to find submission requirements, fees, and SLA times.
              </p>
            </div>

            <div style="margin-bottom: 20px; padding-left: 16px; border-left: 3px solid #f59e0b;">
              <h4 style="color: #0f172a; margin: 0 0 4px 0; font-size: 15px;">3. Track Your Progress</h4>
              <p style="color: #64748b; margin: 0; font-size: 14px;">
                Move projects through stages from Draft → Submitted → In Review → Approved.
              </p>
            </div>

            <div style="padding-left: 16px; border-left: 3px solid #8b5cf6;">
              <h4 style="color: #0f172a; margin: 0 0 4px 0; font-size: 15px;">4. Schedule Inspections</h4>
              <p style="color: #64748b; margin: 0; font-size: 14px;">
                Keep track of inspection dates, results, and punch list items all in one place.
              </p>
            </div>
          </div>

          <!-- Feature Highlights -->
          <div style="background: linear-gradient(135deg, #0f172a, #1e293b); border-radius: 12px; padding: 32px; margin-bottom: 24px;">
            <h3 style="color: white; font-size: 18px; margin: 0 0 20px 0;">
              ✨ Key Features to Explore
            </h3>

            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 12px; vertical-align: top; width: 50%;">
                  <div style="background: rgba(255,255,255,0.1); border-radius: 8px; padding: 16px;">
                    <div style="font-size: 24px; margin-bottom: 8px;">📊</div>
                    <h4 style="color: white; margin: 0 0 4px 0; font-size: 14px;">Analytics Dashboard</h4>
                    <p style="color: #94a3b8; margin: 0; font-size: 12px;">Track cycle times, costs, and approval rates</p>
                  </div>
                </td>
                <td style="padding: 12px; vertical-align: top; width: 50%;">
                  <div style="background: rgba(255,255,255,0.1); border-radius: 8px; padding: 16px;">
                    <div style="font-size: 24px; margin-bottom: 8px;">🗺️</div>
                    <h4 style="color: white; margin: 0 0 4px 0; font-size: 14px;">Jurisdiction Map</h4>
                    <p style="color: #94a3b8; margin: 0; font-size: 12px;">Visual map of permit requirements</p>
                  </div>
                </td>
              </tr>
              <tr>
                <td style="padding: 12px; vertical-align: top; width: 50%;">
                  <div style="background: rgba(255,255,255,0.1); border-radius: 8px; padding: 16px;">
                    <div style="font-size: 24px; margin-bottom: 8px;">🤖</div>
                    <h4 style="color: white; margin: 0 0 4px 0; font-size: 14px;">AI Tools</h4>
                    <p style="color: #94a3b8; margin: 0; font-size: 12px;">Pre-submittal detection & auto-fill</p>
                  </div>
                </td>
                <td style="padding: 12px; vertical-align: top; width: 50%;">
                  <div style="background: rgba(255,255,255,0.1); border-radius: 8px; padding: 16px;">
                    <div style="font-size: 24px; margin-bottom: 8px;">👥</div>
                    <h4 style="color: white; margin: 0 0 4px 0; font-size: 14px;">Team Collaboration</h4>
                    <p style="color: #94a3b8; margin: 0; font-size: 12px;">Invite team members & share projects</p>
                  </div>
                </td>
              </tr>
            </table>
          </div>

          <!-- Help Section -->
          <div style="background: white; border-radius: 12px; padding: 24px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05); margin-bottom: 24px; text-align: center;">
            <h3 style="color: #0f172a; font-size: 16px; margin: 0 0 12px 0;">
              Need Help Getting Started?
            </h3>
            <p style="color: #64748b; margin: 0 0 16px 0; font-size: 14px;">
              Our team is here to help you succeed.
            </p>
            <a href="https://review-resolve-ai.lovable.app/contact" 
               style="display: inline-block; background: #f1f5f9; color: #0f172a; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-weight: 500; font-size: 14px;">
              Contact Support
            </a>
          </div>

          <!-- Footer -->
          <div style="text-align: center; color: #94a3b8; font-size: 12px;">
            <p style="margin: 0 0 8px 0;">
              © ${currentYear} Insight|DesignCheck. All rights reserved.
            </p>
            <p style="margin: 0;">
              <a href="https://review-resolve-ai.lovable.app" style="color: #0ea5e9; text-decoration: none;">Visit Website</a>
              &nbsp;•&nbsp;
              <a href="https://review-resolve-ai.lovable.app/pricing" style="color: #0ea5e9; text-decoration: none;">Pricing</a>
              &nbsp;•&nbsp;
              <a href="https://review-resolve-ai.lovable.app/contact" style="color: #0ea5e9; text-decoration: none;">Contact</a>
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    // Send email via Resend API
    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "Insight|DesignCheck <onboarding@resend.dev>",
        to: [email],
        subject: `Welcome to Insight|DesignCheck, ${firstName}! 🎉`,
        html: htmlContent,
      }),
    });

    if (!emailResponse.ok) {
      const errorData = await emailResponse.json();
      console.error("Resend API error:", errorData);
      throw new Error(errorData.message || "Failed to send email");
    }

    const responseData = await emailResponse.json();

    console.log("Welcome email sent successfully:", responseData);

    return new Response(JSON.stringify({ success: true, data: responseData }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  } catch (error: any) {
    console.error("Error in send-welcome-email function:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
