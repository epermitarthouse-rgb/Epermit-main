import { useState, useEffect, useCallback } from "react";
import { addDays } from "date-fns";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import {
  type InspectionType,
  type PunchListPriority,
} from "@/types/inspection";

export interface JurisdictionNotification {
  id: string;
  jurisdiction_id: string;
  jurisdiction_name: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

export interface UpcomingInspection {
  id: string;
  inspection_type: InspectionType;
  scheduled_date: string;
  project_id: string;
  projects: {
    name: string;
  };
}

export interface OverduePunchItem {
  id: string;
  title: string;
  priority: PunchListPriority;
  due_date: string;
  project_id: string;
  projects: {
    name: string;
  };
}

export function useNotifications() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<JurisdictionNotification[]>([]);
  const [upcomingInspections, setUpcomingInspections] = useState<UpcomingInspection[]>([]);
  const [overduePunchItems, setOverduePunchItems] = useState<OverduePunchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("all");

  const unreadNotifications = notifications.filter((n) => !n.is_read).length;
  const totalAlerts =
    unreadNotifications + upcomingInspections.length + overduePunchItems.length;

  const fetchData = useCallback(async () => {
    if (!user) return;

    setLoading(true);
    try {
      const { data: notifData } = await supabase
        .from("jurisdiction_notifications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20);

      setNotifications(notifData || []);

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

  const markAsRead = async (id: string) => {
    try {
      const { error } = await supabase
        .from("jurisdiction_notifications")
        .update({ is_read: true })
        .eq("id", id);

      if (error) throw error;

      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
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

  return {
    user,
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
  };
}
