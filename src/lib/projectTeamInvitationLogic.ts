/**
 * Pure business rules for project team invitations.
 * Mirrors SECURITY DEFINER RPC validation in 20260715130000_project_team_invitation_flow.sql.
 */

import { TEAM_ROLE_LABELS, TeamRole } from '@/types/team';

export const INVITE_RESEND_COOLDOWN_MS = 5 * 60 * 1000;
export const INVITE_TOKEN_MIN_LENGTH = 16;

export type InvitationStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'revoked';

export interface InvitationPreview {
  valid: boolean;
  status?: InvitationStatus;
  project_name?: string;
  role?: TeamRole;
  invited_email?: string;
  inviter_name?: string;
  expires_at?: string;
  is_expired?: boolean;
  reason?: string;
}

export interface InvitationRecord {
  status: InvitationStatus;
  expiresAt: string;
  invitedEmail: string;
  role: TeamRole;
  projectId: string;
}

export type AcceptValidationResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

export function normalizeInviteEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidInviteEmail(email: string): boolean {
  const normalized = normalizeInviteEmail(email);
  return normalized.length > 0 && normalized.includes('@') && !normalized.startsWith('@');
}

export function canInviteWithRole(role: TeamRole): boolean {
  return role !== 'owner';
}

export function canUserInviteTeam(params: {
  isOwner: boolean;
  isAdmin: boolean;
}): boolean {
  return params.isOwner || params.isAdmin;
}

export function assertInviterRole(params: {
  isOwner: boolean;
  isAdmin: boolean;
  isEditor: boolean;
  isViewer: boolean;
}): AcceptValidationResult {
  if (canUserInviteTeam({ isOwner: params.isOwner, isAdmin: params.isAdmin })) {
    return { ok: true };
  }
  if (params.isEditor) {
    return { ok: false, code: 'editor_denied', message: 'Editors cannot invite team members' };
  }
  if (params.isViewer) {
    return { ok: false, code: 'viewer_denied', message: 'Viewers cannot invite team members' };
  }
  return { ok: false, code: 'unauthorized', message: 'Not authorized to invite team members' };
}

export function isInvitationTokenFormatValid(token: string | undefined | null): boolean {
  if (!token) return false;
  const trimmed = token.trim();
  return trimmed.length >= INVITE_TOKEN_MIN_LENGTH && /^[a-f0-9]+$/i.test(trimmed);
}

export function validateInvitationAccept(params: {
  invitation: InvitationRecord;
  userEmail: string;
  now: Date;
}): AcceptValidationResult {
  const { invitation, userEmail, now } = params;
  const normalizedUser = normalizeInviteEmail(userEmail);
  const normalizedInvite = normalizeInviteEmail(invitation.invitedEmail);

  if (invitation.status !== 'pending') {
    return {
      ok: false,
      code: 'not_pending',
      message: 'Invitation is no longer pending',
    };
  }

  if (new Date(invitation.expiresAt) < now) {
    return { ok: false, code: 'expired', message: 'Invitation has expired' };
  }

  if (invitation.status === 'revoked') {
    return { ok: false, code: 'revoked', message: 'Invitation has been revoked' };
  }

  if (normalizedUser !== normalizedInvite) {
    return {
      ok: false,
      code: 'email_mismatch',
      message: 'Signed-in email does not match invitation',
    };
  }

  if (!canInviteWithRole(invitation.role) && invitation.role === 'owner') {
    return { ok: false, code: 'invalid_role', message: 'Invalid invitation role' };
  }

  return { ok: true };
}

export function validateDecline(params: {
  invitation: Pick<InvitationRecord, 'status' | 'invitedEmail'>;
  userEmail: string;
}): AcceptValidationResult {
  if (params.invitation.status !== 'pending') {
    return {
      ok: false,
      code: 'not_pending',
      message: 'Invitation is no longer pending',
    };
  }

  if (normalizeInviteEmail(params.userEmail) !== normalizeInviteEmail(params.invitation.invitedEmail)) {
    return {
      ok: false,
      code: 'email_mismatch',
      message: 'Signed-in email does not match invitation',
    };
  }

  return { ok: true };
}

export function canResendInvitation(
  lastSentAt: string | null | undefined,
  now: Date,
  cooldownMs: number = INVITE_RESEND_COOLDOWN_MS,
): boolean {
  if (!lastSentAt) return true;
  return now.getTime() - new Date(lastSentAt).getTime() >= cooldownMs;
}

export function resendCooldownRemainingMs(
  lastSentAt: string | null | undefined,
  now: Date,
  cooldownMs: number = INVITE_RESEND_COOLDOWN_MS,
): number {
  if (!lastSentAt) return 0;
  const elapsed = now.getTime() - new Date(lastSentAt).getTime();
  return Math.max(0, cooldownMs - elapsed);
}

export function buildInvitationAcceptUrl(baseUrl: string, token: string): string {
  const trimmedBase = baseUrl.replace(/\/$/, '');
  return `${trimmedBase}/invite/${encodeURIComponent(token)}`;
}

export interface InvitationEmailPayloadInput {
  projectName: string;
  inviterName: string;
  role: TeamRole;
  invitedEmail: string;
  expiresAt: string;
  acceptUrl: string;
}

export function buildInvitationEmailPayload(input: InvitationEmailPayloadInput): {
  subject: string;
  html: string;
} {
  const roleLabel = TEAM_ROLE_LABELS[input.role];
  const expiry = new Date(input.expiresAt).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const subject = `You're invited to collaborate on ${input.projectName}`;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#1e293b;margin:0;padding:0;background:#f8fafc;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="text-align:center;margin-bottom:32px;">
      <h1 style="color:#0ea5e9;font-size:24px;margin:0;">PermitPilot</h1>
      <p style="color:#64748b;margin-top:8px;">Project team invitation</p>
    </div>
    <div style="background:#fff;border-radius:12px;padding:32px;box-shadow:0 4px 6px rgba(0,0,0,0.05);">
      <h2 style="color:#0f172a;font-size:20px;margin:0 0 16px;">Join ${escapeHtml(input.projectName)}</h2>
      <p style="color:#475569;margin-bottom:16px;">
        <strong>${escapeHtml(input.inviterName)}</strong> invited you to collaborate as
        <strong>${escapeHtml(roleLabel)}</strong>.
      </p>
      <p style="color:#475569;margin-bottom:24px;">
        Sign in with <strong>${escapeHtml(input.invitedEmail)}</strong> to accept this invitation.
        The link expires on ${escapeHtml(expiry)}.
      </p>
      <a href="${escapeHtml(input.acceptUrl)}"
         style="display:inline-block;background:linear-gradient(135deg,#0ea5e9,#0284c7);color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;">
        Accept invitation
      </a>
      <p style="color:#94a3b8;font-size:12px;margin-top:24px;">
        If you did not expect this email, you can safely ignore it.
      </p>
    </div>
  </div>
</body>
</html>`;

  return { subject, html };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function parseInviteErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message;
    if (msg.includes('Not authorized')) return 'You do not have permission to manage team invitations.';
    if (msg.includes('already a team member')) return 'This user is already on the project team.';
    if (msg.includes('Resend cooldown')) return 'Please wait before resending this invitation.';
    if (msg.includes('email does not match')) return 'Sign in with the email address that received the invitation.';
    if (msg.includes('expired')) return 'This invitation has expired.';
    if (msg.includes('no longer pending')) return 'This invitation is no longer active.';
    return msg;
  }
  return 'An unexpected error occurred';
}

export function inviteAuthRedirectPath(token: string): string {
  return `/invite/${encodeURIComponent(token)}`;
}
