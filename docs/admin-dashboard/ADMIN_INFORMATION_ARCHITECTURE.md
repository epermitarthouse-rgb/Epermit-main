# Admin Information Architecture — Governance Scope

**Version:** 2.1  
Parent: [PRODUCTION_ADMIN_DASHBOARD_ARCHITECTURE.md](./PRODUCTION_ADMIN_DASHBOARD_ARCHITECTURE.md)

---

## 1. Final navigation tree

```
/admin
├── Overview                          /admin
├── Users & Access                    /admin/access
│   ├── Directory                     /admin/access/users
│   ├── User detail                   /admin/access/users/:userId
│   └── Bulk review                   /admin/access/review
├── Audit                             /admin/audit
└── Platform                          /admin/platform
    ├── Jurisdictions                 /admin/platform/jurisdictions
    ├── Notifications & branding      /admin/platform/notifications
    └── Email campaigns               /admin/platform/campaigns
```

**Redirects from legacy routes:**

| Legacy | Redirect |
|--------|----------|
| `/admin/members` | `/admin/access/users` |
| `/admin/jurisdictions` | `/admin/platform/jurisdictions` |
| `/admin` (old AdminPanel tabs) | Overview + Platform sub-routes |
| `/admin/authorizations` | `/admin/access/users` |
| `/admin/feature-flags` | Removed (localStorage dev-only) |
| `/admin/uci-action-tracker` | Removed from admin |
| `/admin/shadow-mode` | Direct URL only (dev) |
| `/admin/architecture-replication` | Direct URL only (dev) |

---

## 2. Existing screen disposition

| Screen | Route today | Decision | Rationale |
|--------|-------------|----------|-----------|
| **AdminPanel** | `/admin` | **Merge → split** | Overview metrics + move notifications/branding/drip to Platform |
| **AdminMembers** | `/admin/members` | **Merge → polish** | Core of Users & Access directory; extend with feature/scopes |
| **AdminAudit** | `/admin/audit` | **Polish + expand** | Keep route; add filters and unified audit table |
| **JurisdictionAdmin** | `/admin/jurisdictions` | **Retain** | Working CRUD; move under Platform |
| **FeatureFlagsAdmin** | `/admin/feature-flags` | **Remove from nav** | localStorage-only; not governance |
| **ShadowModeDashboard** | `/admin/shadow-mode` | **Exclude** | Internal dev metrics |
| **ArchitectureReplicationChecklist** | `/admin/architecture-replication` | **Exclude** | Internal dev checklist |
| **UciActionTracker** | `/admin/uci-action-tracker` | **Remove** | Product/docs track UCI; not admin governance |
| **AdminAuthorizationsPlaceholder** | `/admin/authorizations` | **Remove** | Empty placeholder |

---

## 3. Module specifications

### 3.1 Overview — `/admin`

| Element | Specification |
|---------|---------------|
| **Purpose** | At-a-glance governance health |
| **Roles** | Platform admin only |
| **Summary cards** | Total users; active users; platform admins count; users with permission risks; pending invitations |
| **Permission risks panel** | Users with: no project access but feature grants (orphan); credential manage without project; expired invitations; sole platform admin |
| **Recent activity** | Last 15 `platform_audit_events` (admin actions) |
| **Useful widgets retained** | Scheduled notification count (from AdminPanel); jurisdiction subscriber summary (link to Platform) |
| **Actions** | Jump to Users & Access, Audit, Platform |
| **Empty state** | "No risks detected" with last scan time |

---

### 3.2 Users & Access — `/admin/access`

#### Directory — `/admin/access/users`

| Column | Source |
|--------|--------|
| Email / name | `profiles` via `admin_list_member_directory` |
| Status | active / deactivated |
| Platform role | `user_roles` |
| Project count | directory RPC |
| Risk flags | computed |
| Last activity | profile / auth metadata if available |

**Filters:** status, platform role, has risks, search email/name.

#### User detail — `/admin/access/users/:userId`

**Tabs:**

1. **Summary** — identity, status, platform role
2. **Project access** — table: project, role (none/viewer/editor/admin), source (owner/team/invitation)
3. **Feature permissions** — matrix: feature key × read/write/none per project (or global)
4. **Scraped-data scope** — projects, jurisdictions, portal sources
5. **Portal credentials** — grants per credential: `none` / `use` / `manage`; scoped project/jurisdiction; **grant-only** (creator revocable by admin)
6. **Effective permissions** — read-only computed view (server JSON) — **primary reviewer surface**

**Actions:** Activate/deactivate; grant/revoke platform admin; add/remove project role; edit feature matrix; edit scopes; bulk copy from template user.

#### Bulk review — `/admin/access/review`

| Feature | Specification |
|---------|---------------|
| Purpose | Quarterly access review |
| Table | All users with effective permission hash + last reviewed date |
| Actions | Mark reviewed; export CSV; filter users with credential manage |

---

### 3.3 Audit — `/admin/audit`

| Element | Specification |
|---------|---------------|
| **Table columns** | timestamp, actor, action, target type/id, project, feature, result, correlation id |
| **Filters** | user, action category, project, feature key, date range |
| **Categories** | role_change, project_access, feature_permission, scraped_data_scope, credential_use, credential_manage, platform_notification, user_lifecycle |
| **Detail drawer** | Safe before/after JSON — **no secrets** |
| **Export** | CSV for date range (auditor role future) |
| **Historical import** | Read-only display of legacy `admin_activity_log` rows |

---

### 3.4 Platform — `/admin/platform`

Retained working admin features — **not** product operations.

| Sub-route | Retained from | Content |
|-----------|---------------|---------|
| Jurisdictions | `JurisdictionAdmin` | CRUD, CSV import |
| Notifications & branding | `AdminPanel` tabs | Send/schedule jurisdiction notifications, email branding |
| Email campaigns | `DripCampaignManager` | Drip campaigns via edge function |

---

## 4. Page specification table

| Page | Primary purpose | Summary cards | Main table | Filters | Row details | Actions | Warnings |
|------|-----------------|---------------|------------|---------|-------------|---------|----------|
| Overview | Governance health | 5 KPIs | Recent audit | — | Event drawer | Navigate | Risk list |
| Users directory | Find users | — | Users | role, risk, search | → detail | Add user | Orphan grants |
| User detail | Manage one user | Effective summary | Project/feature matrices | — | Tabs | All ACC-* controls | Deny conflicts |
| Bulk review | Access certification | Pending review count | All users | unreviewed | — | Mark reviewed | — |
| Audit | Compliance trail | Event count 24h | Events | user, action, project, date | Drawer | Export | — |
| Platform jurisdictions | Catalog | — | Jurisdictions | state | Form | CRUD | — |
| Platform notifications | Comms | Subscribers | Scheduled | jurisdiction | Preview | Send/schedule | — |

---

## 5. Global UX

| Convention | Value |
|------------|-------|
| Layout | Same `AdminPageShell` + `AdminLayout` + `useRequireAdmin` |
| Environment banner | `PRODUCTION — governance changes affect live access` |
| Effective permissions | Always show computed badge: e.g. `scraper.run: write @ Project X` |
| Destructive | Remove admin role, deactivate user → typed confirm |
| Accessibility | WCAG 2.1 AA on tables and forms |

---

## 6. What admin explicitly does not include

No pages for: scrape job queue, ingestion queue, filing queue, document inventory, QB invoice list, UCI coordination list, integration health cards, system health/workers, backup status, feature flags (until server-backed governance flags are in scope).

Those remain in the main product or external runbooks.
