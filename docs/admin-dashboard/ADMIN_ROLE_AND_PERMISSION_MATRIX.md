# Admin Role and Permission Matrix — Governance Scope

**Version:** 2.1  
Parent: [PRODUCTION_ADMIN_DASHBOARD_ARCHITECTURE.md](./PRODUCTION_ADMIN_DASHBOARD_ARCHITECTURE.md)

---

## 1. Platform roles (admin dashboard access)

| Role | Maps to | Admin UI access |
|------|---------|-----------------|
| **Platform admin** | `user_roles.role = 'admin'` | Full Overview, Users & Access, Audit, Platform |
| **Everyone else** | No admin row, or any non-admin value | **No admin routes** |

### 1.1 `moderator` — excluded from governance (FD-02)

Production evidence (2026-09-10):

| Check | Result |
|-------|--------|
| `useRequireAdmin.ts` | Checks `role = 'admin'` only |
| RLS policies referencing `moderator` | **0** |
| Admin UI assigning `moderator` | **None** |
| Product feature gates for `moderator` | **None** |

The `app_role` enum includes `'moderator'` in schema (`20260112170034_*.sql`) but it has **no verified required purpose**. Admin v2:

- Does **not** expose `moderator` in any admin UI
- Does **not** grant elevated permissions to `moderator` rows
- Treats holders as ordinary users for all governance decisions

Removing the enum value from Postgres is a **separate optional migration** — not required for admin v2.

---

## 2. Project access roles (unchanged semantics)

| Role | Source | Product capability baseline |
|------|--------|----------------------------|
| **none** | Not member | No project data |
| **viewer** | `project_team_members.viewer` | Read per feature defaults (§5.2 master doc) |
| **editor** | `editor` | Read + selective write per defaults |
| **admin** | `admin` team row | Write on all features unless explicit row lowers |
| **owner** | `projects.user_id` | Same as project admin |

Existing RPCs unchanged: `has_project_access`, `has_project_editor_access`, `has_project_admin_access`.

---

## 3. Feature access levels

| Level | Meaning |
|-------|---------|
| **none** | Feature hidden; API 403 |
| **read** | View data and status |
| **write** | Trigger actions |

**Storage:** `user_feature_permissions.access_level TEXT NOT NULL CHECK (access_level IN ('none', 'read', 'write'))`.

**No numeric codes. No deny sentinel.** Use explicit `none` to restrict a project admin/owner on a specific feature.

