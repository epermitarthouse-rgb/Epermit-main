# Scheduled Reports — Pre-deploy validation checklist

**Status:** Implementation complete in repo; **production deploy / migration NOT done** — awaiting explicit confirmation.

Use this checklist before applying `supabase/migrations/20260805040000_scheduled_reports_cron_and_claim.sql` or deploying edge functions that send mail.

---

## 1. Environment variables (Supabase Edge Functions)

| Variable | Required | Purpose |
|----------|----------|---------|
| `RESEND_API_KEY` | Yes | Resend API authentication |
| `REPORTS_FROM_EMAIL` | Yes | Verified sender, e.g. `reports@yourdomain.com` or `PermitPilot <reports@yourdomain.com>` |
| `SUPABASE_URL` | Yes | Project URL (usually auto-injected) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role for claim RPC + logs (usually auto-injected) |

**Validate:**

```bash
# Confirm secrets exist (do not print secret values)
supabase secrets list

# Or via dashboard: Project Settings → Edge Functions → Secrets
```

Confirm:

- [ ] `RESEND_API_KEY` is set and matches an active Resend key
- [ ] `REPORTS_FROM_EMAIL` uses a **verified** Resend domain/address (not `onboarding@resend.dev`)
- [ ] `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are present for the target project

---

## 2. Resend sender domain

- [ ] Domain verified in Resend dashboard (DNS SPF/DKIM)
- [ ] `REPORTS_FROM_EMAIL` local-part allowed for that domain
- [ ] Manual smoke: invoke `send-test-scheduled-report` with a controlled inbox
- [ ] Confirm inbox shows `[TEST]` subject and expected From address

---

## 3. Database settings for pg_cron invoke

Cron calls `public.invoke_process_scheduled_checklist_reports()`, which reads:

- `app.settings.supabase_url`
- `app.settings.service_role_key`

Same pattern as the shadow-evaluator trigger. If unset, the cron function logs a warning and **skips** the HTTP call.

**Validate (SQL editor, service role / postgres):**

```sql
SELECT
  nullif(current_setting('app.settings.supabase_url', true), '') IS NOT NULL AS has_url,
  nullif(current_setting('app.settings.service_role_key', true), '') IS NOT NULL AS has_key;
```

If either is false, configure before relying on automatic delivery (project-specific; do not commit secrets).

---

## 4. Migration apply (only after confirmation)

Migration file: `supabase/migrations/20260805040000_scheduled_reports_cron_and_claim.sql`

Adds:

- Claim columns + `claim_due_scheduled_checklist_reports`
- Delivery log `is_test`, `checklist_count`, `no_match` status
- `invoke_process_scheduled_checklist_reports` + `pg_cron` job every **15 minutes**

**After apply, verify:**

```sql
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname = 'process-scheduled-checklist-reports';

SELECT proname FROM pg_proc
WHERE proname IN (
  'claim_due_scheduled_checklist_reports',
  'invoke_process_scheduled_checklist_reports'
);
```

---

## 5. Edge function deploy (only after confirmation)

Deploy at least:

- `process-scheduled-checklist-reports`
- `send-test-scheduled-report`
- `retry-failed-report-emails`

---

## 6. Manual E2E (after cron applied)

1. Create active weekly schedule with filters matching ≥1 checklist; timezone + send_time set.
2. Confirm `next_send_at` matches wall-clock in selected timezone.
3. Either wait for due time + cron, or temporarily set `next_send_at` to now − 1m and wait ≤15m **or** manually:

```bash
curl -X POST "$SUPABASE_URL/functions/v1/process-scheduled-checklist-reports" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json"
```

4. Verify: inbox, `scheduled_report_delivery_logs` row (`is_test=false`), History, Analytics, advanced `next_send_at`.
5. Send Test → inbox `[TEST]`; History/Analytics unchanged.
6. Optional: force no matching checklists → log status `no_match`, schedule advances.
7. Optional: dual-invoke processor while due → only one send (claim lease).

---

## Explicitly deferred until confirmation

- Push to remote
- Railway / Vercel deploy for this work
- Running the production migration
- Enabling automatic delivery WIP banner removal
