"use strict";

/**
 * Authoritative utility PM/contact resolver for UCI outbound email and Stage 9 gates.
 *
 * Resolution priority (highest wins for each field):
 * 1. coordination_records columns (utility_contact_*, utility_project_manager) — operator / persisted
 * 2. metadata.stage_5_acknowledgment
 * 3. inbound communications extracted_fields + trusted sender
 * 4. explicit operator entry passed in options
 *
 * Never fabricates email from PM name alone.
 */

const { isRealUtilityPm, normalizeUtilityPm } = require("./uci-ack-acceptance.service.js");
const { updateCoordinationRecordFields } = require("./uci-record-write.service.js");

/** Exact senders that must never become utility contact email. */
const BLOCKED_UTILITY_CONTACT_EMAILS = Object.freeze([
  "epermitarthouse@gmail.com",
]);

/** Domains unsuitable for utility PM outbound (demo / personal / synthetic). */
const BLOCKED_UTILITY_CONTACT_DOMAINS = Object.freeze([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "icloud.com",
  "synthetic-utility.test",
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

function asMeta(record) {
  if (record?.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)) {
    return /** @type {Record<string, unknown>} */ ({ ...record.metadata });
  }
  return {};
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeEmail(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  const angle = raw.match(/<([^>]+)>/);
  const candidate = (angle ? angle[1] : raw).trim();
  if (!EMAIL_RE.test(candidate)) return null;
  return candidate;
}

/**
 * @param {string | null | undefined} email
 */
function extractDomain(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return "";
  const at = normalized.lastIndexOf("@");
  return at >= 0 ? normalized.slice(at + 1) : "";
}

/**
 * @param {string | null | undefined} email
 * @param {{ allowTestDomains?: boolean }} [opts]
 */
function isBlockedUtilityContactEmail(email, opts = {}) {
  const normalized = normalizeEmail(email);
  if (!normalized) return true;
  if (BLOCKED_UTILITY_CONTACT_EMAILS.includes(normalized)) return true;
  const domain = extractDomain(normalized);
  if (!domain) return true;
  if (BLOCKED_UTILITY_CONTACT_DOMAINS.includes(domain)) return true;
  if (!opts.allowTestDomains && (domain.endsWith(".test") || domain.endsWith(".example"))) {
    return true;
  }
  return false;
}

/**
 * @param {string | null | undefined} email
 * @param {{ allowTestDomains?: boolean }} [opts]
 */
function isTrustedUtilityContactEmail(email, opts = {}) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  return !isBlockedUtilityContactEmail(normalized, opts);
}

/**
 * Operator/persisted record emails — block only explicit demo denylist.
 * @param {string | null | undefined} email
 */
function isPersistedUtilityContactEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  if (BLOCKED_UTILITY_CONTACT_EMAILS.includes(normalized)) return false;
  return true;
}

/**
 * @param {string | null | undefined} phone
 */
function normalizePhone(phone) {
  const s = String(phone ?? "").trim();
  return s || null;
}

/**
 * @param {Record<string, unknown>} meta
 */
function extractCommunicationFields(meta) {
  const base = asRecord(meta.extracted_fields);
  const review = asRecord(meta.review_decision);
  const merged = asRecord(review.merged_extracted_fields);
  const reviewer = asRecord(review.reviewer_extracted_fields);
  return { ...base, ...reviewer, ...merged };
}

/**
 * @param {string | null | undefined} text
 */
function extractEmailFromSignature(text) {
  const haystack = String(text ?? "");
  if (!haystack) return null;
  const labeled = haystack.match(
    /\b(?:email|e-mail|contact)\s*[:\-]\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i,
  );
  if (labeled?.[1]) return normalizeEmail(labeled[1]);
  const generic = haystack.match(/\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i);
  return generic?.[1] ? normalizeEmail(generic[1]) : null;
}

/**
 * @param {Array<Record<string, unknown>>} communications
 * @param {{ allowTestDomains?: boolean }} [opts]
 */
