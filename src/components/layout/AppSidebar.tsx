import { Link, useLocation } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import {
  Home,
  Shield,
  BookOpen,
  PlayCircle,
  DollarSign,
  LogIn,
  LayoutDashboard,
  Map,
  Calculator,
  Scale,
  BarChart3,
  FileText,
  Building2,
  Search,
  Globe,
  Settings as SettingsIcon,
  ChevronDown,
  HelpCircle,
  FileQuestion,
  MessageSquare,
  Clock,
  Star,
  X,
  Table2,
  KeyRound,
  Rocket,
  FileSearch,
  Tags,
  Layers,
  Flag,
} from "lucide-react";
import { useSelectedProjectOptional } from "@/contexts/SelectedProjectContext";
import { useProjects } from "@/hooks/useProjects";
import { supabase } from "@/lib/supabase";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useRequireAdmin } from "@/hooks/useRequireAdmin";
import { useNavigationHistory } from "@/hooks/useRecentlyUsed";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { ThemeToggle } from "@/components/ThemeToggle";
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
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuAction,
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

const PERMIT_NUMBER_STORAGE_KEY_PREFIX = "epermit:permitNumber";

const mainNavigation = [
  {
    title: "Home",
    href: "/",
    icon: Home,
  },
  {
    title: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    requiresAuth: true,
  },
];

const intakeNavigation = [
  {
    title: "Permit Filing",
    href: "/permit-wizard-filing",
    icon: Rocket,
    description: "Multi-municipality filing pipeline",
    requiresAuth: true,
  },
  {
    title: "Portal Harvest",
    href: "/portal-data",
    icon: Globe,
    description: "Gather (Scrape) & View Portal Data",
    requiresAuth: true,
  },
  {
    title: "Baltimore Portal",
    href: "/baltimore",
    icon: Building2,
    description: "Accela portal clone (Permits & Inspections)",
    requiresAuth: true,
  },
  {
    title: "Comment Review",
    href: "/comment-review",
    icon: FileSearch,
    description: "Review scraped & uploaded comments",
    requiresAuth: true,
  },
  {
    title: "Classified Comments",
    href: "/classified-comments",
    icon: Tags,
    description: "AI-classified discipline comments",
    requiresAuth: true,
  },
  {
    title: "AI Compliance",
    href: "/code-compliance",
    icon: Shield,
    description: "Check code compliance",
    requiresAuth: true,
  },
];

const responseNavigation = [
  {
    title: "Response Matrix",
    href: "/response-matrix",
    icon: Table2,
    description: "Manage comment responses",
    requiresAuth: true,
  },
];

const trackingNavigation = [
  {
    title: "Projects",
    href: "/projects",
    icon: Building2,
    requiresAuth: true,
  },
];

const intelligenceNavigation = [
  {
    title: "Permit Intelligence",
    href: "/permit-intelligence",
    icon: Search,
    description: "Search permit data",
  },
  {
    title: "Code Library",
    href: "/code-reference",
    icon: BookOpen,
    description: "Reference materials",
  },
];

const resourcesNavigation = [
  {
    title: "ROI Calculator",
    href: "/roi-calculator",
    icon: Calculator,
    description: "Calculate savings",
  },
  {
    title: "Tool Consolidation",
    href: "/consolidation-calculator",
    icon: Layers,
    description: "Compare tool costs",
  },
  {
    title: "Analytics & Reporting",
    href: "/analytics",
    icon: BarChart3,
    description: "Reports & metrics",
  },
  {
    title: "Jurisdiction Map",
    href: "/jurisdictions/map",
    icon: Map,
    description: "Interactive coverage map",
  },
  {
    title: "Compare Jurisdictions",
    href: "/jurisdictions/compare",
    icon: Scale,
    description: "Side-by-side comparison",
  },
  {
    title: "Checklists",
    href: "/checklist-history",
    icon: FileText,
    description: "View saved checklists",
    requiresAuth: true,
  },
  {
    title: "Demos",
    href: "/demos",
    icon: PlayCircle,
  },
  {
    title: "Pricing",
    href: "/pricing",
    icon: DollarSign,
  },
];

