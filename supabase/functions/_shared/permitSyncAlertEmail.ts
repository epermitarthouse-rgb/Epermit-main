/**
 * Which permit-sync alerts to email, and the email body (D-099). Pure: no Deno or network access, so it runs
 * under node:test. Emails carry alert titles, severities, counts and an admin link only. Permit numbers are
 * masked unless explicitly allowed, and anything that looks like a credential, address or URL is removed.
 */

export interface PermitSyncAlert {
  id: string;
  alert_key: string;
  category: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string | null;
  occurrences: number;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  notified_at: string | null;
  notify_count: number;
  resolution_notified_at: string | null;
}

export interface AlertSelection {
  open: PermitSyncAlert[];
  resolved: PermitSyncAlert[];
}

/** Critical alerts still open are repeated at this interval; warnings are sent once. Info alerts are not emailed. */
export const CRITICAL_REPEAT_MS = 6 * 60 * 60 * 1000;

export function selectAlertsToNotify(alerts: PermitSyncAlert[], now: Date): AlertSelection {
  const open = alerts.filter((a) => {
    if (a.resolved_at || a.severity === "info") return false;
    if (!a.notified_at) return true;
    return a.severity === "critical" && now.getTime() - new Date(a.notified_at).getTime() >= CRITICAL_REPEAT_MS;
  });
  const resolved = alerts.filter((a) => a.resolved_at && a.notified_at && !a.resolution_notified_at);
  return { open, resolved };
}

const SCRUB: Array<[RegExp, string]> = [
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[email]"],
  [/\bhttps?:\/\/\S+/gi, "[link]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g, "[token]"],
  [/\b(?:bearer|token|password|secret|cookie|session)\b\s*[:=]?\s*\S+/gi, "[redacted]"],
  [/\b[A-Za-z0-9_-]{32,}\b/g, "[redacted]"],
];
const PERMIT = /\bPermit [A-Z0-9-]{4,}\b/g;

export function scrubAlertText(text: string | null | undefined, opts: { includePermitNumbers?: boolean } = {}): string {
  let out = String(text ?? "");
  for (const [re, rep] of SCRUB) out = out.replace(re, rep);
  if (!opts.includePermitNumbers) out = out.replace(PERMIT, "A permit");
  return out.replace(/\s+/g, " ").trim().slice(0, 400);
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function buildAlertEmail(sel: AlertSelection, opts: { adminUrl: string; includePermitNumbers?: boolean }): { subject: string; text: string; html: string } | null {
  if (!sel.open.length && !sel.resolved.length) return null;
  const critical = sel.open.filter((a) => a.severity === "critical").length;
  const subject = sel.open.length
    ? `PermitPilot sync: ${sel.open.length} alert${sel.open.length === 1 ? "" : "s"} open${critical ? ` (${critical} critical)` : ""}`
    : `PermitPilot sync: ${sel.resolved.length} alert${sel.resolved.length === 1 ? "" : "s"} resolved`;
  const line = (a: PermitSyncAlert) => {
    const detail = scrubAlertText(a.detail, opts);
    return { head: `[${a.severity}] ${scrubAlertText(a.title, opts)}`, detail, seen: `seen ${a.occurrences}× since ${a.first_seen_at}` };
  };
  const text = [
    ...(sel.open.length ? ["Open alerts:", ...sel.open.map((a) => { const l = line(a); return `- ${l.head}${l.detail ? ` — ${l.detail}` : ""} (${l.seen})`; }), ""] : []),
    ...(sel.resolved.length ? ["Resolved:", ...sel.resolved.map((a) => `- ${scrubAlertText(a.title, opts)} (resolved ${a.resolved_at})`), ""] : []),
    `Details: ${opts.adminUrl}`,
  ].join("\n");
  const li = (a: PermitSyncAlert) => { const l = line(a); return `<li><strong>${escapeHtml(l.head)}</strong>${l.detail ? ` — ${escapeHtml(l.detail)}` : ""} <span style="color:#666">(${escapeHtml(l.seen)})</span></li>`; };
  const html = [
    sel.open.length ? `<h3>Open alerts</h3><ul>${sel.open.map(li).join("")}</ul>` : "",
    sel.resolved.length ? `<h3>Resolved</h3><ul>${sel.resolved.map((a) => `<li>${escapeHtml(scrubAlertText(a.title, opts))}</li>`).join("")}</ul>` : "",
    `<p><a href="${escapeHtml(opts.adminUrl)}">Open Permit Sync in Management Admin</a></p>`,
  ].join("");
  return { subject, text, html };
}

export function parseRecipients(raw: string | null | undefined): string[] {
  return [...new Set(String(raw ?? "").split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)))];
}
