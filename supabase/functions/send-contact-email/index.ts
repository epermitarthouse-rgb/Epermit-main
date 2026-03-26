import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface ContactEmailRequest {
  firstName: string;
  lastName: string;
  email: string;
  message: string;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { firstName, lastName, email, message }: ContactEmailRequest = await req.json();

    // Validate required fields
    if (!firstName || !lastName || !email || !message) {
      return new Response(
        JSON.stringify({ error: "All fields are required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    const fullName = `${firstName} ${lastName}`;

    // Send notification email to the team
    const teamEmailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "Insight|DesignCheck <onboarding@resend.dev>",
        to: ["hello@insightdesigncheck.com"],
        reply_to: email,
        subject: `New Contact Form Submission from ${fullName}`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #0f4c5c 0%, #1a6b7d 100%); padding: 32px; border-radius: 12px 12px 0 0;">
              <h1 style="color: white; margin: 0; font-size: 24px;">New Contact Form Submission</h1>
            </div>
            <div style="background: #f8fafc; padding: 32px; border-radius: 0 0 12px 12px;">
              <div style="background: white; padding: 24px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                <p style="margin: 0 0 16px 0;"><strong>Name:</strong> ${fullName}</p>
                <p style="margin: 0 0 16px 0;"><strong>Email:</strong> <a href="mailto:${email}" style="color: #0f4c5c;">${email}</a></p>
                <p style="margin: 0 0 8px 0;"><strong>Message:</strong></p>
                <div style="background: #f1f5f9; padding: 16px; border-radius: 8px; border-left: 4px solid #0f4c5c;">
                  <p style="margin: 0; white-space: pre-wrap;">${message}</p>
                </div>
              </div>
              <p style="color: #64748b; font-size: 12px; margin-top: 24px; text-align: center;">
                Received via Insight|DesignCheck contact form
              </p>
            </div>
          </div>
        `,
      }),
    });

    if (!teamEmailRes.ok) {
      const errorData = await teamEmailRes.json();
      console.error("Team email error:", errorData);
      throw new Error("Failed to send team notification");
    }

    console.log("Team notification sent successfully");

    // Send confirmation email to the user
    const userEmailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "Insight|DesignCheck <onboarding@resend.dev>",
        to: [email],
        subject: "Thank you for contacting Insight|DesignCheck",
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #0f4c5c 0%, #1a6b7d 100%); padding: 32px; border-radius: 12px 12px 0 0;">
              <h1 style="color: white; margin: 0; font-size: 24px;">Thanks for reaching out, ${firstName}!</h1>
            </div>
            <div style="background: #f8fafc; padding: 32px; border-radius: 0 0 12px 12px;">
              <div style="background: white; padding: 24px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6;">
                  We've received your message and our team will get back to you within 24 hours.
                </p>
                <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6;">
                  In the meantime, feel free to explore our platform:
                </p>
                <ul style="margin: 0 0 24px 0; padding-left: 24px; line-height: 2;">
                  <li><a href="https://review-resolve-ai.lovable.app/demos" style="color: #0f4c5c;">Try our interactive demos</a></li>
                  <li><a href="https://review-resolve-ai.lovable.app/roi-calculator" style="color: #0f4c5c;">Calculate your permit savings</a></li>
                  <li><a href="https://review-resolve-ai.lovable.app/pricing" style="color: #0f4c5c;">View our pricing plans</a></li>
                </ul>
                <div style="border-top: 1px solid #e2e8f0; padding-top: 24px; margin-top: 24px;">
                  <p style="margin: 0; color: #64748b; font-size: 14px;">
                    Best regards,<br>
                    <strong style="color: #0f4c5c;">The Insight|DesignCheck Team</strong>
                  </p>
                </div>
              </div>
              <p style="color: #64748b; font-size: 12px; margin-top: 24px; text-align: center;">
                © 2025 Insight|DesignCheck. All rights reserved.
              </p>
            </div>
          </div>
        `,
      }),
    });

    if (!userEmailRes.ok) {
      console.error("User email error:", await userEmailRes.json());
      // Don't throw - team email already sent
    } else {
      console.log("User confirmation sent successfully");
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Emails sent successfully" 
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error("Error in send-contact-email function:", error);
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
