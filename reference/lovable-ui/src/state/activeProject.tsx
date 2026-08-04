import { createContext, useContext, useEffect, useMemo, ReactNode, useCallback, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { projects as projectCatalog, type PermitPilotProject } from "@/components/permitpilot/data";

export type ActiveProject = PermitPilotProject;
export const PROJECTS: ActiveProject[] = projectCatalog;

export type PortalCredential = {
  id: string;
  projectId: string;
  portalName: string;
  username: string;
  portalUrl: string;
  createdAt: string;
};

type Ctx = {
  projects: ActiveProject[];
  activeId: string;
  active: ActiveProject;
  setActiveId: (id: string) => void;
  credentials: PortalCredential[];
  addCredential: (input: Omit<PortalCredential, "id" | "createdAt">) => PortalCredential;
  removeCredential: (id: string) => void;
};

const ActiveProjectContext = createContext<Ctx | null>(null);
const STORAGE_KEY = "commun-et:active-project-id";
const CREDS_KEY = "commun-et:portal-credentials";
const QUERY_KEY = "project";

const isValidId = (id: string | null | undefined): id is string =>
  !!id && PROJECTS.some((p) => p.id === id);

export const ActiveProjectProvider = ({ children }: { children: ReactNode }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlId = searchParams.get(QUERY_KEY);

  const storedId = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
  const activeId = isValidId(urlId)
    ? urlId
    : isValidId(storedId)
      ? storedId
      : PROJECTS[0].id;

  // If URL has no (or invalid) project param, backfill it so deep links carry state.
  useEffect(() => {
    if (urlId !== activeId) {
      const next = new URLSearchParams(searchParams);
      next.set(QUERY_KEY, activeId);
      setSearchParams(next, { replace: true });
    }
  }, [urlId, activeId, searchParams, setSearchParams]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, activeId);
    } catch {
      /* ignore */
    }
  }, [activeId]);

  // Cross-tab sync via storage events — reflect into URL on this tab.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && isValidId(e.newValue)) {
        const next = new URLSearchParams(window.location.search);
        next.set(QUERY_KEY, e.newValue);
        setSearchParams(next, { replace: true });
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [setSearchParams]);

  const setActiveId = useCallback(
    (id: string) => {
      if (!isValidId(id)) return;
      const current = new URLSearchParams(window.location.search);
      if (current.get(QUERY_KEY) === id) return;
      const next = new URLSearchParams(current);
      next.set(QUERY_KEY, id);
      setSearchParams(next, { replace: false });
    },
    [setSearchParams],
  );

  // Portal credentials store (persisted, no secrets — only metadata)
  const [credentials, setCredentials] = useState<PortalCredential[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(CREDS_KEY);
      return raw ? (JSON.parse(raw) as PortalCredential[]) : seedCredentials();
    } catch {
      return seedCredentials();
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(CREDS_KEY, JSON.stringify(credentials));
    } catch {
      /* ignore */
    }
  }, [credentials]);

  const addCredential = useCallback<Ctx["addCredential"]>((input) => {
    const cred: PortalCredential = {
      ...input,
      id: `cred_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
    };
    setCredentials((prev) => [cred, ...prev]);
    return cred;
  }, []);

  const removeCredential = useCallback((id: string) => {
    setCredentials((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const value = useMemo<Ctx>(() => {
    const active = PROJECTS.find((p) => p.id === activeId) ?? PROJECTS[0];
    return { projects: PROJECTS, activeId, active, setActiveId, credentials, addCredential, removeCredential };
  }, [activeId, setActiveId, credentials, addCredential, removeCredential]);

  return <ActiveProjectContext.Provider value={value}>{children}</ActiveProjectContext.Provider>;
};

export const useActiveProject = () => {
  const ctx = useContext(ActiveProjectContext);
  if (!ctx) throw new Error("useActiveProject must be used within ActiveProjectProvider");
  return ctx;
};

function seedCredentials(): PortalCredential[] {
  const now = new Date().toISOString();
  return [
    { id: "cred_seed_1", projectId: PROJECTS[0].id, portalName: "Arlington County Plus", username: "ops@permitpilot.com", portalUrl: "https://example.com/arlington", createdAt: now },
    { id: "cred_seed_2", projectId: PROJECTS[0].id, portalName: "Dominion Energy Work Center", username: "ops@permitpilot.com", portalUrl: "https://example.com/dominion", createdAt: now },
    { id: "cred_seed_3", projectId: PROJECTS[2].id, portalName: "Seattle Intake Portal", username: "ops@permitpilot.com", portalUrl: "https://example.com/seattle", createdAt: now },
  ];
}