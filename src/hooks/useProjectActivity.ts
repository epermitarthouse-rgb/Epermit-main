import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import type { ActivityType, ProjectActivity } from '@/types/activity';

export function useProjectActivity(projectId: string | null) {
  const { user } = useAuth();
  const [activities, setActivities] = useState<ProjectActivity[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchActivities = useCallback(async () => {
    if (!projectId || !user) {
      setActivities([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('project_activity')
        .select('id, project_id, user_id, activity_type, title, description, metadata, created_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setActivities((data || []) as unknown as ProjectActivity[]);
    } catch (error) {
      console.error('Error fetching activities:', error);
    } finally {
      setLoading(false);
    }
  }, [projectId, user]);

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  // Subscribe to realtime updates
  useEffect(() => {
    if (!projectId) return;

    const channel = supabase
      .channel(`project-activity-${projectId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'project_activity',
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          setActivities((prev) => [payload.new as ProjectActivity, ...prev]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId]);

  const logActivity = useCallback(
    async (
      activityType: ActivityType,
      title: string,
      description?: string,
      metadata?: Record<string, unknown>
    ) => {
      if (!projectId || !user) return;

      try {
        const { error } = await supabase.from('project_activity').insert([{
          project_id: projectId,
          user_id: user.id,
          activity_type: activityType,
          title,
          description: description || null,
          metadata: metadata || {},
        }] as never);

        if (error) throw error;
      } catch (error) {
        console.error('Error logging activity:', error);
      }
    },
    [projectId, user]
  );

  return {
    activities,
    loading,
    refetch: fetchActivities,
    logActivity,
  };
}
