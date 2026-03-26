import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

export interface EmailBrandingSettings {
  id: string;
  logo_url: string | null;
  primary_color: string;
  header_text: string;
  footer_text: string;
  unsubscribe_text: string;
  created_at: string;
  updated_at: string;
}

export function useEmailBranding() {
  const [settings, setSettings] = useState<EmailBrandingSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('email_branding_settings')
        .select('*')
        .limit(1)
        .single();

      if (error) throw error;
      setSettings(data);
    } catch (error: any) {
      console.error('Error fetching email branding settings:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateSettings = async (updates: Partial<Omit<EmailBrandingSettings, 'id' | 'created_at' | 'updated_at'>>) => {
    if (!settings) return;

    try {
      const { error } = await supabase
        .from('email_branding_settings')
        .update(updates)
        .eq('id', settings.id);

      if (error) throw error;

      setSettings(prev => prev ? { ...prev, ...updates } : null);
      toast.success('Branding settings updated');
    } catch (error: any) {
      console.error('Error updating email branding settings:', error);
      toast.error('Failed to update branding settings');
      throw error;
    }
  };

  return {
    settings,
    loading,
    updateSettings,
    refetch: fetchSettings,
  };
}
