import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";

export function useProjectPortalData(projectId: string | null) {
  const [portalData, setPortalData] = useState<unknown | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchPortalData = useCallback(async () => {
    if (!projectId) {
      setPortalData(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from("projects")
        .select("portal_data")
        .eq("id", projectId)
        .single();

      if (fetchError) throw fetchError;
      setPortalData(data?.portal_data ?? null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to fetch portal data"));
      setPortalData(null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchPortalData();
  }, [fetchPortalData]);

  return { portalData, loading, error, refetch: fetchPortalData };
}
