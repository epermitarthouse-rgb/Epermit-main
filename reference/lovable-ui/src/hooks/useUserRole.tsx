import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type AppRole = "admin" | "staff" | "client";

// Highest privilege first. Any check "at least this role" walks left-to-right.
const RANK: AppRole[] = ["admin", "staff", "client"];

export const roleRank = (role: AppRole | null): number =>
  role ? RANK.indexOf(role) : Number.POSITIVE_INFINITY;

export const highestRole = (roles: AppRole[]): AppRole | null => {
  if (!roles.length) return null;
  return [...roles].sort((a, b) => roleRank(a) - roleRank(b))[0];
};

type State = {
  roles: AppRole[];
  role: AppRole | null; // highest-privilege role
  loading: boolean;
  error: string | null;
};

/**
 * Loads the authenticated user's roles from public.user_roles.
 * Returns { roles, role (highest), loading, error }.
 */
export const useUserRole = (): State => {
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState<State>({
    roles: [],
    role: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    if (authLoading) return;
    if (!user) {
      setState({ roles: [], role: null, loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setState({ roles: [], role: null, loading: false, error: error.message });
          return;
        }
        const roles = (data ?? []).map((r) => r.role as AppRole);
        setState({ roles, role: highestRole(roles), loading: false, error: null });
      });
    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  return state;
};

export const roleLabels: Record<AppRole, string> = {
  admin: "Admin",
  staff: "Staff",
  client: "Client",
};

export const roleDescriptions: Record<AppRole, string> = {
  admin: "Full platform access including administrative surfaces",
  staff: "Full UCI operational access — submissions, comms, energization, CIAC",
  client: "Read-only visibility into your own submissions, class of service, and energization",
};