# Admin Monitoring and Alerts — Governance Scope

Admin v2 monitors **access governance health**, not scrape queues, worker heartbeats, or integration uptime. Product operations monitoring belongs outside admin.

Parent: [PRODUCTION_ADMIN_DASHBOARD_ARCHITECTURE.md](./PRODUCTION_ADMIN_DASHBOARD_ARCHITECTURE.md)

---

## 1. Permission risk detection

Computed on Overview load and nightly (optional cron):

| Risk ID | Condition | Severity | Location |
|---------|-----------|----------|----------|
| RISK-001 | Only one platform admin | P1 | Overview |
| RISK-002 | Feature grant without project membership | P2 | Overview, user row |
| RISK-003 | Credential manage without project access | P2 | Overview, user row |
| RISK-004 | User deactivated but still on team rows | P3 | Overview |
| RISK-005 | Pending invitation > 30 days | P3 | Overview |
| RISK-006 | Platform admin without MFA (if enabled) | P2 | Overview — requires Supabase auth metadata |

---

## 2. Audit alerts

| Alert | Trigger | Location |
|-------|---------|----------|
| AUD-ALT-001 | Platform admin granted/revoked | Audit + optional email |
| AUD-ALT-002 | Credential manage grant changed | Audit |
| AUD-ALT-003 | Bulk permission copy | Audit |
| AUD-ALT-004 | User deactivated | Audit |

**Notification channel Phase 1:** In-app Overview only. Email optional Phase 2.

---

## 3. No admin alerts for

- Scrape job failures
- Ingestion queue depth
- QuickBooks subscription
- Worker heartbeat loss
- Storage backup age

Document in runbooks; link from Overview "External monitoring" footnote if needed.

---

## 4. Metrics (informational on Overview)

| Metric | Source |
|--------|--------|
| Total users | profiles count |
| Active users (30d) | auth last_sign_in if available |
| Platform admins | user_roles count |
| Open permission risks | computed |
| Audit events (24h) | platform_audit_events count |
