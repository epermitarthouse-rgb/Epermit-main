import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Copy, Loader2, Shield } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useParams } from "react-router-dom";
import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { AdminPageShell } from "@/components/admin/AdminPageShell";
import { AlertBanner, Panel } from "@/components/design/ProductPrimitives";
import { Button } from "@/components/ui/button";
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
import { useRequireAdmin } from "@/hooks/useRequireAdmin";
import { useAdminApi } from "@/hooks/useAdminApi";
import {
  mapRoleActionToApiAction,
  platformRoleFromUser,
  visibleRoleActions,
  type AdminRoleAction,
} from "@/lib/adminRoleHelpers";
import type { AdminEffectivePermissions } from "@/lib/adminApi";
import {
  buildCredentialAccessRows,
  buildProjectAccessRows,
  credentialAccessSummaryText,
  credentialDisplayLabel,
  CREDENTIAL_GRANT_CONTROL_LABELS,
  dataRestrictionsSummary,
  featureAccessSummary,
  formatAccessLevel,
  formatCredentialGrantLevel,
  formatProjectAccessLevel,
  globalFeatureAccessRow,
  effectivePlatformRoleLabel,
  humanRiskLabel,
  projectAccessSummaryText,
  userIdentityMeta,
  userIdentitySubtitle,
  userIdentityTitle,
} from "@/lib/adminUserDetailHelpers";
import {
  FEATURE_CONTROL_LABELS,
  FEATURE_KEYS,
  PROJECT_ACCESS_CONTROL_LABELS,
  featureKeyLabel,
  type CredentialGrantControl,
  type FeatureAccessControl,
  type ProjectAccessControl,
} from "@/lib/governanceConstants";

type ConfirmAction =
  | { type: "deactivate" }
  | { type: AdminRoleAction };

const PROJECT_ACCESS_CONTROLS: ProjectAccessControl[] = [
  "default",
  "none",
  "read",
  "write",
];

const CREDENTIAL_ACCESS_CONTROLS: CredentialGrantControl[] = [
  "default",
  "none",
  "use",
  "manage",
];

