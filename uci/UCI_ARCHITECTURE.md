# UCI Architecture

**Reference:** CET-2026-UCI-BACKEND-001  
**Companion:** `UCI_DELIVERY_ROADMAP.md`

---

## 1. Module Boundaries

UCI is a **parallel agent track** within PermitPilot, distinct from:

| Pipeline | Focus | UCI relationship |
|----------|-------|------------------|
| DesignCheck Intake | Permit-review comments (5 agents) | Separate — no shared UCI code |
| Autonomous Permit Filing | Municipal permit submission (9 agents) | Separate — no shared UCI code |
| County scrapers (Accela, ProjectDox, etc.) | Municipal portals | Separate — UCI uses `scraper-service` Playwright infra only |

UCI deals with **utility providers** (electric, gas, water/sewer, telecom), not municipal permitting authorities.

### Jurisdiction vs utility coordination

| Concept | Role in UCI |
|---------|-------------|
| **Permit jurisdiction** | Municipal/county permit authority — Accela, ProjectDox, county scrapers supply project context |
| **Utility coordination** | Separate lifecycle per confirmed utility provider serving the project site |
| **UCI entry** | Every project from every supported PermitPilot jurisdiction **can** enter UCI |
| **Data reuse** | Jurisdiction scrapers provide address, plans, specs, equipment docs, permit docs, contacts, dates — **do not rescrape all jurisdictions for UCI** unless required data is missing or stale |
| **Multi-provider** | A project may have multiple utility providers; **each confirmed provider gets its own `coordination_record`** |
| **Adapter scope** | A provider-specific adapter runs **only** when that provider serves the project — **do not assume PEPCO or any utility supports every jurisdiction** |

**Target flow:**

```text
Jurisdiction scraper → PermitPilot project + project_documents
        │
        ▼
UCI provider confirmation (D2.0 human-assisted; D2.2 auto when verified)
        │
        ├──► coordination_record (provider A) → adapter A or manual/email fallback
        ├──► coordination_record (provider B) → adapter B or manual/email fallback
        └──► coordination_record (provider N) → generic-readonly + email fallback
```

**PEPCO scope:** PEPCO electric is the **first fully automated provider workflow** (read sync today; portal submit target in D4). UCI remains available for projects from all supported jurisdictions; PEPCO automation applies **only** to PEPCO coordination records. Other utilities use shared lifecycle, manual actions, and email fallback until their adapters exist.

**Entry points today:**

- API: `POST/GET /api/uci/*` — `scraper-service/app/register-execution-routes.js`
- UI: `/uci` — `src/pages/UciDashboard.tsx`
- DB: seven `coordination_*` tables + `utility_providers`

---

## 2. Utility-Neutral Adapter Architecture (Target)

Shared UCI services must not contain provider-specific condition chains. Provider behavior lives in **adapters**.

### Target layout

```text
scraper-service/app/services/uci/
  adapters/
    utility-adapter.types.js      # Contract definitions
    utility-adapter-registry.js   # slug → adapter
    generic-readonly.adapter.js   # Unsupported utilities
    pepco.adapter.js              # First production adapter
  uci-portal-sync.service.js        # Orchestrator (target)
  uci-portal-application-sync.service.js
  uci-communication-sync.service.js
  uci-milestone-sync.service.js
  uci-lifecycle-mapping.service.js
  uci-document-storage.service.js
  uci-access.service.js             # Existing
  uci-records.service.js            # Existing
  uci-transitions.service.js        # Existing
```

### Provider adapter contract

```js
{
  providerSlug,
  normalizeApplication(raw),
  normalizeStatus(raw),
  normalizeMessages(raw),
  normalizeDocuments(raw),
  mapPortalStatusToLifecycle(rawStatus, context),
  getExternalApplicationId(raw),
  getExternalJobId(raw),
  // D4+ submission extension:
  prepareSubmissionContext(),
  validateSubmissionReadiness(),
  submitApplication(),
  captureConfirmation(),
  captureFailureArtifacts()
}
```

