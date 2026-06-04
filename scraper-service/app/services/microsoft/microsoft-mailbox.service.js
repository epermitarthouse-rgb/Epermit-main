"use strict";

const {
  getValidAccessTokenForUser,
  touchMailboxLastCheckedAt,
} = require("./microsoft-graph-auth.service.js");

const MFA_EMAIL_POLL_INTERVAL_MS = 4000;

/**
 * @param {unknown} fromField
 */
function senderAddress(fromField) {
  const addr =
    fromField &&
    typeof fromField === "object" &&
    fromField !== null &&
    "emailAddress" in fromField &&
    /** @type {{ emailAddress?: { address?: string } }} */ (fromField).emailAddress;
  const a =
    typeof addr?.address === "string" ? String(addr.address).trim().toLowerCase() : "";
  return a;
}

function stripMarkupish(htmlish) {
  return String(htmlish ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function looksYearishDigits(digits) {
  const n = Number(digits);
  return Number.isInteger(n) && n >= 1900 && n <= 2100;
}

/**
 * @returns {boolean}
 */
function isCandidateDigitToken(tok) {
  if (!tok || typeof tok !== "string") return false;
  if (!/^\d+$/.test(tok)) return false;
  const len = tok.length;
  if (!(len >= 4 && len <= 8)) return false;
  if (len === 4 && looksYearishDigits(tok)) return false;
  return true;
}

/**
 * Normalize mail text for phrase matching (never persisted).
 *
 * @param {string} text
 */
function normalizeMailBlob(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/\u2019|\u2018/g, "'")
    .toLowerCase();
}

/**
 * Live Outlook PEPCO MFA template (confirmed): no-reply@pepco.com
 *
 * @param {string} senderLower from senderAddress()
 */
function senderIsNoReplyPepco(senderLower) {
  return String(senderLower || "").includes("no-reply@pepco.com");
}

/**
 * Subject contains "Verification Code" (case-insensitive).
 *
 * @param {string} subject
 */
function subjectHasVerificationCode(subject) {
  return /verification\s+code/i.test(String(subject || ""));
}

/**
 * Body/subject blob (already lowercased via normalizeMailBlob) contains PEPCO phrase variants.
 *
 * @param {string} blobLower
 */
function textHasSixDigitVerificationPhrase(blobLower) {
  return (
    blobLower.includes("six-digit verification code") ||
    blobLower.includes("six digit verification code")
  );
}

/**
 * Fallback heuristics for non-template MFA mail (Microsoft / Exelon / PEPCO wording).
 *
 * @returns {boolean}
 */
function legacyCorpusLooksLikePotentialPepcoMfa(subject, snippet) {
  const blob = `${String(subject ?? "")}\n${String(snippet ?? "")}`.toLowerCase();

  const senderish = /\b(pepco|exelon|microsoft|azure|no-?reply|security|verification)\b/i.test(blob);

  const topicish =
    /verification code|security code|one[- ]time|sign[- ]in|authenticate|verification|passcode|\botp\b|\bPIN\b|\bPIN:/i.test(
      blob,
    );

  const brandish =
    /\bpepco\b|\bexelon\b|\bsign in was attempted\b|\bverification code\b/i.test(blob);

  return (senderish || brandish) && (topicish || brandish || /\bmfa\b|\bapprove\b|\bverify\b/i.test(blob));
}

/**
 * Lower rank = evaluate earlier (confirmed PEPCO template first).
 *
 * @returns {number} 0–3
 */
function pepcoMfaPriority(senderAddr, subject, snippet) {
  const senderLower = String(senderAddr || "").toLowerCase();
  const blob = normalizeMailBlob(`${subject}\n${snippet}`);

  const fromPepco = senderIsNoReplyPepco(senderLower);
  const subjOk = subjectHasVerificationCode(subject);
  const phraseOk = textHasSixDigitVerificationPhrase(blob);

  /** Fully confirmed visible in preview/subject/snippet */
  if (fromPepco && subjOk && phraseOk) return 0;
  /** Likely PEPCO verification mail — phrase often only in full body */
  if (fromPepco && subjOk) return 1;
  if (legacyCorpusLooksLikePotentialPepcoMfa(subject, snippet)) return 2;
  return 3;
}

function shouldAttemptPepcoMfaExtraction(senderAddr, subject, snippet) {
  return pepcoMfaPriority(senderAddr, subject, snippet) < 3;
}

/**
 * PEPCO template: "six-digit verification code" then six digits nearby (e.g. 073099).
 * Caller must not log the return value.
 *
 * @param {string} text subject + body (any case)
 * @returns {string | null} exactly six digits or null
 */
function extractSixDigitNearPepcoPhrase(text) {
  const t = String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/\u2019|\u2018/g, "'");
  const re = /six[\s\-‐‑]digit\s+verification\s+code/gi;
  let m;
  while ((m = re.exec(t)) !== null) {
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 160);
    const bounded = after.match(/(?:^|[^\d])(\d{6})(?:[^\d]|$)/);
    if (bounded) return bounded[1];
    const loose = after.match(/(\d{6})/);
    if (loose) return loose[1];
  }
  return null;
}

