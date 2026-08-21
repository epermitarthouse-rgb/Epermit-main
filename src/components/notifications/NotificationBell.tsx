import { useState } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  NotificationsProvider,
  useNotificationsContext,
} from "./NotificationsProvider";
import { NotificationPanel } from "./NotificationPanel";

function NotificationBellInner() {
  const { user, totalAlerts } = useNotificationsContext();
  const [isOpen, setIsOpen] = useState(false);

  if (!user) return null;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative rounded-md p-2 text-ink-secondary-light hover:bg-cream-raised hover:text-ink-primary-light dark:text-ink-secondary-dark dark:hover:bg-obsidian-raised dark:hover:text-ink-primary-dark"
        >
          <Bell className="h-5 w-5" />
          {totalAlerts > 0 && (
            <Badge
              className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center p-0 text-xs"
              variant="destructive"
            >
              {totalAlerts > 9 ? "9+" : totalAlerts}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="z-50 w-96 border bg-background p-0 shadow-lg"
        align="end"
      >
        <NotificationPanel isOpen={isOpen} onClose={() => setIsOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

/** Standalone bell trigger — used on legacy marketing Header, not the app shell. */
export function NotificationBell() {
  return (
    <NotificationsProvider>
      <NotificationBellInner />
    </NotificationsProvider>
  );
}