PEPCO-specific status mappings (e.g. "In Design" → stage 6) live **only** in `pepco.adapter.js`.

---

## 3. Current Code Paths (Present Implementation)

| Concern | Current path | Notes |
|---------|--------------|-------|
| PEPCO login/MFA | `scrapers/pepco/login-flow.js` | Headed browser, session store |
| PEPCO dashboard | `uci-pepco-dashboard-discovery.service.js` | List API + DOM fallback |
| PEPCO app detail | `uci-pepco-application-detail-discovery.service.js` | UUID-specific API scrape |
| PEPCO routes | `/api/uci/coordination/:id/discovery/pepco/*` | Provider-coupled URLs |
| MFA sessions | `uci-pepco-session-store.js` | In-memory with TTL; optional `portalSyncJobId` link to durable job |
| Durable portal sync | `uci-durable-worker-loop.js` + `scrape_jobs` (`job_type=uci_portal_sync`) | Background worker when `UCI_DURABLE_JOBS_ENABLED=true`; sync API fallback when false |
| Data persistence | `coordination_records.metadata` | `pepco_dashboard_discovery`, `pepco_application_detail_discovery` |
| Documents | `uci-document-storage.service.js` → Supabase `project-documents` bucket; dev local optional (`UCI_PERSIST_LOCAL_DOCUMENTS`) | Not linked to `project_documents` table |
| Child tables | D1A portal_sync writes applications/comms/milestones | Costs/equipment still unread |
| Lifecycle mapping | `uci-lifecycle-mapping.service.js` after portal sync | PEPCO status → stage proposals in `metadata.uci_lifecycle_proposals`; optional system apply via `UCI_AUTO_STAGE_TRANSITIONS` |
| Human-assisted provider setup | `uci-provider-setup.service.js` + `GET .../provider-setup` | Guided init; structured address first, `portal_data.location` fallback; `metadata.uci_provider_mapping`; no auto territory matching |
| Load profile foundation (D2.1) | `uci-load-profile.service.js` + `POST .../load-profile/analyze` | Missing-input inventory; `load_summary` on `agent_draft`; no-guess engineering rule |
| Application preparation (D3) | `uci-application-builder.service.js` + template registry | PEPCO manifest; package draft; review workflow |
| Submission foundation (D4) | `uci-application-submit.service.js` + `POST .../applications/:id/submit` | Email intent fallback; PEPCO portal submit blocked |

**Migration strategy:** Wrap existing PEPCO services behind `pepco.adapter.js` and `uci-portal-sync.service.js` without immediate file relocation.

### PermitPilot data reuse (UCI consumers)

Reuse existing PermitPilot project and document data. Do not invent values; record missing inputs in `missing_inputs` / `needs_verification`.

