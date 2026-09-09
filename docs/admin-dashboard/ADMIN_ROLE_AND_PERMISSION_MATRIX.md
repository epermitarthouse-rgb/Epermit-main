# Admin Role and Permission Matrix — Governance Scope

Parent: [PRODUCTION_ADMIN_DASHBOARD_ARCHITECTURE.md](./PRODUCTION_ADMIN_DASHBOARD_ARCHITECTURE.md)

---

## 1. Platform roles (admin dashboard access)

| Role | Maps to | Admin UI access |
|------|---------|-----------------|
| **Platform admin** | `user_roles.role = 'admin'` | Full Users & Access, Audit, Platform |
| **Non-admin** | Everyone else | **No admin routes** — `AdminUnauthorized` |

No separate `operations_manager` / `operator` roles in v2 scope — governance is platform-admin-only. Project roles remain in main product.

**Future (optional):** `auditor` read-only on Audit page only — requires BC approval.

---

## 2. Project access roles (unchanged semantics)

| Role | Enum / source | Capabilities in product |
|------|---------------|------------------------|
| **none** | Not member | No project data |
| **viewer** | `project_team_members.viewer` | Read project-scoped data per feature grants |
| **editor** | `editor` | Read + write where feature grants allow |
| **admin** | `admin` or project owner | Team management + all feature writes on project unless explicitly denied |
| **owner** | `projects.user_id` | Same as project admin |

Existing RPCs: `has_project_access`, `has_project_editor_access`, `has_project_admin_access`.

---

## 3. Feature access levels

| Level | Code | Meaning |
|-------|------|---------|
| **none** | `0` | Feature hidden / API returns 403 |
| **read** | `1` | View data and status |
| **write** | `2` | Trigger actions (scrape, filing, invoice, etc.) |

Stored in `user_feature_permissions(user_id, project_id, feature_key, access_level)`.

**Project_id NULL** = platform-wide default template for new project memberships (optional BC-01).

---

## 4. Scraped-data scope

Table: `user_scraped_data_scope(user_id, scope_type, scope_ref, granted)`

| scope_type | scope_ref example | Effect |
|------------|-------------------|--------|
| `project` | UUID | May view scraped data for that project only |
| `jurisdiction` | `Arlington County` | Within allowed projects, filter to jurisdiction |
| `portal_source` | `accela`, `projectdox` | Filter attachment/portal_data by source |

**Rule:** User must have `has_project_access` for project-scoped data **and** matching scope row **and** `scraper.results` read ≥ read.

---

## 5. Portal credential authorization

Table: `user_portal_credential_grants(user_id, credential_id, grant_level, project_id nullable, jurisdiction nullable)`

| grant_level | Code | Allowed |
|-------------|------|---------|
| **none** | `0` | Row invisible in UI lists |
| **use** | `1` | Backend decrypt for scrape/filing on scoped project/jurisdiction |
| **manage** | `2` | CRUD metadata, rotate password via API, assign grants to others if also project admin |

**Credential owner (`portal_credentials.user_id`)** retains manage on own rows unless revoked by platform admin.

**Manage does not return password to browser** — only POST with new password body.

---

## 6. Precedence rules (evaluation order)

Evaluate top to bottom; first matching rule wins unless noted:

```
1. IF user has user_roles.admin → ALLOW all (platform admin bypass) EXCEPT audit still logs actions
2. IF user deactivated → DENY all
3. IF action requires project P:
   3a. IF NOT has_project_access(user, P) → DENY (stop — feature grants ignored)
   3b. IF project role = admin OR owner → ALLOW write on all features unless explicit deny row (optional deny table Phase 2+)
   3c. ELSE resolve user_feature_permissions(user, P, feature_key)
4. IF action reads scraped data for project P:
   4a. Apply rule 3
   4b. IF NOT scope match (project/jurisdiction/portal) → DENY
5. IF action uses credential C:
   5a. IF grant_level(C) < use → DENY
   5b. IF credential scoped to project P → require has_project_access(user, P)
   5c. Backend decrypt only inside Railway service — never FE
6. DEFAULT → DENY
```

**Explicit deny:** Optional `user_feature_permissions.access_level = -1` (deny) overrides inherited admin role for that feature — separation of duties (BC optional).

---

## 7. Effective permission computation

**RPC:** `admin_get_effective_permissions(p_user_id UUID) RETURNS JSONB`

Returns structure:

```json
{
  "user_id": "...",
  "platform_admin": true,
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

Computed **server-side only** — Users & Access detail tab displays this JSON formatted.

---

## 8. Admin dashboard permission matrix

| Action | Platform admin |
|--------|:--------------:|
| View Overview | ✓ |
| List all users | ✓ |
| Activate/deactivate user | ✓ |
| Grant/revoke platform admin | ✓ (with final-admin guard) |
| Assign project team role | ✓ |
| Set feature permissions | ✓ |
| Set scraped-data scope | ✓ |
| Assign credential grants | ✓ |
| View audit log | ✓ |
| Export audit CSV | ✓ |
| Platform jurisdictions CRUD | ✓ |
| Send jurisdiction notifications | ✓ |
| Manage drip campaigns | ✓ |

---

## 9. Enforcement map

| Layer | Mechanism |
|-------|-----------|
| Admin UI routes | `useRequireAdmin` |
| Admin API | `requirePlatformAdmin` middleware |
| Admin RPCs | `has_role(auth.uid(), 'admin')` at start |
| Product feature APIs | `assert_feature_access(user, project, feature, level)` NEW |
| Portal credential API | Check `user_portal_credential_grants` + owner |
| portal_data reads | RLS or RPC wrapper with scope check NEW |
| Scrape enqueue | Existing editor check + `scraper.run` write |

---

## 10. Final-admin and self-lockout

| Rule | Implementation |
|------|----------------|
| Last admin | RPC `admin_revoke_platform_role` raises if count=1 |
| Self-demote last admin | Blocked |
| Self-deactivate | Blocked if last admin |
| Audit | All role changes logged before commit |
