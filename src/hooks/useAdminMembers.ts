import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/integrations/supabase/types";

export type AppRole = Database["public"]["Enums"]["app_role"];

export type MemberProjectLink = {
  project_id: string;
  project_name: string;
  role: string;
};

export type AdminMemberRow = {
  user_id: string;
  full_name: string | null;
  company_name: string | null;
  job_title: string | null;
  created_at: string | null;
  platform_roles: AppRole[];
  owned_projects: MemberProjectLink[];
  team_memberships: MemberProjectLink[];
};

function asProjectLinks(value: unknown): MemberProjectLink[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const project_id = typeof row.project_id === "string" ? row.project_id : null;
      const project_name = typeof row.project_name === "string" ? row.project_name : "Untitled project";
      const role = typeof row.role === "string" ? row.role : "member";
      if (!project_id) return null;
      return { project_id, project_name, role };
    })
    .filter((row): row is MemberProjectLink => !!row);
}

function asRoles(value: unknown): AppRole[] {
  if (!Array.isArray(value)) return [];
  return value.filter((role): role is AppRole => role === "admin" || role === "moderator" || role === "user");
}

function parseDirectoryPayload(data: unknown): AdminMemberRow[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const user_id = typeof row.user_id === "string" ? row.user_id : null;
      if (!user_id) return null;
      return {
        user_id,
        full_name: typeof row.full_name === "string" ? row.full_name : null,
        company_name: typeof row.company_name === "string" ? row.company_name : null,
        job_title: typeof row.job_title === "string" ? row.job_title : null,
        created_at: typeof row.created_at === "string" ? row.created_at : null,
        platform_roles: asRoles(row.platform_roles),
        owned_projects: asProjectLinks(row.owned_projects),
        team_memberships: asProjectLinks(row.team_memberships),
      };
    })
    .filter((row): row is AdminMemberRow => !!row);
}

async function fetchDirectoryFallback(): Promise<AdminMemberRow[]> {
  const [{ data: profiles, error: profilesError }, { data: roles, error: rolesError }] = await Promise.all([
    supabase.from("profiles").select("user_id, full_name, company_name, job_title, created_at").order("full_name"),
    supabase.from("user_roles").select("user_id, role"),
  ]);

  if (profilesError) throw profilesError;
  if (rolesError) throw rolesError;

  const rolesByUser = new Map<string, AppRole[]>();
  for (const row of roles ?? []) {
    const list = rolesByUser.get(row.user_id) ?? [];
    list.push(row.role);
    rolesByUser.set(row.user_id, list);
  }

  return (profiles ?? []).map((profile) => ({
    user_id: profile.user_id,
    full_name: profile.full_name,
    company_name: profile.company_name,
    job_title: profile.job_title,
    created_at: profile.created_at,
    platform_roles: rolesByUser.get(profile.user_id) ?? [],
    owned_projects: [],
    team_memberships: [],
  }));
}

export function useAdminMembers() {
  const [members, setMembers] = useState<AdminMemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usedFallback, setUsedFallback] = useState(false);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc("admin_list_member_directory");
      if (!rpcError) {
        setMembers(parseDirectoryPayload(data));
        setUsedFallback(false);
        return;
      }

      console.warn("admin_list_member_directory unavailable, using profiles fallback:", rpcError.message);
      const fallback = await fetchDirectoryFallback();
      setMembers(fallback);
      setUsedFallback(true);
    } catch (err) {
      console.error("Failed to load admin members:", err);
      setMembers([]);
      setError(err instanceof Error ? err.message : "Failed to load members");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { members, loading, error, usedFallback, refetch };
}
