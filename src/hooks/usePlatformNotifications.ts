import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";

export interface JurisdictionSubscribers {
  jurisdiction_id: string;
  jurisdiction_name: string;
  jurisdiction_state: string;
  subscriber_count: number;
}

export interface BrandingSettings {
  id: string;
  logo_url: string | null;
  primary_color: string;
  header_text: string;
  footer_text: string;
  unsubscribe_text: string;
}

export interface ScheduledNotification {
  id: string;
  jurisdiction_id: string;
  jurisdiction_name: string;
  notification_title: string;
  notification_message: string;
  send_email: boolean;
  scheduled_for: string;
  status: string;
  created_at: string;
}

const defaultBranding: Omit<BrandingSettings, "id"> = {
  logo_url: null,
  primary_color: "#0f766e",
  header_text: "PermitPilot",
  footer_text: "© 2024 PermitPilot. All rights reserved.",
  unsubscribe_text: "Unsubscribe from these notifications",
};

export function usePlatformNotifications() {
  const { user } = useAuth();
  const [jurisdictions, setJurisdictions] = useState<JurisdictionSubscribers[]>([]);
  const [selectedJurisdiction, setSelectedJurisdiction] = useState("");
  const [notificationTitle, setNotificationTitle] = useState("");
  const [notificationMessage, setNotificationMessage] = useState("");
  const [sendEmailNotification, setSendEmailNotification] = useState(true);
  const [sending, setSending] = useState(false);
  const [loadingJurisdictions, setLoadingJurisdictions] = useState(true);
  const [showPreview, setShowPreview] = useState(false);
  const [branding, setBranding] = useState<BrandingSettings | null>(null);
  const [editedBranding, setEditedBranding] =
    useState<Omit<BrandingSettings, "id">>(defaultBranding);
  const [savingBranding, setSavingBranding] = useState(false);
  const [loadingBranding, setLoadingBranding] = useState(true);
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [scheduledNotifications, setScheduledNotifications] = useState<ScheduledNotification[]>(
    [],
  );
  const [loadingScheduled, setLoadingScheduled] = useState(true);

  useEffect(() => {
    if (!user) return;

    async function fetchData() {
      try {
        const { data, error } = await supabase
          .from("jurisdiction_subscriptions")
          .select("jurisdiction_id, jurisdiction_name, jurisdiction_state");

        if (error) throw error;

        const jurisdictionMap = new Map<string, JurisdictionSubscribers>();
        data?.forEach((sub) => {
          const existing = jurisdictionMap.get(sub.jurisdiction_id);
          if (existing) {
            existing.subscriber_count++;
          } else {
            jurisdictionMap.set(sub.jurisdiction_id, {
              jurisdiction_id: sub.jurisdiction_id,
              jurisdiction_name: sub.jurisdiction_name,
              jurisdiction_state: sub.jurisdiction_state,
              subscriber_count: 1,
            });
          }
        });

        setJurisdictions(
          Array.from(jurisdictionMap.values()).sort((a, b) =>
            a.jurisdiction_name.localeCompare(b.jurisdiction_name),
          ),
        );
      } catch (error) {
        console.error("Error fetching jurisdictions:", error);
      } finally {
        setLoadingJurisdictions(false);
      }

      try {
        const { data, error } = await supabase
          .from("email_branding_settings")
          .select("*")
          .limit(1)
          .single();

        if (error && error.code !== "PGRST116") throw error;

        if (data) {
          setBranding(data);
          setEditedBranding({
            logo_url: data.logo_url,
            primary_color: data.primary_color,
            header_text: data.header_text,
            footer_text: data.footer_text,
            unsubscribe_text: data.unsubscribe_text,
          });
        }
      } catch (error) {
        console.error("Error fetching branding:", error);
      } finally {
        setLoadingBranding(false);
      }

      try {
        const { data, error } = await supabase
          .from("scheduled_notifications")
          .select("*")
          .in("status", ["pending", "processing"])
          .order("scheduled_for", { ascending: true });

        if (error) throw error;
        setScheduledNotifications((data as ScheduledNotification[]) || []);
      } catch (error) {
        console.error("Error fetching scheduled notifications:", error);
      } finally {
        setLoadingScheduled(false);
      }
    }

    void fetchData();
  }, [user?.id]);

  const handleSaveBranding = useCallback(async () => {
    setSavingBranding(true);
    try {
      if (branding?.id) {
        const { error } = await supabase
          .from("email_branding_settings")
          .update(editedBranding)
          .eq("id", branding.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("email_branding_settings")
          .insert(editedBranding)
          .select()
          .single();
        if (error) throw error;
        if (data) setBranding(data);
      }

      toast({
        title: "Branding saved",
        description: "Email branding settings have been updated.",
      });
    } catch (error) {
      console.error("Error saving branding:", error);
      toast({
        title: "Error",
        description: "Failed to save branding settings.",
        variant: "destructive",
      });
    } finally {
      setSavingBranding(false);
    }
  }, [branding?.id, editedBranding]);

  const handleSendNotification = useCallback(async () => {
    if (!selectedJurisdiction || !notificationTitle.trim() || !notificationMessage.trim()) {
      toast({
        title: "Missing information",
        description: "Select a jurisdiction and fill in all fields.",
        variant: "destructive",
      });
      return;
    }

    setSending(true);
    try {
      const jurisdiction = jurisdictions.find((j) => j.jurisdiction_id === selectedJurisdiction);
      if (!jurisdiction) throw new Error("Jurisdiction not found");

      const { data: subscribers, error: subError } = await supabase
        .from("jurisdiction_subscriptions")
        .select("user_id")
        .eq("jurisdiction_id", selectedJurisdiction);

      if (subError) throw subError;

      if (!subscribers?.length) {
        toast({
          title: "No subscribers",
          description: "There are no subscribers for this jurisdiction.",
          variant: "destructive",
        });
        return;
      }

      const notifications = subscribers.map((sub) => ({
        user_id: sub.user_id,
        title: notificationTitle,
        message: notificationMessage,
        jurisdiction_id: selectedJurisdiction,
        jurisdiction_name: jurisdiction.jurisdiction_name,
      }));

      const { error: insertError } = await supabase
        .from("jurisdiction_notifications")
        .insert(notifications);
      if (insertError) throw insertError;

      if (sendEmailNotification) {
        const { error: emailErr } = await supabase.functions.invoke(
          "send-jurisdiction-notification",
          {
            body: {
              jurisdictionId: selectedJurisdiction,
              jurisdictionName: jurisdiction.jurisdiction_name,
              title: notificationTitle,
              message: notificationMessage,
            },
          },
        );
        if (emailErr) {
          toast({
            title: "Partial success",
            description: `In-app notifications sent to ${subscribers.length} subscriber(s), but email delivery failed.`,
          });
        } else {
          toast({
            title: "Notifications sent",
            description: `Sent to ${subscribers.length} subscriber(s).`,
          });
        }
      } else {
        toast({
          title: "Notifications sent",
          description: `In-app notifications sent to ${subscribers.length} subscriber(s).`,
        });
      }

      await supabase.from("admin_activity_log").insert({
        admin_user_id: user?.id,
        admin_email: user?.email || "unknown",
        action_type: "notification_sent",
        jurisdiction_id: selectedJurisdiction,
        jurisdiction_name: jurisdiction.jurisdiction_name,
        notification_title: notificationTitle,
        notification_message: notificationMessage,
        subscriber_count: subscribers.length,
        email_sent: sendEmailNotification,
        delivery_status: "success",
      });

      setNotificationTitle("");
      setNotificationMessage("");
      setSelectedJurisdiction("");
    } catch (error) {
      console.error("Error sending notifications:", error);
      toast({
        title: "Error",
        description: "Failed to send notifications.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  }, [
    jurisdictions,
    notificationMessage,
    notificationTitle,
    selectedJurisdiction,
    sendEmailNotification,
    user?.email,
    user?.id,
  ]);

  const handleScheduleNotification = useCallback(async () => {
    if (!selectedJurisdiction || !notificationTitle.trim() || !notificationMessage.trim()) {
      toast({
        title: "Missing information",
        description: "Select a jurisdiction and fill in all fields.",
        variant: "destructive",
      });
      return;
    }

    if (!scheduledDate || !scheduledTime) {
      toast({
        title: "Missing schedule",
        description: "Select a date and time.",
        variant: "destructive",
      });
      return;
    }

    const scheduledFor = new Date(`${scheduledDate}T${scheduledTime}`);
    if (scheduledFor <= new Date()) {
      toast({
        title: "Invalid schedule",
        description: "Scheduled time must be in the future.",
        variant: "destructive",
      });
      return;
    }

    setSending(true);
    try {
      const jurisdiction = jurisdictions.find((j) => j.jurisdiction_id === selectedJurisdiction);
      if (!jurisdiction) throw new Error("Jurisdiction not found");

      const { data, error } = await supabase
        .from("scheduled_notifications")
        .insert({
          admin_user_id: user?.id,
          admin_email: user?.email || "unknown",
          jurisdiction_id: selectedJurisdiction,
          jurisdiction_name: jurisdiction.jurisdiction_name,
          notification_title: notificationTitle,
          notification_message: notificationMessage,
          send_email: sendEmailNotification,
          scheduled_for: scheduledFor.toISOString(),
        })
        .select()
        .single();

      if (error) throw error;

      if (data) {
        setScheduledNotifications((prev) =>
          [...prev, data as ScheduledNotification].sort(
            (a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime(),
          ),
        );
      }

      toast({
        title: "Notification scheduled",
        description: `Will send on ${format(scheduledFor, "MMM d, yyyy")} at ${format(scheduledFor, "h:mm a")}.`,
      });

      setNotificationTitle("");
      setNotificationMessage("");
      setSelectedJurisdiction("");
      setScheduledDate("");
      setScheduledTime("");
      setIsScheduled(false);
    } catch (error) {
      console.error("Error scheduling notification:", error);
      toast({
        title: "Error",
        description: "Failed to schedule notification.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  }, [
    jurisdictions,
    notificationMessage,
    notificationTitle,
    scheduledDate,
    scheduledTime,
    selectedJurisdiction,
    sendEmailNotification,
    user?.email,
    user?.id,
  ]);

  const handleDeleteScheduled = useCallback(async (id: string) => {
    try {
      const { error } = await supabase.from("scheduled_notifications").delete().eq("id", id);
      if (error) throw error;
      setScheduledNotifications((prev) => prev.filter((n) => n.id !== id));
      toast({ title: "Scheduled notification deleted" });
    } catch (error) {
      console.error("Error deleting scheduled notification:", error);
      toast({
        title: "Error",
        description: "Failed to delete scheduled notification.",
        variant: "destructive",
      });
    }
  }, []);

  return {
    jurisdictions,
    selectedJurisdiction,
    setSelectedJurisdiction,
    notificationTitle,
    setNotificationTitle,
    notificationMessage,
    setNotificationMessage,
    sendEmailNotification,
    setSendEmailNotification,
    sending,
    loadingJurisdictions,
    showPreview,
    setShowPreview,
    branding,
    editedBranding,
    setEditedBranding,
    savingBranding,
    loadingBranding,
    handleSaveBranding,
    handleSendNotification,
    handleScheduleNotification,
    handleDeleteScheduled,
    isScheduled,
    setIsScheduled,
    scheduledDate,
    setScheduledDate,
    scheduledTime,
    setScheduledTime,
    scheduledNotifications,
    loadingScheduled,
  };
}
