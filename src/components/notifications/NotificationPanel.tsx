import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Check, Trash2, Calendar, AlertTriangle, Building, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { format, isBefore } from "date-fns";
import {
  INSPECTION_TYPE_LABELS,
  PUNCH_LIST_PRIORITY_CONFIG,
} from "@/types/inspection";
import { useNotificationsContext } from "./NotificationsProvider";

interface NotificationPanelProps {
  onClose?: () => void;
  isOpen?: boolean;
}

function formatDate(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function isOverdue(dateStr: string) {
  return isBefore(new Date(dateStr), new Date());
}

function getDaysOverdue(dateStr: string) {
  const dueDate = new Date(dateStr);
  const now = new Date();
  return Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
}

export function NotificationPanel({ onClose, isOpen = true }: NotificationPanelProps) {
  const navigate = useNavigate();
  const {
    notifications,
    upcomingInspections,
    overduePunchItems,
    loading,
    activeTab,
    setActiveTab,
    unreadNotifications,
    totalAlerts,
    fetchData,
    markAsRead,
    markAllAsRead,
    deleteNotification,
  } = useNotificationsContext();

  useEffect(() => {
    if (isOpen) {
      void fetchData();
    }
  }, [isOpen, fetchData]);

  const handleNavigate = (path: string) => {
    onClose?.();
    navigate(path);
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b p-3">
        <h4 className="font-semibold">Notifications</h4>
        {unreadNotifications > 0 && (
          <Button variant="ghost" size="sm" onClick={markAllAsRead}>
            <Check className="mr-1 h-4 w-4" />
            Mark all read
          </Button>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid h-auto w-full grid-cols-3 bg-muted/50 p-1">
          <TabsTrigger value="all" className="gap-1 py-1.5 text-xs">
            All
            {totalAlerts > 0 && (
              <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                {totalAlerts}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="inspections" className="gap-1 py-1.5 text-xs">
            <Calendar className="h-3 w-3" />
            {upcomingInspections.length > 0 && (
              <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                {upcomingInspections.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="punchlist" className="gap-1 py-1.5 text-xs">
            <AlertTriangle className="h-3 w-3" />
            {overduePunchItems.length > 0 && (
              <Badge variant="destructive" className="h-4 px-1 text-[10px]">
                {overduePunchItems.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <ScrollArea className="h-[320px]">
          <TabsContent value="all" className="mt-0">
            {loading ? (
              <div className="flex items-center justify-center p-8 text-muted-foreground">
                Loading...
              </div>
            ) : totalAlerts === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-muted-foreground">
                <Bell className="mb-2 h-8 w-8 opacity-50" />
                <p className="text-sm">No notifications</p>
                <p className="mt-1 text-xs">You&apos;re all caught up!</p>
              </div>
            ) : (
              <div className="divide-y">
                {overduePunchItems.map((item) => (
                  <div
                    key={`punch-${item.id}`}
                    className="cursor-pointer bg-destructive/5 p-3 transition-colors hover:bg-muted/50"
                    onClick={() => handleNavigate("/projects")}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-destructive/20">
                        <AlertTriangle className="h-4 w-4 text-destructive" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{item.title}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {item.projects.name}
                        </p>
                        <div className="mt-1 flex items-center gap-2">
                          <Badge
                            className={cn(
                              "text-[10px]",
                              PUNCH_LIST_PRIORITY_CONFIG[item.priority].bgColor,
                              PUNCH_LIST_PRIORITY_CONFIG[item.priority].color,
                            )}
                          >
                            {PUNCH_LIST_PRIORITY_CONFIG[item.priority].label}
                          </Badge>
                          <span className="text-xs font-medium text-destructive">
                            {getDaysOverdue(item.due_date)}d overdue
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

                {upcomingInspections.map((insp) => {
                  const overdue = isOverdue(insp.scheduled_date);
                  return (
                    <div
                      key={`insp-${insp.id}`}
                      className={cn(
                        "cursor-pointer p-3 transition-colors hover:bg-muted/50",
                        overdue ? "bg-amber-500/5" : "bg-primary/5",
                      )}
                      onClick={() => handleNavigate("/projects")}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={cn(
                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                            overdue ? "bg-amber-500/20" : "bg-primary/20",
                          )}
                        >
                          <ClipboardCheck
                            className={cn(
                              "h-4 w-4",
                              overdue ? "text-amber-600" : "text-primary",
                            )}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {INSPECTION_TYPE_LABELS[insp.inspection_type]}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {insp.projects.name}
                          </p>
                          <p
                            className={cn(
                              "mt-1 text-xs",
                              overdue ? "font-medium text-amber-600" : "text-muted-foreground",
                            )}
                          >
                            {overdue ? "Overdue - " : ""}
                            {format(new Date(insp.scheduled_date), "MMM d 'at' h:mm a")}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {notifications.map((notification) => (
                  <div
                    key={`notif-${notification.id}`}
                    className={cn(
                      "group relative cursor-pointer p-3 transition-colors hover:bg-muted/50",
                      !notification.is_read && "bg-accent/5",
                    )}
                    onClick={() => !notification.is_read && markAsRead(notification.id)}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/20">
                        <Building className="h-4 w-4 text-accent" />
                      </div>
                      <div className="min-w-0 flex-1">
                        {!notification.is_read && (
                          <div className="absolute right-3 top-3 h-2 w-2 rounded-full bg-accent" />
                        )}
                        <p className="truncate pr-4 text-sm font-medium">
                          {notification.title}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {notification.jurisdiction_name}
                        </p>
                        <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                          {notification.message}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatDate(notification.created_at)}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteNotification(notification.id);
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="inspections" className="mt-0">
            {upcomingInspections.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-muted-foreground">
                <Calendar className="mb-2 h-8 w-8 opacity-50" />
                <p className="text-sm">No upcoming inspections</p>
                <p className="mt-1 text-xs">Schedule inspections from your projects</p>
              </div>
            ) : (
              <div className="divide-y">
                {upcomingInspections.map((insp) => {
                  const overdue = isOverdue(insp.scheduled_date);
                  return (
                    <div
                      key={insp.id}
                      className={cn(
                        "cursor-pointer p-3 transition-colors hover:bg-muted/50",
                        overdue ? "bg-amber-500/5" : "",
                      )}
                      onClick={() => handleNavigate("/projects")}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={cn(
                            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                            overdue ? "bg-amber-500/20" : "bg-primary/10",
                          )}
                        >
                          <ClipboardCheck
                            className={cn(
                              "h-5 w-5",
                              overdue ? "text-amber-600" : "text-primary",
                            )}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">
                            {INSPECTION_TYPE_LABELS[insp.inspection_type]}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {insp.projects.name}
                          </p>
                          <p
                            className={cn(
                              "mt-1 text-sm",
                              overdue ? "font-medium text-amber-600" : "text-muted-foreground",
                            )}
                          >
                            {overdue ? "Overdue - " : ""}
                            {format(new Date(insp.scheduled_date), "EEEE, MMM d 'at' h:mm a")}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="punchlist" className="mt-0">
            {overduePunchItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-muted-foreground">
                <AlertTriangle className="mb-2 h-8 w-8 opacity-50" />
                <p className="text-sm">No overdue items</p>
                <p className="mt-1 text-xs">Great job staying on top of things!</p>
              </div>
            ) : (
              <div className="divide-y">
                {overduePunchItems.map((item) => (
                  <div
                    key={item.id}
                    className="cursor-pointer bg-destructive/5 p-3 transition-colors hover:bg-muted/50"
                    onClick={() => handleNavigate("/projects")}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                          item.priority === "critical"
                            ? "bg-red-500/20"
                            : item.priority === "high"
                              ? "bg-orange-500/20"
                              : "bg-muted",
                        )}
                      >
                        <AlertTriangle
                          className={cn(
                            "h-5 w-5",
                            item.priority === "critical"
                              ? "text-red-600"
                              : item.priority === "high"
                                ? "text-orange-600"
                                : "text-muted-foreground",
                          )}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Badge
                            className={cn(
                              "text-[10px]",
                              PUNCH_LIST_PRIORITY_CONFIG[item.priority].bgColor,
                              PUNCH_LIST_PRIORITY_CONFIG[item.priority].color,
                            )}
                          >
                            {PUNCH_LIST_PRIORITY_CONFIG[item.priority].label}
                          </Badge>
                        </div>
                        <p className="mt-1 text-sm font-medium">{item.title}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {item.projects.name}
                        </p>
                        <p className="mt-1 text-sm font-medium text-destructive">
                          {getDaysOverdue(item.due_date)} day
                          {getDaysOverdue(item.due_date) !== 1 ? "s" : ""} overdue
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </ScrollArea>
      </Tabs>

      <div className="border-t p-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-xs"
          onClick={() => handleNavigate("/projects")}
        >
          View all projects →
        </Button>
      </div>
    </div>
  );
}
