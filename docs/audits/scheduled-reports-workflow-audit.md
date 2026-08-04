# Scheduled Reports Workflow Audit

**Date:** 2026-08-05  
**Branch:** `feat/lovable-ui-replication`  
**Scope:** Checklist Scheduled Reports (UI + FE→BE→DB→email→analytics)  
**Layout fix applied:** New Schedule / Edit dialog overflow only (no scheduling backend changes)

---

## 1. Root cause of New Schedule horizontal overflow

### Primary cause
`DialogContent` is a CSS **grid** container (`src/components/ui/dialog.tsx`). Grid/flex children default to `min-width: auto`, so intrinsic content width can expand the modal past the viewport and force horizontal scroll.

Inside the New Schedule dialog (`ScheduledReportsManager.tsx`), three always-on **`grid-cols-2`** rows packed:

- Frequency / Day
- **Send Time (`input[type=time]`)** / Timezone
- Project Filter / Status Filter

Native `type="time"` controls (especially WebKit/Safari) have a large intrinsic min-width. On narrow viewports (~320–390px content after dialog padding + close button), two columns + `gap-4` exceed the modal width → horizontal overflow inside the modal.

### Contributing factors
| Factor | Effect |
|--------|--------|
| Forced `grid-cols-2` (no breakpoint) | Too narrow columns on mobile |
| Missing `min-w-0` / `w-full` on grid cells & inputs | Prevents shrinking below intrinsic size |
| PDF toggle row `justify-between` (label + helper) | Side-by-side text can overflow |
| Footer: Preview + Send Test + Cancel + Create in one row at `sm+` | Action bar wider than `max-w-lg` content |
| `overflow-y-auto` without `overflow-x-hidden` | Vertical scroll works; X overflow still visible |

### Not the main cause
- Select portals render in `document.body` (do not expand modal body)
- No hardcoded `w-[…]` widths on form fields
- Theme tokens (light/dark) not involved

### Layout fix applied
**File changed:** `src/components/checklists/ScheduledReportsManager.tsx` only

- Dialog: `min-w-0 overflow-x-hidden overflow-y-auto`
- Pair rows: `grid-cols-1 sm:grid-cols-2` + cell `min-w-0`
- Inputs/selects/textarea: `w-full min-w-0`
- Toggle rows: stack/wrap-friendly; PDF helper no longer forces horizontal squeeze
- Footer: wrap + full-width buttons on narrow; accessible without clipping

**Responsive check (CSS reasoning):**
- Mobile (&lt;640px viewport): 1-column fields; stacked footer — no X scroll; Y scroll retained
- Tablet/desktop: dialog still `max-w-lg`; 2-col pairs when viewport ≥ `sm`; footer wraps if needed
- Light/dark: layout classes only; no theme-specific width rules

---

## 2. Reminder type (confirmed from code)

| Question | Answer from implementation |
|----------|----------------------------|
| In-app reminder? | **No** — processor does not write to notifications / bell tables |
| Email reminder? | **No** — not a short reminder ping |
| Generated checklist report by email? | **Yes** — HTML email summarizing filtered `saved_inspection_checklists` |
| Notify project owner automatically? | **No** — owner is only notified if their email is in `recipient_email` |
| Notify entered recipients only? | **Yes** — comma-separated `recipient_email` list |
| Notification bell? | **No** — no in-app notification creation in this flow |

**Product type:** recurring **email checklist report** (Resend), not a reminder/notification feature.

---

## 3. Frontend → backend sequence

```
Checklist History → Scheduled Reports tab
  └─ ScheduledReportsManager
       ├─ CRUD via useScheduledReports → Supabase table scheduled_checklist_reports
       ├─ Preview → ScheduledReportPreviewDialog (client HTML mock; no send)
       ├─ Send Test → supabase.functions.invoke('send-test-scheduled-report')
       ├─ Delivery History → useReportDeliveryLogs → scheduled_report_delivery_logs
       ├─ Analytics → Report atop same delivery logs (client formulas)
       └─ Branding → EmailBrandingDialog → email_branding_settings

Due path (intended):
  Trigger (MISSING IN REPO) → process-scheduled-checklist-reports
    → load due rows (is_active + next_send_at <= now)
    → load saved_inspection_checklists for report.user_id (+ filters)
    → build HTML (+ optional crude PDF)
    → Resend API per recipient
    → insert scheduled_report_delivery_logs
    → update last_sent_at / next_send_at
```

