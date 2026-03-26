import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Check, Trash2, Calendar, AlertTriangle, Building, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { format, isBefore, addDays } from "date-fns";
import {
  INSPECTION_TYPE_LABELS,
  PUNCH_LIST_PRIORITY_CONFIG,
  type InspectionType,
  type PunchListPriority,
} from "@/types/inspection";

interface JurisdictionNotification {
  id: string;
  jurisdiction_id: string;
  jurisdiction_name: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

interface UpcomingInspection {
  id: string;
  inspection_type: InspectionType;
  scheduled_date: string;
  project_id: string;
  projects: {
    name: string;
  };
}

interface OverduePunchItem {
  id: string;
  title: string;
  priority: PunchListPriority;
  due_date: string;
  project_id: string;
  projects: {
    name: string;
  };
}

export function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<JurisdictionNotification[]>([]);
  const [upcomingInspections, setUpcomingInspections] = useState<UpcomingInspection[]>([]);
  const [overduePunchItems, setOverduePunchItems] = useState<OverduePunchItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("all");

  const unreadNotifications = notifications.filter((n) => !n.is_read).length;
  const totalAlerts = unreadNotifications + upcomingInspections.length + overduePunchItems.length;

  const fetchData = useCallback(async () => {
    if (!user) return;

    setLoading(true);
    try {
      // Fetch jurisdiction notifications
      const { data: notifData } = await supabase
        .from("jurisdiction_notifications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20);

      setNotifications(notifData || []);

      // Fetch upcoming inspections (next 7 days)
      const nextWeek = addDays(new Date(), 7).toISOString();
      const { data: inspData } = await supabase
        .from("inspections")
        .select(`
          id,
          inspection_type,
          scheduled_date,
          project_id,
          projects!inner (name)
        `)
        .in("status", ["scheduled", "in_progress"])
        .lte("scheduled_date", nextWeek)
        .order("scheduled_date", { ascending: true })
        .limit(10);

      setUpcomingInspections((inspData || []) as unknown as UpcomingInspection[]);

      // Fetch overdue punch list items
      const { data: punchData } = await supabase
        .from("punch_list_items")
        .select(`
          id,
          title,
          priority,
          due_date,
          project_id,
          projects!inner (name)
        `)
        .in("status", ["open", "in_progress"])
        .lt("due_date", new Date().toISOString())
        .not("due_date", "is", null)
        .order("priority", { ascending: false })
        .limit(10);

      setOverduePunchItems((punchData || []) as unknown as OverduePunchItem[]);
    } catch (error) {
      console.error("Error fetching notifications:", error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      fetchData();
    } else {
      setNotifications([]);
      setUpcomingInspections([]);
      setOverduePunchItems([]);
    }
  }, [user, fetchData]);

  // Refresh when popover opens
  useEffect(() => {
    if (isOpen && user) {
      fetchData();
    }
  }, [isOpen, user, fetchData]);

  const markAsRead = async (id: string) => {
    try {
      const { error } = await supabase
        .from("jurisdiction_notifications")
        .update({ is_read: true })
        .eq("id", id);

      if (error) throw error;

      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
    } catch (error) {
      console.error("Error marking notification as read:", error);
    }
  };

  const markAllAsRead = async () => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from("jurisdiction_notifications")
        .update({ is_read: true })
        .eq("user_id", user.id)
        .eq("is_read", false);

      if (error) throw error;

      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      toast({
        title: "All notifications marked as read",
      });
    } catch (error) {
      console.error("Error marking all as read:", error);
    }
  };

  const deleteNotification = async (id: string) => {
    try {
      const { error } = await supabase
        .from("jurisdiction_notifications")
        .delete()
        .eq("id", id);

      if (error) throw error;

      setNotifications((prev) => prev.filter((n) => n.id !== id));
    } catch (error) {
      console.error("Error deleting notification:", error);
    }
  };

  const formatDate = (dateString: string) => {
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
  };

  const isOverdue = (dateStr: string) => {
    return isBefore(new Date(dateStr), new Date());
  };

  const getDaysOverdue = (dateStr: string) => {
    const dueDate = new Date(dateStr);
    const now = new Date();
    return Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
  };

