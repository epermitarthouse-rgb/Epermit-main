import { supabase } from "@/lib/supabase";
import { isMissingRpcError } from "@/lib/jurisdictionSubscriptionIntegrity";

export interface NotificationPreferences {
  emailDeadlineReminders: boolean;
  emailInspectionReminders: boolean;
  emailProjectUpdates: boolean;
  emailJurisdictionUpdates: boolean;
  inAppNotifications: boolean;
  inAppJurisdictionUpdates: boolean;
}

export const defaultNotificationPreferences: NotificationPreferences = {
  emailDeadlineReminders: true,
  emailInspectionReminders: true,
  emailProjectUpdates: true,
  emailJurisdictionUpdates: true,
  inAppNotifications: true,
  inAppJurisdictionUpdates: true,
};

type DbPrefs = {
  email_deadline_reminders: boolean;
  email_inspection_reminders: boolean;
  email_project_updates: boolean;
  email_jurisdiction_updates: boolean;
  inapp_notifications: boolean;
  inapp_jurisdiction_updates: boolean;
};

export function dbPrefsToClient(row: DbPrefs): NotificationPreferences {
  return {
    emailDeadlineReminders: row.email_deadline_reminders,
    emailInspectionReminders: row.email_inspection_reminders,
    emailProjectUpdates: row.email_project_updates,
    emailJurisdictionUpdates: row.email_jurisdiction_updates,
    inAppNotifications: row.inapp_notifications,
    inAppJurisdictionUpdates: row.inapp_jurisdiction_updates,
  };
}

export function clientPrefsToDb(prefs: NotificationPreferences): Record<string, boolean> {
  return {
    email_deadline_reminders: prefs.emailDeadlineReminders,
    email_inspection_reminders: prefs.emailInspectionReminders,
    email_project_updates: prefs.emailProjectUpdates,
    email_jurisdiction_updates: prefs.emailJurisdictionUpdates,
    inapp_notifications: prefs.inAppNotifications,
    inapp_jurisdiction_updates: prefs.inAppJurisdictionUpdates,
  };
}

export async function fetchNotificationPreferences(
  userId: string,
): Promise<NotificationPreferences> {
  const { data, error } = await supabase
    .from("notification_preferences")
    .select(
      "email_deadline_reminders, email_inspection_reminders, email_project_updates, email_jurisdiction_updates, inapp_notifications, inapp_jurisdiction_updates",
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (error.code === "PGRST116") {
      return { ...defaultNotificationPreferences };
    }
    if (error.code === "PGRST205" || error.code === "42P01" || isMissingRpcError(error)) {
      return { ...defaultNotificationPreferences };
    }
    throw error;
  }

  if (!data) {
    return { ...defaultNotificationPreferences };
  }

  return dbPrefsToClient(data as DbPrefs);
}

export async function saveNotificationPreferences(
  prefs: NotificationPreferences,
): Promise<void> {
  const { error } = await supabase.rpc("upsert_notification_preferences", {
    p_prefs: clientPrefsToDb(prefs),
  });

  if (error) {
    if (isMissingRpcError(error) || error.code === "PGRST205" || error.code === "42P01") {
      throw new Error("Notification preferences are not available until the platform migration is applied.");
    }
    throw error;
  }
}

export async function unsubscribeJurisdictionEmails(): Promise<void> {
  const { error } = await supabase.rpc("unsubscribe_jurisdiction_emails");
  if (error) {
    throw error;
  }
}