export default function AdminAccessUserDetail() {
  const { userId = "" } = useParams();
  const { user: currentUser } = useAuth();
  const { platformRole: viewerRole } = useRequireAdmin();
  const { toast } = useToast();
  const adminApi = useAdminApi();
  const [effective, setEffective] = useState<AdminEffectivePermissions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [busy, setBusy] = useState(false);

  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [bulkTableAccess, setBulkTableAccess] = useState<ProjectAccessControl>("write");
  const [projectSearch, setProjectSearch] = useState("");
  const [credentialSearch, setCredentialSearch] = useState("");

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const perm = await adminApi.getEffectivePermissions(userId);
      setEffective(perm);
      setSelectedProjectIds((prev) =>
        prev.filter((id) =>
          perm.project_access?.some((project) => project.project_id === id),
        ),
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

  const projectAccessRows = useMemo(
    () => (effective ? buildProjectAccessRows(effective) : []),
    [effective],
  );

  const credentialAccessRows = useMemo(
    () => (effective ? buildCredentialAccessRows(effective) : []),
    [effective],
  );

  const filteredProjectRows = useMemo(() => {
    const query = projectSearch.trim().toLowerCase();
    if (!query) return projectAccessRows;
    return projectAccessRows.filter((row) =>
      (row.project_name ?? row.project_id).toLowerCase().includes(query),
    );
  }, [projectAccessRows, projectSearch]);

  const filteredCredentialRows = useMemo(() => {
    const query = credentialSearch.trim().toLowerCase();
    if (!query) return credentialAccessRows;
    return credentialAccessRows.filter((row) =>
      credentialDisplayLabel(row).toLowerCase().includes(query),
    );
  }, [credentialAccessRows, credentialSearch]);

  const selectableProjectIds = useMemo(
    () => projectAccessRows.filter((row) => !row.is_owner).map((row) => row.project_id),
    [projectAccessRows],
  );

  const toggleProjectSelection = (projectId: string, checked: boolean) => {
    setSelectedProjectIds((prev) => {
      if (checked) {
        return prev.includes(projectId) ? prev : [...prev, projectId];
      }
      return prev.filter((id) => id !== projectId);
    });
  };

  const selectAllProjects = () => {
    setSelectedProjectIds([...selectableProjectIds]);
  };

  const clearProjectSelection = () => {
    setSelectedProjectIds([]);
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

  const targetRole = effective ? platformRoleFromUser(effective) : "user";
  const isSelf = currentUser?.id === userId;
  const isLastSuperAdmin =
    targetRole === "super_admin" && (effective?.risks ?? []).includes("sole_super_admin");
  const roleActions = visibleRoleActions({
    viewerRole,
    targetRole,
    isSelf,
    isLastSuperAdmin,
  });

  const handleConfirmDestructive = async (reason: string) => {
    if (!confirmAction) return;
    if (confirmAction.type === "deactivate") {
      await adminApi.deactivateUser(userId, reason);
      toast({ title: "User deactivated" });
    } else {
      await adminApi.setPlatformRole(
        userId,
        mapRoleActionToApiAction(confirmAction.type),
      );
      toast({ title: "Role updated" });
    }
    await load();
  };

  const handleRoleAction = async (action: AdminRoleAction) => {
    if (action === "deactivate") {
      setConfirmAction({ type: "deactivate" });
      return;
    }
    if (
      action === "revoke-platform-admin" ||
      action === "demote-super-admin" ||
      action === "promote-to-super-admin"
    ) {
      setConfirmAction({ type: action });
      return;
    }
    setBusy(true);
    try {
      await adminApi.setPlatformRole(userId, mapRoleActionToApiAction(action));
      toast({ title: "Role updated" });
      await load();
    } catch (err) {
      toast({
        title: "Role change failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleProjectAccessChange = async (
    projectId: string,
    accessLevel: ProjectAccessControl,
  ) => {
    setBusy(true);
    try {
      await adminApi.setProjectAccess(userId, projectId, accessLevel);
      toast({ title: "Project access updated" });
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

  const handleBulkProjectAccessApply = async () => {
    if (selectedProjectIds.length === 0) return;
    setBusy(true);
    try {
      for (const projectId of selectedProjectIds) {
        await adminApi.setProjectAccess(userId, projectId, bulkTableAccess);
      }
      toast({
        title: "Project access updated",
        description: `${selectedProjectIds.length} project${selectedProjectIds.length === 1 ? "" : "s"} updated.`,
      });
      setSelectedProjectIds([]);
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

  const handleCredentialAccessChange = async (
    credentialId: string,
    control: CredentialGrantControl,
  ) => {
    setBusy(true);
    try {
      if (control === "default") {
        await adminApi.setCredentialGrants(userId, [
          { credential_id: credentialId, grant_level: "default", reset: true },
        ]);
      } else {
        await adminApi.setCredentialGrants(userId, [
          { credential_id: credentialId, grant_level: control },
        ]);
      }
      toast({ title: "Credential access updated" });
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

  const identityTitle = effective ? userIdentityTitle(effective) : "User detail";
  const identitySubtitle = effective ? userIdentitySubtitle(effective) : null;
  const identityMeta = effective ? userIdentityMeta(effective) : null;
  const breadcrumbLabel = effective ? userIdentityTitle(effective) : "User";

  return (
    <AdminPageShell
      variant="editorial"
      title={identityTitle}
      breadcrumbs={[
        { label: "Authorization", href: "/admin/access/users" },
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
            {identitySubtitle ? <p>{identitySubtitle}</p> : null}
            {identityMeta ? <p className="text-muted-foreground">{identityMeta}</p> : null}
            <div className="flex flex-wrap items-center gap-2 pt-1 text-muted-foreground">
              <span>
                User ID:{" "}
                <span className="font-mono text-xs">{effective.user_id}</span>
              </span>
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
                    <dd>{effectivePlatformRoleLabel(effective)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Projects</dt>
                    <dd>{projectAccessSummaryText(effective)}</dd>
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
                    <dd>{credentialAccessSummaryText(effective)}</dd>
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
                {isSelf ? (
                  <p className="mb-3 text-sm text-muted-foreground">
                    You cannot change your own role or deactivate your own account from this
                    screen. Ask another super admin if you need a role change.
                  </p>
                ) : null}
                {isLastSuperAdmin ? (
                  <p className="mb-3 text-sm text-muted-foreground">
                    This is the last active super admin. Demotion and deactivation are blocked
                    until another super admin is assigned.
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {effective.access_status === "deactivated" &&
                  roleActions.includes("activate") ? (
                    <Button disabled={busy} onClick={() => void handleActivate()}>
                      Activate user
                    </Button>
                  ) : null}
                  {effective.access_status !== "deactivated" &&
                  roleActions.includes("deactivate") ? (
                    <Button
                      variant="destructive"
                      disabled={busy}
                      onClick={() => setConfirmAction({ type: "deactivate" })}
                    >
                      Deactivate user
                    </Button>
                  ) : null}
                  {roleActions.includes("grant-platform-admin") ? (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => void handleRoleAction("grant-platform-admin")}
                    >
                      <Shield className="mr-2 h-4 w-4" />
                      Grant Platform Admin
                    </Button>
                  ) : null}
                  {roleActions.includes("promote-to-super-admin") ? (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => void handleRoleAction("promote-to-super-admin")}
                    >
                      <Shield className="mr-2 h-4 w-4" />
                      Promote to Super Admin
                    </Button>
                  ) : null}
                  {roleActions.includes("revoke-platform-admin") ? (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => void handleRoleAction("revoke-platform-admin")}
                    >
                      <Shield className="mr-2 h-4 w-4" />
                      Revoke Platform Admin
                    </Button>
                  ) : null}
                  {roleActions.includes("demote-super-admin") ? (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => void handleRoleAction("demote-super-admin")}
                    >
                      <Shield className="mr-2 h-4 w-4" />
                      Demote Super Admin
                    </Button>
                  ) : null}
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
              <Panel title="Project access" eyebrow="effective">
                <p className="mb-4 text-sm text-muted-foreground">
                  {projectAccessSummaryText(effective)}. Customize individual projects below to
                  restrict or override the default.
                </p>
                <div className="mb-4 flex flex-wrap items-end gap-3">
                  <div className="min-w-[220px] flex-1 space-y-2">
                    <Label htmlFor="project-search">Search projects</Label>
                    <Input
                      id="project-search"
                      placeholder="Search by name…"
                      value={projectSearch}
                      onChange={(event) => setProjectSearch(event.target.value)}
                      disabled={busy}
                    />
                  </div>
                </div>
                {selectedProjectIds.length > 0 ? (
                  <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-3">
                    <span className="text-sm text-muted-foreground">
                      {selectedProjectIds.length} selected
                    </span>
                    <Select
                      value={bulkTableAccess}
                      onValueChange={(value) =>
                        setBulkTableAccess(value as ProjectAccessControl)
                      }
                      disabled={busy}
                    >
                      <SelectTrigger className="w-[160px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PROJECT_ACCESS_CONTROLS.map((value) => (
                          <SelectItem key={value} value={value}>
                            {PROJECT_ACCESS_CONTROL_LABELS[value]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" disabled={busy} onClick={() => void handleBulkProjectAccessApply()}>
                      Apply access
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={selectAllProjects}>
                      Select all
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={clearProjectSelection}>
                      Clear selection
                    </Button>
                  </div>
                ) : null}
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">
                          {selectableProjectIds.length > 0 ? (
                            <Checkbox
                              checked={
                                selectableProjectIds.length > 0 &&
                                selectedProjectIds.length === selectableProjectIds.length
                              }
                              onCheckedChange={(checked) => {
                                if (checked) selectAllProjects();
                                else clearProjectSelection();
                              }}
                              disabled={busy}
                              aria-label="Select all projects"
                            />
                          ) : null}
                        </TableHead>
                        <TableHead>Project</TableHead>
                        <TableHead>Effective access</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead className="text-right">Control</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredProjectRows.map((row) => (
                        <TableRow key={row.project_id}>
                          <TableCell>
                            {row.is_owner ? null : (
                              <Checkbox
                                checked={selectedProjectIds.includes(row.project_id)}
                                onCheckedChange={(checked) =>
                                  toggleProjectSelection(row.project_id, checked === true)
                                }
                                disabled={busy}
                                aria-label={`Select ${row.project_name}`}
                              />
                            )}
                          </TableCell>
                          <TableCell>{row.project_name ?? row.project_id.slice(0, 8) + "…"}</TableCell>
                          <TableCell>{formatProjectAccessLevel(row.effective_access)}</TableCell>
                          <TableCell className="text-muted-foreground">{row.source}</TableCell>
                          <TableCell className="text-right">
                            {row.is_owner ? (
                              <span className="text-sm text-muted-foreground">—</span>
                            ) : (
                              <Select
                                value={(row.control as ProjectAccessControl) || "default"}
                                disabled={busy || effective.platform_admin}
                                onValueChange={(value) =>
                                  void handleProjectAccessChange(
                                    row.project_id,
                                    value as ProjectAccessControl,
                                  )
                                }
                              >
                                <SelectTrigger className="ml-auto w-[160px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {PROJECT_ACCESS_CONTROLS.map((value) => (
                                    <SelectItem key={value} value={value}>
                                      {PROJECT_ACCESS_CONTROL_LABELS[value]}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </Panel>
            </TabsContent>

            <TabsContent value="features" className="space-y-4">
              {effective.platform_admin ? (
                <AlertBanner
                  tone="info"
                  title={
                    targetRole === "super_admin" ? "Super Admin" : "Platform Admin"
                  }
                  detail="All features resolve to Write for this user. Per-feature customization does not apply while platform admin is granted."
                />
              ) : null}
              <Panel title="Feature access" eyebrow="effective">
                <p className="mb-4 text-sm text-muted-foreground">
                  {featureAccessSummary(effective)}. Admin-only dashboard tools remain gated by
                  platform admin — they are not listed here.
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

                        return (
                          <TableRow key={featureKey}>
                            <TableCell>{featureKeyLabel(featureKey)}</TableCell>
                            <TableCell>{formatAccessLevel(row.effectiveLevel)}</TableCell>
                            <TableCell className="text-muted-foreground">{row.source}</TableCell>
                            <TableCell className="text-right">
                              {effective.platform_admin ? (
                                <span className="text-sm text-muted-foreground">—</span>
                              ) : (
                                <Select
                                  value={row.controlValue}
                                  disabled={busy}
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
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                <p className="mt-4 text-xs text-muted-foreground">
                  Default uses standard product defaults for active users. Set an explicit level to
                  create an exception for this user.
                </p>
              </Panel>
            </TabsContent>

            <TabsContent value="credentials" className="space-y-4">
              {effective.platform_admin ? (
                <AlertBanner
                  tone="info"
                  title={
                    targetRole === "super_admin" ? "Super Admin" : "Platform Admin"
                  }
                  detail="Effective Manage access to all portal credentials. Overrides below apply if platform admin is revoked."
                />
              ) : null}

              <Panel title="Portal credential access" eyebrow="effective">
                <p className="mb-4 text-sm text-muted-foreground">
                  {credentialAccessSummaryText(effective)}. Customize individual credentials below
                  to restrict or elevate access.
                </p>
                <div className="mb-4 flex flex-wrap items-end gap-3">
                  <div className="min-w-[220px] flex-1 space-y-2">
                    <Label htmlFor="credential-search">Search credentials</Label>
                    <Input
                      id="credential-search"
                      placeholder="Search jurisdiction or username…"
                      value={credentialSearch}
                      onChange={(event) => setCredentialSearch(event.target.value)}
                      disabled={busy}
                    />
                  </div>
                </div>
                {filteredCredentialRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No portal credentials are configured in this environment.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Credential</TableHead>
                          <TableHead>Portal / jurisdiction</TableHead>
                          <TableHead>Effective access</TableHead>
                          <TableHead>Source</TableHead>
                          <TableHead className="text-right">Control</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredCredentialRows.map((row) => (
                          <TableRow key={row.credential_id}>
                            <TableCell>{credentialDisplayLabel(row)}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {row.jurisdiction?.trim() || "—"}
                            </TableCell>
                            <TableCell>{formatCredentialGrantLevel(row.effective_access)}</TableCell>
                            <TableCell className="text-muted-foreground">{row.source}</TableCell>
                            <TableCell className="text-right">
                              <Select
                                value={(row.control as CredentialGrantControl) || "default"}
                                disabled={busy}
                                onValueChange={(value) =>
                                  void handleCredentialAccessChange(
                                    row.credential_id,
                                    value as CredentialGrantControl,
                                  )
                                }
                              >
                                <SelectTrigger className="ml-auto w-[160px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {CREDENTIAL_ACCESS_CONTROLS.map((value) => (
                                    <SelectItem key={value} value={value}>
                                      {CREDENTIAL_GRANT_CONTROL_LABELS[value]}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </Panel>
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
            : confirmAction?.type === "demote-super-admin"
              ? "Demote super admin"
              : confirmAction?.type === "promote-to-super-admin"
                ? "Promote to super admin"
                : "Change platform role"
        }
        description="This is a high-risk governance action."
        confirmLabel={
          confirmAction?.type === "deactivate"
            ? "Deactivate"
            : confirmAction?.type === "demote-super-admin"
              ? "Demote"
              : confirmAction?.type === "promote-to-super-admin"
                ? "Promote"
                : "Confirm"
        }
        onConfirm={handleConfirmDestructive}
      />

    </AdminPageShell>
  );
}
