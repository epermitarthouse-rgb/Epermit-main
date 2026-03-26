import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";

export interface UseRequireAdminResult {
  /** True if the current user has app_role 'admin' in user_roles */
  isAdmin: boolean;
  /** True while auth or role check is in progress */
  loading: boolean;
  /** True if we have a definitive result and user is not admin */
  unauthorized: boolean;
  /** Re-run the admin role check (e.g. after role change) */
  refetch: () => Promise<void>;
}

/**
 * Checks whether the current user has the admin role (user_roles.role = 'admin').
 * Use for admin-only UI and route guards. Does not replace backend/RLS checks.
 */
export function useRequireAdmin(): UseRequireAdminResult {
  const { user, loading: authLoading } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingRole, setCheckingRole] = useState(true);

  const checkAdminRole = useCallback(async () => {
    if (!user) {
      setIsAdmin(false);
      setCheckingRole(false);
      return;
    }
    setCheckingRole(true);
    try {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();

      if (error) throw error;
      setIsAdmin(!!data);
    } catch (err) {
      console.error("Error checking admin role:", err);
      setIsAdmin(false);
    } finally {
      setCheckingRole(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (authLoading) return;
    checkAdminRole();
  }, [authLoading, checkAdminRole]);

  const loading = authLoading || checkingRole;
  const unauthorized = !loading && !!user && !isAdmin;

  return { isAdmin, loading, unauthorized, refetch: checkAdminRole };
}
