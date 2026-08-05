import { Link, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Clock,
  LogIn,
  Menu,
  Star,
  X,
} from "lucide-react";
import { useSelectedProjectOptional } from "@/contexts/SelectedProjectContext";
import { useProjects } from "@/hooks/useProjects";
import { useAuth } from "@/hooks/useAuth";
import { useRequireAdmin } from "@/hooks/useRequireAdmin";
import { useNavigationHistory } from "@/hooks/useRecentlyUsed";
import { AuthGatedLink } from "@/components/layout/AuthGatedLink";
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
import { hybridNavGroups, type HybridNavItem } from "@/components/layout/hybridNav";
import { UciSidebarNav } from "@/components/layout/UciSidebarNav";

export function AppSidebar() {
  const location = useLocation();
  const { user } = useAuth();
  const { isAdmin } = useRequireAdmin();
  const { state } = useSidebar();
  const { recentPages, favorites, toggleFavorite, isFavorite } =
    useNavigationHistory();
  const selectedProject = useSelectedProjectOptional();
  const { projects, loading, fetchProjects } = useProjects();
  const isCollapsed = state === "collapsed";

  const [projectsLoadedOnce, setProjectsLoadedOnce] = useState(false);
  // After a miss, refetch once before clearing — never wipe a just-created id
  // that another mount has not finished merging into the shared list.
  const missingSelectionRefetchRef = useRef<string | null>(null);

  useEffect(() => {
    if (!loading && projects.length > 0) setProjectsLoadedOnce(true);
  }, [loading, projects.length]);

  useEffect(() => {
    const selectedId = selectedProject?.selectedProjectId ?? null;
    if (!selectedId || !selectedProject || loading || !projectsLoadedOnce) return;
    if (projects.length === 0) return;

    const exists = projects.some((p) => p.id === selectedId);
    if (exists) {
      missingSelectionRefetchRef.current = null;
      return;
    }

    if (missingSelectionRefetchRef.current !== selectedId) {
      missingSelectionRefetchRef.current = selectedId;
      void fetchProjects();
      return;
    }

    selectedProject.setSelectedProjectId(null);
  }, [
    selectedProject?.selectedProjectId,
    selectedProject,
    projects,
    loading,
    projectsLoadedOnce,
    fetchProjects,
  ]);

  const isActive = (href: string) => {
    if (href === "/projects") {
      return (
        location.pathname === "/projects" ||
        location.pathname.startsWith("/projects/")
      );
    }
    if (href === "/uci") {
      // Parent hub only — child sections / UCI Builder use their own items.
      return location.pathname === "/uci" && !location.search.includes("section=");
    }
    if (href.includes("?")) {
      const [path, query] = href.split("?");
      if (location.pathname !== path) return false;
      const want = new URLSearchParams(query);
      const have = new URLSearchParams(location.search);
      for (const [key, value] of want.entries()) {
        if (have.get(key) !== value) return false;
      }
      return true;
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
    if (item.href === "/uci") {
      return <UciSidebarNav />;
    }

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
          <AuthGatedLink to={item.href}>
            <item.icon />
            <span className="truncate">{item.title}</span>
          </AuthGatedLink>
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
        <AuthGatedLink to="/dashboard" className="flex items-center gap-3">
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
        </AuthGatedLink>
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
                          <AuthGatedLink to={page.href}>
                            <Star className="h-4 w-4 fill-yellow-500 text-yellow-500" />
                            <span>{page.title}</span>
                          </AuthGatedLink>
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
                          <AuthGatedLink to={page.href}>
                            <Clock className="h-4 w-4" />
                            <span>{page.title}</span>
                          </AuthGatedLink>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </Collapsible>
          </SidebarGroup>
        )}

        {hybridNavGroups.map((group) => {
          // Anonymous visitors still see the full nav (Lovable pattern) — clicking a
          // gated item redirects to /auth via AuthGatedLink instead of hiding it.
          if (group.requiresAdmin && !isAdmin) return null;

          const items = group.items;
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
