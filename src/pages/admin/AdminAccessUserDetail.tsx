import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Copy, Loader2, Plus, Shield, UserCog } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Link, useParams } from "react-router-dom";
import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { AdminPageShell } from "@/components/admin/AdminPageShell";
import { AlertBanner, Panel } from "@/components/design/ProductPrimitives";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useAdminApi } from "@/hooks/useAdminApi";
import { useProjects } from "@/hooks/useProjects";
import type {
  AdminEffectivePermissions,
  AdminPortalCredential,
} from "@/lib/adminApi";
import {
  activeCredentialGrants,
  buildProjectAccessRows,
  credentialAccessSummaryText,
  credentialDisplayLabel,
  credentialGrantSummary,
  credentialsAvailableForGrant,
  CREDENTIAL_GRANT_DISPLAY,
  dataRestrictionsSummary,
  featureAccessSummary,
  formatAccessLevel,
  globalFeatureAccessRow,
  humanRiskLabel,
  portalCredentialLabel,
  projectAccessSummary,
  projectsForBulkAccess,
  userIdentityMeta,
  userIdentitySubtitle,
  userIdentityTitle,
} from "@/lib/adminUserDetailHelpers";
import {
  FEATURE_CONTROL_LABELS,
  FEATURE_KEYS,
  PROJECT_ROLE_LABELS,
  featureKeyLabel,
  type CredentialGrantLevel,
  type FeatureAccessControl,
  type ProjectRole,
} from "@/lib/governanceConstants";

type ConfirmAction =
  | { type: "deactivate" }
  | { type: "revoke_admin" }
  | { type: "revoke_credential"; credentialId: string };

const ASSIGNABLE_TEAM_ROLES: ProjectRole[] = ["viewer", "editor", "admin"];

