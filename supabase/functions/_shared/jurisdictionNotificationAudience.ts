/**
 * Unified jurisdiction notification audience resolution (in-app + email channels).
 */

export interface NotificationPreferenceRow {
  email_jurisdiction_updates: boolean;
  inapp_jurisdiction_updates: boolean;
  inapp_notifications: boolean;
}

export interface ResolvedAudienceMember {
  userId: string;
  email: string | null;
  receiveInApp: boolean;
  receiveEmail: boolean;
}

export interface AudienceResolution {
  members: ResolvedAudienceMember[];
  totalSubscribers: number;
  inAppEligible: number;
  emailEligible: number;
}

export function resolveChannelPreferences(
  prefs: NotificationPreferenceRow | null | undefined,
): { receiveInApp: boolean; receiveEmail: boolean } {
  const inappMaster = prefs?.inapp_notifications ?? true;
  const inappJurisdiction = prefs?.inapp_jurisdiction_updates ?? true;
  const emailJurisdiction = prefs?.email_jurisdiction_updates ?? true;

  return {
    receiveInApp: inappMaster && inappJurisdiction,
    receiveEmail: emailJurisdiction,
  };
}

export function buildAudienceResolution(
  subscribers: { user_id: string }[],
  preferencesByUser: Map<string, NotificationPreferenceRow>,
  emailsByUser: Map<string, string | null>,
): AudienceResolution {
  const members: ResolvedAudienceMember[] = subscribers.map((sub) => {
    const prefs = preferencesByUser.get(sub.user_id);
    const channels = resolveChannelPreferences(prefs);
    return {
      userId: sub.user_id,
      email: emailsByUser.get(sub.user_id) ?? null,
      receiveInApp: channels.receiveInApp,
      receiveEmail: channels.receiveEmail,
    };
  });

  return {
    members,
    totalSubscribers: members.length,
    inAppEligible: members.filter((m) => m.receiveInApp).length,
    emailEligible: members.filter((m) => m.receiveEmail && !!m.email).length,
  };
}
