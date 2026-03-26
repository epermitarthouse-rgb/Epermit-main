import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { TeamMember, ProjectInvitation, TeamRole } from '@/types/team';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

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
      // Check if current user is owner
      const { data: project } = await supabase
        .from('projects')
        .select('user_id')
        .eq('id', projectId)
        .single();

      const userIsOwner = project?.user_id === user.id;
      setIsOwner(userIsOwner);

      // Fetch team members
      const { data: membersData, error: membersError } = await supabase
        .from('project_team_members')
        .select('id, project_id, user_id, role, created_at, updated_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });

      if (membersError) throw membersError;

      // Fetch profile data for each member
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

      // Merge profile data with members
      const membersWithProfiles = membersData?.map(m => ({
        ...m,
        profile: profiles[m.user_id] || null,
      })) as TeamMember[];

      setMembers(membersWithProfiles || []);

      // Check if current user is admin
      const currentMember = membersData?.find(m => m.user_id === user.id);
      setIsAdmin(userIsOwner || currentMember?.role === 'admin');

      // Fetch pending invitations
      const { data: invitationsData, error: invitationsError } = await supabase
        .from('project_invitations')
        .select('id, project_id, email, role, invited_by, token, status, expires_at, created_at, accepted_at')
        .eq('project_id', projectId)
        .eq('status', 'pending')
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

  const inviteMember = async (email: string, role: TeamRole): Promise<ProjectInvitation | null> => {
    if (!user || !projectId) {
      toast.error('You must be logged in to invite team members');
      return null;
    }

    try {
      // Check if already invited
      const existingInvite = invitations.find(
        i => i.email.toLowerCase() === email.toLowerCase() && i.status === 'pending'
      );
      if (existingInvite) {
        toast.error('This email has already been invited');
        return null;
      }

      // Check if already a member
      const { data: existingUser } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('user_id', user.id)
        .single();

      const { data: invitation, error } = await supabase
        .from('project_invitations')
        .insert({
          project_id: projectId,
          email: email.toLowerCase(),
          role,
          invited_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;

      setInvitations(prev => [invitation as ProjectInvitation, ...prev]);
      toast.success(`Invitation sent to ${email}`);
      return invitation as ProjectInvitation;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send invitation';
      toast.error(message);
      console.error('Error inviting member:', err);
      return null;
    }
  };

  const cancelInvitation = async (invitationId: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('project_invitations')
        .delete()
        .eq('id', invitationId);

      if (error) throw error;

      setInvitations(prev => prev.filter(i => i.id !== invitationId));
      toast.success('Invitation cancelled');
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to cancel invitation';
      toast.error(message);
      console.error('Error cancelling invitation:', err);
      return false;
    }
  };

  const updateMemberRole = async (memberId: string, newRole: TeamRole): Promise<boolean> => {
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
    cancelInvitation,
    updateMemberRole,
    removeMember,
  };
}
