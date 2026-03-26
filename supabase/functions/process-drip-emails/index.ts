import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Drip email content for each day
const dripEmails = [
  {
    day: 1,
    subject: "🎯 Day 1: Set Up Your First Project",
    getContent: (name: string) => `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #1a1a2e; margin-bottom: 24px;">Hey ${name}! 👋</h1>
        
        <p style="color: #4a4a4a; font-size: 16px; line-height: 1.6;">
          Welcome to Day 1 of your Permit Insight journey! Let's make sure you're set up for success.
        </p>
        
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; padding: 24px; margin: 24px 0;">
          <h2 style="color: white; margin: 0 0 16px 0; font-size: 20px;">Today's Tip: Create Your First Project</h2>
          <p style="color: rgba(255,255,255,0.9); margin: 0; font-size: 15px; line-height: 1.6;">
            Head to the Dashboard and click "New Project" to get started. Fill in your project details, 
            and our AI will automatically identify the jurisdiction and estimate review timelines.
          </p>
        </div>
        
        <h3 style="color: #1a1a2e; margin-top: 32px;">Quick Start Checklist:</h3>
        <ul style="color: #4a4a4a; font-size: 15px; line-height: 1.8;">
          <li>✅ Complete your profile with company details</li>
          <li>📁 Upload your first set of permit drawings</li>
          <li>🔔 Enable notifications for deadline reminders</li>
        </ul>
        
        <p style="color: #4a4a4a; font-size: 16px; line-height: 1.6; margin-top: 24px;">
          Need help? Just reply to this email - we're here for you!
        </p>
        
        <p style="color: #888; font-size: 14px; margin-top: 32px;">
          Happy permitting! 🏗️<br>
          The Permit Insight Team
        </p>
      </div>
    `,
  },
  {
    day: 3,
    subject: "📊 Day 3: Unlock Jurisdiction Intelligence",
    getContent: (name: string) => `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #1a1a2e; margin-bottom: 24px;">Making Progress, ${name}! 🚀</h1>
        
        <p style="color: #4a4a4a; font-size: 16px; line-height: 1.6;">
          You're 3 days in! Today, let's explore one of our most powerful features.
        </p>
        
        <div style="background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); border-radius: 12px; padding: 24px; margin: 24px 0;">
          <h2 style="color: white; margin: 0 0 16px 0; font-size: 20px;">Today's Feature: Jurisdiction Intelligence</h2>
          <p style="color: rgba(255,255,255,0.9); margin: 0; font-size: 15px; line-height: 1.6;">
            Use our Jurisdiction Map to explore permit requirements across different cities. 
            Compare SLA times, fees, and submission methods to plan your projects strategically.
          </p>
        </div>
        
        <h3 style="color: #1a1a2e; margin-top: 32px;">Did You Know?</h3>
        <ul style="color: #4a4a4a; font-size: 15px; line-height: 1.8;">
          <li>📍 Subscribe to jurisdictions to get update notifications</li>
          <li>⚡ Some jurisdictions offer expedited review for additional fees</li>
          <li>📋 Compare up to 3 jurisdictions side-by-side</li>
        </ul>
        
        <p style="color: #4a4a4a; font-size: 16px; line-height: 1.6; margin-top: 24px;">
          <strong>Pro tip:</strong> Set up jurisdiction alerts for cities you work in frequently!
        </p>
        
        <p style="color: #888; font-size: 14px; margin-top: 32px;">
          Keep building! 🏗️<br>
          The Permit Insight Team
        </p>
      </div>
    `,
  },
  {
    day: 5,
    subject: "📈 Day 5: Master Your Analytics Dashboard",
    getContent: (name: string) => `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #1a1a2e; margin-bottom: 24px;">Halfway There, ${name}! 📊</h1>
        
        <p style="color: #4a4a4a; font-size: 16px; line-height: 1.6;">
          You're getting the hang of things! Let's dive into analytics to optimize your workflow.
        </p>
        
        <div style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); border-radius: 12px; padding: 24px; margin: 24px 0;">
          <h2 style="color: white; margin: 0 0 16px 0; font-size: 20px;">Today's Power Move: Analytics Dashboard</h2>
          <p style="color: rgba(255,255,255,0.9); margin: 0; font-size: 15px; line-height: 1.6;">
            Track cycle times, monitor costs, and identify bottlenecks across all your projects. 
            Use data to negotiate better with contractors and set realistic client expectations.
          </p>
        </div>
        
        <h3 style="color: #1a1a2e; margin-top: 32px;">Analytics Highlights:</h3>
        <ul style="color: #4a4a4a; font-size: 15px; line-height: 1.8;">
          <li>📉 Track average review times by jurisdiction</li>
          <li>💰 Monitor permit fees and expeditor costs</li>
          <li>🔄 Analyze rejection trends to improve first-time approvals</li>
          <li>📊 Export reports for stakeholder presentations</li>
        </ul>
        
        <p style="color: #4a4a4a; font-size: 16px; line-height: 1.6; margin-top: 24px;">
          <strong>Try this:</strong> Filter your analytics by date range to see monthly trends!
        </p>
        
        <p style="color: #888; font-size: 14px; margin-top: 32px;">
          You're crushing it! 💪<br>
          The Permit Insight Team
        </p>
      </div>
    `,
  },
  {
    day: 7,
    subject: "🎉 Day 7: You're a Permit Pro Now!",
    getContent: (name: string) => `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #1a1a2e; margin-bottom: 24px;">Congratulations, ${name}! 🎉</h1>
        
        <p style="color: #4a4a4a; font-size: 16px; line-height: 1.6;">
          You've completed your first week with Permit Insight! Here's a recap of everything you've learned.
        </p>
        
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; padding: 24px; margin: 24px 0;">
          <h2 style="color: white; margin: 0 0 16px 0; font-size: 20px;">Your Week in Review</h2>
          <p style="color: rgba(255,255,255,0.9); margin: 0; font-size: 15px; line-height: 1.6;">
            You've learned about project management, jurisdiction intelligence, and analytics. 
            Now you're ready to streamline every permit in your pipeline!
          </p>
        </div>
        
        <h3 style="color: #1a1a2e; margin-top: 32px;">What You've Mastered:</h3>
        <ul style="color: #4a4a4a; font-size: 15px; line-height: 1.8;">
          <li>✅ Creating and managing projects</li>
          <li>✅ Exploring jurisdiction requirements</li>
          <li>✅ Analyzing performance with dashboards</li>
          <li>✅ Setting up notifications and alerts</li>
        </ul>
        
        <h3 style="color: #1a1a2e; margin-top: 32px;">What's Next?</h3>
        <ul style="color: #4a4a4a; font-size: 15px; line-height: 1.8;">
          <li>👥 Invite team members to collaborate</li>
          <li>📱 Try our mobile-friendly interface on the go</li>
          <li>🤖 Explore AI-powered form autofill features</li>
          <li>💬 Share your feedback to help us improve</li>
        </ul>
        
        <div style="background: #f8f9fa; border-radius: 12px; padding: 20px; margin: 24px 0; text-align: center;">
          <p style="color: #4a4a4a; font-size: 16px; margin: 0;">
            <strong>Questions or feedback?</strong><br>
            Just reply to this email - we'd love to hear from you!
          </p>
        </div>
        
        <p style="color: #888; font-size: 14px; margin-top: 32px;">
          Here's to faster permits! 🚀<br>
          The Permit Insight Team
        </p>
      </div>
    `,
  },
];

