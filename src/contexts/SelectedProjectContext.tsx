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
import { useAuth } from "@/hooks/useAuth";

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

function getUrlProjectId(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const val = params.get(URL_PARAM);
    return val && val !== "null" ? val : null;
  } catch {
    return null;
  }
}

function syncUrlProjectId(id: string | null) {
  try {
    const url = new URL(window.location.href);
    if (id) {
      url.searchParams.set(URL_PARAM, id);
    } else {
      url.searchParams.delete(URL_PARAM);
    }
    if (url.href !== window.location.href) {
      window.history.replaceState(null, "", url.toString());
    }
  } catch {
    // ignore
  }
}

export function SelectedProjectProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [selectedProjectId, setState] = useState<string | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!user) {
      setState(null);
      initializedRef.current = false;
      return;
    }

    const urlId = getUrlProjectId();

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
      if (value) syncUrlProjectId(value);
    } catch {
      setState(null);
    }
    initializedRef.current = true;
  }, [user?.id]);

  const setSelectedProjectId = useCallback(
    (id: string | null) => {
      setState(id);
      syncUrlProjectId(id);
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
    [user?.id]
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
