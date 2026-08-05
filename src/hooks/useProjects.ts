import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Project, ProjectStatus, ProjectType, PROJECT_STATUS_CONFIG } from '@/types/project';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { logProjectActivity } from '@/lib/activityLogger';
import {
  DASHBOARD_SELECTED_PROJECT_QUERY_KEY,
  SIDEBAR_PORTAL_CREDENTIAL_QUERY_KEY,
} from '@/lib/portalMonitorScrapeOptions';

/** Shared cache key — every useProjects() caller must see the same list. */
export const PROJECTS_QUERY_KEY = 'projects' as const;

export function projectsQueryKey(userId: string) {
  return [PROJECTS_QUERY_KEY, userId] as const;
}

/** Columns added in Phase 4 QB/billing migrations — omit from fallback select if DB not migrated yet. */
const PHASE_4_PLUS_OPTIONAL_PROJECT_COLUMNS = new Set([
  'client_name',
  'client_email',
  'service_type',
  'contract_value',
  'reimbursement_amount',
  'reimbursement_description',
  'qb_customer_id',
  'qb_invoice_id_m1',
  'qb_invoice_id_m2',
  'qb_invoice_id_m3',
  'm1_triggered',
  'm2_triggered',
  'm3_triggered',
  'm1_triggered_at',
  'm2_triggered_at',
  'm3_triggered_at',
  'm1_trigger_source',
  'm2_trigger_source',
  'm3_trigger_source',
]);

const PROJECT_COLUMN_LIST = [
  'id',
  'name',
  'permit_number',
  'jurisdiction',
  'status',
  'user_id',
  'portal_status',
  'last_checked_at',
  'created_at',
  'updated_at',
  'is_shadow_mode',
  'address',
  'project_url',
  'city',
  'state',
  'zip_code',
  'project_type',
  'description',
  'estimated_value',
  'square_footage',
  'deadline',
  'notes',
  'permit_fee',
  'expeditor_cost',
  'total_cost',
  'credential_id',
  'submitted_at',
  'approved_at',
  'rejection_count',
  'rejection_reasons',
  'client_name',
  'client_email',
  'service_type',
  'contract_value',
  'reimbursement_amount',
  'reimbursement_description',
  'qb_customer_id',
  'qb_invoice_id_m1',
  'qb_invoice_id_m2',
  'qb_invoice_id_m3',
  'm1_triggered',
  'm2_triggered',
  'm3_triggered',
  'm1_triggered_at',
  'm2_triggered_at',
  'm3_triggered_at',
  'm1_trigger_source',
  'm2_trigger_source',
  'm3_trigger_source',
] as const;

const PROJECT_SELECT_COLUMNS = PROJECT_COLUMN_LIST.join(',');

const PROJECT_CORE_SELECT_COLUMNS = PROJECT_COLUMN_LIST.filter(
  c => !PHASE_4_PLUS_OPTIONAL_PROJECT_COLUMNS.has(c),
).join(',');

const PROJECT_EXTENDED_DEFAULTS_FOR_PARTIAL_ROWS: Pick<
  Project,
  | 'client_name'
  | 'client_email'
  | 'service_type'
  | 'contract_value'
  | 'reimbursement_amount'
  | 'reimbursement_description'
  | 'qb_customer_id'
  | 'qb_invoice_id_m1'
  | 'qb_invoice_id_m2'
  | 'qb_invoice_id_m3'
  | 'm1_triggered_at'
  | 'm2_triggered_at'
  | 'm3_triggered_at'
  | 'm1_trigger_source'
  | 'm2_trigger_source'
  | 'm3_trigger_source'
> = {
  client_name: null,
  client_email: null,
  service_type: null,
  contract_value: null,
  reimbursement_amount: null,
  reimbursement_description: null,
  qb_customer_id: null,
  qb_invoice_id_m1: null,
  qb_invoice_id_m2: null,
  qb_invoice_id_m3: null,
  m1_triggered_at: null,
  m2_triggered_at: null,
  m3_triggered_at: null,
  m1_trigger_source: null,
  m2_trigger_source: null,
  m3_trigger_source: null,
};

function normalizeProjectRow(row: Record<string, unknown>): Project {
  return {
    ...PROJECT_EXTENDED_DEFAULTS_FOR_PARTIAL_ROWS,
    ...(row as unknown as Project),
    m1_triggered: Boolean(row.m1_triggered),
    m2_triggered: Boolean(row.m2_triggered),
    m3_triggered: Boolean(row.m3_triggered),
  };
}

function isProjectsSchemaMismatchError(err: { message?: string; code?: string } | null): boolean {
  if (!err) return false;
  const msg = String(err.message || '').toLowerCase();
  const code = String(err.code || '');
  return (
    code === '42703' ||
    code === 'PGRST204' ||
    msg.includes('does not exist') ||
    msg.includes('could not find') ||
    msg.includes('schema cache')
  );
}

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
  /** Optional billing fields (Phase 4C); null clears values on update. */
  client_name?: string | null;
  client_email?: string | null;
  service_type?: string | null;
  contract_value?: number | null;
  reimbursement_amount?: number | null;
  reimbursement_description?: string | null;
}

export interface UpdateProjectData extends Partial<CreateProjectData> {
  status?: ProjectStatus;
  permit_number?: string;
  submitted_at?: string;
  approved_at?: string;
  rejection_count?: number;
  rejection_reasons?: string[];
}

