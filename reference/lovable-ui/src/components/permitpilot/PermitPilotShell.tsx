import { Outlet, NavLink, Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Bell, ChevronRight, Home, Menu, Moon, Plus, Search, Sparkles, Sun, Briefcase } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { navGroups } from "./data";
import { useActiveProject } from "@/state/activeProject";
import { useTheme } from "@/hooks/useTheme";
import logoAsset from "@/assets/commun-et-logo.jpg.asset.json";
import { useUserRole, roleLabels } from "@/hooks/useUserRole";
import { canViewUciPath, isUciPath } from "@/config/uciAccess";
import { useAuth } from "@/hooks/useAuth";

const pageTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/projects": "Projects",
  "/projects/alpha": "Project Alpha",
  "/projects/new": "New Project · Portal Credentials",
  "/mission-control": "Mission Control",
  "/command-center": "Command Center",
  "/feasibility": "Feasibility",
  "/feasibility/site": "Site Feasibility",
  "/critical-path": "Critical Path",
  "/permit-queue": "Permit Queue",
  "/compliance": "DesignCheck",
  "/compliance/intelligence": "Compliance Intelligence",
  "/compliance/analyzer": "Code Compliance Analyzer",
  "/compliance/prescreen": "Internal Prescreen",
  "/portals/harvest": "Portal Harvest",
  "/raze": "Raze Permits",
  "/utility-map": "Utility Map",
  "/documents": "Document Vault",
  "/reference": "Reference Library",
  "/reference/utility-coverage": "East Coast Utility Coverage Analysis",
  "/reference/glossary": "Glossary of Terms",
  "/agents": "Agent Center",
  "/messages": "Messages",
  "/matrix": "Master Matrix",
  "/matrix/unified": "Unified Task Matrix",
  "/matrix/guided": "Guided Flow",
  "/matrix/ai-workflow": "AI Workflow",
  "/matrix/response": "Response Matrix",
  "/field/studio": "Field Studio",
  "/mobile/survey": "Mobile · Site Survey",
  "/mobile/camera": "Mobile · Camera",
  "/mobile/map": "Mobile · Map",
  "/sir": "Site Investigation Report",
  "/sir/workspace": "SIR Workspace",
  "/sir/annex": "SIR Annex",
  "/sir/executive": "Executive SIR",
  "/sir/sync": "SIR ↔ ESIR Sync",
  "/inspections/special": "Special Inspections",
  "/inspections/final-co": "Final Inspections / CO",
  "/closeout": "Closeout",
  "/closeout/archive": "Closeout Archive",
  "/closeout/tracker": "Compliance Tracker",
  "/closeout/post-mortem": "Post-Mortem",
  "/closeout/post-mortem/analytics": "Post-Mortem · Performance Analytics",
  "/closeout/post-mortem/financial": "Post-Mortem · Financial Intelligence",
  "/architecture": "Platform Architecture",
  "/content-studio": "Content Studio",
  "/admin": "Admin Console",
  "/admin/authorizations": "Client Authorizations · Admin Review",
  "/admin/members": "Workspace Members · Invitations & Access",
  "/admin/invoicing": "Invoicing",
  "/admin/past-performance": "Past Performance Management",
  "/admin/crm": "CRM Intelligence · Monday.com",
  "/utility/conflict-hunter": "Cross-Utility Conflict Hunter",
  "/utility/easements": "Easement & ROW Manager",
  "/utility/load-profile": "Load Profile Analyzer",
  "/utility/provider-map": "Utility Provider Territory Map",
  "/utility/meter-set": "Inspection & Meter-Set Choreographer",
  "/scheduling/long-lead": "Long-Lead Equipment Tracker",
  "/scheduling/predictive-impact": "Predictive Schedule Impact",
  "/inspections/release-tracker": "Inspector Release Tracker",
  "/uci/application-builder": "UCI · Commercial Service Application",
  "/uci/submissions": "UCI · Utility Submissions",
  "/uci/communications": "UCI · Utility Inbox",
  "/uci/class-of-service": "UCI · Class of Service",
  "/uci/ciac": "UCI · CIAC & Refunds",
  "/uci/energization": "UCI · Energization & Commissioning",
  "/uci/miss-utility": "UCI · Miss Utility 811",
  "/uci/knowledge-graph": "UCI · Knowledge Graph",
  "/portfolio/executive": "Portfolio Executive Report",
  "/admin/milestone-billing": "Milestone Billing · 30/30/30/10",
  "/settings": "Settings",
  "/checklists": "Checklist History",
  "/onboarding/authorization": "Client Authorization · Letter of Authorization",
  "/delivery/authorization": "Client Authorization · Letter of Authorization",
  "/demo/mcdonalds": "McDonald's · Executive Demo",
  "/operations": "Operations Board · Reimbursables & Workflow",
};

