import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";
import {
  buildAudienceResolution,
  type NotificationPreferenceRow,
} from "./jurisdictionNotificationAudience.ts";
import { classifyJurisdictionDelivery } from "./jurisdictionNotificationDelivery.ts";
import {
  buildJurisdictionNotificationHtml,
  buildUnsubscribeUrl,
  DEFAULT_BRANDING,
  resolveNotificationsFromEmail,
  type BrandingSettings,
} from "./jurisdictionNotificationEmail.ts";

export interface DispatchRequest {
  jurisdictionId: string;
  jurisdictionName: string;
  title: string;
  message: string;
  sendEmail: boolean;
  scheduled?: boolean;
}

export interface DispatchResult {
  success: boolean;
  deliveryStatus: string;
  inappSent: number;
  emailsSent: number;
  emailsFailed: number;
  totalSubscribers: number;
  inAppEligible: number;
  emailEligible: number;
  message?: string;
}

export async function dispatchJurisdictionNotification(
  supabase: SupabaseClient,
  resend: Resend | null,
  request: DispatchRequest,
  options: {
    appBaseUrl: string;
    fromEmailEnv?: string | null;
  },
): Promise<DispatchResult> {
  const { jurisdictionId, jurisdictionName, title, message, sendEmail, scheduled } = request;

  const { data: subscriptions, error: subsError } = await supabase
    .from("jurisdiction_subscriptions")
    .select("user_id")
    .eq("jurisdiction_id", jurisdictionId);

  if (subsError) {
    throw new Error(`Failed to fetch subscribers: ${subsError.message}`);
  }

  if (!subscriptions?.length) {
    return {
      success: true,
      deliveryStatus: "no_subscribers",
      inappSent: 0,
      emailsSent: 0,
      emailsFailed: 0,
      totalSubscribers: 0,
      inAppEligible: 0,
      emailEligible: 0,
      message: "No subscribers found for this jurisdiction",
    };
  }

  const userIds = subscriptions.map((s) => s.user_id);

  const { data: prefRows, error: prefError } = await supabase
    .from("notification_preferences")
    .select("user_id, email_jurisdiction_updates, inapp_jurisdiction_updates, inapp_notifications")
    .in("user_id", userIds);

  if (prefError) {
    throw new Error(`Failed to fetch notification preferences: ${prefError.message}`);
  }

  const preferencesByUser = new Map<string, NotificationPreferenceRow>();
  for (const row of prefRows ?? []) {
    preferencesByUser.set(row.user_id, {
      email_jurisdiction_updates: row.email_jurisdiction_updates,
      inapp_jurisdiction_updates: row.inapp_jurisdiction_updates,
      inapp_notifications: row.inapp_notifications,
    });
  }

  const { data: usersData, error: usersError } = await supabase.auth.admin.listUsers();
  if (usersError) {
    throw new Error(`Failed to fetch user emails: ${usersError.message}`);
  }

  const emailsByUser = new Map<string, string | null>();
  for (const user of usersData.users) {
    if (userIds.includes(user.id)) {
      emailsByUser.set(user.id, user.email ?? null);
    }
  }

  const audience = buildAudienceResolution(subscriptions, preferencesByUser, emailsByUser);
  const inAppRecipients = audience.members.filter((m) => m.receiveInApp);
  const emailRecipients = audience.members.filter((m) => m.receiveEmail && m.email);

  let inappSent = 0;
  if (inAppRecipients.length > 0) {
    const notifications = inAppRecipients.map((member) => ({
      user_id: member.userId,
      title,
      message,
      jurisdiction_id: jurisdictionId,
      jurisdiction_name: jurisdictionName,
    }));

    const { error: insertError } = await supabase
      .from("jurisdiction_notifications")
      .insert(notifications);

    if (insertError) {
      throw new Error(`Failed to insert in-app notifications: ${insertError.message}`);
    }
    inappSent = inAppRecipients.length;
  }

  let emailsSent = 0;
  let emailsFailed = 0;

  if (sendEmail && emailRecipients.length > 0 && resend) {
    const { data: brandingData } = await supabase
      .from("email_branding_settings")
      .select("*")
      .limit(1)
      .maybeSingle();

    const branding: BrandingSettings = brandingData ?? DEFAULT_BRANDING;
    const fromAddress = resolveNotificationsFromEmail(
      options.fromEmailEnv,
      branding.header_text,
    );
    const unsubscribeUrl = buildUnsubscribeUrl(options.appBaseUrl);
    const html = buildJurisdictionNotificationHtml({
      branding,
      title,
      message,
      jurisdictionName,
      scheduled,
      unsubscribeUrl,
    });

    const results = await Promise.allSettled(
      emailRecipients.map((member) =>
        resend.emails.send({
          from: fromAddress,
          to: [member.email!],
          subject: `Code Update: ${title}`,
          html,
        }),
      ),
    );

    emailsSent = results.filter((r) => r.status === "fulfilled").length;
    emailsFailed = results.filter((r) => r.status === "rejected").length;
  }

  const outcome = classifyJurisdictionDelivery(
    inappSent,
    emailsSent,
    emailsFailed,
    audience.totalSubscribers,
    sendEmail,
  );

  return {
    success: outcome.status !== "failed",
    deliveryStatus: outcome.status,
    inappSent: outcome.inappSent,
    emailsSent: outcome.emailsSent,
    emailsFailed: outcome.emailsFailed,
    totalSubscribers: outcome.totalSubscribers,
    inAppEligible: audience.inAppEligible,
    emailEligible: audience.emailEligible,
  };
}
