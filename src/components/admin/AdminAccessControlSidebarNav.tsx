import { useLocation } from "react-router-dom";
import { ChevronDown, ScrollText, ShieldCheck, Users } from "lucide-react";
import { AuthGatedLink, AuthGatedNavLink } from "@/components/layout/AuthGatedLink";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";

const ACCESS_CONTROL_ITEMS = [
  { label: "Authorization", href: "/admin/access/users", icon: Users },
  { label: "Audit", href: "/admin/audit", icon: ScrollText },
] as const;

function isAccessControlRoute(pathname: string) {
  return pathname.startsWith("/admin/access") || pathname.startsWith("/admin/audit");
}

/**
 * Expandable "Access Control" admin sidebar entry with Authorization and Audit children.
 */
export function AdminAccessControlSidebarNav() {
  const location = useLocation();
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  const onAccessControl = isAccessControlRoute(location.pathname);

  if (isCollapsed) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton
          asChild
          isActive={onAccessControl}
          tooltip="Access Control"
        >
          <AuthGatedLink to="/admin/access/users">
            <ShieldCheck />
            <span>Access Control</span>
          </AuthGatedLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  return (
    <Collapsible defaultOpen={onAccessControl} className="group/access-nav">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton isActive={onAccessControl} tooltip="Access Control">
            <ShieldCheck />
            <span className="min-w-0 flex-1 truncate">Access Control</span>
            <ChevronDown className="ml-1 h-4 w-4 shrink-0 transition-transform group-data-[state=open]/access-nav:rotate-180" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {ACCESS_CONTROL_ITEMS.map((item) => {
              const active =
                location.pathname === item.href ||
                location.pathname.startsWith(`${item.href}/`);

              return (
                <SidebarMenuSubItem key={item.href} className="min-w-0">
                  <SidebarMenuSubButton asChild isActive={active} className="h-auto min-h-7 py-1">
                    <AuthGatedNavLink
                      to={item.href}
                      className="flex w-full min-w-0 items-center gap-2"
                    >
                      <item.icon className="h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
                    </AuthGatedNavLink>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              );
            })}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}
