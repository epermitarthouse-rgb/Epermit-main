import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Bell,
  LogIn,
  LogOut,
  Settings,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useNotificationsContext } from "@/components/notifications/NotificationsProvider";
import { NotificationPanel } from "@/components/notifications/NotificationPanel";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";

interface AccountMenuProps {
  onSignOut: () => void;
}

function getUserDisplayName(user: NonNullable<ReturnType<typeof useAuth>["user"]>) {
  const metadata = user.user_metadata as Record<string, string | undefined> | undefined;
  return metadata?.full_name?.trim() || metadata?.name?.trim() || user.email?.split("@")[0] || "Account";
}

export function AccountMenu({ onSignOut }: AccountMenuProps) {
  const { user } = useAuth();
  const { totalAlerts } = useNotificationsContext();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const initials =
    user?.email?.slice(0, 2).toUpperCase() ??
    "PP";

  if (!user) {
    return (
      <Button asChild variant="default" size="sm" className="shrink-0 gap-2">
        <Link to="/auth" aria-label="Sign in">
          <LogIn className="h-4 w-4 shrink-0" />
          <span className="hidden sm:inline">Sign In</span>
        </Link>
      </Button>
    );
  }

  const displayName = getUserDisplayName(user);

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-card outline-none ring-offset-background transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label="Open account menu"
            data-testid="account-menu-trigger"
          >
            <Avatar className="h-8 w-8 border-0">
              <AvatarFallback className="bg-primary text-xs font-bold text-primary-foreground">
                {initials}
              </AvatarFallback>
            </Avatar>
            {totalAlerts > 0 && (
              <Badge
                variant="destructive"
                className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center px-1 text-[10px] leading-none"
              >
                {totalAlerts > 9 ? "9+" : totalAlerts}
              </Badge>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="z-50 w-56">
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col gap-0.5">
              <span className="truncate text-sm font-medium text-foreground">
                {displayName}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {user.email}
              </span>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="cursor-pointer gap-2"
            onSelect={(event) => {
              event.preventDefault();
              setMenuOpen(false);
              setNotificationsOpen(true);
            }}
          >
            <Bell className="h-4 w-4" />
            <span className="flex-1">Notifications</span>
            {totalAlerts > 0 && (
              <Badge variant="secondary" className="h-5 min-w-5 px-1.5 text-[10px]">
                {totalAlerts > 9 ? "9+" : totalAlerts}
              </Badge>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/settings" className="cursor-pointer gap-2">
              <Settings className="h-4 w-4" />
              Settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="cursor-pointer gap-2 text-destructive focus:text-destructive"
            onSelect={() => onSignOut()}
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={notificationsOpen} onOpenChange={setNotificationsOpen}>
        <DialogContent className="max-w-md gap-0 overflow-hidden p-0 sm:max-w-md">
          <NotificationPanel
            isOpen={notificationsOpen}
            onClose={() => setNotificationsOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