| Source | Path / table | UCI consumer | Wired today | Reliability | Fallback when missing |
|--------|--------------|--------------|-------------|-------------|----------------------|
| Project address | `projects.address`, `city`, `state`, `zip_code`, `jurisdiction` | D2.0 provider setup, D2.1 load profile, D3 application builder | ✅ | High when structured fields populated | `projects.portal_data.location` (read-only fallback in D2.0); `missing_inputs` in D2.1/D3 |
| Project name | `projects.name` | D3 application package manifest | ✅ | High | Template field marked missing |
| Project type | `projects.project_type` | D2.1 load profile inventory | ✅ | Medium | Listed in `missing_inputs` |
| Description | `projects.description` | D2.1 load profile inventory | ✅ | Medium | Optional; not used for numeric inference |
| Square footage | `projects.square_footage` | D2.1 inventory only — **not** for kW/amps/voltage/phase/meter/BTU/GPM/DFU/service size | ✅ | Medium | Omitted from `calculated_values`; never inferred |
| Deadlines | `projects.deadline` | D2.1 load profile | ✅ | Medium | `construction_schedule` in `missing_inputs` |
| Project contacts | `projects` client fields (`client_name`, `client_email` via billing); `reviewer_contacts` JSONB on related tables | D3/D4 submission context (partial) | ⚠️ partial | Medium | Manual entry in application review; not fully wired to UCI child tables |
| Plans | `project_documents` (`document_type` plan-related) | D2.1 inventory, D3 required-doc matching | ✅ | Medium — metadata only, no content parse | `uploaded_specifications_or_plans` missing |
| Specifications | `project_documents` (spec-related types) | D2.1 inventory, D3 required-doc matching | ✅ | Medium — metadata only | Same as plans |
| Equipment schedules | `project_documents` + `coordination_equipment` | D2.1 inventory, D8 tracking | ⚠️ partial | Low until equipment rows exist | `equipment_schedule` in `missing_inputs` |
| Permit documents | `project_documents` (permit-related) | D3 attachment manifest | ✅ | Medium — filename/type only | Required-doc gaps surfaced in package review |
| Portal scrape context | `projects.portal_data` (jurisdiction scraper output) | D2.0 address fallback; not primary UCI source | ⚠️ partial | Varies by jurisdiction | Structured `projects.*` fields preferred |
| Jurisdiction scraper files | `scrape_file_results`, `portal_data.tabs.files` | Indirect — may populate `project_documents` | ⚠️ partial | Varies | Manual upload to `project_documents` |
| PEPCO portal sync | `coordination_applications`, `coordination_communications`, `coordination_milestones` via D1A | D1–D6 normalized reads | ✅ (PEPCO only) | High for synced PEPCO records | Manual/email fallback utilities |

