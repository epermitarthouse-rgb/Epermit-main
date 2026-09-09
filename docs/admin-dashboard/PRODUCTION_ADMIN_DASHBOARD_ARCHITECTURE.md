# Production Admin Dashboard Architecture — Governance Scope

**Version:** 2.1 (final corrections)  
**Date:** 2026-09-10  
**Supersedes:** 18-module operations architecture (v1.0); v2.0 draft

---

## 1. Executive summary

PermitPilot Admin is a **governance console** for platform administrators. It answers:

- Who has access to the platform and each project?
- What features can they read or write?
- What scraped data and portal credentials can they see or use?
- What changed, when, and by whom?

It does **not** host scrape job queues, filing pipelines, document ingestion, billing operations, or UCI workflows. Those remain in the main product with permissions enforced by the model defined here.

**Navigation (final):** Overview · Users & Access · Audit · Platform settings — four areas only.

---

## 2. Boundaries

### 2.1 In scope (admin)

| Area | Responsibility |
|------|----------------|
| **Overview** | Access summary, permission risks, recent admin activity, useful existing widgets |
| **Users & Access** | Directory, activate/deactivate, project roles, feature R/W, scraped-data scope, credential grants |
| **Audit** | Role, access, credential, and platform-admin action history |
| **Platform settings** | Retained working `/admin/*` features: jurisdictions, notifications/branding, drip campaigns |

### 2.2 Out of scope (main product)

| Area | Where it stays |
|------|----------------|
| Projects, scrapers, portal harvest | `/projects`, `/portal-data`, Dashboard widgets |
| Filing, Pre-Flight | Permit wizard surfaces |
| Documents, ingestion, RAG | Project document vault, Response Matrix |
| Billing, QuickBooks | Project Billing tab |
| UCI | `/uci/*` routes |
| System ops monitoring (queues, workers) | External monitoring — **not admin** |

### 2.3 Developer-only (excluded from production admin nav)

| Route | Disposition |
|-------|-------------|
| `/admin/shadow-mode` | Hidden — internal metrics |
| `/admin/architecture-replication` | Hidden — internal checklist |
| `/admin/uci-action-tracker` | **Removed from admin** |
| `/admin/authorizations` | **Removed** — absorbed into Users & Access |
| `/admin/feature-flags` | **Removed from nav** — localStorage dev-only |

---

## 3. Final decisions (v2.1)

| ID | Decision |
|----|----------|
| **FD-01** | **Portal credentials are grant-only.** `portal_credentials.user_id` records creator metadata only — it is **not** an authorization source. All access flows through `user_portal_credential_grants`. Platform admin may revoke access from **any** user, including the credential creator. On create, the API inserts an initial `manage` grant for the creator (bootstrap, revocable). |
| **FD-02** | **`moderator` removed from governance model.** The `app_role` enum value exists in production schema but has **no verified purpose**: zero route gates, zero RLS policies, `useRequireAdmin` checks only `admin`. Admin v2 treats non-`admin` platform roles as ordinary users. No UI to assign `moderator`. Existing DB rows are inert until migrated manually. |
| **FD-03** | **No tenant-level permission grants.** `tenant_memberships` continues to participate in `has_project_access` for project-scoped data (existing Row 2 behavior). Admin governs **per-user** project, feature, scraped-data, and credential grants only — not tenant-wide templates. |
| **FD-04** | **Consistent permission values only.** Feature access: `none` \| `read` \| `write`. Portal credentials: `none` \| `use` \| `manage`. No numeric codes, no `access_level = -1`. Explicit `none` on a feature row restricts even project admin/owner for that feature (separation of duties). |
| **FD-05** | **User deactivation finalized** (see §4). Dual mechanism: `profiles.access_status` + Supabase Auth ban. Sessions rejected server-side. Audit preserved. Grants revoked to `none`; rows retained. Audited reactivation. |
| **FD-06** | **Migration preserves legacy behavior** (see §5). No enforcement until backfill verified. Project-role defaults match current product access. |
| **FD-07** | **Default feature template (BC-01 resolved):** new project members inherit role-based defaults from §5.2 until platform admin sets explicit rows. |

---

## 4. User deactivation (FD-05)

### 4.1 Requirements