/**
 * Prefer PEPCO phrase-local six-digit extraction, then legacy labeled/generic scans.
 *
 * Never logs `text` externally.
 *
 * @param {string} text
 * @returns {string | null}
 */
function extractVerificationCodeFromCombinedText(text) {
  const phraseSix = extractSixDigitNearPepcoPhrase(text);
  if (phraseSix && /^\d{6}$/.test(phraseSix)) return phraseSix;

  const t = text.replace(/\u00a0/g, " ");
  /** @type {{ code: string, score: number }[]} */
  const scored = [];

  const labeledSix = [...t.matchAll(/\b(?:code|verification|security|OTP|OTP:|PIN)[^0-9\n]{0,80}?(\d{6})\b/gi)];
  for (const m of labeledSix) if (m[1]) scored.push({ code: m[1], score: 100 });

  const genericSix = [...t.matchAll(/\b(\d{6})\b/g)];
  for (const m of genericSix) {
    if (!m[1]) continue;
    const idx = typeof m.index === "number" ? m.index : 0;
    const window = t.slice(Math.max(0, idx - 6), Math.min(t.length, idx + 12));
    /** @example skip common time fragments like 12:34:56 */
    if (/\d{1,2}:\d{2}:\d{2}/.test(window)) continue;
    scored.push({ code: m[1], score: 55 });
  }

  /** @example 5–8 digit tokens that are not obvious years */
  const wideDigit = [...t.matchAll(/\b(\d{4,8})\b/g)];
  for (const m of wideDigit) {
    const cand = m[1];
    if (!isCandidateDigitToken(cand)) continue;
    scored.push({ code: cand, score: cand.length === 6 ? 50 : cand.length <= 8 ? 30 : 10 });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.length ? scored[0].code : null;
}
/** @typedef {{ status: string, message?: string }} GraphErrorBody */

/** @typedef {{ status: string, message?: string }} GraphEnvelope */

/**
 * @param {unknown} envelope
 */
function graphResponseMessage(envelope, fallbackHttp) {
  if (!envelope || typeof envelope !== "object") return `graph_http_${fallbackHttp}`;
  const e = /** @type {GraphEnvelope} */ (envelope).error;
  if (typeof e === "object" && e && typeof /** @type {{ message?: unknown }} */ (e).message === "string") {
    return String(/** @type {{ message?: string }} */ (e).message).slice(0, 200);
  }
  if (typeof /** @type {GraphErrorBody & { status?: unknown }} */ (envelope).message === "string") {
    return String(/** @type {GraphErrorBody} */ (envelope).message).slice(0, 200);
  }
  return `graph_http_${fallbackHttp}`;
}

/**
 * @param {string} accessToken
 * @param {string} iso
 */
function buildMailboxQueryUrl(top, iso) {
  const base =
    `https://graph.microsoft.com/v1.0/me/messages` +
    `?$top=${encodeURIComponent(String(top))}` +
    `&$orderby=${encodeURIComponent("receivedDateTime desc")}` +
    `&$select=${encodeURIComponent("id,receivedDateTime,subject,bodyPreview,from")}`;

  if (iso) {
    const filterExpr = `receivedDateTime ge ${iso}`;
    return `${base}&$filter=${encodeURIComponent(filterExpr)}`;
  }

  return base;
}

/**
 * @param {string} accessToken
 * @param {string} relativeUrl Full URL (absolute)
 */
async function graphFetchJson(accessToken, absoluteUrlStr) {
  const r = await fetch(absoluteUrlStr, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      Prefer: 'outlook.body-content-type="text"',
    },
  });
  const text = await r.text();
  /** @type {unknown} */
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { message: "(non-json response)" };
  }
  return { ok: r.ok, status: r.status, json };
}

/**
 * @returns {Promise<unknown[]>}
 */