**Square-footage rule (D2.1):** `square_footage` may appear in `inputsUsed` but must **never** populate `calculated_values` or engineering numerics. Numeric values require explicit project data, verified equipment data, or approved versioned templates (McDonald's/QSR templates remain **external data**).

---

## 4. Target Code Paths (D1+)

| Concern | Target path |
|---------|-------------|
| Portal sync trigger | `POST /api/uci/coordination/:id/sync` + durable `uci_portal_sync` job |
| Normalization | Shared sync services → child tables |
| PEPCO behavior | `pepco.adapter.js` delegates to existing scrapers |
| Documents | `uci-document-storage.service.js` → Supabase Storage |
| Lifecycle hints | `uci-lifecycle-mapping.service.js` + adapter `mapPortalStatusToLifecycle` |
| Generic utilities | `generic-readonly.adapter.js` + email fallback (D4) |

---

## 5. Normalized Data Model

### Authoritative tables (client spec §3.3)

| Table | Role |
|-------|------|
| `utility_providers` | Tenant-scoped provider directory (target); global catalog today |
| `coordination_records` | One row per utility/scope per project; lifecycle state |
| `coordination_stage_transitions` | Audit log for every stage/state change |
| `coordination_applications` | Draft/review/submit packages; `load_summary` |
| `coordination_communications` | Inbound/outbound messages; classification |
| `coordination_costs` | CIAC and fees |
| `coordination_equipment` | Long-lead ETA tracking |
| `coordination_milestones` | Inspection, meter set, easement, etc. |

### Application state model (client spec — canonical)

```
draft → reviewed → submitted → failed
```

Optional `needs_changes` exists in migration CHECK constraint. Do **not** add `approved_for_submission` as a required enum without client approval.

### Metadata compatibility strategy

- **Retain** `coordination_records.metadata` PEPCO keys for backward compatibility.
- **Add** `coordination_records.metadata.uci_provider_mapping` for human-assisted provider setup (D2.0) — method, confirmed user/time, address source, selected slugs, unresolved utility types.
- **Add** normalized rows in child tables via sync orchestrator (D1).
- Raw portal snapshots may remain in `metadata` or `agent_processed_metadata` for troubleshooting.
- API responses sanitize `localPath` and absolute storage paths (`uci-pepco-document-download.service.js` pattern).

---

## 6. Tenant and RLS Strategy

### Present implementation (tenant → project → team → UCI) — updated 2026-07-15 (Row 2)

**Canonical tenant model:** `tenants` + `tenant_memberships` + `projects.tenant_id`. No pre-existing organization table was found; billing/QB remain user-scoped.

```text
tenants (is_demo for demo workspace)
  → tenant_memberships (owner | admin | member | viewer)
  → projects.tenant_id
  → projects.user_id (owner) + project_team_members (owner/admin/editor/viewer)
  → has_tenant_project_access + has_uci_row_access (RLS)
  → coordination_records.tenant_id + child tables (triggers propagate)
```

- RLS: tenant membership **and** project access required for UCI rows (`20260715140400_row2_tenant_rls_hardening.sql`).
- Backend: `requireTenantProjectAccess` wraps all `/api/uci/*` routes; tenant ID never accepted from client body.
- `utility_providers`: global templates (`is_global_template=true`) + tenant-owned copies via `copy_utility_provider_template_for_tenant`.
- Storage: new uploads `uci/{tenantId}/{projectId}/{coordinationRecordId}/{providerSlug}/{applicationId}/{filename}`; legacy `uci/unconfigured/...` remains readable.
- Demo: dedicated `permitpilot-demo` tenant (`00000000-0000-4000-8000-000000000001`); `can_access_tenant` enforces demo↔production isolation.
- Platform `user_roles.admin` does **not** bypass UCI routes.

### Project team invitation lifecycle (Row 2 — 2026-07-15)

Production workflow (no manual SQL):

1. Project owner/admin invites by email from **Projects → project → Team tab**.
2. `create_project_team_invitation` RPC (SECURITY DEFINER) enforces `has_project_admin_access`, normalizes email, rejects existing members, stores **SHA-256 token hash** (raw token returned once).
3. `send-project-team-invitation` edge function sends Resend email with `/invite/:token` link; returns `email_sent: false` honestly if Resend unavailable.
4. Recipient signs in with **matching email**, accepts via `accept_project_team_invitation` RPC (atomic `FOR UPDATE` + `project_team_members` insert + status `accepted`).
5. Editor role grants UCI write via `has_project_editor_access`; viewer is read-only.

Security: unguessable 32-byte tokens, 7-day expiry, revoked/declined/accepted invites cannot be reused, resend rotates token with 5-minute cooldown.

### Rollout prerequisites (not yet applied in production)

- Migrations `20260715140000` through `20260715140400` must be applied before tenant RLS is live.
- Backfill creates one tenant per `projects.user_id`; Commun-ET / McDonald's are **not** auto-split without explicit client config (NB-D11-004).
- Optional: migrate legacy storage objects from `unconfigured` to tenant namespace via manual utility (not auto-run).

**Tenant isolation is code-complete and test-gated; production claim requires migration apply + live verification.**

---

## 7. Document Storage Strategy

### Present (D1B — production hardened)

- **Service:** `uci-document-storage.service.js` centralizes upload, idempotency, and metadata shaping.
- **Bucket:** Supabase `project-documents` (private).
- **Path:** `uci/unconfigured/{projectId}/{coordinationRecordId}/{providerSlug}/{externalApplicationId}/{safeFilename}`
- **Metadata:** `coordination_records.metadata.pepco_application_detail_discovery.applications[].downloadedFiles` — stores `storageBucket`, `storageStatus`, `contentHash`, `idempotencyKey`, `storageAction`; **no `localPath` or `storagePath` in persisted/API metadata**.
- **Production:** `NODE_ENV=production` disables durable local copies; Supabase is source of truth. Override with `UCI_PERSIST_LOCAL_DOCUMENTS=true` for dev/test.
- **Download:** `uci-pepco-document-download.service.js` — prefers Supabase; falls back to legacy local file for old records; authenticated server streaming (no signed URL exposure).
- **Scrape reporting:** `document_storage` object on application-detail scrape responses (`uploaded_count`, `existing_count`, `failed_count`, `errors`).
- **Not used:** `project_documents` rows (schema lacks coordination linkage; metadata model sufficient for pilot).

### Target refinements (post-D1B)

```
uci/{tenantId}/{projectId}/{coordinationRecordId}/{providerSlug}/{externalApplicationId}/{safeFilename}
```

- Replace `unconfigured` namespace when `projects.tenant_id` exists.
- Optional link to `project_documents` if portfolio UI requires unified document list.

---

## 8. Durable Jobs and MFA Resume Model

### Present

- Synchronous HTTP → in-process Playwright for PEPCO flows (unchanged).
- MFA resume: in-memory `uci-pepco-session-store.js` with TTL; optional `portalSyncJobId` on session + `pepco_mfa_session_id` on job metadata when linked.
- `disposeSessionsForCoordinationAndUser` prevents duplicate sessions per user/coordination.
- **D1D:** `uci_portal_sync` jobs on shared `scrape_jobs` / `scrape_events` with background worker when `UCI_DURABLE_JOBS_ENABLED=true`.
- **Fallback:** `POST /coordination/:id/sync` runs synchronous `runPortalSync` when flag is off (default).
- Progress: Realtime-capable `scrape_jobs` + `scrape_events` for durable runs; sync summary in HTTP response for synchronous path.

### Target refinements (post-D1D)

- Persist MFA browser state in job row (today: session id link only).
- Frontend `useUciSyncJob` hook for sync-runs polling (today: API only).
- Durable PEPCO discovery as separate job phases (today: sync job runs normalized `runPortalSync` only).

---

## 9. Email Workflow (D4/D5 — planning direction)

Reuse the existing **Commun-ET permitting mailbox** — do not introduce another email provider unless the existing mailbox cannot support the workflow.

| Direction | Detail |
|-----------|--------|
| Preferred transport | **Microsoft Graph** when mailbox is Microsoft 365 (`microsoft_mailbox_connections` table exists; encrypted tokens) |
| Scope | Inbound + outbound; attachment capture; threading preservation |
| Matching keys | Provider, utility reference, project address, subject, sender |
| Uncertain matches | Require human review — never auto-link silently |
| Audit | Preserve full message history on `coordination_communications` |
| Status today | Portal-sync classifier only; inbound webhook **not implemented** (external access: mailbox permissions + security design) |

Outbound utility submission email (D4 `email_intent` path) shares this mailbox direction once SMTP/Graph send is wired.

---

## 10. QuickBooks Reuse (D7 — planning direction)

QuickBooks is **already connected** in the PermitPilot billing module. UCI must **not** build a second integration.

| Rule | Detail |
|------|--------|
| Reuse | `scraper-service/app/services/quickbooks/` — OAuth (`qb-oauth.service.js`), API (`qb-api.service.js`), token store, invoice trigger patterns |
| Persist first | Always write `coordination_costs` before any accounting action |
| No auto-post | Do not automatically create accounting entries |
| Reviewed actions | Explicit human-triggered: draft vendor bill, draft client invoice, or both |
| Idempotency | Store QuickBooks IDs, sync status, errors, and idempotency references on cost rows; prevent duplicates (mirror `qb_invoice_id_m*` pattern on projects) |
| Status today | UCI has manual cost CRUD only; QB bridge **not wired** (implement now under D7) |

---

## 11. Completion Definitions (D4, D10, compliance)

### Submission complete (Agent 4)

Submission is complete **only when all** of the following are true:

1. Application was **actually submitted** (portal or sent email — not draft/review intent alone)
2. Required attachments were included
3. Confirmation or ticket number captured
4. Submission evidence stored (fields, attachment list, actor, timestamp)
5. Idempotency enforced — no duplicate live submits

`email_intent` metadata recording alone is **not** submission complete. Application review or creation alone is **not** submission complete.

### Coordination complete (Agent 12)

Coordination is complete **only when all** of the following are true:

1. Service energized
2. Final meter set
3. Commissioning verified
4. Costs closed
5. Closeout documents archived

Utility approval, application review, or application creation alone does **not** mean coordination is complete.

---

## 12. Event Contracts (Target — D12)

Emit on existing PermitPilot event bus (VERIFY implementation before wiring):

| Event | Trigger |
|-------|---------|
| `uci.coordination_record.created` | New coordination record |
| `uci.coordination_record.stage_changed` | Stage transition |
| `uci.coordination_record.escalated` | Manual/auto escalation |
| `uci.application.drafted` | Agent 3 complete |
| `uci.application.submitted` | Agent 4 complete |
| `uci.communication.received` | Inbound message persisted |
| `uci.communication.classified` | Agent 5 complete |
| `uci.communication.needs_attention` | Triage flag set |
| `uci.cost.estimated` / `actual_received` / `variance_flagged` | Agent 8 |
| `uci.equipment.eta_changed` / `eta_slipped` | Agent 9 |
| `uci.milestone.completed` / `missed` | Milestone updates |
| `uci.energization.confirmed` | Agent 12 |

Payload must include: `tenant_id`, `coordination_record_id`, relevant entity IDs, brief context.

---

## 13. Security Rules

| Rule | Present | Target |
|------|---------|--------|
| Bearer JWT on all `/api/uci` routes | Yes | Yes |
| Project access check before read/write | Yes | Yes |
| Tenant isolation | No | Yes |
| Portal credentials encrypted at rest | Yes (Sprint 1) | Yes |
| Passwords never returned to frontend | Yes | Yes |
| Bearer tokens/cookies never logged | Observed in UCI services | Enforced + audited |
| Service-role routes enforce access explicitly | Yes | Yes |
| Document paths sanitized in API | Yes | Yes |

---

## 14. Idempotency Rules

| Operation | Key / check |
|-----------|-------------|
| Portal submission | `coordination_applications.id`; `submitted_at IS NULL` |
| Application sync upsert | coordination record + provider + `external_application_id` |
| Communication sync | external message ID or content fingerprint hash |
| Milestone/status events | stable idempotency key per portal event |
| QuickBooks invoice | `coordination_costs.id` as RequestId |
| Stage transitions | Explicit audit row per change (duplicates are visible, not silent) |
| PEPCO metadata merge | `mergeApplicationDetailsByUuid` — per-UUID merge |
| Portal document storage | provider + externalApplicationId + documentName (+ upload timestamp) → `idempotencyKey`; storage path upsert; `contentHash` detects `already_exists` vs `updated` |

---

## 15. Engineering Extensions (Not in Client Spec)

Documented as reasonable additions requiring no client conflict:

- `UCI_AUTO_STAGE_TRANSITIONS` feature flag for lifecycle mapping
- `UCI_DURABLE_JOBS_ENABLED` feature flag for job migration
- `GET /api/uci/projects/:projectId/provider-setup` — human-assisted setup guidance (D2.0)
- `POST /api/uci/coordination/:id/load-profile/analyze` — D2.1 preliminary load profile (no-guess)
- `GET /api/uci/coordination/:id/sync-runs` — sync history endpoint
- Deterministic attention flags on portal messages before AI classifier (D1)
- Optional `external_application_id` columns on `coordination_applications` (D1 migration)
- Non-blocking gap backlog maintained in `UCI_DELIVERY_ROADMAP.md` §17; closure milestone **D13**

---

## 16. Deferred per Client Spec

| Item | Client reference |
|------|------------------|
| Agent 7 — Easement & ROW Coordinator | Phase 4 |
| Agent 10 — Inspection Release Coordinator | Phase 4 |
| ML-based energization prediction | Phase 5 |
| Closeout Knowledge Graph (full) | Phase 5 |
| Cross-Utility Conflict Hunter (full sophistication) | Phase 4 |
| Easement Holdout Resolver | Phase 4–5 |

Basic conflict flagging and basic closeout index are in client scope but not yet specified in delivery milestones beyond D10/D11.
