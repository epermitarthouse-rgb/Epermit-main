import type { CoordinationCommunication, CoordinationRecord } from "@/types/uci";

export type UtilityContactBlockerReason = "missing_utility_pm" | "missing_utility_contact_email" | null;

export interface ResolvedUtilityContact {
  name: string | null;
  pmName: string | null;
  email: string | null;
  phone: string | null;
  completeForOutbound: boolean;
  blockerReason: UtilityContactBlockerReason;
  blockerMessage: string | null;
  nameSource: string | null;
  emailSource: string | null;
}

const BLOCKED_EMAILS = new Set(["epermitarthouse@gmail.com"]);
const BLOCKED_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "icloud.com",
  "synthetic-utility.test",
]);

const PM_PLACEHOLDER = /^(pending(\s+utility)?(\s+contact)?|tbd|n\/?a|unknown|none|null|-+|not\s+(yet\s+)?assigned|awaiting(\s+assignment)?)$/i;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeEmail(value: unknown): string | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  const angle = raw.match(/<([^>]+)>/);
  const candidate = (angle ? angle[1] : raw).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(candidate)) return null;
  return candidate;
}

function extractDomain(email: string | null | undefined): string {
  const normalized = normalizeEmail(email);
  if (!normalized) return "";
  const at = normalized.lastIndexOf("@");
  return at >= 0 ? normalized.slice(at + 1) : "";
}

export function isPersistedUtilityContactEmail(email: string | null | undefined): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  if (BLOCKED_EMAILS.has(normalized)) return false;
  return true;
}

export function isTrustedUtilityContactEmail(
  email: string | null | undefined,
  opts: { allowTestDomains?: boolean } = {},
): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  if (BLOCKED_EMAILS.has(normalized)) return false;
  const domain = extractDomain(normalized);
  if (!domain || BLOCKED_DOMAINS.has(domain)) return false;
  if (!opts.allowTestDomains && (domain.endsWith(".test") || domain.endsWith(".example"))) {
    return false;
  }
  return true;
}

export function hasRealUtilityPm(value: unknown): boolean {
  const s = String(value ?? "").trim();
  if (!s) return false;
  return !PM_PLACEHOLDER.test(s);
}

function normalizePm(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return hasRealUtilityPm(s) ? s : null;
}

function extractCommunicationFields(meta: Record<string, unknown>): Record<string, unknown> {
  const base = asRecord(meta.extracted_fields);
  const review = asRecord(meta.review_decision);
  const merged = asRecord(review.merged_extracted_fields);
  const reviewer = asRecord(review.reviewer_extracted_fields);
  return { ...base, ...reviewer, ...merged };
}

function extractEmailFromSignature(text: string): string | null {
  if (!text) return null;
  const labeled = text.match(
    /\b(?:email|e-mail|contact)\s*[:\-]\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i,
  );
  if (labeled?.[1]) return normalizeEmail(labeled[1]);
  const generic = text.match(/\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i);
  return generic?.[1] ? normalizeEmail(generic[1]) : null;
}

function resolveFromCommunications(
  communications: CoordinationCommunication[] = [],
): Pick<ResolvedUtilityContact, "name" | "email" | "phone" | "nameSource" | "emailSource"> {
  let name: string | null = null;
  let email: string | null = null;
  let phone: string | null = null;
  let nameSource: string | null = null;
  let emailSource: string | null = null;

  for (const comm of communications) {
    if (String(comm.direction || "inbound").toLowerCase() === "outbound") continue;
    const meta = asRecord(comm.agent_processed_metadata);
    if (meta.rejected_irrelevant === true) continue;
    const extracted = extractCommunicationFields(meta);
    const pm = normalizePm(extracted.utility_project_manager);
    const extractedEmail = normalizeEmail(
      extracted.utility_contact_email || extracted.contact_email || extracted.pm_email,
    );
    const senderEmail = normalizeEmail(comm.sender);
    const signatureEmail = extractEmailFromSignature(String(comm.raw_body || ""));

    if (!name && pm) {
      name = pm;
      nameSource = "communication_extracted_fields";
    }

    for (const candidate of [extractedEmail, senderEmail, signatureEmail]) {
      if (candidate && isTrustedUtilityContactEmail(candidate)) {
        email = candidate;
        emailSource =
          candidate === senderEmail
            ? "communication_sender"
            : candidate === signatureEmail
              ? "communication_signature"
              : "communication_extracted_fields";
        break;
      }
    }

    const commPhone = String(extracted.utility_contact_phone || extracted.contact_phone || "").trim();
    if (!phone && commPhone) phone = commPhone;
  }

  return { name, email, phone, nameSource, emailSource };
}

