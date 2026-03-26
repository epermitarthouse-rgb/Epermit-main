import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

export interface EPermitSubmissionRecord {
  id: string;
  project_id: string;
  user_id: string;
  system: 'accela' | 'cityview';
  environment: string;
  tracking_number: string | null;
  record_id: string | null;
  permit_type: string;
  status: string;
  status_message: string | null;
  applicant_name: string;
  applicant_email: string;
  submitted_at: string | null;
  last_status_check: string | null;
  status_history: Array<{
    status: string;
    message: string;
    timestamp: string;
  }>;
  response_data: any;
  created_at: string;
  updated_at: string;
}

export function useEPermitSubmissions(projectId: string) {
  const [submissions, setSubmissions] = useState<EPermitSubmissionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchSubmissions = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke('epermit-submit', {
        body: { action: 'get_submissions', projectId },
      });

      if (error) throw error;
      setSubmissions(data.submissions || []);
    } catch (err: any) {
      console.error('Failed to fetch submissions:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // Initial fetch
  useEffect(() => {
    fetchSubmissions();
  }, [fetchSubmissions]);

  // Real-time subscription for status updates
  useEffect(() => {
    const channel = supabase
      .channel(`epermit-${projectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'epermit_submissions',
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          console.log('E-permit submission update:', payload);
          
          if (payload.eventType === 'INSERT') {
            setSubmissions(prev => [payload.new as EPermitSubmissionRecord, ...prev]);
          } else if (payload.eventType === 'UPDATE') {
            setSubmissions(prev => 
              prev.map(s => s.id === payload.new.id ? payload.new as EPermitSubmissionRecord : s)
            );
            
            // Show toast for status changes
            const oldStatus = (payload.old as any)?.status;
            const newStatus = (payload.new as any)?.status;
            if (oldStatus && newStatus && oldStatus !== newStatus) {
              toast.info(`Permit status updated: ${newStatus.replace(/_/g, ' ')}`);
            }
          } else if (payload.eventType === 'DELETE') {
            setSubmissions(prev => prev.filter(s => s.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId]);

  const checkStatus = useCallback(async (submissionId: string) => {
    setRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke('epermit-submit', {
        body: { action: 'check_status', submissionId },
      });

      if (error) throw error;

      if (data.statusChanged) {
        toast.success(`Status updated: ${data.status.replace(/_/g, ' ')}`);
      } else {
        toast.info('No status changes');
      }

      return data;
    } catch (err: any) {
      console.error('Failed to check status:', err);
      toast.error('Failed to check status');
      throw err;
    } finally {
      setRefreshing(false);
    }
  }, []);

  const checkAllStatuses = useCallback(async () => {
    setRefreshing(true);
    try {
      for (const submission of submissions) {
        if (!['approved', 'denied', 'cancelled', 'expired'].includes(submission.status)) {
          await checkStatus(submission.id);
        }
      }
    } finally {
      setRefreshing(false);
    }
  }, [submissions, checkStatus]);

  return {
    submissions,
    loading,
    refreshing,
    refetch: fetchSubmissions,
    checkStatus,
    checkAllStatuses,
  };
}
