# Admin State Machines — Governance Scope

Operational job state machines (scraper, ingestion, filing) are **out of scope** for admin v2. This document covers **access and credential governance** lifecycles only.

Parent: [PRODUCTION_ADMIN_DASHBOARD_ARCHITECTURE.md](./PRODUCTION_ADMIN_DASHBOARD_ARCHITECTURE.md)

---

## 1. User lifecycle

| State | Meaning | Transitions |
|-------|---------|-------------|
| `active` | Normal login | → `deactivated` (ACC-002) |
| `deactivated` | Access blocked | → `active` (ACC-001) |

**Audit:** `user.activated`, `user.deactivated`

---

## 2. Platform admin role

| State | Transitions |
|-------|-------------|
| `not_admin` | → `admin` via ACC-003 |
| `admin` | → `not_admin` via ACC-004 (blocked if last admin) |

---

## 3. Project membership

| State | Source | Transitions |
|-------|--------|-------------|
| `none` | — | → viewer/editor/admin via invite or ACC-005 |
| `viewer` | team row | → editor/admin or → none |
| `editor` | team row | → admin or → none |
| `admin` | team row or owner | → lower role or → none |

**Invitation parallel:** pending → accepted | declined | expired | revoked (existing RPCs).

---

## 4. Feature permission row

| access_level | Label | Transitions |
|--------------|-------|-------------|
| `0` none | No access | → 1 or 2 via ACC-007 |
| `1` read | Read-only | → 2 or 0 |
| `2` write | Read+write | → 1 or 0 |
| `-1` deny (optional) | Explicit deny | → 0 |

**Invariant:** Upsert requires project membership when `project_id` NOT NULL.

---

## 5. Portal credential grant

| grant_level | Label | Allowed actions |
|-------------|-------|-----------------|
| `0` none | Hidden | — |
| `1` use | Use | Backend scrape/filing only |
| `2` manage | Manage | API CRUD except password export |

Transitions: ACC-009/010 only by platform admin (or manage holder reassigning if policy allows — **default: platform admin only**).

**Credential record lifecycle** (existing): created → updated (password rotated) → disabled (soft flag future) → deleted.

---

## 6. Audit event lifecycle

| State | Meaning |
|-------|---------|
| `recorded` | Insert into `platform_audit_events` |
| `exported` | Included in CSV export (metadata only) |

**Immutable** — no update/delete except retention policy (future, ≥1 year default).

---

## 7. Access review (bulk)

| State | Transition |
|-------|------------|
| `pending_review` | → `reviewed` via ACC-012 |

---

## 8. Permission risk flags (computed, not stored)

| Flag | Trigger |
|------|---------|
| `orphan_feature_grant` | Feature grant without project membership |
| `credential_manage_without_project` | Manage grant but no project access |
| `sole_platform_admin` | Only one admin in system |
| `expired_invitation_pending` | Invitation past expires_at |

Displayed on Overview and user directory; cleared when underlying data fixed.
