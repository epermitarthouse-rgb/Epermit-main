/**
 * Delivery outcome classification for jurisdiction notifications.
 */

export type JurisdictionDeliveryStatus = "success" | "partial" | "failed" | "no_subscribers";

export interface JurisdictionDeliveryOutcome {
  status: JurisdictionDeliveryStatus;
  inappSent: number;
  emailsSent: number;
  emailsFailed: number;
  totalSubscribers: number;
}

export function classifyJurisdictionDelivery(
  inappSent: number,
  emailsSent: number,
  emailsFailed: number,
  totalSubscribers: number,
  sendEmailRequested: boolean,
): JurisdictionDeliveryOutcome {
  if (totalSubscribers === 0) {
    return {
      status: "no_subscribers",
      inappSent: 0,
      emailsSent: 0,
      emailsFailed: 0,
      totalSubscribers: 0,
    };
  }

  const inappFailed = inappSent === 0 && totalSubscribers > 0;
  const emailAttempted = sendEmailRequested && (emailsSent + emailsFailed > 0 || emailsFailed > 0);
  const emailTotalFailure = sendEmailRequested && emailsSent === 0 && emailsFailed > 0;
  const emailPartial = sendEmailRequested && emailsSent > 0 && emailsFailed > 0;

  if (inappFailed && (!sendEmailRequested || emailTotalFailure)) {
    return {
      status: "failed",
      inappSent,
      emailsSent,
      emailsFailed,
      totalSubscribers,
    };
  }

  if (emailPartial || (inappSent > 0 && emailTotalFailure)) {
    return {
      status: "partial",
      inappSent,
      emailsSent,
      emailsFailed,
      totalSubscribers,
    };
  }

  return {
    status: "success",
    inappSent,
    emailsSent,
    emailsFailed,
    totalSubscribers,
  };
}
