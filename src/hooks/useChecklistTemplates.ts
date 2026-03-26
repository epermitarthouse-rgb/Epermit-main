import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface TemplateCategory {
  name: string;
  items: {
    category: string;
    item: string;
    requirement: string;
  }[];
}

export type TemplateVisibility = 'private' | 'team' | 'organization';

export interface ChecklistTemplate {
  id: string;
  user_id: string;
  name: string;
  inspection_type: string;
  description: string | null;
  categories: TemplateCategory[];
  is_default: boolean;
  visibility: TemplateVisibility;
  shared_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateTemplateData {
  name: string;
  inspection_type: string;
  description?: string;
  categories: TemplateCategory[];
  is_default?: boolean;
  visibility?: TemplateVisibility;
}

export function useChecklistTemplates() {
  const { user } = useAuth();
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTemplates = useCallback(async () => {
    if (!user) {
      setTemplates([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      // Fetch both user's own templates and shared templates
      const { data, error: fetchError } = await supabase
        .from('inspection_checklist_templates')
        .select('*')
        .order('inspection_type', { ascending: true })
        .order('name', { ascending: true });

      if (fetchError) throw fetchError;

      // Parse the JSONB categories field
      const parsedData = (data || []).map(template => ({
        ...template,
        categories: (template.categories as unknown as TemplateCategory[]) || [],
        visibility: (template.visibility as TemplateVisibility) || 'private',
      }));

      setTemplates(parsedData);
      setError(null);
    } catch (err) {
      console.error('Error fetching templates:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch templates');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const createTemplate = async (data: CreateTemplateData): Promise<ChecklistTemplate | null> => {
    if (!user) {
      toast.error('You must be logged in to save templates');
      return null;
    }

    try {
      // If setting as default, first unset any existing default for this inspection type
      if (data.is_default) {
        await supabase
          .from('inspection_checklist_templates')
          .update({ is_default: false })
          .eq('user_id', user.id)
          .eq('inspection_type', data.inspection_type)
          .eq('is_default', true);
      }

      const insertData = {
        user_id: user.id,
        name: data.name,
        inspection_type: data.inspection_type,
        description: data.description || null,
        categories: JSON.parse(JSON.stringify(data.categories)),
        is_default: data.is_default || false,
        visibility: data.visibility || 'private',
        shared_at: data.visibility && data.visibility !== 'private' ? new Date().toISOString() : null,
      };

      const { data: newTemplate, error: insertError } = await supabase
        .from('inspection_checklist_templates')
        .insert([insertData])
        .select()
        .single();

      if (insertError) throw insertError;

      const parsedTemplate: ChecklistTemplate = {
        ...newTemplate!,
        categories: (newTemplate.categories as unknown as TemplateCategory[]) || [],
        visibility: (newTemplate.visibility as TemplateVisibility) || 'private',
      };

      setTemplates(prev => [...prev, parsedTemplate]);
      toast.success('Template saved successfully');
      return parsedTemplate;
    } catch (err) {
      console.error('Error creating template:', err);
      toast.error('Failed to save template');
      return null;
    }
  };

  const updateTemplate = async (
    id: string,
    data: Partial<CreateTemplateData>
  ): Promise<ChecklistTemplate | null> => {
    if (!user) {
      toast.error('You must be logged in to update templates');
      return null;
    }

    try {
      const updateData: Record<string, unknown> = {};
      if (data.name !== undefined) updateData.name = data.name;
      if (data.inspection_type !== undefined) updateData.inspection_type = data.inspection_type;
      if (data.description !== undefined) updateData.description = data.description;
      if (data.categories !== undefined) updateData.categories = data.categories;
      if (data.is_default !== undefined) updateData.is_default = data.is_default;
      if (data.visibility !== undefined) {
        updateData.visibility = data.visibility;
        updateData.shared_at = data.visibility !== 'private' ? new Date().toISOString() : null;
      }

      // If setting as default, first unset any existing default for this inspection type
      if (data.is_default && data.inspection_type) {
        await supabase
          .from('inspection_checklist_templates')
          .update({ is_default: false })
          .eq('user_id', user.id)
          .eq('inspection_type', data.inspection_type)
          .eq('is_default', true)
          .neq('id', id);
      }

      const { data: updatedTemplate, error: updateError } = await supabase
        .from('inspection_checklist_templates')
        .update(updateData)
        .eq('id', id)
        .eq('user_id', user.id)
        .select()
        .single();

      if (updateError) throw updateError;

      const parsedTemplate: ChecklistTemplate = {
        ...updatedTemplate,
        categories: (updatedTemplate.categories as unknown as TemplateCategory[]) || [],
        visibility: (updatedTemplate.visibility as TemplateVisibility) || 'private',
      };

      setTemplates(prev =>
        prev.map(t => (t.id === id ? parsedTemplate : t))
      );
      toast.success('Template updated successfully');
      return parsedTemplate;
    } catch (err) {
      console.error('Error updating template:', err);
      toast.error('Failed to update template');
      return null;
    }
  };

  const deleteTemplate = async (id: string): Promise<boolean> => {
    if (!user) {
      toast.error('You must be logged in to delete templates');
      return false;
    }

    try {
      const { error: deleteError } = await supabase
        .from('inspection_checklist_templates')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);

      if (deleteError) throw deleteError;

      setTemplates(prev => prev.filter(t => t.id !== id));
      toast.success('Template deleted successfully');
      return true;
    } catch (err) {
      console.error('Error deleting template:', err);
      toast.error('Failed to delete template');
      return false;
    }
  };

  const getTemplatesByType = (inspectionType: string): ChecklistTemplate[] => {
    return templates.filter(t => t.inspection_type === inspectionType);
  };

  const getDefaultTemplate = (inspectionType: string): ChecklistTemplate | undefined => {
    return templates.find(t => t.inspection_type === inspectionType && t.is_default);
  };

  const getOwnTemplates = (): ChecklistTemplate[] => {
    return templates.filter(t => t.user_id === user?.id);
  };

  const getSharedTemplates = (): ChecklistTemplate[] => {
    return templates.filter(t => t.user_id !== user?.id && t.visibility !== 'private');
  };

  const shareTemplate = async (id: string, visibility: TemplateVisibility): Promise<boolean> => {
    const result = await updateTemplate(id, { visibility });
    if (result) {
      if (visibility === 'private') {
        toast.success('Template is now private');
      } else {
        toast.success(`Template shared with ${visibility === 'team' ? 'your team' : 'organization'}`);
      }
      return true;
    }
    return false;
  };

  return {
    templates,
    loading,
    error,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    getTemplatesByType,
    getDefaultTemplate,
    getOwnTemplates,
    getSharedTemplates,
    shareTemplate,
    refetch: fetchTemplates,
  };
}
