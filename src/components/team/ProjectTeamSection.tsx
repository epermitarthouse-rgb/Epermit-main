import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Users, UserPlus, Loader2 } from 'lucide-react';
import { useProjectTeam } from '@/hooks/useProjectTeam';
import { InviteTeamMemberDialog } from './InviteTeamMemberDialog';
import { TeamMemberList } from './TeamMemberList';
import { useAuth } from '@/hooks/useAuth';

interface ProjectTeamSectionProps {
  projectId: string;
  projectOwnerId: string;
}

export function ProjectTeamSection({ projectId, projectOwnerId }: ProjectTeamSectionProps) {
  const { user } = useAuth();
  const {
    members,
    invitations,
    loading,
    isAdmin,
    inviteMember,
    cancelInvitation,
    updateMemberRole,
    removeMember,
  } = useProjectTeam(projectId);

  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviting, setInviting] = useState(false);

  const handleInvite = async (email: string, role: any) => {
    setInviting(true);
    await inviteMember(email, role);
    setInviting(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
          <Users className="h-4 w-4" />
          Team ({members.length + 1})
        </h3>
        {isAdmin && (
          <Button size="sm" onClick={() => setInviteDialogOpen(true)}>
            <UserPlus className="mr-2 h-4 w-4" />
            Invite
          </Button>
        )}
      </div>

      <Separator />

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <TeamMemberList
          members={members}
          invitations={invitations}
          ownerUserId={projectOwnerId}
          currentUserId={user?.id || ''}
          isAdmin={isAdmin}
          onUpdateRole={updateMemberRole}
          onRemoveMember={removeMember}
          onCancelInvitation={cancelInvitation}
        />
      )}

      <InviteTeamMemberDialog
        open={inviteDialogOpen}
        onOpenChange={setInviteDialogOpen}
        onInvite={handleInvite}
        inviting={inviting}
      />
    </div>
  );
}