| Requirement | Mechanism |
|-------------|-----------|
| Block new access | Supabase Auth ban via Admin API |
| Reject existing sessions | Banned users fail JWT refresh; Railway middleware rejects active requests |
| Preserve audit history | `platform_audit_events` and legacy `admin_activity_log` never deleted on deactivate |
| Revoke effective access | Set all `user_portal_credential_grants` → `none`; `is_user_active()` returns false — feature/scope/project rows **retained** but ignored |
| Audited reactivation | ACC-001 via admin API; unban + `access_status = active` |

### 4.2 Storage

| Layer | Object | Change |
|-------|--------|--------|
| **New column** | `profiles.access_status` | `TEXT NOT NULL DEFAULT 'active' CHECK (access_status IN ('active', 'deactivated'))` |
| **Existing** | `auth.users` | Ban via service-role Admin API (`ban_duration` on deactivate; `ban_duration: 'none'` on activate) |
| **Existing** | `user_portal_credential_grants` | Bulk update to `none` on deactivate |
| **New function** | `is_user_active(uid UUID)` | Returns false when `profiles.access_status = 'deactivated'` |
| **Audit** | `platform_audit_events` | `user.deactivated` / `user.activated` with actor, target, reason |

### 4.3 Enforcement points

| Layer | File / object | Behavior |
|-------|---------------|----------|
| Railway middleware | `scraper-service/app/services/uci/uci-access.service.js` → `requireAuthenticatedUser` | After JWT verify, query `profiles.access_status`; return 403 if deactivated |
| Supabase RLS / RPCs | `is_user_active(auth.uid())` prepended to `assert_feature_access`, `assert_credential_use`, `has_project_access` wrappers | Deny when deactivated |
| Admin API | `POST /api/admin/v1/access/users/:id/deactivate` | Service-role: ban user, update profile, revoke credential grants, append audit |
| Admin API | `POST /api/admin/v1/access/users/:id/activate` | Service-role: unban, set active, append audit (does not auto-restore grants) |
| Frontend | `useAuth` / session handler | Surface deactivated state; redirect to support message |

**Self-deactivate and last-admin deactivate:** blocked (existing final-admin guards).

---

## 5. Migration compatibility (FD-06)

### 5.1 Phased rollout

| Phase | Name | Behavior |
|-------|------|----------|
| **A** | Schema only | New tables + `profiles.access_status`; zero enforcement |
| **B** | Backfill + read UI | Effective-permissions RPC runs in **legacy mode**; admin shows computed view |
| **C** | Shadow enforce | Railway/RLS logs WOULD-BLOCK without rejecting (1 week) |
| **D** | Enforce | `assert_*` helpers reject; feature flag `GOVERNANCE_ENFORCE=true` |

**Rollback:** Phase D → C → B by flag; schema retained.

### 5.2 Legacy project role → initial feature permissions

When **no explicit** `user_feature_permissions` row exists for `(user, project, feature_key)`, resolve from project role:

| Project role | Source | Default feature level |
|--------------|--------|----------------------|
| **owner** | `projects.user_id` | `write` on all feature keys |
| **admin** | `project_team_members.role = admin` | `write` on all feature keys |
| **editor** | `project_team_members.role = editor` | `read` on all keys; `write` on `scraper.run`, `filing.submit`, `documents.vault`, `ingestion.rag`, `code.analyzer`, `credentials.self` |
| **viewer** | `project_team_members.role = viewer` | `read` on all keys |
| **none** | Not member | `none` on all keys (feature grants ignored per precedence) |

Explicit row with `none`, `read`, or `write` **overrides** the role default for that feature (including restricting admin/owner to `read` or `none`).

### 5.3 Scraped-data scope migration

| State | Behavior |
|-------|----------|
| **No scope rows** for user | Full scraped-data visibility within projects where user has `scraper.results` ≥ read (preserves current behavior) |
| **Scope rows present** | Enforce project / jurisdiction / portal_source filters |

### 5.4 Portal credential migration

| Step | Action |
|------|--------|
| Backfill | For each `portal_credentials` row, insert `user_portal_credential_grants(user_id=creator, credential_id, grant_level='manage')` |
| Post-migration | Creator access is grant-based only; admin may revoke |
| RLS update | Replace owner-only policies with grant-check policies |

### 5.5 Unchanged during migration

- `has_project_access`, `has_project_editor_access`, `has_project_admin_access` RPC semantics
- `project_team_members` roles and invitation flow
- Tenant membership path inside `has_project_access` (Row 2)
- Platform admin gate: `user_roles.role = 'admin'` only

