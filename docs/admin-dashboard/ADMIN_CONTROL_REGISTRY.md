# Admin Control Registry

Every major dashboard control with backend contract and audit requirements.

Parent: [PRODUCTION_ADMIN_DASHBOARD_ARCHITECTURE.md](./PRODUCTION_ADMIN_DASHBOARD_ARCHITECTURE.md)

---

## Registry format

| Control ID | Module | UI label | Purpose | Role | Preconditions | Backend action | Resulting state | Audit event | Risk |
|------------|--------|----------|---------|------|---------------|----------------|-----------------|-------------|------|

Risk: `low` | `medium` | `high` | `critical`

---

## Access and users

| Control ID | Module | UI label | Purpose | Role | Preconditions | Backend | Result | Audit | Risk |
|------------|--------|----------|---------|------|---------------|---------|--------|-------|------|
| ACC-001 | C | Invite user | Platform invite email | platform_admin, operations_manager, support | Valid email | `POST /api/admin/v1/access/invites` | Pending invite | `access.invite.created` | medium |
| ACC-002 | C | Revoke invitation | Cancel pending invite | platform_admin, operations_manager, support | Status pending | `POST .../invites/:id/revoke` | revoked | `access.invite.revoked` | low |
| ACC-003 | C | Grant platform role | Assign operator role | platform_admin | Not final-admin violation | RPC `admin_grant_platform_role` | Role added | `access.role.granted` | high |
| ACC-004 | C | Revoke platform role | Remove role | platform_admin | Not last platform_admin | RPC `admin_revoke_platform_role` | Role removed | `access.role.revoked` | critical |
| ACC-005 | C | Deactivate user | Ban/disable auth user | platform_admin, operations_manager | Not self if last admin | Admin API + Supabase admin | Deactivated | `access.user.deactivated` | high |
| ACC-006 | C | Add project member | Team access | support+ | Project exists | Existing invitation RPC | Member added | `access.project.member_added` | medium |
| ACC-007 | C | Remove project access | Remove team member | support+, project admin | Not owner alone | Team RPC | Removed | `access.project.member_removed` | medium |

---

## Scraper operations

| Control ID | Module | UI label | Purpose | Role | Preconditions | Backend | Result | Audit | Risk |
|------------|--------|----------|---------|------|---------------|---------|--------|-------|------|
| SCR-001 | E | Run scraper now | Manual enqueue | operator+ | Credentials ready; jurisdiction not in maintenance | `POST /api/admin/v1/scrapers/run` | Job queued | `scraper.job.enqueued` | medium |
| SCR-002 | E | Retry job | Re-queue failed job | operator+ | Status failed/partial; retryable | `POST .../jobs/:id/retry` | queued | `scraper.job.retry` | medium |
| SCR-003 | E | Cancel job | Stop running job | operator+ | Status in cancellable set | `POST .../jobs/:id/cancel` | cancelling | `scraper.job.cancel` | medium |
| SCR-004 | E | Acknowledge partial | Mark partial reviewed | operator+ | Status partial* | `POST .../jobs/:id/acknowledge` | ack recorded | `scraper.job.ack_partial` | low |
| SCR-005 | E | Retry failed attachment | Re-download file | operator+ | Attachment failed | `POST .../attachments/:id/retry` | pending download | `scraper.attachment.retry` | medium |
| SCR-006 | E | Enable schedule | Turn on cron | operations_manager+ | Schedule defined | `PATCH .../schedules/:id` | enabled | `scraper.schedule.enabled` | medium |
| SCR-007 | D | Maintenance mode | Pause jurisdiction scrapes | operations_manager+ | Reason required | `PATCH .../jurisdictions/:id/maintenance` | maintenance on | `jurisdiction.maintenance.on` | high |

---

## Document ingestion and RAG

| Control ID | Module | UI label | Purpose | Role | Preconditions | Backend | Result | Audit | Risk |
|------------|--------|----------|---------|------|---------------|---------|--------|-------|------|
| ING-001 | H | Enqueue ingestion | Start ingest job | operator+ | Document in Storage | `POST /api/admin/v1/ingestion/enqueue` | pending job | `ingestion.job.enqueued` | low |
| ING-002 | H | Retry ingestion | Re-process failed | operator+ | Status failed/partial | `POST .../jobs/:id/retry` | pending | `ingestion.job.retry` | medium |
| ING-003 | H | Re-index document | Re-chunk/embed | operator+ | Document completed once | `POST .../documents/:id/reindex` | pending | `ingestion.document.reindex` | medium |
| ING-004 | H | Cancel ingestion | Stop processing | operator+ | Status processing | `POST .../jobs/:id/cancel` | cancelled | `ingestion.job.cancel` | low |

---

## Filing

| Control ID | Module | UI label | Purpose | Role | Preconditions | Backend | Result | Audit | Risk |
|------------|--------|----------|---------|------|---------------|---------|--------|-------|------|
| FIL-001 | F | Approve for filing | Move to approved | operator+, project admin | Preflight complete | Existing permitwizard path | approved | `filing.approved` | high |
| FIL-002 | F | Submit to portal | Execute submission | operator+, project admin | Approved; credentials | `/api/permitwizard/submit` | filing/submitted | `filing.submitted` | critical |
| FIL-003 | F | Mark needs information | Flag gaps | operator+ | — | `PATCH .../filings/:id` | awaiting | `filing.flagged` | low |

