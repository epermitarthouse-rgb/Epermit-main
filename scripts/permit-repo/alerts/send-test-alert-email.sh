#!/usr/bin/env bash
# Sends ONE labelled delivery test through the deployed permit-sync-alert-notifier (D-109).
#
#   scripts/permit-repo/alerts/send-test-alert-email.sh --i-have-approval
#
# Needs: the function deployed with RESEND_API_KEY, RESEND_FROM_EMAIL, PERMIT_SYNC_ALERT_EMAILS and
# PERMIT_SYNC_ALERT_APP_URL set. Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from scraper-service/.env
# without printing them. The test reads no alerts and marks nothing notified; subject starts with "[TEST]".
set -euo pipefail
[ "${1:-}" = "--i-have-approval" ] || { echo "usage: $0 --i-have-approval" >&2; exit 2; }
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT/scraper-service"
node -e '
require("dotenv").config({ quiet: true });
(async () => {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  if (!key || !url) { console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in scraper-service/.env"); process.exit(1); }
  const res = await fetch(`${url}/functions/v1/permit-sync-alert-notifier`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, apikey: key },
    body: JSON.stringify({ action: "test" }),
  });
  const out = await res.json().catch(() => ({}));
  console.log(new Date().toISOString(), "status", res.status, JSON.stringify(out));
  process.exit(res.ok && out.test_sent ? 0 : 1);
})();'
