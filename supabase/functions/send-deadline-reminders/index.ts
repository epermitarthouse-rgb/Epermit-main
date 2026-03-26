import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ProjectWithDeadline {
  id: string;
  name: string;
  deadline: string;
  status: string;
  address: string | null;
  city: string | null;
  state: string | null;
  jurisdiction: string | null;
  user_id: string;
}

const PROJECT_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  in_review: "In Review",
  corrections: "Corrections Needed",
  approved: "Approved",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resendApiKey = Deno.env.get("RESEND_API_KEY");

  if (!resendApiKey) {
    console.error("RESEND_API_KEY not configured");
    return new Response(
      JSON.stringify({ error: "Email service not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const resend = new Resend(resendApiKey);

  try {
    console.log("Processing project deadline reminders...");

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    // Calculate target dates for 7-day and 1-day reminders
    const oneDayFromNow = new Date(now);
    oneDayFromNow.setDate(oneDayFromNow.getDate() + 1);

    const sevenDaysFromNow = new Date(now);
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    // Format dates for comparison (just the date part)
    const oneDayDate = oneDayFromNow.toISOString().split('T')[0];
    const sevenDayDate = sevenDaysFromNow.toISOString().split('T')[0];

    console.log(`Checking for deadlines on ${oneDayDate} (1-day) and ${sevenDayDate} (7-day)`);

    // Fetch projects with deadlines matching our target dates
    // Exclude approved projects
    const { data: projects1Day, error: error1Day } = await supabase
      .from("projects")
      .select("id, name, deadline, status, address, city, state, jurisdiction, user_id")
      .neq("status", "approved")
      .gte("deadline", oneDayDate)
      .lt("deadline", oneDayDate + "T23:59:59.999Z");

    if (error1Day) {
      console.error("Error fetching 1-day deadline projects:", error1Day);
      throw error1Day;
    }

    const { data: projects7Day, error: error7Day } = await supabase
      .from("projects")
      .select("id, name, deadline, status, address, city, state, jurisdiction, user_id")
      .neq("status", "approved")
      .gte("deadline", sevenDayDate)
      .lt("deadline", sevenDayDate + "T23:59:59.999Z");

    if (error7Day) {
      console.error("Error fetching 7-day deadline projects:", error7Day);
      throw error7Day;
    }

    console.log(`Found ${projects1Day?.length || 0} projects with 1-day deadline`);
    console.log(`Found ${projects7Day?.length || 0} projects with 7-day deadline`);

    // Group notifications by user
    const userNotifications: Map<string, {
      urgent: ProjectWithDeadline[];  // 1-day reminders
      upcoming: ProjectWithDeadline[]; // 7-day reminders
    }> = new Map();

    for (const project of (projects1Day || []) as ProjectWithDeadline[]) {
      if (!userNotifications.has(project.user_id)) {
        userNotifications.set(project.user_id, { urgent: [], upcoming: [] });
      }
      userNotifications.get(project.user_id)!.urgent.push(project);
    }

    for (const project of (projects7Day || []) as ProjectWithDeadline[]) {
      if (!userNotifications.has(project.user_id)) {
        userNotifications.set(project.user_id, { urgent: [], upcoming: [] });
      }
      userNotifications.get(project.user_id)!.upcoming.push(project);
    }

    if (userNotifications.size === 0) {
      console.log("No deadline notifications to send");
      return new Response(
        JSON.stringify({ message: "No deadline notifications to send", sent: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get user emails
    const { data: usersData, error: usersError } = await supabase.auth.admin.listUsers();
    if (usersError) {
      console.error("Error fetching users:", usersError);
      throw usersError;
    }

    const userEmailMap = new Map<string, string>();
    for (const user of usersData?.users || []) {
      if (user.email) {
        userEmailMap.set(user.id, user.email);
      }
    }

    let emailsSent = 0;
    let emailsFailed = 0;

    for (const [userId, data] of userNotifications) {
      const email = userEmailMap.get(userId);
      if (!email) {
        console.log(`No email found for user ${userId}`);
        continue;
      }

      if (data.urgent.length === 0 && data.upcoming.length === 0) {
        continue;
      }

      try {
        const formatProjectCard = (project: ProjectWithDeadline, isUrgent: boolean) => {
          const deadlineDate = new Date(project.deadline);
          const statusLabel = PROJECT_STATUS_LABELS[project.status] || project.status;
          const location = [project.city, project.state].filter(Boolean).join(", ");
          const borderColor = isUrgent ? "#dc2626" : "#f59e0b";
          const bgColor = isUrgent ? "#fef2f2" : "#fffbeb";

          return `
            <div style="background-color: ${bgColor}; border-left: 4px solid ${borderColor}; padding: 16px; margin-bottom: 12px; border-radius: 0 8px 8px 0;">
              <p style="color: #111827; font-weight: bold; font-size: 16px; margin: 0 0 8px 0;">${project.name}</p>
              <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px;">
                <span style="background-color: ${isUrgent ? '#dc2626' : '#f59e0b'}; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px;">
                  ${isUrgent ? '⚡ Due Tomorrow' : '📅 Due in 7 Days'}
                </span>
                <span style="background-color: #e5e7eb; color: #374151; padding: 2px 8px; border-radius: 4px; font-size: 12px;">
                  ${statusLabel}
                </span>
              </div>
              ${location ? `<p style="color: #6b7280; font-size: 14px; margin: 0 0 4px 0;">📍 ${location}</p>` : ""}
              ${project.jurisdiction ? `<p style="color: #6b7280; font-size: 14px; margin: 0 0 4px 0;">🏛️ ${project.jurisdiction}</p>` : ""}
              <p style="color: ${isUrgent ? '#dc2626' : '#d97706'}; font-size: 14px; font-weight: 500; margin: 8px 0 0 0;">
                🗓️ Deadline: ${deadlineDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
              </p>
            </div>
          `;
        };

        const urgentHtml = data.urgent.length > 0 ? `
          <div style="margin-bottom: 24px;">
            <h2 style="color: #dc2626; font-size: 18px; margin: 0 0 16px 0;">
              ⚠️ Urgent: Due Tomorrow (${data.urgent.length})
            </h2>
            ${data.urgent.map(p => formatProjectCard(p, true)).join("")}
          </div>
        ` : "";

        const upcomingHtml = data.upcoming.length > 0 ? `
          <div style="margin-bottom: 24px;">
            <h2 style="color: #d97706; font-size: 18px; margin: 0 0 16px 0;">
              📅 Coming Up: Due in 7 Days (${data.upcoming.length})
            </h2>
            ${data.upcoming.map(p => formatProjectCard(p, false)).join("")}
          </div>
        ` : "";

        // Determine subject line
        let subject: string;
        if (data.urgent.length > 0 && data.upcoming.length > 0) {
          subject = `⚠️ ${data.urgent.length} Project${data.urgent.length > 1 ? "s" : ""} Due Tomorrow + ${data.upcoming.length} Due in 7 Days`;
        } else if (data.urgent.length > 0) {
          subject = `⚠️ Urgent: ${data.urgent.length} Project${data.urgent.length > 1 ? "s" : ""} Due Tomorrow`;
        } else {
          subject = `📅 Reminder: ${data.upcoming.length} Project${data.upcoming.length > 1 ? "s" : ""} Due in 7 Days`;
        }

        await resend.emails.send({
          from: "PermitPilot <onboarding@resend.dev>",
          to: email,
          subject,
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
                        <td style="background-color: ${data.urgent.length > 0 ? '#dc2626' : '#d97706'}; padding: 24px; text-align: center;">
                          <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: bold;">PermitPilot</h1>
                          <p style="color: #ffffff; opacity: 0.9; margin: 8px 0 0 0; font-size: 14px;">
                            ${data.urgent.length > 0 ? '⚠️ Deadline Alert' : '📅 Deadline Reminder'}
                          </p>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 32px;">
                          <p style="color: #374151; font-size: 16px; margin: 0 0 24px 0;">
                            ${data.urgent.length > 0 
                              ? "You have projects with approaching deadlines that need your immediate attention:"
                              : "Here's a friendly reminder about your upcoming project deadlines:"}
                          </p>
                          ${urgentHtml}
                          ${upcomingHtml}
                          <div style="background-color: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 16px; margin-top: 24px;">
                            <p style="color: #166534; font-size: 14px; margin: 0;">
                              💡 <strong>Tip:</strong> Review your project status and ensure all required documents are submitted before the deadline to avoid delays.
                            </p>
                          </div>
                          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
                          <p style="color: #6b7280; font-size: 14px; margin: 0; text-align: center;">
                            Log in to your dashboard to manage your projects and track progress.
                          </p>
                        </td>
                      </tr>
                      <tr>
                        <td style="background-color: #f9fafb; padding: 24px; text-align: center;">
                          <p style="color: #6b7280; font-size: 14px; margin: 0;">© 2024 PermitPilot. All rights reserved.</p>
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
        console.log(`Sent deadline reminder email to ${email} (${data.urgent.length} urgent, ${data.upcoming.length} upcoming)`);
      } catch (emailErr) {
        console.error(`Failed to send email to ${email}:`, emailErr);
        emailsFailed++;
      }
    }

    console.log(`Completed: ${emailsSent} emails sent, ${emailsFailed} failed`);

    return new Response(
      JSON.stringify({
        message: "Processing complete",
        sent: emailsSent,
        failed: emailsFailed,
        urgentProjects: projects1Day?.length || 0,
        upcomingProjects: projects7Day?.length || 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in send-deadline-reminders:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
