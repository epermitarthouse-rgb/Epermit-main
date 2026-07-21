import { Link, useLocation } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import {
  Building2,
  ChevronDown,
  Clock,
  KeyRound,
  LogIn,
  Menu,
  Star,
  X,
} from "lucide-react";
import { useSelectedProjectOptional } from "@/contexts/SelectedProjectContext";
import { useProjects } from "@/hooks/useProjects";
import { supabase } from "@/lib/supabase";
import { isProjectDoxUrl } from "@/lib/portalView";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useRequireAdmin } from "@/hooks/useRequireAdmin";
import { useNavigationHistory } from "@/hooks/useRecentlyUsed";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { hybridNavGroups, type HybridNavItem } from "@/components/layout/hybridNav";

const PERMIT_NUMBER_STORAGE_KEY_PREFIX = "epermit:permitNumber";

const SIDEBAR_FIELD_CLASS =
  "h-9 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm text-foreground outline-none transition-all placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring/25 dark:border-sidebar-border dark:bg-sidebar dark:text-sidebar-foreground";

export function AppSidebar() {
  const location = useLocation();
  const { user } = useAuth();
  const { isAdmin } = useRequireAdmin();
  const { state } = useSidebar();
  const { recentPages, favorites, toggleFavorite, isFavorite } =
    useNavigationHistory();
  const selectedProject = useSelectedProjectOptional();
  const { projects, loading, updateProject, fetchProjects, createProject } =
    useProjects();
  const isCollapsed = state === "collapsed";

  const [sidebarCredentials, setSidebarCredentials] = useState<
    {
      id: string;
      jurisdiction: string;
      portal_username: string;
      login_url?: string;
    }[]
  >([]);
  const [selectedCredentialId, setSelectedCredentialId] = useState<string>("");

  const fetchSidebarCredentials = useCallback(async () => {
    if (!user) {
      setSidebarCredentials([]);
      return;
    }
    const { data, error } = await supabase
      .from("portal_credentials")
      .select("id, jurisdiction, portal_username, login_url")
      .eq("user_id", user.id)
      .order("jurisdiction", { ascending: true });
    if (error) {
      console.error("[AppSidebar] Failed to load portal credentials:", error);
      return;
    }
    setSidebarCredentials(data || []);
  }, [user]);

  useEffect(() => {
    void fetchSidebarCredentials();
  }, [fetchSidebarCredentials, location.pathname]);

  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`portal_credentials_sidebar_${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "portal_credentials",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          void fetchSidebarCredentials();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user?.id, fetchSidebarCredentials]);

  useEffect(() => {
    if (!selectedProject?.selectedProjectId) {
      setSelectedCredentialId("");
      return;
    }
    if (loading) return;
    const p = projects.find(
      (pr) => pr.id === selectedProject.selectedProjectId,
    );
    if (!p) return;
    const cid = p.credential_id;
    setSelectedCredentialId(cid ? String(cid) : "");
  }, [selectedProject?.selectedProjectId, projects, loading]);

  const detectPortalTypeFromUrl = (
    url?: string | null,
  ): "accela" | "projectdox" | "unknown" => {
    if (!url) return "unknown";
    if (isProjectDoxUrl(url)) return "projectdox";
    const lower = url.toLowerCase();
    if (lower.includes("accela.com")) return "accela";
    return "unknown";
  };

  const handleCredentialChange = useCallback(
    async (value: string) => {
      const credId = value === "__none__" ? null : value;
      const previousValue = selectedCredentialId;
      setSelectedCredentialId(credId ?? "");

      if (!selectedProject?.selectedProjectId || !user) return;

      const updated = await updateProject(selectedProject.selectedProjectId, {
        credential_id: credId,
      });

      if (!updated) {
        setSelectedCredentialId(previousValue);
        toast.error("Failed to update credential");
        return;
      }

      const { data: proj } = await supabase
        .from("projects")
        .select("portal_data, portal_status, last_checked_at")
        .eq("id", selectedProject.selectedProjectId)
        .eq("user_id", user.id)
        .maybeSingle();

      const existingType = (proj?.portal_data as { portalType?: string } | null)?.portalType || "unknown";
      const newCred = sidebarCredentials.find((c) => c.id === credId);
      const expectedType = detectPortalTypeFromUrl(newCred?.login_url);

      const shouldClear =
        !!proj?.portal_data &&
        expectedType !== "unknown" &&
        existingType !== "unknown" &&
        existingType !== expectedType;

      if (shouldClear) {
        await supabase
          .from("projects")
          .update({
            portal_data: null,
            portal_status: null,
            last_checked_at: null,
          })
          .eq("id", selectedProject.selectedProjectId);
      }

      fetchProjects();
    },
    [
      selectedProject?.selectedProjectId,
      user,
      updateProject,
      fetchProjects,
      selectedCredentialId,
      sidebarCredentials,
    ],
  );

  const [permitNumber, setPermitNumber] = useState("");
  const [createNewProject, setCreateNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectJurisdiction, setNewProjectJurisdiction] = useState("");
  const [newProjectAddress, setNewProjectAddress] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);

  const selectedProjectData = selectedProject?.selectedProjectId
    ? projects.find((p) => p.id === selectedProject.selectedProjectId)
    : null;

  useEffect(() => {
    if (!user) {
      setPermitNumber("");
      return;
    }
    try {
      const key = `${PERMIT_NUMBER_STORAGE_KEY_PREFIX}:${user.id}`;
      const raw = localStorage.getItem(key);
      setPermitNumber(raw ?? "");
    } catch {
      setPermitNumber("");
    }
  }, [user?.id]);

  const persistPermitNumber = useCallback(
    (value: string) => {
      if (!user) return;
      try {
        const key = `${PERMIT_NUMBER_STORAGE_KEY_PREFIX}:${user.id}`;
        const trimmed = value.trim();
        if (trimmed === "") localStorage.removeItem(key);
        else localStorage.setItem(key, trimmed);
      } catch {
        // ignore
      }
    },
    [user?.id],
  );

  useEffect(() => {
    if (!selectedProjectData) return;
    const projectPermit = String(
      selectedProjectData.permit_number ?? "",
    ).trim();
    if (projectPermit && !permitNumber.trim()) {
      setPermitNumber(projectPermit);
      persistPermitNumber(projectPermit);
    }
  }, [selectedProjectData?.id, selectedProjectData?.permit_number]);

  const handleSelectValueChange = useCallback(
    (v: string) => {
      if (!selectedProject) return;
      if (v === "__none__") {
        selectedProject.setSelectedProjectId(null);
        return;
      }
      selectedProject.setSelectedProjectId(v);
    },
    [selectedProject],
  );

  const handleCreateNewProject = useCallback(async () => {
    const trimmed = permitNumber.trim();
    if (!trimmed || !selectedProject || !user) {
      toast.error("Enter a permit number first");
      return;
    }
    setCreatingProject(true);
    try {
      const name = newProjectName.trim() || trimmed;
      const newProject = await createProject({
        name,
        permit_number: trimmed,
        jurisdiction: newProjectJurisdiction.trim() || undefined,
        address: newProjectAddress.trim() || undefined,
      });
      if (newProject) {
        selectedProject.setSelectedProjectId(newProject.id);
        setCreateNewProject(false);
        setNewProjectName("");
        setNewProjectJurisdiction("");
        setNewProjectAddress("");
        fetchProjects();
        toast.success("Project created and linked");
      }
    } finally {
      setCreatingProject(false);
    }
  }, [
    permitNumber,
    newProjectName,
    newProjectJurisdiction,
    newProjectAddress,
    selectedProject,
    user,
    createProject,
    fetchProjects,
  ]);

  const handlePermitBlur = useCallback(() => {
    persistPermitNumber(permitNumber);
  }, [permitNumber, persistPermitNumber]);

  useEffect(() => {
    if (createNewProject && permitNumber.trim())
      setNewProjectName(permitNumber.trim());
  }, [createNewProject, permitNumber]);

  const [projectsLoadedOnce, setProjectsLoadedOnce] = useState(false);
  useEffect(() => {
    if (!loading && projects.length > 0) setProjectsLoadedOnce(true);
  }, [loading, projects.length]);

  useEffect(() => {
    if (!selectedProject?.selectedProjectId || loading || !projectsLoadedOnce)
      return;
    if (projects.length === 0) return;
    const exists = projects.some(
      (p) => p.id === selectedProject.selectedProjectId,
    );
    if (!exists) {
      selectedProject.setSelectedProjectId(null);
    }
  }, [
    selectedProject?.selectedProjectId,
    projects,
    loading,
    projectsLoadedOnce,
  ]);

  const isActive = (href: string) => {
    if (href === "/projects") {
      return (
        location.pathname === "/projects" ||
        location.pathname.startsWith("/projects/")
      );
    }
    if (href === "/uci") {
      return location.pathname === "/uci" || location.pathname.startsWith("/uci/");
    }
    return location.pathname === href;
  };

  const NavItem = ({
    item,
    showFavorite = false,
  }: {
    item: HybridNavItem;
    showFavorite?: boolean;
  }) => {
    if (item.requiresAuth && !user) return null;

    const label = item.comingSoon
      ? item.adminPreview
        ? `${item.title} (Preview)`
        : `${item.title} (Coming soon)`
      : item.title;

    return (
      <SidebarMenuItem>
        <SidebarMenuButton
          asChild
          isActive={isActive(item.href)}
          tooltip={label}
        >
          <Link to={item.href}>
            <item.icon />
            <span className="truncate">{item.title}</span>
          </Link>
        </SidebarMenuButton>
        {item.comingSoon ? (
          <SidebarMenuBadge className="border border-border/70 bg-muted/50 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
            {item.adminPreview ? "Preview" : "Soon"}
          </SidebarMenuBadge>
        ) : null}
        {showFavorite && !isCollapsed && (
          <SidebarMenuAction
            onClick={() => toggleFavorite(item.href, item.title)}
            className="opacity-0 transition-opacity group-hover/menu-item:opacity-100"
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  {isFavorite(item.href) ? (
                    <Star className="h-3.5 w-3.5 fill-yellow-500 text-yellow-500" />
                  ) : (
                    <Star className="h-3.5 w-3.5" />
                  )}
                </span>
              </TooltipTrigger>
              <TooltipContent side="right">
                {isFavorite(item.href)
                  ? "Remove from favorites"
                  : "Add to favorites"}
              </TooltipContent>
            </Tooltip>
          </SidebarMenuAction>
        )}
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar collapsible="icon" className="border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border p-4">
        <Link to="/dashboard" className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-primary font-display text-2xl font-semibold text-primary-foreground">
            P
          </span>
          {!isCollapsed && (
            <span className="min-w-0">
              <span className="block font-tight text-lg font-black leading-none tracking-tight text-sidebar-foreground">
                PermitPilot
              </span>
              <span className="pilot-kicker mt-1 block">
                Permit expediting + utility coordination
              </span>
            </span>
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-2 py-4">
        {favorites.length > 0 && (
          <SidebarGroup>
            <Collapsible defaultOpen className="group/collapsible">
              <SidebarGroupLabel asChild>
                <CollapsibleTrigger className="flex w-full items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Star className="h-3.5 w-3.5 fill-yellow-500 text-yellow-500" />
                    Favorites
                  </span>
                  <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-180" />
                </CollapsibleTrigger>
              </SidebarGroupLabel>
              <CollapsibleContent>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {favorites.map((page) => (
                      <SidebarMenuItem
                        key={page.href}
                        className="group/menu-item"
                      >
                        <SidebarMenuButton
                          asChild
                          isActive={isActive(page.href)}
                          tooltip={page.title}
                        >
                          <Link to={page.href}>
                            <Star className="h-4 w-4 fill-yellow-500 text-yellow-500" />
                            <span>{page.title}</span>
                          </Link>
                        </SidebarMenuButton>
                        {!isCollapsed && (
                          <SidebarMenuAction
                            onClick={() => toggleFavorite(page.href)}
                            className="opacity-0 transition-opacity group-hover/menu-item:opacity-100"
                          >
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span>
                                  <X className="h-3.5 w-3.5" />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="right">
                                Remove
                              </TooltipContent>
                            </Tooltip>
                          </SidebarMenuAction>
                        )}
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </Collapsible>
          </SidebarGroup>
        )}

        {recentPages.length > 1 && (
          <SidebarGroup>
            <Collapsible defaultOpen={false} className="group/collapsible">
              <SidebarGroupLabel asChild>
                <CollapsibleTrigger className="flex w-full items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    Recent
                  </span>
                  <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-180" />
                </CollapsibleTrigger>
              </SidebarGroupLabel>
              <CollapsibleContent>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {recentPages.slice(1).map((page) => (
                      <SidebarMenuItem
                        key={page.href}
                        className="group/menu-item"
                      >
                        <SidebarMenuButton
                          asChild
                          isActive={isActive(page.href)}
                          tooltip={page.title}
                        >
                          <Link to={page.href}>
                            <Clock className="h-4 w-4" />
                            <span>{page.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </Collapsible>
          </SidebarGroup>
        )}

        {/* Project block: permit-first — preserved PP control surface */}
        {user && selectedProject && (
          <SidebarGroup>
            <SidebarGroupContent>
              {isCollapsed ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <SidebarMenuButton
                      size="lg"
                      tooltip={
                        permitNumber.trim()
                          ? selectedProjectData
                            ? `${selectedProjectData.name} · ${permitNumber.trim()}`
                            : `Permit ${permitNumber.trim()} – Select a project`
                          : "Enter permit number first"
                      }
                    >
                      <Building2 className="h-4 w-4" />
                      <span>{permitNumber.trim() || "—"}</span>
                    </SidebarMenuButton>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    {permitNumber.trim()
                      ? selectedProjectData
                        ? `${selectedProjectData.name} · Permit ${permitNumber.trim()}`
                        : "Select a project below"
                      : "Enter permit number first"}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <div className="mx-1 my-2 rounded-md border border-sidebar-border bg-sidebar-accent p-3">
                  <div className="pilot-kicker">Active project</div>
                  <div className="mt-3 space-y-3">
                    <div className="space-y-1">
                      <Label
                        htmlFor="sidebar-permit-number"
                        className="text-xs text-muted-foreground"
                      >
                        Permit # <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="sidebar-permit-number"
                        placeholder="e.g. B2508799"
                        value={permitNumber}
                        onChange={(e) => setPermitNumber(e.target.value)}
                        onBlur={handlePermitBlur}
                        className={SIDEBAR_FIELD_CLASS}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">
                        Project
                      </Label>
                      <Select
                        value={selectedProject.selectedProjectId ?? "__none__"}
                        onValueChange={handleSelectValueChange}
                        disabled={
                          loading ||
                          (!permitNumber.trim() && projects.length === 0)
                        }
                      >
                        <SelectTrigger
                          className={SIDEBAR_FIELD_CLASS}
                          data-sidebar="select"
                        >
                          <SelectValue placeholder="Select a project" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">
                            Select a project
                          </SelectItem>
                          {projects.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name}
                              {p.permit_number ? ` · ${p.permit_number}` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {sidebarCredentials.length > 0 && (
                      <div className="space-y-1">
                        <Label className="flex items-center gap-1 text-xs text-muted-foreground">
                          <KeyRound className="h-3 w-3 text-primary" />
                          Portal Credential
                        </Label>
                        <Select
                          value={selectedCredentialId || "__none__"}
                          onValueChange={handleCredentialChange}
                        >
                          <SelectTrigger
                            className={SIDEBAR_FIELD_CLASS}
                            data-testid="select-sidebar-credential"
                          >
                            <SelectValue placeholder="Select credential" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">
                              None (select a credential)
                            </SelectItem>
                            {sidebarCredentials.map((cred) => (
                              <SelectItem key={cred.id} value={cred.id}>
                                {cred.jurisdiction}
                                {cred.portal_username
                                  ? ` — ${cred.portal_username}`
                                  : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {!selectedProject.selectedProjectId &&
                      permitNumber.trim() && (
                        <p className="text-xs text-muted-foreground">
                          Select a project above or create one below.
                        </p>
                      )}
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="sidebar-create-new-project"
                        checked={createNewProject}
                        onCheckedChange={(c) => setCreateNewProject(!!c)}
                        disabled={!permitNumber.trim()}
                      />
                      <Label
                        htmlFor="sidebar-create-new-project"
                        className="cursor-pointer text-xs font-normal text-muted-foreground"
                      >
                        Or create a new project for this permit
                      </Label>
                    </div>
                    {createNewProject && (
                      <div className="space-y-2 rounded-md border border-sidebar-border bg-background/40 p-2">
                        <Input
                          placeholder="Project name (default: permit #)"
                          value={newProjectName}
                          onChange={(e) => setNewProjectName(e.target.value)}
                          className={SIDEBAR_FIELD_CLASS}
                        />
                        <Input
                          placeholder="Jurisdiction (optional)"
                          value={newProjectJurisdiction}
                          onChange={(e) =>
                            setNewProjectJurisdiction(e.target.value)
                          }
                          className={SIDEBAR_FIELD_CLASS}
                        />
                        <Input
                          placeholder="Address (optional)"
                          value={newProjectAddress}
                          onChange={(e) => setNewProjectAddress(e.target.value)}
                          className={SIDEBAR_FIELD_CLASS}
                        />
                        <Button
                          size="sm"
                          className="w-full"
                          onClick={handleCreateNewProject}
                          disabled={creatingProject || !permitNumber.trim()}
                        >
                          {creatingProject ? "Creating…" : "Create project"}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {hybridNavGroups.map((group) => {
          if (group.requiresAuth && !user) return null;
          if (group.requiresAdmin && !isAdmin) return null;

          const items = group.items.filter(
            (item) => !item.requiresAuth || !!user,
          );
          if (items.length === 0) return null;

          const useCollapsible = group.defaultOpen === false;

          if (useCollapsible) {
            return (
              <SidebarGroup key={group.label}>
                <Collapsible
                  defaultOpen={false}
                  className="group/collapsible"
                >
                  <SidebarGroupLabel asChild>
                    <CollapsibleTrigger className="flex w-full items-center justify-between">
                      {group.label}
                      <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-180" />
                    </CollapsibleTrigger>
                  </SidebarGroupLabel>
                  <CollapsibleContent>
                    <SidebarGroupContent>
                      <SidebarMenu>
                        {items.map((item) => (
                          <NavItem
                            key={item.href}
                            item={item}
                            showFavorite={group.label === "Command"}
                          />
                        ))}
                      </SidebarMenu>
                    </SidebarGroupContent>
                  </CollapsibleContent>
                </Collapsible>
              </SidebarGroup>
            );
          }

          return (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => (
                    <NavItem
                      key={item.href}
                      item={item}
                      showFavorite={group.label === "Command"}
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3">
        {!isCollapsed ? (
          <div className="rounded-md border border-sidebar-border bg-sidebar-accent p-3">
            <div className="pilot-kicker">Workspace</div>
            <div className="mt-1 font-tight text-sm font-semibold text-sidebar-foreground">
              {user ? user.email ?? "Signed in" : "Guest"}
            </div>
            {!user && (
              <Button asChild size="sm" className="mt-3 w-full" variant="outline">
                <Link to="/auth">
                  <LogIn className="mr-2 h-4 w-4" />
                  Sign In
                </Link>
              </Button>
            )}
          </div>
        ) : (
          <Menu className="mx-auto h-4 w-4 text-sidebar-foreground" />
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
