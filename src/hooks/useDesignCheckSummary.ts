import { useEffect, useState } from "react";
import { loadDesignCheckSummary } from "@/lib/designcheck/loadDesignCheckSummary";
import type { DesignCheckProjectSummary } from "@/lib/designcheck/designCheckSummary";

export function useDesignCheckSummary(projectId: string | null) {
  const [summary, setSummary] = useState<DesignCheckProjectSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSummary(null);
    setError(null);

    if (!projectId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void loadDesignCheckSummary(projectId).then((result) => {
      if (cancelled) return;
      setSummary(result.summary);
      setError(result.error);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return { summary, loading, error };
}