const handler = async (req: Request): Promise<Response> => {
  console.log("Processing drip email campaign...");

  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Create Supabase client with service role for admin access
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get all active drip campaigns
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

    for (const campaign of campaigns || []) {
      const enrolledAt = new Date(campaign.enrolled_at);
      const now = new Date();
      const daysSinceEnrollment = Math.floor(
        (now.getTime() - enrolledAt.getTime()) / (1000 * 60 * 60 * 24)
      );

      console.log(`Campaign ${campaign.id}: ${daysSinceEnrollment} days since enrollment, ${campaign.emails_sent} emails sent`);

      // Find the next email to send based on days and emails already sent
      const nextEmail = dripEmails.find(
        (email) => email.day <= daysSinceEnrollment + 1 && campaign.emails_sent < dripEmails.indexOf(email) + 1
      );

      if (nextEmail) {
        console.log(`Sending day ${nextEmail.day} email to ${campaign.email}`);

        try {
          const emailContent = nextEmail.getContent(campaign.user_name || "there");

          const { error: emailError } = await resend.emails.send({
            from: "Permit Insight <onboarding@resend.dev>",
            to: [campaign.email],
            subject: nextEmail.subject,
            html: emailContent,
          });

          if (emailError) {
            console.error(`Error sending email to ${campaign.email}:`, emailError);
            continue;
          }

          console.log(`Successfully sent day ${nextEmail.day} email to ${campaign.email}`);
          emailsSent++;

          // Update campaign progress
          const newEmailsSent = campaign.emails_sent + 1;
          const isComplete = newEmailsSent >= dripEmails.length;

          const { error: updateError } = await supabase
            .from("user_drip_campaigns")
            .update({
              emails_sent: newEmailsSent,
              last_email_sent_at: new Date().toISOString(),
              is_active: !isComplete,
              completed_at: isComplete ? new Date().toISOString() : null,
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
    }

    console.log(`Drip campaign processing complete: ${emailsSent} emails sent, ${campaignsCompleted} campaigns completed`);

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
      }
    );
  } catch (error: any) {
    console.error("Error in process-drip-emails function:", error);
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
