import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { getProjectIdFromSearchParams } from "@/lib/projectIdFromUrl";

const STORAGE_KEY_PREFIX = "epermit:selectedProjectId";
const URL_PARAM = "projectId";

type SelectedProjectContextValue = {
  selectedProjectId: string | null;
  setSelectedProjectId: (id: string | null) => void;
};

const SelectedProjectContext = createContext<SelectedProjectContextValue | null>(null);

function getStorageKey(userId: string) {
  return `${STORAGE_KEY_PREFIX}:${userId}`;
}

function syncUrlProjectId(
  setSearchParams: ReturnType<typeof useSearchParams>[1],
  id: string | null,
) {
  setSearchParams(
    (prev) => {
      const next = new URLSearchParams(prev);
      if (id) {
        next.set(URL_PARAM, id);
      } else {
        next.delete(URL_PARAM);
      }
      return next;
    },
    { replace: true },
  );
}

export function SelectedProjectProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedProjectId, setState] = useState<string | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!user) {
      setState(null);
      initializedRef.current = false;
      return;
    }

    const urlId = getProjectIdFromSearchParams(searchParams);

    if (urlId) {
      setState(urlId);
      try {
        localStorage.setItem(getStorageKey(user.id), urlId);
      } catch {}
      initializedRef.current = true;
      return;
    }

    try {
      const raw = localStorage.getItem(getStorageKey(user.id));
      const value = raw === "" || raw === "null" ? null : raw;
      setState(value);
      if (value) syncUrlProjectId(setSearchParams, value);
    } catch {
      setState(null);
    }
    initializedRef.current = true;
    // Init once per user; ?projectId= changes after mount are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- searchParams intentionally omitted
  }, [user?.id]);

  // Deep links, back/forward, and in-app navigations that change ?projectId=.
  useEffect(() => {
    if (!user || !initializedRef.current) return;
    const urlId = getProjectIdFromSearchParams(searchParams);
    if (urlId == null) return;
    setState((current) => (current === urlId ? current : urlId));
    try {
      localStorage.setItem(getStorageKey(user.id), urlId);
    } catch {}
  }, [searchParams, user?.id]);

  const setSelectedProjectId = useCallback(
    (id: string | null) => {
      setState(id);
      syncUrlProjectId(setSearchParams, id);
      if (user) {
        try {
          if (id == null) {
            localStorage.removeItem(getStorageKey(user.id));
          } else {
            localStorage.setItem(getStorageKey(user.id), id);
          }
        } catch {
          // ignore
        }
      }
    },
    [user?.id, setSearchParams],
  );

  const value = useMemo(
    () => ({ selectedProjectId, setSelectedProjectId }),
    [selectedProjectId, setSelectedProjectId]
  );

  return (
    <SelectedProjectContext.Provider value={value}>
      {children}
    </SelectedProjectContext.Provider>
  );
}

export function useSelectedProject(): SelectedProjectContextValue {
  const ctx = useContext(SelectedProjectContext);
  if (ctx == null) {
    throw new Error("useSelectedProject must be used within SelectedProjectProvider");
  }
  return ctx;
}

/** Safe version for use in components that may render outside the provider (e.g. sidebar on public layout). */
export function useSelectedProjectOptional(): SelectedProjectContextValue | null {
  return useContext(SelectedProjectContext);
}