const helpNavigation = [
  {
    title: "Documentation",
    href: "/api-docs",
    icon: FileQuestion,
    description: "API docs & guides",
  },
  {
    title: "FAQ",
    href: "/faq",
    icon: HelpCircle,
    description: "Common questions",
  },
  {
    title: "Contact Support",
    href: "/contact",
    icon: MessageSquare,
    description: "Get help from our team",
  },
];

const adminNavigation = [
  { title: "Overview", href: "/admin", icon: Shield, description: "Admin home" },
  { title: "Jurisdictions", href: "/admin/jurisdictions", icon: Building2, description: "Manage jurisdictions" },
  { title: "Feature Flags", href: "/admin/feature-flags", icon: Flag, description: "Toggle features" },
  { title: "Shadow Mode", href: "/admin/shadow-mode", icon: Shield, description: "AI pipeline metrics" },
];

export function AppSidebar() {
  const location = useLocation();
  const { user } = useAuth();
  const { isAdmin } = useRequireAdmin();
  const { state } = useSidebar();
  const { recentPages, favorites, toggleFavorite, isFavorite, clearRecent } =
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

  useEffect(() => {
    if (!user) {
      setSidebarCredentials([]);
      return;
    }
    supabase
      .from("portal_credentials")
      .select("id, jurisdiction, portal_username, login_url")
      .eq("user_id", user.id)
      .order("jurisdiction", { ascending: true })
      .then(({ data }) => setSidebarCredentials(data || []));
  }, [user?.id]);

  useEffect(() => {
    if (!selectedProject?.selectedProjectId || loading || projects.length === 0)
      return;
    const p = projects.find(
      (pr) => pr.id === selectedProject.selectedProjectId,
    );
    setSelectedCredentialId((p as any)?.credential_id ?? "");
  }, [selectedProject?.selectedProjectId, projects, loading]);

  const detectPortalTypeFromUrl = (
    url?: string | null,
  ): "accela" | "projectdox" | "unknown" => {
    const lower = (url || "").toLowerCase();
    if (lower.includes("avolvecloud.com") || lower.includes("projectdox"))
      return "projectdox";
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

      // Read existing saved portal_data on this project
      const { data: proj } = await supabase
        .from("projects")
        .select("portal_data, portal_status, last_checked_at")
        .eq("id", selectedProject.selectedProjectId)
        .eq("user_id", user.id)
        .maybeSingle();

      const existingType = (proj?.portal_data as any)?.portalType || "unknown";

      const newCred = sidebarCredentials.find((c: any) => c.id === credId);
      const expectedType = detectPortalTypeFromUrl(newCred?.login_url);

      // Only clear if we are confident the saved data belongs to a different portal type
      const shouldClear =
        !!proj?.portal_data &&
        expectedType !== "unknown" &&
        existingType !== "unknown" &&
        existingType !== expectedType;

      if (import.meta.env.DEV) {
        console.log("[Sidebar] credential change:", {
          projectId: selectedProject.selectedProjectId,
          previousCredentialId: previousValue || null,
          nextCredentialId: credId,
          existingPortalType: existingType,
          expectedPortalType: expectedType,
          shouldClear,
        });
      }

      if (shouldClear) {
        await supabase
          .from("projects")
          .update({
            portal_data: null,
            portal_status: null,
            last_checked_at: null,
          })
          .eq("id", selectedProject.selectedProjectId);

        if (import.meta.env.DEV) {
          console.log(
            "[Sidebar] Cleared saved portal data because portal type mismatched new credential",
          );
        }
      } else {
        if (import.meta.env.DEV) {
          console.log(
            "[Sidebar] Preserved saved portal data on credential change",
          );
        }
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

  // Permit number is the primary input; persisted per user. Never derived from project.
  const [permitNumber, setPermitNumber] = useState("");
  const [savingLink, setSavingLink] = useState(false);
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

  useEffect(() => {
    if (!selectedProjectData) return;
    const projectPermit = selectedProjectData.permit_number;
    if (projectPermit && projectPermit.trim() && !permitNumber.trim()) {
      setPermitNumber(projectPermit.trim());
      persistPermitNumber(projectPermit.trim());
    }
  }, [selectedProjectData?.id, selectedProjectData?.permit_number]);

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

  // When user selects an existing project: set project's permit_number to current permit and persist selection (already done by setSelectedProjectId)
  const handleLinkProject = useCallback(
    (projectId: string) => {
      if (!selectedProject) return;
      selectedProject.setSelectedProjectId(projectId);
    },
    [selectedProject],
  );

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

  // When permit number input blurs: persist to localStorage and sync to linked project if one is selected
  const handlePermitBlur = useCallback(() => {
    persistPermitNumber(permitNumber);
  }, [permitNumber, persistPermitNumber]);
  // Prefill new project name when permit changes and create form is open
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

  const isActive = (href: string) => location.pathname === href;

  const NavItem = ({
    item,
    showFavorite = false,
  }: {
    item: {
      title: string;
      href: string;
      icon: React.ElementType;
      description?: string;
      requiresAuth?: boolean;
    };
    showFavorite?: boolean;
  }) => {
    if (item.requiresAuth && !user) return null;

    return (
      <SidebarMenuItem>
        <SidebarMenuButton
          asChild
          isActive={isActive(item.href)}
          tooltip={item.title}
        >
          <Link to={item.href}>
            <item.icon className="h-4 w-4" />
            <span>{item.title}</span>
          </Link>
        </SidebarMenuButton>
        {showFavorite && !isCollapsed && (
          <SidebarMenuAction
            onClick={() => toggleFavorite(item.href, item.title)}
            className="opacity-0 group-hover/menu-item:opacity-100 transition-opacity"
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
    <Sidebar collapsible="icon" className="border-r border-border/50">
      {/* Header with Logo */}
      <SidebarHeader className="border-b border-border/50">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/" className="flex items-center gap-2">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <Building2 className="size-4" />
                </div>
                <div className="flex flex-col gap-0.5 leading-none">
                  <span className="font-semibold">Insight|DesignCheck</span>
                  <span className="text-xs text-muted-foreground">
                    Permit Intelligence
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {/* Favorites - Only show if there are favorites */}
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
                            className="opacity-0 group-hover/menu-item:opacity-100 transition-opacity"
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

        {/* Recent - Only show if there are recent pages */}
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
                        {!isCollapsed && (
                          <SidebarMenuAction
                            onClick={() =>
                              toggleFavorite(page.href, page.title)
                            }
                            className="opacity-0 group-hover/menu-item:opacity-100 transition-opacity"
                          >
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span>
                                  {isFavorite(page.href) ? (
                                    <Star className="h-3.5 w-3.5 fill-yellow-500 text-yellow-500" />
                                  ) : (
                                    <Star className="h-3.5 w-3.5" />
                                  )}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="right">
                                {isFavorite(page.href)
                                  ? "Remove from favorites"
                                  : "Add to favorites"}
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

        {/* Main Navigation */}
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNavigation.map((item) => (
                <NavItem key={item.href} item={item} showFavorite />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Project block: permit-first. No auto-selection; only localStorage or explicit user choice. */}
        {user && selectedProject && (
          <SidebarGroup>
            <SidebarGroupLabel>Project</SidebarGroupLabel>
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
                <div className="px-2 space-y-2">
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
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Active Project
                    </Label>
                    <Select
                      value={selectedProject.selectedProjectId ?? "__none__"}
                      onValueChange={handleSelectValueChange}
                      disabled={!permitNumber.trim() || savingLink}
                    >
                      <SelectTrigger
                        className="h-9 w-full"
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
                      <Label className="text-xs text-muted-foreground flex items-center gap-1">
                        <KeyRound className="h-3 w-3" />
                        Portal Credential
                      </Label>
                      <Select
                        value={selectedCredentialId || "__none__"}
                        onValueChange={handleCredentialChange}
                      >
                        <SelectTrigger
                          className="h-9 w-full"
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
                      className="text-xs font-normal cursor-pointer"
                    >
                      Or create a new project for this permit
                    </Label>
                  </div>
                  {createNewProject && (
                    <div className="space-y-2 rounded-md border p-2 bg-muted/30">
                      <Input
                        placeholder="Project name (default: permit #)"
                        value={newProjectName}
                        onChange={(e) => setNewProjectName(e.target.value)}
                        className="h-9"
                      />
                      <Input
                        placeholder="Jurisdiction (optional)"
                        value={newProjectJurisdiction}
                        onChange={(e) =>
                          setNewProjectJurisdiction(e.target.value)
                        }
                        className="h-9"
                      />
                      <Input
                        placeholder="Address (optional)"
                        value={newProjectAddress}
                        onChange={(e) => setNewProjectAddress(e.target.value)}
                        className="h-9"
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
              )}
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {user && (
          <SidebarGroup>
            <Collapsible defaultOpen className="group/collapsible">
              <SidebarGroupLabel asChild>
                <CollapsibleTrigger className="flex w-full items-center justify-between">
                  Intake & Review
                  <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-180" />
                </CollapsibleTrigger>
              </SidebarGroupLabel>
              <CollapsibleContent>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {intakeNavigation.map((item) => (
                      <NavItem key={item.href} item={item} />
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </Collapsible>
          </SidebarGroup>
        )}

        {user && (
          <SidebarGroup>
            <Collapsible defaultOpen className="group/collapsible">
              <SidebarGroupLabel asChild>
                <CollapsibleTrigger className="flex w-full items-center justify-between">
                  Response
                  <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-180" />
                </CollapsibleTrigger>
              </SidebarGroupLabel>
              <CollapsibleContent>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {responseNavigation.map((item) => (
                      <NavItem key={item.href} item={item} />
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </Collapsible>
          </SidebarGroup>
        )}

        {user && (
          <SidebarGroup>
            <Collapsible defaultOpen className="group/collapsible">
              <SidebarGroupLabel asChild>
                <CollapsibleTrigger className="flex w-full items-center justify-between">
                  Projects & Tracking
                  <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-180" />
                </CollapsibleTrigger>
              </SidebarGroupLabel>
              <CollapsibleContent>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {trackingNavigation.map((item) => (
                      <NavItem key={item.href} item={item} />
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </Collapsible>
          </SidebarGroup>
        )}

        <SidebarGroup>
          <Collapsible defaultOpen={false} className="group/collapsible">
            <SidebarGroupLabel asChild>
              <CollapsibleTrigger className="flex w-full items-center justify-between">
                Intelligence
                <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-180" />
              </CollapsibleTrigger>
            </SidebarGroupLabel>
            <CollapsibleContent>
              <SidebarGroupContent>
                <SidebarMenu>
                  {intelligenceNavigation.map((item) => (
                    <NavItem key={item.href} item={item} />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </CollapsibleContent>
          </Collapsible>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Resources</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {resourcesNavigation.map((item) => (
                <NavItem key={item.href} item={item} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Admin</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminNavigation.map((item) => (
                  <NavItem key={item.href} item={item} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        <SidebarGroup>
          <Collapsible defaultOpen={false} className="group/collapsible">
            <SidebarGroupLabel asChild>
              <CollapsibleTrigger className="flex w-full items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <HelpCircle className="h-3.5 w-3.5" />
                  Help & Support
                </span>
                <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-180" />
              </CollapsibleTrigger>
            </SidebarGroupLabel>
            <CollapsibleContent>
              <SidebarGroupContent>
                <SidebarMenu>
                  {helpNavigation.map((item) => (
                    <NavItem key={item.href} item={item} />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </CollapsibleContent>
          </Collapsible>
        </SidebarGroup>
      </SidebarContent>

      {/* Footer */}
      <SidebarFooter className="border-t border-border/50">
        <SidebarMenu>
          {/* Auth Section */}
          {user ? (
            <>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={location.pathname === "/settings"}
                  tooltip="Settings"
                >
                  <Link to="/settings">
                    <SettingsIcon className="h-4 w-4" />
                    <span>Settings</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <div className="flex items-center px-2 py-1">
                  <ThemeToggle />
                  <span className="ml-2 text-xs text-muted-foreground">
                    Theme
                  </span>
                </div>
              </SidebarMenuItem>
            </>
          ) : (
            <>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <Link to="/auth">
                    <LogIn className="h-4 w-4" />
                    <span>Sign In</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <Button
                  asChild
                  size="sm"
                  className="w-full bg-accent hover:bg-accent/90 text-accent-foreground"
                >
                  <Link to="/roi-calculator">Get Started</Link>
                </Button>
              </SidebarMenuItem>
            </>
          )}
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
