import { useCallback, useMemo } from "react";
import { uciAuthenticatedFetch } from "@/lib/uciApi";
import {
  activateAdminUser,
  copyAdminPermissionsFromUser,
  createAdminUser,
  deactivateAdminUser,
  exportAdminAuditCsv,
  getAdminEffectivePermissions,
  getAdminOverview,
  listAdminAuditEvents,
  listAdminPortalCredentials,
  listAdminUsers,
  setAdminCredentialGrants,
  resetAdminFeaturePermission,
  setAdminFeaturePermissions,
  setAdminPlatformRole,
  setAdminProjectRole,
  setAdminProjectAccess,
  setAdminScrapedDataScope,
  type AdminAuditQuery,
  type ProjectAccessControl,
  type AdminCreateUserRequest,
  type AdminCredentialGrantUpdateItem,
  type AdminFeatureUpdateItem,
  type AdminFetchFn,
  type AdminScrapedDataScopeRow,
  type AdminUsersQuery,
} from "@/lib/adminApi";
import type { ProjectRole } from "@/lib/governanceConstants";

/**
 * Hook returning admin governance API methods bound to the current Supabase session.
 */
export function useAdminApi() {
  const fetchFn = useCallback<AdminFetchFn>(
    (path, init) => uciAuthenticatedFetch(path, init),
    [],
  );

  const api = useMemo(
    () => ({
      getOverview: () => getAdminOverview(fetchFn),
      listUsers: (query?: AdminUsersQuery) => listAdminUsers(query, fetchFn),
      listPortalCredentials: () => listAdminPortalCredentials(fetchFn),
      createUser: (payload: AdminCreateUserRequest) => createAdminUser(payload, fetchFn),
      getEffectivePermissions: (userId: string) =>
        getAdminEffectivePermissions(userId, fetchFn),
      activateUser: (userId: string, reason?: string) =>
        activateAdminUser(userId, reason, fetchFn),
      deactivateUser: (userId: string, reason?: string) =>
        deactivateAdminUser(userId, reason, fetchFn),
      setPlatformRole: (userId: string, action: "grant" | "revoke") =>
        setAdminPlatformRole(userId, action, fetchFn),
      setProjectRole: (userId: string, projectId: string, role: ProjectRole) =>
        setAdminProjectRole(userId, projectId, role, fetchFn),
      setProjectAccess: (userId: string, projectId: string, accessLevel: ProjectAccessControl) =>
        setAdminProjectAccess(userId, projectId, accessLevel, fetchFn),
      setFeaturePermissions: (userId: string, features: AdminFeatureUpdateItem[]) =>
        setAdminFeaturePermissions(userId, features, fetchFn),
      resetFeaturePermission: (
        userId: string,
        featureKey: AdminFeatureUpdateItem["feature_key"],
        projectId?: string | null,
      ) => resetAdminFeaturePermission(userId, featureKey, projectId ?? null, fetchFn),
      setScrapedDataScope: (userId: string, scopes: AdminScrapedDataScopeRow[]) =>
        setAdminScrapedDataScope(userId, scopes, fetchFn),
      setCredentialGrants: (userId: string, grants: AdminCredentialGrantUpdateItem[]) =>
        setAdminCredentialGrants(userId, grants, fetchFn),
      copyPermissionsFrom: (userId: string, sourceUserId: string) =>
        copyAdminPermissionsFromUser(userId, sourceUserId, fetchFn),
      listAuditEvents: (query?: AdminAuditQuery) => listAdminAuditEvents(query, fetchFn),
      exportAuditCsv: (query?: Pick<AdminAuditQuery, "from" | "to">) =>
        exportAdminAuditCsv(query, fetchFn),
      authenticatedFetch: fetchFn,
    }),
    [fetchFn],
  );

  return api;
}
