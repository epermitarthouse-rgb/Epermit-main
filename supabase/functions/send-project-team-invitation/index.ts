import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
};

type CreateAndSendBody = {
  action: "create_and_send";
  project_id: string;
  email: string;
  role: "admin" | "editor" | "viewer";
};

type ResendBody = {
  action: "resend";
  invitation_id: string;
};

type RequestBody = CreateAndSendBody | ResendBody;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildEmailHtml(params: {
  projectName: string;
  inviterName: string;
  role: string;
  invitedEmail: string;
  expiresAt: string;
  acceptUrl: string;
}): { subject: string; html: string } {
  const roleLabel = ROLE_LABELS[params.role] || params.role;
  const expiry = new Date(params.expiresAt).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return {
    subject: `You're invited to collaborate on ${params.projectName}`,
    html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#1e293b;margin:0;padding:0;background:#f8fafc;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="text-align:center;margin-bottom:32px;">
      <h1 style="color:#0ea5e9;font-size:24px;margin:0;">PermitPilot</h1>
      <p style="color:#64748b;margin-top:8px;">Project team invitation</p>
    </div>
    <div style="background:#fff;border-radius:12px;padding:32px;box-shadow:0 4px 6px rgba(0,0,0,0.05);">
      <h2 style="color:#0f172a;font-size:20px;margin:0 0 16px;">Join ${escapeHtml(params.projectName)}</h2>
      <p style="color:#475569;margin-bottom:16px;">
        <strong>${escapeHtml(params.inviterName)}</strong> invited you to collaborate as
        <strong>${escapeHtml(roleLabel)}</strong>.
      </p>
      <p style="color:#475569;margin-bottom:24px;">
        Sign in with <strong>${escapeHtml(params.invitedEmail)}</strong> to accept this invitation.
        The link expires on ${escapeHtml(expiry)}.
      </p>
      <a href="${escapeHtml(params.acceptUrl)}"
         style="display:inline-block;background:linear-gradient(135deg,#0ea5e9,#0284c7);color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;">
        Accept invitation
      </a>
      <p style="color:#94a3b8;font-size:12px;margin-top:24px;">
        If you did not expect this email, you can safely ignore it.
      </p>
    </div>
  </div>
</body>
</html>`,
  };
}

function resolveAppBaseUrl(req: Request): string {
  const configured = Deno.env.get("APP_URL") || Deno.env.get("SITE_URL");
  if (configured) return configured.replace(/\/$/, "");
  const origin = req.headers.get("origin");
  if (origin) return origin.replace(/\/$/, "");
  return "https://epermit-main-production.up.railway.app";
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");

  if (!supabaseUrl || !anonKey) {
    return new Response(
      JSON.stringify({ error: "Missing Supabase configuration", email_sent: false }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "Missing authorization", email_sent: false }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const token = authHeader.replace(/^\s*Bearer\s+/i, "").trim();
  const supabaseAuth = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });

  const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
  if (userError || !user) {
    return new Response(
      JSON.stringify({ error: "Invalid session", email_sent: false }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body", email_sent: false }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let invitationId: string;
  let acceptToken: string;
  let invitedEmail: string;
  let role: string;
  let expiresAt: string;
  let projectId: string;

  try {
    if (body.action === "create_and_send") {
      const { data, error } = await supabaseAuth.rpc("create_project_team_invitation", {
        p_project_id: body.project_id,
        p_email: body.email,
        p_role: body.role,
      });
      if (error) throw error;
      if (!data?.invitation_id || !data?.accept_token) {
        throw new Error("Invitation RPC returned incomplete data");
      }
      invitationId = data.invitation_id;
      acceptToken = data.accept_token;
      invitedEmail = data.email;
      role = data.role;
      expiresAt = data.expires_at;
      projectId = body.project_id;
    } else if (body.action === "resend") {
      const { data, error } = await supabaseAuth.rpc("resend_project_team_invitation", {
        p_invitation_id: body.invitation_id,
      });
      if (error) throw error;
      if (!data?.invitation_id || !data?.accept_token) {
        throw new Error("Resend RPC returned incomplete data");
      }
      invitationId = data.invitation_id;
      acceptToken = data.accept_token;
      invitedEmail = data.email;
      role = data.role;
      expiresAt = data.expires_at;

      const { data: invRow } = await supabaseAuth
        .from("project_invitations")
        .select("project_id")
        .eq("id", invitationId)
        .single();
      projectId = invRow?.project_id || "";
    } else {
      return new Response(
        JSON.stringify({ error: "Unknown action", email_sent: false }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  } catch (rpcError) {
    const message = rpcError instanceof Error ? rpcError.message : "Failed to create invitation";
    return new Response(
      JSON.stringify({ error: message, email_sent: false, invitation_created: false }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const { data: project } = await supabaseAuth
    .from("projects")
    .select("name")
    .eq("id", projectId)
    .single();

  const { data: inviterProfile } = await supabaseAuth
    .from("profiles")
    .select("full_name")
    .eq("user_id", user.id)
    .maybeSingle();

  const acceptUrl = `${resolveAppBaseUrl(req)}/invite/${acceptToken}`;
  const emailContent = buildEmailHtml({
    projectName: project?.name || "a project",
    inviterName: inviterProfile?.full_name || "A team member",
    role,
    invitedEmail,
    expiresAt,
    acceptUrl,
  });

  if (!resendApiKey) {
    return new Response(
      JSON.stringify({
        invitation_id: invitationId,
        email_sent: false,
        invitation_created: true,
        error: "Email service is temporarily unavailable. You can resend the invitation from the Team tab.",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "PermitPilot <onboarding@resend.dev>",
        to: [invitedEmail],
        subject: emailContent.subject,
        html: emailContent.html,
      }),
    });

    if (!emailRes.ok) {
      const errBody = await emailRes.text();
      console.error("Resend error:", errBody);
      return new Response(
        JSON.stringify({
          invitation_id: invitationId,
          email_sent: false,
          invitation_created: true,
          error: "Failed to send invitation email. The invitation is saved — resend from the Team tab.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    await supabaseAuth.rpc("mark_project_invitation_email_sent", {
      p_invitation_id: invitationId,
    });

    return new Response(
      JSON.stringify({
        invitation_id: invitationId,
        email_sent: true,
        invitation_created: true,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (emailError) {
    console.error("Email send exception:", emailError);
    return new Response(
      JSON.stringify({
        invitation_id: invitationId,
        email_sent: false,
        invitation_created: true,
        error: "Email service error. The invitation is saved — resend from the Team tab.",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
