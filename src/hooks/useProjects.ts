import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Project, ProjectStatus, ProjectType, PROJECT_STATUS_CONFIG } from '@/types/project';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { logProjectActivity } from '@/lib/activityLogger';

export interface CreateProjectData {
  name: string;
  address?: string;
  project_url?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  jurisdiction?: string;
  project_type?: ProjectType;
  description?: string;
  estimated_value?: number;
  square_footage?: number;
  deadline?: string;
  notes?: string;
  permit_fee?: number;
  expeditor_cost?: number;
  total_cost?: number;
  permit_number?: string | null;
  credential_id?: string | null;
}

export interface UpdateProjectData extends Partial<CreateProjectData> {
  status?: ProjectStatus;
  permit_number?: string;
  submitted_at?: string;
  approved_at?: string;
  rejection_count?: number;
  rejection_reasons?: string[];
}

export function useProjects() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    if (!user) {
      setProjects([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('projects')
        .select('id, name, permit_number, jurisdiction, status, user_id, portal_status, last_checked_at, created_at, updated_at, is_shadow_mode, address, project_url, city, state, zip_code, project_type, description, estimated_value, square_footage, deadline, notes, permit_fee, expeditor_cost, total_cost, credential_id, submitted_at, approved_at, rejection_count, rejection_reasons')
        .order('updated_at', { ascending: false });

      if (fetchError) throw fetchError;

      setProjects((data as Project[]) || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch projects';
      setError(message);
      console.error('Error fetching projects:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const createProject = async (data: CreateProjectData): Promise<Project | null> => {
    if (!user) {
      toast.error('You must be logged in to create a project');
      return null;
    }

    try {
      const { data: newProject, error } = await supabase
        .from('projects')
        .insert({
          ...data,
          user_id: user.id,
          status: 'draft' as ProjectStatus,
        })
        .select()
        .single();

      if (error) throw error;

      setProjects(prev => [newProject as Project, ...prev]);
      
      // Log activity
      await logProjectActivity(
        newProject.id,
        user.id,
        'project_created',
        `Project "${data.name}" created`,
        data.description || undefined,
        { project_type: data.project_type }
      );
      
      toast.success('Project created successfully');
      return newProject as Project;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create project';
      toast.error(message);
      console.error('Error creating project:', err);
      return null;
    }
  };

  const updateProject = async (id: string, data: UpdateProjectData): Promise<Project | null> => {
    if (!user) return null;
    
    try {
      // Get current project for comparison
      const currentProject = projects.find(p => p.id === id);
      
      // Handle status transitions
      const updateData: UpdateProjectData & { submitted_at?: string; approved_at?: string } = { ...data };
      
      if (data.status === 'submitted' && !updateData.submitted_at) {
        updateData.submitted_at = new Date().toISOString();
      }
      if (data.status === 'approved' && !updateData.approved_at) {
        updateData.approved_at = new Date().toISOString();
      }

      const { data: updatedProject, error } = await supabase
        .from('projects')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      setProjects(prev => 
        prev.map(p => p.id === id ? (updatedProject as Project) : p)
      );
      
      // Log activity
      if (data.status && currentProject && data.status !== currentProject.status) {
        const oldStatus = PROJECT_STATUS_CONFIG[currentProject.status].label;
        const newStatus = PROJECT_STATUS_CONFIG[data.status].label;
        await logProjectActivity(
          id,
          user.id,
          'project_status_changed',
          `Status changed from ${oldStatus} to ${newStatus}`,
          undefined,
          { old_status: currentProject.status, new_status: data.status }
        );
        toast.success(`Project moved to ${data.status.replace('_', ' ')}`);
      } else {
        await logProjectActivity(
          id,
          user.id,
          'project_updated',
          'Project details updated',
          undefined,
          { updated_fields: Object.keys(data) }
        );
        toast.success('Project updated successfully');
      }
      
      return updatedProject as Project;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update project';
      toast.error(message);
      console.error('Error updating project:', err);
      return null;
    }
  };

  const deleteProject = async (id: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', id);

      if (error) throw error;

      setProjects(prev => prev.filter(p => p.id !== id));
      toast.success('Project deleted successfully');
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete project';
      toast.error(message);
      console.error('Error deleting project:', err);
      return false;
    }
  };

  const getProjectsByStatus = useCallback((status: ProjectStatus): Project[] => {
    return projects.filter(p => p.status === status);
  }, [projects]);

  return {
    projects,
    loading,
    error,
    fetchProjects,
    createProject,
    updateProject,
    deleteProject,
    getProjectsByStatus,
  };
}
