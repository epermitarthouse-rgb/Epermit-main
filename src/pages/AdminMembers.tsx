import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import {
  AlertTriangle,
  Building2,
  FolderKanban,
  Loader2,
  Search,
  Shield,
  UserPlus,
  Users,
} from "lucide-react";
import { AdminPageShell } from "@/components/admin/AdminPageShell";
import { AlertBanner, Panel } from "@/components/design/ProductPrimitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useAdminMembers, type AdminMemberRow, type AppRole } from "@/hooks/useAdminMembers";
import { supabase } from "@/lib/supabase";

function displayName(member: AdminMemberRow): string {
  return member.full_name?.trim() || member.company_name?.trim() || "Unnamed user";
}

function shortId(userId: string): string {
  return `${userId.slice(0, 8)}…`;
}

function PlatformRoleBadges({ roles }: { roles: AppRole[] }) {
  if (roles.length === 0) {
    return (
      <Badge variant="outline" className="font-normal text-muted-foreground">
        user (default)
      </Badge>
    );
  }
  return (
    <div className="flex flex-wrap gap-1">
      {roles.map((role) => (
        <Badge
          key={role}
          variant={role === "admin" ? "default" : "secondary"}
          className={role === "admin" ? "bg-primary" : undefined}
        >
          {role === "admin" ? "Platform admin" : role}
        </Badge>
      ))}
    </div>
  );
}

function ProjectSummary({ member }: { member: AdminMemberRow }) {
  const owned = member.owned_projects;
  const team = member.team_memberships;
  const total = owned.length + team.length;

  if (total === 0) {
    return <span className="text-sm text-muted-foreground">No project memberships</span>;
  }

  const preview = [...owned.slice(0, 2), ...team.slice(0, Math.max(0, 2 - owned.length))];

  return (
    <div className="space-y-1">
      <p className="text-sm">
        {owned.length} owned · {team.length} team
      </p>
      <ul className="space-y-0.5 text-xs text-muted-foreground">
        {preview.map((project) => (
          <li key={`${project.project_id}-${project.role}`}>
            <span className="text-foreground/80">{project.project_name}</span>
            {" · "}
            {project.role}
          </li>
        ))}
        {total > preview.length ? <li>+{total - preview.length} more</li> : null}
      </ul>
    </div>
  );
}