const TENANT_KEY = "commun-et:tenant";
type TenantId = "default" | "mcd";
const tenants: Record<TenantId, { name: string; kicker: string; mark: string; markBg: string }> = {
  default: { name: "PermitPilot", kicker: "Permit expediting + utility coordination", mark: "P", markBg: "bg-primary text-primary-foreground" },
  mcd:     { name: "PermitPilot · McDonald's East Coast", kicker: "MSA CET-2026-MCD-UC-001", mark: "M", markBg: "bg-[#FFC72C] text-black" },
};

const useTenant = (): TenantId => {
  const [params] = useSearchParams();
  const [tenant, setTenant] = useState<TenantId>("default");
  useEffect(() => {
    const p = params.get("tenant");
    if (p === "mcd" || p === "default") {
      setTenant(p);
      try { window.localStorage.setItem(TENANT_KEY, p); } catch { /* ignore */ }
      return;
    }
    try {
      const stored = window.localStorage.getItem(TENANT_KEY);
      if (stored === "mcd" || stored === "default") setTenant(stored);
    } catch { /* ignore */ }
  }, [params]);
  return tenant;
};

export const PermitPilotShell = () => {
  const tenant = useTenant();
  return (
    <SidebarProvider>
      <div className="min-h-screen w-full bg-background text-foreground signal-grid" data-tenant={tenant}>
        <div className="flex min-h-screen w-full">
          <AppSidebar tenant={tenant} />
          <div className="flex min-w-0 flex-1 flex-col">
            <AppHeader tenant={tenant} />
            <main className="flex-1 px-4 py-5 md:px-6 lg:px-8">
              <Outlet />
            </main>
          </div>
        </div>
      </div>
    </SidebarProvider>
  );
};