### FE entry points
| UI | File | Behavior |
|----|------|----------|
| Schedules / History / Analytics tabs | `ScheduledReportsManager.tsx` | Host UI |
| New Schedule / Edit | same | Dialog form → create/update |
| Clone | same | Prefills form; save inserts new row |
| Activate / Pause | same | `is_active` toggle |
| Delete | same | Deletes schedule row (cascade logs) |
| Preview | `ScheduledReportPreviewDialog.tsx` | Local branded HTML preview |
| Send Test | `send-test-scheduled-report` edge | Email to first recipient only |
| Retry failed | `ReportDeliveryHistory` → `retry-failed-report-emails` | Resend failed addresses |

Route: `/checklist-history` (Scheduled Reports tab) via `ChecklistHistory.tsx`.

---

## 4. Database tables and fields

### `scheduled_checklist_reports`
Created: `supabase/migrations/20260118023149_455a5e1f-dc3b-489f-b030-3c80e95250e6.sql`  
Timezone: `20260118034301_…` · PDF flag: `20260118035504_…`

| Field | Purpose |
|-------|---------|
| `id`, `user_id` | PK / owner (RLS: owner only) |
| `name` | Schedule label |
| `recipient_email` | Comma-separated recipient emails |
| `recipient_name` | Optional comma-separated names (index-aligned) |
| `project_filter` | `'all'` or project name string from checklist `form_data.projectName` |
| `status_filter` | `'all'` \| draft / in_progress / completed / signed |
| `frequency` | `weekly` \| `monthly` |
| `day_of_week` | 0–6 (weekly) |
| `day_of_month` | 1–28 (monthly) |
| `send_time` | TIME (stored; **not applied** when computing next run in FE or processor) |
| `timezone` | IANA string (stored; **not used** by due-check or next-run updater) |
| `is_active` | Pause/resume |
| `last_sent_at`, `next_send_at` | Due gate + display |
| `email_subject`, `email_intro` | Optional email copy |
| `include_summary`, `include_details`, `include_pdf_attachment` | Content flags |
| `created_at`, `updated_at` | Audit |

**Not stored as a specific checklist ID** — reports aggregate the user’s matching saved checklists.

### `scheduled_report_delivery_logs`
Created: `supabase/migrations/20260118033506_6380f860-bdf6-481e-88df-adcdd110a612.sql`

| Field | Purpose |
|-------|---------|
| `report_id`, `user_id`, `report_name` | Link + denormalized name |
| `recipient_emails[]`, `recipient_count` | Attempted set |
| `successful_count`, `failed_count`, `failed_emails[]` | Outcome |
| `status` | `success` \| `partial` \| `failed` |
| `error_message`, `sent_at`, `created_at` | Diagnostics |

RLS: users SELECT own logs; INSERT allowed broadly (service role path from edge).

### `email_branding_settings`
Global branding for email chrome (logo, colors, header/footer/unsubscribe). Loaded by processor/test/retry.

### Source checklists
`saved_inspection_checklists` filtered by `user_id`, optional `status`, then client-side `form_data.projectName`.

---

## 5. Scheduler / cron

### Intended due logic
`process-scheduled-checklist-reports`:

```ts
.from("scheduled_checklist_reports")
.eq("is_active", true)
.lte("next_send_at", now.toISOString())
```

### Trigger status in this repo
| Mechanism | Status |
|-----------|--------|
| `pg_cron` extension enabled | Yes (`20260113041221_…`) |
| `cron.schedule(...)` for this function | **Not found in any migration** |
| Railway worker / cron hitting the function | **Not found** |
| Supabase `config.toml` schedule entry | Function registered (`verify_jwt = false`); **no schedule** |
| Manual / external invoke only | **De facto** |

**Verdict:** Scheduler is **Not implemented in repository code**. UI can create active schedules with `next_send_at`, but nothing in-repo periodically invokes `process-scheduled-checklist-reports`. A dashboard-only cron (outside git) cannot be confirmed from code.

