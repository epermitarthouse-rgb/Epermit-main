import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface StatusEmailRequest {
  submissionId: string;
  applicantEmail: string;
  applicantName: string;
  projectName: string;
  trackingNumber: string;
  permitType: string;
  oldStatus: string;
  newStatus: string;
  statusMessage?: string;
  system: string;
}

const getStatusColor = (status: string): string => {
  switch (status) {
    case 'approved': return '#10B981';
    case 'denied': return '#EF4444';
    case 'under_review': return '#3B82F6';
    case 'additional_info_required': return '#F59E0B';
    case 'submitted': return '#6366F1';
    case 'cancelled': return '#6B7280';
    case 'expired': return '#9CA3AF';
    default: return '#6B7280';
  }
};

const getStatusLabel = (status: string): string => {
  switch (status) {
    case 'approved': return 'Approved';
    case 'denied': return 'Denied';
    case 'under_review': return 'Under Review';
    case 'additional_info_required': return 'Additional Information Required';
    case 'submitted': return 'Submitted';
    case 'pending': return 'Pending';
    case 'cancelled': return 'Cancelled';
    case 'expired': return 'Expired';
    default: return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
  }
};

const getStatusIcon = (status: string): string => {
  switch (status) {
    case 'approved': return '✅';
    case 'denied': return '❌';
    case 'under_review': return '🔍';
    case 'additional_info_required': return '📋';
    case 'submitted': return '📤';
    case 'pending': return '⏳';
    case 'cancelled': return '🚫';
    case 'expired': return '⏰';
    default: return '📄';
  }
};

const getActionRequired = (status: string): string | null => {
  switch (status) {
    case 'additional_info_required':
      return 'Please log in to your account to view the required information and submit the necessary documents.';
    case 'approved':
      return 'Your permit has been approved! You may now proceed with your project according to the approved plans.';
    case 'denied':
      return 'Please review the denial reasons and contact the jurisdiction for more information about resubmission options.';
    default:
      return null;
  }
};

const generateEmailHtml = (data: StatusEmailRequest): string => {
  const statusColor = getStatusColor(data.newStatus);
  const statusLabel = getStatusLabel(data.newStatus);
  const statusIcon = getStatusIcon(data.newStatus);
  const actionRequired = getActionRequired(data.newStatus);
  const systemName = data.system === 'accela' ? 'Accela' : 'CityView';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Permit Status Update</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="width: 100%; max-width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%); padding: 32px 40px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">
                Permit Status Update
              </h1>
              <p style="margin: 8px 0 0; color: rgba(255, 255, 255, 0.9); font-size: 14px;">
                ${systemName} E-Permit System
              </p>
            </td>
          </tr>
          
          <!-- Greeting -->
          <tr>
            <td style="padding: 32px 40px 16px;">
              <p style="margin: 0; color: #374151; font-size: 16px;">
                Hello ${data.applicantName},
              </p>
              <p style="margin: 16px 0 0; color: #6B7280; font-size: 14px; line-height: 1.6;">
                There has been an update to your permit application. Here are the details:
              </p>
            </td>
          </tr>
          
          <!-- Status Badge -->
          <tr>
            <td style="padding: 0 40px;">
              <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb;">
                <tr>
                  <td style="padding: 24px; text-align: center;">
                    <div style="font-size: 48px; margin-bottom: 12px;">${statusIcon}</div>
                    <div style="display: inline-block; background-color: ${statusColor}; color: #ffffff; padding: 8px 24px; border-radius: 20px; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                      ${statusLabel}
                    </div>
                    ${data.statusMessage ? `
                    <p style="margin: 16px 0 0; color: #6B7280; font-size: 14px; line-height: 1.5;">
                      ${data.statusMessage}
                    </p>
                    ` : ''}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Application Details -->
          <tr>
            <td style="padding: 24px 40px;">
              <h2 style="margin: 0 0 16px; color: #1F2937; font-size: 16px; font-weight: 600;">
                Application Details
              </h2>
              <table role="presentation" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                    <span style="color: #6B7280; font-size: 14px;">Tracking Number</span>
                    <div style="color: #1F2937; font-size: 14px; font-weight: 600; margin-top: 4px;">
                      ${data.trackingNumber}
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                    <span style="color: #6B7280; font-size: 14px;">Project Name</span>
                    <div style="color: #1F2937; font-size: 14px; font-weight: 600; margin-top: 4px;">
                      ${data.projectName}
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                    <span style="color: #6B7280; font-size: 14px;">Permit Type</span>
                    <div style="color: #1F2937; font-size: 14px; font-weight: 600; margin-top: 4px;">
                      ${data.permitType}
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 12px 0;">
                    <span style="color: #6B7280; font-size: 14px;">Previous Status</span>
                    <div style="color: #1F2937; font-size: 14px; font-weight: 600; margin-top: 4px;">
                      ${getStatusLabel(data.oldStatus)}
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          ${actionRequired ? `
          <!-- Action Required -->
          <tr>
            <td style="padding: 0 40px 24px;">
              <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #FEF3C7; border-radius: 8px; border-left: 4px solid #F59E0B;">
                <tr>
                  <td style="padding: 16px;">
                    <p style="margin: 0; color: #92400E; font-size: 14px; font-weight: 600;">
                      📌 Next Steps
                    </p>
                    <p style="margin: 8px 0 0; color: #92400E; font-size: 14px; line-height: 1.5;">
                      ${actionRequired}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          ` : ''}
          
          <!-- CTA Button -->
          <tr>
            <td style="padding: 0 40px 32px; text-align: center;">
              <a href="#" style="display: inline-block; background: linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 14px; font-weight: 600;">
                View Application Details
              </a>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #f9fafb; padding: 24px 40px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; color: #6B7280; font-size: 12px; line-height: 1.5; text-align: center;">
                This is an automated notification from the E-Permit Status Tracking System.
                <br>
                Please do not reply to this email. For questions, contact your local jurisdiction.
              </p>
              <p style="margin: 16px 0 0; color: #9CA3AF; font-size: 11px; text-align: center;">
                © ${new Date().getFullYear()} PermitFlow. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
};

const handler = async (req: Request): Promise<Response> => {
  console.log("send-epermit-status-email function called");

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const data: StatusEmailRequest = await req.json();
    console.log("Email request data:", JSON.stringify(data, null, 2));

    // Validate required fields
    if (!data.applicantEmail || !data.trackingNumber || !data.newStatus) {
      throw new Error("Missing required fields: applicantEmail, trackingNumber, or newStatus");
    }

    const emailHtml = generateEmailHtml(data);
    const statusLabel = getStatusLabel(data.newStatus);
    const statusIcon = getStatusIcon(data.newStatus);

    console.log(`Sending email to ${data.applicantEmail} for tracking number ${data.trackingNumber}`);

    const emailResponse = await resend.emails.send({
      from: "PermitFlow <onboarding@resend.dev>",
      to: [data.applicantEmail],
      subject: `${statusIcon} Permit Status Update: ${statusLabel} - ${data.trackingNumber}`,
      html: emailHtml,
    });

    console.log("Email sent successfully:", emailResponse);

    return new Response(
      JSON.stringify({ success: true, data: emailResponse.data }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error("Error sending status email:", error);
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
