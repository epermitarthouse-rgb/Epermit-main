# Admin Role and Permission Matrix

Parent: [PRODUCTION_ADMIN_DASHBOARD_ARCHITECTURE.md](./PRODUCTION_ADMIN_DASHBOARD_ARCHITECTURE.md)

---

## 1. Role model

### 1.1 Platform roles (new table `platform_operator_roles`)

Extends existing `user_roles.admin` without breaking current checks.

| Role key | Maps from today | Purpose |
|----------|-------------------|---------|
| `platform_admin` | `user_roles.role = 'admin'` | Full platform control |
| `operations_manager` | New assignment | Ops + most config; cannot remove final admin |
| `operator` | New assignment | Job/integration operations |
| `support` | New assignment | User/project access assistance |
| `auditor` | New assignment | Read-only compliance view |

**Migration strategy:** Existing `user_roles.admin` rows auto-grant `platform_admin`. Additional roles stored in `platform_operator_roles(user_id, role_key)` with CHECK constraint on allowed keys.

**Deprecated:** `app_role` values `moderator` and `user` — verify usage; if unused, document as legacy only.

### 1.2 Project roles (unchanged)

| Role | Table | Capabilities |
|------|-------|--------------|
| `owner` | `projects.owner_id` | Full project control |
| `admin` | `project_team_members` | Team + settings |
| `editor` | `project_team_members` | Edit + trigger scrape/QB dry-run |
| `viewer` | `project_team_members` | Read only |

RPCs: `has_project_access`, `has_project_admin_access`, `has_project_editor_access` (verified in migrations).

---

## 2. Authorization enforcement layers

| Layer | Mechanism | Applies to |
|-------|-----------|------------|
| L1 Frontend | `usePlatformRole(minRole)` | Hide nav/actions |
| L2 Railway | `requirePlatformRole` middleware | All `/api/admin/v1/*` |
| L3 Supabase RPC | `assert_platform_role()` inside SECURITY DEFINER | Direct RPC calls |
| L4 RLS | Existing policies | Project-scoped user queries |
| L5 Audit | `platform_audit_events` insert on mutation | All write actions |

**Rule:** L2/L3 mandatory; L1 is UX only. Project-scoped admin actions (e.g. retry scrape on project X) also call `has_project_editor_access` or admin access as appropriate.

---

## 3. Protections

| Protection | Implementation |
|------------|----------------|
| Final platform admin | RPC `admin_revoke_platform_role` rejects if count(`platform_admin`) = 1 |
| Self-lockout | Cannot demote self if last `platform_admin` |
| Separation of duties | `auditor` cannot mutate; `support` cannot change platform roles |
| Billing retry | `platform_admin` or `operations_manager` only |
| UCI live gate | `platform_admin` + typed confirm + audit reason |
| Credential secrets | Never returned — any role |

---

## 4. Permissions matrix

Legend: ✓ allowed · R read · W write · — denied · P project-scoped

| Module / action | platform_admin | operations_manager | operator | support | auditor | Project admin |
|-----------------|:--------------:|:------------------:|:--------:|:-------:|:-------:|:-------------:|
| **A Command Center** | R/W ack | R/W ack | R | R | R | — |
| **B Projects directory** | R/W | R/W | R | R | R | P own projects |
| **B Archive project** | W | W | — | — | R | P admin |
| **C List users** | R | R | R | R | R | — |
| **C Invite user** | W | W | — | W | R | P team invite |
| **C Assign platform role** | W | — | — | — | R | — |
| **C Deactivate user** | W | W | — | — | R | — |
| **D Jurisdiction CRUD** | W | W | R | R | R | — |
| **D Maintenance mode** | W | W | — | — | R | — |
| **E List all scrape jobs** | R | R | R | R | R | P project jobs |
| **E Retry/cancel job** | W | W | W | — | R | P editor+ |
| **E Manage schedules** | W | W | R | — | R | — |
| **F Filing queue** | R/W | R/W | R | R | R | P |
| **F Manual filing intervention** | W | W | — | — | R | P admin |
| **G Document inventory** | R | R | R | R | R | P |
| **G Archive document** | W | W | — | — | R | P admin |
| **H Ingestion queue** | R/W | R/W | W | R | R | P |
| **H Re-index document** | W | W | W | — | R | P editor+ |
| **I Code analyzer runs** | R/W | R/W | W | R | R | P |
| **J Response matrix** | R/W | R/W | W | R | R | P |
| **K QB connection status** | R | R | R | R | R | — |
| **K QB safe retry invoice** | W | W | — | — | R | P editor+ |
| **K QB reconcile uncertain** | W | W | — | — | R | — |
| **L Graph reconnect** | W | W | — | — | R | User own mailbox |
| **L Send jurisdiction notification** | W | W | — | — | R | — |
| **M UCI admin view** | R | R | R | R | R | — |
| **M UCI live gate toggle** | W | — | — | — | R | — |
| **N Integration test ping** | W | W | W | — | R | — |
| **O System health** | R | R | R | R | R | — |
| **P Feature flags** | W | W | R | R | R | — |
| **Q Audit log** | R | R | R | R | R | — |
| **R Backups/capacity** | R | R | R | R | R | — |

---

## 5. Session and access revocation

| Capability | Supported today | Dashboard target |
|------------|-----------------|------------------|
| Supabase Auth user ban | Dashboard manual | Expose via C Users (admin API wrapper) |
| Revoke project invitation | RPC exists | C Invitations |
| Remove team member | RPC/UI exists | C + project Team tab |
| Invalidate all sessions | Supabase admin API | platform_admin only, audited |

---

## 6. Audit requirements for role changes

Every platform role grant/revoke records:

- `actor_id`, `target_user_id`, `before_roles[]`, `after_roles[]`, `reason` (optional text), `correlation_id`

Existing `AdminMembers.tsx` grant/revoke must migrate to audited RPC (already partial via manual log — consolidate to `platform_audit_events`).
