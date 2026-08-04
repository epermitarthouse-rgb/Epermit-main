import { useLocation } from "react-router-dom";
import { ChevronDown, RadioTower } from "lucide-react";
import { AuthGatedLink, AuthGatedNavLink } from "@/components/layout/AuthGatedLink";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  UCI_NAV_SECTIONS,
  uciSectionHref,
  type UciNavSupport,
} from "@/lib/uciNavSections";
import { cn } from "@/lib/utils";

function supportBadge(support: UciNavSupport): string | null {
  if (support === "mock") return "Soon";
  if (support === "partial") return "Partial";
  return null;
}

/**
 * Expandable "Utility Coordination" sidebar entry with Lovable-style child items.
 * Active/Partial → deep links into /uci?section=… · Mock → coming-soon panel.
 */
export function UciSidebarNav() {
  const location = useLocation();
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  const onUci =
    location.pathname === "/uci" || location.pathname.startsWith("/uci/");
  const activeSection = new URLSearchParams(location.search).get("section");

  if (isCollapsed) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={onUci} tooltip="Utility Coordination">
          <AuthGatedLink to="/uci">
            <RadioTower />
            <span>Utility Coordination</span>
          </AuthGatedLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  return (
    <Collapsible defaultOpen={onUci} className="group/uci-nav">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton isActive={onUci} tooltip="Utility Coordination">
            <RadioTower />
            <span className="truncate">Utility Coordination</span>
            <ChevronDown className="ml-auto h-4 w-4 shrink-0 transition-transform group-data-[state=open]/uci-nav:rotate-180" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            <SidebarMenuSubItem>
              <SidebarMenuSubButton
                asChild
                isActive={location.pathname === "/uci" && !activeSection}
              >
                <AuthGatedNavLink to="/uci" end>
                  Hub
                </AuthGatedNavLink>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
            {UCI_NAV_SECTIONS.map((item) => {
              const href =
                item.target.kind === "external"
                  ? item.target.href
                  : uciSectionHref(item.section);
              const badge = supportBadge(item.support);
              const isActive =
                item.target.kind === "external"
                  ? location.pathname.startsWith(item.target.href)
                  : onUci && activeSection === item.section;
              const button = (
                <SidebarMenuSubButton
                  asChild
                  isActive={isActive}
                  className={cn(item.support === "mock" && "opacity-90")}
                >
                  <AuthGatedNavLink to={href}>
                    <item.icon className="h-3.5 w-3.5" />
                    <span className="truncate">{item.label}</span>
                  </AuthGatedNavLink>
                </SidebarMenuSubButton>
              );

              return (
                <SidebarMenuSubItem key={item.id} className="relative">
                  {item.support === "mock" ? (
                    <Tooltip>
                      <TooltipTrigger asChild>{button}</TooltipTrigger>
                      <TooltipContent side="right" className="max-w-xs">
                        Coming soon — {item.note}
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    button
                  )}
                  {badge ? (
                    <SidebarMenuBadge className="border border-border/70 bg-muted/50 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                      {badge}
                    </SidebarMenuBadge>
                  ) : null}
                </SidebarMenuSubItem>
              );
            })}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

/** Wrap in SidebarMenu when used alone (AppSidebar already provides SidebarMenu). */
export function UciSidebarNavMenu() {
  return (
    <SidebarMenu>
      <UciSidebarNav />
    </SidebarMenu>
  );
}
