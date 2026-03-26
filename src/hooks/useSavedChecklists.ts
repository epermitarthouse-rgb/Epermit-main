import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface ChecklistItem {
  id: string;
  category: string;
  item: string;
  requirement: string;
  checked: boolean;
  notes: string;
  status: 'pending' | 'pass' | 'fail' | 'na';
}

export interface ChecklistFormData {
  projectName: string;
  projectAddress: string;
  inspectionType: string;
  inspectorName: string;
  permitNumber: string;
  inspectionDate: string;
  weather: string;
  temperature: string;
  generalNotes: string;
}

const DEFAULT_FORM_DATA: ChecklistFormData = {
  projectName: '',
  projectAddress: '',
  inspectionType: '',
  inspectorName: '',
  permitNumber: '',
  inspectionDate: '',
  weather: '',
  temperature: '',
  generalNotes: '',
};

export type SavedChecklistStatus = 'draft' | 'in_progress' | 'completed' | 'signed';

export interface SavedChecklist {
  id: string;
  user_id: string;
  project_id: string | null;
  inspection_id: string | null;
  name: string;
  form_data: ChecklistFormData;
  checklist_items: ChecklistItem[];
  custom_items: ChecklistItem[];
  inspector_signature: string | null;
  contractor_signature: string | null;
  inspector_signed_at: string | null;
  contractor_signed_at: string | null;
  status: SavedChecklistStatus;
  created_at: string;
  updated_at: string;
}

export interface CreateSavedChecklistData {
  project_id?: string | null;
  inspection_id?: string | null;
  name: string;
  form_data: ChecklistFormData;
  checklist_items: ChecklistItem[];
  custom_items: ChecklistItem[];
  inspector_signature?: string | null;
  contractor_signature?: string | null;
  inspector_signed_at?: string | null;
  contractor_signed_at?: string | null;
  status?: SavedChecklistStatus;
}