async function loadProjectsFromDb(): Promise<Project[]> {
  let { data, error: fetchError } = await supabase
    .from('projects')
    .select(PROJECT_SELECT_COLUMNS)
    .order('updated_at', { ascending: false });

  if (fetchError && isProjectsSchemaMismatchError(fetchError)) {
    const retry = await supabase
      .from('projects')
      .select(PROJECT_CORE_SELECT_COLUMNS)
      .order('updated_at', { ascending: false });
    data = retry.data;
    fetchError = retry.error;
  }

  if (fetchError) throw fetchError;

  return ((data || []) as Record<string, unknown>[]).map(normalizeProjectRow);
}

/**
 * Shared projects list for the signed-in user.
 *
 * IMPORTANT: This must use React Query (not per-hook useState). Header
 * ActiveProjectControl and AppSidebar both call useProjects(); with separate
 * local state, creating a project in the header left the sidebar's list stale,
 * and AppSidebar cleared the new selectedProjectId as "missing".
 */
export function useProjects() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = user ? projectsQueryKey(user.id) : ([PROJECTS_QUERY_KEY, 'anonymous'] as const);

  const {
    data: projects = [],
    isLoading,
    error: queryError,
  } = useQuery({
    queryKey,
    queryFn: loadProjectsFromDb,
    enabled: !!user,
  });

  const loading = !!user && isLoading;
  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : 'Failed to fetch projects'
    : null;

  const fetchProjects = useCallback(async () => {
    if (!user) return;
    await queryClient.invalidateQueries({ queryKey: projectsQueryKey(user.id) });
  }, [user, queryClient]);

  const patchProjectsCache = useCallback(
    (updater: (prev: Project[]) => Project[]) => {
      if (!user) return;
      queryClient.setQueryData<Project[]>(projectsQueryKey(user.id), (prev) =>
        updater(prev ?? []),
      );
    },
    [user, queryClient],
  );

  const createProject = async (data: CreateProjectData): Promise<Project | null> => {
    if (!user) {
      toast.error('You must be logged in to create a project');
      return null;
    }

    try {
      const { data: newProject, error: insertError } = await supabase
        .from('projects')
        .insert({
          ...data,
          user_id: user.id,
          status: 'draft' as ProjectStatus,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      const normalized = normalizeProjectRow(newProject as Record<string, unknown>);
      // Sync cache before callers auto-select — prevents AppSidebar stale-list clear.
      patchProjectsCache((prev) => {
        if (prev.some((p) => p.id === normalized.id)) {
          return prev.map((p) => (p.id === normalized.id ? normalized : p));
        }
        return [normalized, ...prev];
      });

      await logProjectActivity(
        newProject.id,
        user.id,
        'project_created',
        `Project "${data.name}" created`,
        data.description || undefined,
        { project_type: data.project_type }
      );

      toast.success('Project created successfully');
      return normalized;
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
      const currentProject = projects.find(p => p.id === id);

      const updateData: UpdateProjectData & { submitted_at?: string; approved_at?: string } = { ...data };

      if (data.status === 'submitted' && !updateData.submitted_at) {
        updateData.submitted_at = new Date().toISOString();
      }
      if (data.status === 'approved' && !updateData.approved_at) {
        updateData.approved_at = new Date().toISOString();
      }

      const { data: updatedProject, error: updateError } = await supabase
        .from('projects')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (updateError) throw updateError;

      const normalized = normalizeProjectRow(updatedProject as Record<string, unknown>);
      patchProjectsCache((prev) =>
        prev.map((p) => (p.id === id ? normalized : p)),
      );

      // Portal Monitor scrape-mode menu reads these queries — refresh as soon as
      // the project's portal credential binding changes (header or Edit Project).
      if (Object.prototype.hasOwnProperty.call(data, 'credential_id')) {
        void queryClient.invalidateQueries({
          queryKey: [SIDEBAR_PORTAL_CREDENTIAL_QUERY_KEY],
        });
        void queryClient.invalidateQueries({
          queryKey: [DASHBOARD_SELECTED_PROJECT_QUERY_KEY],
        });
      }

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

      return normalized;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update project';
      toast.error(message);
      console.error('Error updating project:', err);
      return null;
    }
  };

  const deleteProject = async (id: string): Promise<boolean> => {
    try {
      const { error: deleteError } = await supabase
        .from('projects')
        .delete()
        .eq('id', id);

      if (deleteError) throw deleteError;

      patchProjectsCache((prev) => prev.filter((p) => p.id !== id));
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

  const refreshProjectById = useCallback(
    async (id: string): Promise<Project | null> => {
      if (!user) return null;
      try {
        let { data, error: fetchError } = await supabase
          .from('projects')
          .select(PROJECT_SELECT_COLUMNS)
          .eq('id', id)
          .maybeSingle();

        if (fetchError && isProjectsSchemaMismatchError(fetchError)) {
          const retry = await supabase
            .from('projects')
            .select(PROJECT_CORE_SELECT_COLUMNS)
            .eq('id', id)
            .maybeSingle();
          data = retry.data;
          fetchError = retry.error;
        }

        if (fetchError) throw fetchError;
        if (!data) return null;

        const normalized = normalizeProjectRow(data as Record<string, unknown>);
        patchProjectsCache((prev) =>
          prev.map((p) => (p.id === id ? normalized : p)),
        );
        return normalized;
      } catch (err) {
        console.error('Error refreshing project:', err);
        return null;
      }
    },
    [user, patchProjectsCache],
  );

  return {
    projects,
    loading,
    error,
    fetchProjects,
    refreshProjectById,
    createProject,
    updateProject,
    deleteProject,
    getProjectsByStatus,
  };
}
