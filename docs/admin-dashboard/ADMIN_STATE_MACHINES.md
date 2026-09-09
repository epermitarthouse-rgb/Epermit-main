# Admin State Machines — Governance Scope

**Version:** 2.1  
Operational job state machines are **out of scope**. This document covers access and credential governance lifecycles only.

Parent: [PRODUCTION_ADMIN_DASHBOARD_ARCHITECTURE.md](./PRODUCTION_ADMIN_DASHBOARD_ARCHITECTURE.md)

---

## 1. User lifecycle

| State | Storage | Meaning | Transitions |
|-------|---------|---------|-------------|
| `active` | `profiles.access_status = 'active'` + Auth not banned | Normal login | → `deactivated` (ACC-002) |
| `deactivated` | `profiles.access_status = 'deactivated'` + Auth banned | All access blocked; sessions rejected | → `active` (ACC-001) |

**On deactivate:** credential grants → `none`; feature/project/scope rows **retained**; audit history **preserved**.

**On activate:** unban + `active`; grants **not** auto-restored.

**Audit:** `user.activated`, `user.deactivated`

---

## 2. Platform admin role

| State | Transitions |
|-------|-------------|
| `not_admin` | → `admin` via ACC-003 |
| `admin` | → `not_admin` via ACC-004 (blocked if last admin) |

**Note:** `moderator` is not a governance state. Existing enum rows have no effect.

---

## 3. Project membership

| State | Source | Transitions |
|-------|--------|-------------|
| `none` | — | → viewer/editor/admin via invite or ACC-005 |
| `viewer` | team row | → editor/admin or → none |
| `editor` | team row | → admin or → none |
| `admin` | team row or owner | → lower role or → none |

**Migration:** existing memberships unchanged; feature defaults derived from role until explicit rows set.

---

## 4. Feature permission row

| access_level | Meaning | Transitions |
|--------------|---------|-------------|
| `none` | No access; overrides role default | → `read` or `write` |
| `read` | Read-only | → `write` or `none` |
| `write` | Read + write | → `read` or `none` |

**Absent row:** inherit project-role default (§5.2 master doc).

**Invariant:** Upsert with non-null `project_id` requires project membership.

---

## 5. Portal credential grant

| grant_level | Meaning | Allowed |
|-------------|---------|---------|
| `none` | Hidden / rejected | — |
| `use` | Backend decrypt for scoped scrape/filing | Railway only |
| `manage` | Metadata CRUD, password rotation via POST body | API; no password export |

**No owner bypass.** Creator holds `manage` only via grant row (bootstrap on create, revocable).

Transitions: ACC-009/010 by platform admin. Creator grant revocable like any other.

**Credential record:** created → updated → deleted (existing). Access independent of `portal_credentials.user_id`.

---

## 6. Audit event lifecycle

| State | Meaning |
|-------|---------|
| `recorded` | Insert into `platform_audit_events` |
| `exported` | Included in CSV |

**Immutable** — no update/delete. Deactivation does not purge audit.

---

## 7. Access review (bulk)

| State | Transition |
|-------|------------|
| `pending_review` | → `reviewed` via ACC-012 |

---

## 8. Permission risk flags (computed)

| Flag | Trigger |
|------|---------|
| `orphan_feature_grant` | Feature grant without project membership |
| `credential_manage_without_project` | Manage grant but no project access |
| `sole_platform_admin` | Only one admin |
| `expired_invitation_pending` | Invitation past expires_at |
| `deactivated_with_active_grants` | Should not occur post-deactivate job |

---

## 9. Migration enforcement phases

| Phase | State | Product behavior |
|-------|-------|------------------|
| A | `schema_only` | Legacy behavior only |
| B | `legacy_compute` | Effective permissions displayed; no reject |
| C | `shadow_enforce` | Log would-block |
| D | `enforce` | Reject unauthorized |

Rollback: D → C → B via `GOVERNANCE_ENFORCE` flag.
