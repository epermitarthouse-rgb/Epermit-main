import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { ProjectShareLink, CreateShareLinkData } from '@/types/share';
import { toast } from 'sonner';

export function useProjectShareLinks(projectId?: string) {
  const [shareLinks, setShareLinks] = useState<ProjectShareLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchShareLinks = useCallback(async () => {
    if (!projectId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const { data, error: fetchError } = await supabase
        .from('project_share_links')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      
      if (fetchError) throw fetchError;
      setShareLinks(data || []);
    } catch (err: any) {
      setError(err.message);
      console.error('Error fetching share links:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchShareLinks();
  }, [fetchShareLinks]);

  const createShareLink = async (data: CreateShareLinkData): Promise<ProjectShareLink | null> => {
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error('Not authenticated');

      const { data: newLink, error: createError } = await supabase
        .from('project_share_links')
        .insert({
          project_id: data.project_id,
          created_by: user.user.id,
          expires_at: data.expires_at || null,
        })
        .select()
        .single();

      if (createError) throw createError;

      setShareLinks(prev => [newLink, ...prev]);
      toast.success('Share link created successfully');
      return newLink;
    } catch (err: any) {
      toast.error('Failed to create share link');
      console.error('Error creating share link:', err);
      return null;
    }
  };

  const deactivateShareLink = async (linkId: string): Promise<boolean> => {
    try {
      const { error: updateError } = await supabase
        .from('project_share_links')
        .update({ is_active: false })
        .eq('id', linkId);

      if (updateError) throw updateError;

      setShareLinks(prev => 
        prev.map(link => link.id === linkId ? { ...link, is_active: false } : link)
      );
      toast.success('Share link deactivated');
      return true;
    } catch (err: any) {
      toast.error('Failed to deactivate share link');
      console.error('Error deactivating share link:', err);
      return false;
    }
  };

  const deleteShareLink = async (linkId: string): Promise<boolean> => {
    try {
      const { error: deleteError } = await supabase
        .from('project_share_links')
        .delete()
        .eq('id', linkId);

      if (deleteError) throw deleteError;

      setShareLinks(prev => prev.filter(link => link.id !== linkId));
      toast.success('Share link deleted');
      return true;
    } catch (err: any) {
      toast.error('Failed to delete share link');
      console.error('Error deleting share link:', err);
      return false;
    }
  };

  return {
    shareLinks,
    loading,
    error,
    createShareLink,
    deactivateShareLink,
    deleteShareLink,
    refetch: fetchShareLinks,
  };
}
