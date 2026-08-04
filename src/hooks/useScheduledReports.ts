import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface ScheduledReport {
  id: string;
  user_id: string;
  name: string;
  recipient_email: string;
  recipient_name: string | null;
  project_filter: string;
  status_filter: string;
  frequency: 'weekly' | 'monthly';
  day_of_week: number | null;
  day_of_month: number | null;
  send_time: string;
  timezone: string;
  is_active: boolean;
  last_sent_at: string | null;
  next_send_at: string | null;
  email_subject: string | null;
  email_intro: string | null;
  include_summary: boolean;
  include_details: boolean;
  include_pdf_attachment: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateScheduledReportData {
  name: string;
  recipient_email: string;
  recipient_name?: string;
  project_filter?: string;
  status_filter?: string;
  frequency: 'weekly' | 'monthly';
  day_of_week?: number;
  day_of_month?: number;
  send_time?: string;
  timezone?: string;
  email_subject?: string;
  email_intro?: string;
  include_summary?: boolean;
  include_details?: boolean;
  include_pdf_attachment?: boolean;
}

export function useScheduledReports() {
  const { user } = useAuth();
  const [scheduledReports, setScheduledReports] = useState<ScheduledReport[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchScheduledReports = useCallback(async () => {
    if (!user) {
      setScheduledReports([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('scheduled_checklist_reports')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setScheduledReports((data || []) as ScheduledReport[]);
    } catch (err) {
      console.error('Error fetching scheduled reports:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchScheduledReports();
  }, [fetchScheduledReports]);

  const createScheduledReport = async (data: CreateScheduledReportData): Promise<ScheduledReport | null> => {
    if (!user) {
      toast.error('You must be logged in to create scheduled reports');
      return null;
    }

    try {
      // Calculate next_send_at based on frequency
      const now = new Date();
      let nextSend = new Date();

      if (data.frequency === 'weekly') {
        const targetDay = data.day_of_week ?? 1; // Default to Monday
        const currentDay = now.getDay();
        const daysUntilTarget = (targetDay - currentDay + 7) % 7 || 7;
        nextSend.setDate(now.getDate() + daysUntilTarget);
      } else {
        const targetDay = data.day_of_month ?? 1;
        nextSend.setMonth(now.getMonth() + 1);
        nextSend.setDate(Math.min(targetDay, 28));
      }

      const { data: newReport, error } = await supabase
        .from('scheduled_checklist_reports')
        .insert([{
          user_id: user.id,
          name: data.name,
          recipient_email: data.recipient_email,
          recipient_name: data.recipient_name || null,
          project_filter: data.project_filter || 'all',
          status_filter: data.status_filter || 'all',
          frequency: data.frequency,
          day_of_week: data.frequency === 'weekly' ? (data.day_of_week ?? 1) : null,
          day_of_month: data.frequency === 'monthly' ? (data.day_of_month ?? 1) : null,
          send_time: data.send_time || '09:00:00',
          timezone: data.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
          email_subject: data.email_subject || null,
          email_intro: data.email_intro || null,
          include_summary: data.include_summary ?? true,
          include_details: data.include_details ?? true,
          include_pdf_attachment: data.include_pdf_attachment ?? false,
          is_active: true,
          next_send_at: nextSend.toISOString(),
        }])
        .select()
        .single();

      if (error) throw error;

      setScheduledReports(prev => [newReport as ScheduledReport, ...prev]);
      toast.success('Scheduled report created');
      return newReport as ScheduledReport;
    } catch (err) {
      console.error('Error creating scheduled report:', err);
      toast.error('Failed to create scheduled report');
      return null;
    }
  };

  const updateScheduledReport = async (
    id: string,
    data: Partial<CreateScheduledReportData & { is_active: boolean }>
  ): Promise<boolean> => {
    if (!user) {
      toast.error('You must be logged in');
      return false;
    }

    try {
      const { error } = await supabase
        .from('scheduled_checklist_reports')
        .update(data)
        .eq('id', id);

      if (error) throw error;

      setScheduledReports(prev =>
        prev.map(r => (r.id === id ? { ...r, ...data } : r))
      );
      toast.success('Scheduled report updated');
      return true;
    } catch (err) {
      console.error('Error updating scheduled report:', err);
      toast.error('Failed to update scheduled report');
      return false;
    }
  };

  const deleteScheduledReport = async (id: string): Promise<boolean> => {
    if (!user) {
      toast.error('You must be logged in');
      return false;
    }

    try {
      const { error } = await supabase
        .from('scheduled_checklist_reports')
        .delete()
        .eq('id', id);

      if (error) throw error;

      setScheduledReports(prev => prev.filter(r => r.id !== id));
      toast.success('Scheduled report deleted');
      return true;
    } catch (err) {
      console.error('Error deleting scheduled report:', err);
      toast.error('Failed to delete scheduled report');
      return false;
    }
  };

  const toggleReportActive = async (id: string, isActive: boolean): Promise<boolean> => {
    return updateScheduledReport(id, { is_active: isActive });
  };

  return {
    scheduledReports,
    loading,
    createScheduledReport,
    updateScheduledReport,
    deleteScheduledReport,
    toggleReportActive,
    refetch: fetchScheduledReports,
  };
}
