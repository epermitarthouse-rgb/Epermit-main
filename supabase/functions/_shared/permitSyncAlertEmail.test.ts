// Run: node --import tsx --test supabase/functions/_shared/permitSyncAlertEmail.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CRITICAL_REPEAT_MS, buildAlertEmail, parseRecipients, scrubAlertText, selectAlertsToNotify, type PermitSyncAlert } from "./permitSyncAlertEmail.ts";

const now = new Date("2026-11-13T12:00:00Z");
const alert = (over: Partial<PermitSyncAlert> = {}): PermitSyncAlert => ({
  id: "a1", alert_key: "worker_offline", category: "worker_offline", severity: "critical",
  title: "No deep permit-sync worker is reporting", detail: "No deep worker heartbeat in the last 5 minutes.",
  occurrences: 3, first_seen_at: "2026-11-13T11:00:00Z", last_seen_at: "2026-11-13T11:55:00Z",
  resolved_at: null, notified_at: null, notify_count: 0, resolution_notified_at: null, ...over,
});

describe("alert selection", () => {
  it("sends new warnings and criticals once, repeats criticals after the interval, never emails info", () => {
    const fresh = alert();
    const warnSent = alert({ id: "a2", severity: "warning", notified_at: "2026-11-13T00:00:00Z" });
    const critRecent = alert({ id: "a3", notified_at: new Date(now.getTime() - CRITICAL_REPEAT_MS + 60000).toISOString() });
    const critDue = alert({ id: "a4", notified_at: new Date(now.getTime() - CRITICAL_REPEAT_MS).toISOString() });
    const info = alert({ id: "a5", severity: "info" });
    const sel = selectAlertsToNotify([fresh, warnSent, critRecent, critDue, info], now);
    assert.deepEqual(sel.open.map((a) => a.id), ["a1", "a4"]);
  });

  it("sends a resolution only for alerts that were notified while open", () => {
    const sel = selectAlertsToNotify([
      alert({ id: "r1", resolved_at: "2026-11-13T11:59:00Z", notified_at: "2026-11-13T11:00:00Z" }),
      alert({ id: "r2", resolved_at: "2026-11-13T11:59:00Z" }),
      alert({ id: "r3", resolved_at: "2026-11-13T11:59:00Z", notified_at: "2026-11-13T11:00:00Z", resolution_notified_at: "2026-11-13T11:59:30Z" }),
    ], now);
    assert.deepEqual(sel.resolved.map((a) => a.id), ["r1"]);
    assert.equal(sel.open.length, 0);
  });
});

describe("alert email content", () => {
  it("masks permit numbers by default and strips credentials, emails, links and tokens", () => {
    const raw = "Permit BCIV2500152: login user@example.com failed; password=hunter22 https://portal.example/x?sid=abc eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig token abcdef0123456789abcdef0123456789abcd";
    const out = scrubAlertText(raw);
    assert.doesNotMatch(out, /BCIV2500152|user@example\.com|hunter22|portal\.example|eyJ|abcdef0123456789/);
    assert.match(out, /^A permit:/);
    assert.match(scrubAlertText("Permit BCIV2500152: x", { includePermitNumbers: true }), /BCIV2500152/);
  });

  it("builds one digest with severities and the admin link, and nothing when there is nothing to send", () => {
    const email = buildAlertEmail({ open: [alert(), alert({ id: "a2", severity: "warning", title: "Portal login is failing" })], resolved: [] }, { adminUrl: "https://app.example/admin/permit-sync" });
    assert.ok(email);
    assert.equal(email.subject, "PermitPilot sync: 2 alerts open (1 critical)");
    assert.match(email.text, /\[critical\] No deep permit-sync worker is reporting/);
    assert.match(email.text, /Details: https:\/\/app\.example\/admin\/permit-sync/);
    assert.match(email.html, /href="https:\/\/app\.example\/admin\/permit-sync"/);
    assert.equal(buildAlertEmail({ open: [], resolved: [] }, { adminUrl: "x" }), null);
  });

  it("escapes HTML from alert text", () => {
    const email = buildAlertEmail({ open: [alert({ title: "<script>x</script>" })], resolved: [] }, { adminUrl: "https://a/admin/permit-sync" });
    assert.doesNotMatch(email!.html, /<script>/);
  });

  it("parses recipients and drops invalid entries", () => {
    assert.deepEqual(parseRecipients(" Ops@Example.com, bad, ops@example.com;dev@example.org "), ["ops@example.com", "dev@example.org"]);
    assert.deepEqual(parseRecipients(undefined), []);
  });
});