async function listRecentMessagesEnvelope(accessToken, top, receivedAfterIso) {
  let urlStr = buildMailboxQueryUrl(top, receivedAfterIso || null);

  /** @type {{ ok: boolean, status: number, json: unknown }} */
  let first = await graphFetchJson(accessToken, urlStr);
  /** If filter too strict — retry wider */
  const errCode =
    first.json &&
    typeof first.json === "object" &&
    first.json !== null &&
    typeof /** @type {{ error?: { code?: unknown } }} */ (first.json).error?.code === "string"
      ? String(/** @type {{ error?: { code?: string } }} */ (first.json).error?.code || "")
      : "";

  const shouldRetryBroad =
    !first.ok &&
    !!receivedAfterIso &&
    (/Request_UnsupportedQuery|BadRequest/i.test(errCode || "") ||
      (/400|415/.test(String(first.status)) && first.status === 400));

  if (shouldRetryBroad) {
    urlStr = buildMailboxQueryUrl(top, null);
    first = await graphFetchJson(accessToken, urlStr);
  }

  if (!first.ok || !first.json || typeof first.json !== "object") {
    const err = new Error(graphResponseMessage(first.json, first.status));
    /** @type {Error & { code?: string }} */ (err).code = "MS_GRAPH_MAIL_FETCH_FAILED";
    throw err;
  }

  const value = /** @type {{ value?: unknown }} */ (first.json).value;
  return Array.isArray(value) ? value : [];
}

/**
 * @param {unknown} mes
 */
function corpusFromListedMessageItem(mes) {
  const m = mes && typeof mes === "object" ? mes : {};
  const subject = typeof m.subject === "string" ? m.subject : "";
  const pv = typeof m.bodyPreview === "string" ? m.bodyPreview : "";

  let fromBody = "";
  if (
    "body" in m &&
    m.body &&
    typeof m.body === "object" &&
    typeof /** @type {{ content?: unknown }} */ (m.body).content === "string"
  ) {
    fromBody = stripMarkupish(String(/** @type {{ content?: string }} */ (m.body).content));
  }

  const snippet = pv || fromBody;
  const fromField = "from" in m ? m.from : null;

  return {
    sender: senderAddress(fromField),
    subject,
    snippet,
    id: typeof m.id === "string" ? m.id : "",
    received: typeof m.receivedDateTime === "string" ? m.receivedDateTime : "",
  };
}

/**
 * Fetch message body via Graph for MFA extraction only — never logged or persisted.
 *
 * @param {string} accessToken
 * @param {string} messageId
 * @returns {Promise<string>} stripped lowercase plaintext (via stripMarkupish)
 */
async function fetchMessageBodyPlainLower(accessToken, messageId) {
  try {
    const url = `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(messageId)}?$select=id,body,subject`;
    const j = await graphFetchJson(accessToken, url);
    if (
      j.ok &&
      j.json &&
      typeof j.json === "object" &&
      j.json !== null &&
      typeof /** @type {{ body?: { content?: unknown } }} */ (j.json).body?.content === "string"
    ) {
      return stripMarkupish(String(/** @type {{ body?: { content?: unknown } }} */ (j.json).body?.content));
    }
  } catch {
    /** swallow */
  }
  return "";
}

/**
 * Smoke test helpers (counts only — no secrets).
 *
 * @param {string} accessToken
 * @param {{ top?: number }} [opts]
 * @returns {Promise<number>}
 */
async function countLatestMailboxMessages(accessToken, opts = {}) {
  const top = opts.top != null && Number.isFinite(Number(opts.top)) ? Math.floor(Number(opts.top)) : 3;
  const items = await listRecentMessagesEnvelope(accessToken, Math.min(Math.max(top, 1), 50), null);
  return items.length;
}

/**
 * Poll Graph mailbox until a plausible PEPCO/Exelon verification code appears.
 * Uses `/me/messages` on the OAuth-connected mailbox only — do not rely on forwarding rules.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} userId
 * @param {{
 *   requestedAt: Date;
 *   timeoutMs?: number;
 * }} opts
 */