---

## QuickBooks and billing

| Control ID | Module | UI label | Purpose | Role | Preconditions | Backend | Result | Audit | Risk |
|------------|--------|----------|---------|------|---------------|---------|--------|-------|------|
| QB-001 | K | Preview milestone | Dry-run payload | operator+, project editor | Project billing complete | Existing `POST /api/quickbooks/invoice/trigger` dryRun | preview | `billing.milestone.preview` | low |
| QB-002 | K | Create draft invoice | Live M1/M2/M3 | operations_manager+, project editor | Subscription active; not duplicate | Existing trigger live | processing→completed/failed | `billing.milestone.live` | critical |
| QB-003 | K | Safe retry invoice | Retry after failure | operations_manager+ | failed/uncertain; no duplicate in QB | Trigger with idempotency | processing | `billing.milestone.retry` | critical |
| QB-004 | K | Reconcile uncertain | Mark reconciled after QB lookup | operations_manager+ | uncertain state | `PATCH .../projects/:id/qb-reconcile` | reconciled | `billing.qb.reconciled` | medium |
| QB-005 | K | Reconnect QuickBooks | OAuth start | platform_admin | — | Redirect `/api/quickbooks/oauth/start` | OAuth flow | `billing.qb.reconnect_started` | medium |

---

## Integrations and communications

| Control ID | Module | UI label | Purpose | Role | Preconditions | Backend | Result | Audit | Risk |
|------------|--------|----------|---------|------|---------------|---------|--------|-------|------|
| INT-001 | N | Test integration | Health probe | operator+ | — | `POST .../integrations/:key/test` | snapshot updated | `integration.test` | low |
| INT-002 | L | Reconnect mailbox | Graph OAuth | platform_admin, user self | — | `/api/microsoft/oauth/start` | OAuth | `graph.reconnect` | medium |
| INT-003 | L | Send jurisdiction notification | Bulk notify | operations_manager+ | Template valid | Existing edge/admin flow | sent | `comms.jurisdiction.notify` | medium |

---

## Configuration

| Control ID | Module | UI label | Purpose | Role | Preconditions | Backend | Result | Audit | Risk |
|------------|--------|----------|---------|------|---------------|---------|--------|-------|------|
| CFG-001 | P | Enable feature flag | Server flag on | operations_manager+ | Reason required | `PATCH .../config/flags/:key` | enabled | `config.flag.enabled` | high |
| CFG-002 | P | Disable feature flag | Server flag off | operations_manager+ | Reason required | `PATCH .../config/flags/:key` | disabled | `config.flag.disabled` | high |
| CFG-003 | M | Enable UCI live submit | Open live gate | platform_admin | Typed confirm PRODUCTION | Env + flag (Railway) | gated on | `uci.live_gate.enabled` | critical |

---

## Projects and documents

| Control ID | Module | UI label | Purpose | Role | Preconditions | Backend | Result | Audit | Risk |
|------------|--------|----------|---------|------|---------------|---------|--------|-------|------|
| PRJ-001 | B | Archive project | Soft archive | operations_manager+ | No active jobs | `PATCH .../projects/:id/archive` | archived | `project.archived` | medium |
| DOC-001 | G | Archive document | Soft delete doc | operations_manager+, project admin | Not under active ingest | RPC archive | archived | `document.archived` | medium |

---

## Code analyzer and response matrix

| Control ID | Module | UI label | Purpose | Role | Preconditions | Backend | Result | Audit | Risk |
|------------|--------|----------|---------|------|---------------|---------|--------|-------|------|
| AN-001 | I | Re-run analysis | Trigger analyzer | operator+, project editor | Documents present | Existing analyzer API | running | `analyzer.rerun` | medium |
| RM-001 | J | Regenerate response | RAG draft | operator+, project editor | Chunks exist | Edge `generate-grounded-response` | draft | `response.regenerated` | medium |

---

## Audit and incidents

| Control ID | Module | UI label | Purpose | Role | Preconditions | Backend | Result | Audit | Risk |
|------------|--------|----------|---------|------|---------------|---------|--------|-------|------|
| AUD-001 | Q | Export audit CSV | Compliance export | auditor+ | Date range | `GET .../audit/export` | file | `audit.export` | low |
| INC-001 | A | Acknowledge incident | Clear alert | operator+ | Open incident | `POST .../incidents/:id/ack` | acked | `incident.acknowledged` | low |

---

## Controls explicitly excluded from dashboard

| Action | Reason |
|--------|--------|
| View portal password plaintext | Never |
| Edit Railway env vars | Deployment platform |
| Execute DB restore | Destructive — runbook |
| Raw SQL console | Security |
| Display OAuth refresh token | Security |

---

## Confirmation dialog tiers

| Tier | When | UI |
|------|------|-----|
| T0 | Read-only | None |
| T1 | Low risk mutation | Confirm button |
| T2 | Medium risk | Modal + confirm |
| T3 | High/critical | Modal + type `CONFIRM` + reason field |
| T4 | Production gate (UCI live) | T3 + env banner acknowledgment |
