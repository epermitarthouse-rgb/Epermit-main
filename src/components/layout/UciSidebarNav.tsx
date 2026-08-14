import { useLocation } from "react-router-dom";
import { ChevronDown, LayoutDashboard, RadioTower } from "lucide-react";
import { AuthGatedLink, AuthGatedNavLink } from "@/components/layout/AuthGatedLink";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarMenu,
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
  UCI_FOUNDATION_NAV_SECTIONS,
  UCI_OPERATION_NAV_SECTIONS,
  uciSectionHref,
  uciSidebarBadgeLabel,
  type UciNavSection,
} from "@/lib/uciNavSections";

/**
 * Expandable "Utility Coordination" sidebar entry with Lovable-shaped children.
 * Parent → `/uci` hub. Children use deep-links / builder route; badges are
 * Soon only (no Partial). Badge sits in flex flow so it never overlaps labels.
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
          <SidebarMenuButton
            isActive={location.pathname === "/uci" && !activeSection}
            tooltip="Utility Coordination"
          >
            <RadioTower />
            <span className="min-w-0 flex-1 truncate">Utility Coordination</span>
            <ChevronDown className="ml-1 h-4 w-4 shrink-0 transition-transform group-data-[state=open]/uci-nav:rotate-180" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            <SidebarMenuSubItem className="min-w-0">
              <SidebarMenuSubButton
                asChild
                isActive={location.pathname === "/uci" && !activeSection}
                className="h-auto min-h-7 py-1"
              >
                <AuthGatedNavLink to="/uci" className="flex w-full min-w-0 items-center gap-2">
                  <LayoutDashboard className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-left">Project Workspace</span>
                </AuthGatedNavLink>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
            {[
              { label: "Operations", items: UCI_OPERATION_NAV_SECTIONS },
              { label: "Foundations", items: UCI_FOUNDATION_NAV_SECTIONS },
            ].map((group) => (
              <div key={group.label} className="contents">
                <li className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </li>
                {group.items.map((item: UciNavSection) => {
              const href =
                item.target.kind === "external"
                  ? item.target.href
                  : uciSectionHref(item.section);
              const badge = uciSidebarBadgeLabel(item.support);
              const isActive =
                item.target.kind === "external"
                  ? location.pathname.startsWith(item.target.href)
                  : onUci && activeSection === item.section;

              const row = (
                <SidebarMenuSubButton
                  asChild
                  isActive={isActive}
                  className="h-auto min-h-7 py-1 pr-1.5 [&>span:last-child]:overflow-visible"
                >
                  <AuthGatedNavLink
                    to={href}
                    className="flex w-full min-w-0 items-center gap-2"
                  >
                    <item.icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
                    {badge ? (
                      <span
                        className="pointer-events-none shrink-0 rounded border border-border/70 bg-muted/50 px-1 py-0 font-mono text-[8px] font-medium uppercase leading-4 tracking-wider text-muted-foreground"
                        aria-label={badge}
                      >
                        {badge}
                      </span>
                    ) : null}
                  </AuthGatedNavLink>
                </SidebarMenuSubButton>
              );

              return (
                <SidebarMenuSubItem key={item.id} className="min-w-0">
                  <Tooltip>
                    <TooltipTrigger asChild>{row}</TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs">
                      {item.note ?? item.label}
                    </TooltipContent>
                  </Tooltip>
                </SidebarMenuSubItem>
              );
                })}
              </div>
            ))}
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