export default function AdminAccessUserDetail() {
  const { userId = "" } = useParams();
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const adminApi = useAdminApi();
  const { projects: adminProjects, loading: adminProjectsLoading } = useProjects();

  const [effective, setEffective] = useState<AdminEffectivePermissions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [busy, setBusy] = useState(false);

  const [customizingFeature, setCustomizingFeature] = useState<string | null>(null);
  const [addProjectOpen, setAddProjectOpen] = useState(false);
  const [bulkProjectSearch, setBulkProjectSearch] = useState("");
  const [bulkSelectedProjectIds, setBulkSelectedProjectIds] = useState<string[]>([]);
  const [bulkProjectRole, setBulkProjectRole] = useState<ProjectRole>("viewer");
  const [selectedTeamProjectIds, setSelectedTeamProjectIds] = useState<string[]>([]);
  const [bulkTableRole, setBulkTableRole] = useState<ProjectRole>("viewer");
  const [portalCredentials, setPortalCredentials] = useState<AdminPortalCredential[]>([]);
  const [portalCredentialsLoading, setPortalCredentialsLoading] = useState(false);
  const [addCredentialOpen, setAddCredentialOpen] = useState(false);
  const [addCredentialId, setAddCredentialId] = useState("");
  const [addCredentialLevel, setAddCredentialLevel] = useState<CredentialGrantLevel>("use");
  const [credentialSearch, setCredentialSearch] = useState("");

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const perm = await adminApi.getEffectivePermissions(userId);
      setEffective(perm);
      setSelectedTeamProjectIds((prev) =>
        prev.filter((id) => perm.projects?.some((project) => project.project_id === id)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load user");
      setEffective(null);
    } finally {
      setLoading(false);
    }
  }, [adminApi, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadPortalCredentials = useCallback(async () => {
    setPortalCredentialsLoading(true);
    try {
      const rows = await adminApi.listPortalCredentials();
      setPortalCredentials(rows);
    } catch (err) {
      toast({
        title: "Could not load portal credentials",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
      setPortalCredentials([]);
    } finally {
      setPortalCredentialsLoading(false);
    }
  }, [adminApi, toast]);

  useEffect(() => {
    if (effective && !effective.platform_admin) {
      void loadPortalCredentials();
    }
  }, [effective?.platform_admin, loadPortalCredentials]);

  const projectAccessRows = useMemo(
    () => (effective ? buildProjectAccessRows(effective) : []),
    [effective],
  );

  const bulkProjectOptions = useMemo(() => {
    if (!effective) return [];
    return projectsForBulkAccess(
      adminProjects.map((project) => ({ id: project.id, name: project.name })),
      effective,
    );
  }, [adminProjects, effective]);

  const filteredBulkProjectOptions = useMemo(() => {
    const query = bulkProjectSearch.trim().toLowerCase();
    if (!query) return bulkProjectOptions;
    return bulkProjectOptions.filter((project) =>
      project.name.toLowerCase().includes(query),
    );
  }, [bulkProjectOptions, bulkProjectSearch]);

  const selectableTeamProjectIds = useMemo(
    () => projectAccessRows.filter((row) => !row.isOwner).map((row) => row.project_id),
    [projectAccessRows],
  );

  const resetAddProjectForm = () => {
    setBulkProjectSearch("");
    setBulkSelectedProjectIds([]);
    setBulkProjectRole("viewer");
  };

  const openAddProjectDialog = () => {
    resetAddProjectForm();
    setAddProjectOpen(true);
  };

  const toggleBulkProject = (projectId: string, checked: boolean) => {
    setBulkSelectedProjectIds((prev) => {
      if (checked) {
        return prev.includes(projectId) ? prev : [...prev, projectId];
      }
      return prev.filter((id) => id !== projectId);
    });
  };

  const selectAllBulkProjects = () => {
    setBulkSelectedProjectIds(filteredBulkProjectOptions.map((project) => project.id));
  };

  const clearAllBulkProjects = () => {
    setBulkSelectedProjectIds([]);
  };

  const toggleTeamProjectSelection = (projectId: string, checked: boolean) => {
    setSelectedTeamProjectIds((prev) => {
      if (checked) {
        return prev.includes(projectId) ? prev : [...prev, projectId];
      }
      return prev.filter((id) => id !== projectId);
    });
  };

  const selectAllTeamProjects = () => {
    setSelectedTeamProjectIds([...selectableTeamProjectIds]);
  };

  const clearTeamProjectSelection = () => {
    setSelectedTeamProjectIds([]);
  };

  const copyUserId = async () => {
    if (!effective?.user_id) return;
    try {
      await navigator.clipboard.writeText(effective.user_id);
      toast({ title: "User ID copied" });
    } catch {
      toast({ title: "Could not copy", variant: "destructive" });
    }
  };

  const handleActivate = async () => {
    setBusy(true);
    try {
      await adminApi.activateUser(userId);
      toast({ title: "User activated" });
      await load();
    } catch (err) {
      toast({
        title: "Activation failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmDestructive = async (reason: string) => {
    if (!confirmAction) return;
    if (confirmAction.type === "deactivate") {
      await adminApi.deactivateUser(userId, reason);
      toast({ title: "User deactivated" });
    } else if (confirmAction.type === "revoke_admin") {
      await adminApi.setPlatformRole(userId, "revoke");
      toast({ title: "Platform admin revoked" });
    } else if (confirmAction.type === "revoke_credential") {
      await adminApi.setCredentialGrants(userId, [
        { credential_id: confirmAction.credentialId, grant_level: "none" },
      ]);
      toast({ title: "Credential access removed" });
    }
    await load();
  };

  const handleGrantAdmin = async () => {
    setBusy(true);
    try {
      await adminApi.setPlatformRole(userId, "grant");
      toast({ title: "Platform admin granted" });
      await load();
    } catch (err) {
      toast({
        title: "Grant failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleProjectRoleChange = async (projectId: string, role: ProjectRole) => {
    setBusy(true);
    try {
      await adminApi.setProjectRole(userId, projectId, role);
      toast({
        title: role === "none" ? "Project access removed" : "Project role updated",
      });
      await load();
    } catch (err) {
      toast({
        title: "Update failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleBulkProjectAccessSave = async () => {
    if (bulkSelectedProjectIds.length === 0) return;
    setBusy(true);
    try {
      for (const projectId of bulkSelectedProjectIds) {
        await adminApi.setProjectRole(userId, projectId, bulkProjectRole);
      }
      toast({
        title: "Project access updated",
        description: `${bulkSelectedProjectIds.length} project${bulkSelectedProjectIds.length === 1 ? "" : "s"} assigned ${PROJECT_ROLE_LABELS[bulkProjectRole]}.`,
      });
      setAddProjectOpen(false);
      resetAddProjectForm();
      await load();
    } catch (err) {
      toast({
        title: "Could not update project access",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleBulkTeamProjectRoleChange = async () => {
    if (selectedTeamProjectIds.length === 0) return;
    setBusy(true);
    try {
      for (const projectId of selectedTeamProjectIds) {
        await adminApi.setProjectRole(userId, projectId, bulkTableRole);
      }
      toast({
        title: "Project roles updated",
        description: `${selectedTeamProjectIds.length} project${selectedTeamProjectIds.length === 1 ? "" : "s"} set to ${PROJECT_ROLE_LABELS[bulkTableRole]}.`,
      });
      setSelectedTeamProjectIds([]);
      await load();
    } catch (err) {
      toast({
        title: "Bulk update failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleBulkTeamProjectRemove = async () => {
    if (selectedTeamProjectIds.length === 0) return;
    setBusy(true);
    try {
      for (const projectId of selectedTeamProjectIds) {
        await adminApi.setProjectRole(userId, projectId, "none");
      }
      toast({
        title: "Project access removed",
        description: `${selectedTeamProjectIds.length} team membership${selectedTeamProjectIds.length === 1 ? "" : "s"} removed.`,
      });
      setSelectedTeamProjectIds([]);
      await load();
    } catch (err) {
      toast({
        title: "Bulk remove failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleFeatureCustomize = async (
    featureKey: string,
    control: FeatureAccessControl,
  ) => {
    setBusy(true);
    try {
      if (control === "inherit") {
        await adminApi.resetFeaturePermission(userId, featureKey, null);
        toast({ title: "Feature access reset to default" });
      } else {
        await adminApi.setFeaturePermissions(userId, [
          { project_id: null, feature_key: featureKey, access_level: control },
        ]);
        toast({ title: "Feature access updated" });
      }
      setCustomizingFeature(null);
      await load();
    } catch (err) {
      toast({
        title: "Update failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleCredentialGrantChange = async (
    credentialId: string,
    grantLevel: CredentialGrantLevel,
  ) => {
    const existing = effective?.credential_grants?.find(
      (grant) => grant.credential_id === credentialId,
    );
    setBusy(true);
    try {
      await adminApi.setCredentialGrants(userId, [
        {
          credential_id: credentialId,
          grant_level: grantLevel,
          project_id: existing?.project_id ?? null,
          jurisdiction: existing?.jurisdiction ?? null,
        },
      ]);
      toast({
        title: grantLevel === "none" ? "Credential access removed" : "Credential access updated",
      });
      await load();
    } catch (err) {
      toast({
        title: "Update failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleAddCredentialAccess = async () => {
    if (!addCredentialId) return;
    const selected = portalCredentials.find((credential) => credential.id === addCredentialId);
    setBusy(true);
    try {
      await adminApi.setCredentialGrants(userId, [
        {
          credential_id: addCredentialId,
          grant_level: addCredentialLevel,
          project_id: selected?.project_id ?? null,
          jurisdiction: selected?.jurisdiction ?? null,
        },
      ]);
      toast({ title: "Credential access granted" });
      setAddCredentialOpen(false);
      setAddCredentialId("");
      setAddCredentialLevel("use");
      setCredentialSearch("");
      await load();
    } catch (err) {
      toast({
        title: "Could not add credential access",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const identityTitle = effective ? userIdentityTitle(effective) : "User detail";
  const identitySubtitle = effective ? userIdentitySubtitle(effective) : null;
  const identityMeta = effective ? userIdentityMeta(effective) : null;
  const breadcrumbLabel = effective ? userIdentityTitle(effective) : "User";

  const accessSummary = effective
    ? {
        projects: projectAccessSummary(effective),
        credentials: credentialGrantSummary(effective),
      }
    : null;

  const credentialGrants = effective ? activeCredentialGrants(effective) : [];

  const grantableCredentials = useMemo(() => {
    if (!effective) return [];
    const available = credentialsAvailableForGrant(portalCredentials, effective);
    const query = credentialSearch.trim().toLowerCase();
    if (!query) return available;
    return available.filter((credential) =>
      portalCredentialLabel(credential).toLowerCase().includes(query),
    );
  }, [portalCredentials, effective, credentialSearch]);

  return (
    <AdminPageShell
      variant="editorial"
      title={identityTitle}
      description={
        effective
          ? identitySubtitle ?? identityMeta ?? "Manage platform access and permissions."
          : "Manage platform access and permissions."
      }
      breadcrumbs={[
        { label: "Users & Access", href: "/admin/access/users" },
        { label: "Directory", href: "/admin/access/users" },
        { label: breadcrumbLabel },
      ]}
    >
      {error ? <AlertBanner tone="bad" title="Could not load user" detail={error} /> : null}

      {loading ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-6 w-6 animate-spin" />
          Loading user permissions…
        </div>
      ) : effective ? (
        <>
          <div className="mb-6 space-y-1 text-sm">
            {identitySubtitle ? (
              <p className="text-muted-foreground">{identitySubtitle}</p>
            ) : null}
            {identityMeta && identitySubtitle ? (
              <p className="text-muted-foreground">{identityMeta}</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="font-mono text-xs text-muted-foreground">{effective.user_id}</span>
              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => void copyUserId()}>
                <Copy className="mr-1 h-3 w-3" />
                Copy ID
              </Button>
            </div>
          </div>

          <Tabs defaultValue="summary" className="space-y-6">
            <TabsList className="flex h-auto flex-wrap justify-start gap-1">
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="projects">Project access</TabsTrigger>
              <TabsTrigger value="features">Feature access</TabsTrigger>
              <TabsTrigger value="credentials">Credentials</TabsTrigger>
            </TabsList>

            <TabsContent value="summary" className="space-y-6">
              <Panel title="Access summary" eyebrow="reviewer">
                <dl className="grid gap-4 text-sm md:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">Platform access</dt>
                    <dd className="capitalize">{effective.access_status}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Platform role</dt>
                    <dd>{effective.platform_admin ? "Platform admin" : "User"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Projects</dt>
                    <dd>
                      {accessSummary?.projects.total ?? 0} accessible
                      {(accessSummary?.projects.total ?? 0) > 0 ? (
                        <span className="text-muted-foreground">
                          {" "}
                          ({accessSummary?.projects.owned} owner, {accessSummary?.projects.team}{" "}
                          team)
                        </span>
                      ) : null}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Feature access</dt>
                    <dd>{featureAccessSummary(effective)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Data restrictions</dt>
                    <dd>{dataRestrictionsSummary(effective)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Portal credentials</dt>
                    <dd>
                      {effective ? credentialAccessSummaryText(effective) : "—"}
                      {effective?.platform_admin &&
                      (accessSummary?.credentials.explicitTotal ?? 0) > 0 ? (
                        <span className="block text-xs text-muted-foreground">
                          {accessSummary?.credentials.explicitTotal} explicit grant row
                          {(accessSummary?.credentials.explicitTotal ?? 0) === 1 ? "" : "s"} stored
                        </span>
                      ) : null}
                    </dd>
                  </div>
                  {effective.access_review?.reviewed_at ? (
                    <div>
                      <dt className="text-muted-foreground">Last access review</dt>
                      <dd>{format(new Date(effective.access_review.reviewed_at), "MMM d, yyyy")}</dd>
                    </div>
                  ) : null}
                </dl>
              </Panel>

              <Panel title="Account actions" eyebrow="governance">
                <div className="flex flex-wrap gap-2">
                  {effective.access_status === "deactivated" ? (
                    <Button disabled={busy} onClick={() => void handleActivate()}>
                      Activate user
                    </Button>
                  ) : (
                    <Button
                      variant="destructive"
                      disabled={busy || currentUser?.id === userId}
                      onClick={() => setConfirmAction({ type: "deactivate" })}
                    >
                      Deactivate user
                    </Button>
                  )}
                  {effective.platform_admin ? (
                    <Button
                      variant="outline"
                      disabled={busy || currentUser?.id === userId}
                      onClick={() => setConfirmAction({ type: "revoke_admin" })}
                    >
                      <Shield className="mr-2 h-4 w-4" />
                      Revoke platform admin
                    </Button>
                  ) : (
                    <Button variant="outline" disabled={busy} onClick={() => void handleGrantAdmin()}>
                      <Shield className="mr-2 h-4 w-4" />
                      Grant platform admin
                    </Button>
                  )}
                </div>
              </Panel>

              {(effective.risks?.length ?? 0) > 0 ? (
                <AlertBanner
                  tone="warn"
                  title="Permission risks"
                  detail={effective.risks!.map(humanRiskLabel).join(" ")}
                />
              ) : null}
            </TabsContent>

            <TabsContent value="projects">
              {effective.platform_admin ? (
                <AlertBanner
                  tone="info"
                  title="Platform admin"
                  detail="Global feature access applies. Project rows below show ownership and team membership only."
                />
              ) : null}
              <Panel title="Project access" eyebrow="membership">
                <p className="mb-4 text-sm text-muted-foreground">
                  Access comes from project ownership or team membership. Grant Viewer, Editor, or
                  Admin team roles below, or remove team access. Ownership cannot be changed here.
                </p>
                {projectAccessRows.length > 0 ? (
                  <div className="mb-4 flex justify-end">
                    <Button
                      disabled={busy || adminProjectsLoading || bulkProjectOptions.length === 0}
                      onClick={openAddProjectDialog}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Manage project access
                    </Button>
                  </div>
                ) : null}
                {selectedTeamProjectIds.length > 0 ? (
                  <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-3">
                    <span className="text-sm text-muted-foreground">
                      {selectedTeamProjectIds.length} selected
                    </span>
                    <Select
                      value={bulkTableRole}
                      onValueChange={(value) => setBulkTableRole(value as ProjectRole)}
                      disabled={busy}
                    >
                      <SelectTrigger className="w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ASSIGNABLE_TEAM_ROLES.map((value) => (
                          <SelectItem key={value} value={value}>
                            {PROJECT_ROLE_LABELS[value]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => void handleBulkTeamProjectRoleChange()}
                    >
                      Apply role
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      disabled={busy}
                      onClick={() => void handleBulkTeamProjectRemove()}
                    >
                      Remove access
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={clearTeamProjectSelection}
                    >
                      Clear selection
                    </Button>
                  </div>
                ) : null}
                {projectAccessRows.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-8 text-center">
                    <p className="text-sm text-muted-foreground">No project access assigned.</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Grant team membership to give this user access to a project.
                    </p>
                    <Button
                      className="mt-4"
                      disabled={busy || adminProjectsLoading || bulkProjectOptions.length === 0}
                      onClick={openAddProjectDialog}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Manage project access
                    </Button>
                    {!adminProjectsLoading && bulkProjectOptions.length === 0 ? (
                      <p className="mt-3 text-xs text-muted-foreground">
                        No projects are available to assign (ownership rows are read-only).
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10">
                            {selectableTeamProjectIds.length > 0 ? (
                              <Checkbox
                                checked={
                                  selectableTeamProjectIds.length > 0 &&
                                  selectedTeamProjectIds.length === selectableTeamProjectIds.length
                                }
                                onCheckedChange={(checked) => {
                                  if (checked) selectAllTeamProjects();
                                  else clearTeamProjectSelection();
                                }}
                                disabled={busy}
                                aria-label="Select all team projects"
                              />
                            ) : null}
                          </TableHead>
                          <TableHead>Project</TableHead>
                          <TableHead>Access</TableHead>
                          <TableHead>Source</TableHead>
                          <TableHead className="text-right">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {projectAccessRows.map((row) => (
                          <TableRow key={row.project_id}>
                            <TableCell>
                              {row.isOwner ? null : (
                                <Checkbox
                                  checked={selectedTeamProjectIds.includes(row.project_id)}
                                  onCheckedChange={(checked) =>
                                    toggleTeamProjectSelection(row.project_id, checked === true)
                                  }
                                  disabled={busy}
                                  aria-label={`Select ${row.project_name}`}
                                />
                              )}
                            </TableCell>
                            <TableCell>{row.project_name}</TableCell>
                            <TableCell>{row.access}</TableCell>
                            <TableCell className="text-muted-foreground">{row.source}</TableCell>
                            <TableCell className="text-right">
                              {row.isOwner ? (
                                <span className="text-sm text-muted-foreground">—</span>
                              ) : (
                                <div className="flex flex-wrap items-center justify-end gap-2">
                                  <Select
                                    value={row.project_role as ProjectRole}
                                    disabled={busy}
                                    onValueChange={(value) =>
                                      void handleProjectRoleChange(
                                        row.project_id,
                                        value as ProjectRole,
                                      )
                                    }
                                  >
                                    <SelectTrigger className="w-[140px]">
                                      <SelectValue placeholder="Change role" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {ASSIGNABLE_TEAM_ROLES.map((value) => (
                                        <SelectItem key={value} value={value}>
                                          {PROJECT_ROLE_LABELS[value]}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={busy}
                                    onClick={() =>
                                      void handleProjectRoleChange(row.project_id, "none")
                                    }
                                  >
                                    Remove access
                                  </Button>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </Panel>

              <Dialog
                open={addProjectOpen}
                onOpenChange={(open) => {
                  setAddProjectOpen(open);
                  if (!open) resetAddProjectForm();
                }}
              >
                <DialogContent className="sm:max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Manage project access</DialogTitle>
                    <DialogDescription>
                      Select one or more projects, then assign a team role. Owned projects are
                      excluded and cannot be changed here.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-2">
                    <div className="space-y-2">
                      <Label htmlFor="bulk-project-search">Search projects</Label>
                      <Input
                        id="bulk-project-search"
                        placeholder="Search by name…"
                        value={bulkProjectSearch}
                        onChange={(event) => setBulkProjectSearch(event.target.value)}
                        disabled={busy}
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy || filteredBulkProjectOptions.length === 0}
                        onClick={selectAllBulkProjects}
                      >
                        Select all
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy || bulkSelectedProjectIds.length === 0}
                        onClick={clearAllBulkProjects}
                      >
                        Clear all
                      </Button>
                      <span className="text-muted-foreground">
                        {bulkSelectedProjectIds.length} selected
                      </span>
                    </div>
                    <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
                      {filteredBulkProjectOptions.length === 0 ? (
                        <p className="px-2 py-4 text-sm text-muted-foreground">
                          No assignable projects match your search.
                        </p>
                      ) : (
                        filteredBulkProjectOptions.map((project) => (
                          <label
                            key={project.id}
                            className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/50"
                          >
                            <Checkbox
                              checked={bulkSelectedProjectIds.includes(project.id)}
                              onCheckedChange={(checked) =>
                                toggleBulkProject(project.id, checked === true)
                              }
                              disabled={busy}
                            />
                            <span className="flex-1 text-sm">
                              <span className="font-medium">{project.name}</span>
                              {project.currentTeamRole ? (
                                <span className="ml-2 text-xs text-muted-foreground">
                                  Current: {PROJECT_ROLE_LABELS[project.currentTeamRole]}
                                </span>
                              ) : (
                                <span className="ml-2 text-xs text-muted-foreground">
                                  No team access
                                </span>
                              )}
                            </span>
                          </label>
                        ))
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="bulk-project-role">Team role for selected projects</Label>
                      <Select
                        value={bulkProjectRole}
                        onValueChange={(value) => setBulkProjectRole(value as ProjectRole)}
                        disabled={busy}
                      >
                        <SelectTrigger id="bulk-project-role">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ASSIGNABLE_TEAM_ROLES.map((value) => (
                            <SelectItem key={value} value={value}>
                              {PROJECT_ROLE_LABELS[value]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => setAddProjectOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      disabled={busy || bulkSelectedProjectIds.length === 0}
                      onClick={() => void handleBulkProjectAccessSave()}
                    >
                      Save access
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </TabsContent>

            <TabsContent value="features" className="space-y-4">
              {effective.platform_admin ? (
                <AlertBanner
                  tone="info"
                  title="Platform admin"
                  detail="All features resolve to Write for this user. Per-feature customization does not apply while platform admin is granted."
                />
              ) : null}
              <Panel title="Feature access" eyebrow="effective">
                <p className="mb-4 text-sm text-muted-foreground">
                  Feature access applies globally for this user. Effective use in a project still
                  requires project membership — both dimensions must allow access.
                </p>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Feature</TableHead>
                        <TableHead>Effective access</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead className="text-right">Control</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {FEATURE_KEYS.map((featureKey) => {
                        const row = globalFeatureAccessRow(effective, featureKey);
                        const isCustomizing = customizingFeature === featureKey;

                        return (
                          <TableRow key={featureKey}>
                            <TableCell>{featureKeyLabel(featureKey)}</TableCell>
                            <TableCell>{formatAccessLevel(row.effectiveLevel)}</TableCell>
                            <TableCell className="text-muted-foreground">{row.source}</TableCell>
                            <TableCell className="text-right">
                              {effective.platform_admin ? (
                                <span className="text-sm text-muted-foreground">—</span>
                              ) : isCustomizing ? (
                                <Select
                                  defaultValue={row.controlValue}
                                  onValueChange={(value) =>
                                    void handleFeatureCustomize(
                                      featureKey,
                                      value as FeatureAccessControl,
                                    )
                                  }
                                >
                                  <SelectTrigger className="ml-auto w-[180px]">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="inherit">
                                      {FEATURE_CONTROL_LABELS.inherit}
                                    </SelectItem>
                                    <SelectItem value="none">
                                      {FEATURE_CONTROL_LABELS.none}
                                    </SelectItem>
                                    <SelectItem value="read">
                                      {FEATURE_CONTROL_LABELS.read}
                                    </SelectItem>
                                    <SelectItem value="write">
                                      {FEATURE_CONTROL_LABELS.write}
                                    </SelectItem>
                                  </SelectContent>
                                </Select>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={busy}
                                  onClick={() => setCustomizingFeature(featureKey)}
                                >
                                  Customize
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                <p className="mt-4 text-xs text-muted-foreground">
                  Default / Inherited uses standard product defaults for active users. Per-project
                  legacy overrides still cap access inside assigned projects when no global override
                  is set.
                </p>
              </Panel>
            </TabsContent>

            <TabsContent value="credentials" className="space-y-4">
              {effective.platform_admin ? (
                <AlertBanner
                  tone="info"
                  title="Platform admin"
                  detail="Effective Manage access to all portal credentials. Explicit grant rows are not required while this role is active."
                />
              ) : null}

              <Panel title="Portal credential access" eyebrow="grants">
                {effective.platform_admin ? (
                  credentialGrants.length > 0 ? (
                    <>
                      <p className="mb-4 text-sm text-muted-foreground">
                        Explicit grants below apply if platform admin is revoked. They do not
                        change effective access while platform admin is active.
                      </p>
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Credential</TableHead>
                              <TableHead>Explicit access</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {credentialGrants.map((row) => (
                              <TableRow key={row.credential_id}>
                                <TableCell>{credentialDisplayLabel(row)}</TableCell>
                                <TableCell>{CREDENTIAL_GRANT_DISPLAY[row.grant_level]}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No explicit credential grant rows. Effective access is Manage for all portal
                      credentials.
                    </p>
                  )
                ) : (
                  <>
                    <p className="mb-4 text-sm text-muted-foreground">
                      Portal login access is grant-based. Users need explicit Use or Manage grants
                      unless they are platform admins.
                    </p>
                    {credentialGrants.length > 0 ? (
                      <div className="mb-4 flex justify-end">
                        <Button
                          disabled={busy || portalCredentialsLoading || grantableCredentials.length === 0}
                          onClick={() => {
                            setAddCredentialId("");
                            setAddCredentialLevel("use");
                            setCredentialSearch("");
                            setAddCredentialOpen(true);
                          }}
                        >
                          <Plus className="mr-2 h-4 w-4" />
                          Add credential access
                        </Button>
                      </div>
                    ) : null}
                    {credentialGrants.length === 0 ? (
                      <div className="rounded-lg border border-dashed p-8 text-center">
                        <p className="text-sm text-muted-foreground">No credential access assigned.</p>
                        <Button
                          className="mt-4"
                          disabled={busy || portalCredentialsLoading || grantableCredentials.length === 0}
                          onClick={() => {
                            setAddCredentialId("");
                            setAddCredentialLevel("use");
                            setCredentialSearch("");
                            setAddCredentialOpen(true);
                          }}
                        >
                          <Plus className="mr-2 h-4 w-4" />
                          Add credential access
                        </Button>
                        {!portalCredentialsLoading && grantableCredentials.length === 0 ? (
                          <p className="mt-3 text-xs text-muted-foreground">
                            No additional portal credentials are available to assign.
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Credential</TableHead>
                              <TableHead>Access</TableHead>
                              <TableHead className="text-right">Action</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {credentialGrants.map((row) => (
                              <TableRow key={row.credential_id}>
                                <TableCell>{credentialDisplayLabel(row)}</TableCell>
                                <TableCell>
                                  <Select
                                    value={row.grant_level}
                                    disabled={busy}
                                    onValueChange={(value) =>
                                      void handleCredentialGrantChange(
                                        row.credential_id,
                                        value as CredentialGrantLevel,
                                      )
                                    }
                                  >
                                    <SelectTrigger className="w-[220px]">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="manage">
                                        {CREDENTIAL_GRANT_DISPLAY.manage}
                                      </SelectItem>
                                      <SelectItem value="use">
                                        {CREDENTIAL_GRANT_DISPLAY.use}
                                      </SelectItem>
                                    </SelectContent>
                                  </Select>
                                </TableCell>
                                <TableCell className="text-right">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-destructive"
                                    disabled={busy}
                                    onClick={() =>
                                      setConfirmAction({
                                        type: "revoke_credential",
                                        credentialId: row.credential_id,
                                      })
                                    }
                                  >
                                    Remove access
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </>
                )}
              </Panel>

              {!effective.platform_admin ? (
                <Dialog
                  open={addCredentialOpen}
                  onOpenChange={(open) => {
                    setAddCredentialOpen(open);
                    if (!open) {
                      setAddCredentialId("");
                      setAddCredentialLevel("use");
                      setCredentialSearch("");
                    }
                  }}
                >
                  <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                      <DialogTitle>Add credential access</DialogTitle>
                      <DialogDescription>
                        Select an existing portal credential and assign Use or Manage access.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                      <div className="space-y-2">
                        <Label htmlFor="credential-search">Search credentials</Label>
                        <Input
                          id="credential-search"
                          placeholder="Search jurisdiction or username…"
                          value={credentialSearch}
                          onChange={(event) => setCredentialSearch(event.target.value)}
                          disabled={busy}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="credential-id">Credential</Label>
                        <Select
                          value={addCredentialId}
                          onValueChange={setAddCredentialId}
                          disabled={busy || grantableCredentials.length === 0}
                        >
                          <SelectTrigger id="credential-id">
                            <SelectValue placeholder="Select credential…" />
                          </SelectTrigger>
                          <SelectContent>
                            {grantableCredentials.map((credential) => (
                              <SelectItem key={credential.id} value={credential.id}>
                                {portalCredentialLabel(credential)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="credential-level">Access level</Label>
                        <Select
                          value={addCredentialLevel}
                          onValueChange={(value) =>
                            setAddCredentialLevel(value as CredentialGrantLevel)
                          }
                          disabled={busy}
                        >
                          <SelectTrigger id="credential-level">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="use">{CREDENTIAL_GRANT_DISPLAY.use}</SelectItem>
                            <SelectItem value="manage">
                              {CREDENTIAL_GRANT_DISPLAY.manage}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" disabled={busy} onClick={() => setAddCredentialOpen(false)}>
                        Cancel
                      </Button>
                      <Button
                        disabled={busy || !addCredentialId}
                        onClick={() => void handleAddCredentialAccess()}
                      >
                        Add access
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              ) : null}
            </TabsContent>
          </Tabs>
        </>
      ) : null}

      <AdminConfirmDialog
        open={confirmAction != null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
        title={
          confirmAction?.type === "deactivate"
            ? "Deactivate user"
            : confirmAction?.type === "revoke_admin"
              ? "Revoke platform admin"
              : "Remove credential access"
        }
        description="This is a high-risk governance action. All credential grants will be set to none when deactivating."
        confirmLabel={
          confirmAction?.type === "deactivate"
            ? "Deactivate"
            : confirmAction?.type === "revoke_admin"
              ? "Revoke admin"
              : "Remove access"
        }
        onConfirm={handleConfirmDestructive}
      />

      <div className="mt-6">
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin/access/users">
            <UserCog className="mr-2 h-4 w-4" />
            Back to directory
          </Link>
        </Button>
      </div>
    </AdminPageShell>
  );
}
