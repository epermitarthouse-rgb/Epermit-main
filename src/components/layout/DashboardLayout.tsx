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
    <div className="flex items-center gap-2 truncate min-w-0 text-sm text-foreground/90" data-testid="header-active-project">
      <Building2 className="h-3.5 w-3.5 shrink-0 text-gold" />
      <span className="font-medium text-foreground truncate" data-testid="header-project-name">
        {project.name}
      </span>
      {permit && (
        <span
          className="hidden sm:inline shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 font-mono text-[11px] tabular-nums leading-none text-foreground shadow-sm"
          data-testid="header-permit-number"
        >
          {permit}
        </span>
      )}
      {jurisdiction && (
        <span className="hidden md:inline-flex items-center gap-1 text-xs text-muted-foreground" data-testid="header-jurisdiction">
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
        <header className="sticky top-0 z-50 flex h-16 items-center gap-2 sm:gap-4 border-b border-border/70 bg-background/85 px-3 text-foreground backdrop-blur-md sm:gap-4 sm:px-4 lg:px-6 dark:border-border/50">
          <SidebarTrigger className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-muted/80 hover:text-foreground" />
          
          <div className="flex-1 min-w-0">
            <ActiveProjectBadge />
          </div>
          
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <ScrapeHeaderIndicator />
            <Button
              variant="ghost"
              size="sm"
              className="hidden sm:flex gap-2 border border-border/80 bg-muted/60 px-3 font-tight text-foreground/90 hover:bg-muted hover:text-foreground dark:border-border/50 dark:bg-muted/40"
              onClick={() => setCommandOpen(true)}
            >
              <Search className="h-4 w-4 shrink-0 text-gold" />
              <span className="text-muted-foreground">Search...</span>
              <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[11px] font-medium tabular-nums text-muted-foreground sm:flex">
                ⌘K
              </kbd>
            </Button>
            <NotificationBell />
            <ThemeToggle />
            <Button
              variant="outline"
              size="sm"
              onClick={handleSignOut}
              className="gap-2 border border-gold text-gold hover:bg-gold hover:text-sidebar-primary-foreground dark:border-gold dark:text-gold dark:hover:bg-gold dark:hover:text-sidebar-primary-foreground"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign Out</span>
            </Button>
          </div>
        </header>
        
        <main className="flex-1 overflow-auto overflow-x-hidden bg-background pb-16 text-foreground md:pb-0">
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
          <div className="flex min-h-screen w-full bg-background text-foreground">
            <AppSidebar />
            <DashboardContent>{children}</DashboardContent>
          </div>
        </SidebarProvider>
      </ScrapeProvider>
    </SelectedProjectProvider>
  );
}