const AppSidebar = ({ tenant }: { tenant: TenantId }) => {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { pathname } = useLocation();
  const t = tenants[tenant];
  const { roles, role, loading: rolesLoading } = useUserRole();
  const { user } = useAuth();

  return (
    <Sidebar collapsible="icon" className="border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border p-4">
        <Link to="/dashboard" className="flex items-center gap-3">
          <span className={`flex h-10 w-10 items-center justify-center rounded-md font-display text-2xl font-semibold ${t.markBg}`}>
            {t.mark}
          </span>
          {!collapsed && (
            <span className="min-w-0">
              <span className="block font-tight text-lg font-black leading-none tracking-tight text-sidebar-foreground">
                {t.name}
              </span>
              <span className="pilot-kicker mt-1 block">{t.kicker}</span>
            </span>
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-2 py-4">
        {navGroups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  // Hide UCI items the signed-in user cannot view. Anonymous
                  // visitors still see the nav (route guard prompts sign-in).
                  if (user && isUciPath(item.path) && !rolesLoading && !canViewUciPath(item.path, roles)) {
                    return null;
                  }
                  const active = pathname === item.path || (item.path === "/projects" && pathname.startsWith("/projects/"));
                  return (
                    <SidebarMenuItem key={item.path}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                        <NavLink to={item.path}>
                          <item.icon />
                          <span>{item.label}</span>
                        </NavLink>
                      </SidebarMenuButton>
                      {item.badge && <SidebarMenuBadge>{item.badge}</SidebarMenuBadge>}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3">
        {!collapsed && (
          <div className="mb-3 rounded-md border border-sidebar-border bg-white p-2">
            <img src={logoAsset.url} alt="Commun-ET LLC" className="mx-auto h-6 w-auto" />
          </div>
        )}
        <div className="rounded-md border border-sidebar-border bg-sidebar-accent p-3">
          {!collapsed ? (
            <>
              <div className="flex items-center justify-between">
                <div className="pilot-kicker">Workspace</div>
                {role && (
                  <span className="rounded-full border border-sidebar-border bg-background/60 px-2 py-0.5 font-data text-[10px] font-semibold uppercase tracking-wide text-foreground">
                    {roleLabels[role]}
                  </span>
                )}
              </div>
              <div className="mt-1 font-tight text-sm font-semibold text-sidebar-foreground">Commun-ET · AEC Ops</div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-sidebar-border">
                <div className="h-full w-2/3 rounded-full bg-primary" />
              </div>
            </>
          ) : (
            <Menu className="mx-auto h-4 w-4 text-sidebar-foreground" />
          )}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
};

const AppHeader = ({ tenant }: { tenant: TenantId }) => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const title = pageTitles[pathname] ?? "PermitPilot";
  const t = tenants[tenant];
  const isHome = pathname === "/dashboard";

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-xl">
      <div className="flex h-16 items-center gap-4 px-4 md:px-6 lg:px-8">
        <SidebarTrigger className="h-9 w-9 border border-border bg-card text-foreground" />
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Go back"
            title="Back"
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <Link
            to="/dashboard"
            aria-label="Go to dashboard"
            title="Home"
            aria-current={isHome ? "page" : undefined}
            className={`flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card transition-colors hover:text-foreground ${isHome ? "text-primary" : "text-muted-foreground"}`}
          >
            <Home className="h-4 w-4" />
          </Link>
        </div>
        <div className="hidden items-center gap-2 text-sm text-muted-foreground md:flex">
          <span>{t.name}</span>
          <ChevronRight className="h-3.5 w-3.5" />
          <span className="font-medium text-foreground">{title}</span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <ActiveProjectPicker />
          <label className="hidden min-w-72 items-center gap-2 rounded-md border border-border bg-card px-3 py-2 lg:flex">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground" placeholder="Search projects, permits, providers, documents" />
          </label>
          <Link
            to="/matrix/ai-workflow?new=1"
            className="pilot-button-primary hidden sm:inline-flex"
          >
            <Plus className="h-4 w-4" />
            New workflow
          </Link>
          <Link
            to="/demo/mcdonalds"
            className="pilot-button-primary inline-flex bg-accent text-accent-foreground hover:bg-accent/90"
            aria-label="Request Demo"
          >
            <Sparkles className="h-4 w-4" />
            <span className="hidden sm:inline">Request Demo</span>
          </Link>
          <ThemeToggle />
          <button className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:text-foreground" aria-label="Notifications">
            <Bell className="h-4 w-4" />
          </button>
          <Avatar className="h-9 w-9 border border-border">
            <AvatarFallback className="bg-primary text-primary-foreground font-tight text-xs font-bold">PP</AvatarFallback>
          </Avatar>
        </div>
      </div>
    </header>
  );
};

const ThemeToggle = () => {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
};

const ActiveProjectPicker = () => {
  const { projects, activeId, setActiveId } = useActiveProject();
  return (
    <label className="hidden items-center gap-2 rounded-md border border-border bg-card px-2.5 py-2 md:flex" title="Active project">
      <Briefcase className="h-4 w-4 text-primary" />
      <select
        value={activeId}
        onChange={(e) => setActiveId(e.target.value)}
        className="max-w-[200px] truncate bg-transparent text-xs font-medium text-foreground outline-none"
        aria-label="Active project"
      >
        {projects.map((p) => (
          <option key={p.id} value={p.id}>{p.name} · {p.serviceSummary}</option>
        ))}
      </select>
    </label>
  );
};