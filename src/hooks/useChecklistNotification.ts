import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

interface ChecklistItem {
  id: string;
  category: string;
  item: string;
  requirement: string;
  checked: boolean;
  notes: string;
  status: 'pending' | 'pass' | 'fail' | 'na';
}

interface ChecklistSummary {
  total: number;
  passed: number;
  failed: number;
  na: number;
  pending: number;
}

interface SendNotificationParams {
  projectId?: string;
  inspectionId?: string;
  projectName: string;
  projectAddress: string;
  inspectionType: string;
  inspectorName: string;
  permitNumber?: string;
  inspectionDate: string;
  inspectorSignedAt: string;
  contractorSignedAt: string;
  recipientEmails: string[];
  checklistSummary: ChecklistSummary;
  generalNotes?: string;
  // PDF attachment data
  attachPDF?: boolean;
  checklistItems?: ChecklistItem[];
  customItems?: ChecklistItem[];
  weather?: string;
  temperature?: string;
}

export function useChecklistNotification() {
  const [isSending, setIsSending] = useState(false);
  const [lastSentAt, setLastSentAt] = useState<Date | null>(null);

  const sendSignedNotification = useCallback(async (params: SendNotificationParams) => {
    if (isSending) return { success: false, error: 'Already sending' };
    
    setIsSending(true);
    
    try {
      console.log('Sending checklist signed notification:', params);
      
      const { data, error } = await supabase.functions.invoke('send-checklist-signed-notification', {
        body: params,
      });

      if (error) {
        console.error('Error sending notification:', error);
        toast.error('Failed to send email notification');
        return { success: false, error: error.message };
      }

      console.log('Notification sent successfully:', data);
      setLastSentAt(new Date());
      toast.success(params.attachPDF 
        ? 'Email notification with PDF attachment sent to all parties'
        : 'Email notification sent to all parties'
      );
      return { success: true, data };
    } catch (error: any) {
      console.error('Error sending notification:', error);
      toast.error('Failed to send email notification');
      return { success: false, error: error.message };
    } finally {
      setIsSending(false);
    }
  }, [isSending]);

  return {
    sendSignedNotification,
    isSending,
    lastSentAt,
  };
}
