import React from "react";
import { Home, FolderKanban, Globe, Rocket, Menu } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useSidebar } from "@/components/ui/sidebar";

const navItems = [
  { icon: Home, label: "Home", path: "/" },
  { icon: FolderKanban, label: "Projects", path: "/projects" },
  { icon: Globe, label: "Portal Harvest", path: "/portal-data" },
  { icon: Rocket, label: "Filing", path: "/permit-wizard-filing" },
];

export const MobileBottomNav = React.forwardRef<HTMLElement, object>(
  function MobileBottomNav(_props, ref) {
    const location = useLocation();
    const { toggleSidebar } = useSidebar();

    return (
      <nav
        ref={ref}
        className="fixed bottom-0 left-0 right-0 z-50 border-t border-cream-raised bg-cream/95 text-ink-primary-light backdrop-blur supports-[backdrop-filter]:bg-cream/80 md:hidden dark:border-obsidian-raised dark:bg-obsidian/95 dark:text-ink-primary-dark dark:supports-[backdrop-filter]:bg-obsidian/80"
      >
        <div className="flex items-center justify-around h-16 px-2 pb-[env(safe-area-inset-bottom)]">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={cn(
                  "flex flex-col items-center justify-center flex-1 h-full gap-1 transition-colors",
                  "active:scale-95 touch-manipulation",
                  isActive
                    ? "text-primary bg-primary/12 rounded-lg py-1"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-lg py-1"
                )}
              >
                <item.icon className={cn("h-5 w-5", isActive && "stroke-[2.5]")} />
                <span className="text-[10px] font-medium">{item.label}</span>
              </NavLink>
            );
          })}
          <button
            onClick={toggleSidebar}
            className={cn(
              "flex flex-col items-center justify-center flex-1 h-full gap-1 transition-colors",
              "active:scale-95 touch-manipulation",
              "text-muted-foreground hover:text-foreground"
            )}
          >
            <Menu className="h-5 w-5" />
            <span className="text-[10px] font-medium">More</span>
          </button>
        </div>
      </nav>
    );
  }
);

MobileBottomNav.displayName = "MobileBottomNav";
