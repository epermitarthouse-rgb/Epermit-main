import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import {
  formatUciUserError,
  getUciOperationalSnapshot,
  type UciOperationalRequestTiming,
} from "@/lib/uciApi";
import type {
  CoordinationApplication,
  CoordinationCommunication,
  CoordinationCost,
  CoordinationRecord,
} from "@/types/uci";

export type UciOperationalRoute =
  | "/uci/submissions"
  | "/uci/inbox"
  | "/uci/needs-attention"
  | "/uci/portfolio";

export type UciOperationalRecord = CoordinationRecord & {
  projectName: string;
  providerDisplayName: string | null;
  applications: CoordinationApplication[];
  communications: CoordinationCommunication[];
  costs: CoordinationCost[];
  attentionCount: number;
};

const UCI_OPERATIONAL_SNAPSHOT_KEY = "uci-operational-snapshot";
const now = () => globalThis.performance?.now?.() ?? Date.now();

export function useUciOperationalSnapshot(route: UciOperationalRoute) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const mountStartedAt = useRef(now());
  const mountStartedAtIso = useRef(new Date().toISOString());
  const timingLogged = useRef(false);
  const queryKey = useMemo(
    () => [UCI_OPERATIONAL_SNAPSHOT_KEY, user?.id ?? "anonymous"] as const,
    [user?.id],
  );
  const cacheState = useRef({ key: "", hit: false });
  const serializedKey = queryKey.join(":");
  if (cacheState.current.key !== serializedKey) {
    cacheState.current = {
      key: serializedKey,
      hit: Boolean(queryClient.getQueryData(queryKey)),
    };
    timingLogged.current = false;
  }

  const query = useQuery({
    queryKey,
    queryFn: getUciOperationalSnapshot,
    enabled: Boolean(user),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const transformed = useMemo(() => {
    const transformStartedAt = now();
    const records: UciOperationalRecord[] = (query.data?.snapshot.records ?? []).map(
      (record) => ({
        ...record,
        projectName: record.project_name,
        providerDisplayName: record.provider_display_name,
        applications: record.applications,
        communications:
          route === "/uci/needs-attention"
            ? record.attention_communications
            : record.communications_recent,
        costs: [],
        attentionCount: record.attention_count,
      }),
    );
    return {
      records,
      transformDurationMs: Math.round((now() - transformStartedAt) * 10) / 10,
    };
  }, [query.data, route]);

  useEffect(() => {
    if (!query.data || timingLogged.current) return;
    const frame = globalThis.requestAnimationFrame?.bind(globalThis);
    const log = () => {
      if (timingLogged.current) return;
      timingLogged.current = true;
      const cacheHit = cacheState.current.hit;
      const requestTiming: UciOperationalRequestTiming = query.data.timing;
      console.info("[uci-route-timing]", {
        route,
        request: cacheHit ? "cache-hit" : requestTiming.requestId,
        start: mountStartedAtIso.current,
        request_start: cacheHit ? null : requestTiming.startedAt,
        ttfb_ms: cacheHit ? 0 : requestTiming.ttfbMs,
        backend_duration_ms: cacheHit ? 0 : requestTiming.backendDurationMs,
        frontend_transform_duration_ms: transformed.transformDurationMs,
        total_until_first_useful_render_ms:
          Math.round((now() - mountStartedAt.current) * 10) / 10,
        fully_settled_ms: Math.round((now() - mountStartedAt.current) * 10) / 10,
        http_request_count: cacheHit ? 0 : 1,
        db_query_count: cacheHit ? 0 : query.data.snapshot.diagnostics.db_query_count,
        record_count: transformed.records.length,
      });
    };
    const frameId = frame ? frame(log) : globalThis.setTimeout(log, 0);
    return () => {
      if (frame) globalThis.cancelAnimationFrame?.(frameId);
      else globalThis.clearTimeout(frameId);
    };
  }, [query.data, route, transformed.records.length, transformed.transformDurationMs]);

  return {
    records: transformed.records,
    loading: Boolean(user) && query.isLoading,
    error: query.error
      ? formatUciUserError(query.error, "Unable to load operational UCI data.")
      : null,
    partialFailures: query.data?.snapshot.diagnostics.partial_failures.length ?? 0,
    reload: () => void query.refetch(),
  };
}
