import { useCallback, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  clearLegacyFeatureFlagsStorage,
  FEATURE_FLAG,
  fetchFeatureFlags,
  isFeatureEnabled,
  isKnownFeatureFlagKey,
  mergeWithDefaults,
  readLegacyShowDemoVideo,
  setFeatureFlag,
  type FeatureFlagKey,
  type FeatureFlagRow,
} from '@/lib/featureFlags';

export const FEATURE_FLAGS_QUERY_KEY = ['feature-flags'] as const;

const STALE_TIME_MS = 5 * 60 * 1000;

export function useFeatureFlags() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: FEATURE_FLAGS_QUERY_KEY,
    queryFn: fetchFeatureFlags,
    staleTime: STALE_TIME_MS,
    retry: 1,
  });

  const flags = mergeWithDefaults(query.data);

  useEffect(() => {
    if (!query.isSuccess) return;
    const legacyEnabled = readLegacyShowDemoVideo();
    if (legacyEnabled !== null) {
      clearLegacyFeatureFlagsStorage();
    }
  }, [query.isSuccess]);

  const mutation = useMutation({
    mutationFn: ({ key, enabled }: { key: FeatureFlagKey; enabled: boolean }) =>
      setFeatureFlag(key, enabled),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
    },
  });

  const setFlag = useCallback(
    async (key: FeatureFlagKey, enabled: boolean) => {
      if (!isKnownFeatureFlagKey(key)) {
        throw new Error(`Unknown feature flag key: ${key}`);
      }
      return mutation.mutateAsync({ key, enabled });
    },
    [mutation],
  );

  const toggleFlag = useCallback(
    async (key: FeatureFlagKey) => {
      const current = isFeatureEnabled(flags, key);
      return setFlag(key, !current);
    },
    [flags, setFlag],
  );

  return {
    flags,
    rows: (query.data ?? []) as FeatureFlagRow[],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    isFetching: query.isFetching,
    refetch: query.refetch,
    setFlag,
    toggleFlag,
    isMutating: mutation.isPending,
    mutationError: mutation.error,
  };
}

export function useFeatureFlag(key: FeatureFlagKey): {
  enabled: boolean;
  isLoading: boolean;
} {
  const { flags, isLoading } = useFeatureFlags();
  return {
    enabled: isFeatureEnabled(flags, key),
    isLoading,
  };
}

export { FEATURE_FLAG };
