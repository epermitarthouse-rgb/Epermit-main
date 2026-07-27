import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Project, ProjectStatus, ProjectType, PROJECT_STATUS_CONFIG } from '@/types/project';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { logProjectActivity } from '@/lib/activityLogger';

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

/** Supabase/Postgrest errors are plain objects — not always `instanceof Error`. */
function extractSupabaseError(err: unknown): { message: string; code?: string; details?: string } {
  if (!err) return { message: 'Unknown error' };
  if (err instanceof Error) {
    const withCode = err as Error & { code?: string; details?: string };
    return { message: err.message, code: withCode.code, details: withCode.details };
  }
  if (typeof err === 'object') {
    const e = err as { message?: string; code?: string; details?: string; hint?: string; error_description?: string };
    const message =
      e.message ||
      e.error_description ||
      e.hint ||
      e.details ||
      'Request failed';
    return { message: String(message), code: e.code, details: e.details };
  }
  return { message: String(err) };
}

function friendlyProjectMutationError(err: unknown, fallback: string): string {
  const { message, code } = extractSupabaseError(err);
  const msg = message.toLowerCase();

  if (code === '42501' || msg.includes('row-level security') || msg.includes('permission denied')) {
    return 'Permission denied — you do not have access to create or update this project.';
  }
  if (code === '23505' || msg.includes('duplicate key') || msg.includes('already exists')) {
    return 'A project with this information already exists.';
  }
  if (code === '23502' || msg.includes('null value in column')) {
    return 'Missing required project information.';
  }
  if (code === '23514' || msg.includes('check constraint') || msg.includes('violates check')) {
    return 'One or more project fields failed validation.';
  }
  if (code === '23503' || msg.includes('foreign key')) {
    return 'A linked credential or reference is invalid. Choose another credential or clear it.';
  }
  if (code === 'PGRST116' || msg.includes('0 rows') || msg.includes('contains 0 rows')) {
    return 'Project save completed but could not be reloaded. Refresh the Projects list.';
  }
  if (isProjectsSchemaMismatchError({ message, code })) {
    return 'Project database schema is out of date for some fields. Try again with core project details only.';
  }
  // Avoid dumping SQL / internal stack fragments into the toast.
  if (msg.includes('syntax error') || msg.includes('sqlstate')) {
    return fallback;
  }
  return message || fallback;
}

const EXTENDED_CREATE_KEYS = [
  'client_name',
  'client_email',
  'service_type',
  'contract_value',
  'reimbursement_amount',
  'reimbursement_description',
  'project_url',
  'credential_id',
] as const;

function buildProjectInsertPayload(
  data: CreateProjectData,
  userId: string,
  options: { includeExtended: boolean },
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: data.name.trim(),
    user_id: userId,
    status: 'draft' as ProjectStatus,
  };

  const assignIfPresent = (key: string, value: unknown) => {
    if (value === undefined || value === null) return;
    if (typeof value === 'string' && value.trim() === '') return;
    payload[key] = value;
  };

  assignIfPresent('address', data.address);
  assignIfPresent('city', data.city);
  assignIfPresent('state', data.state);
  assignIfPresent('zip_code', data.zip_code);
  assignIfPresent('jurisdiction', data.jurisdiction);
  assignIfPresent('project_type', data.project_type);
  assignIfPresent('description', data.description);
  assignIfPresent('estimated_value', data.estimated_value);
  assignIfPresent('square_footage', data.square_footage);
  assignIfPresent('deadline', data.deadline);
  assignIfPresent('notes', data.notes);
  assignIfPresent('permit_number', data.permit_number);

  // Fee fields: only send when explicitly provided (avoid forcing 0 on every create).
  if (data.permit_fee !== undefined) payload.permit_fee = data.permit_fee;
  if (data.expeditor_cost !== undefined) payload.expeditor_cost = data.expeditor_cost;
  if (data.total_cost !== undefined) payload.total_cost = data.total_cost;

  if (options.includeExtended) {
    for (const key of EXTENDED_CREATE_KEYS) {
      const value = data[key];
      if (value === undefined || value === null) continue;
      if (typeof value === 'string' && value.trim() === '') continue;
      payload[key] = value;
    }
  }

  return payload;
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

      setProjects(((data || []) as Record<string, unknown>[]).map(normalizeProjectRow));
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

    if (!data.name?.trim()) {
      toast.error('Missing required project information — project name is required.');
      return null;
    }

    try {
      const attemptInsert = async (includeExtended: boolean) => {
        const payload = buildProjectInsertPayload(data, user.id, { includeExtended });
        return supabase
          .from('projects')
          .insert(payload)
          .select(includeExtended ? PROJECT_SELECT_COLUMNS : PROJECT_CORE_SELECT_COLUMNS)
          .single();
      };

      let { data: newProject, error } = await attemptInsert(true);

      if (error && isProjectsSchemaMismatchError(error)) {
        const retry = await attemptInsert(false);
        newProject = retry.data;
        error = retry.error;
      }

      if (error) throw error;
      if (!newProject) throw new Error('Project create returned no row');

      const normalized = normalizeProjectRow(newProject as Record<string, unknown>);
      setProjects(prev => [normalized, ...prev]);

      // Best-effort activity log — must not fail project creation.
      await logProjectActivity(
        normalized.id,
        user.id,
        'project_created',
        `Project "${data.name}" created`,
        data.description || undefined,
        { project_type: data.project_type },
      );

      toast.success('Project created successfully');
      return normalized;
    } catch (err) {
      const message = friendlyProjectMutationError(err, 'Failed to create project');
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
        prev.map(p =>
          p.id === id ? normalizeProjectRow(updatedProject as Record<string, unknown>) : p,
        ),
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
      
      return normalizeProjectRow(updatedProject as Record<string, unknown>);
    } catch (err) {
      const message = friendlyProjectMutationError(err, 'Failed to update project');
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
      const message = friendlyProjectMutationError(err, 'Failed to delete project');
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
        setProjects(prev => prev.map(p => (p.id === id ? normalized : p)));
        return normalized;
      } catch (err) {
        console.error('Error refreshing project:', err);
        return null;
      }
    },
    [user],
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
