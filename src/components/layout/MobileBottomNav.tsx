import React from "react";
import { Home, FolderKanban, Globe, Rocket, Menu } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useSidebar } from "@/components/ui/sidebar";

/** Lovable shell mobile IA — same PP hrefs as plan §6 */
const navItems = [
  { icon: Home, label: "Home", path: "/dashboard" },
  { icon: FolderKanban, label: "Projects", path: "/projects" },
  { icon: Globe, label: "Harvest", path: "/portal-data" },
  { icon: Rocket, label: "Filing", path: "/permit-wizard-filing" },
];

export const MobileBottomNav = React.forwardRef<HTMLElement, object>(
  function MobileBottomNav(_props, ref) {
    const location = useLocation();
    const { toggleSidebar } = useSidebar();

    return (
      <nav
        ref={ref}
        className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background/95 text-foreground backdrop-blur-xl supports-[backdrop-filter]:bg-background/90 md:hidden"
      >
        <div className="flex h-16 items-center justify-around px-2 pb-[env(safe-area-inset-bottom)]">
          {navItems.map((item) => {
            const isActive =
              item.path === "/dashboard"
                ? location.pathname === "/dashboard"
                : location.pathname === item.path ||
                  location.pathname.startsWith(`${item.path}/`);
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={cn(
                  "flex h-full flex-1 flex-col items-center justify-center gap-1 rounded-md transition-colors",
                  "touch-manipulation active:scale-95",
                  isActive
                    ? "bg-primary/12 text-primary"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <item.icon className={cn("h-5 w-5", isActive && "stroke-[2.5]")} />
                <span className="font-tight text-[10px] font-medium">{item.label}</span>
              </NavLink>
            );
          })}
          <button
            type="button"
            onClick={toggleSidebar}
            className={cn(
              "flex h-full flex-1 flex-col items-center justify-center gap-1 rounded-md transition-colors",
              "touch-manipulation active:scale-95",
              "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <Menu className="h-5 w-5" />
            <span className="font-tight text-[10px] font-medium">More</span>
          </button>
        </div>
      </nav>
    );
  },
);

MobileBottomNav.displayName = "MobileBottomNav";