**Resolution when no row exists:** inherit from project role per [PRODUCTION §5.2](./PRODUCTION_ADMIN_DASHBOARD_ARCHITECTURE.md#52-legacy-project-role--initial-feature-permissions).

---

## 4. Scraped-data scope

Table: `user_scraped_data_scope(user_id, scope_type, scope_ref)`

| scope_type | scope_ref example | Effect |
|------------|-------------------|--------|
| `project` | UUID | Data for that project only |
| `jurisdiction` | `Arlington County` | Filter within allowed projects |
| `portal_source` | `accela`, `projectdox` | Filter by source |

**No tenant-level scope rows.** Tenant membership affects project access via existing `has_project_access` only.

**Rule:** membership + `scraper.results` ≥ read + scope match (or no scope rows = full within project during migration).

---

## 5. Portal credential authorization

Table: `user_portal_credential_grants(user_id, credential_id, grant_level, project_id?, jurisdiction?)`

| grant_level | Meaning |
|-------------|---------|
| **none** | Row invisible; backend rejects |
| **use** | Backend decrypt for scrape/filing on scoped project/jurisdiction |
| **manage** | CRUD metadata, rotate password via API body, assign grants |

**Storage:** `grant_level TEXT NOT NULL CHECK (grant_level IN ('none', 'use', 'manage'))`.

### 5.1 Grant-only model (FD-01)

- **`portal_credentials.user_id` is not checked for authorization.** It records who created the row.
- **All access** requires a row in `user_portal_credential_grants`.
- On credential create, API inserts bootstrap `manage` grant for creator — **revocable by platform admin**.
- Platform admin may set **any** user's grant to `none`, including the creator.
- Manage never returns password to browser.

---

## 6. Precedence rules (evaluation order)

```
1. IF NOT is_user_active(user) → DENY ALL
2. IF user has user_roles.admin → ALLOW ALL (audit still records)
3. IF action requires project P:
   3a. IF NOT has_project_access(user, P) → DENY (feature grants ignored)
   3b. IF explicit user_feature_permissions row exists → use none|read|write from row
   3c. ELSE apply project-role defaults (§5.2 master doc)
4. IF action reads scraped data for project P:
   4a. Apply rules 1–3 for scraper.results
   4b. IF scope rows exist AND no match → DENY
5. IF action uses credential C:
   5a. Lookup user_portal_credential_grants(user, C)
   5b. IF grant_level = none OR missing → DENY (owner status irrelevant)
   5c. IF grant_level = use → backend decrypt only; audit credential.use
   5d. IF grant_level = manage → metadata CRUD; audit credential.manage.*
   5e. IF credential scoped to project P → require has_project_access(user, P)
6. DEFAULT → DENY
```

**Write implies read** for feature checks: validating `write` also satisfies `read`.

---

## 7. Effective permission computation

**RPC:** `admin_get_effective_permissions(p_user_id UUID) RETURNS JSONB`

```json
{
  "user_id": "...",
  "access_status": "active",
  "platform_admin": false,
  "projects": [{
    "project_id": "...",
    "project_role": "editor",
    "features": { "scraper.run": "write", "billing.quickbooks": "read" },
    "scraped_data_scopes": ["jurisdiction:Arlington"],
    "credentials": [{ "credential_id": "...", "grant": "use" }]
  }],
  "risks": ["orphan_feature_grant", "sole_platform_admin"]
}
```

Computed server-side only. Values are always `none` | `read` | `write` or `none` | `use` | `manage`.

---

## 8. Admin dashboard permission matrix

| Action | Platform admin |
|--------|:--------------:|
| View Overview | ✓ |
| List all users | ✓ |
| Activate/deactivate user | ✓ |
| Grant/revoke platform admin | ✓ (final-admin guard) |
| Assign project team role | ✓ |
| Set feature permissions | ✓ |
| Set scraped-data scope | ✓ |
| Assign/revoke credential grants (any user, incl. creator) | ✓ |
| View/export audit | ✓ |
| Platform jurisdictions / notifications / campaigns | ✓ |

---

## 9. Enforcement map

| Layer | Mechanism | Repo evidence |
|-------|-----------|---------------|
| Admin UI | `useRequireAdmin` — 13 files | `src/hooks/useRequireAdmin.ts` |
| Admin API | `requirePlatformAdmin` middleware | New `/api/admin/v1` |
| Admin RPCs | `has_role(uid, 'admin')` | `admin_list_member_directory` pattern |
| Session gate | `requireAuthenticatedUser` + `is_user_active` | `uci-access.service.js` (7 route files) |
| Product features | `assert_feature_access` | Priority: scrape, filing, documents, quickbooks routes |
| Credentials | `assert_credential_use` / grant check | `portal-credentials.routes.js` (4 routes) + 17 decrypt refs in `register-execution-routes.js` |
| portal_data | `assert_scraped_data_access` | `PortalDataViewer` ecosystem (34 src files) |
| RLS | 314 existing policies + new grant/scope functions | `supabase/migrations/` |

---

## 10. Final-admin and self-lockout

| Rule | Implementation |
|------|----------------|
| Last admin | RPC raises if admin count = 1 |
| Self-demote last admin | Blocked |
| Self-deactivate | Blocked if last admin |
| Deactivate user | Ban + `access_status=deactivated` + credential grants → none |
| Audit | All changes logged before commit |
