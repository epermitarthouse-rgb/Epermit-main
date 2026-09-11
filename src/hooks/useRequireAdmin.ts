import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import {
  resolvePrimaryPlatformRole,
  type PlatformRoleLevel,
} from "@/lib/adminRoleHelpers";

export interface UseRequireAdminResult {
  /** True if the current user has platform admin or super_admin role */
  isAdmin: boolean;
  /** Primary platform role for the current user */
  platformRole: PlatformRoleLevel;
  /** True when the current user is a super admin */
  isSuperAdmin: boolean;
  /** True while auth or role check is in progress */
  loading: boolean;
  /** True if we have a definitive result and user is not admin */
  unauthorized: boolean;
  /** Re-run the admin role check (e.g. after role change) */
  refetch: () => Promise<void>;
}

/**
 * Checks whether the current user has platform admin access (admin or super_admin).
 * Use for admin-only UI and route guards. Does not replace backend/RLS checks.
 */
export function useRequireAdmin(): UseRequireAdminResult {
  const { user, loading: authLoading } = useAuth();
  const [platformRole, setPlatformRole] = useState<PlatformRoleLevel>("user");
  const [checkingRole, setCheckingRole] = useState(true);

  const checkAdminRole = useCallback(async () => {
    if (!user) {
      setPlatformRole("user");
      setCheckingRole(false);
      return;
    }
    setCheckingRole(true);
    try {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);

      if (error) throw error;
      const roles = (data ?? []).map((row) => String(row.role));
      setPlatformRole(resolvePrimaryPlatformRole(roles));
    } catch (err) {
      console.error("Error checking admin role:", err);
      setPlatformRole("user");
    } finally {
      setCheckingRole(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (authLoading) return;
    checkAdminRole();
  }, [authLoading, checkAdminRole]);

  const loading = authLoading || checkingRole;
  const isSuperAdmin = platformRole === "super_admin";
  const isAdmin = platformRole === "admin" || isSuperAdmin;
  const unauthorized = !loading && !!user && !isAdmin;

  return {
    isAdmin,
    platformRole,
    isSuperAdmin,
    loading,
    unauthorized,
    refetch: checkAdminRole,
  };
}
