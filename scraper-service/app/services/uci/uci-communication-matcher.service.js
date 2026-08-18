"use strict";

/**
 * Stage 5 Thread Manager — match inbound messages to coordination records (A5.5–A5.8, §7.4).
 */

/**
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 */
function norm(a) {
  return String(a ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function extractDomain(email) {
  const m = String(email || "")
    .toLowerCase()
    .match(/@([^>\s]+)/);
  return m ? m[1] : "";
}

/**
 * @param {object} inbound
 * @param {Record<string, unknown>} candidate
 * @returns {{ score: number, reasons: string[] }}
 */
function scoreMatch(inbound, candidate) {
  const reasons = [];
  let score = 0;

  const inSubject = norm(inbound.raw_subject);
  const inBody = norm(inbound.raw_body);
  const haystack = `${inSubject} ${inBody}`;
  const sender = norm(inbound.sender);
  const senderDomain = extractDomain(inbound.sender);
  const threadId = norm(inbound.thread_id || inbound.conversation_id);
  const providerSlug = norm(inbound.provider_slug);

  const ticket = norm(candidate.utility_ticket_number || candidate.ticket);
  if (ticket && haystack.includes(ticket)) {
    score += 40;
    reasons.push("ticket_number");
  }

  const account = norm(candidate.utility_account_number);
  if (account && haystack.includes(account)) {
    score += 30;
    reasons.push("account_number");
  }

  const externalApp = norm(candidate.external_application_id);
  if (externalApp && haystack.includes(externalApp)) {
    score += 35;
    reasons.push("external_application_id");
  }

  const jobId = norm(candidate.job_id || candidate.load_control_number || candidate.lc_number);
  if (jobId && haystack.includes(jobId)) {
    score += 30;
    reasons.push("job_or_lc");
  }

  const address = norm(candidate.project_address || candidate.address);
  if (address && address.length >= 8) {
    const parts = address.split(/[,\s]+/).filter((p) => p.length > 3);
    const hit = parts.filter((p) => haystack.includes(p)).length;
    if (hit >= 2 || (parts[0] && haystack.includes(parts[0]) && parts.length === 1)) {
      score += 20;
      reasons.push("project_address");
    }
  }

  const contactEmail = norm(candidate.utility_contact_email);
  if (contactEmail && sender && (sender === contactEmail || sender.includes(contactEmail))) {
    score += 25;
    reasons.push("sender_pm_contact");
  }

  const contactDomain = extractDomain(candidate.utility_contact_email);
  if (contactDomain && senderDomain && contactDomain === senderDomain) {
    score += 10;
    reasons.push("sender_domain");
  }

  const candThread = norm(candidate.thread_id || candidate.outbound_thread_id);
  if (threadId && candThread && threadId === candThread) {
    score += 45;
    reasons.push("thread_id");
  }

  const candProvider = norm(candidate.provider_slug);
  if (providerSlug && candProvider && providerSlug === candProvider) {
    score += 8;
    reasons.push("provider_slug");
  }

  // LC pattern in subject vs known LC on record metadata
  const lcInMessage = haystack.match(/\blc[- ]?(\d{4,})\b/);
  const knownLc = norm(candidate.lc_number || candidate.load_control_number);
  if (lcInMessage && knownLc && knownLc.includes(lcInMessage[1])) {
    score += 35;
    reasons.push("lc_number");
  }

  return { score, reasons };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} inbound
 * @param {{ projectId?: string, tenantId?: string, limit?: number }} [opts]
 */
async function matchInboundToCoordination(supabase, inbound, opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 40, 1), 100);

  let query = supabase
    .from("coordination_records")
    .select(
      "id, project_id, tenant_id, utility_provider_id, utility_account_number, utility_contact_email, utility_contact_name, metadata, current_stage, current_stage_state, acknowledgment_received_at",
    )
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (opts.projectId) query = query.eq("project_id", opts.projectId);
  if (opts.tenantId) query = query.eq("tenant_id", opts.tenantId);

  const { data: records, error } = await query;
  if (error) {
    throw Object.assign(new Error(error.message || "Failed to load coordination candidates"), {
      cause: error,
      statusCode: 500,
      code: "MATCH_CANDIDATES_FAILED",
    });
  }

  const rows = Array.isArray(records) ? records : [];
  if (!rows.length) {
    return {
      matched: false,
      unmatched: true,
      coordination_record_id: null,
      confidence: 0,
      candidates: [],
      reasons: [],
    };
  }

  // Enrich with applications / providers / outbound threads
  const recordIds = rows.map((r) => String(r.id));
  const { data: apps } = await supabase
    .from("coordination_applications")
    .select(
      "id, coordination_record_id, utility_ticket_number, external_application_id, provider_slug, agent_draft_metadata",
    )
    .in("coordination_record_id", recordIds);

  const { data: providers } = await supabase
    .from("utility_providers")
    .select("id, slug")
    .in(
      "id",
      rows.map((r) => r.utility_provider_id).filter(Boolean),
    );

  const providerById = new Map(
    (Array.isArray(providers) ? providers : []).map((p) => [String(p.id), p]),
  );

  const appsByRecord = new Map();
  for (const app of Array.isArray(apps) ? apps : []) {
    const key = String(app.coordination_record_id);
    const list = appsByRecord.get(key) || [];
    list.push(app);
    appsByRecord.set(key, list);
  }

  const { data: outbound } = await supabase
    .from("coordination_communications")
    .select("coordination_record_id, thread_id, external_message_id")
    .in("coordination_record_id", recordIds)
    .eq("direction", "outbound")
    .not("thread_id", "is", null)
    .limit(200);

  const threadByRecord = new Map();
  for (const row of Array.isArray(outbound) ? outbound : []) {
    if (row.thread_id) threadByRecord.set(String(row.coordination_record_id), String(row.thread_id));
  }

  /** @type {Array<{ coordination_record_id: string, project_id: string, score: number, reasons: string[] }>} */
  const scored = [];

  for (const record of rows) {
    const meta =
      record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
        ? /** @type {Record<string, unknown>} */ (record.metadata)
        : {};
    const provider = record.utility_provider_id
      ? providerById.get(String(record.utility_provider_id))
      : null;
    const recordApps = appsByRecord.get(String(record.id)) || [];
    const primaryApp = recordApps[0] || {};

    const candidate = {
      utility_ticket_number: primaryApp.utility_ticket_number,
      utility_account_number: record.utility_account_number,
      utility_contact_email: record.utility_contact_email,
      external_application_id: primaryApp.external_application_id,
      provider_slug: primaryApp.provider_slug || provider?.slug,
      project_address: meta.project_address || meta.site_address || meta.address,
      lc_number: meta.lc_number || meta.load_control_number || meta.LC,
      load_control_number: meta.load_control_number,
      job_id: meta.job_id,
      thread_id: threadByRecord.get(String(record.id)),
      outbound_thread_id: threadByRecord.get(String(record.id)),
    };

    const { score, reasons } = scoreMatch(inbound, candidate);
    if (score > 0) {
      scored.push({
        coordination_record_id: String(record.id),
        project_id: String(record.project_id),
        score,
        reasons,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored[0] || null;
  const second = scored[1] || null;

  // Ambiguous if top two are close
  const ambiguous =
    top && second && top.score - second.score < 10 && second.score >= 25;

  const matched = Boolean(top && top.score >= 25 && !ambiguous);

  return {
    matched,
    unmatched: !matched,
    ambiguous: Boolean(ambiguous),
    coordination_record_id: matched ? top.coordination_record_id : null,
    project_id: matched ? top.project_id : opts.projectId || null,
    confidence: top ? Math.min(1, top.score / 100) : 0,
    reasons: top ? top.reasons : [],
    candidates: scored.slice(0, 5),
  };
}

module.exports = {
  norm,
  extractDomain,
  scoreMatch,
  matchInboundToCoordination,
};
