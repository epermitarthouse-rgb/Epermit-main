import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Jurisdiction, CreateJurisdictionData, UpdateJurisdictionData } from '@/types/jurisdiction';
import { toast } from 'sonner';

export function useJurisdictions() {
  const { user } = useAuth();
  const [jurisdictions, setJurisdictions] = useState<Jurisdiction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchJurisdictions = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error } = await supabase
        .from('jurisdictions')
        .select('*')
        .order('state', { ascending: true })
        .order('name', { ascending: true });

      if (error) throw error;

      setJurisdictions((data as unknown as Jurisdiction[]) || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch jurisdictions';
      setError(message);
      console.error('Error fetching jurisdictions:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJurisdictions();
  }, [fetchJurisdictions]);

  const createJurisdiction = async (data: CreateJurisdictionData): Promise<Jurisdiction | null> => {
    if (!user) {
      toast.error('You must be logged in');
      return null;
    }

    try {
      const { data: jurisdiction, error } = await supabase
        .from('jurisdictions')
        .insert(data as any)
        .select()
        .single();

      if (error) throw error;

      const newJurisdiction = jurisdiction as unknown as Jurisdiction;
      setJurisdictions(prev => [...prev, newJurisdiction].sort((a, b) => 
        a.state.localeCompare(b.state) || a.name.localeCompare(b.name)
      ));
      
      toast.success('Jurisdiction created successfully');
      return newJurisdiction;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create jurisdiction';
      toast.error(message);
      console.error('Error creating jurisdiction:', err);
      return null;
    }
  };

  const updateJurisdiction = async (id: string, data: UpdateJurisdictionData): Promise<Jurisdiction | null> => {
    if (!user) {
      toast.error('You must be logged in');
      return null;
    }

    try {
      const { data: jurisdiction, error } = await supabase
        .from('jurisdictions')
        .update(data as any)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      const updatedJurisdiction = jurisdiction as unknown as Jurisdiction;
      setJurisdictions(prev => 
        prev.map(j => j.id === id ? updatedJurisdiction : j)
      );
      
      toast.success('Jurisdiction updated successfully');
      return updatedJurisdiction;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update jurisdiction';
      toast.error(message);
      console.error('Error updating jurisdiction:', err);
      return null;
    }
  };

  const deleteJurisdiction = async (id: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('jurisdictions')
        .delete()
        .eq('id', id);

      if (error) throw error;

      setJurisdictions(prev => prev.filter(j => j.id !== id));
      toast.success('Jurisdiction deleted');
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete jurisdiction';
      toast.error(message);
      console.error('Error deleting jurisdiction:', err);
      return false;
    }
  };

  const verifyJurisdiction = async (id: string): Promise<boolean> => {
    if (!user) return false;

    try {
      const { error } = await supabase
        .from('jurisdictions')
        .update({ 
          last_verified_at: new Date().toISOString(),
          verified_by: user.id 
        })
        .eq('id', id);

      if (error) throw error;

      setJurisdictions(prev => 
        prev.map(j => j.id === id ? { 
          ...j, 
          last_verified_at: new Date().toISOString(),
          verified_by: user.id 
        } : j)
      );
      
      toast.success('Jurisdiction marked as verified');
      return true;
    } catch (err) {
      toast.error('Failed to verify jurisdiction');
      return false;
    }
  };

  return {
    jurisdictions,
    loading,
    error,
    fetchJurisdictions,
    createJurisdiction,
    updateJurisdiction,
    deleteJurisdiction,
    verifyJurisdiction,
  };
}
