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
    <div className="flex items-center gap-2 text-sm text-muted-foreground truncate min-w-0" data-testid="header-active-project">
      <Building2 className="h-3.5 w-3.5 shrink-0 text-primary" />
      <span className="font-medium text-foreground truncate" data-testid="header-project-name">
        {project.name}
      </span>
      {permit && (
        <span className="hidden sm:inline text-xs bg-muted px-1.5 py-0.5 rounded" data-testid="header-permit-number">
          {permit}
        </span>
      )}
      {jurisdiction && (
        <span className="hidden md:inline-flex items-center gap-1 text-xs" data-testid="header-jurisdiction">
          <MapPin className="h-3 w-3" />
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
      className="flex items-center gap-2 px-2.5 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors cursor-pointer"
      onClick={() => setScrapeMinimized(false)}
      data-testid="header-scrape-indicator"
    >
      <Loader2 className="h-3 w-3 animate-spin shrink-0" />
      <span className="hidden sm:inline">
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
        <header className="sticky top-0 z-40 flex h-14 items-center gap-2 sm:gap-4 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-3 sm:px-4 lg:px-6">
          <SidebarTrigger className="shrink-0" />
          
          <div className="flex-1 min-w-0">
            <ActiveProjectBadge />
          </div>
          
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <ScrapeHeaderIndicator />
            <Button
              variant="outline"
              size="sm"
              className="hidden sm:flex gap-2"
              onClick={() => setCommandOpen(true)}
            >
              <Search className="h-4 w-4" />
              <span className="text-muted-foreground">Search...</span>
              <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground sm:flex">
                ⌘K
              </kbd>
            </Button>
            <NotificationBell />
            <ThemeToggle />
            <Button variant="outline" size="sm" onClick={handleSignOut} className="gap-2">
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign Out</span>
            </Button>
          </div>
        </header>
        
        <main className="flex-1 overflow-auto pb-16 md:pb-0 overflow-x-hidden">
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
          <div className="min-h-screen flex w-full">
            <AppSidebar />
            <DashboardContent>{children}</DashboardContent>
          </div>
        </SidebarProvider>
      </ScrapeProvider>
    </SelectedProjectProvider>
  );
}