  if (!user) return null;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {totalAlerts > 0 && (
            <Badge
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
              variant="destructive"
            >
              {totalAlerts > 9 ? "9+" : totalAlerts}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0 bg-background border shadow-lg z-50" align="end">
        <div className="flex items-center justify-between p-3 border-b">
          <h4 className="font-semibold">Notifications</h4>
          {unreadNotifications > 0 && (
            <Button variant="ghost" size="sm" onClick={markAllAsRead}>
              <Check className="h-4 w-4 mr-1" />
              Mark all read
            </Button>
          )}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3 h-auto p-1 bg-muted/50">
            <TabsTrigger value="all" className="text-xs gap-1 py-1.5">
              All
              {totalAlerts > 0 && (
                <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                  {totalAlerts}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="inspections" className="text-xs gap-1 py-1.5">
              <Calendar className="h-3 w-3" />
              {upcomingInspections.length > 0 && (
                <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                  {upcomingInspections.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="punchlist" className="text-xs gap-1 py-1.5">
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
                  <Bell className="h-8 w-8 mb-2 opacity-50" />
                  <p className="text-sm">No notifications</p>
                  <p className="text-xs mt-1">You're all caught up!</p>
                </div>
              ) : (
                <div className="divide-y">
                  {/* Overdue punch items first */}
                  {overduePunchItems.map((item) => (
                    <div
                      key={`punch-${item.id}`}
                      className="p-3 hover:bg-muted/50 transition-colors cursor-pointer bg-destructive/5"
                      onClick={() => {
                        setIsOpen(false);
                        navigate("/projects");
                      }}
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg bg-destructive/20 flex items-center justify-center shrink-0">
                          <AlertTriangle className="h-4 w-4 text-destructive" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{item.title}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {item.projects.name}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge className={cn("text-[10px]", PUNCH_LIST_PRIORITY_CONFIG[item.priority].bgColor, PUNCH_LIST_PRIORITY_CONFIG[item.priority].color)}>
                              {PUNCH_LIST_PRIORITY_CONFIG[item.priority].label}
                            </Badge>
                            <span className="text-xs text-destructive font-medium">
                              {getDaysOverdue(item.due_date)}d overdue
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Upcoming inspections */}
                  {upcomingInspections.map((insp) => {
                    const overdue = isOverdue(insp.scheduled_date);
                    return (
                      <div
                        key={`insp-${insp.id}`}
                        className={cn(
                          "p-3 hover:bg-muted/50 transition-colors cursor-pointer",
                          overdue ? "bg-amber-500/5" : "bg-primary/5"
                        )}
                        onClick={() => {
                          setIsOpen(false);
                          navigate("/projects");
                        }}
                      >
                        <div className="flex items-start gap-3">
                          <div className={cn(
                            "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                            overdue ? "bg-amber-500/20" : "bg-primary/20"
                          )}>
                            <ClipboardCheck className={cn("h-4 w-4", overdue ? "text-amber-600" : "text-primary")} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">
                              {INSPECTION_TYPE_LABELS[insp.inspection_type]}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {insp.projects.name}
                            </p>
                            <p className={cn("text-xs mt-1", overdue ? "text-amber-600 font-medium" : "text-muted-foreground")}>
                              {overdue ? "Overdue - " : ""}{format(new Date(insp.scheduled_date), "MMM d 'at' h:mm a")}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* Jurisdiction notifications */}
                  {notifications.map((notification) => (
                    <div
                      key={`notif-${notification.id}`}
                      className={cn(
                        "p-3 hover:bg-muted/50 transition-colors cursor-pointer relative group",
                        !notification.is_read && "bg-accent/5"
                      )}
                      onClick={() => !notification.is_read && markAsRead(notification.id)}
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center shrink-0">
                          <Building className="h-4 w-4 text-accent" />
                        </div>
                        <div className="flex-1 min-w-0">
                          {!notification.is_read && (
                            <div className="absolute top-3 right-3 w-2 h-2 rounded-full bg-accent" />
                          )}
                          <p className="font-medium text-sm truncate pr-4">
                            {notification.title}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {notification.jurisdiction_name}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                            {notification.message}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {formatDate(notification.created_at)}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
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
                  <Calendar className="h-8 w-8 mb-2 opacity-50" />
                  <p className="text-sm">No upcoming inspections</p>
                  <p className="text-xs mt-1">Schedule inspections from your projects</p>
                </div>
              ) : (
                <div className="divide-y">
                  {upcomingInspections.map((insp) => {
                    const overdue = isOverdue(insp.scheduled_date);
                    return (
                      <div
                        key={insp.id}
                        className={cn(
                          "p-3 hover:bg-muted/50 transition-colors cursor-pointer",
                          overdue ? "bg-amber-500/5" : ""
                        )}
                        onClick={() => {
                          setIsOpen(false);
                          navigate("/projects");
                        }}
                      >
                        <div className="flex items-start gap-3">
                          <div className={cn(
                            "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                            overdue ? "bg-amber-500/20" : "bg-primary/10"
                          )}>
                            <ClipboardCheck className={cn("h-5 w-5", overdue ? "text-amber-600" : "text-primary")} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm">
                              {INSPECTION_TYPE_LABELS[insp.inspection_type]}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {insp.projects.name}
                            </p>
                            <p className={cn("text-sm mt-1", overdue ? "text-amber-600 font-medium" : "text-muted-foreground")}>
                              {overdue ? "⚠️ Overdue - " : "📅 "}{format(new Date(insp.scheduled_date), "EEEE, MMM d 'at' h:mm a")}
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
                  <AlertTriangle className="h-8 w-8 mb-2 opacity-50" />
                  <p className="text-sm">No overdue items</p>
                  <p className="text-xs mt-1">Great job staying on top of things!</p>
                </div>
              ) : (
                <div className="divide-y">
                  {overduePunchItems.map((item) => (
                    <div
                      key={item.id}
                      className="p-3 hover:bg-muted/50 transition-colors cursor-pointer bg-destructive/5"
                      onClick={() => {
                        setIsOpen(false);
                        navigate("/projects");
                      }}
                    >
                      <div className="flex items-start gap-3">
                        <div className={cn(
                          "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                          item.priority === "critical" ? "bg-red-500/20" : 
                          item.priority === "high" ? "bg-orange-500/20" : "bg-muted"
                        )}>
                          <AlertTriangle className={cn(
                            "h-5 w-5",
                            item.priority === "critical" ? "text-red-600" : 
                            item.priority === "high" ? "text-orange-600" : "text-muted-foreground"
                          )} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Badge className={cn("text-[10px]", PUNCH_LIST_PRIORITY_CONFIG[item.priority].bgColor, PUNCH_LIST_PRIORITY_CONFIG[item.priority].color)}>
                              {PUNCH_LIST_PRIORITY_CONFIG[item.priority].label}
                            </Badge>
                          </div>
                          <p className="font-medium text-sm mt-1">{item.title}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {item.projects.name}
                          </p>
                          <p className="text-sm text-destructive font-medium mt-1">
                            ⏰ {getDaysOverdue(item.due_date)} day{getDaysOverdue(item.due_date) !== 1 ? "s" : ""} overdue
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

        <div className="p-2 border-t">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs"
            onClick={() => {
              setIsOpen(false);
              navigate("/projects");
            }}
          >
            View all projects →
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