export default function AdminMembers() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { members, loading, error, usedFallback, refetch } = useAdminMembers();
  const [query, setQuery] = useState("");
  const [roleTarget, setRoleTarget] = useState<AdminMemberRow | null>(null);
  const [roleAction, setRoleAction] = useState<"grant" | "revoke" | null>(null);
  const [savingRole, setSavingRole] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter((member) => {
      const haystack = [
        member.full_name,
        member.company_name,
        member.job_title,
        member.user_id,
        ...member.platform_roles,
        ...member.owned_projects.map((p) => p.project_name),
        ...member.team_memberships.map((p) => p.project_name),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [members, query]);

  const adminCount = members.filter((m) => m.platform_roles.includes("admin")).length;

  const openRoleDialog = (member: AdminMemberRow, action: "grant" | "revoke") => {
    setRoleTarget(member);
    setRoleAction(action);
  };

  const closeRoleDialog = () => {
    if (savingRole) return;
    setRoleTarget(null);
    setRoleAction(null);
  };

  const confirmRoleChange = async () => {
    if (!user || !roleTarget || !roleAction) return;
    if (roleAction === "revoke" && roleTarget.user_id === user.id) {
      toast({
        title: "Cannot revoke your own admin role",
        description: "Ask another platform admin to change your role.",
        variant: "destructive",
      });
      return;
    }

    setSavingRole(true);
    try {
      if (roleAction === "grant") {
        const { error: insertError } = await supabase.from("user_roles").insert({
          user_id: roleTarget.user_id,
          role: "admin",
        });
        if (insertError) throw insertError;
      } else {
        const { error: deleteError } = await supabase
          .from("user_roles")
          .delete()
          .eq("user_id", roleTarget.user_id)
          .eq("role", "admin");
        if (deleteError) throw deleteError;
      }

      await supabase.from("admin_activity_log").insert({
        admin_user_id: user.id,
        admin_email: user.email ?? "unknown",
        action_type: roleAction === "grant" ? "platform_role_grant" : "platform_role_revoke",
        notification_title: displayName(roleTarget),
        notification_message: `${roleAction === "grant" ? "Granted" : "Revoked"} platform admin for ${roleTarget.user_id}`,
        delivery_status: "success",
        email_sent: false,
        subscriber_count: 0,
      });

      toast({
        title: roleAction === "grant" ? "Platform admin granted" : "Platform admin revoked",
        description: displayName(roleTarget),
      });
      setRoleTarget(null);
      setRoleAction(null);
      await refetch();
    } catch (err) {
      console.error("Role change failed:", err);
      toast({
        title: "Role change failed",
        description: err instanceof Error ? err.message : "Unable to update user_roles",
        variant: "destructive",
      });
    } finally {
      setSavingRole(false);
    }
  };

  return (
    <AdminPageShell
      variant="editorial"
      title="Members"
      description="Platform users, roles, and project membership links. Invite collaborators via a project's Team tab."
      breadcrumbs={[{ label: "Members" }]}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link to="/projects">
            <UserPlus className="mr-2 h-4 w-4" />
            Invite via project team
          </Link>
        </Button>
      }
    >
      <div className="space-y-6">
        <AlertBanner
          tone="info"
          title="Project invites stay on Projects → Team"
          detail="There is no org-level invite in P0. Open a project, use the Team tab, and invite by email (Resend). Credentials remain personal — sharing a project does not share portal logins."
        />

        {usedFallback ? (
          <AlertBanner
            tone="warn"
            title="Project matrix unavailable"
            detail="Directory loaded from profiles + user_roles. Apply migration 20260806010000_admin_members_directory.sql for the full project membership summary RPC."
          />
        ) : null}

        {error ? <AlertBanner tone="bad" title="Could not load members" detail={error} /> : null}

        <div className="grid gap-4 sm:grid-cols-3">
          <Panel title="Directory size" eyebrow="Members">
            <p className="font-data text-3xl font-semibold tabular-nums">{loading ? "—" : members.length}</p>
            <p className="mt-1 text-xs text-muted-foreground">Rows from profiles</p>
          </Panel>
          <Panel title="Platform admins" eyebrow="Roles">
            <p className="font-data text-3xl font-semibold tabular-nums">{loading ? "—" : adminCount}</p>
            <p className="mt-1 text-xs text-muted-foreground">user_roles.role = admin</p>
          </Panel>
          <Panel title="Invite path" eyebrow="Access">
            <p className="text-sm text-muted-foreground">
              Use{" "}
              <Link className="text-primary underline-offset-2 hover:underline" to="/projects">
                Projects → Team
              </Link>{" "}
              for owner/admin/editor/viewer invites.
            </p>
          </Panel>
        </div>

        <Panel
          title="Member directory"
          eyebrow="Live"
          action={
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, company, project…"
                className="pl-8"
                aria-label="Search members"
              />
            </div>
          }
        >
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading members…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground">
              <Users className="h-10 w-10 opacity-50" />
              <p>{members.length === 0 ? "No profiles found." : "No members match this search."}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Member</TableHead>
                    <TableHead>Platform role</TableHead>
                    <TableHead>Projects</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((member) => {
                    const isAdmin = member.platform_roles.includes("admin");
                    const isSelf = member.user_id === user?.id;
                    return (
                      <TableRow key={member.user_id}>
                        <TableCell>
                          <div className="space-y-0.5">
                            <p className="font-medium text-foreground">{displayName(member)}</p>
                            <p className="text-xs text-muted-foreground">
                              {[member.company_name, member.job_title].filter(Boolean).join(" · ") || "—"}
                            </p>
                            <p className="font-mono text-[11px] text-muted-foreground" title={member.user_id}>
                              {shortId(member.user_id)}
                              {member.created_at
                                ? ` · joined ${format(new Date(member.created_at), "MMM d, yyyy")}`
                                : null}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <PlatformRoleBadges roles={member.platform_roles} />
                        </TableCell>
                        <TableCell>
                          <ProjectSummary member={member} />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <Button asChild variant="outline" size="sm">
                              <Link to="/projects">
                                <FolderKanban className="mr-1.5 h-3.5 w-3.5" />
                                Project team
                              </Link>
                            </Button>
                            {isAdmin ? (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={isSelf}
                                onClick={() => openRoleDialog(member, "revoke")}
                              >
                                <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />
                                Revoke admin
                              </Button>
                            ) : (
                              <Button variant="secondary" size="sm" onClick={() => openRoleDialog(member, "grant")}>
                                <Shield className="mr-1.5 h-3.5 w-3.5" />
                                Grant admin
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </Panel>

        <Panel title="Credential scope (read this)" eyebrow="Policy">
          <div className="flex gap-3 text-sm text-muted-foreground">
            <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p>
              Portal credentials are owned by each user. Project membership unlocks project-scoped harvest data; it
              does not grant teammates access to another user&apos;s portal password vault. Credential ACL is deferred
              to a later phase.
            </p>
          </div>
        </Panel>
      </div>

      <Dialog open={!!roleTarget && !!roleAction} onOpenChange={(open) => !open && closeRoleDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {roleAction === "grant" ? "Grant platform admin?" : "Revoke platform admin?"}
            </DialogTitle>
            <DialogDescription>
              {roleTarget
                ? roleAction === "grant"
                  ? `Give ${displayName(roleTarget)} the platform admin role (user_roles). This unlocks the Admin console — it does not grant access to every project or credential.`
                  : `Remove the platform admin role from ${displayName(roleTarget)}. They will lose Admin console access.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={closeRoleDialog} disabled={savingRole}>
              Cancel
            </Button>
            <Button
              variant={roleAction === "revoke" ? "destructive" : "default"}
              onClick={() => void confirmRoleChange()}
              disabled={savingRole}
            >
              {savingRole ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {roleAction === "grant" ? "Grant admin" : "Revoke admin"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminPageShell>
  );
}
