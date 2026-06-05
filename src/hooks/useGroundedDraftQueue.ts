import { useCallback, useRef, useState } from "react";

export type GroundedJobStatus = "idle" | "queued" | "loading" | "success" | "error";

const DEFAULT_CONCURRENCY = 2;

export interface GroundedBatchProgress {
  completed: number;
  total: number;
  active: number;
}

export function useGroundedDraftQueue(
  runOne: (commentId: string) => Promise<void>,
  maxConcurrent = DEFAULT_CONCURRENCY,
) {
  const [statusById, setStatusById] = useState<Record<string, GroundedJobStatus>>({});
  const [errorById, setErrorById] = useState<Record<string, string>>({});
  const [batchProgress, setBatchProgress] = useState<GroundedBatchProgress | null>(null);

  const queueRef = useRef<string[]>([]);
  const activeRef = useRef(0);
  const batchTotalRef = useRef(0);
  const batchCompletedRef = useRef(0);

  const setStatus = useCallback((id: string, status: GroundedJobStatus) => {
    setStatusById((prev) => ({ ...prev, [id]: status }));
  }, []);

  const startJob = useCallback(
    (id: string) => {
      activeRef.current += 1;
      setStatus(id, "loading");
      setBatchProgress((prev) =>
        prev ? { ...prev, active: activeRef.current } : prev,
      );

      void (async () => {
        try {
          await runOne(id);
          setStatus(id, "success");
        } catch (err) {
          const message = err instanceof Error ? err.message : "Grounded draft failed";
          setErrorById((prev) => ({ ...prev, [id]: message }));
          setStatus(id, "error");
        } finally {
          activeRef.current -= 1;
          batchCompletedRef.current += 1;
          setBatchProgress((prev) =>
            prev
              ? {
                  ...prev,
                  completed: batchCompletedRef.current,
                  active: activeRef.current,
                }
              : prev,
          );

          if (queueRef.current.length === 0 && activeRef.current === 0) {
            setTimeout(() => setBatchProgress(null), 2500);
          }

          while (activeRef.current < maxConcurrent && queueRef.current.length > 0) {
            const nextId = queueRef.current.shift()!;
            startJob(nextId);
          }
        }
      })();
    },
    [maxConcurrent, runOne, setStatus],
  );

  const enqueue = useCallback(
    (ids: string[]) => {
      const unique = ids.filter((id) => {
        const status = statusById[id];
        return status !== "loading" && status !== "queued";
      });
      if (unique.length === 0) return 0;

      if (batchTotalRef.current === 0 || batchCompletedRef.current >= batchTotalRef.current) {
        batchTotalRef.current = unique.length;
        batchCompletedRef.current = 0;
        setBatchProgress({ completed: 0, total: unique.length, active: 0 });
      } else {
        batchTotalRef.current += unique.length;
        setBatchProgress((prev) =>
          prev
            ? { ...prev, total: prev.total + unique.length }
            : { completed: 0, total: unique.length, active: 0 },
        );
      }

      for (const id of unique) {
        queueRef.current.push(id);
        setStatus(id, "queued");
      }

      while (activeRef.current < maxConcurrent && queueRef.current.length > 0) {
        const nextId = queueRef.current.shift()!;
        startJob(nextId);
      }

      return unique.length;
    },
    [setStatus, startJob, statusById],
  );

  const isBusy = useCallback(
    (id: string) => {
      const s = statusById[id];
      return s === "loading" || s === "queued";
    },
    [statusById],
  );

  const resetStatus = useCallback((id: string) => {
    setStatusById((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setErrorById((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  return {
    statusById,
    errorById,
    batchProgress,
    enqueue,
    isBusy,
    resetStatus,
  };
}
