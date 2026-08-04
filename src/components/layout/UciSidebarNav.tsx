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
  UCI_PRIMARY_NAV_SECTIONS,
  uciSectionHref,
  uciSidebarBadgeLabel,
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
            {UCI_PRIMARY_NAV_SECTIONS.map((item) => {
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
                    <span
                      className="pointer-events-none shrink-0 rounded border border-border/70 bg-muted/50 px-1 py-0 font-mono text-[9px] font-medium uppercase leading-4 tracking-wider text-muted-foreground"
                      aria-label="Coming soon"
                    >
                      {badge}
                    </span>
                  </AuthGatedNavLink>
                </SidebarMenuSubButton>
              );

              return (
                <SidebarMenuSubItem key={item.id} className="min-w-0">
                  <Tooltip>
                    <TooltipTrigger asChild>{row}</TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs">
                      Coming soon — {item.note ?? item.label}
                    </TooltipContent>
                  </Tooltip>
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
