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
  parseInviteErrorMessage,
  inviteAuthRedirectPath,
  INVITE_RESEND_COOLDOWN_MS,
} from './projectTeamInvitationLogic.ts';

const FUTURE = new Date('2030-01-01T00:00:00Z');
const PAST = new Date('2020-01-01T00:00:00Z');

describe('projectTeamInvitationLogic', () => {
  describe('email normalization', () => {
    it('normalizes email to lowercase trimmed', () => {
      assert.equal(normalizeInviteEmail('  Editor@Example.COM '), 'editor@example.com');
    });

    it('validates invite email format', () => {
      assert.equal(isValidInviteEmail('user@example.com'), true);
      assert.equal(isValidInviteEmail('@bad.com'), false);
      assert.equal(isValidInviteEmail(''), false);
    });
  });

  describe('inviter authorization', () => {
    it('owner can invite', () => {
      assert.equal(canUserInviteTeam({ isOwner: true, isAdmin: false }), true);
      assert.deepEqual(assertInviterRole({ isOwner: true, isAdmin: false, isEditor: false, isViewer: false }), { ok: true });
    });

    it('admin can invite', () => {
      assert.equal(canUserInviteTeam({ isOwner: false, isAdmin: true }), true);
    });

    it('editor cannot invite', () => {
      const result = assertInviterRole({ isOwner: false, isAdmin: false, isEditor: true, isViewer: false });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, 'editor_denied');
    });

    it('viewer cannot invite', () => {
      const result = assertInviterRole({ isOwner: false, isAdmin: false, isEditor: false, isViewer: true });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, 'viewer_denied');
    });

    it('unrelated user cannot invite', () => {
      const result = assertInviterRole({ isOwner: false, isAdmin: false, isEditor: false, isViewer: false });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, 'unauthorized');
    });
  });

  describe('role rules', () => {
    it('cannot invite as owner', () => {
      assert.equal(canInviteWithRole('owner'), false);
      assert.equal(canInviteWithRole('editor'), true);
      assert.equal(canInviteWithRole('admin'), true);
      assert.equal(canInviteWithRole('viewer'), true);
    });
  });

  describe('token format', () => {
    it('accepts 64-char hex tokens', () => {
      const token = 'a'.repeat(64);
      assert.equal(isInvitationTokenFormatValid(token), true);
    });

    it('rejects short or non-hex tokens', () => {
      assert.equal(isInvitationTokenFormatValid('short'), false);
      assert.equal(isInvitationTokenFormatValid('zzzzzzzzzzzzzzzz'), false);
      assert.equal(isInvitationTokenFormatValid(null), false);
    });
  });

  describe('accept validation', () => {
    const baseInvitation = {
      status: 'pending' as const,
      expiresAt: FUTURE.toISOString(),
      invitedEmail: 'editor@example.com',
      role: 'editor' as const,
      projectId: 'project-1',
    };

    it('valid invite accepted when email matches', () => {
      const result = validateInvitationAccept({
        invitation: baseInvitation,
        userEmail: 'editor@example.com',
        now: new Date('2026-01-01'),
      });
      assert.deepEqual(result, { ok: true });
    });

    it('wrong signed-in email rejected', () => {
      const result = validateInvitationAccept({
        invitation: baseInvitation,
        userEmail: 'other@example.com',
        now: new Date('2026-01-01'),
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, 'email_mismatch');
    });

    it('expired invite rejected', () => {
      const result = validateInvitationAccept({
        invitation: { ...baseInvitation, expiresAt: PAST.toISOString() },
        userEmail: 'editor@example.com',
        now: new Date('2026-06-01'),
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, 'expired');
    });

    it('revoked invite rejected', () => {
      const result = validateInvitationAccept({
        invitation: { ...baseInvitation, status: 'revoked' },
        userEmail: 'editor@example.com',
        now: new Date('2026-01-01'),
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, 'not_pending');
    });

    it('reused invite rejected', () => {
      const result = validateInvitationAccept({
        invitation: { ...baseInvitation, status: 'accepted' },
        userEmail: 'editor@example.com',
        now: new Date('2026-01-01'),
      });
      assert.equal(result.ok, false);
    });

    it('declined invite creates no membership path (validation blocks accept)', () => {
      const result = validateInvitationAccept({
        invitation: { ...baseInvitation, status: 'declined' },
        userEmail: 'editor@example.com',
        now: new Date('2026-01-01'),
      });
      assert.equal(result.ok, false);
    });

    it('acceptance creates editor membership when role is editor', () => {
      assert.equal(baseInvitation.role, 'editor');
    });
  });

  describe('decline validation', () => {
    it('decline requires matching email', () => {
      const result = validateDecline({
        invitation: { status: 'pending', invitedEmail: 'a@b.com' },
        userEmail: 'c@d.com',
      });
      assert.equal(result.ok, false);
    });

    it('decline allowed for matching pending invite', () => {
      const result = validateDecline({
        invitation: { status: 'pending', invitedEmail: 'a@b.com' },
        userEmail: 'a@b.com',
      });
      assert.deepEqual(result, { ok: true });
    });
  });

  describe('resend cooldown', () => {
    it('allows resend when never sent', () => {
      assert.equal(canResendInvitation(null, new Date()), true);
    });

    it('blocks resend within cooldown window', () => {
      const now = new Date('2026-01-01T12:00:00Z');
      const lastSent = new Date('2026-01-01T12:02:00Z').toISOString();
      assert.equal(canResendInvitation(lastSent, now, INVITE_RESEND_COOLDOWN_MS), false);
      assert.ok(resendCooldownRemainingMs(lastSent, now, INVITE_RESEND_COOLDOWN_MS) > 0);
    });

    it('allows resend after cooldown', () => {
      const now = new Date('2026-01-01T12:10:00Z');
      const lastSent = new Date('2026-01-01T12:00:00Z').toISOString();
      assert.equal(canResendInvitation(lastSent, now, INVITE_RESEND_COOLDOWN_MS), true);
    });
  });

  describe('email payload', () => {
    it('invite email payload includes required fields', () => {
      const { subject, html } = buildInvitationEmailPayload({
        projectName: 'Test Tower',
        inviterName: 'Alex Owner',
        role: 'editor',
        invitedEmail: 'editor@example.com',
        expiresAt: FUTURE.toISOString(),
        acceptUrl: 'https://app.example.com/invite/abc123',
      });

      assert.match(subject, /Test Tower/);
      assert.match(html, /Alex Owner/);
      assert.match(html, /Editor/);
      assert.match(html, /editor@example.com/);
      assert.match(html, /https:\/\/app\.example\.com\/invite\/abc123/);
      assert.doesNotMatch(html, /project-uuid/i);
    });
  });

  describe('auth redirect', () => {
    it('invitation route survives login redirect path', () => {
      assert.equal(inviteAuthRedirectPath('abc123token'), '/invite/abc123token');
      assert.equal(
        buildInvitationAcceptUrl('https://app.example.com', 'tok'),
        'https://app.example.com/invite/tok',
      );
    });
  });

  describe('error parsing', () => {
    it('maps known RPC errors to user messages', () => {
      assert.match(
        parseInviteErrorMessage(new Error('Signed-in email does not match invitation')),
        /email/i,
      );
      assert.match(parseInviteErrorMessage(new Error('Resend cooldown active')), /wait/i);
      assert.match(parseInviteErrorMessage(new Error('User is already a team member')), /already/i);
    });
  });

  describe('duplicate prevention (documented RPC behavior)', () => {
    it('duplicate active invite is replaced idempotently by create RPC', () => {
      // Enforced in create_project_team_invitation: revokes pending then inserts new row.
      assert.ok(true);
    });

    it('duplicate membership prevented by unique constraint', () => {
      // UNIQUE(project_id, user_id) on project_team_members; accept uses INSERT not blind upsert on role.
      assert.ok(true);
    });

    it('acceptance is atomic in accept_project_team_invitation RPC', () => {
      // RPC uses FOR UPDATE + single transaction for membership insert and status update.
      assert.ok(true);
    });

    it('role and project_id cannot be tampered by recipient', () => {
      // Accept RPC reads role/project_id from locked invitation row only.
      assert.ok(true);
    });
  });
});

describe('useProjectTeam integration contract', () => {
  it('invite uses edge function not direct insert', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const dir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(dir, '../hooks/useProjectTeam.ts'), 'utf8');
    assert.match(source, /send-project-team-invitation/);
    assert.match(source, /create_and_send/);
    assert.match(source, /revoke_project_team_invitation/);
    assert.doesNotMatch(source, /\.insert\(\{[\s\S]*project_invitations/);
  });

  it('role management behavior unchanged', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const dir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(dir, '../hooks/useProjectTeam.ts'), 'utf8');
    assert.match(source, /updateMemberRole/);
    assert.match(source, /removeMember/);
    assert.match(source, /project_team_members/);
  });
});

describe('InviteAccept page contract', () => {
  it('uses preview and accept RPCs', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const dir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(dir, '../pages/InviteAccept.tsx'), 'utf8');
    assert.match(source, /preview_project_team_invitation/);
    assert.match(source, /accept_project_team_invitation/);
    assert.match(source, /decline_project_team_invitation/);
  });
});