async function pollGraphMailboxForPepcoMfaCode(supabase, userId, opts) {
  const requestedAt =
    opts && opts.requestedAt instanceof Date && !Number.isNaN(opts.requestedAt.getTime())
      ? opts.requestedAt
      : new Date();
  const timeoutMs =
    opts && opts.timeoutMs != null && Number.isFinite(Number(opts.timeoutMs))
      ? Number(opts.timeoutMs)
      : 85_000;

  const cutoff = new Date(requestedAt.getTime() - 5000).toISOString();
  /** @example avoid clock skew misses */
  const dead = Date.now() + timeoutMs;

  let lastSeenCount = -1;

  while (Date.now() < dead) {
    /** @type {string} */
    let accessToken;
    try {
      accessToken = await getValidAccessTokenForUser(supabase, userId);
    } catch {
      await touchMailboxLastCheckedAt(supabase, userId).catch(() => {});
      return { status: "not_found", reason: "failed", detail: "access_token_refresh" };
    }

    /** @type {unknown[]} */
    let items = [];
    try {
      /** @example keep recent enough for MFA bursts */
      items = await listRecentMessagesEnvelope(accessToken, 25, cutoff);
    } catch {
      await touchMailboxLastCheckedAt(supabase, userId).catch(() => {});
      return { status: "not_found", reason: "failed", detail: "graph_messages" };
    }

    lastSeenCount = items.length;

    const ranked = items
      .map((raw) => ({ p: corpusFromListedMessageItem(raw) }))
      .filter((x) => x.p.id && shouldAttemptPepcoMfaExtraction(x.p.sender, x.p.subject, x.p.snippet));

    ranked.sort(
      (a, b) =>
        pepcoMfaPriority(a.p.sender, a.p.subject, a.p.snippet) -
        pepcoMfaPriority(b.p.sender, b.p.subject, b.p.snippet),
    );

    for (const { p } of ranked) {
      const pri = pepcoMfaPriority(p.sender, p.subject, p.snippet);

      let combined = `${p.subject}\n${p.snippet}`;

      /** Prioritized PEPCO template (`no-reply@pepco.com` + subject + phrase): always hydrate full body */
      if (pri <= 1) {
        const plainLower = await fetchMessageBodyPlainLower(accessToken, p.id);
        if (plainLower) combined = `${p.subject}\n${plainLower}`;
      } else if (pri === 2 && combined.length < 40) {
        const plainLower = await fetchMessageBodyPlainLower(accessToken, p.id);
        if (plainLower) combined = `${p.subject}\n${plainLower}`;
      }

      const code = extractVerificationCodeFromCombinedText(combined);
      if (code && isCandidateDigitToken(code)) {
        const received = p.received;
        console.log("[MicrosoftMailbox] Candidate MFA-related message retained for automation:", {
          messageIdPrefix:
            typeof p.id === "string" && p.id.length > 12 ? `${p.id.slice(0, 12)}…` : "(unknown)",
          receivedDateTimeSuffix:
            typeof received === "string" && received.length > 14 ? `${received.slice(0, 10)}…` : received,
        });
        await touchMailboxLastCheckedAt(supabase, userId).catch(() => {});
        return { status: "found", code, messageId: p.id, receivedDateTime: received };
      }
    }

    await new Promise((r) => setTimeout(r, MFA_EMAIL_POLL_INTERVAL_MS));
  }

  await touchMailboxLastCheckedAt(supabase, userId).catch(() => {});
  return {
    status: "not_found",
    reason: "timeout",
    detail: lastSeenCount >= 0 ? `messages_window=${lastSeenCount}` : "messages_window=unknown",
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} userId
 * @returns {Promise<{
 *   connected: boolean;
 *   mailbox_email: string | null;
 *   last_connected_at: string | null;
 *   last_checked_at: string | null;
 *   last_error: string | null;
 * }>}
 */
async function getMailboxStatusForUser(supabase, userId) {
  const { data, error } = await supabase
    .from("microsoft_mailbox_connections")
    .select("mailbox_email,status,last_connected_at,last_checked_at,last_error")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) {
    return {
      connected: false,
      mailbox_email: null,
      last_connected_at: null,
      last_checked_at: null,
      last_error: null,
    };
  }

  const ok =
    String(data.status || "").toLowerCase() === "connected" &&
    !!(data.mailbox_email && String(data.mailbox_email).trim());

  return {
    connected: ok,
    mailbox_email: ok ? String(data.mailbox_email || "").trim() : null,
    last_connected_at: typeof data.last_connected_at === "string" ? data.last_connected_at : null,
    last_checked_at: typeof data.last_checked_at === "string" ? data.last_checked_at : null,
    last_error:
      typeof data.last_error === "string" && String(data.last_error).trim()
        ? String(data.last_error).trim()
        : null,
  };
}

module.exports = {
  countLatestMailboxMessages,
  pollGraphMailboxForPepcoMfaCode,
  getMailboxStatusForUser,
};
