export interface ProjectShareLink {
  id: string;
  project_id: string;
  token: string;
  created_by: string;
  expires_at: string | null;
  is_active: boolean;
  view_count: number;
  last_viewed_at: string | null;
  created_at: string;
}

export interface CreateShareLinkData {
  project_id: string;
  expires_at?: string | null;
}