function resolveUtilityContactFromCommunications(communications = [], opts = {}) {
  /** @type {{ name: string | null, email: string | null, phone: string | null, source: string | null, confidence: string | null, communicationId: string | null }} */
  let best = {
    name: null,
    email: null,
    phone: null,
    source: null,
    confidence: null,
    communicationId: null,
  };

  for (const comm of communications) {
    if (String(comm.direction || "inbound").toLowerCase() === "outbound") continue;
    const meta = asRecord(comm.agent_processed_metadata);
    if (meta.rejected_irrelevant === true) continue;

    const extracted = extractCommunicationFields(meta);
    const pm = normalizeUtilityPm(extracted.utility_project_manager);
    const extractedEmail = normalizeEmail(
      extracted.utility_contact_email || extracted.contact_email || extracted.pm_email,
    );
    const senderEmail = normalizeEmail(comm.sender);
    const signatureEmail = extractEmailFromSignature(String(comm.raw_body || ""));

    if (!best.name && pm) {
      best = {
        ...best,
        name: pm,
        source: "communication_extracted_fields",
        confidence: "medium",
        communicationId: String(comm.id || ""),
      };
    }

    for (const candidate of [extractedEmail, senderEmail, signatureEmail]) {
      if (candidate && isTrustedUtilityContactEmail(candidate, opts)) {
        best = {
          ...best,
          email: candidate,
          source:
            candidate === senderEmail
              ? "communication_sender"
              : candidate === signatureEmail
                ? "communication_signature"
                : "communication_extracted_fields",
          confidence: candidate === senderEmail ? "high" : "medium",
          communicationId: String(comm.id || best.communicationId || ""),
        };
        break;
      }
    }

    const phone = normalizePhone(extracted.utility_contact_phone || extracted.contact_phone);
    if (!best.phone && phone) {
      best = { ...best, phone };
    }
  }

  return best;
}

/**
 * @param {Record<string, unknown> | null | undefined} record
 * @param {object} [options]
 * @param {Array<Record<string, unknown>>} [options.communications]
 * @param {Record<string, unknown>} [options.operatorEntry]
 * @param {boolean} [options.allowTestDomains]
 */
function resolveUtilityContact(record, options = {}) {
  const { communications = [], operatorEntry = null, allowTestDomains = false } = options;
  const opts = { allowTestDomains };
  const meta = asMeta(record);
  const stage5 = asRecord(meta.stage_5_acknowledgment);
  const commDerived = resolveUtilityContactFromCommunications(communications, opts);
  const operator = asRecord(operatorEntry);

  const recordPm =
    normalizeUtilityPm(record?.utility_project_manager) ||
    normalizeUtilityPm(record?.utility_contact_name);
  const recordEmail = normalizeEmail(record?.utility_contact_email);
  const recordPhone = normalizePhone(record?.utility_contact_phone);

  const stage5Pm = normalizeUtilityPm(stage5.utility_project_manager);
  const stage5Email = normalizeEmail(stage5.utility_contact_email);

  const operatorPm =
    normalizeUtilityPm(operator.utility_contact_name || operator.utility_project_manager) ||
    normalizeUtilityPm(operator.name);
  const operatorEmail = normalizeEmail(operator.utility_contact_email || operator.email);
  const operatorPhone = normalizePhone(operator.utility_contact_phone || operator.phone);

  /** @type {string | null} */
  let name = null;
  /** @type {string | null} */
  let nameSource = null;
  /** @type {string | null} */
  let email = null;
  /** @type {string | null} */
  let emailSource = null;
  /** @type {string | null} */
  let phone = null;
  /** @type {string | null} */
  let phoneSource = null;
  /** @type {string | null} */
  let confidence = null;

  if (recordPm) {
    name = recordPm;
    nameSource = "coordination_record";
    confidence = "high";
  } else if (stage5Pm) {
    name = stage5Pm;
    nameSource = "stage_5_acknowledgment";
    confidence = "high";
  } else if (commDerived.name) {
    name = commDerived.name;
    nameSource = commDerived.source;
    confidence = commDerived.confidence;
  } else if (operatorPm) {
    name = operatorPm;
    nameSource = "operator_entry";
    confidence = "high";
  }

  if (operatorEmail && isPersistedUtilityContactEmail(operatorEmail)) {
    email = operatorEmail;
    emailSource = "operator_entry";
    confidence = "high";
  } else if (recordEmail && isPersistedUtilityContactEmail(recordEmail)) {
    email = recordEmail;
    emailSource = "coordination_record";
    confidence = "high";
  } else if (stage5Email && isTrustedUtilityContactEmail(stage5Email, opts)) {
    email = stage5Email;
    emailSource = "stage_5_acknowledgment";
    confidence = "high";
  } else if (commDerived.email) {
    email = commDerived.email;
    emailSource = commDerived.source;
    confidence = commDerived.confidence;
  }

  if (operatorPhone) {
    phone = operatorPhone;
    phoneSource = "operator_entry";
  } else if (recordPhone) {
    phone = recordPhone;
    phoneSource = "coordination_record";
  } else if (commDerived.phone) {
    phone = commDerived.phone;
    phoneSource = commDerived.source;
  }

  const blocker = deriveUtilityContactBlocker({ name, email });
  const completeForOutbound = Boolean(name && email && !blocker.reason);

  return {
    name,
    pmName: name,
    email,
    phone,
    source: emailSource || nameSource,
    nameSource,
    emailSource,
    phoneSource,
    confidence,
    completeForOutbound,
    blockerReason: blocker.reason,
    blockerMessage: blocker.message,
    provenance: {
      coordination_record: {
        pm: recordPm,
        email: recordEmail,
        phone: recordPhone,
      },
      stage_5_acknowledgment: {
        pm: stage5Pm,
        email: stage5Email,
      },
      communications: commDerived,
      operator_entry: operatorPm || operatorEmail || operatorPhone ? operator : null,
    },
  };
}