### Next-run computation gaps (when a job *does* run)
1. **Create (`useScheduledReports`):** advances calendar day for weekly/monthly; **does not set `send_time` hours**; uses browser local `Date`, not selected `timezone`.
2. **Edit:** updates form fields; **does not recompute `next_send_at`**.
3. **Processor `updateNextSendTime`:** `+7 days` or `+1 month` from *now*; ignores `send_time`, `day_of_week`/`day_of_month`, and `timezone`.
4. Empty matching checklists: advances next run and **skips** (no delivery log).

---

## 6. Email provider and env vars

| Item | Value |
|------|-------|
| Provider | **Resend** (`https://api.resend.com/emails`) |
| Env | `RESEND_API_KEY` (required) |
| Also used by edge | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| From address (scheduled + test) | `Insight\|DesignCheck <onboarding@resend.dev>` |
| Retry from | `${branding.header_text} <onboarding@resend.dev>` |

**Production blockers for delivery:**
- Missing/invalid `RESEND_API_KEY`
- Sending from `onboarding@resend.dev` — Resend sandbox/domain limits (often only account owner / verified domains)
- No cron → production emails never auto-fire even if Resend works

---

## 7. Report content generation

**Scheduled / retry path** (`process-scheduled-checklist-reports`):
1. Filter checklists
2. Aggregate pass/fail/pending item counts
3. Build branded HTML (`buildEmailHtml`) — summary cards + up to 10 checklist rows
4. Optional PDF: hand-built minimal PDF stream → base64 attachment (not a polished PDF engine)
5. Personalize greeting per recipient name index

**Test path** (`send-test-scheduled-report`):
- Auth required (Bearer user JWT verified in function)
- First email only from comma list
- Subject prefixed with `[TEST]` when custom subject empty
- Uses real checklists (limit 5) or **sample fake checklists** if none
- Summary falls back to sample numbers when empty
- **Does not** write delivery logs
- **Does not** honor `include_pdf_attachment` (not in request body)

**Preview path:** client-only HTML; no email.

---

## 8. Delivery History source

- Table: `scheduled_report_delivery_logs`
- Hook: `useReportDeliveryLogs` — SELECT last 50 for current user (optional `report_id`)
- Written only by:
  - `process-scheduled-checklist-reports` (after send attempt)
  - `retry-failed-report-emails` (updates / related retry path)
- **Not** written by Send Test or Preview

**Before History appears:** at least one successful processor (or retry) insert. Test email alone will **not** populate History.

---

## 9. Analytics formulas and source

**Source:** same `scheduled_report_delivery_logs` via `useReportDeliveryLogs` (client-side in `ReportAnalyticsDashboard.tsx`).

| Metric | Formula |
|--------|---------|
| Total Emails Sent | `sum(recipient_count)` |
| Successful | `sum(successful_count)` |
| Failed | `sum(failed_count)` |
| Delivery Rate | `(successful / totalEmails) * 100` |
| Total Deliveries | `logs.length` |
| Status counts | count of log rows by `status` |
| Daily trend (30d) | per calendar day: sum successful / failed / recipient_count |
| Per-report breakdown | group by `report_name`: totals + delivery count |

**Before Analytics shows data:** same prerequisite as Delivery History (real logged sends). Empty state until first log row.

---

## 10. CRUD / lifecycle behavior

| Action | Status | Notes |
|--------|--------|-------|
| Create schedule | Working | Inserts row, `is_active=true`, sets `next_send_at` (imprecise) |
| Edit | Partial | Saves fields; does not refresh `next_send_at` |
| Clone | Working (UI) | Prefill + create new |
| Activate / Pause | Working | Toggles `is_active` only |
| Delete | Working | Deletes schedule; logs cascade |
| Preview | Working (UI only) | No backend |
| Send Test | Partial | Sends email if Resend OK; no history/analytics; no PDF |
| Auto due send | Not implemented (trigger) / Partial (function body exists) | Function code present; no in-repo cron |
| Retry failed | Partial | Edge exists; needs prior failed log + Resend |
| Branding | Working | Shared settings table |

