import { ReactNode, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { SelectedProjectProvider, useSelectedProjectOptional } from "@/contexts/SelectedProjectContext";
import { ScrapeProvider, useScrapeOptional } from "@/contexts/ScrapeContext";

import { CommandPalette } from "@/components/navigation/CommandPalette";
import { FloatingHelpWidget } from "@/components/help/FloatingHelpWidget";
import { MobileBottomNav } from "./MobileBottomNav";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/hooks/useAuth";
import { useProjects } from "@/hooks/useProjects";
import { Search, LogOut, Building2, MapPin, Loader2, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface DashboardLayoutProps {
  children: ReactNode;
}

function ActiveProjectBadge() {
  const ctx = useSelectedProjectOptional();
  const { projects } = useProjects();
  if (!ctx?.selectedProjectId) return null;
  const project = projects.find((p) => p.id === ctx.selectedProjectId);
  if (!project) return null;
  const permit = project.permit_number;
  const jurisdiction = project.jurisdiction;
  return (
    <div className="flex items-center gap-2 text-sm text-ink-primary-light/90 dark:text-ink-primary-dark truncate min-w-0" data-testid="header-active-project">
      <Building2 className="h-3.5 w-3.5 shrink-0 text-gold" />
      <span className="font-medium text-ink-primary-light dark:text-cream truncate" data-testid="header-project-name">
        {project.name}
      </span>
      {permit && (
        <span
          className="hidden sm:inline shrink-0 rounded-full border border-cream-sunken bg-cream px-2 py-0.5 font-mono text-[11px] tabular-nums leading-none text-ink-primary-light shadow-sm dark:bg-cream dark:text-ink-primary-light"
          data-testid="header-permit-number"
        >
          {permit}
        </span>
      )}
      {jurisdiction && (
        <span className="hidden md:inline-flex items-center gap-1 text-xs text-ink-primary-light/75 dark:text-ink-secondary-dark" data-testid="header-jurisdiction">
          <MapPin className="h-3 w-3 shrink-0 opacity-90" />
          {jurisdiction}
        </span>
      )}
    </div>
  );
}

function ScrapeHeaderIndicator() {
  const scrape = useScrapeOptional();
  if (!scrape || !scrape.scrapeOverlay || scrape.scrapeOverlay.phase !== "scraping") return null;

  const { scrapeOverlay, setScrapeMinimized } = scrape;
  const pct = scrapeOverlay.total > 0
    ? Math.round((scrapeOverlay.progress / scrapeOverlay.total) * 100)
    : 0;

  return (
    <button
      className="flex items-center gap-2 px-2.5 py-1 rounded-full border border-warning/35 bg-warning/10 text-xs font-medium text-warning dark:border-primary/35 dark:bg-primary/12 dark:text-primary hover:bg-warning/18 dark:hover:bg-primary/18 transition-colors cursor-pointer"
      onClick={() => setScrapeMinimized(false)}
      data-testid="header-scrape-indicator"
    >
      <Loader2 className="h-3 w-3 animate-spin shrink-0" />
        <span className="hidden sm:inline text-xs font-medium">
        Scraping: {scrapeOverlay.progress}/{scrapeOverlay.total}
      </span>
      <span className="sm:hidden">{pct}%</span>
      <Eye className="h-3 w-3 shrink-0 opacity-60" />
    </button>
  );
}

function DashboardContent({ children }: { children: ReactNode }) {
  const [commandOpen, setCommandOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const { signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    toast.success("Signed out successfully");
    navigate("/");
  };

  return (
    <>
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-50 flex h-16 items-center gap-2 sm:gap-4 border-b border-cream-raised/70 bg-cream/85 backdrop-blur-md px-3 sm:px-4 lg:px-6 text-ink-primary-light dark:border-obsidian-raised/50 dark:bg-obsidian/90 dark:text-ink-primary-dark">
          <SidebarTrigger className="shrink-0 p-2 rounded-md text-ink-secondary-light hover:text-ink-primary-light hover:bg-cream-raised/80 dark:hover:bg-obsidian-raised/50 dark:hover:text-ink-primary-dark" />
          
          <div className="flex-1 min-w-0">
            <ActiveProjectBadge />
          </div>
          
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <ScrapeHeaderIndicator />
            <Button
              variant="ghost"
              size="sm"
              className="hidden sm:flex gap-2 border border-cream-sunken/80 bg-cream-sunken/90 px-3 font-tight text-ink-primary-light/85 hover:bg-cream-raised hover:text-ink-primary-light dark:border-obsidian-raised/50 dark:bg-obsidian-raised/50 dark:text-ink-primary-dark/90 dark:hover:bg-obsidian-raised dark:hover:text-ink-primary-dark"
              onClick={() => setCommandOpen(true)}
            >
              <Search className="h-4 w-4 shrink-0 text-gold" />
              <span className="text-ink-primary-light/80 dark:text-ink-primary-dark/85">Search...</span>
              <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 rounded border border-cream-raised bg-cream px-1.5 font-mono text-[10px] font-medium text-ink-secondary-light sm:flex dark:border-obsidian dark:bg-obsidian-raised dark:text-ink-secondary-dark">
                ⌘K
              </kbd>
            </Button>
            <NotificationBell />
            <ThemeToggle />
            <Button
              variant="outline"
              size="sm"
              onClick={handleSignOut}
              className="gap-2 border border-gold text-gold hover:bg-gold hover:text-cream dark:border-gold dark:text-gold dark:hover:bg-gold dark:hover:text-obsidian"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign Out</span>
            </Button>
          </div>
        </header>
        
        <main className="flex-1 overflow-auto overflow-x-hidden bg-cream pb-16 text-ink-primary-light dark:bg-obsidian dark:text-ink-primary-dark md:pb-0">
          {children}
        </main>
        
      </div>
      
      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        onOpenHelp={() => setHelpOpen(true)}
      />
      <FloatingHelpWidget />
      <MobileBottomNav />
    </>
  );
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <SelectedProjectProvider>
      <ScrapeProvider>
        <SidebarProvider>
          <div className="flex min-h-screen w-full bg-cream text-ink-primary-light dark:bg-obsidian dark:text-ink-primary-dark">
            <AppSidebar />
            <DashboardContent>{children}</DashboardContent>
          </div>
        </SidebarProvider>
      </ScrapeProvider>
    </SelectedProjectProvider>
  );
}
