# Admin Monitoring and Alerts

Parent: [PRODUCTION_ADMIN_DASHBOARD_ARCHITECTURE.md](./PRODUCTION_ADMIN_DASHBOARD_ARCHITECTURE.md)

---

## 1. Health check architecture

| Component | Probe method | Heartbeat table | Interval |
|-----------|--------------|-----------------|----------|
| Railway Epermit-main | HTTP `GET /` + internal `/api/admin/v1/health/live` (new) | `platform_health_heartbeats` | 60s self |
| document-ingestion-worker | Worker loop writes heartbeat | same | 60s |
| Arlington durable worker | Existing loop + heartbeat column | `scrape_jobs.last_heartbeat_at` + service heartbeat | poll interval |
| UCI durable worker | Same pattern | same | poll interval |
| Supabase DB | Query `SELECT 1` from admin API | integration snapshot | 5min |
| Edge Functions | Synthetic invoke selected functions | integration snapshot | 15min |

**No `/health` route today** (404) — add lightweight liveness in Phase 0.

---

## 2. Metrics categories

| Category | Live vs historical | Storage |
|----------|-------------------|---------|
| Job success/failure rates | Both | Aggregate table `ops_metrics_daily` (new, Phase 2) |
| Queue depth | Live | Real-time query |
| Stale jobs | Live | Query on heartbeat threshold |
| Attachment failure rate | Historical 24h | Derived from scrape events |
| Ingestion queue age | Live | `now() - min(created_at) WHERE pending` |
| Integration token expiry | Live | `integration_health_snapshots` |
| OpenAI usage/cost | Historical | External billing + optional DB counter |
| Supabase egress | Historical | Dashboard manual until API |
| Storage growth | Historical | Supabase metrics |

---

## 3. Alert catalog

| Alert ID | Trigger | Severity | Dashboard location | Notification | Ack | Resolution |
|----------|---------|----------|-------------------|--------------|-----|------------|
| ALT-001 | Scrape job stale >15min | P1 | A Command Center, E | Email ops (future) | INC-001 | Retry or cancel |
| ALT-002 | Scrape failure rate >20% / 1h jurisdiction | P1 | E jurisdiction | — | INC-001 | Maintenance mode |
| ALT-003 | Ingestion queue age >30min | P2 | H, A | — | INC-001 | Scale worker / retry |
| ALT-004 | Ingestion worker heartbeat missing >5min | P0 | O, A | Email | INC-001 | Restart worker |
| ALT-005 | QB connection disconnected | P1 | K, N | — | — | Reconnect OAuth |
| ALT-006 | QB subscription blocked | P2 | K | — | — | Client restores billing |
| ALT-007 | Graph poll failed 3x consecutive | P2 | L, N | — | — | Reconnect mailbox |
| ALT-008 | Edge function probe failed | P2 | N, O | — | — | Deploy fix |
| ALT-009 | Failed attachment count >10 job | P2 | E job detail | — | SCR-005 | Retry attachments |
| ALT-010 | Filing stuck in `filing` >1h | P2 | F | — | — | Manual intervention |
| ALT-011 | Storage recovery gap (no backup policy) | P3 | R | — | — | Runbook |
| ALT-012 | Database backup older than 48h | P1 | R | Email | — | Supabase support |
| ALT-013 | Final platform admin count = 1 | P3 | C | — | — | Add backup admin |
| ALT-014 | UCI live gate enabled in production | P0 | M, A | Email | — | Verify intentional |

---

## 4. Stale job detection rules

| Job type | Stale when | Threshold source |
|----------|------------|------------------|
| Arlington scrape | `last_heartbeat_at` null or old | `ARLINGTON_WORKER_POLL_MS × 6` |
| UCI portal sync | same | UCI worker config |
| Session scrape | HTTP request exceeded timeout | Log correlation — session only |
| Ingestion | `processing` and `updated_at` old | Worker SLA 20min default |
| Filing agent_run | `running` > 1h | Configurable |

---

## 5. Incident model

| Field | Description |
|-------|-------------|
| `incident_id` | UUID |
| `alert_ids[]` | Related alerts |
| `severity` | P0–P3 |
| `status` | open, acknowledged, resolved |
| `owner_id` | Assigned operator |
| `created_at`, `resolved_at` | Timestamps |

Stored in `platform_incidents` (new, Phase 1). Command Center shows open P0/P1.

---

## 6. Separation: live vs blockers

| Type | Example | UI treatment |
|------|---------|--------------|
| Live health | Worker heartbeat OK | Green |
| Historical metric | 24h scrape success 94% | Chart |
| Operational warning | 3 stale jobs | Amber badge |
| Incident | Ingestion worker down | Red incident card |
| Client/provider blocker | QB subscription inactive | Purple "external" badge — not ops fault |

---

## 7. Notification channels (phased)

| Phase | Channel |
|-------|---------|
| 1 | In-app badges + Command Center only |
| 2 | Email to ops distribution (Resend) |
| 3 | Optional webhook to external on-call |

**No PagerDuty integration in initial architecture** — business decision if required.

---

## 8. Dashboard widgets mapping

| Widget | Alerts fed |
|--------|--------------|
| Command Center strip | ALT-001, 004, 005, 014 |
| E Scraper jobs | ALT-001, 002, 009 |
| H Ingestion | ALT-003 |
| O System health | ALT-004, 008 |
| K Billing | ALT-005, 006 |
| R Capacity | ALT-011, 012 |
