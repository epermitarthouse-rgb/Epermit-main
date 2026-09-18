/** Fixed onboarding drip sequence — 4 emails over days 1, 3, 5, 7. */
export const ONBOARDING_DRIP_EMAIL_COUNT = 4;

export const ONBOARDING_DRIP_DAY_THRESHOLDS = [1, 3, 5, 7] as const;

export interface DripCampaignRow {
  id: string;
  user_id: string;
  email: string;
  user_name: string | null;
  campaign_type: string;
  enrolled_at: string;
  emails_sent: number;
  last_email_sent_at: string | null;
  is_active: boolean;
  completed_at: string | null;
  created_at: string;
}

export interface DripStats {
  totalEnrolled: number;
  activeCount: number;
  completedCount: number;
  totalEmailsSent: number;
  avgEmailsPerUser: number;
  completionRate: number;
}

export function daysSinceEnrollment(enrolledAt: string | Date, now: Date = new Date()): number {
  const enrolled = enrolledAt instanceof Date ? enrolledAt : new Date(enrolledAt);
  return Math.floor((now.getTime() - enrolled.getTime()) / (1000 * 60 * 60 * 24));
}

/** Index of the next email to send, or null if none due / sequence complete. */
export function resolveNextDripEmailIndex(
  daysSinceEnrolled: number,
  emailsSent: number,
  totalEmails: number = ONBOARDING_DRIP_EMAIL_COUNT,
): number | null {
  if (emailsSent >= totalEmails) {
    return null;
  }

  const requiredDay = ONBOARDING_DRIP_DAY_THRESHOLDS[emailsSent];
  if (requiredDay === undefined) {
    return null;
  }

  // Day 1 sends on enrollment day (daysSinceEnrolled === 0).
  if (daysSinceEnrolled + 1 >= requiredDay) {
    return emailsSent;
  }

  return null;
}

export function isDripCampaignComplete(
  emailsSent: number,
  totalEmails: number = ONBOARDING_DRIP_EMAIL_COUNT,
): boolean {
  return emailsSent >= totalEmails;
}

export function calculateDripStats(campaignData: DripCampaignRow[]): DripStats {
  const totalEnrolled = campaignData.length;
  const activeCount = campaignData.filter((c) => c.is_active).length;
  const completedCount = campaignData.filter((c) => c.completed_at).length;
  const totalEmailsSent = campaignData.reduce((sum, c) => sum + c.emails_sent, 0);
  const avgEmailsPerUser = totalEnrolled > 0 ? totalEmailsSent / totalEnrolled : 0;
  const completionRate = totalEnrolled > 0 ? (completedCount / totalEnrolled) * 100 : 0;

  return {
    totalEnrolled,
    activeCount,
    completedCount,
    totalEmailsSent,
    avgEmailsPerUser,
    completionRate,
  };
}

export function getEmailProgress(emailsSent: number, totalEmails: number = ONBOARDING_DRIP_EMAIL_COUNT) {
  const percentage = totalEmails > 0 ? (emailsSent / totalEmails) * 100 : 0;
  return { percentage, emailsSent, totalEmails };
}
