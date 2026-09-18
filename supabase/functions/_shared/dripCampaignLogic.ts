/** Fixed onboarding drip sequence — mirrored in src/lib/dripCampaignStats.ts for tests. */

export const ONBOARDING_DRIP_EMAIL_COUNT = 4;

export const ONBOARDING_DRIP_DAY_THRESHOLDS = [1, 3, 5, 7] as const;

export function daysSinceEnrollment(enrolledAt: string | Date, now: Date = new Date()): number {
  const enrolled = enrolledAt instanceof Date ? enrolledAt : new Date(enrolledAt);
  return Math.floor((now.getTime() - enrolled.getTime()) / (1000 * 60 * 60 * 24));
}

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
