import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  User,
  MoreVertical,
  UserMinus,
  Shield,
  Clock,
  X,
  Crown,
} from 'lucide-react';
import { format } from 'date-fns';
import { TeamMember, ProjectInvitation, TeamRole, TEAM_ROLE_LABELS, TEAM_ROLE_OPTIONS } from '@/types/team';

interface TeamMemberListProps {
  members: TeamMember[];
  invitations: ProjectInvitation[];
  ownerUserId: string;
  currentUserId: string;
  isAdmin: boolean;
  onUpdateRole: (memberId: string, role: TeamRole) => Promise<boolean>;
  onRemoveMember: (memberId: string) => Promise<boolean>;
  onCancelInvitation: (invitationId: string) => Promise<boolean>;
}

export function TeamMemberList({
  members,
  invitations,
  ownerUserId,
  currentUserId,
  isAdmin,
  onUpdateRole,
  onRemoveMember,
  onCancelInvitation,
}: TeamMemberListProps) {
  const [removeMember, setRemoveMember] = useState<TeamMember | null>(null);
  const [cancelInvite, setCancelInvite] = useState<ProjectInvitation | null>(null);
  const [removing, setRemoving] = useState(false);

  const getInitials = (name: string | null | undefined): string => {
    if (!name) return '?';
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const handleRemoveMember = async () => {
    if (!removeMember) return;
    setRemoving(true);
    await onRemoveMember(removeMember.id);
    setRemoving(false);
    setRemoveMember(null);
  };

  const handleCancelInvitation = async () => {
    if (!cancelInvite) return;
    setRemoving(true);
    await onCancelInvitation(cancelInvite.id);
    setRemoving(false);
    setCancelInvite(null);
  };

  const getRoleBadgeVariant = (role: TeamRole) => {
    switch (role) {
      case 'owner':
      case 'admin':
        return 'default';
      case 'editor':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  return (
    <>
      <div className="space-y-1">
        {/* Owner */}
        <div className="flex items-center gap-3 py-3 px-2 rounded-lg bg-muted/30">
          <Avatar className="h-9 w-9">
            <AvatarFallback className="bg-primary/10 text-primary">
              <Crown className="h-4 w-4" />
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">Project Owner</p>
            <p className="text-xs text-muted-foreground">
              {ownerUserId === currentUserId ? 'You' : 'Owner'}
            </p>
          </div>
          <Badge variant="default" className="shrink-0">Owner</Badge>
        </div>

        {/* Team Members */}
        {members.map((member) => {
          const isCurrentUser = member.user_id === currentUserId;
          const canManage = isAdmin && !isCurrentUser;

          return (
            <div
              key={member.id}
              className="flex items-center gap-3 py-3 px-2 hover:bg-muted/50 rounded-lg transition-colors"
            >
              <Avatar className="h-9 w-9">
                <AvatarFallback>
                  {getInitials(member.profile?.full_name)}
                </AvatarFallback>
              </Avatar>

              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">
                  {member.profile?.full_name || 'Team Member'}
                  {isCurrentUser && <span className="text-muted-foreground ml-1">(You)</span>}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {member.profile?.company_name || `Added ${format(new Date(member.created_at), 'MMM d, yyyy')}`}
                </p>
              </div>

              {canManage ? (
                <div className="flex items-center gap-2">
                  <Select
                    value={member.role}
                    onValueChange={(value) => onUpdateRole(member.id, value as TeamRole)}
                  >
                    <SelectTrigger className="w-24 h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TEAM_ROLE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => setRemoveMember(member)}
                      >
                        <UserMinus className="mr-2 h-4 w-4" />
                        Remove from Team
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ) : (
                <Badge variant={getRoleBadgeVariant(member.role)} className="shrink-0">
                  {TEAM_ROLE_LABELS[member.role]}
                </Badge>
              )}
            </div>
          );
        })}

        {/* Pending Invitations */}
        {invitations.length > 0 && (
          <>
            <div className="pt-4 pb-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Pending Invitations
              </p>
            </div>
            {invitations.map((invitation) => (
              <div
                key={invitation.id}
                className="flex items-center gap-3 py-3 px-2 hover:bg-muted/50 rounded-lg transition-colors border border-dashed"
              >
                <Avatar className="h-9 w-9">
                  <AvatarFallback className="bg-muted">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                  </AvatarFallback>
                </Avatar>

                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{invitation.email}</p>
                  <p className="text-xs text-muted-foreground">
                    Expires {format(new Date(invitation.expires_at), 'MMM d, yyyy')}
                  </p>
                </div>

                <Badge variant="outline" className="shrink-0">
                  {TEAM_ROLE_LABELS[invitation.role]}
                </Badge>

                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setCancelInvite(invitation)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </>
        )}

        {members.length === 0 && invitations.length === 0 && (
          <div className="text-center py-6 text-muted-foreground">
            <User className="h-10 w-10 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No team members yet</p>
            <p className="text-xs">Invite someone to collaborate</p>
          </div>
        )}
      </div>

      {/* Remove member confirmation */}
      <AlertDialog open={!!removeMember} onOpenChange={(open) => !open && setRemoveMember(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Team Member</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove {removeMember?.profile?.full_name || 'this member'} from the project?
              They will no longer have access to this project.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemoveMember}
              disabled={removing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removing ? 'Removing...' : 'Remove'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel invitation confirmation */}
      <AlertDialog open={!!cancelInvite} onOpenChange={(open) => !open && setCancelInvite(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Invitation</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel the invitation sent to {cancelInvite?.email}?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Keep Invitation</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancelInvitation}
              disabled={removing}
            >
              {removing ? 'Cancelling...' : 'Cancel Invitation'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