---

## 11. Full flow step classification

Trace: schedule saved → becomes due → backend job runs → report generated → email sent → delivery logged → analytics updated

| Step | Classification | Evidence |
|------|----------------|----------|
| 1. Schedule saved | **Working** | FE insert into `scheduled_checklist_reports` |
| 2. Becomes due | **Partial** | `next_send_at` set, but time/timezone ignored; may be wrong clock |
| 3. Backend job runs | **Not implemented** (in repo) | No `cron.schedule` / worker for `process-scheduled-checklist-reports` |
| 4. Report generated | **Working** (if invoked) | HTML (+ optional PDF) in edge function |
| 5. Email sent | **Partial** | Resend call present; sandbox from-address / API key / domain may block |
| 6. Delivery logged | **Working** (if invoked & send attempted with checklists) | Insert into delivery logs; skipped when zero checklists |
| 7. Analytics updated | **Working** (derived) | Client recompute from logs — no separate analytics table |

### “Send Test” shortcut flow
| Step | Classification |
|------|----------------|
| Open form / enter recipient | Working |
| Preview | UI only |
| Send Test invoke | Working (invoke) / Partial (delivery) |
| Appears in Delivery History | **Not implemented** for test path |
| Appears in Analytics | **Not implemented** for test path |

---

## 12. Existing weekly schedule — what to expect

Without a live DB query in this audit, confirm in UI / Supabase:

1. **Exact next-run:** card shows `Next: {format(next_send_at)}` — that ISO timestamp is the due gate. It was set at create (or last processor update), **not** guaranteed to be “Monday 09:00 in selected timezone.”
2. **Timezone interpretation:** displayed for humans; **not used** by due checks or next-run math.
3. **Scheduler actively running?** **No evidence in git.** Treat as inactive unless Supabase Dashboard has a manual cron outside the repo.
4. **Will recipient get anything automatically?** **Not from in-repo automation.** They may get a **Send Test** email if Resend accepts it.
5. **Before Delivery History:** processor (or retry) must run and insert a log (and usually need matching checklists so send isn’t skipped).
6. **Before Analytics:** same — at least one delivery log row.

---

## 13. Working vs missing (summary)

### Working
- Schedule CRUD UI + RLS-backed table
- Preview UI
- Send Test edge function (manual)
- Delivery History + Analytics UI over logs
- Retry edge function
- Email HTML builder + branding load
- Processor function body (send + log + advance)

### Missing / broken for production auto-delivery
- **No in-repo cron/trigger** to call the processor
- **Timezone + send_time not applied** to due/next logic
- Create next-run ignores clock time
- Edit does not recompute next run
- Zero-checklist runs leave no history
- Resend `onboarding@resend.dev` domain limits
- Test sends do not feed History/Analytics
- PDF attachment is minimal/hand-rolled; test path omits PDF
- No notification-bell / in-app channel

---

## 14. Manual test steps (one complete scheduled delivery)

### A. Layout (Part 1)
1. Open `/checklist-history` → Scheduled Reports → **New Schedule**
2. Narrow viewport to ~360px and ~768px; toggle light/dark
3. Confirm: no horizontal scroll in modal; all fields visible; footer reachable; vertical scroll for long form

### B. Test email (does not prove cron)
1. Ensure user has ≥1 saved inspection checklist (or accept sample data in email)
2. New Schedule → fill name + real recipient you control
3. **Send Test** → check inbox (and Resend dashboard)
4. Confirm Delivery History still empty (expected)

### C. Full scheduled delivery (proves processor; cron still separate)
1. Create active weekly schedule with recipient + filters that match checklists
2. In Supabase SQL or Table Editor, set `next_send_at` to a few minutes ago (or now − 1m)
3. Manually invoke:
   ```bash
   curl -X POST "$SUPABASE_URL/functions/v1/process-scheduled-checklist-reports" \
     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
     -H "Content-Type: application/json"
   ```
4. Verify: Resend/inbox, `scheduled_report_delivery_logs` row, History tab, Analytics metrics, `last_sent_at` / new `next_send_at` on schedule
5. Optionally fail one address → Retry from History

