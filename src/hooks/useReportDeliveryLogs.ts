import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface ReportDeliveryLog {
  id: string;
  report_id: string;
  user_id: string;
  report_name: string;
  recipient_emails: string[];
  recipient_count: number;
  successful_count: number;
  failed_count: number;
  failed_emails: string[];
  status: 'success' | 'partial' | 'failed';
  error_message: string | null;
  sent_at: string;
  created_at: string;
}

export function useReportDeliveryLogs(reportId?: string) {
  const { user } = useAuth();
  const [logs, setLogs] = useState<ReportDeliveryLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    if (!user) {
      setLogs([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      let query = supabase
        .from('scheduled_report_delivery_logs')
        .select('*')
        .order('sent_at', { ascending: false })
        .limit(50);

      if (reportId) {
        query = query.eq('report_id', reportId);
      }

      const { data, error } = await query;

      if (error) throw error;
      setLogs((data || []) as ReportDeliveryLog[]);
    } catch (err) {
      console.error('Error fetching delivery logs:', err);
    } finally {
      setLoading(false);
    }
  }, [user, reportId]);

  const retryFailedEmails = useCallback(async (logId: string, failedEmails?: string[]) => {
    setRetrying(logId);
    try {
      const { data, error } = await supabase.functions.invoke('retry-failed-report-emails', {
        body: { logId, failedEmails },
      });

      if (error) throw error;

      if (data.succeeded > 0) {
        toast.success(`Successfully resent ${data.succeeded} email(s)`);
      }
      if (data.failed > 0) {
        toast.warning(`${data.failed} email(s) still failed`);
      }

      // Refresh the logs
      await fetchLogs();
    } catch (err: any) {
      console.error('Error retrying emails:', err);
      toast.error(err.message || 'Failed to retry emails');
    } finally {
      setRetrying(null);
    }
  }, [fetchLogs]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  return {
    logs,
    loading,
    retrying,
    refetch: fetchLogs,
    retryFailedEmails,
  };
}