export function useSavedChecklists(projectId?: string) {
  const { user } = useAuth();
  const [savedChecklists, setSavedChecklists] = useState<SavedChecklist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSavedChecklists = useCallback(async () => {
    if (!user) {
      setSavedChecklists([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      let query = supabase
        .from('saved_inspection_checklists')
        .select('*')
        .order('updated_at', { ascending: false });

      if (projectId) {
        query = query.eq('project_id', projectId);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;

      const parsedData: SavedChecklist[] = (data || []).map(item => ({
        ...item,
        form_data: { ...DEFAULT_FORM_DATA, ...(item.form_data as unknown as Partial<ChecklistFormData>) },
        checklist_items: (item.checklist_items as unknown as ChecklistItem[]) || [],
        custom_items: (item.custom_items as unknown as ChecklistItem[]) || [],
        status: item.status as SavedChecklistStatus,
      }));

      setSavedChecklists(parsedData);
      setError(null);
    } catch (err) {
      console.error('Error fetching saved checklists:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch saved checklists');
    } finally {
      setLoading(false);
    }
  }, [user, projectId]);

  useEffect(() => {
    fetchSavedChecklists();
  }, [fetchSavedChecklists]);

  const saveChecklist = async (data: CreateSavedChecklistData): Promise<SavedChecklist | null> => {
    if (!user) {
      toast.error('You must be logged in to save checklists');
      return null;
    }

    try {
      const insertData = {
        user_id: user.id,
        project_id: data.project_id || null,
        inspection_id: data.inspection_id || null,
        name: data.name,
        form_data: JSON.parse(JSON.stringify(data.form_data)),
        checklist_items: JSON.parse(JSON.stringify(data.checklist_items)),
        custom_items: JSON.parse(JSON.stringify(data.custom_items)),
        inspector_signature: data.inspector_signature || null,
        contractor_signature: data.contractor_signature || null,
        inspector_signed_at: data.inspector_signed_at || null,
        contractor_signed_at: data.contractor_signed_at || null,
        status: data.status || 'draft',
      };

      const { data: newChecklist, error: insertError } = await supabase
        .from('saved_inspection_checklists')
        .insert([insertData])
        .select()
        .single();

      if (insertError) throw insertError;

      const parsed: SavedChecklist = {
        ...newChecklist,
        form_data: { ...DEFAULT_FORM_DATA, ...(newChecklist.form_data as unknown as Partial<ChecklistFormData>) },
        checklist_items: (newChecklist.checklist_items as unknown as ChecklistItem[]) || [],
        custom_items: (newChecklist.custom_items as unknown as ChecklistItem[]) || [],
        status: newChecklist.status as SavedChecklistStatus,
      };

      setSavedChecklists(prev => [parsed, ...prev]);
      toast.success('Checklist saved successfully');
      return parsed;
    } catch (err) {
      console.error('Error saving checklist:', err);
      toast.error('Failed to save checklist');
      return null;
    }
  };

  const updateChecklist = async (
    id: string,
    data: Partial<CreateSavedChecklistData>
  ): Promise<SavedChecklist | null> => {
    if (!user) {
      toast.error('You must be logged in to update checklists');
      return null;
    }

    try {
      const updateData: Record<string, unknown> = {};
      
      if (data.name !== undefined) updateData.name = data.name;
      if (data.project_id !== undefined) updateData.project_id = data.project_id;
      if (data.inspection_id !== undefined) updateData.inspection_id = data.inspection_id;
      if (data.form_data !== undefined) updateData.form_data = JSON.parse(JSON.stringify(data.form_data));
      if (data.checklist_items !== undefined) updateData.checklist_items = JSON.parse(JSON.stringify(data.checklist_items));
      if (data.custom_items !== undefined) updateData.custom_items = JSON.parse(JSON.stringify(data.custom_items));
      if (data.inspector_signature !== undefined) updateData.inspector_signature = data.inspector_signature;
      if (data.contractor_signature !== undefined) updateData.contractor_signature = data.contractor_signature;
      if (data.inspector_signed_at !== undefined) updateData.inspector_signed_at = data.inspector_signed_at;
      if (data.contractor_signed_at !== undefined) updateData.contractor_signed_at = data.contractor_signed_at;
      if (data.status !== undefined) updateData.status = data.status;

      const { data: updatedChecklist, error: updateError } = await supabase
        .from('saved_inspection_checklists')
        .update(updateData)
        .eq('id', id)
        .eq('user_id', user.id)
        .select()
        .single();

      if (updateError) throw updateError;

      const parsed: SavedChecklist = {
        ...updatedChecklist,
        form_data: { ...DEFAULT_FORM_DATA, ...(updatedChecklist.form_data as unknown as Partial<ChecklistFormData>) },
        checklist_items: (updatedChecklist.checklist_items as unknown as ChecklistItem[]) || [],
        custom_items: (updatedChecklist.custom_items as unknown as ChecklistItem[]) || [],
        status: updatedChecklist.status as SavedChecklistStatus,
      };

      setSavedChecklists(prev =>
        prev.map(c => (c.id === id ? parsed : c))
      );
      toast.success('Checklist updated successfully');
      return parsed;
    } catch (err) {
      console.error('Error updating checklist:', err);
      toast.error('Failed to update checklist');
      return null;
    }
  };

  const deleteChecklist = async (id: string): Promise<boolean> => {
    if (!user) {
      toast.error('You must be logged in to delete checklists');
      return false;
    }

    try {
      const { error: deleteError } = await supabase
        .from('saved_inspection_checklists')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);

      if (deleteError) throw deleteError;

      setSavedChecklists(prev => prev.filter(c => c.id !== id));
      toast.success('Checklist deleted successfully');
      return true;
    } catch (err) {
      console.error('Error deleting checklist:', err);
      toast.error('Failed to delete checklist');
      return false;
    }
  };

  const deleteMultipleChecklists = async (ids: string[]): Promise<boolean> => {
    if (!user) {
      toast.error('You must be logged in to delete checklists');
      return false;
    }

    if (ids.length === 0) return true;

    try {
      const { error: deleteError } = await supabase
        .from('saved_inspection_checklists')
        .delete()
        .in('id', ids)
        .eq('user_id', user.id);

      if (deleteError) throw deleteError;

      setSavedChecklists(prev => prev.filter(c => !ids.includes(c.id)));
      toast.success(`${ids.length} checklist(s) deleted successfully`);
      return true;
    } catch (err) {
      console.error('Error deleting checklists:', err);
      toast.error('Failed to delete checklists');
      return false;
    }
  };

  const updateMultipleChecklistsStatus = async (
    ids: string[],
    status: SavedChecklistStatus
  ): Promise<boolean> => {
    if (!user) {
      toast.error('You must be logged in to update checklists');
      return false;
    }

    if (ids.length === 0) return true;

    try {
      const { error: updateError } = await supabase
        .from('saved_inspection_checklists')
        .update({ status })
        .in('id', ids)
        .eq('user_id', user.id);

      if (updateError) throw updateError;

      setSavedChecklists(prev =>
        prev.map(c => (ids.includes(c.id) ? { ...c, status } : c))
      );
      toast.success(`${ids.length} checklist(s) updated to "${status}"`);
      return true;
    } catch (err) {
      console.error('Error updating checklists:', err);
      toast.error('Failed to update checklists');
      return false;
    }
  };

  const getChecklistById = async (id: string): Promise<SavedChecklist | null> => {
    if (!user) return null;

    try {
      const { data, error } = await supabase
        .from('saved_inspection_checklists')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      return {
        ...data,
        form_data: { ...DEFAULT_FORM_DATA, ...(data.form_data as unknown as Partial<ChecklistFormData>) },
        checklist_items: (data.checklist_items as unknown as ChecklistItem[]) || [],
        custom_items: (data.custom_items as unknown as ChecklistItem[]) || [],
        status: data.status as SavedChecklistStatus,
      };
    } catch (err) {
      console.error('Error fetching checklist:', err);
      return null;
    }
  };

  const duplicateChecklist = async (id: string, newName: string): Promise<SavedChecklist | null> => {
    const original = await getChecklistById(id);
    if (!original) {
      toast.error('Could not find original checklist');
      return null;
    }

    return saveChecklist({
      project_id: original.project_id,
      inspection_id: null, // Don't duplicate the inspection link
      name: newName,
      form_data: original.form_data,
      checklist_items: original.checklist_items.map(item => ({
        ...item,
        status: 'pending',
        checked: false,
        notes: '',
      })),
      custom_items: original.custom_items.map(item => ({
        ...item,
        status: 'pending',
        checked: false,
        notes: '',
      })),
      status: 'draft',
    });
  };

  return {
    savedChecklists,
    loading,
    error,
    saveChecklist,
    updateChecklist,
    deleteChecklist,
    deleteMultipleChecklists,
    updateMultipleChecklistsStatus,
    getChecklistById,
    duplicateChecklist,
    refetch: fetchSavedChecklists,
  };
}
