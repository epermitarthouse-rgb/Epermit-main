export type TeamRole = 'owner' | 'admin' | 'editor' | 'viewer';

export interface TeamMember {
  id: string;
  project_id: string;
  user_id: string;
  role: TeamRole;
  added_by: string;
  created_at: string;
  updated_at: string;
  // Joined from profiles
  profile?: {
    full_name: string | null;
    company_name: string | null;
  };
  // Joined from auth.users (via edge function)
  email?: string;
}

export interface ProjectInvitation {
  id: string;
  project_id: string;
  email: string;
  role: TeamRole;
  invited_by: string;
  token: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  expires_at: string;
  created_at: string;
  accepted_at: string | null;
}

export const TEAM_ROLE_LABELS: Record<TeamRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
};

export const TEAM_ROLE_DESCRIPTIONS: Record<TeamRole, string> = {
  owner: 'Full control over the project',
  admin: 'Can manage team and settings',
  editor: 'Can edit project and documents',
  viewer: 'Can view project and documents',
};

export const TEAM_ROLE_OPTIONS: { value: TeamRole; label: string; description: string }[] = [
  { value: 'admin', label: 'Admin', description: 'Can manage team and settings' },
  { value: 'editor', label: 'Editor', description: 'Can edit project and documents' },
  { value: 'viewer', label: 'Viewer', description: 'Can view project and documents' },
];