export function deriveUtilityContactBlocker(contact: {
  name?: string | null;
  email?: string | null;
}): { reason: UtilityContactBlockerReason; message: string | null } {
  const name = normalizePm(contact.name);
  const email = normalizeEmail(contact.email);
  if (!name) {
    return { reason: "missing_utility_pm", message: "Missing utility PM" };
  }
  if (!email) {
    return {
      reason: "missing_utility_contact_email",
      message: "Utility contact email required for outbound meter-set request",
    };
  }
  return { reason: null, message: null };
}

export function resolveUtilityContact(params: {
  record?: CoordinationRecord | null;
  communications?: CoordinationCommunication[];
  operatorEntry?: {
    utility_contact_name?: string;
    utility_project_manager?: string;
    utility_contact_email?: string;
    utility_contact_phone?: string;
  };
}): ResolvedUtilityContact {
  const { record, communications = [], operatorEntry } = params;
  const meta = asRecord(record?.metadata);
  const stage5 = asRecord(meta.stage_5_acknowledgment);
  const commDerived = resolveFromCommunications(communications);
  const operator = operatorEntry || {};

  const recordPm =
    normalizePm(record?.utility_project_manager) || normalizePm(record?.utility_contact_name);
  const recordEmail = normalizeEmail(record?.utility_contact_email);
  const recordPhone = String(record?.utility_contact_phone || "").trim() || null;

  const stage5Pm = normalizePm(stage5.utility_project_manager);
  const stage5Email = normalizeEmail(stage5.utility_contact_email);

  const operatorPm =
    normalizePm(operator.utility_project_manager) || normalizePm(operator.utility_contact_name);
  const operatorEmail = normalizeEmail(operator.utility_contact_email);
  const operatorPhone = String(operator.utility_contact_phone || "").trim() || null;

  let name: string | null = null;
  let nameSource: string | null = null;
  let email: string | null = null;
  let emailSource: string | null = null;
  let phone: string | null = null;

  if (recordPm) {
    name = recordPm;
    nameSource = "coordination_record";
  } else if (stage5Pm) {
    name = stage5Pm;
    nameSource = "stage_5_acknowledgment";
  } else if (commDerived.name) {
    name = commDerived.name;
    nameSource = commDerived.nameSource;
  } else if (operatorPm) {
    name = operatorPm;
    nameSource = "operator_entry";
  }

  if (operatorEmail && isPersistedUtilityContactEmail(operatorEmail)) {
    email = operatorEmail;
    emailSource = "operator_entry";
  } else if (recordEmail && isPersistedUtilityContactEmail(recordEmail)) {
    email = recordEmail;
    emailSource = "coordination_record";
  } else if (stage5Email && isTrustedUtilityContactEmail(stage5Email)) {
    email = stage5Email;
    emailSource = "stage_5_acknowledgment";
  } else if (commDerived.email) {
    email = commDerived.email;
    emailSource = commDerived.emailSource;
  }

  if (operatorPhone) phone = operatorPhone;
  else if (recordPhone) phone = recordPhone;
  else if (commDerived.phone) phone = commDerived.phone;

  const blocker = deriveUtilityContactBlocker({ name, email });
  return {
    name,
    pmName: name,
    email,
    phone,
    completeForOutbound: Boolean(name && email && !blocker.reason),
    blockerReason: blocker.reason,
    blockerMessage: blocker.message,
    nameSource,
    emailSource,
  };
}

export function utilityContactBlockerLabel(reason: UtilityContactBlockerReason): string | null {
  if (reason === "missing_utility_pm") return "Missing utility PM";
  if (reason === "missing_utility_contact_email") {
    return "Utility contact email required for outbound meter-set request";
  }
  return null;
}
