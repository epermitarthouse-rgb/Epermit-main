import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { SelectedProjectProvider } from "@/contexts/SelectedProjectContext";
import { ScrapeProvider, useScrapeOptional } from "@/contexts/ScrapeContext";
import { CommandPalette } from "@/components/navigation/CommandPalette";
import { FloatingHelpWidget } from "@/components/help/FloatingHelpWidget";
import { MobileBottomNav } from "./MobileBottomNav";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ActiveProjectControl } from "@/components/layout/ActiveProjectControl";
import { AuthGatedLink } from "@/components/layout/AuthGatedLink";
import { NotificationsProvider } from "@/components/notifications/NotificationsProvider";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { HeaderOverflowMenu } from "@/components/layout/HeaderOverflowMenu";
import { useAuth } from "@/hooks/useAuth";
import {
  ArrowLeft,
  Eye,
  Home,
  Loader2,
  Plus,
  Rocket,
  Search,
  Sparkles,
} from "lucide-react";
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
      className="flex max-w-[120px] shrink-0 cursor-pointer items-center gap-2 rounded-md border border-warning/35 bg-warning/10 px-2 py-1.5 text-xs font-medium text-warning transition-colors hover:bg-warning/18 sm:max-w-[160px] dark:border-primary/35 dark:bg-primary/12 dark:text-primary dark:hover:bg-primary/18"
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
  const isHome = pathname === "/dashboard";

  return (
    <header
      className="z-40 min-w-0 shrink-0 border-b border-border bg-background shadow-sm"
      style={{ height: "var(--app-header-height)" }}
      data-testid="app-header"
    >
      <div className="flex h-full min-w-0 items-center gap-2 px-3 sm:gap-3 sm:px-4 md:px-5 lg:px-6">
        {/* Left: Back, Home */}
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Go back"
            title="Back"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <AuthGatedLink
            to="/dashboard"
            aria-label="Go to dashboard"
            title="Home"
            aria-current={isHome ? "page" : undefined}
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-card transition-colors hover:text-foreground",
              isHome ? "text-primary" : "text-muted-foreground",
            )}
          >
            <Home className="h-4 w-4" />
          </AuthGatedLink>
        </div>

        {/* Center: Search */}
        <div className="flex min-w-0 flex-1 justify-center px-1 sm:px-2 md:px-3">
          <button
            type="button"
            onClick={onOpenCommand}
            className="flex h-9 w-full min-w-[10rem] max-w-xl flex-1 items-center gap-2 rounded-md border border-border bg-card px-3 text-left sm:min-w-[17.5rem]"
            aria-label="Open command palette"
            data-testid="header-search"
          >
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
              Search navigation…
            </span>
            <kbd className="pointer-events-none hidden h-5 shrink-0 select-none items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[11px] font-medium text-muted-foreground lg:flex">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Right: Actions */}
        <div className="flex shrink-0 items-center gap-1 sm:gap-1.5 lg:gap-2">
          <ScrapeHeaderIndicator />
          <ActiveProjectControl />

          <AuthGatedLink
            to="/projects/new"
            className="pilot-button-primary hidden shrink-0 lg:inline-flex"
            aria-label="New Project"
          >
            <Plus className="h-4 w-4 shrink-0" />
            <span className="hidden 2xl:inline">New Project</span>
          </AuthGatedLink>

          <AuthGatedLink
            to="/permit-wizard-filing"
            className="pilot-button-ghost hidden shrink-0 border border-border lg:inline-flex"
            aria-label="Start Permit Filing"
          >
            <Rocket className="h-4 w-4 shrink-0" />
            <span className="hidden 2xl:inline">Start Permit Filing</span>
            <span className="hidden lg:inline 2xl:hidden">Start Filing</span>
          </AuthGatedLink>

          <Link
            to="/demo/mcdonalds"
            className="pilot-button-primary hidden shrink-0 bg-accent text-accent-foreground hover:bg-accent/90 sm:inline-flex"
            aria-label="Request Demo"
          >
            <Sparkles className="h-4 w-4 shrink-0" />
            <span className="hidden xl:inline">Request Demo</span>
          </Link>

          <ThemeToggle />

          <HeaderOverflowMenu onOpenCommand={onOpenCommand} />

          <AccountMenu onSignOut={onSignOut} />
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandOpen(true);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleSignOut = async () => {
    scrape?.resetScrapeUi();
    await signOut();
    toast.success("Signed out successfully");
    navigate("/");
  };

  return (
    <>
      <NotificationsProvider>
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <AppHeader
            onOpenCommand={() => setCommandOpen(true)}
            onSignOut={handleSignOut}
          />

          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-5 pb-20 text-foreground md:px-6 md:pb-5 lg:px-8">
            <div className="min-h-full min-w-0 max-w-full">{children}</div>
          </main>
        </div>
      </NotificationsProvider>

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
          <div className="signal-grid flex h-svh min-h-0 w-full overflow-hidden bg-background text-foreground">
            <div className="flex h-full min-h-0 w-full min-w-0 overflow-hidden">
              <AppSidebar />
              <DashboardContent>{children}</DashboardContent>
            </div>
          </div>
        </SidebarProvider>
      </ScrapeProvider>
    </SelectedProjectProvider>
  );
}
