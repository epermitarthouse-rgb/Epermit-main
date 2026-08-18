/**
 * User-facing UCI capability / package labels.
 * Internal agent_* / agent-N-* IDs stay in storage; translate before display.
 */

const CAPABILITY_BY_NUM: Record<string, string> = {
  "1": "Utility Provider Mapper",
  "2": "Load Profile Analyzer",
  "3": "Application Builder",
  "4": "Submission and Confirmation Tracker",
};

/** Internal stage / draft id → capability name */
export const UCI_CAPABILITY_STAGE_LABELS: Record<string, string> = {
  agent_1_provider_mapper: "Utility Provider Mapper",
  agent_1_utility_provider: "Utility Provider Mapper",
  agent_1_provider_resolution: "Utility Provider Mapper",
  agent_2_load_profile: "Load Profile Analyzer",
  agent_3_application_package: "Application Builder",
  agent_4_submission: "Submission and Confirmation Tracker",
};

function titleWords(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Translate Agent N / agent_N_* / bare stage ids for operator UI. */
export function formatUciCapabilityLabel(raw: string | null | undefined): string {
  if (raw == null || !String(raw).trim()) return "—";
  const s = String(raw).trim();

  const numbered = s.match(/^agents?\s*[-_]?\s*(\d+)$/i);
  if (numbered) {
    return CAPABILITY_BY_NUM[numbered[1]] ?? `Capability ${numbered[1]}`;
  }

  const normalized = s.replace(/-/g, "_");
  if (UCI_CAPABILITY_STAGE_LABELS[normalized]) {
    return UCI_CAPABILITY_STAGE_LABELS[normalized];
  }
  if (UCI_CAPABILITY_STAGE_LABELS[s]) {
    return UCI_CAPABILITY_STAGE_LABELS[s];
  }

  const prefix = normalized.match(/^agent_(\d+)(?:_|$)/i);
  if (prefix && CAPABILITY_BY_NUM[prefix[1]]) {
    return CAPABILITY_BY_NUM[prefix[1]];
  }

  return titleWords(s);
}

/**
 * e.g. agent-3-reviewed-package-snapshot-v1
 *   → Application Builder · Reviewed package v1
 */
export function formatUciPackageVersionLabel(raw: string | null | undefined): string {
  if (raw == null || !String(raw).trim()) {
    return "Application Builder · Reviewed package";
  }
  const s = String(raw).trim();

  const reviewed = s.match(
    /^agent[-_]?(\d+)[-_]?reviewed[-_]?package(?:[-_]?snapshot)?[-_]?v?(\d+)$/i,
  );
  if (reviewed) {
    const capability = CAPABILITY_BY_NUM[reviewed[1]] ?? formatUciCapabilityLabel(`agent_${reviewed[1]}`);
    return `${capability} · Reviewed package v${reviewed[2]}`;
  }

  const agentPrefixed = s.match(/^agent[-_]?(\d+)[-_](.+)$/i);
  if (agentPrefixed) {
    const capability =
      CAPABILITY_BY_NUM[agentPrefixed[1]] ?? formatUciCapabilityLabel(`agent_${agentPrefixed[1]}`);
    const rest = titleWords(agentPrefixed[2].replace(/\bsnapshot\b/gi, "")).replace(/\s+V(\d+)\b/g, " v$1");
    return `${capability} · ${rest || "Package"}`;
  }

  return titleWords(s);
}

function recipientList(
  to: string | string[] | Array<{ email?: string }> | null | undefined,
): string {
  if (to == null) return "—";
  if (typeof to === "string") return to.trim() || "—";
  if (!Array.isArray(to) || to.length === 0) return "—";
  return (
    to
      .map((r) => (typeof r === "string" ? r : String(r?.email || "").trim()))
      .filter(Boolean)
      .join(", ") || "—"
  );
}

/** Compact primary-UI sent line (no Graph / Stage 5 / internal ids). */
export function formatUciSentSummary(opts: {
  completedAt?: string | null;
  from?: string | null;
  to?: string | string[] | Array<{ email?: string }> | null;
  attachmentCount?: number | null;
}): string {
  const when =
    opts.completedAt && !Number.isNaN(Date.parse(opts.completedAt))
      ? new Date(opts.completedAt).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "—";
  const from = String(opts.from || "").trim() || "—";
  const to = recipientList(opts.to);
  const count = typeof opts.attachmentCount === "number" ? opts.attachmentCount : 0;
  const attachments = count === 1 ? "1 attachment" : `${count} attachments`;
  return `Sent ${when} · ${from} → ${to} · ${attachments}`;
}

/** Strip env/Graph/idempotency/Stage-5 jargon from operator-visible messages. */
export function formatUciOperatorMessage(raw: string | null | undefined, fallback = ""): string {
  if (raw == null || !String(raw).trim()) return fallback;
  let msg = String(raw).trim();

  if (/UCI_EMAIL_LIVE_SUBMISSION_ENABLED|Live email (transmission|submission) is disabled/i.test(msg)) {
    return "Email sending is not enabled in this environment.";
  }
  if (/Mail\.Send permission/i.test(msg)) {
    return "Connect Outlook with send permission to enable email.";
  }
  if (/already recorded as sent|idempotent|not called again/i.test(msg)) {
    return "This transmission was already sent. Create a new transmission to send again.";
  }
  if (/outcome is unknown|refusing blind retry|claim already exists/i.test(msg)) {
    return "A prior send attempt is still open. Create a new transmission or wait for it to finish.";
  }
  if (/must be confirmed_for_transmission/i.test(msg)) {
    return "Confirm the preview before sending.";
  }

  msg = msg
    .replace(/\s*[·•]\s*Stage 5 not advanced\.?/gi, "")
    .replace(/\s*Stage 5 (will )?not advance(ed)?\.?/gi, "")
    .replace(/\s*\(Stage 5 not advanced\)/gi, "")
    .replace(/\s*via Graph\s*\/me\/sendMail/gi, "")
    .replace(/\s*Graph\s+\d{3}/gi, "")
    .replace(/\s*\(idempotent replay\)/gi, "")
    .replace(/\s*Request ID:.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  return msg || fallback;
}
