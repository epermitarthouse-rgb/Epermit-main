import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import {
  TeamMember,
  ProjectInvitation,
  TeamRole,
  InviteMemberResult,
} from '@/types/team';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import {
  canResendInvitation,
  parseInviteErrorMessage,
  resendCooldownRemainingMs,
  INVITE_RESEND_COOLDOWN_MS,
} from '@/lib/projectTeamInvitationLogic';

const INVITATION_SELECT =
  'id, project_id, email, role, invited_by, status, expires_at, created_at, accepted_at, accepted_by, revoked_at, last_sent_at, updated_at';

export function useProjectTeam(projectId: string | null) {
  const { user } = useAuth();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<ProjectInvitation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const fetchTeam = useCallback(async () => {
    if (!user || !projectId) {
      setMembers([]);
      setInvitations([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data: project } = await supabase
        .from('projects')
        .select('user_id')
        .eq('id', projectId)
        .single();

      const userIsOwner = project?.user_id === user.id;
      setIsOwner(userIsOwner);

      const { data: membersData, error: membersError } = await supabase
        .from('project_team_members')
        .select('id, project_id, user_id, role, created_at, updated_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });

      if (membersError) throw membersError;

      const memberIds = membersData?.map(m => m.user_id) || [];
      let profiles: Record<string, { full_name: string | null; company_name: string | null }> = {};

      if (memberIds.length > 0) {
        const { data: profilesData } = await supabase
          .from('profiles')
          .select('user_id, full_name, company_name')
          .in('user_id', memberIds);

        profilesData?.forEach(p => {
          profiles[p.user_id] = { full_name: p.full_name, company_name: p.company_name };
        });
      }

      const membersWithProfiles = membersData?.map(m => ({
        ...m,
        profile: profiles[m.user_id] || null,
      })) as TeamMember[];

      setMembers(membersWithProfiles || []);

      const currentMember = membersData?.find(m => m.user_id === user.id);
      setIsAdmin(userIsOwner || currentMember?.role === 'admin');

      const { data: invitationsData, error: invitationsError } = await supabase
        .from('project_invitations')
        .select(INVITATION_SELECT)
        .eq('project_id', projectId)
        .in('status', ['pending', 'expired', 'declined', 'revoked'])
        .order('created_at', { ascending: false });

      if (invitationsError) throw invitationsError;

      setInvitations((invitationsData as ProjectInvitation[]) || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch team';
      setError(message);
      console.error('Error fetching team:', err);
    } finally {
      setLoading(false);
    }
  }, [user, projectId]);

  useEffect(() => {
    fetchTeam();
  }, [fetchTeam]);

  const inviteMember = async (email: string, role: TeamRole): Promise<InviteMemberResult> => {
    if (!user || !projectId) {
      toast.error('You must be logged in to invite team members');
      return { invitation: null, emailSent: false, error: 'Not authenticated' };
    }

    if (role === 'owner') {
      toast.error('Cannot invite as owner');
      return { invitation: null, emailSent: false, error: 'Invalid role' };
    }

    try {
      const { data, error } = await supabase.functions.invoke('send-project-team-invitation', {
        body: {
          action: 'create_and_send',
          project_id: projectId,
          email,
          role,
        },
      });

      if (error) throw error;

      const payload = data as {
        invitation_id?: string;
        email_sent?: boolean;
        error?: string;
        invitation_created?: boolean;
      };

      if (!payload?.invitation_id) {
        const msg = payload?.error || 'Failed to create invitation';
        toast.error(msg);
        return { invitation: null, emailSent: false, error: msg };
      }

      await fetchTeam();

      const { data: invitation } = await supabase
        .from('project_invitations')
        .select(INVITATION_SELECT)
        .eq('id', payload.invitation_id)
        .single();

      if (payload.email_sent) {
        toast.success(`Invitation email sent to ${email}`);
      } else {
        toast.warning(
          payload.error ||
            'Invitation saved but email could not be sent. Resend from the Team tab.',
        );
      }

      return {
        invitation: (invitation as ProjectInvitation) || null,
        emailSent: Boolean(payload.email_sent),
        error: payload.email_sent ? undefined : payload.error,
      };
    } catch (err) {
      const message = parseInviteErrorMessage(err);
      toast.error(message);
      console.error('Error inviting member:', err);
      return { invitation: null, emailSent: false, error: message };
    }
  };

  const resendInvitation = async (invitationId: string): Promise<boolean> => {
    const invitation = invitations.find(i => i.id === invitationId);
    if (invitation && !canResendInvitation(invitation.last_sent_at)) {
      const remaining = Math.ceil(
        resendCooldownRemainingMs(invitation.last_sent_at) / 1000 / 60,
      );
      toast.error(`Please wait ${remaining || 1} more minute(s) before resending`);
      return false;
    }

    try {
      const { data, error } = await supabase.functions.invoke('send-project-team-invitation', {
        body: {
          action: 'resend',
          invitation_id: invitationId,
        },
      });

      if (error) throw error;

      const payload = data as { email_sent?: boolean; error?: string };

      await fetchTeam();

      if (payload?.email_sent) {
        toast.success('Invitation resent');
        return true;
      }

      toast.warning(payload?.error || 'Invitation updated but email could not be sent');
      return false;
    } catch (err) {
      const message = parseInviteErrorMessage(err);
      toast.error(message);
      console.error('Error resending invitation:', err);
      return false;
    }
  };

  const cancelInvitation = async (invitationId: string): Promise<boolean> => {
    try {
      const { error } = await supabase.rpc('revoke_project_team_invitation', {
        p_invitation_id: invitationId,
      });

      if (error) throw error;

      await fetchTeam();
      toast.success('Invitation cancelled');
      return true;
    } catch (err) {
      const message = parseInviteErrorMessage(err);
      toast.error(message);
      console.error('Error cancelling invitation:', err);
      return false;
    }
  };

  const updateMemberRole = async (memberId: string, newRole: TeamRole): Promise<boolean> => {
    if (newRole === 'owner') {
      toast.error('Cannot assign owner role to team members');
      return false;
    }

    try {
      const { error } = await supabase
        .from('project_team_members')
        .update({ role: newRole })
        .eq('id', memberId);

      if (error) throw error;

      setMembers(prev =>
        prev.map(m => (m.id === memberId ? { ...m, role: newRole } : m))
      );
      toast.success('Role updated successfully');
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update role';
      toast.error(message);
      console.error('Error updating member role:', err);
      return false;
    }
  };

  const removeMember = async (memberId: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('project_team_members')
        .delete()
        .eq('id', memberId);

      if (error) throw error;

      setMembers(prev => prev.filter(m => m.id !== memberId));
      toast.success('Team member removed');
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove member';
      toast.error(message);
      console.error('Error removing member:', err);
      return false;
    }
  };

  return {
    members,
    invitations,
    loading,
    error,
    isOwner,
    isAdmin,
    fetchTeam,
    inviteMember,
    resendInvitation,
    cancelInvitation,
    updateMemberRole,
    removeMember,
    resendCooldownMs: INVITE_RESEND_COOLDOWN_MS,
  };
}
