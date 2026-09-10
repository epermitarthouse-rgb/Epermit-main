# Admin Governance — Implementation Status

**Implemented:** 2026-09-10 (local, uncommitted)  
**Architecture reference:** v2.1 @ commit `44c3899`  
**Enforcement default:** `legacy` (no product blocking until cutover)

---

## Delivered

### Database (migration file only — not applied to production)

`supabase/migrations/20260910120000_admin_governance_foundation.sql`

- `profiles.access_status`
- `governance_config.enforce_mode` (default `legacy`)
- `platform_audit_events`, `user_feature_permissions`, `user_scraped_data_scope`, `user_portal_credential_grants`, `user_access_reviews`
- RPCs: `is_user_active`, `admin_*`, `assert_*`
- Credential grant backfill + grant-only `portal_credentials` RLS

### Railway backend

| Path | Purpose |
|------|---------|
| `scraper-service/app/services/governance/` | Constants, enforce modes, effective permissions, asserts |
| `scraper-service/app/routes/admin.routes.js` | 14 `/api/admin/v1/*` endpoints |
| `scraper-service/app/routes/portal-credentials.routes.js` | Grant-only access + bootstrap manage on create |
| `scraper-service/app/services/uci/uci-access.service.js` | Deactivated user gate |
| `scraper-service/app/routes/documents.routes.js` | `assertFeatureAccess` (shadow/legacy safe) |
| `scraper-service/app/routes/quickbooks.routes.js` | `assertFeatureAccess` on invoice trigger |

### Frontend

| Route | Component |
|-------|-----------|
| `/admin` | `AdminOverview` |
| `/admin/access/users` | `AdminAccessUsers` |
| `/admin/access/users/:userId` | `AdminAccessUserDetail` |
| `/admin/access/review` | `AdminAccessReview` |
| `/admin/audit` | `AdminAudit` (platform + legacy) |
| `/admin/platform/jurisdictions` | `JurisdictionAdmin` |
| `/admin/platform/notifications` | `AdminPlatformNotifications` |
| `/admin/platform/campaigns` | `AdminPlatformCampaigns` |

API client: `src/lib/adminApi.ts` · Hook: `src/hooks/useAdminApi.ts`

### Tests

- `scraper-service/tests/admin-governance.test.js` (14 tests)
- `src/lib/adminApi.test.ts`, `src/lib/governanceConstants.test.ts` (8 tests)
- QuickBooks hardening regression: pass

---

## Safe migration / deployment order

1. **Apply migration** to staging Supabase (`20260910120000_admin_governance_foundation.sql`)
2. Verify backfill: credential grants exist for existing `portal_credentials`
3. Deploy Railway with `GOVERNANCE_ENFORCE` unset (defaults to `legacy`)
4. Deploy frontend (Vercel)
5. Platform admin smoke: Overview → Users → effective permissions → audit row
6. **Phase B:** confirm effective permissions match legacy access for sample users
7. **Phase C:** set `GOVERNANCE_ENFORCE=shadow` for 1 week; monitor logs
8. **Phase D:** set `GOVERNANCE_ENFORCE=enforce` or update `governance_config.enforce_mode`

**Rollback:** set enforce mode back to `legacy`; schema can remain.

---

## Environment variables

| Variable | Values | Default |
|----------|--------|---------|
| `GOVERNANCE_ENFORCE` | `legacy`, `shadow`, `enforce`, `true`, `false` | DB `governance_config` → `legacy` |

---

## Not in this implementation

- Scrape enqueue `assertFeatureAccess` (session-based auth; deferred to avoid scraper pipeline risk)
- Portal-data RLS wrapper on `projects.portal_data` (enforce via RPC when cutover)
- UCI route changes (explicitly out of scope)
