"use strict";

/**
 * After Graph POST /me/sendMail returns 202 with an empty body, look up the
 * real Sent Items message. Never invent a Graph message id.
 */

const DEFAULT_POLL_ATTEMPTS = 3;
const DEFAULT_POLL_DELAY_MS = 800;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeSubject(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function recipientAddresses(message) {
  const list = Array.isArray(message?.toRecipients) ? message.toRecipients : [];
  return list
    .map((r) => String(r?.emailAddress?.address || "").trim().toLowerCase())
    .filter(Boolean);
}

/**
 * @param {string} accessToken
 * @param {object} params
 * @param {string} params.subject
 * @param {string[]} [params.to]
 * @param {Date} [params.sentAfter]
 * @param {typeof fetch} [params.fetchFn]
 * @param {number} [params.attempts]
 */
async function reconcileSentItemsMessage(accessToken, params) {
  const fetchFn = params.fetchFn || fetch;
  const attempts = Number(params.attempts) > 0 ? Number(params.attempts) : DEFAULT_POLL_ATTEMPTS;
  const subject = normalizeSubject(params.subject);
  const expectedTo = new Set((params.to || []).map((e) => String(e).trim().toLowerCase()).filter(Boolean));
  const sentAfter = params.sentAfter instanceof Date ? params.sentAfter : new Date(Date.now() - 2 * 60 * 1000);

  let lastError = null;
  for (let i = 0; i < attempts; i += 1) {
    if (i > 0) await sleep(params.delayMs || DEFAULT_POLL_DELAY_MS * i);
    try {
      const url =
        "https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages" +
        "?$orderby=sentDateTime desc&$top=20" +
        "&$select=id,internetMessageId,subject,toRecipients,sentDateTime,conversationId";
      const r = await fetchFn(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!r.ok) {
        lastError = `Sent Items lookup HTTP ${r.status}`;
        continue;
      }
      const body = await r.json();
      const rows = Array.isArray(body?.value) ? body.value : [];
      const match = rows.find((row) => {
        if (normalizeSubject(row.subject) !== subject) return false;
        const sent = row.sentDateTime ? new Date(String(row.sentDateTime)) : null;
        if (sent && sent.getTime() < sentAfter.getTime() - 5000) return false;
        if (expectedTo.size) {
          const got = new Set(recipientAddresses(row));
          for (const addr of expectedTo) {
            if (!got.has(addr)) return false;
          }
        }
        return Boolean(row.id);
      });
      if (match?.id) {
        return {
          ok: true,
          reconciled: true,
          message_id: String(match.id),
          internet_message_id: match.internetMessageId ? String(match.internetMessageId) : null,
          conversation_id: match.conversationId ? String(match.conversationId) : null,
          sent_datetime: match.sentDateTime || null,
        };
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    ok: true,
    reconciled: false,
    message_id: null,
    internet_message_id: null,
    error: lastError || "sent_items_not_found",
  };
}

module.exports = {
  reconcileSentItemsMessage,
  normalizeSubject,
};
