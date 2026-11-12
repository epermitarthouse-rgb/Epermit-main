# Permit-sync worker runbook (deep mode)

Operational guide for the Railway `permit-sync-worker` service, the refresh queue and the monitor.
Decisions: D-093 – D-100. Nothing here is applied automatically; each step marked **(approval)** is a production change.

## 1. What runs where

| Piece | Where | Starts work? |
| --- | --- | --- |
| Refresh requests | Permit Queue (Refresh all / Refresh), Management Admin (Refresh all, Retry) | Yes, only on a user click |
| Queue, coalescing, login lock, progress | Postgres (`20261113100000_permit_sync_orchestration.sql`) | No |
| Worker | Railway `permit-sync-worker` (`railway.permit-sync-worker.toml`) | Claims queued jobs only; never enqueues |
| Scheduler | pg_cron `permit-sync-enqueue` → `enqueue_permit_sync_runs()` | Only for sources with an enabled schedule; **not installed** |
| Monitor | pg_cron `permit-sync-monitor` → `permit_sync_monitor()` | No (writes alerts only) |
| Notifier | pg_cron `permit-sync-alert-notifier` → edge function `permit-sync-alert-notifier` | No (emails alerts only) |

## 2. Worker service (approval)

Railway → project PermitPilot → service `permit-sync-worker`:

- Root directory `scraper-service`; config file path `scraper-service/railway.permit-sync-worker.toml`.
- Replicas: 1. The claim lock keeps one portal session per login even if two ran, but one is the intended setup.
- Health: `GET /health` on `$PORT` returns 200 while the worker loop is alive and its last tick is recent, 503 otherwise.
- Shutdown: SIGTERM stops at the next permit boundary, releases the job without spending an attempt (`worker_shutdown`), and exits; `drainingSeconds = 120`.

Variables (names only; values live in Railway):

| Variable | Value for the first full refresh |
| --- | --- |
| `PERMIT_SYNC_WORKER_ENABLED` | `true` |
| `PERMIT_SYNC_LIVE_PORTAL_APPROVED` | `A-3` |
| `PERMIT_SYNC_MODE` | `deep` |
| `PERMIT_SYNC_WORKER_ONCE` | **unset** (a set value exits after one job) |
| `PERMIT_SYNC_ONLY_PORTAL_RECORD_IDS` | **unset** (a set value narrows every job; Management Admin → Sync workers warns) |
| `PERMIT_SYNC_DEEP_MAX_FILES` | e.g. `5000` — ceiling per run; files over the cap stay pending for the next refresh |
| `PERMIT_SYNC_DEEP_MAX_BYTES` | e.g. `21474836480` (20 GiB) — ceiling per run |
| `PERMIT_SYNC_DEEP_MAX_FILE_BYTES` | optional per-file ceiling |
| `PERMIT_SYNC_LEASE_TTL_SECONDS` | default `300` |
| `PERMIT_SYNC_WORKER_HEARTBEAT_MS` | default `30000` |
| `PERMIT_SYNC_PERMIT_PAUSE_MS` | pause between permits; default from policy |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PORTAL_CREDENTIALS_ENCRYPTION_KEY` | existing |

After a deploy, Management Admin → Permit Sync → **Sync workers** shows the worker as Idle with its version,
scope (must read "All permits") and per-run limits. Nothing is queued by the deploy.

### Deploys and rollback

- Enable "Wait for CI" on both Railway services so a commit deploys only after `PermitPilot CI` passes.
- The worker has watch patterns; it rebuilds only for worker-relevant paths. The HTTP scraper (`railway.toml`)
  has none and rebuilds on every push to its root, which restarts any manual scrape in progress. Recommended
  (approval): add watch patterns to `railway.toml` so worker-only changes do not redeploy it.
- A failing health check keeps the previous deployment. To roll back: Railway → Deployments → previous
  successful deployment → Redeploy. The worker releases its job on SIGTERM; the next deployment resumes it.
- Edge Functions and migrations are never deployed by CI or Railway.

## 3. First full refresh (user-initiated)

1. Apply migration `20261113100000` **(approval)**; confirm nothing was enqueued:
   `select count(*) from permit_sync_jobs where status in ('queued','running','retry_wait');`
2. Deploy the worker **(approval)** and confirm it is Idle with scope "All permits".
3. The user opens Permit Queue → **Refresh all**. The confirmation names the jurisdiction and permit count.
4. Progress is read from `permit_sync_job_permits` and the job checkpoint: Permit Queue banner, per-row phase, and
   Management Admin. Counts only; there is no estimated percentage.
5. Verification uses persisted data only (P3): job status and metrics, per-permit phases, stored documents and
   reports versus portal counts, and open alerts.

## 4. Scheduling (after the first full refresh is verified)

1. Management Admin → Scheduling: set frequency, time and timezone; enable **(approval)**.
2. Install the scheduler: `scripts/permit-repo/scheduling/02-enable-sync-cron.sql` **(approval)**. It refuses
   unless every scheduled source has a finished full deep refresh.
3. A schedule never fires for a slot before it was enabled and is skipped while a refresh is in flight.

## 5. Monitoring and alerts

- Install: `scripts/permit-repo/scheduling/01-enable-monitor-cron.sql` **(approval)**. Independent of the worker.
- Alerts are deduplicated by key, auto-resolve, and appear in Management Admin → Sync alerts.
- Email (optional, **approval**): deploy `permit-sync-alert-notifier`; set `RESEND_API_KEY`, `RESEND_FROM_EMAIL`,
  `PERMIT_SYNC_ALERT_EMAILS`, `APP_BASE_URL`; Vault secrets `supabase_project_url`, `supabase_service_role_key`.
  Emails contain severities, titles, counts and an admin link; permit numbers are masked unless
  `PERMIT_SYNC_ALERT_INCLUDE_PERMIT_NUMBERS=true`; no credentials, sessions or permit content.

| Alert | Meaning | First action |
| --- | --- | --- |
| worker_offline | No deep heartbeat for 5 min while work is due | Railway logs; restart the service |
| job_stuck | Running job's lease expired or not renewed | Wait one lease TTL (reclaimed automatically); else cancel and retry |
| queued_unclaimed | Due job not claimed | Worker offline, or the same login is busy (manual scrape) |
| login_failure | Consecutive auth failures, or the portal needs the user (MFA/CAPTCHA) | Check credential; Resume in Sources |
| portal_changed / guard_violation | Portal response not recognised / guard refused | Stop scheduling; inspect job events |
| retry_exhausted | Job failed after its attempts | Read error code; Retry once fixed |
| excessive_failures | Many permits/files/reports failed | Job events; portal availability |
| persistent_partial | Permit ended with outstanding items 3 times | Inspect that permit's files/reports |
| no_recent_success | No completed run in the expected window | Check the schedule and the worker |
| discovery_drop | Fewer permits discovered than the previous full run | Portal account access; dashboard filters |
| schedule_missed | Schedule slot passed without a job | Scheduler cron installed and active? |
| missing_deep_content | Deep run finished without any deep pass | Worker mode and deep variables |

## 6. Stop everything

- `scripts/permit-repo/scheduling/99-disable-all.sql` removes all three cron jobs.
- Cancel the job in flight from Permit Queue or Management Admin (captured files are kept).
- Scale the worker to 0 replicas, or set `PERMIT_SYNC_WORKER_ENABLED=false`.
- Schema rollback (only with no active jobs): `scripts/permit-repo/rollback-20261113100000_permit_sync_orchestration.sql`.
