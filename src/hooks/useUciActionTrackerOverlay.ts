import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  UciActionItemOverlay,
  UciTrackerOverlayStore,
  UciTrackerStatus,
} from "@/types/uciActionTracker";

const STORAGE_KEY = "permitpilot.uciActionTracker.overlay.v1";

function readStore(): UciTrackerOverlayStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, updatedAt: new Date(0).toISOString(), items: {} };
    const parsed = JSON.parse(raw) as UciTrackerOverlayStore;
    if (parsed?.version !== 1 || typeof parsed.items !== "object" || !parsed.items) {
      return { version: 1, updatedAt: new Date(0).toISOString(), items: {} };
    }
    return parsed;
  } catch {
    return { version: 1, updatedAt: new Date(0).toISOString(), items: {} };
  }
}

function writeStore(store: UciTrackerOverlayStore) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export type UciOverlayPatch = {
  status?: UciTrackerStatus;
  blockerGap?: string;
  nextAction?: string;
  notes?: string;
  lastVerified?: string;
};

/**
 * Lightweight browser-local overlay for internal status edits.
 * Baseline truth remains the version-controlled JSON; no new DB table.
 */
export function useUciActionTrackerOverlay() {
  const [store, setStore] = useState<UciTrackerOverlayStore>(() =>
    typeof window === "undefined"
      ? { version: 1, updatedAt: new Date(0).toISOString(), items: {} }
      : readStore(),
  );

  useEffect(() => {
    setStore(readStore());
  }, []);

  const upsert = useCallback((sequence: number, patch: UciOverlayPatch) => {
    setStore((prev) => {
      const key = String(sequence);
      const existing: UciActionItemOverlay = prev.items[key] ?? { sequence };
      const nextItem: UciActionItemOverlay = {
        ...existing,
        sequence,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      const next: UciTrackerOverlayStore = {
        version: 1,
        updatedAt: nextItem.updatedAt!,
        items: { ...prev.items, [key]: nextItem },
      };
      writeStore(next);
      return next;
    });
  }, []);

  const clearSequence = useCallback((sequence: number) => {
    setStore((prev) => {
      const items = { ...prev.items };
      delete items[String(sequence)];
      const next: UciTrackerOverlayStore = {
        version: 1,
        updatedAt: new Date().toISOString(),
        items,
      };
      writeStore(next);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    const next: UciTrackerOverlayStore = {
      version: 1,
      updatedAt: new Date().toISOString(),
      items: {},
    };
    writeStore(next);
    setStore(next);
  }, []);

  const items = useMemo(() => store.items, [store.items]);

  return {
    items,
    lastUpdatedAt: store.updatedAt,
    upsert,
    clearSequence,
    clearAll,
    persistence: "localStorage" as const,
  };
}
