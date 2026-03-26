import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface InspectionWithDetails {
  id: string;
  inspection_type: string;
  scheduled_date: string;
  status: string;
  project_id: string;
  user_id: string;
  projects: {
    name: string;
    address: string | null;
  };
}

interface PunchListWithDetails {
  id: string;
  title: string;
  priority: string;
  due_date: string;
  project_id: string;
  user_id: string;
  projects: {
    name: string;
  };
}

const INSPECTION_TYPE_LABELS: Record<string, string> = {
  foundation: "Foundation",
  framing: "Framing",
  electrical_rough: "Electrical Rough-In",
  electrical_final: "Electrical Final",
  plumbing_rough: "Plumbing Rough-In",
  plumbing_final: "Plumbing Final",
  mechanical_rough: "Mechanical Rough-In",
  mechanical_final: "Mechanical Final",
  insulation: "Insulation",
  drywall: "Drywall",
  fire_safety: "Fire Safety",
  final: "Final Inspection",
  other: "Other",
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
    console.log("Processing inspection reminders...");

    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(23, 59, 59, 999);

    // Fetch upcoming inspections (within next 24 hours)
    const { data: upcomingInspections, error: inspError } = await supabase
      .from("inspections")
      .select(`
        id,
        inspection_type,
        scheduled_date,
        status,
        project_id,
        user_id,
        projects!inner (name, address)
      `)
      .eq("status", "scheduled")
      .gte("scheduled_date", now.toISOString())
      .lte("scheduled_date", tomorrow.toISOString());

    if (inspError) {
      console.error("Error fetching inspections:", inspError);
      throw inspError;
    }

    console.log(`Found ${upcomingInspections?.length || 0} upcoming inspections`);

    // Fetch overdue punch list items
    const { data: overduePunchItems, error: punchError } = await supabase
      .from("punch_list_items")
      .select(`
        id,
        title,
        priority,
        due_date,
        project_id,
        user_id,
        projects!inner (name)
      `)
      .in("status", ["open", "in_progress"])
      .lt("due_date", now.toISOString())
      .not("due_date", "is", null);

    if (punchError) {
      console.error("Error fetching punch list items:", punchError);
      throw punchError;
    }

    console.log(`Found ${overduePunchItems?.length || 0} overdue punch list items`);

    // Group notifications by user
    const userNotifications: Map<string, {
      inspections: InspectionWithDetails[];
      punchItems: PunchListWithDetails[];
    }> = new Map();

    for (const inspection of (upcomingInspections || []) as unknown as InspectionWithDetails[]) {
      if (!userNotifications.has(inspection.user_id)) {
        userNotifications.set(inspection.user_id, { inspections: [], punchItems: [] });
      }
      userNotifications.get(inspection.user_id)!.inspections.push(inspection);
    }

    for (const punchItem of (overduePunchItems || []) as unknown as PunchListWithDetails[]) {
      if (!userNotifications.has(punchItem.user_id)) {
        userNotifications.set(punchItem.user_id, { inspections: [], punchItems: [] });
      }
      userNotifications.get(punchItem.user_id)!.punchItems.push(punchItem);
    }

    if (userNotifications.size === 0) {
      console.log("No notifications to send");
      return new Response(
        JSON.stringify({ message: "No notifications to send", sent: 0 }),
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

      if (data.inspections.length === 0 && data.punchItems.length === 0) {
        continue;
      }

      try {
        const inspectionsHtml = data.inspections.length > 0 ? `
          <div style="margin-bottom: 24px;">
            <h2 style="color: #0f766e; font-size: 18px; margin: 0 0 16px 0; display: flex; align-items: center;">
              📋 Upcoming Inspections (${data.inspections.length})
            </h2>
            ${data.inspections.map(insp => {
              const date = new Date(insp.scheduled_date);
              const typeLabel = INSPECTION_TYPE_LABELS[insp.inspection_type] || insp.inspection_type;
              return `
                <div style="background-color: #f0fdfa; border-left: 4px solid #0f766e; padding: 16px; margin-bottom: 12px; border-radius: 0 8px 8px 0;">
                  <p style="color: #0f766e; font-weight: bold; margin: 0 0 4px 0;">${typeLabel}</p>
                  <p style="color: #374151; margin: 0 0 4px 0;">${insp.projects.name}</p>
                  ${insp.projects.address ? `<p style="color: #6b7280; font-size: 14px; margin: 0 0 4px 0;">📍 ${insp.projects.address}</p>` : ""}
                  <p style="color: #374151; font-size: 14px; margin: 0;">
                    🗓️ ${date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} at ${date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                  </p>
                </div>
              `;
            }).join("")}
          </div>
        ` : "";

        const punchItemsHtml = data.punchItems.length > 0 ? `
          <div style="margin-bottom: 24px;">
            <h2 style="color: #dc2626; font-size: 18px; margin: 0 0 16px 0;">
              ⚠️ Overdue Punch List Items (${data.punchItems.length})
            </h2>
            ${data.punchItems.map(item => {
              const dueDate = new Date(item.due_date);
              const daysOverdue = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
              const priorityColors: Record<string, string> = {
                critical: "#dc2626",
                high: "#ea580c",
                medium: "#2563eb",
                low: "#64748b",
              };
              const priorityColor = priorityColors[item.priority] || "#64748b";
              return `
                <div style="background-color: #fef2f2; border-left: 4px solid ${priorityColor}; padding: 16px; margin-bottom: 12px; border-radius: 0 8px 8px 0;">
                  <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                    <span style="background-color: ${priorityColor}; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px; text-transform: uppercase;">${item.priority}</span>
                  </div>
                  <p style="color: #374151; font-weight: bold; margin: 8px 0 4px 0;">${item.title}</p>
                  <p style="color: #6b7280; font-size: 14px; margin: 0 0 4px 0;">${item.projects.name}</p>
                  <p style="color: #dc2626; font-size: 14px; margin: 0;">
                    ⏰ ${daysOverdue} day${daysOverdue !== 1 ? "s" : ""} overdue
                  </p>
                </div>
              `;
            }).join("")}
          </div>
        ` : "";

        const subject = data.inspections.length > 0 && data.punchItems.length > 0
          ? `🔔 ${data.inspections.length} Inspection${data.inspections.length > 1 ? "s" : ""} Tomorrow & ${data.punchItems.length} Overdue Item${data.punchItems.length > 1 ? "s" : ""}`
          : data.inspections.length > 0
            ? `🔔 ${data.inspections.length} Inspection${data.inspections.length > 1 ? "s" : ""} Scheduled for Tomorrow`
            : `⚠️ ${data.punchItems.length} Overdue Punch List Item${data.punchItems.length > 1 ? "s" : ""}`;

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
                        <td style="background-color: #0f766e; padding: 24px; text-align: center;">
                          <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: bold;">PermitPilot</h1>
                          <p style="color: #ffffff; opacity: 0.9; margin: 8px 0 0 0; font-size: 14px;">Your Daily Project Update</p>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 32px;">
                          <p style="color: #374151; font-size: 16px; margin: 0 0 24px 0;">
                            Here's what needs your attention:
                          </p>
                          ${inspectionsHtml}
                          ${punchItemsHtml}
                          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
                          <p style="color: #6b7280; font-size: 14px; margin: 0; text-align: center;">
                            Log in to your dashboard to manage your projects and inspections.
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
        console.log(`Sent reminder email to ${email}`);
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
        upcomingInspections: upcomingInspections?.length || 0,
        overduePunchItems: overduePunchItems?.length || 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in send-inspection-reminders:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
