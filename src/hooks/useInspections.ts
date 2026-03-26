import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Inspection, InspectionType, InspectionStatus, PunchListItem, PunchListPriority, INSPECTION_TYPE_LABELS } from '@/types/inspection';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { logProjectActivity } from '@/lib/activityLogger';

export interface CreateInspectionData {
  inspection_type: InspectionType;
  scheduled_date: string;
  inspector_name?: string;
  inspector_notes?: string;
}

export interface UpdateInspectionData {
  status?: InspectionStatus;
  scheduled_date?: string;
  completed_date?: string;
  inspector_name?: string;
  inspector_notes?: string;
  result_notes?: string;
}

export interface CreatePunchListItemData {
  title: string;
  description?: string;
  location?: string;
  priority?: PunchListPriority;
  assigned_to?: string;
  due_date?: string;
  inspection_id?: string;
}

export function useInspections(projectId: string | null) {
  const { user } = useAuth();
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [punchListItems, setPunchListItems] = useState<PunchListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchInspections = useCallback(async () => {
    if (!user || !projectId) {
      setInspections([]);
      setPunchListItems([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [inspectionsRes, punchListRes] = await Promise.all([
        supabase
          .from('inspections')
          .select('id, project_id, inspection_type, status, scheduled_date, completed_date, inspector_name, inspector_notes, result_notes, created_at, updated_at')
          .eq('project_id', projectId)
          .order('scheduled_date', { ascending: true }),
        supabase
          .from('punch_list_items')
          .select('id, project_id, inspection_id, user_id, title, description, location, priority, status, assigned_to, due_date, resolved_at, resolved_by, created_at, updated_at')
          .eq('project_id', projectId)
          .order('created_at', { ascending: false }),
      ]);

      if (inspectionsRes.error) throw inspectionsRes.error;
      if (punchListRes.error) throw punchListRes.error;

      setInspections((inspectionsRes.data as Inspection[]) || []);
      setPunchListItems((punchListRes.data as PunchListItem[]) || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch inspections';
      setError(message);
      console.error('Error fetching inspections:', err);
    } finally {
      setLoading(false);
    }
  }, [user, projectId]);

  useEffect(() => {
    fetchInspections();
  }, [fetchInspections]);

  const createInspection = async (data: CreateInspectionData): Promise<Inspection | null> => {
    if (!user || !projectId) {
      toast.error('You must be logged in to schedule an inspection');
      return null;
    }

    try {
      const { data: inspection, error } = await supabase
        .from('inspections')
        .insert({
          project_id: projectId,
          user_id: user.id,
          ...data,
        })
        .select()
        .single();

      if (error) throw error;

      setInspections(prev => [...prev, inspection as Inspection].sort(
        (a, b) => new Date(a.scheduled_date).getTime() - new Date(b.scheduled_date).getTime()
      ));
      
      // Log activity
      const typeLabel = INSPECTION_TYPE_LABELS[data.inspection_type];
      await logProjectActivity(
        projectId,
        user.id,
        'inspection_scheduled',
        `${typeLabel} inspection scheduled`,
        `Scheduled for ${new Date(data.scheduled_date).toLocaleDateString()}`,
        { inspection_type: data.inspection_type, scheduled_date: data.scheduled_date }
      );
      
      toast.success('Inspection scheduled successfully');
      return inspection as Inspection;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to schedule inspection';
      toast.error(message);
      console.error('Error creating inspection:', err);
      return null;
    }
  };

  const updateInspection = async (id: string, data: UpdateInspectionData): Promise<Inspection | null> => {
    if (!user || !projectId) return null;
    
    try {
      const currentInspection = inspections.find(i => i.id === id);
      const updateData = { ...data };
      
      // Auto-set completed_date when status changes to passed/failed/conditional
      if (data.status && ['passed', 'failed', 'conditional'].includes(data.status) && !data.completed_date) {
        updateData.completed_date = new Date().toISOString();
      }

      const { data: inspection, error } = await supabase
        .from('inspections')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      setInspections(prev => 
        prev.map(i => i.id === id ? (inspection as Inspection) : i)
      );
      
      // Log activity based on status change
      if (data.status && currentInspection) {
        const typeLabel = INSPECTION_TYPE_LABELS[currentInspection.inspection_type];
        let activityType: 'inspection_passed' | 'inspection_failed' | 'inspection_cancelled' | 'inspection_updated' = 'inspection_updated';
        let title = `${typeLabel} inspection updated`;
        
        if (data.status === 'passed') {
          activityType = 'inspection_passed';
          title = `${typeLabel} inspection passed`;
        } else if (data.status === 'failed') {
          activityType = 'inspection_failed';
          title = `${typeLabel} inspection failed`;
        } else if (data.status === 'cancelled') {
          activityType = 'inspection_cancelled';
          title = `${typeLabel} inspection cancelled`;
        }
        
        await logProjectActivity(
          projectId,
          user.id,
          activityType,
          title,
          data.result_notes || undefined,
          { inspection_type: currentInspection.inspection_type, status: data.status }
        );
      }
      
      toast.success('Inspection updated successfully');
      return inspection as Inspection;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update inspection';
      toast.error(message);
      console.error('Error updating inspection:', err);
      return null;
    }
  };

  const deleteInspection = async (id: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('inspections')
        .delete()
        .eq('id', id);

      if (error) throw error;

      setInspections(prev => prev.filter(i => i.id !== id));
      toast.success('Inspection deleted');
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete inspection';
      toast.error(message);
      console.error('Error deleting inspection:', err);
      return false;
    }
  };

  const createPunchListItem = async (data: CreatePunchListItemData): Promise<PunchListItem | null> => {
    if (!user || !projectId) {
      toast.error('You must be logged in to create a punch list item');
      return null;
    }

    try {
      const { data: item, error } = await supabase
        .from('punch_list_items')
        .insert({
          project_id: projectId,
          user_id: user.id,
          ...data,
        })
        .select()
        .single();

      if (error) throw error;

      setPunchListItems(prev => [item as PunchListItem, ...prev]);
      toast.success('Punch list item created');
      return item as PunchListItem;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create punch list item';
      toast.error(message);
      console.error('Error creating punch list item:', err);
      return null;
    }
  };

  const updatePunchListItem = async (
    id: string, 
    data: Partial<Omit<PunchListItem, 'id' | 'project_id' | 'user_id' | 'created_at' | 'updated_at'>>
  ): Promise<PunchListItem | null> => {
    try {
      const updateData = { ...data };
      
      // Auto-set resolved_at when status changes to resolved
      if (data.status === 'resolved' && !data.resolved_at) {
        updateData.resolved_at = new Date().toISOString();
        updateData.resolved_by = user?.id;
      }

      const { data: item, error } = await supabase
        .from('punch_list_items')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      setPunchListItems(prev => 
        prev.map(i => i.id === id ? (item as PunchListItem) : i)
      );
      toast.success('Punch list item updated');
      return item as PunchListItem;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update punch list item';
      toast.error(message);
      console.error('Error updating punch list item:', err);
      return null;
    }
  };

  const deletePunchListItem = async (id: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('punch_list_items')
        .delete()
        .eq('id', id);

      if (error) throw error;

      setPunchListItems(prev => prev.filter(i => i.id !== id));
      toast.success('Punch list item deleted');
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete punch list item';
      toast.error(message);
      console.error('Error deleting punch list item:', err);
      return false;
    }
  };

  // Auto-generate punch list items from a failed inspection
  const generatePunchListFromInspection = async (
    inspectionId: string, 
    items: { title: string; description?: string; location?: string; priority?: PunchListPriority }[]
  ): Promise<PunchListItem[]> => {
    if (!user || !projectId) {
      toast.error('You must be logged in');
      return [];
    }

    try {
      const itemsToInsert = items.map(item => ({
        project_id: projectId,
        user_id: user.id,
        inspection_id: inspectionId,
        title: item.title,
        description: item.description || null,
        location: item.location || null,
        priority: item.priority || 'medium',
        status: 'open' as const,
      }));

      const { data, error } = await supabase
        .from('punch_list_items')
        .insert(itemsToInsert)
        .select();

      if (error) throw error;

      const newItems = (data as PunchListItem[]) || [];
      setPunchListItems(prev => [...newItems, ...prev]);
      toast.success(`Created ${newItems.length} punch list items`);
      return newItems;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate punch list';
      toast.error(message);
      console.error('Error generating punch list:', err);
      return [];
    }
  };

  return {
    inspections,
    punchListItems,
    loading,
    error,
    fetchInspections,
    createInspection,
    updateInspection,
    deleteInspection,
    createPunchListItem,
    updatePunchListItem,
    deletePunchListItem,
    generatePunchListFromInspection,
  };
}
