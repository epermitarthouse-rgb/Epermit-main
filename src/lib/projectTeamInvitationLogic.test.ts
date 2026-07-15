import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeInviteEmail,
  isValidInviteEmail,
  canInviteWithRole,
  canUserInviteTeam,
  assertInviterRole,
  isInvitationTokenFormatValid,
  validateInvitationAccept,
  validateDecline,
  canResendInvitation,
  resendCooldownRemainingMs,
  buildInvitationAcceptUrl,
  buildInvitationEmailPayload,
} from './projectTeamInvitationLogic';
import type { InvitationRecord } from './projectTeamInvitationLogic';

describe('projectTeamInvitationLogic', () => {
  it('normalizes invite email', () => {
    assert.equal(normalizeInviteEmail('  User@Example.COM '), 'user@example.com');
  });

  it('validates invite email format', () => {
    assert.equal(isValidInviteEmail('user@example.com'), true);
    assert.equal(isValidInviteEmail('@bad'), false);
  });

  it('blocks owner role invites', () => {
    assert.equal(canInviteWithRole('owner'), false);
    assert.equal(canInviteWithRole('editor'), true);
  });
});

describe('Row 4 — team invitation tenant/project boundary', () => {
  it('only owner/admin can invite (editors denied)', () => {
    assert.deepEqual(assertInviterRole({ isOwner: false, isAdmin: false, isEditor: true, isViewer: false }), {
      ok: false,
      code: 'editor_denied',
      message: 'Editors cannot invite team members',
    });
    assert.deepEqual(assertInviterRole({ isOwner: true, isAdmin: false, isEditor: false, isViewer: false }), {
      ok: true,
    });
  });

  it('viewers cannot invite to any project', () => {
    assert.equal(canUserInviteTeam({ isOwner: false, isAdmin: false }), false);
    const result = assertInviterRole({ isOwner: false, isAdmin: false, isEditor: false, isViewer: true });
    assert.equal(result.ok, false);
  });

  it('accept rejects wrong email (prevents cross-user token reuse)', () => {
    const invitation: InvitationRecord = {
      status: 'pending',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      invitedEmail: 'invitee@tenant-b.com',
      role: 'editor',
      projectId: 'project-b',
    };
    const result = validateInvitationAccept({
      invitation,
      userEmail: 'user-a@tenant-a.com',
      now: new Date(),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'email_mismatch');
  });

  it('accept rejects non-pending invitation', () => {
    const invitation: InvitationRecord = {
      status: 'accepted',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      invitedEmail: 'user@example.com',
      role: 'editor',
      projectId: 'project-b',
    };
    const result = validateInvitationAccept({
      invitation,
      userEmail: 'user@example.com',
      now: new Date(),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'not_pending');
  });

  it('token format validation blocks malformed tokens', () => {
    assert.equal(isInvitationTokenFormatValid('short'), false);
    assert.equal(isInvitationTokenFormatValid('a'.repeat(32)), true);
  });

  it('resend cooldown enforced', () => {
    const now = new Date();
    const remaining = resendCooldownRemainingMs(
      new Date(now.getTime() - 60_000).toISOString(),
      now,
    );
    assert.ok(remaining > 0);
    assert.equal(
      canResendInvitation(new Date(now.getTime() - 6 * 60_000).toISOString(), now),
      true,
    );
  });

  it('decline validates pending status', () => {
    const result = validateDecline({
      invitation: { status: 'revoked', invitedEmail: 'user@example.com' },
      userEmail: 'user@example.com',
    });
    assert.equal(result.ok, false);
  });

  it('buildInvitationAcceptUrl does not expose tenant id', () => {
    const url = buildInvitationAcceptUrl('https://app.example.com', 'abc123'.repeat(4));
    assert.match(url, /^https:\/\/app\.example\.com\/invite\//);
    assert.equal(url.includes('tenant'), false);
  });

  it('email payload uses project name not tenant slug', () => {
    const payload = buildInvitationEmailPayload({
      projectName: 'Project B',
      inviterName: 'Owner',
      role: 'editor',
      invitedEmail: 'user@example.com',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      acceptUrl: 'https://app.example.com/invite/abc',
    });
    assert.match(payload.subject, /Project B/);
    assert.equal(payload.html.includes('tenant'), false);
  });
});