/**
 * @param {{ name?: string | null, email?: string | null }} contact
 */
function deriveUtilityContactBlocker(contact) {
  const name = normalizeUtilityPm(contact.name);
  const email = normalizeEmail(contact.email);
  if (!name) {
    return {
      reason: "missing_utility_pm",
      message: "Missing utility PM",
    };
  }
  if (!email) {
    return {
      reason: "missing_utility_contact_email",
      message: "Utility contact email required for outbound meter-set request",
    };
  }
  return { reason: null, message: null };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function updateUtilityContact(supabase, params) {
  const {
    coordinationRecordId,
    utilityContactName,
    utilityContactEmail,
    utilityContactPhone,
    utilityProjectManager,
  } = params;

  const fields = {};
  if (utilityContactName !== undefined) fields.utility_contact_name = utilityContactName ?? null;
  if (utilityProjectManager !== undefined) fields.utility_project_manager = utilityProjectManager ?? null;
  if (utilityContactEmail !== undefined) fields.utility_contact_email = utilityContactEmail ?? null;
  if (utilityContactPhone !== undefined) fields.utility_contact_phone = utilityContactPhone ?? null;

  if (utilityProjectManager === undefined && utilityContactName !== undefined && utilityContactName) {
    fields.utility_project_manager = utilityContactName;
  }

  return updateCoordinationRecordFields(supabase, {
    coordinationRecordId,
    fields,
  });
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} coordinationRecordId
 */
async function loadCoordinationCommunicationsForContact(supabase, coordinationRecordId) {
  const { data, error } = await supabase
    .from("coordination_communications")
    .select("id, direction, sender, raw_body, agent_processed_metadata, message_timestamp")
    .eq("coordination_record_id", coordinationRecordId)
    .order("message_timestamp", { ascending: true });

  if (error) throw Object.assign(new Error(error.message), { statusCode: 500 });
  return Array.isArray(data) ? data : [];
}

/**
 * Persist utility_contact_email when resolver finds a trusted email not yet stored.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function reconcileUtilityContactEmail(supabase, params) {
  const { coordinationRecordId, dryRun = true, allowTestDomains = false } = params;
  const { data: record, error } = await supabase
    .from("coordination_records")
    .select("*")
    .eq("id", coordinationRecordId)
    .maybeSingle();

  if (error) throw Object.assign(new Error(error.message), { statusCode: 500 });
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    throw err;
  }

  const communications = await loadCoordinationCommunicationsForContact(supabase, coordinationRecordId);
  const before = resolveUtilityContact(record, { communications, allowTestDomains });
  const existingEmail = normalizeEmail(record.utility_contact_email);

  if (existingEmail && isPersistedUtilityContactEmail(existingEmail)) {
    return {
      updated: false,
      reason: "already_has_email",
      before,
      after: before,
      persisted: null,
    };
  }

  if (!before.email) {
    return {
      updated: false,
      reason: before.blockerReason || "no_trusted_email_found",
      before,
      after: before,
      persisted: null,
    };
  }

  /** @type {Record<string, unknown>} */
  const fields = { utility_contact_email: before.email };
  if (!normalizeUtilityPm(record.utility_contact_name) && before.name) {
    fields.utility_contact_name = before.name;
  }
  if (!normalizeUtilityPm(record.utility_project_manager) && before.name) {
    fields.utility_project_manager = before.name;
  }

  if (dryRun) {
    const after = resolveUtilityContact(
      { ...record, ...fields },
      { communications, allowTestDomains },
    );
    return {
      updated: true,
      dry_run: true,
      reason: "would_persist",
      before,
      after,
      persisted: fields,
    };
  }

  const result = await updateCoordinationRecordFields(supabase, {
    coordinationRecordId,
    fields,
    metadataPatch: {
      utility_contact_reconciliation: {
        reconciled_at: new Date().toISOString(),
        email_source: before.emailSource,
        email: before.email,
      },
    },
  });

  const after = resolveUtilityContact(result.record, { communications, allowTestDomains });
  return {
    updated: true,
    dry_run: false,
    reason: "persisted",
    before,
    after,
    persisted: fields,
    record: result.record,
  };
}

module.exports = {
  BLOCKED_UTILITY_CONTACT_DOMAINS,
  BLOCKED_UTILITY_CONTACT_EMAILS,
  normalizeEmail,
  extractDomain,
  isBlockedUtilityContactEmail,
  isTrustedUtilityContactEmail,
  isPersistedUtilityContactEmail,
  extractEmailFromSignature,
  resolveUtilityContactFromCommunications,
  resolveUtilityContact,
  deriveUtilityContactBlocker,
  updateUtilityContact,
  loadCoordinationCommunicationsForContact,
  reconcileUtilityContactEmail,
};
