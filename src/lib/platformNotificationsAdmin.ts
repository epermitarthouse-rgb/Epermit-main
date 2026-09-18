import { supabase } from "@/lib/supabase";

export interface JurisdictionSubscriberSummary {
  jurisdiction_id: string;
  jurisdiction_name: string;
  jurisdiction_state: string;
  subscriber_count: number;
}

export type SubscriberFetchState =
  | { status: "loading" }
  | { status: "ready"; jurisdictions: JurisdictionSubscriberSummary[] }
  | { status: "error"; message: string };

export function isAdminSubscriberFetchError(state: SubscriberFetchState): boolean {
  return state.status === "error";
}

export function isAdminSubscriberEmpty(state: SubscriberFetchState): boolean {
  return state.status === "ready" && state.jurisdictions.length === 0;
}

export async function fetchJurisdictionSubscriberSummary(): Promise<JurisdictionSubscriberSummary[]> {
  const { data, error } = await supabase.rpc("get_jurisdiction_subscriber_summary");

  if (error) {
    throw error;
  }

  return ((data ?? []) as JurisdictionSubscriberSummary[]).map((row) => ({
    jurisdiction_id: row.jurisdiction_id,
    jurisdiction_name: row.jurisdiction_name,
    jurisdiction_state: row.jurisdiction_state,
    subscriber_count: Number(row.subscriber_count),
  }));
}

export interface SendNotificationResult {
  deliveryStatus: string;
  inappSent: number;
  emailsSent: number;
  emailsFailed: number;
  totalSubscribers: number;
  inAppEligible?: number;
  emailEligible?: number;
  message?: string;
}

export async function sendJurisdictionNotification(params: {
  jurisdictionId: string;
  jurisdictionName: string;
  title: string;
  message: string;
  sendEmail: boolean;
}): Promise<SendNotificationResult> {
  const { data, error } = await supabase.functions.invoke("send-jurisdiction-notification", {
    body: {
      jurisdictionId: params.jurisdictionId,
      jurisdictionName: params.jurisdictionName,
      title: params.title,
      message: params.message,
      sendEmail: params.sendEmail,
      logActivity: true,
    },
  });

  if (error) {
    throw error;
  }

  return data as SendNotificationResult;
}

export function formatDeliveryToast(result: SendNotificationResult, sendEmail: boolean): {
  title: string;
  description: string;
  variant?: "destructive" | "default";
} {
  if (result.deliveryStatus === "no_subscribers") {
    return {
      title: "No subscribers",
      description: "There are no subscribers for this jurisdiction.",
      variant: "destructive",
    };
  }

  if (result.deliveryStatus === "failed") {
    return {
      title: "Delivery failed",
      description: `Could not deliver notifications. In-app: ${result.inappSent}, emails: ${result.emailsSent} sent, ${result.emailsFailed} failed.`,
      variant: "destructive",
    };
  }

  if (result.deliveryStatus === "partial") {
    return {
      title: "Partial delivery",
      description: `In-app: ${result.inappSent} | Emails: ${result.emailsSent} sent${result.emailsFailed > 0 ? `, ${result.emailsFailed} failed` : ""}`,
    };
  }

  if (sendEmail) {
    return {
      title: "Notifications sent",
      description: `In-app: ${result.inappSent} | Emails: ${result.emailsSent} sent`,
    };
  }

  return {
    title: "Notifications sent",
    description: `In-app notifications sent to ${result.inappSent} subscriber(s).`,
  };
}
