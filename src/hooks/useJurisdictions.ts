import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import {
  Jurisdiction,
  CreateJurisdictionData,
  UpdateJurisdictionData,
  rowToJurisdiction,
  jurisdictionToInsert,
  jurisdictionToUpdate,
} from '@/types/jurisdiction';
import {
  isForeignKeyViolation,
  isMissingRpcError,
  subscriptionBlockMessage,
} from '@/lib/jurisdictionSubscriptionIntegrity';
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
      const { data, error: fetchError } = await supabase
        .from('jurisdictions')
        .select('*')
        .order('state', { ascending: true })
        .order('name', { ascending: true });

      if (fetchError) throw fetchError;

      setJurisdictions((data ?? []).map(rowToJurisdiction));
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

  const getSubscriptionCount = useCallback(async (jurisdictionId: string): Promise<number | null> => {
    try {
      const { data, error: rpcError } = await supabase.rpc('get_jurisdiction_subscription_count', {
        p_jurisdiction_id: jurisdictionId,
      });

      if (rpcError) {
        if (isMissingRpcError(rpcError)) return null;
        throw rpcError;
      }

      return typeof data === 'number' ? data : Number(data ?? 0);
    } catch (err) {
      console.error('Error fetching subscription count:', err);
      return null;
    }
  }, []);

  const createJurisdiction = async (data: CreateJurisdictionData): Promise<Jurisdiction | null> => {
    if (!user) {
      toast.error('You must be logged in');
      return null;
    }

    try {
      const { data: jurisdiction, error: insertError } = await supabase
        .from('jurisdictions')
        .insert(jurisdictionToInsert(data))
        .select()
        .single();

      if (insertError) throw insertError;

      const newJurisdiction = rowToJurisdiction(jurisdiction);
      setJurisdictions((prev) =>
        [...prev, newJurisdiction].sort(
          (a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name),
        ),
      );

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
      const { data: jurisdiction, error: updateError } = await supabase
        .from('jurisdictions')
        .update(jurisdictionToUpdate(data))
        .eq('id', id)
        .select()
        .single();

      if (updateError) throw updateError;

      const updatedJurisdiction = rowToJurisdiction(jurisdiction);
      setJurisdictions((prev) => prev.map((j) => (j.id === id ? updatedJurisdiction : j)));

      toast.success('Jurisdiction updated successfully');
      return updatedJurisdiction;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update jurisdiction';
      toast.error(message);
      console.error('Error updating jurisdiction:', err);
      return null;
    }
  };

  const deactivateJurisdiction = async (id: string): Promise<boolean> => {
    const result = await updateJurisdiction(id, { is_active: false });
    if (result) {
      toast.success('Jurisdiction deactivated');
      return true;
    }
    return false;
  };

  const deleteJurisdiction = async (id: string): Promise<boolean> => {
    const subscriptionCount = await getSubscriptionCount(id);
    if (subscriptionCount !== null && subscriptionCount > 0) {
      toast.error(subscriptionBlockMessage(subscriptionCount));
      return false;
    }

    try {
      const { error: deleteError } = await supabase.from('jurisdictions').delete().eq('id', id);

      if (deleteError) {
        if (isForeignKeyViolation(deleteError)) {
          toast.error('Cannot delete: this jurisdiction has active subscribers. Deactivate it instead.');
          return false;
        }
        throw deleteError;
      }

      setJurisdictions((prev) => prev.filter((j) => j.id !== id));
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
    if (!user) {
      toast.error('You must be logged in');
      return false;
    }

    const verifiedAt = new Date().toISOString();

    try {
      const { error: verifyError } = await supabase
        .from('jurisdictions')
        .update({
          last_verified_at: verifiedAt,
          verified_by: user.id,
        })
        .eq('id', id);

      if (verifyError) throw verifyError;

      setJurisdictions((prev) =>
        prev.map((j) =>
          j.id === id
            ? {
                ...j,
                last_verified_at: verifiedAt,
                verified_by: user.id,
              }
            : j,
        ),
      );

      toast.success('Jurisdiction marked as verified');
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to verify jurisdiction';
      toast.error(message);
      console.error('Error verifying jurisdiction:', err);
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
    deactivateJurisdiction,
    deleteJurisdiction,
    verifyJurisdiction,
    getSubscriptionCount,
  };
}