### D. Cron gap confirmation
1. Search Supabase Dashboard → Database → Cron jobs for `process-scheduled-checklist-reports`
2. If none, automatic weekly send will never fire until a schedule is added

---

## 15. Production blockers

1. **No committed scheduler** invoking `process-scheduled-checklist-reports`
2. **`RESEND_API_KEY` + verified sending domain** (replace `onboarding@resend.dev`)
3. **Timezone/`send_time` correctness** if customers expect local-clock delivery
4. Shared/demo Supabase caution: do not blast real customer emails from development

---

## 16. Files reference

| Area | Path |
|------|------|
| UI manager | `src/components/checklists/ScheduledReportsManager.tsx` |
| Preview | `src/components/checklists/ScheduledReportPreviewDialog.tsx` |
| History | `src/components/checklists/ReportDeliveryHistory.tsx` |
| Analytics | `src/components/checklists/ReportAnalyticsDashboard.tsx` |
| Branding dialog | `src/components/checklists/EmailBrandingDialog.tsx` |
| Hooks | `src/hooks/useScheduledReports.ts`, `useReportDeliveryLogs.ts`, `useEmailBranding.ts` |
| Processor | `supabase/functions/process-scheduled-checklist-reports/index.ts` |
| Test send | `supabase/functions/send-test-scheduled-report/index.ts` |
| Retry | `supabase/functions/retry-failed-report-emails/index.ts` |
| Config | `supabase/config.toml` (`verify_jwt = false` for these functions) |

---

## 17. Layout change note

Backend scheduling intentionally **unchanged** in the layout-only pass. Only dialog layout classes in `ScheduledReportsManager.tsx` were modified to stop horizontal overflow.

---

## 18. Implemented pending deploy (2026-08-05 follow-up)

**Code status:** Backend gaps from this audit are implemented on `feat/lovable-ui-replication`.  
**Production status:** Migration **not** applied; edge deploy **not** done; push **not** done — awaiting explicit confirmation.  
**UI:** Scheduled Reports remains visible with an **Automatic delivery — Work in Progress** banner until production enablement is confirmed.

### What landed in repo

| Gap | Implementation |
|-----|----------------|
| No in-repo cron | Migration `20260805040000_scheduled_reports_cron_and_claim.sql`: `pg_cron` every 15m → `invoke_process_scheduled_checklist_reports()` → edge function via `extensions.http_post` (uses `app.settings.supabase_url` / `service_role_key`) |
| Timezone / send_time / day fields ignored | Shared helper `supabase/functions/_shared/scheduledReportNextSend.ts` (+ FE re-export). Used on create/edit/resume and after successful process |
| Duplicate sends on overlap | RPC `claim_due_scheduled_checklist_reports` (`FOR UPDATE SKIP LOCKED` + claim lease). Processor claims before send |
| Zero-checklist skips without log | Logs `status=no_match`, advances schedule |
| Complete send failure | Delivery log `failed`; claim lease kept so retry after lease (~15m); `next_send_at` unchanged |
| `onboarding@resend.dev` | Replaced with `REPORTS_FROM_EMAIL` in process / test / retry functions |
| Test vs production analytics | Send Test: `[TEST]` subject, Resend tag, **no** delivery log. History/Analytics filter `is_test !== true` |
| Pre-deploy validation | `docs/audits/scheduled-reports-deploy-checklist.md` |

### Tests (local, no production)

```bash
npx tsx --test src/lib/scheduledReportNextSend.test.ts src/lib/scheduledReportDelivery.test.ts
```

Covers: EST/EDT wall→UTC, weekly/monthly next-run, DST spring/fall, delivery outcome classification, test subject labeling, claim-contract documentation.

### Still requires human confirmation before production

1. Set/verify `RESEND_API_KEY`, `REPORTS_FROM_EMAIL` (verified domain), Supabase URL + service role
2. Ensure `app.settings.supabase_url` / `service_role_key` for cron invoke
3. Apply migration `20260805040000_scheduled_reports_cron_and_claim.sql`
4. Deploy edge functions
5. Run manual E2E from deploy checklist §6
6. Remove WIP banner after automatic delivery is confirmed live
