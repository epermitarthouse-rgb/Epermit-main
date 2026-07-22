import { ReactNode, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { SelectedProjectProvider } from "@/contexts/SelectedProjectContext";
import { ScrapeProvider, useScrapeOptional } from "@/contexts/ScrapeContext";
import { CommandPalette } from "@/components/navigation/CommandPalette";
import { FloatingHelpWidget } from "@/components/help/FloatingHelpWidget";
import { MobileBottomNav } from "./MobileBottomNav";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ActiveProjectControl } from "@/components/layout/ActiveProjectControl";
import { AuthGatedLink } from "@/components/layout/AuthGatedLink";
import { useAuth } from "@/hooks/useAuth";
import { resolvePageTitle } from "@/components/layout/hybridNav";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  ArrowLeft,
  ChevronRight,
  Eye,
  Home,
  Loader2,
  LogIn,
  LogOut,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface DashboardLayoutProps {
  children: ReactNode;
}

function ScrapeHeaderIndicator() {
  const scrape = useScrapeOptional();
  if (!scrape || !scrape.isScraping) return null;

  const { setScrapeMinimized, scrapeLiveMessage } = scrape;
  const label = scrapeLiveMessage?.trim() || "Scraping portal…";

  return (
    <button
      type="button"
      className="flex max-w-[220px] cursor-pointer items-center gap-2 rounded-md border border-warning/35 bg-warning/10 px-2.5 py-1.5 text-xs font-medium text-warning transition-colors hover:bg-warning/18 dark:border-primary/35 dark:bg-primary/12 dark:text-primary dark:hover:bg-primary/18"
      onClick={() => setScrapeMinimized(false)}
      data-testid="header-scrape-indicator"
    >
      <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
      <span className="hidden truncate text-xs font-medium sm:inline">{label}</span>
      <span className="truncate sm:hidden">Scraping</span>
      <Eye className="h-3 w-3 shrink-0 opacity-60" />
    </button>
  );
}

function AppHeader({
  onOpenCommand,
  onSignOut,
}: {
  onOpenCommand: () => void;
  onSignOut: () => void;
}) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const title = resolvePageTitle(pathname);
  const isHome = pathname === "/dashboard";
  const initials =
    user?.email?.slice(0, 2).toUpperCase() ??
    "PP";

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-xl">
      <div className="flex h-16 items-center gap-3 px-4 md:gap-4 md:px-6 lg:px-8">
        <SidebarTrigger className="h-9 w-9 border border-border bg-card text-foreground" />

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Go back"
            title="Back"
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <AuthGatedLink
            to="/dashboard"
            aria-label="Go to dashboard"
            title="Home"
            aria-current={isHome ? "page" : undefined}
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card transition-colors hover:text-foreground",
              isHome ? "text-primary" : "text-muted-foreground",
            )}
          >
            <Home className="h-4 w-4" />
          </AuthGatedLink>
        </div>

        <div className="hidden min-w-0 items-center gap-2 text-sm text-muted-foreground md:flex">
          <span className="shrink-0">PermitPilot</span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate font-medium text-foreground">{title}</span>
        </div>

        <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
          <ScrapeHeaderIndicator />
          <ActiveProjectControl />

          <button
            type="button"
            onClick={onOpenCommand}
            className="hidden min-w-48 items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-left lg:flex"
            aria-label="Open command palette"
          >
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 truncate text-sm text-muted-foreground">
              Search navigation…
            </span>
            <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[11px] font-medium text-muted-foreground sm:flex">
              ⌘K
            </kbd>
          </button>

          <AuthGatedLink
            to="/permit-wizard-filing"
            className="pilot-button-primary hidden sm:inline-flex"
          >
            <Plus className="h-4 w-4" />
            New workflow
          </AuthGatedLink>

          <Link
            to="/demos"
            className="pilot-button-primary inline-flex bg-accent text-accent-foreground hover:bg-accent/90"
            aria-label="Request Demo"
          >
            <Sparkles className="h-4 w-4" />
            <span className="hidden sm:inline">Request Demo</span>
          </Link>

          <ThemeToggle />
          <NotificationBell />

          <Avatar className="hidden h-9 w-9 border border-border sm:flex">
            <AvatarFallback className="bg-primary font-tight text-xs font-bold text-primary-foreground">
              {initials}
            </AvatarFallback>
          </Avatar>

          {user ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onSignOut}
              className="gap-2 border-border"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden lg:inline">Sign Out</span>
            </Button>
          ) : (
            <Button asChild variant="default" size="sm" className="gap-2">
              <Link to="/auth" aria-label="Sign in">
                <LogIn className="h-4 w-4" />
                <span className="hidden lg:inline">Sign In</span>
              </Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}

function DashboardContent({ children }: { children: ReactNode }) {
  const [commandOpen, setCommandOpen] = useState(false);
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const scrape = useScrapeOptional();

  const handleSignOut = async () => {
    scrape?.clearAccelaBrowserSession();
    await signOut();
    toast.success("Signed out successfully");
    navigate("/");
  };

  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader
          onOpenCommand={() => setCommandOpen(true)}
          onSignOut={handleSignOut}
        />

        <main className="flex-1 overflow-auto overflow-x-hidden px-4 py-5 pb-20 text-foreground md:px-6 md:pb-5 lg:px-8">
          <div className="min-h-full">{children}</div>
        </main>
      </div>

      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        onOpenHelp={() => undefined}
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
          <div className="signal-grid flex min-h-screen w-full bg-background text-foreground">
            <div className="flex min-h-screen w-full">
              <AppSidebar />
              <DashboardContent>{children}</DashboardContent>
            </div>
          </div>
        </SidebarProvider>
      </ScrapeProvider>
    </SelectedProjectProvider>
  );
}
