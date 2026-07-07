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
| MFA sessions | `uci-pepco-session-store.js` | **In-memory** — not durable |
| Data persistence | `coordination_records.metadata` | `pepco_dashboard_discovery`, `pepco_application_detail_discovery` |
| Documents | `debug/pepco-docs/` on scraper host | Not Supabase storage |
| Child tables | Read-only in detail bundle | No application/comms/cost writes |

**Migration strategy:** Wrap existing PEPCO services behind `pepco.adapter.js` and `uci-portal-sync.service.js` without immediate file relocation.

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
- **Add** normalized rows in child tables via sync orchestrator (D1).
- Raw portal snapshots may remain in `metadata` or `agent_processed_metadata` for troubleshooting.
- API responses sanitize `localPath` and absolute storage paths (`uci-pepco-document-download.service.js` pattern).

---

## 6. Tenant and RLS Strategy

### Present implementation

- RLS via `has_project_access(auth.uid(), project_id)` on all coordination tables.
- `tenant_id` on `coordination_records` is **nullable and never written**.
- Child tables use `project_id` only — no `tenant_id`.
- `utility_providers` is a **global catalog** (authenticated read-all).
- API layer: service-role Supabase client + explicit `requireProjectAccess` on every route.

### Target state (client spec §6)

- `tenant_id` propagated from `projects.tenant_id` onto coordination records and child tables.
- Tenant-aware RLS as **additional boundary** alongside project access.
- `utility_providers` tenant-scoped per client requirements.
- Cross-tenant security tests in CI (blocking).

**Do not claim tenant isolation is complete until target state is implemented and tested.**

---

## 7. Document Storage Strategy

### Present

- PEPCO PDFs: `scraper-service/debug/pepco-docs/{coordinationId}/{applicationUuid}/`
- Download via authenticated API streaming from local disk.
- Not linked to `project_documents` or Supabase buckets.

### Target (D1)

```
uci/{tenantId}/{projectId}/{coordinationRecordId}/{providerSlug}/{externalApplicationId}/{safeFilename}
```

- Backend: Supabase Storage (or existing project document bucket pattern).
- Metadata: bucket, path, checksum, content type, ingestion status.
- Local disk only behind development flag.
- Authorized download route; no path exposure in API JSON.

---

## 8. Durable Jobs and MFA Resume Model

### Present

- Synchronous HTTP → in-process Playwright for PEPCO flows.
- MFA resume: in-memory `uci-pepco-session-store.js` with TTL.
- `disposeSessionsForCoordinationAndUser` prevents duplicate sessions per user/coordination.
- Progress returned in HTTP response `progress[]` array — no SSE.

### Target (D1)

- Job type: `uci_portal_sync`
- States: `queued`, `running`, `awaiting_human`, `completed`, `failed`, `cancelled`
- Idempotency key, lease/heartbeat, capped retry backoff.
- MFA resume persisted in job record (not only in-memory).
- Feature flag: `UCI_DURABLE_JOBS_ENABLED` — engineering extension; integrate with existing `scrape_jobs` pattern where compatible.

**Do not claim durable jobs exist until implemented.**

---

## 9. Event Contracts (Target — D12)

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

## 10. Security Rules

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

## 11. Idempotency Rules

| Operation | Key / check |
|-----------|-------------|
| Portal submission | `coordination_applications.id`; `submitted_at IS NULL` |
| Application sync upsert | coordination record + provider + `external_application_id` |
| Communication sync | external message ID or content fingerprint hash |
| Milestone/status events | stable idempotency key per portal event |
| QuickBooks invoice | `coordination_costs.id` as RequestId |
| Stage transitions | Explicit audit row per change (duplicates are visible, not silent) |
| PEPCO metadata merge | `mergeApplicationDetailsByUuid` — per-UUID merge |

---

## 12. Engineering Extensions (Not in Client Spec)

Documented as reasonable additions requiring no client conflict:

- `UCI_AUTO_STAGE_TRANSITIONS` feature flag for lifecycle mapping
- `UCI_DURABLE_JOBS_ENABLED` feature flag for job migration
- `GET /api/uci/coordination/:id/sync-runs` — sync history endpoint
- Deterministic attention flags on portal messages before AI classifier (D1)
- Optional `external_application_id` columns on `coordination_applications` (D1 migration)

---

## 13. Deferred per Client Spec

| Item | Client reference |
|------|------------------|
| Agent 7 — Easement & ROW Coordinator | Phase 4 |
| Agent 10 — Inspection Release Coordinator | Phase 4 |
| ML-based energization prediction | Phase 5 |
| Closeout Knowledge Graph (full) | Phase 5 |
| Cross-Utility Conflict Hunter (full sophistication) | Phase 4 |
| Easement Holdout Resolver | Phase 4–5 |

Basic conflict flagging and basic closeout index are in client scope but not yet specified in delivery milestones beyond D10/D11.