---

## 6. Authorization model (summary)

### 6.1 Dimensions

| Dimension | Levels | Storage |
|-----------|--------|---------|
| **Platform admin** | none / manage | `user_roles.admin` only |
| **Project access** | none / viewer / editor / admin | `project_team_members` + owner |
| **Feature access** | none / read / write | `user_feature_permissions.access_level` (TEXT) |
| **Scraped-data scope** | project, jurisdiction, portal_source | `user_scraped_data_scope` |
| **Portal credentials** | none / use / manage | `user_portal_credential_grants.grant_level` (TEXT) |

### 6.2 Core rules

1. **Deny by default** — no implicit access from authentication alone (except platform admin).
2. **Project membership first** — feature permissions require `has_project_access`.
3. **Deactivated users denied** — `is_user_active` checked before all grants.
4. **Server-side enforcement** — RLS/RPC + Railway `assert_*`; UI is not the security boundary.
5. **No secrets in browser** — passwords/tokens never returned.
6. **Final platform admin protection** — cannot remove last admin.
7. **Complete audit** — every grant/revoke, use, manage, activate/deactivate.
8. **Credential access is grant-only** — creator has no permanent privilege.

Full precedence: [ADMIN_ROLE_AND_PERMISSION_MATRIX.md](./ADMIN_ROLE_AND_PERMISSION_MATRIX.md).

---

## 7. Portal credential security

| Level | Meaning | Browser sees |
|-------|---------|--------------|
| **none** | Cannot use or manage | Row hidden |
| **use** | Backend decrypt for approved scrape/filing | Metadata only — **no password** |
| **manage** | Create, replace, test, disable, assign grants | Metadata only — **no password** |

**Authorization source:** `user_portal_credential_grants` only. Creator metadata on `portal_credentials.user_id` is not checked for access.

Every **use**: audit `credential.use`. Every **manage**: audit `credential.manage.*`. Platform admin may set any user's grant to `none`, including the creator.

---

## 8. Scraped-data visibility

| Scope type | Example |
|------------|---------|
| `project` | Scraped data for listed project IDs only |
| `jurisdiction` | Filter to jurisdiction within allowed projects |
| `portal_source` | Filter by `accela`, `projectdox`, etc. |

Requires project membership + `scraper.results` ≥ read + matching scope (or no scope rows during legacy mode).

---

## 9. Feature keys (initial set)

| Feature key | Product surface |
|-------------|-----------------|
| `project.core` | Project detail |
| `scraper.run` | Scrape triggers |
| `scraper.results` | Portal data / attachments |
| `filing.submit` | Permit wizard |
| `documents.vault` | Document vault |
| `ingestion.rag` | Ingestion / Response Matrix |
| `billing.quickbooks` | Billing tab |
| `code.analyzer` | Code Mod |
| `uci.workspace` | UCI routes |
| `credentials.self` | Settings credentials |

Platform admin bypasses explicit feature rows.

---

## 10. Acceptance criteria

### Functional
- [ ] Four-area nav only: Overview, Users & Access, Audit, Platform
- [ ] Effective permissions computed server-side
- [ ] Platform admin can revoke credential access from creator
- [ ] Deactivated user cannot authenticate or call APIs
- [ ] Reactivation audited; grants not auto-restored

### Security
- [ ] Non-admin blocked from admin API/RPCs
- [ ] Credential password never in response or audit
- [ ] Feature write denied without membership
- [ ] Final-admin protection tested
- [ ] Legacy users retain access through Phase B–C migration

### Quality
- [ ] Authorization tests per RPC and priority Railway route
- [ ] Effective-permission golden tests for each project role
- [ ] Deactivate/reactivate integration test

---

## 11. References

- [ADMIN_ROLE_AND_PERMISSION_MATRIX.md](./ADMIN_ROLE_AND_PERMISSION_MATRIX.md)
- [ADMIN_DATA_AND_API_CONTRACTS.md](./ADMIN_DATA_AND_API_CONTRACTS.md)
- [ADMIN_IMPLEMENTATION_ROADMAP.md](./ADMIN_IMPLEMENTATION_ROADMAP.md)
- [ADMIN_INFORMATION_ARCHITECTURE.md](./ADMIN_INFORMATION_ARCHITECTURE.md)
